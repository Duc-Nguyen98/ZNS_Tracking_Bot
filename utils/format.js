function pad(n){ return n < 10 ? '0'+n : ''+n; }
function formatTimestamp(ts){
  const d = new Date(Number(ts)); // epoch ms
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
