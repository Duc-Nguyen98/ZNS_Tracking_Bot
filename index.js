const express = require('express');
const axios = require('axios');
const UAParser = require('ua-parser-js');

const app = express();
const PORT = 3000;
require('dotenv').config();

app.set('view engine', 'ejs');
app.set('views', __dirname + '/views'); // thư mục chứa file .ejs
app.use(express.static('public'));


// Token Telegram & danh sách chat_id
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_IDS = (process.env.CHAT_IDS || '').split(',').map(id => id.trim());

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
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'] || '';
  const referer = req.headers['referer'] || '';
  const time = new Date().toISOString();

  const uid = req.query.uid || 'unknown';
  const isBot = /bot|facebook|zalo|telegram|twitter|preview|crawl|spider/i.test(userAgent);


  // 📤 Gửi thông tin về Telegram
  const message = `
📡 *ZNS Link Preview Detected*
🧠 Bot: ${isBot ? '✅' : '❌'}
👤 UID: ${uid}
🌐 IP: ${ip}
🕒 Time: ${time}
🔍 User-Agent: ${userAgent}
🔗 Referer: ${referer || 'Không có'}
`;
  console.log('User-Agent:', userAgent);


  for (const chatId of CHAT_IDS) {
    try {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown'
      });
      console.log(`✅ Đã gửi thông tin preview đến ${chatId}`);
    } catch (err) {
      console.error(`❌ Gửi lỗi: ${chatId}`, err.message);
    }
  }

  // Trả về ảnh rỗng (tracking pixel)
  const img = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/P7vT3QAAAABJRU5ErkJggg==',
    'base64'
  );
  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': img.length,
  });
  res.end(img);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
});


// https://api.telegram.org/bot7903084653:AAFzYR7ZWNK7Zq_elua_tB1fksolyTtzoK8/getUpdates