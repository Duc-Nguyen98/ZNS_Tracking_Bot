const express = require('express');
const axios = require('axios');
const UAParser = require('ua-parser-js'); // Đã thay thế useragent

const app = express();
const PORT = 3000;

app.get('/', (req, res) => {
    res.send(`
    <html>
      <head><title>Check Location</title></head>
      <body>
        <h2>Đang xác định vị trí thiết bị của bạn...</h2>
        <div id="output">Vui lòng chờ...</div>
        <script>
          navigator.geolocation.getCurrentPosition(
            (position) => {
              const lat = position.coords.latitude;
              const lon = position.coords.longitude;

              // Gửi tọa độ lên server
              fetch('/location', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lat, lon })
              })
              .then(res => res.text())
              .then(data => document.getElementById('output').innerHTML = '<pre>' + data + '</pre>')
              .catch(err => document.getElementById('output').innerText = 'Lỗi gửi tọa độ: ' + err);
            },
            (err) => {
              document.getElementById('output').innerText = 'Lỗi định vị: ' + err.message;
            }
          );
        </script>
      </body>
    </html>
    `);
});

app.use(express.json()); // Cho phép xử lý JSON body từ client

app.post('/location', async (req, res) => {
    const port = req.socket.remotePort;
    const time = new Date().toISOString().replace('T', ' ').split('.')[0];
    const { lat, lon } = req.body;

    // Lấy User-Agent để phân tích thiết bị
    const parser = new UAParser(req.headers['user-agent']);
    const device = parser.getDevice();
    const phone = device.model ? `${device.vendor || ''} ${device.model}`.trim() : 'PC / Laptop';

    try {
        // Gọi API reverse geocoding để lấy thông tin địa lý từ lat/lon
        const geo = await axios.get(`https://nominatim.openstreetmap.org/reverse`, {
            params: {
                lat,
                lon,
                format: 'json'
            },
            headers: { 'User-Agent': 'Node.js App' }
        });

        const address = geo.data.address || {};
        const city = address.city || address.town || address.village || 'Unknown';
        const country = address.country || 'Unknown';
        const zip = address.postcode || 'Unknown';

        const output = `
Latitude: ${lat} - Longitude: ${lon}
Port: ${port}
Phone: ${phone}
City: ${city} - Country: ${country} - Zip Code: ${zip}
Time: ${time}
        `.trim();

        res.send(output);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Lỗi khi truy xuất vị trí từ tọa độ');
    }
});
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server đang chạy tại http://localhost:${PORT}`);
}); 


// code này là lấy chính xác 99.9% vị trí của người dùng