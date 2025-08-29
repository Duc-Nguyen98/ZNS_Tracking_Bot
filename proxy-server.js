const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post('/proxy/telegram', async (req, res) => {
  let body = req.body;

  // Nếu req.body là chuỗi JSON, parse nó lại
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON format' });
    }
  }

  const { token, chat_id, text, parse_mode } = body;

  if (!token || !chat_id || !text) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const response = await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id,
      text,
      parse_mode: parse_mode || 'Markdown'
    });
    res.json({ ok: true, result: response.data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = 8888;
app.listen(PORT, () => {
  console.log(`🚀 Proxy Telegram đang chạy tại http://localhost:${PORT}`);
});
