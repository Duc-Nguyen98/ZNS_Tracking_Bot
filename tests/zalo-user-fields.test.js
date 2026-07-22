const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const {
  listUserFields,
  createUserField,
  updateUserField,
  deleteUserField
} = require('../services/zalo-user-fields');

test('proxy user field dùng đúng endpoint và access_token header', async t => {
  const originalGet = axios.get;
  const originalPost = axios.post;
  const calls = [];
  t.after(() => {
    axios.get = originalGet;
    axios.post = originalPost;
  });

  axios.get = async (url, config) => {
    calls.push({ method: 'GET', url, config });
    return { data: { error: 0, data: [{ key: 'customer_code' }] } };
  };
  axios.post = async (url, body, config) => {
    calls.push({ method: 'POST', url, body, config });
    return { data: { error: 0, data: { ok: true } } };
  };

  await listUserFields('oa-token', { data: '{"fields_to_get":["customer_code"]}' });
  await createUserField('oa-token', { key: 'customer_code' });
  await updateUserField('oa-token', { key: 'customer_code', title: 'Mã KH' });
  await deleteUserField('oa-token', { key: 'customer_code' });

  assert.match(calls[0].url, /\/userfield\/get$/);
  assert.equal(calls[0].config.headers.access_token, 'oa-token');
  assert.match(calls[1].url, /\/userfield\/create$/);
  assert.match(calls[2].url, /\/userfield\/update$/);
  assert.match(calls[3].url, /\/userfield\/delete$/);
});

test('proxy user field giữ nguyên mã lỗi Zalo', async t => {
  const originalGet = axios.get;
  t.after(() => { axios.get = originalGet; });
  axios.get = async () => ({ data: { error: -212, message: 'App has not registered this api' } });

  await assert.rejects(
    () => listUserFields('old-token'),
    error => error.code === -212 && /registered/.test(error.message)
  );
});
