/**
 * ====================================================
 * utils/requestMeta.js
 * Tiny, dependency-free request metadata parser.
 * Used by Attendance Automation (Phase 4) to capture
 * IP / device / browser on clock-in.
 * ====================================================
 */
function parseUserAgent(ua = '') {
  const device = /Mobile|Android|iPhone/i.test(ua) ? 'Mobile' : /iPad|Tablet/i.test(ua) ? 'Tablet' : 'Desktop';
  let browser = 'Other';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  return { device, browser };
}

function getRequestMeta(req) {
  const ua = req.headers['user-agent'] || '';
  const { device, browser } = parseUserAgent(ua);
  const ip = (req.headers['x-forwarded-for'] || req.ip || req.connection?.remoteAddress || '')
    .split(',')[0].trim();
  return { ip, device, browser };
}

module.exports = { getRequestMeta };