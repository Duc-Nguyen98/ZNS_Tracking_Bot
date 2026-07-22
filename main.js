const express = require('express');
const crypto = require('crypto');
require('dotenv').config();

const {
  extractZaloData, getMessageIds, getCorrelationMessageIds, isUserIdentityEvent
} = require('./utils/zalo');
const { sendToTelegram } = require('./utils/telegram');
const { sendTemplateBatch } = require('./services/zns');
const {
  exchangeAuthorizationCode,
  refreshAccessToken,
  getAccessToken,
  publicTokenStatus
} = require('./services/zalo-oauth');
const {
  listUserFields,
  createUserField,
  updateUserField,
  deleteUserField
} = require('./services/zalo-user-fields');
const { normalizePhoneE164VN } = require('./utils/format');

const {
  getOutbox, getOutboxView, listOutbox, markDelivered,
  setUidForPhone, getPhoneByUid,
  upsertUserIdentity, linkUserIdentityToPhone,
  getUserIdentity, getUserIdentityByPhone, listUserIdentities,
  attachIdentityToOutbox, rememberWebhookEvent,
} = require('./store');

const app = express();
const port = process.env.PORT || 3002;
const EXPECTED_ZALO_APP_ID = process.env.ZALO_APP_ID || '';
const FORWARD_OTHER_EVENTS = process.env.FORWARD_OTHER_EVENTS === 'true';
const CAPTURE_OA_IDENTITIES = process.env.CAPTURE_OA_IDENTITIES !== 'false';
const TELEGRAM_MAX_RETRIES = Math.max(1, Number(process.env.TELEGRAM_MAX_RETRIES || 3));
const path = require('path');
app.use(express.static(path.join(__dirname, 'public'))); // public chứa file zalo_verifier....html

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

app.get('/health', (_, res) => res.status(200).send('ok'));
app.get('/', (_, res) => res.status(200).send('Service ready.'));

function secureEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

// OAuth callback cấp OA Access Token. Đây KHÔNG phải URL nhận webhook sự kiện.
app.get('/oauth/zalo/callback', async (req, res) => {
  try {
    if (req.query.error) {
      return res.status(400).json({
        ok: false,
        error: 'Zalo từ chối cấp quyền',
        error_code: String(req.query.error)
      });
    }

    const expectedState = process.env.ZALO_OAUTH_STATE;
    if (!expectedState) {
      return res.status(500).json({ ok: false, error: 'Server chưa cấu hình ZALO_OAUTH_STATE' });
    }
    if (!secureEqualText(req.query.state, expectedState)) {
      return res.status(400).json({ ok: false, error: 'OAuth state không hợp lệ' });
    }

    const tokenBundle = await exchangeAuthorizationCode(req.query.code);
    return res.status(200).json({
      ok: true,
      message: 'OA đã cấp quyền; token đã được lưu an toàn trên server.',
      token: publicTokenStatus(tokenBundle)
    });
  } catch (error) {
    console.error('❌ Zalo OAuth callback error:', error.message);
    return res.status(502).json({ ok: false, error: error.message, code: error.code || null });
  }
});

// ======= queue gửi Telegram để không bị flood =======
const messageQueue = [];
let isSending = false;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function enqueueTelegram(data) {
  messageQueue.push({ data, attempts: 0 });
  void processQueue();
}

function findOutboxMatches(messageIds = []) {
  return messageIds
    .map(msgId => ({ msgId, meta: getOutbox(msgId) }))
    .filter(item => item.meta);
}

function buildIdentityEventKey(data) {
  return [
    data.event_name,
    data.user_id_by_app || data.user_id || data.sender_id || 'unknown-user',
    data.timestamp_ms || 'unknown-time',
    ...(data.msg_ids || [])
  ].join(':');
}

function handleUserIdentityEvent(body, data, webhookReceivedAt, res) {
  if (!CAPTURE_OA_IDENTITIES) {
    if (FORWARD_OTHER_EVENTS) enqueueTelegram(data);
    return res.status(200).send('IDENTITY_CAPTURE_DISABLED');
  }

  if (!data.user_id && !data.user_id_by_app) {
    data.validation_error = 'Webhook tương tác OA không có user_id/sender.id hoặc user_id_by_app.';
    enqueueTelegram(data);
    return res.status(200).send('MISSING_USER_ID');
  }

  const correlationIds = getCorrelationMessageIds(body);
  const matches = findOutboxMatches(correlationIds);
  const matchedPhones = [...new Set(matches.map(item => item.meta.phone_id).filter(Boolean))];
  let phoneId = null;
  let phoneLinkSource = null;

  if (matchedPhones.length === 1) {
    phoneId = matchedPhones[0];
    phoneLinkSource = data.event_name === 'user_seen_message'
      ? 'seen_message_id'
      : (data.event_name === 'user_received_message'
          ? 'received_message_id'
          : (String(data.event_name || '').startsWith('oa_send_')
              ? 'oa_sent_message_id'
              : 'reply_reference_message_id'));
  } else if (matchedPhones.length > 1) {
    data.identity_link_warning = 'Nhiều SĐT khớp msg_ids; không tự gán UID để tránh sai người.';
  }

  if (!phoneId) {
    phoneId = getPhoneByUid(data.user_id_by_app) || getPhoneByUid(data.user_id);
    if (phoneId) phoneLinkSource = 'existing_uid_cache';
  }

  const identity = upsertUserIdentity({
    user_id: data.user_id,
    user_id_by_app: data.user_id_by_app,
    phone_id: phoneId,
    phone_link_source: phoneLinkSource,
    event_name: data.event_name,
    message_id: data.msg_id,
    message_text: data.message_text,
    app_id: data.app_id,
    at: data.timestamp_ms || webhookReceivedAt
  });

  if (phoneId) {
    if (data.user_id) setUidForPhone(phoneId, data.user_id);
    if (data.user_id_by_app) setUidForPhone(phoneId, data.user_id_by_app);
  }

  const attachedRecords = matches.map(item => attachIdentityToOutbox(item.msgId, {
    user_id: data.user_id,
    user_id_by_app: data.user_id_by_app,
    event_name: data.event_name,
    at: data.timestamp_ms || webhookReceivedAt
  })).filter(Boolean);

  data.identity_record = identity;
  data.identity_linked_to_phone = Boolean(identity?.phone_id);
  data.identity_link_source = identity?.phone_link_source || null;
  data.correlated_outbox_records = attachedRecords;
  data.webhook_received_at = webhookReceivedAt;
  if (data.event_name === 'user_seen_message') {
    data.notice = 'Đã thu ID từ sự kiện người dùng xem tin nhắn OA.';
  } else if (data.event_name === 'user_received_message') {
    data.notice = 'Đã thu ID từ sự kiện người dùng nhận tin nhắn OA.';
  } else if (String(data.event_name || '').startsWith('oa_send_')) {
    data.notice = 'Đã thu ID người nhận từ sự kiện OA gửi tin nhắn.';
  } else {
    data.notice = 'Đã thu ID từ tin nhắn người dùng gửi cho OA.';
  }

  const dedupe = rememberWebhookEvent(buildIdentityEventKey(data), webhookReceivedAt);
  data.webhook_duplicate = dedupe.duplicate;
  if (!dedupe.duplicate) enqueueTelegram(data);
  else console.log('♻️ Bỏ qua webhook tương tác OA trùng:', data.event_name, data.user_id || data.user_id_by_app);

  return res.status(200).send('IDENTITY_CAPTURED');
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
    const isOaLifecycleEvent = isUserIdentityEvent(data.event_name) ||
      data.payload_variant === 'oa_message_delivery' ||
      String(data.event_name || '').startsWith('oa_send_');
    if (isOaLifecycleEvent) {
      return handleUserIdentityEvent(body, data, webhookReceivedAt, res);
    }

    if (!data.event_name_supported) {
      data.notice = 'Không phải sự kiện ZNS delivery hoặc tương tác người dùng OA được hỗ trợ.';
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

// ======= liên kết thủ công UID <-> SĐT khi webhook reply không tham chiếu msg_id gốc =======
app.post('/zns/identity/link', requireAdminApiKey, (req, res) => {
  try {
    const { phone, phone_id, user_id, user_id_by_app } = req.body || {};
    const normalizedPhone = normalizePhoneE164VN(phone_id || phone);
    if (!normalizedPhone || (!user_id && !user_id_by_app)) {
      return res.status(400).json({
        ok: false,
        error: 'phone/phone_id và ít nhất một trong user_id, user_id_by_app là bắt buộc'
      });
    }
    const identity = linkUserIdentityToPhone({
      phone_id: normalizedPhone,
      user_id,
      user_id_by_app,
      phone_link_source: 'manual_api',
      event_name: 'manual_identity_link',
      at: Date.now()
    });
    return res.json({ ok: true, identity });
  } catch (e) {
    console.error('❌ /zns/identity/link error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ======= gửi batch thật (gọi Zalo API) & auto-save message_id =======
app.post('/zns/send-batch', requireAdminApiKey, async (req, res) => {
  try {
    const { access_token: requestAccessToken, template_id, campaign_id, items } = req.body || {};
    const access_token = getAccessToken(requestAccessToken);
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

// Chỉ trả metadata, tuyệt đối không trả access_token/refresh_token ra API debug.
app.get('/oauth/zalo/status', requireAdminApiKey, (_, res) => {
  try { return res.json({ ok: true, token: publicTokenStatus() }); }
  catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/oauth/zalo/refresh', requireAdminApiKey, async (req, res) => {
  try {
    const tokenBundle = await refreshAccessToken(req.body?.refresh_token);
    return res.json({ ok: true, token: publicTokenStatus(tokenBundle) });
  } catch (e) {
    console.error('❌ Zalo OAuth refresh error:', e.message);
    return res.status(502).json({ ok: false, error: e.message, code: e.code || null });
  }
});

function handleOaApiError(res, error) {
  console.error('❌ Zalo OA API error:', error.message);
  return res.status(502).json({
    ok: false,
    error: error.message,
    code: error.code || null,
    zalo: error.response_data || null
  });
}

// Quyền "Quản lý trường thông tin người dùng" là REST API, không phải webhook event.
app.get('/oa/user-fields', requireAdminApiKey, async (req, res) => {
  try {
    const data = await listUserFields(getAccessToken(), req.query || {});
    return res.json({ ok: true, data });
  } catch (e) { return handleOaApiError(res, e); }
});

app.post('/oa/user-fields', requireAdminApiKey, async (req, res) => {
  try {
    const data = await createUserField(getAccessToken(), req.body || {});
    return res.json({ ok: true, data });
  } catch (e) { return handleOaApiError(res, e); }
});

app.put('/oa/user-fields', requireAdminApiKey, async (req, res) => {
  try {
    const data = await updateUserField(getAccessToken(), req.body || {});
    return res.json({ ok: true, data });
  } catch (e) { return handleOaApiError(res, e); }
});

app.delete('/oa/user-fields', requireAdminApiKey, async (req, res) => {
  try {
    const data = await deleteUserField(getAccessToken(), req.body || {});
    return res.json({ ok: true, data });
  } catch (e) { return handleOaApiError(res, e); }
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

app.get('/debug/identities', requireAdminApiKey, (_, res) => {
  try { res.json({ ok: true, identities: listUserIdentities() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/debug/identities/by-phone/:phone', requireAdminApiKey, (req, res) => {
  try {
    const identity = getUserIdentityByPhone(normalizePhoneE164VN(req.params.phone));
    if (!identity) return res.status(404).json({ ok: false, error: 'identity not found' });
    return res.json({ ok: true, identity });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/debug/identities/:id', requireAdminApiKey, (req, res) => {
  try {
    const identity = getUserIdentity(req.params.id);
    if (!identity) return res.status(404).json({ ok: false, error: 'identity not found' });
    return res.json({ ok: true, identity });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

// Không trả 200 cho URL sai: tránh Zalo tưởng webhook đã xử lý khi cấu hình thiếu path.
app.use((req, res) => res.status(404).json({ ok: false, error: 'Route not found', path: req.originalUrl }));

app.listen(port, () => {
  console.log(`✅ Server chạy tại http://localhost:${port}`);
  console.log('TELEGRAM_TOKEN?', !!process.env.TELEGRAM_TOKEN, 'CHAT_IDS?', !!process.env.CHAT_IDS);
});
