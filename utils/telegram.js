const axios = require('axios');

async function sendToTelegram(data) {
  const token = process.env.TELEGRAM_TOKEN;
  const chatIds = (process.env.CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!token || chatIds.length === 0) {
    throw new Error('TELEGRAM_TOKEN/CHAT_IDS missing');
  }

  const clean = Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined)
  );
  let title = '📩 Zalo Webhook Data:\n';
  if (clean.event_name === 'user_received_message') {
    title = clean.payload_variant === 'zns_delivery'
      ? '📬 ZNS đã tới thiết bị (chưa xác nhận đã đọc):\n'
      : '📥 Người dùng đã nhận tin nhắn OA — đã thu ID:\n';
  } else if (clean.event_name === 'user_seen_message') {
    title = '👀 Người dùng đã xem tin nhắn OA — đã thu ID:\n';
  } else if (String(clean.event_name || '').startsWith('user_send_')) {
    title = '👤 Người dùng nhắn cho OA — đã thu ID:\n';
  } else if (String(clean.event_name || '').startsWith('oa_send_')) {
    title = '📤 OA đã gửi tin nhắn cho người dùng — đã thu ID:\n';
  }
  const msg = title + JSON.stringify(clean, null, 2);
  const chunks = msg.match(/[\s\S]{1,4000}/g) || [msg];
  const failures = [];
  let sent = 0;

  for (const chatId of chatIds) {
    for (const chunk of chunks) {
      try {
        await axios.post(
          `https://api.telegram.org/bot${token}/sendMessage`,
          { chat_id: chatId, text: chunk },
          { timeout: 15000 }
        );
        sent += 1;
      } catch (error) {
        failures.push({
          chat_id: chatId,
          error: error?.response?.data?.description || error.message
        });
      }
    }
  }

  if (failures.length > 0) {
    const error = new Error(`Telegram failed for ${failures.length} request(s)`);
    error.failures = failures;
    throw error;
  }

  return { ok: true, sent };
}

module.exports = { sendToTelegram };
