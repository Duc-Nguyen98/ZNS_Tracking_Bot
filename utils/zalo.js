const { formatTimestamp } = require('./format');

function extractZaloData(body){
  const recipientId = body?.recipient?.id || "";
  const isPhone = /^84\d{8,11}$/.test(recipientId);

  const uidByApp =
    body.user_id_by_app ||
    (!isPhone && recipientId) ||
    body?.recipient?.user_id_by_app ||
    body?.sender?.user_id_by_app ||
    null;

  return {
    source: isPhone ? 'phone' : 'user_id',
    phone: isPhone ? recipientId : null,
    user_id_by_app: uidByApp,
    receiver_device: body.receiver_device || null,
    timestamp: body.timestamp ? formatTimestamp(body.timestamp) : null,
    link_href: uidByApp ? `https://zalo.me/${uidByApp}` : null,

    _raw_recipient_id: recipientId || null,
    _raw_sender_id: body?.sender?.id || null
  };
}
module.exports = { extractZaloData };
