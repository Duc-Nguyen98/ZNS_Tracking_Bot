const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zns-store-test-'));
process.env.DATA_DIR = dataDir;
const store = require('../store');

test.after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('sent chuyển đơn điệu sang delivered và giữ delivery_time chính xác', () => {
  store.putOutbox('msg-1', {
    phone_id: '84393177289',
    template_id: '603674',
    campaign_id: 'postman-test',
    channel: 'zns',
    status: 'sent',
    sentAt: 1784737400000
  });

  const first = store.markDelivered('msg-1', {
    deliveredAt: 1784737462633,
    deliveryTimeRaw: '1784737462633',
    webhookEventAt: 1784737463000,
    app_id: '1743556593977626805',
    user_id_by_app: '3212390946636715297',
    channel: 'zns'
  });

  assert.equal(first.changed, true);
  assert.equal(first.duplicate, false);
  assert.equal(first.record.status, 'delivered');
  assert.equal(first.record.delivered_at, 1784737462633);
  assert.equal(first.record.read_confirmed, false);
  assert.equal(first.record.phone_id, '84393177289');
});

test('Webhook Retry cùng msg_id không tạo transition lần hai', () => {
  const duplicate = store.markDelivered('msg-1', {
    deliveredAt: 1784737469999,
    channel: 'zns'
  });

  assert.equal(duplicate.changed, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.record.delivered_at, 1784737462633);
});

test('delivery đến trước send mapping vẫn reconcile được mà không regress status', () => {
  store.markDelivered('msg-race', {
    deliveredAt: 1784737462633,
    channel: 'zns'
  });
  const reconciled = store.putOutbox('msg-race', {
    phone_id: '84393177289',
    template_id: '603674',
    channel: 'zns',
    status: 'sent'
  });

  assert.equal(reconciled.status, 'delivered');
  assert.equal(reconciled.phone_id, '84393177289');
  assert.equal(reconciled.delivered_at, 1784737462633);
});
