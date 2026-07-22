# Thu UID khi người dùng tương tác với OA sau khi nhận ZNS

## Luồng đã triển khai

```text
Gửi ZNS theo SĐT
  -> lưu msg_id -> SĐT
  -> user_received_message: xác nhận giao tới thiết bị
  -> người dùng nhắn OA (user_send_*) hoặc xem tin nhắn OA (user_seen_message)
  -> thu sender.id thành user_id và lưu user_id_by_app nếu payload có
  -> đối chiếu msg_id/quote msg_id với outbox
  -> liên kết UID <-> SĐT khi đối chiếu là duy nhất
  -> gửi kết quả sang Telegram
```

## Sự kiện cần bật trên Zalo Developer

- `user_send_text` — bắt buộc cho phản hồi văn bản.
- Các `user_send_*` khác nếu muốn thu UID từ hình ảnh, link, audio, file, v.v.
- `user_seen_message` — chỉ áp dụng cho tin nhắn OA mà Zalo phát sinh read receipt.
- `user_received_message` của ZNS — xác nhận ZNS đã tới thiết bị.

Webhook URL chính xác:

```text
https://<domain-ngrok>/zns/zalo-webhook
```

`App ID`, OA và ứng dụng nhận webhook phải được liên kết đúng với nhau thì payload mới có thể có `user_id_by_app`.

## Cấu hình `.env`

```dotenv
ZALO_APP_ID=1743556593977626805
CAPTURE_OA_IDENTITIES=true
FORWARD_OTHER_EVENTS=false
LOG_RAW_WEBHOOK=true
```

Sau khi xác minh xong có thể đổi `LOG_RAW_WEBHOOK=false`.

## Dữ liệu được lưu

- `.data/user_identities.json`: danh sách `user_id`, `user_id_by_app`, số điện thoại đã liên kết và nguồn liên kết.
- `.data/phone_uid.json`, `.data/uid_phone.json`: tra cứu nhanh hai chiều.
- `.data/outbox.json`: giữ trạng thái ZNS và thêm `oa_seen_at`, `user_replied_at`, `last_user_event` khi map được tin gốc.
- `.data/webhook_events.json`: chống Zalo Webhook Retry gửi trùng Telegram.

Không commit thư mục `.data/` lên GitHub.

## API kiểm tra

```text
GET /debug/identities
GET /debug/identities/<user_id-hoặc-user_id_by_app>
GET /debug/identities/by-phone/0393177289
GET /debug/outbox/<message_id>
```

Nếu đã cấu hình `ADMIN_API_KEY`, thêm header:

```text
x-api-key: <ADMIN_API_KEY>
```

## Khi nào tự liên kết được UID với SĐT

1. `user_seen_message.message.msg_ids[]` khớp đúng `msg_id` trong outbox; hoặc
2. webhook phản hồi có `reply_to_msg_id`/`quote_message.msg_id` khớp outbox; hoặc
3. UID đã được liên kết từ trước.

Tin nhắn `user_send_text` thông thường có `message.msg_id` của chính tin nhắn inbound, không phải `msg_id` của ZNS. Vì vậy nếu payload không tham chiếu tin gốc, hệ thống vẫn lưu UID và gửi Telegram nhưng để `identity_linked_to_phone=false`.

Liên kết thủ công có kiểm soát bằng:

```text
POST /zns/identity/link
```

Dùng file `curl/link_identity.example.txt` để import vào Postman.

## Ý nghĩa `user_seen_message`

Sự kiện này xác nhận người dùng đã xem một tin nhắn OA nằm trong `message.msg_ids[]`. Nó không được dùng để tự động kết luận ZNS gửi theo SĐT đã được đọc. Trong outbox ZNS, hệ thống vẫn giữ:

```json
{
  "read_status": "unavailable",
  "read_confirmed": false
}
```

## File Postman/cURL

- `curl/test_user_send_text.example.txt`
- `curl/test_user_seen_message.example.txt`
- `curl/link_identity.example.txt`

Các file chỉ chứa dữ liệu mẫu, không chứa Access Token hoặc Telegram Token.
