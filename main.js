const express = require('express');
require('dotenv').config();

const { extractZaloData, getMessageIds } = require('./utils/zalo');
const { sendToTelegram } = require('./utils/telegram');
const { sendTemplateBatch } = require('./services/zns');

const {
  getOutbox, getOutboxView, listOutbox, markDelivered,
  setUidForPhone, getPhoneByUid,
} = require('./store');

const app = express();
const port = process.env.PORT || 3002;
const EXPECTED_ZALO_APP_ID = process.env.ZALO_APP_ID || '';
const FORWARD_OTHER_EVENTS = process.env.FORWARD_OTHER_EVENTS === 'true';
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
  const webhookReceivedAt = Date.now();

  try {
    console.log('📥 Webhook nhận event:', body?.event_name || '(missing)');
    if (process.env.LOG_RAW_WEBHOOK === 'true') {
      console.log('📥 Webhook raw:', JSON.stringify(body));
    }

    if (EXPECTED_ZALO_APP_ID && String(body?.app_id || '') !== EXPECTED_ZALO_APP_ID) {
      console.warn('⚠️ Bỏ qua webhook sai app_id:', body?.app_id || null);
      return res.status(200).send('IGNORED_APP_ID');
    }

    const data = extractZaloData(body);
    if (!data.event_name_supported) {
      data.notice = 'Không phải user_received_message.';
      if (FORWARD_OTHER_EVENTS) enqueueTelegram(data);
      return res.status(200).send('IGNORED_EVENT');
    }

    const msgIds = getMessageIds(body);
    console.log('🔎 lookup message ids:', msgIds);
    data.mapping_hit = false;
    data.mapping_via = null;

    // Map chắc chắn theo msg_id đã lưu khi gọi ZNS send API.
    let matchedMsgId = null;
    let meta = null;
    for (const msgId of msgIds) {
      const candidate = getOutbox(msgId);
      if (candidate) {
        matchedMsgId = msgId;
        meta = candidate;
        break;
      }
    }

    const knownZnsMessage = Boolean(meta && (meta.channel === 'zns' || meta.template_id));
    const znsPayloadSignal = data.payload_variant === 'zns_delivery';
    data.tracked_zns_event = knownZnsMessage || znsPayloadSignal;

    // Payload nút Test có msg_id giả và không có delivery_time: không mutate ZNS thật.
    if (!data.tracked_zns_event) {
      data.notice = 'user_received_message không map được ZNS; có thể là event OA hoặc payload Test.';
      if (FORWARD_OTHER_EVENTS) enqueueTelegram(data);
      return res.status(200).send('UNMAPPED_RECEIVED_EVENT');
    }

    if (meta?.phone_id) {
      data.phone_id = meta.phone_id;
      data.template_id = meta.template_id || null;
      data.campaign_id = meta.campaign_id || null;
      data.mapping_hit = true;
      data.mapping_via = 'msg_id';
    } else if (data.recipient_phone) {
      data.phone_id = data.recipient_phone;
      data.mapping_hit = true;
      data.mapping_via = 'webhook_recipient';
    } else {
      console.warn('⚠️ Chưa map được số điện thoại cho message ids:', msgIds);
    }

    if (!data.phone_id && data.user_id_by_app) {
      const phone = getPhoneByUid(data.user_id_by_app);
      if (phone) {
        data.phone_id = phone;
        data.mapping_hit = true;
        data.mapping_via = 'uid_cache';
      }
    }

    if (data.phone_id && data.user_id_by_app) {
      setUidForPhone(data.phone_id, data.user_id_by_app);
    }

    data.msg_id = matchedMsgId || data.msg_id;
    data.delivery_time_source = data.delivery_time_ms !== null
      ? 'message.delivery_time'
      : 'unavailable';
    data.webhook_received_at = webhookReceivedAt;

    if (!data.msg_id) {
      data.validation_error = 'Webhook thiếu message.msg_id; không thể lưu trạng thái.';
      enqueueTelegram(data);
      return res.status(200).send('MISSING_MSG_ID');
    }

    const deliveryResult = markDelivered(data.msg_id, {
      deliveredAt: data.delivery_time_ms,
      deliveryTimeRaw: data.delivery_time_raw,
      webhookEventAt: data.timestamp_ms,
      webhookReceivedAt,
      phone_id: data.phone_id || null,
      channel: 'zns',
      user_id: data.user_id,
      user_id_by_app: data.user_id_by_app,
      app_id: data.app_id,
      sender_id: data.sender_id,
      recipient_id: data.recipient_id,
      recipient_phone_hash: data.recipient_phone_hash,
      tracking_id: data.tracking_id,
      payloadVariant: data.payload_variant
    });

    data.webhook_duplicate = deliveryResult.duplicate;
    data.delivery_record = deliveryResult.record;

    // Zalo có Webhook Retry; persist trước ACK và chỉ Telegram ở lần đầu.
    if (!deliveryResult.duplicate) enqueueTelegram(data);
    else console.log('♻️ Bỏ qua webhook giao nhận trùng:', data.msg_id);

    return res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Lỗi xử lý Zalo webhook:', error);
    return res.status(500).send('WEBHOOK_PROCESSING_ERROR');
  }
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
app.get('/debug/outbox/:msgId', requireAdminApiKey, (req, res) => {
  try {
    const record = getOutboxView(req.params.msgId);
    if (!record) return res.status(404).json({ ok: false, error: 'msg_id not found' });
    return res.json({ ok: true, record });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.use((_, res) => res.status(200).send('Service ready.'));

app.listen(port, () => {
  console.log(`✅ Server chạy tại http://localhost:${port}`);
  console.log('TELEGRAM_TOKEN?', !!process.env.TELEGRAM_TOKEN, 'CHAT_IDS?', !!process.env.CHAT_IDS);
});
