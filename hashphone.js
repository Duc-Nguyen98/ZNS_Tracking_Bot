const uid = '0393177289';

// Mã hóa base64 trước
const base64uid = Buffer.from(uid).toString('base64');  // 👉 MDk4NzY1NDMyMQ==

// Encode URI để an toàn trong URL (tránh lỗi với ký tự '=' hay '+')
const encodedUid = encodeURIComponent(base64uid);       // 👉 MDk4NzY1NDMyMQ%3D%3D

// Gắn vào đường dẫn
const link = `https://yourdomain.com/?uid=${encodedUid}`;

console.log(link);
// 👉 https://yourdomain.com/?uid=MDk4NzY1NDMyMQ%3D%3D
