// Sign-in with a Solana wallet: the server issues a one-time message, the wallet
// signs it, and the server checks the ed25519 signature. No passwords, no emails.
import crypto from 'node:crypto';
import { b58decode, isSolAddress, parseCookies, HttpError, now } from './util.js';

const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const NONCE_TTL = 300;               // 5 minutes to sign
const SESSION_TTL = 30 * 24 * 3600;  // 30 days
export const COOKIE = 'witness_session';

export function verifyEd25519(walletB58, message, signatureBytes) {
  const raw = b58decode(walletB58);
  if (raw.length !== 32 || signatureBytes.length !== 64) return false;
  const key = crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, raw]), format: 'der', type: 'spki' });
  return crypto.verify(null, Buffer.from(message, 'utf8'), key, signatureBytes);
}

export function signInMessage(domain, wallet, nonce, issuedAt) {
  return [
    `${domain} wants you to sign in to WITNESS with your Solana account:`,
    wallet,
    '',
    'Signing proves you own this wallet. It does not send a transaction or cost anything.',
    '',
    `Nonce: ${nonce}`,
    `Issued At: ${new Date(issuedAt * 1000).toISOString()}`,
  ].join('\n');
}

export function createNonce(db, wallet, domain) {
  if (!isSolAddress(wallet)) throw new HttpError(400, 'Invalid wallet address.');
  const nonce = crypto.randomBytes(16).toString('hex');
  const t = now();
  db.prepare('DELETE FROM nonces WHERE created_at < ?').run(t - NONCE_TTL);
  db.prepare('INSERT INTO nonces (nonce, wallet, created_at) VALUES (?, ?, ?)').run(nonce, wallet, t);
  return signInMessage(domain, wallet, nonce, t);
}

export function verifySignIn(db, { wallet, message, signature }) {
  if (!isSolAddress(wallet) || typeof message !== 'string' || typeof signature !== 'string') throw new HttpError(400, 'Bad sign-in request.');
  const nonce = (message.match(/^Nonce: ([0-9a-f]{32})$/m) || [])[1];
  const row = nonce && db.prepare('SELECT * FROM nonces WHERE nonce = ?').get(nonce);
  if (!row || row.wallet !== wallet || now() - row.created_at > NONCE_TTL) throw new HttpError(401, 'Sign-in request expired. Please try again.');
  if (!message.includes(`\n${wallet}\n`)) throw new HttpError(401, 'Message does not match wallet.');
  const sig = Buffer.from(signature, 'base64');
  if (!verifyEd25519(wallet, message, sig)) throw new HttpError(401, 'Signature check failed.');
  db.prepare('DELETE FROM nonces WHERE nonce = ?').run(nonce);

  const t = now();
  let user = db.prepare('SELECT * FROM users WHERE wallet = ?').get(wallet);
  if (!user) {
    let username = `anon_${wallet.slice(0, 6).toLowerCase()}`;
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) username += `_${crypto.randomBytes(2).toString('hex')}`;
    db.prepare('INSERT INTO users (wallet, username, created_at, last_seen) VALUES (?, ?, ?, ?)').run(wallet, username, t, t);
    user = db.prepare('SELECT * FROM users WHERE wallet = ?').get(wallet);
  }
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(t);
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, user.id, t + SESSION_TTL);
  return { user, token };
}

export function sessionCookie(token, secure, maxAge = SESSION_TTL) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

/** Returns the signed-in user or null. Also refreshes last_seen (used for "online"). */
export function currentUser(db, req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?`).get(token, now());
  if (row && now() - row.last_seen > 60) db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now(), row.id);
  return row || null;
}

export function logout(db, req) {
  const token = parseCookies(req)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}
