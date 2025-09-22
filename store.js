const fs = require('fs');
const path = require('path');

const OUTBOX = new Map();      // msgId -> { phone_id, template_id, campaign_id, sentAt, msgId }
const PHONE_UID = new Map();   // phone_id -> uid
const UID_PHONE = new Map();   // uid -> phone_id
const PENDING = [];            // [{ phone_id, template_id, campaign_id, at }]

const DATA_DIR = path.join(__dirname, '.data');
const OUTBOX_FILE = path.join(DATA_DIR, 'outbox.json');
const PHONE_UID_FILE = path.join(DATA_DIR, 'phone_uid.json');
const UID_PHONE_FILE = path.join(DATA_DIR, 'uid_phone.json');

function ensureDir(){ if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR); }
function loadJSON(f){ try { return JSON.parse(fs.readFileSync(f,'utf8')); } catch { return []; } }
function saveJSON(f,d){ ensureDir(); fs.writeFileSync(f, JSON.stringify(d, null, 2)); }

// load at start
(function bootstrap(){
  loadJSON(OUTBOX_FILE).forEach(v => OUTBOX.set(v.msgId, v));
  loadJSON(PHONE_UID_FILE).forEach(([p,u]) => PHONE_UID.set(p,u));
  loadJSON(UID_PHONE_FILE).forEach(([u,p]) => UID_PHONE.set(u,p));
  console.log('🗃️ store loaded:', { outbox: OUTBOX.size, phone_uid: PHONE_UID.size, uid_phone: UID_PHONE.size });
})();

function persistOutbox(){ saveJSON(OUTBOX_FILE, Array.from(OUTBOX.values())); }
function persistPhoneUid(){
  saveJSON(PHONE_UID_FILE, Array.from(PHONE_UID.entries()));
  saveJSON(UID_PHONE_FILE, Array.from(UID_PHONE.entries()));
}

function putOutbox(msgId, meta){
  if(!msgId) return;
  const val = { ...meta, msgId, sentAt: Date.now() };
  OUTBOX.set(msgId, val);
  persistOutbox();
}
function getOutbox(msgId){ return msgId ? OUTBOX.get(msgId) : null; }
function listOutbox(){
  return Array.from(OUTBOX.values()).map(v => ({
    msg_id: v.msgId, phone_id: v.phone_id, template_id: v.template_id, campaign_id: v.campaign_id, sentAt: v.sentAt
  }));
}

function setUidForPhone(phone_id, uid){
  if (!phone_id || !uid) return;
  PHONE_UID.set(String(phone_id), String(uid));
  UID_PHONE.set(String(uid), String(phone_id));
  persistPhoneUid();
}
function getUidByPhone(phone_id){ return phone_id ? (PHONE_UID.get(String(phone_id)) || null) : null; }
function getPhoneByUid(uid){ return uid ? (UID_PHONE.get(String(uid)) || null) : null; }

// pending queue: push & pick nearest (default 120s)
function pushPending({ phone_id, template_id, campaign_id }){
  PENDING.push({ phone_id, template_id: template_id || null, campaign_id: campaign_id || null, at: Date.now() });
  if (PENDING.length > 200) PENDING.splice(0, PENDING.length - 200);
}
function pickPending({ windowMs = 120000 } = {}){
  const now = Date.now();
  for (let i = PENDING.length - 1; i >= 0; i--) {
    if (now - PENDING[i].at <= windowMs) return PENDING.splice(i, 1)[0];
  }
  return null;
}

module.exports = {
  putOutbox, getOutbox, listOutbox,
  setUidForPhone, getUidByPhone, getPhoneByUid,
  pushPending, pickPending
};
