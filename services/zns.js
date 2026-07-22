const axios = require('axios');
const { randomUUID } = require('crypto');
const { putOutbox } = require('../store');
const { normalizePhoneE164VN } = require('../utils/format');

const ZALO_ENDPOINT = 'https://business.openapi.zalo.me/message/template';

async function sendTemplateOne({ accessToken, phone, template_id, template_data, campaign_id, tracking_id }) {
  const phoneE164 = normalizePhoneE164VN(phone);
  const headers = { 'Content-Type': 'application/json', 'access_token': accessToken };
  const trackingId = tracking_id || randomUUID();
  const payload = {
    phone: phoneE164,
    template_id,
    template_data: template_data || {},
    tracking_id: trackingId
  };

  try {
    const res = await axios.post(ZALO_ENDPOINT, payload, { headers, timeout: 15000 });
    console.log('🛰️ Zalo send resp:', res?.data);

    // Bắt đủ mọi biến thể có thể gặp
    const msgId =
      res?.data?.data?.msg_id ||
      res?.data?.msg_id ||
      res?.data?.data?.message_id ||
      res?.data?.message_id || null;

    const errorCode = res?.data?.error ?? 0;
    if (!msgId || errorCode !== 0) {
      return { ok: false, phone_id: phoneE164, message_id: msgId, error: res?.data || { message: 'No msg_id' } };
    }

    // Lưu mapping chắc chắn msg_id -> số điện thoại ngay khi gửi thành công.
    putOutbox(msgId, {
      phone_id: phoneE164,
      template_id,
      campaign_id,
      channel: 'zns',
      tracking_id: trackingId,
      status: 'sent'
    });

    return {
      ok: true,
      status: 'sent',
      phone_id: phoneE164,
      message_id: msgId,
      tracking_id: trackingId
    };
  } catch (e) {
    return { ok: false, phone_id: phoneE164, error: e?.response?.data || e.message };
  }
}

async function sendTemplateBatch(items, { accessToken, template_id, campaign_id, concurrency = 3 }) {
  const queue = [...items];
  const results = [];
  async function worker() {
    while (queue.length) {
      const it = queue.shift();
      const r = await sendTemplateOne({
        accessToken,
        phone: it.phone,
        template_id,
        template_data: it.template_data || {},
        campaign_id,
        tracking_id: it.tracking_id || null
      });
      results.push({ ...r, phone: it.phone });
    }
  }
  await Promise.all(Array(Math.min(concurrency, items.length)).fill(0).map(worker));
  return results;
}

module.exports = { sendTemplateOne, sendTemplateBatch };
