const fs = require('fs');
const path = require('path');

const OUTBOX = new Map();      // msgId -> send/delivery metadata
const PHONE_UID = new Map();   // phone_id -> uid
const UID_PHONE = new Map();   // uid -> phone_id
const PENDING = [];            // legacy unsafe fallback; disabled by default in main.js

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '.data');
const OUTBOX_FILE = path.join(DATA_DIR, 'outbox.json');
const PHONE_UID_FILE = path.join(DATA_DIR, 'phone_uid.json');
const UID_PHONE_FILE = path.join(DATA_DIR, 'uid_phone.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return []; }
}

function saveJSON(file, data) {
  ensureDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

(function bootstrap() {
  loadJSON(OUTBOX_FILE).forEach(value => {
    const msgId = value?.msgId || value?.msg_id;
    if (msgId) OUTBOX.set(String(msgId), { ...value, msgId: String(msgId) });
  });
  loadJSON(PHONE_UID_FILE).forEach(([phone, uid]) => PHONE_UID.set(phone, uid));
  loadJSON(UID_PHONE_FILE).forEach(([uid, phone]) => UID_PHONE.set(uid, phone));
  console.log('🗃️ store loaded:', {
    outbox: OUTBOX.size,
    phone_uid: PHONE_UID.size,
    uid_phone: UID_PHONE.size
  });
})();

function persistOutbox() {
  saveJSON(OUTBOX_FILE, Array.from(OUTBOX.values()));
}

function persistPhoneUid() {
  saveJSON(PHONE_UID_FILE, Array.from(PHONE_UID.entries()));
  saveJSON(UID_PHONE_FILE, Array.from(UID_PHONE.entries()));
}

function normalizeOutboxRecord(record) {
  if (!record) return null;
  return {
    msg_id: record.msgId,
    phone_id: record.phone_id || null,
    template_id: record.template_id || null,
    campaign_id: record.campaign_id || null,
    status: record.status || 'sent',
    sent_at: record.sentAt || null,
    delivered_at: record.deliveredAt || null,
    read_status: record.readStatus || 'unavailable',
    read_confirmed: record.readConfirmed === true,
    user_id: record.user_id || null,
    user_id_by_app: record.user_id_by_app || null,
    app_id: record.app_id || null,
    channel: record.channel || null,
    sender_id: record.sender_id || null,
    recipient_id: record.recipient_id || null,
    recipient_phone_hash: record.recipient_phone_hash || null,
    tracking_id: record.tracking_id || null,
    delivery_time_raw: record.deliveryTimeRaw ?? null,
    webhook_event_at: record.webhookEventAt || null,
    webhook_received_at: record.webhookReceivedAt || null,
    payload_variant: record.payloadVariant || null,
    last_webhook_at: record.lastWebhookAt || null
  };
}

function putOutbox(msgId, meta = {}) {
  if (!msgId) return null;
  const key = String(msgId);
  const existing = OUTBOX.get(key) || {};
  const now = Date.now();
  const value = {
    ...existing,
    ...meta,
    msgId: key,
    status: existing.status === 'delivered' ? 'delivered' : (meta.status || existing.status || 'sent'),
    sentAt: existing.sentAt || meta.sentAt || now,
    deliveredAt: existing.deliveredAt || meta.deliveredAt || null,
    readStatus: 'unavailable',
    readConfirmed: false
  };
  OUTBOX.set(key, value);
  persistOutbox();
  return normalizeOutboxRecord(value);
}

function markDelivered(msgId, eventMeta = {}) {
  if (!msgId) return { changed: false, duplicate: false, record: null };
  const key = String(msgId);
  const existing = OUTBOX.get(key) || { msgId: key, sentAt: null };
  const duplicate = existing.status === 'delivered';
  const now = Date.now();
  const value = {
    ...existing,
    msgId: key,
    status: 'delivered',
    deliveredAt: existing.deliveredAt || eventMeta.deliveredAt || now,
    readStatus: 'unavailable',
    readConfirmed: false,
    phone_id: eventMeta.phone_id || existing.phone_id || null,
    channel: eventMeta.channel || existing.channel || 'zns',
    user_id: eventMeta.user_id || existing.user_id || null,
    user_id_by_app: eventMeta.user_id_by_app || existing.user_id_by_app || null,
    app_id: eventMeta.app_id || existing.app_id || null,
    sender_id: eventMeta.sender_id || existing.sender_id || null,
    recipient_id: eventMeta.recipient_id || existing.recipient_id || null,
    recipient_phone_hash: eventMeta.recipient_phone_hash || existing.recipient_phone_hash || null,
    tracking_id: eventMeta.tracking_id || existing.tracking_id || null,
    deliveryTimeRaw: eventMeta.deliveryTimeRaw ?? existing.deliveryTimeRaw ?? null,
    webhookEventAt: eventMeta.webhookEventAt || existing.webhookEventAt || null,
    webhookReceivedAt: eventMeta.webhookReceivedAt || now,
    payloadVariant: eventMeta.payloadVariant || existing.payloadVariant || null,
    lastWebhookAt: now
  };
  OUTBOX.set(key, value);
  persistOutbox();
  return {
    changed: !duplicate,
    duplicate,
    record: normalizeOutboxRecord(value)
  };
}

function getOutbox(msgId) {
  return msgId ? OUTBOX.get(String(msgId)) || null : null;
}

function getOutboxView(msgId) {
  return normalizeOutboxRecord(getOutbox(msgId));
}

function listOutbox() {
  return Array.from(OUTBOX.values()).map(normalizeOutboxRecord);
}

function setUidForPhone(phoneId, uid) {
  if (!phoneId || !uid) return;
  PHONE_UID.set(String(phoneId), String(uid));
  UID_PHONE.set(String(uid), String(phoneId));
  persistPhoneUid();
}

function getUidByPhone(phoneId) {
  return phoneId ? PHONE_UID.get(String(phoneId)) || null : null;
}

function getPhoneByUid(uid) {
  return uid ? UID_PHONE.get(String(uid)) || null : null;
}

function pushPending({ phone_id, template_id, campaign_id }) {
  PENDING.push({
    phone_id,
    template_id: template_id || null,
    campaign_id: campaign_id || null,
    at: Date.now()
  });
  if (PENDING.length > 200) PENDING.splice(0, PENDING.length - 200);
}

function pickPending({ windowMs = 120000 } = {}) {
  const now = Date.now();
  for (let index = PENDING.length - 1; index >= 0; index -= 1) {
    if (now - PENDING[index].at <= windowMs) return PENDING.splice(index, 1)[0];
  }
  return null;
}

module.exports = {
  putOutbox,
  markDelivered,
  getOutbox,
  getOutboxView,
  listOutbox,
  setUidForPhone,
  getUidByPhone,
  getPhoneByUid,
  pushPending,
  pickPending
};
