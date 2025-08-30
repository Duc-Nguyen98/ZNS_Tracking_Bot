const phoneNumber = "0393177289";
const encoded = Buffer.from(phoneNumber, 'utf8').toString('base64');  // Mã hóa chuỗi số thành base64
console.log("Encoded phone number:", encoded);  // Ví dụ kết quả: "MzozMzE3NzI4OQ=="
