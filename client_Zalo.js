// server.js
const express = require('express');
const app = express();
const port = 3000;
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

app.use(express.json()); // Bắt buộc để đọc JSON body

const followers = [];

app.post('/zalo-webhook', (req, res) => {
  const { event_name, follower } = req.body;
  console.log(req.body)
  console.log('ZNS')

  if (event_name === 'follow' && follower?.id) {
    console.log('✅ New follower ID:', follower.id);
    followers.push({ id: follower.id, timestamp: Date.now() });
  }

  res.status(200).send('OK');
});



app.post('/user_seen_message', (req, res) => {
  const body = req.body;

  if (body.event_name === 'user_seen_message') {
    const uid = body.recipient?.id;
    const messageIds = body.message?.msg_ids;

    console.log('👀 Người dùng đã đọc tin nhắn:', {
      uid,
      messageIds,
      timestamp: body.timestamp
    });

    // Ghi log ra file/db hoặc xử lý theo ý muốn
  }

  res.status(200).send('OK');
});



app.listen(port, () => {
  console.log(`✅ Server chạy tại http://localhost:${port}`);
});
