function pad(n){ return n < 10 ? '0'+n : ''+n; }
function formatTimestamp(ts){
  const raw = Number(ts);
  // Zalo có thể trả epoch theo giây (10 chữ số) hoặc millisecond (13 chữ số).
  const epochMs = Number.isFinite(raw) && raw < 1e12 ? raw * 1000 : raw;
  const d = new Date(epochMs);
  if (Number.isNaN(d.getTime())) return null;
  const hh = pad(d.getHours()), mm = pad(d.getMinutes()), ss = pad(d.getSeconds());
  const dd = pad(d.getDate()), mon = pad(d.getMonth()+1), yyyy = d.getFullYear();
  return `${hh}:${mm}:${ss} ${dd}/${mon}/${yyyy}`;
}
function normalizePhoneE164VN(input){
  if (!input) return null;
  let s = String(input).trim().replace(/[^\d]/g,'');
  if (s.startsWith('0')) s = '84' + s.slice(1);
  if (!s.startsWith('84')) s = '84' + s;
  return s;
}
module.exports = { formatTimestamp, normalizePhoneE164VN };
