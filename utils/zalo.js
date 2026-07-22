const { formatTimestamp, normalizeTimestampMs } = require('./format');

const ZNS_RECEIVED_EVENT = 'user_received_message';

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

function isZnsReceivedEvent(eventName) {
  return String(eventName || '') === ZNS_RECEIVED_EVENT;
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || ''));
}

function isVietnamPhone(value) {
  return /^84\d{8,11}$/.test(String(value || ''));
}

function getEventSemantics(eventName) {
  if (eventName === ZNS_RECEIVED_EVENT) {
    return {
      event_scope: 'zns',
      status: 'delivered',
      status_label: 'Đã nhận trên thiết bị',
      read_status: 'unavailable',
      read_confirmed: false,
      clicked_status: 'unavailable_without_user_action'
    };
  }

  if (eventName === 'user_seen_message') {
    return {
      event_scope: 'oa_messaging',
      status: 'seen',
      status_label: 'Đã xem tin nhắn OA',
      read_status: 'seen',
      read_confirmed: true,
      clicked_status: 'unknown'
    };
  }

  if (String(eventName || '').startsWith('user_send_')) {
    return {
      event_scope: 'oa_messaging',
      status: 'inbound_user_event',
      status_label: 'Người dùng tương tác với OA',
      read_status: 'unknown',
      read_confirmed: false,
      clicked_status: 'unknown'
    };
  }

  return {
    event_scope: 'other',
    status: 'other_event',
    status_label: 'Sự kiện khác',
    read_status: 'unknown',
    read_confirmed: false,
    clicked_status: 'unknown'
  };
}

function extractZaloData(body = {}) {
  const eventName = normalizeId(body?.event_name);
  const senderId = normalizeId(body?.sender?.id);
  const recipientId = normalizeId(body?.recipient?.id);
  const userId = normalizeId(body?.user_id);
  const userIdByApp = normalizeId(
    body?.user_id_by_app ||
    body?.sender?.user_id_by_app ||
    body?.recipient?.user_id_by_app
  );
  const messageIds = getMessageIds(body);
  const semantics = getEventSemantics(eventName);
  const deliveryTimeRaw = body?.message?.delivery_time ?? null;
  const trackingId = normalizeId(body?.message?.tracking_id || body?.tracking_id);
  const recipientPhone = isVietnamPhone(recipientId) ? recipientId : null;
  const recipientPhoneHash = isSha256(recipientId) ? recipientId : null;
  const payloadVariant = eventName !== ZNS_RECEIVED_EVENT
    ? 'other_event'
    : (deliveryTimeRaw !== null ? 'zns_delivery' : 'generic_message_delivery');

  return {
    app_id: normalizeId(body?.app_id),
    event_name: eventName,
    tracked_zns_event: payloadVariant === 'zns_delivery',
    event_name_supported: isZnsReceivedEvent(eventName),
    payload_variant: payloadVariant,
    ...semantics,
    user_id: userId,
    user_id_by_app: userIdByApp,
    sender_id: senderId,
    recipient_id: recipientId,
    recipient_phone: recipientPhone,
    recipient_phone_hash: recipientPhoneHash,
    msg_id: messageIds[0] || null,
    msg_ids: messageIds,
    receiver_device: body?.receiver_device || null,
    tracking_id: trackingId,
    delivery_time_raw: deliveryTimeRaw,
    delivery_time_ms: normalizeTimestampMs(deliveryTimeRaw),
    timestamp_ms: normalizeTimestampMs(body?.timestamp),
    timestamp: body?.timestamp ? formatTimestamp(body.timestamp) : null,
    message_text: body?.message?.text || null,
    read_warning: eventName === ZNS_RECEIVED_EVENT
      ? 'Đây là bằng chứng ZNS đã tới thiết bị, không phải bằng chứng người dùng đã mở hoặc đọc.'
      : null
  };
}

module.exports = {
  ZNS_RECEIVED_EVENT,
  extractZaloData,
  getEventSemantics,
  getMessageIds,
  isZnsReceivedEvent,
  isSha256,
  isVietnamPhone
};
