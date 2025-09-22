const express = require('express');
require('dotenv').config();

const { extractZaloData } = require('./utils/zalo');
const { sendToTelegram } = require('./utils/telegram');
const { sendTemplateBatch } = require('./services/zns');

const {
  getOutbox, listOutbox,
  setUidForPhone, getUidByPhone, getPhoneByUid,
  pickPending
} = require('./store');

const app = express();
const port = process.env.PORT || 3002;
const PENDING_WINDOW_MS = Number(process.env.PENDING_WINDOW_MS || 120000);
const path = require('path');
app.use(express.static(path.join(__dirname, 'public'))); // public chứa file zalo_verifier....html

app.use(express.json({ limit: '1mb' }));

app.get('/health', (_, res) => res.status(200).send('ok'));

// ======= queue gửi Telegram để không bị flood =======
const messageQueue = [];
let isSending = false;
async function processQueue() {
  if (isSending || messageQueue.length === 0) return;
  isSending = true;
  try {
    const { data } = messageQueue.shift();
    await sendToTelegram(data);
  } catch (e) {
    console.error('❌ Lỗi processQueue:', e);
  } finally {
    isSending = false;
    processQueue();
  }
}

// =================== WEBHOOK ZALO ===================
app.post('/zns/zalo-webhook', (req, res) => {
  console.log('📥 Webhook nhận:', req.body);
  res.status(200).send('OK');

  if (req.body?.event_name !== 'user_received_message') {
    messageQueue.push({ data: { notice: 'Unhandled event', event_name: req.body?.event_name || null } });
    return processQueue();
  }

  const msgId = req.body?.message?.msg_id || null;
  console.log('🔎 lookup msg_id:', msgId);

  const data = extractZaloData(req.body); // có thể đã có UID + link
  data._map_hit = false;
  data._map_via = null;

  // 1) Map cứng theo message_id -> phone_id
  const meta = msgId ? getOutbox(msgId) : null;
  if (meta?.phone_id) {
    data.phone_id = meta.phone_id;
    if (!data.phone) data.phone = meta.phone_id;
    data._map_hit = true;
    data._map_via = 'msg_id';
  } else {
    console.warn('⚠️ Không tìm thấy mapping cho msg_id:', msgId, 'gần nhất=', listOutbox().slice(-5).map(i => i.msg_id));
  }

  // 2) Nếu chưa có phone nhưng có UID → tra cache UID→phone
  if (!data.phone && data.user_id_by_app) {
    const p = getPhoneByUid(data.user_id_by_app);
    if (p) {
      data.phone_id = data.phone_id || p;
      data.phone = p;
      data._map_hit = true;
      data._map_via = 'uid_cache';
    }
  }

  // 3) Nếu vẫn chưa có phone → fallback pending window (120s mặc định)
  if (!data.phone) {
    const pending = pickPending({ windowMs: PENDING_WINDOW_MS });
    if (pending?.phone_id) {
      data.phone_id = data.phone_id || pending.phone_id;
      data.phone = pending.phone_id;
      data._map_hit = true;
      data._map_via = 'pending_window';
    }
  }

  // 4) Nếu có cả phone & UID → học 2 chiều cho lần sau
  if (data.phone && data.user_id_by_app) {
    setUidForPhone(data.phone, data.user_id_by_app);
  }

  data.msg_id = msgId;
  data.app_id = req.body?.app_id || null;

  messageQueue.push({ data });
  processQueue();
});

// ======= đăng ký mapping thủ công (nếu gửi từ hệ khác) =======
app.post('/zns/outbox', (req, res) => {
  const { putOutbox } = require('./store');
  try {
    const { msg_id, phone_id, template_id, campaign_id } = req.body || {};
    if (!msg_id || !phone_id) return res.status(400).json({ ok: false, error: 'msg_id and phone_id are required' });
    putOutbox(msg_id, { phone_id, template_id, campaign_id });
    return res.json({ ok: true });
  } catch (e) {
    console.error('❌ /zns/outbox error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ======= gửi batch thật (gọi Zalo API) & auto-save message_id =======
app.post('/zns/send-batch', async (req, res) => {
  try {
    const { access_token, template_id, campaign_id, items } = req.body || {};
    if (!access_token || !template_id || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: 'access_token, template_id, items[] are required' });
    }
    const results = await sendTemplateBatch(items, {
      accessToken: access_token, template_id, campaign_id: campaign_id || null, concurrency: 3
    });
    const ok = results.filter(r => r.ok).length;
    return res.json({ ok: true, summary: { total: results.length, success: ok, failed: results.length - ok }, results });
  } catch (e) {
    console.error('❌ /zns/send-batch error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// =============== DEBUG ===============
app.get('/debug/outbox', (_, res) => {
  try { res.json(listOutbox()); } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/debug/outbox/last', (_, res) => {
  try { const ls = listOutbox(); res.json(ls.slice(-5)); } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.use((_, res) => res.status(200).send('Service ready.'));

app.listen(port, () => {
  console.log(`✅ Server chạy tại http://localhost:${port}`);
  console.log('TELEGRAM_TOKEN?', !!process.env.TELEGRAM_TOKEN, 'CHAT_IDS?', process.env.CHAT_IDS);
});
