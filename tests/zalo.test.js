const test = require('node:test');
const assert = require('node:assert/strict');

const { extractZaloData, getMessageIds } = require('../utils/zalo');

test('user_seen_message lấy đủ msg_ids và UID của user', () => {
  const body = {
    app_id: '1743556593977626805',
    user_id_by_app: '3212390946636715297',
    event_name: 'user_seen_message',
    timestamp: '1784737146753',
    sender: { id: '579745863508352884' },
    recipient: { id: '8885388564519420458' },
    message: { msg_ids: ['message-1', 'message-2'] }
  };

  const result = extractZaloData(body);
  assert.equal(result.status, 'seen');
  assert.equal(result.tracked_zns_event, true);
  assert.equal(result.user_id_by_app, '3212390946636715297');
  assert.deepEqual(result.msg_ids, ['message-1', 'message-2']);
  assert.equal(result.msg_id, 'message-1');
});

test('user_received_message lấy msg_id đơn và số điện thoại recipient', () => {
  const body = {
    event_name: 'user_received_message',
    timestamp: 1784737146,
    sender: { id: 'oa-id' },
    recipient: { id: '84902165865' },
    message: { msg_id: 'zns-message-1' }
  };

  const result = extractZaloData(body);
  assert.equal(result.status, 'delivered');
  assert.equal(result.phone, '84902165865');
  assert.deepEqual(getMessageIds(body), ['zns-message-1']);
  assert.match(result.timestamp, /\d{2}:\d{2}:\d{2} \d{2}\/\d{2}\/\d{4}/);
});

test('user_send_text vẫn giữ chi tiết để chuyển Telegram khi debug', () => {
  const result = extractZaloData({
    event_name: 'user_send_text',
    sender: { id: 'user-123' },
    recipient: { id: 'oa-456' },
    message: { text: 'Xin chào' }
  });

  assert.equal(result.tracked_zns_event, false);
  assert.equal(result.status, 'inbound_user_event');
  assert.equal(result.user_id_by_app, 'user-123');
  assert.equal(result.message_text, 'Xin chào');
});
