// Small shared helpers: base58, validation, HTTP plumbing, rate limiting.

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MAP = Object.fromEntries([...ALPHABET].map((c, i) => [c, i]));

export function b58decode(s) {
  if (typeof s !== 'string' || !s.length) throw new Error('empty');
  const bytes = [0];
  for (const ch of s) {
    const v = MAP[ch];
    if (v === undefined) throw new Error('bad base58');
    let carry = v;
    for (let i = 0; i < bytes.length; i++) { carry += bytes[i] * 58; bytes[i] = carry & 0xff; carry >>= 8; }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (const ch of s) { if (ch === '1') bytes.push(0); else break; }
  return Buffer.from(bytes.reverse());
}

export function b58encode(buf) {
  const digits = [0];
  for (const byte of buf) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) { carry += digits[i] << 8; digits[i] = carry % 58; carry = (carry / 58) | 0; }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let out = '';
  for (const byte of buf) { if (byte === 0) out += '1'; else break; }
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return out;
}

/** A Solana address: base58 that decodes to exactly 32 bytes. */
export function isSolAddress(s) {
  if (typeof s !== 'string' || s.length < 32 || s.length > 44) return false;
  try { return b58decode(s).length === 32; } catch { return false; }
}

/** A Solana transaction signature: base58 that decodes to 64 bytes. */
export function isSolSignature(s) {
  if (typeof s !== 'string' || s.length < 64 || s.length > 90) return false;
  try { return b58decode(s).length === 64; } catch { return false; }
}

export const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const now = () => Math.floor(Date.now() / 1000);

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

export function readJson(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const ct = req.headers['content-type'] || '';
    if (!ct.includes('application/json')) return reject(new HttpError(415, 'Expected JSON'));
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? String(fwd).split(',')[0] : req.socket.remoteAddress || '').trim();
}

// Fixed-window rate limiter, in memory (fine for a single Railway instance).
const buckets = new Map();
export function rateLimit(key, max, windowSec) {
  const t = Date.now(), w = windowSec * 1000;
  const b = buckets.get(key);
  if (!b || t - b.start > w) { buckets.set(key, { start: t, count: 1 }); return; }
  if (++b.count > max) throw new HttpError(429, 'Too many requests. Please slow down and try again shortly.');
}
setInterval(() => { const t = Date.now(); for (const [k, b] of buckets) if (t - b.start > 3600_000) buckets.delete(k); }, 600_000).unref();
