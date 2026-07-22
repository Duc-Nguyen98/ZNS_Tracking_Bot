# Cấu hình luồng `user_received_message` cho ZNS

## 1. Trạng thái nghiệp vụ đúng

Luồng được cấu hình lại như sau:

```text
POST /zns/send-batch
        │
        ├─ Gửi kèm tracking_id và Zalo trả msg_id
        │
        ├─ Lưu: msg_id → phone/template/campaign, status=sent
        │
        └─ Zalo webhook user_received_message
                    │
                    ├─ Xác định ZNS bằng msg_id đã lưu hoặc message.delivery_time
                    ├─ status: sent → delivered
                    ├─ delivered_at lấy từ message.delivery_time
                    ├─ chống Webhook Retry gửi trùng Telegram
                    └─ Telegram: “Đã tới thiết bị — chưa xác nhận đã đọc”
```

Ý nghĩa trạng thái:

| Trường | Giá trị | Ý nghĩa |
| --- | --- | --- |
| `status` | `sent` | Zalo API đã nhận yêu cầu gửi và trả `msg_id` |
| `status` | `delivered` | ZNS đã tới thiết bị theo `user_received_message` |
| `read_status` | `unavailable` | ZNS không cung cấp bằng chứng mở/đọc trong event này |
| `read_confirmed` | `false` | Không được coi delivery là read |
| `clicked_status` | `unavailable_without_user_action` | Không có click nếu người dùng chưa bấm CTA |

Tài liệu Zalo yêu cầu thời gian giao nhận phải lấy từ `message.delivery_time`, không lấy từ `timestamp` của webhook: <https://developers.zalo.me/docs/zalo-notification-service/webhook/su-kien-nguoi-dung-nhan-thong-bao-zns>

## 2. Vì sao payload nút Test khác ZNS thật

Payload trong cửa sổ Test:

```json
{
  "event_name": "user_received_message",
  "message": { "msg_id": "This is message id" }
}
```

chỉ kiểm tra đường truyền webhook. `msg_id` này không tồn tại trong outbox và payload không có `message.delivery_time`, nên code gắn loại `generic_message_delivery` và không cập nhật một ZNS thật.

Code chỉ coi là delivery ZNS khi thỏa ít nhất một điều kiện:

1. `msg_id` map được record ZNS đã lưu lúc gửi; hoặc
2. payload có `message.delivery_time` theo cấu trúc webhook ZNS.

Không sử dụng fallback “số điện thoại gửi gần nhất”, vì batch/concurrent có thể gán nhầm người.

## 3. Không thể tự active clicked/read khi chỉ mở hội thoại

Ứng dụng Zalo native không chạy JavaScript hay URL thuộc server của bạn khi người dùng chỉ mở hội thoại. Zalo cũng không cung cấp webhook ZNS “conversation opened”. Vì vậy server không nhận được tín hiệu để tự tạo `clicked` hoặc xác nhận `read`.

Không nên đổi `user_received_message` thành `clicked`/`read`, vì việc đó làm sai báo cáo.

Lựa chọn đúng:

- Zero-action: hiển thị **Đã nhận trên thiết bị** từ `user_received_message`.
- Read thật: không khả dụng với ZNS hiện tại.
- Engagement thật: CTA dẫn qua redirect URL của bạn; khi trang được mở sau một lần bấm thì lưu `clicked_at`.
- Nếu nội bộ bắt buộc dùng proxy, đặt tên **Giả định đã đọc từ delivery**, kèm `read_confirmed=false`; không gọi là click/read xác nhận.

## 4. File cần cập nhật

Chép đè:

- `main.js`
- `store.js`
- `services/zns.js`
- `utils/zalo.js`
- `utils/format.js`
- `utils/telegram.js`
- `.env.example`
- `package.json`

Thêm mới/cập nhật test:

- `tests/zalo.test.js`
- `tests/store.test.js`
- `tests/telegram.test.js`

Không chép đè `.env` hiện tại. Bổ sung:

```dotenv
ZALO_APP_ID=1743556593977626805
FORWARD_OTHER_EVENTS=false
TELEGRAM_MAX_RETRIES=3
LOG_RAW_WEBHOOK=false
```

`ZALO_APP_ID` giúp bỏ qua event từ ứng dụng khác. Khi cần kiểm tra payload giả lập của dashboard, tạm đặt `FORWARD_OTHER_EVENTS=true`; production nên để `false`.

## 5. Cấu hình Zalo Developer

Webhook URL phải là:

```text
https://<ngrok-domain>/zns/zalo-webhook
```

Yêu cầu:

- ngrok forward đúng `localhost:3002`;
- bật **Sự kiện người dùng nhận thông báo ZNS**;
- App `VIEBOOK1` phải liên kết đúng OA/template dùng để gửi;
- Access token gửi ZNS phải thuộc đúng app/OA;
- Webhook phải trả HTTP 200 sau khi persist trạng thái.

## 6. Kiểm tra sau khi cập nhật

```powershell
npm install
npm test
npm start
```

Gửi ZNS qua Postman. Sau khi nhận webhook thật, kiểm tra bằng `message_id` trả về từ API:

```text
GET http://localhost:3002/debug/outbox/<message_id>
```

Nếu có `ADMIN_API_KEY`, thêm header:

```text
x-api-key: <ADMIN_API_KEY>
```

Kết quả đúng:

```json
{
  "ok": true,
  "record": {
    "status": "delivered",
    "delivered_at": 1784737462633,
    "read_status": "unavailable",
    "read_confirmed": false
  }
}
```

Telegram chỉ gửi một lần dù Zalo Webhook Retry gửi lại cùng `msg_id`.

File `curl/test_user_received_message.example.txt` dùng để replay cục bộ. Thay `REPLACE_WITH_REAL_MESSAGE_ID` bằng `message_id` vừa nhận từ `/zns/send-batch`; không dùng chuỗi mẫu `This is message id`.

## 7. Kết quả kiểm thử của gói

- Kiểm tra cú pháp Node: PASS.
- Unit test parser/store/Telegram: `9/9` PASS.
- E2E local: đăng ký outbox → nhận webhook → `status=delivered` → giữ đúng `delivery_time` → retry lần hai bị deduplicate: PASS.

## 8. Các giới hạn còn lại

- Telegram queue vẫn nằm trong RAM; production nên chuyển sang Redis/BullMQ hoặc DB queue.
- JSON store phù hợp chạy một instance; multi-instance nên dùng SQLite/PostgreSQL.
- Cần bổ sung xác minh chữ ký webhook theo OA Secret Key trước khi public production.
- Access token phải nằm trong `.env`, không commit vào curl/GitHub; token đã từng lộ cần được rotate.
