const express = require('express');
require('dotenv').config();

const { extractZaloData, getMessageIds } = require('./utils/zalo');
const { sendToTelegram } = require('./utils/telegram');
const { sendTemplateBatch } = require('./services/zns');

const {
  getOutbox, listOutbox,
  setUidForPhone, getPhoneByUid,
  pickPending
} = require('./store');

const app = express();
const port = process.env.PORT || 3002;
const PENDING_WINDOW_MS = Number(process.env.PENDING_WINDOW_MS || 120000);
const ALLOW_UNSAFE_PENDING_FALLBACK = process.env.ALLOW_UNSAFE_PENDING_FALLBACK === 'true';
const FORWARD_OTHER_EVENTS = process.env.FORWARD_OTHER_EVENTS !== 'false';
const TELEGRAM_MAX_RETRIES = Math.max(1, Number(process.env.TELEGRAM_MAX_RETRIES || 3));
const path = require('path');
app.use(express.static(path.join(__dirname, 'public'))); // public chứa file zalo_verifier....html

app.use(express.json({ limit: '1mb' }));

app.get('/health', (_, res) => res.status(200).send('ok'));

// ======= queue gửi Telegram để không bị flood =======
const messageQueue = [];
let isSending = false;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function enqueueTelegram(data) {
  messageQueue.push({ data, attempts: 0 });
  void processQueue();
}

async function processQueue() {
  if (isSending || messageQueue.length === 0) return;
  isSending = true;
  try {
    while (messageQueue.length > 0) {
      const item = messageQueue[0];
      try {
        await sendToTelegram(item.data);
        messageQueue.shift();
      } catch (error) {
        item.attempts += 1;
        console.error('❌ Telegram queue error:', {
          attempts: item.attempts,
          message: error.message,
          failures: error.failures || []
        });

        if (item.attempts >= TELEGRAM_MAX_RETRIES) {
          console.error('🛑 Bỏ event sau khi hết số lần retry:', item.data?.event_name);
          messageQueue.shift();
          continue;
        }

        await delay(500 * (2 ** (item.attempts - 1)));
      }
    }
  } finally {
    isSending = false;
    if (messageQueue.length > 0) void processQueue();
  }
}

// =================== WEBHOOK ZALO ===================
app.post('/zns/zalo-webhook', (req, res) => {
  const body = req.body || {};
  console.log('📥 Webhook nhận event:', body?.event_name || '(missing)');
  if (process.env.LOG_RAW_WEBHOOK === 'true') {
    console.log('📥 Webhook raw:', JSON.stringify(body));
  }
  res.status(200).send('OK');

  const data = extractZaloData(body);
  if (!data.tracked_zns_event) {
    data.notice = 'Non-ZNS event forwarded for diagnostics';
    if (!FORWARD_OTHER_EVENTS) return;
  }

  const msgIds = getMessageIds(body);
  console.log('🔎 lookup message ids:', msgIds);
  data._map_hit = false;
  data._map_via = null;

  // 1) Map cứng theo msg_id hoặc phần tử trong msg_ids[] -> phone_id
  let matchedMsgId = null;
  let meta = null;
  for (const msgId of msgIds) {
    const candidate = getOutbox(msgId);
    if (candidate?.phone_id) {
      matchedMsgId = msgId;
      meta = candidate;
      break;
    }
  }

  if (meta?.phone_id) {
    data.phone_id = meta.phone_id;
    if (!data.phone) data.phone = meta.phone_id;
    data._map_hit = true;
    data._map_via = 'msg_id';
  } else if (data.tracked_zns_event) {
    console.warn('⚠️ Không tìm thấy mapping cho message ids:', msgIds, 'gần nhất=', listOutbox().slice(-5).map(i => i.msg_id));
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

  // 3) Fallback theo thời gian có thể ghép nhầm người khi gửi batch/concurrent.
  // Chỉ bật khi chủ động chấp nhận rủi ro qua biến môi trường.
  if (!data.phone && ALLOW_UNSAFE_PENDING_FALLBACK && data.tracked_zns_event) {
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

  data.msg_id = matchedMsgId || data.msg_id;
  data.app_id = body?.app_id || null;

  enqueueTelegram(data);
});

function requireAdminApiKey(req, res, next) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) return next();
  if (req.get('x-api-key') === expected) return next();
  return res.status(401).json({ ok: false, error: 'Unauthorized' });
}

// ======= đăng ký mapping thủ công (nếu gửi từ hệ khác) =======
app.post('/zns/outbox', requireAdminApiKey, (req, res) => {
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
app.post('/zns/send-batch', requireAdminApiKey, async (req, res) => {
  try {
    const { access_token: requestAccessToken, template_id, campaign_id, items } = req.body || {};
    const access_token = requestAccessToken || process.env.ZALO_ACCESS_TOKEN;
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
app.get('/debug/outbox', requireAdminApiKey, (_, res) => {
  try { res.json(listOutbox()); } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/debug/outbox/last', requireAdminApiKey, (_, res) => {
  try { const ls = listOutbox(); res.json(ls.slice(-5)); } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.use((_, res) => res.status(200).send('Service ready.'));

app.listen(port, () => {
  console.log(`✅ Server chạy tại http://localhost:${port}`);
  console.log('TELEGRAM_TOKEN?', !!process.env.TELEGRAM_TOKEN, 'CHAT_IDS?', !!process.env.CHAT_IDS);
});
