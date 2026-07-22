const fs = require('fs');
const path = require('path');

const OUTBOX = new Map();      // msgId -> send/delivery metadata
const PHONE_UID = new Map();   // phone_id -> uid
const UID_PHONE = new Map();   // uid -> phone_id
const USER_IDENTITIES = new Map(); // canonical identity key -> identity metadata
const WEBHOOK_EVENTS = new Map();  // event key -> received timestamp (dedupe retries)
const PENDING = [];            // legacy unsafe fallback; disabled by default in main.js

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '.data');
const OUTBOX_FILE = path.join(DATA_DIR, 'outbox.json');
const PHONE_UID_FILE = path.join(DATA_DIR, 'phone_uid.json');
const UID_PHONE_FILE = path.join(DATA_DIR, 'uid_phone.json');
const USER_IDENTITIES_FILE = path.join(DATA_DIR, 'user_identities.json');
const WEBHOOK_EVENTS_FILE = path.join(DATA_DIR, 'webhook_events.json');

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
  loadJSON(USER_IDENTITIES_FILE).forEach(value => {
    const key = value?.identity_key || value?.user_id_by_app || value?.user_id;
    if (key) USER_IDENTITIES.set(String(key), { ...value, identity_key: String(key) });
  });
  loadJSON(WEBHOOK_EVENTS_FILE).forEach(([key, at]) => WEBHOOK_EVENTS.set(String(key), Number(at)));
  console.log('🗃️ store loaded:', {
    outbox: OUTBOX.size,
    phone_uid: PHONE_UID.size,
    uid_phone: UID_PHONE.size,
    user_identities: USER_IDENTITIES.size,
    webhook_events: WEBHOOK_EVENTS.size
  });
})();

function persistOutbox() {
  saveJSON(OUTBOX_FILE, Array.from(OUTBOX.values()));
}

function persistPhoneUid() {
  saveJSON(PHONE_UID_FILE, Array.from(PHONE_UID.entries()));
  saveJSON(UID_PHONE_FILE, Array.from(UID_PHONE.entries()));
}

function persistUserIdentities() {
  saveJSON(USER_IDENTITIES_FILE, Array.from(USER_IDENTITIES.values()));
}

function persistWebhookEvents() {
  // Giới hạn dữ liệu dedupe để file không tăng vô hạn.
  const values = Array.from(WEBHOOK_EVENTS.entries()).slice(-2000);
  WEBHOOK_EVENTS.clear();
  values.forEach(([key, at]) => WEBHOOK_EVENTS.set(key, at));
  saveJSON(WEBHOOK_EVENTS_FILE, values);
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
    oa_seen_at: record.oaSeenAt || null,
    user_replied_at: record.userRepliedAt || null,
    last_user_event: record.lastUserEvent || null,
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

function findUserIdentity({ user_id, user_id_by_app } = {}) {
  const userId = user_id ? String(user_id) : null;
  const userIdByApp = user_id_by_app ? String(user_id_by_app) : null;
  for (const value of USER_IDENTITIES.values()) {
    if (userIdByApp && value.user_id_by_app === userIdByApp) return value;
    if (userId && value.user_id === userId) return value;
  }
  return null;
}

function normalizeUserIdentity(value) {
  if (!value) return null;
  return {
    identity_key: value.identity_key,
    user_id: value.user_id || null,
    user_id_by_app: value.user_id_by_app || null,
    phone_id: value.phone_id || null,
    phone_link_source: value.phone_link_source || null,
    first_seen_at: value.first_seen_at || null,
    last_seen_at: value.last_seen_at || null,
    last_event_name: value.last_event_name || null,
    last_message_id: value.last_message_id || null,
    last_message_text: value.last_message_text || null,
    interaction_count: value.interaction_count || 0,
    app_id: value.app_id || null
  };
}

function upsertUserIdentity(meta = {}) {
  const userId = meta.user_id ? String(meta.user_id) : null;
  const userIdByApp = meta.user_id_by_app ? String(meta.user_id_by_app) : null;
  if (!userId && !userIdByApp) return null;

  const existing = findUserIdentity({ user_id: userId, user_id_by_app: userIdByApp });
  const key = existing?.identity_key || userIdByApp || userId;
  const now = Number(meta.at) || Date.now();
  const value = {
    ...(existing || {}),
    identity_key: key,
    user_id: userId || existing?.user_id || null,
    user_id_by_app: userIdByApp || existing?.user_id_by_app || null,
    phone_id: meta.phone_id || existing?.phone_id || null,
    phone_link_source: meta.phone_link_source || existing?.phone_link_source || null,
    first_seen_at: existing?.first_seen_at || now,
    last_seen_at: now,
    last_event_name: meta.event_name || existing?.last_event_name || null,
    last_message_id: meta.message_id || existing?.last_message_id || null,
    last_message_text: meta.message_text ?? existing?.last_message_text ?? null,
    interaction_count: (existing?.interaction_count || 0) + (meta.increment === false ? 0 : 1),
    app_id: meta.app_id || existing?.app_id || null
  };

  USER_IDENTITIES.set(key, value);
  if (value.phone_id) {
    const preferredUid = value.user_id_by_app || value.user_id;
    if (preferredUid) PHONE_UID.set(String(value.phone_id), preferredUid);
    if (value.user_id) UID_PHONE.set(value.user_id, String(value.phone_id));
    if (value.user_id_by_app) UID_PHONE.set(value.user_id_by_app, String(value.phone_id));
    persistPhoneUid();
  }
  persistUserIdentities();
  return normalizeUserIdentity(value);
}

function linkUserIdentityToPhone(meta = {}) {
  if (!meta.phone_id || (!meta.user_id && !meta.user_id_by_app)) return null;
  return upsertUserIdentity({
    ...meta,
    phone_id: String(meta.phone_id),
    phone_link_source: meta.phone_link_source || 'manual',
    increment: false
  });
}

function getUserIdentity(id) {
  if (!id) return null;
  const key = String(id);
  return normalizeUserIdentity(
    USER_IDENTITIES.get(key) ||
    findUserIdentity({ user_id: key, user_id_by_app: key })
  );
}

function getUserIdentityByPhone(phoneId) {
  if (!phoneId) return null;
  const phone = String(phoneId);
  for (const value of USER_IDENTITIES.values()) {
    if (value.phone_id === phone) return normalizeUserIdentity(value);
  }
  return null;
}

function listUserIdentities() {
  return Array.from(USER_IDENTITIES.values()).map(normalizeUserIdentity);
}

function attachIdentityToOutbox(msgId, meta = {}) {
  if (!msgId) return null;
  const key = String(msgId);
  const existing = OUTBOX.get(key);
  if (!existing) return null;
  const value = {
    ...existing,
    user_id: meta.user_id || existing.user_id || null,
    user_id_by_app: meta.user_id_by_app || existing.user_id_by_app || null,
    oaSeenAt: meta.event_name === 'user_seen_message'
      ? (existing.oaSeenAt || meta.at || Date.now())
      : existing.oaSeenAt || null,
    userRepliedAt: String(meta.event_name || '').startsWith('user_send_')
      ? (existing.userRepliedAt || meta.at || Date.now())
      : existing.userRepliedAt || null,
    lastUserEvent: meta.event_name || existing.lastUserEvent || null,
    lastWebhookAt: Date.now()
  };
  OUTBOX.set(key, value);
  persistOutbox();
  return normalizeOutboxRecord(value);
}

function rememberWebhookEvent(eventKey, at = Date.now()) {
  if (!eventKey) return { duplicate: false };
  const key = String(eventKey);
  if (WEBHOOK_EVENTS.has(key)) return { duplicate: true, first_seen_at: WEBHOOK_EVENTS.get(key) };
  WEBHOOK_EVENTS.set(key, Number(at) || Date.now());
  persistWebhookEvents();
  return { duplicate: false };
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
  upsertUserIdentity,
  linkUserIdentityToPhone,
  getUserIdentity,
  getUserIdentityByPhone,
  listUserIdentities,
  attachIdentityToOutbox,
  rememberWebhookEvent,
  pushPending,
  pickPending
};
