# Cấu hình OAuth callback và webhook quản lý tin nhắn Zalo OA

## 1. Hai URL có chức năng khác nhau

Với domain/ngrok hiện tại, cấu hình hai URL riêng:

- **Official Account Callback Url (OAuth):**
  `https://<domain-public>/oauth/zalo/callback`
- **Webhook URL (nhận sự kiện):**
  `https://<domain-public>/zns/zalo-webhook`

Không dán `/zns/zalo-webhook` vào ô Official Account Callback Url. OAuth callback nhận
`code` một lần để đổi lấy OA Access Token; webhook nhận các POST event trong quá trình vận hành.

## 2. Biến môi trường

Chạy:

```bash
npm run zalo:pkce
```

Lệnh trả ba giá trị. Cấu hình `.env`:

```dotenv
ZALO_APP_ID=1743556593977626805
ZALO_APP_SECRET=<Application Secret Key>
ZALO_CODE_VERIFIER=<giá trị do npm run zalo:pkce sinh>
ZALO_OAUTH_STATE=<giá trị do npm run zalo:pkce sinh>
ADMIN_API_KEY=<một chuỗi bí mật dài>
```

Trên Zalo for Developers:

1. Dán `https://<domain-public>/oauth/zalo/callback` vào **Official Account Callback Url**.
2. Dán **Code Challenge** do script sinh vào ô Code Challenge.
3. Dán giá trị `ZALO_OAUTH_STATE` vào ô State.
4. Chọn các quyền API cần dùng, gồm **Quản lý trường thông tin người dùng**.
5. Chọn quyền webhook **Nhận sự kiện quản lý tin nhắn**.
6. Lưu rồi thực hiện lại quy trình OA cấp quyền cho ứng dụng.

Token đã tạo trước lúc bật quyền mới không tự có thêm quyền. Phải cấp quyền lại để callback nhận
authorization code mới. Lỗi `-212 App has not registered this api` là dấu hiệu App/token chưa có API
permission tương ứng.

## 3. Luồng OAuth được bổ sung

- `GET /oauth/zalo/callback`: kiểm tra `state`, đổi `code` + `code_verifier` lấy token và lưu token
  trong `.data/oa_tokens.json`.
- `GET /oauth/zalo/status`: chỉ trả metadata đã che token; dùng header `x-api-key`.
- `POST /oauth/zalo/refresh`: đổi refresh token lấy token mới; dùng header `x-api-key`.
- `/zns/send-batch` ưu tiên token gửi trong request, sau đó token OAuth đã lưu, cuối cùng mới dùng
  `ZALO_ACCESS_TOKEN` trong `.env`.

Ví dụ xem trạng thái token:

```bash
curl "http://localhost:3002/oauth/zalo/status" \
  -H "x-api-key: <ADMIN_API_KEY>"
```

Ví dụ refresh:

```bash
curl -X POST "http://localhost:3002/oauth/zalo/refresh" \
  -H "Content-Type: application/json" \
  -H "x-api-key: <ADMIN_API_KEY>" \
  -d '{}'
```

## 4. Luồng webhook quản lý tin nhắn

| Sự kiện | Phân loại | UID người dùng | Kết quả trong code |
|---|---|---|---|
| `user_send_*` | Người dùng gửi đến OA | `sender.id` | Lưu identity, gửi Telegram |
| `user_seen_message` | Người dùng đã xem tin OA | `sender.id` | Lưu identity, trạng thái `seen` |
| `user_received_message` không có `message.delivery_time` | Người dùng nhận tin OA | `sender.id` | Lưu identity, trạng thái `received` |
| `oa_send_*` | OA gửi cho người dùng | `recipient.id` | Lưu identity người nhận, trạng thái `oa_sent` |
| `user_received_message` có `message.delivery_time` | ZNS đến thiết bị | Không suy diễn UID từ SĐT/hash | Map `msg_id` với outbox ZNS |

Hai loại `user_received_message` dùng cùng tên nhưng payload và ý nghĩa khác nhau. Code phân biệt bằng
`message.delivery_time` và mapping `msg_id` ZNS đã lưu.

Webhook URL phải trả HTTP 200 nhanh. Dữ liệu được lưu trước, Telegram chạy qua queue; Webhook Retry
được khử trùng bằng event key.

## 5. Quyền quản lý trường thông tin người dùng

Đây là quyền cho các REST API gọi từ server, **không phải một loại webhook event**:

- Lấy danh sách/xem chi tiết trường thông tin: `GET /v3.0/oa/userfield/get`.
- Tạo trường: `POST /v3.0/oa/userfield/create`.
- Cập nhật trường: `POST /v3.0/oa/userfield/update`.
- Xóa trường: dùng API xóa trong tài liệu chính thức.

Code có các proxy nội bộ, đều yêu cầu header `x-api-key` khi đã cấu hình `ADMIN_API_KEY`:

- `GET /oa/user-fields`: lấy danh sách hoặc chi tiết; chuyển tiếp query string cho Zalo.
- `POST /oa/user-fields`: tạo mới; body giữ nguyên theo schema Zalo.
- `PUT /oa/user-fields`: cập nhật; server gọi upstream `POST /userfield/update`.
- `DELETE /oa/user-fields`: xóa; server gọi upstream `POST /userfield/delete`.

Các API này dùng OA Access Token được cấp qua `/oauth/zalo/callback`. `key` và `data_type` của trường
không thể đổi sau khi tạo; cập nhật phải gửi đầy đủ thông tin hiện có theo yêu cầu của Zalo.

## 6. Kiểm tra theo thứ tự

1. `GET https://<domain-public>/health` trả `ok`.
2. Chạy `npm run zalo:pkce`, cập nhật `.env`, Code Challenge và State.
3. Cấp quyền lại OA; trình duyệt được chuyển tới `/oauth/zalo/callback` và trả `ok: true`.
4. Kiểm tra `/oauth/zalo/status` có `configured: true`.
5. Cập nhật Webhook URL `/zns/zalo-webhook`, bật bốn nhóm sự kiện tin nhắn và nhấn **Test**.
6. Gửi tin thật, nhận, xem và trả lời; kiểm tra Terminal, Telegram và `/debug/identities`.

Lưu ý: URL ngrok miễn phí thay đổi thì phải cập nhật cả Callback URL và Webhook URL. Event
`user_seen_message` chỉ xuất hiện khi Zalo thực sự ghi nhận người dùng xem tin OA; server không thể tự
phát sinh một event “đã xem” hợp lệ thay người dùng.

## 7. Tài liệu chính thức

- OAuth OA: https://developers.zalo.me/docs/api/official-account-api/xac-thuc-va-uy-quyen/cach-2-xac-thuc-voi-cong-cu-api-explorer/phuong-thuc-lay-oa-access-token-su-dung-cong-cu-api-explorer-post-5004
- Tổng quan Webhook: https://developers.zalo.me/docs/official-account/webhook/tong-quan
- User gửi tin: https://developers.zalo.me/docs/official-account/webhook/tin-nhan/su-kien-nguoi-dung-gui-tin-nhan
- User đã xem: https://developers.zalo.me/docs/official-account/webhook/tin-nhan/su-kien-nguoi-dung-da-xem-tin-nhan-duoc-gui-tu-official-account
- User nhận tin OA: https://developers.zalo.me/docs/official-account/webhook/tin-nhan/su-kien-nguoi-dung-nhan-tin-nhan-tu-official-account
- OA gửi tin: https://developers.zalo.me/docs/official-account/webhook/tin-nhan/su-kien-official-account-gui-tin-nhan-cho-nguoi-dung
- Danh sách user field: https://developers.zalo.me/docs/official-account/quan-ly/quan-ly-truong-thong-tin-nguoi-dung/lay-danh-sach-truong-thong-tin
- Tạo user field: https://developers.zalo.me/docs/official-account/quan-ly/quan-ly-truong-thong-tin-nguoi-dung/tao-moi-truong-thong-tin-tuy-bien
- Cập nhật user field: https://developers.zalo.me/docs/official-account/quan-ly/quan-ly-truong-thong-tin-nguoi-dung/cap-nhat-truong-thong-tin
- Xóa user field: https://developers.zalo.me/docs/official-account/quan-ly/quan-ly-truong-thong-tin-nguoi-dung/xoa-truong-thong-tin-tuy-bien
