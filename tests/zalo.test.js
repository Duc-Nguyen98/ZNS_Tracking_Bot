const test = require('node:test');
const assert = require('node:assert/strict');

const { extractZaloData, getMessageIds } = require('../utils/zalo');

test('ZNS user_received_message lấy delivery_time và số điện thoại recipient', () => {
  const body = {
    app_id: '1743556593977626805',
    event_name: 'user_received_message',
    timestamp: '1784737463000',
    recipient: { id: '84393177289' },
    message: {
      msg_id: 'zns-message-1',
      delivery_time: '1784737462633',
      tracking_id: 'tracking-001'
    }
  };

  const result = extractZaloData(body);
  assert.equal(result.tracked_zns_event, true);
  assert.equal(result.payload_variant, 'zns_delivery');
  assert.equal(result.status, 'delivered');
  assert.equal(result.status_label, 'Đã nhận trên thiết bị');
  assert.equal(result.read_status, 'unavailable');
  assert.equal(result.read_confirmed, false);
  assert.equal(result.recipient_phone, '84393177289');
  assert.equal(result.delivery_time_ms, 1784737462633);
  assert.equal(result.tracking_id, 'tracking-001');
  assert.deepEqual(getMessageIds(body), ['zns-message-1']);
});

test('payload nút Test không có delivery_time không tự nhận là ZNS thật', () => {
  const body = {
    app_id: '1743556593977626805',
    user_id_by_app: '3212390946636715297',
    event_name: 'user_received_message',
    timestamp: '1784737462633',
    sender: { id: '579745863508352884' },
    recipient: { id: '8885388564519420458' },
    message: { msg_id: 'This is message id' }
  };

  const result = extractZaloData(body);
  assert.equal(result.event_name_supported, true);
  assert.equal(result.tracked_zns_event, false);
  assert.equal(result.payload_variant, 'generic_message_delivery');
  assert.equal(result.user_id_by_app, '3212390946636715297');
  assert.equal(result.delivery_time_ms, null);
});

test('user_seen_message thuộc OA Messaging, không phải ZNS tracking', () => {
  const result = extractZaloData({
    event_name: 'user_seen_message',
    message: { msg_ids: ['oa-message-1'] }
  });

  assert.equal(result.event_name_supported, false);
  assert.equal(result.tracked_zns_event, false);
  assert.equal(result.event_scope, 'oa_messaging');
  assert.equal(result.status, 'seen');
});

test('recipient SHA-256 không bị hiểu nhầm thành UID hoặc số điện thoại', () => {
  const phoneHash = 'a'.repeat(64);
  const result = extractZaloData({
    event_name: 'user_received_message',
    recipient: { id: phoneHash },
    message: { msg_id: 'zns-hash-1', delivery_time: '1784737462633' }
  });

  assert.equal(result.recipient_phone, null);
  assert.equal(result.recipient_phone_hash, phoneHash);
  assert.equal(result.user_id_by_app, null);
});
