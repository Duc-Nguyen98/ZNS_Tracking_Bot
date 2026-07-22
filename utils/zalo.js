const { formatTimestamp } = require('./format');

const ZNS_TRACKING_EVENTS = new Set([
  'user_received_message',
  'user_seen_message'
]);

function normalizeId(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

function getMessageIds(body = {}) {
  const ids = [
    body?.message?.msg_id,
    body?.message?.message_id,
    body?.msg_id,
    body?.message_id,
    ...(Array.isArray(body?.message?.msg_ids) ? body.message.msg_ids : [])
  ];

  return [...new Set(ids.map(normalizeId).filter(Boolean))];
}

function isZnsTrackingEvent(eventName) {
  return ZNS_TRACKING_EVENTS.has(String(eventName || ''));
}

function getStatus(eventName) {
  if (eventName === 'user_received_message') return 'delivered';
  if (eventName === 'user_seen_message') return 'seen';
  if (String(eventName || '').startsWith('user_send_')) return 'inbound_user_event';
  return 'other_event';
}

function extractZaloData(body = {}) {
  const eventName = body?.event_name || null;
  const senderId = normalizeId(body?.sender?.id);
  const recipientId = normalizeId(body?.recipient?.id);

  // Với event nhận ZNS, actor là recipient. Với event seen/user_send_*, actor là sender.
  const actorId = eventName === 'user_received_message'
    ? recipientId
    : (senderId || recipientId);
  const isPhone = /^84\d{8,11}$/.test(actorId || '');

  const uidByApp = normalizeId(
    body?.user_id_by_app ||
    body?.sender?.user_id_by_app ||
    body?.recipient?.user_id_by_app ||
    (!isPhone ? actorId : null)
  );
  const messageIds = getMessageIds(body);

  return {
    event_name: eventName,
    status: getStatus(eventName),
    tracked_zns_event: isZnsTrackingEvent(eventName),
    source: isPhone ? 'phone' : 'user_id',
    phone: isPhone ? actorId : null,
    user_id_by_app: uidByApp,
    msg_id: messageIds[0] || null,
    msg_ids: messageIds,
    receiver_device: body?.receiver_device || null,
    timestamp: body?.timestamp ? formatTimestamp(body.timestamp) : null,
    link_href: uidByApp ? `https://zalo.me/${uidByApp}` : null,
    message_text: body?.message?.text || null,
    _raw_sender_id: senderId,
    _raw_recipient_id: recipientId
  };
}

module.exports = {
  ZNS_TRACKING_EVENTS,
  extractZaloData,
  getMessageIds,
  isZnsTrackingEvent
};
