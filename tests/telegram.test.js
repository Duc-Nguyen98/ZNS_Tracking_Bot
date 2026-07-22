const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const { sendToTelegram } = require('../utils/telegram');

test('sendToTelegram báo thành công khi Telegram nhận dữ liệu', async t => {
  const originalPost = axios.post;
  const oldToken = process.env.TELEGRAM_TOKEN;
  const oldChatIds = process.env.CHAT_IDS;
  t.after(() => {
    axios.post = originalPost;
    process.env.TELEGRAM_TOKEN = oldToken;
    process.env.CHAT_IDS = oldChatIds;
  });

  process.env.TELEGRAM_TOKEN = 'test-token';
  process.env.CHAT_IDS = '123';
  axios.post = async () => ({ data: { ok: true } });

  const result = await sendToTelegram({ event_name: 'user_seen_message' });
  assert.deepEqual(result, { ok: true, sent: 1 });
});

test('sendToTelegram throw lỗi để queue có thể retry', async t => {
  const originalPost = axios.post;
  const oldToken = process.env.TELEGRAM_TOKEN;
  const oldChatIds = process.env.CHAT_IDS;
  t.after(() => {
    axios.post = originalPost;
    process.env.TELEGRAM_TOKEN = oldToken;
    process.env.CHAT_IDS = oldChatIds;
  });

  process.env.TELEGRAM_TOKEN = 'test-token';
  process.env.CHAT_IDS = '123';
  axios.post = async () => {
    const error = new Error('Bad Request');
    error.response = { data: { description: 'chat not found' } };
    throw error;
  };

  await assert.rejects(
    () => sendToTelegram({ event_name: 'user_seen_message' }),
    /Telegram failed/
  );
});
