const axios = require('axios');

async function sendToTelegram(data){
  const token = process.env.TELEGRAM_TOKEN;
  const chatIds = (process.env.CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!token || chatIds.length === 0) {
    console.warn('⚠️ TELEGRAM_TOKEN/CHAT_IDS missing; skip send');
    return;
  }
  const clean = Object.fromEntries(Object.entries(data).filter(([,v]) => v !== undefined));
  clean.source = clean.phone ? 'phone' : 'user_id';

  const msg = '📩 Zalo Webhook Data:\n' + JSON.stringify(clean, null, 2);
  const chunks = msg.match(/[\s\S]{1,4000}/g) || [msg];

  for (const chatId of chatIds) {
    for (const chunk of chunks) {
      try {
        await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: chatId, text: chunk });
      } catch (e) {
        console.error('❌ Telegram error:', e.response?.data || e.message);
      }
    }
  }
}
module.exports = { sendToTelegram };
