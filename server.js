// WITNESS — web server and API. Node 22.13+, zero npm dependencies.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDb } from './lib/db.js';
import {
  HttpError, sendJson, readJson, str, now, clientIp, rateLimit, isSolAddress, isSolSignature,
} from './lib/util.js';
import { createNonce, verifySignIn, sessionCookie, currentUser, logout } from './lib/auth.js';
import { statusOf, computeReputation, RULES } from './lib/scoring.js';
import * as sol from './lib/solana.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// ---------- config ----------
try { // minimal .env loader for local runs (Railway sets real env vars)
  for (const line of readFileSync(path.join(here, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env */ }

const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DATABASE_PATH || (process.env.RAILWAY_VOLUME_MOUNT_PATH ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'witness.db') : path.join(here, 'data', 'witness.db'));
const db = openDb(DB_PATH);

const CATEGORIES = ['Token launch', 'Fund movement', 'Wallet cluster', 'Liquidity event', 'Attribution', 'Contract change', 'Other'];
const PERIODS = { week: 7 * 86400, month: 30 * 86400, all: 0 };

// ---------- shared queries ----------
const invSelect = `
  SELECT i.*, u.username AS author, u.wallet AS author_wallet,
    (SELECT COUNT(*) FROM reviews r WHERE r.investigation_id = i.id AND r.verdict = 'confirm') AS confirms,
    (SELECT COUNT(*) FROM reviews r WHERE r.investigation_id = i.id AND r.verdict = 'challenge') AS challenges,
    (SELECT COUNT(*) FROM evidence e WHERE e.investigation_id = i.id) AS evidence_count,
    (SELECT COUNT(*) FROM (
       SELECT i.author_id AS uid UNION SELECT user_id FROM evidence WHERE investigation_id = i.id
       UNION SELECT user_id FROM reviews WHERE investigation_id = i.id)) AS contributors
  FROM investigations i JOIN users u ON u.id = i.author_id`;

function shapeInv(r) {
  return {
    id: r.id, title: r.title, wallet: r.wallet, chain: r.chain, category: r.category,
    author: r.author, createdAt: r.created_at,
    confirms: r.confirms, challenges: r.challenges, evidenceCount: r.evidence_count, contributors: r.contributors,
    status: statusOf(r.confirms, r.challenges),
  };
}

function publicUser(u) {
  return u ? { id: u.id, username: u.username, wallet: u.wallet, bio: u.bio, createdAt: u.created_at } : null;
}

function requireUser(req) {
  const u = currentUser(db, req);
  if (!u) throw new HttpError(401, 'Connect your wallet and sign in first.');
  return u;
}

function parseSignatures(input) {
  const list = (Array.isArray(input) ? input : String(input || '').split(/[\s,]+/))
    .map((s) => String(s).trim()).filter(Boolean)
    .map((s) => s.replace(/^https?:\/\/(?:solscan\.io|explorer\.solana\.com|solana\.fm)\/tx\//, '').split(/[?#]/)[0]);
  const unique = [...new Set(list)];
  const bad = unique.filter((s) => !isSolSignature(s));
  if (bad.length) throw new HttpError(400, `Not a valid Solana transaction signature: ${bad[0].slice(0, 24)}…`);
  return unique;
}

const checking = new Set();
async function checkEvidence(rows, wallet) {
  for (const e of rows) {
    if (checking.has(e.id)) continue;
    checking.add(e.id);
    try {
      const v = await sol.verifySignature(e.signature, wallet);
      if (v) db.prepare('UPDATE evidence SET onchain_ok = ?, involves_wallet = ?, block_time = ? WHERE id = ?')
        .run(v.ok ? 1 : 0, v.involves ? 1 : 0, v.blockTime, e.id);
    } catch (err) { console.warn('evidence check failed', e.signature, err.message); }
    finally { checking.delete(e.id); }
  }
}

// ---------- API handlers ----------
const api = {
  'GET /api/health': () => ({ ok: true, explore: sol.heliusReady(), launch: sol.pinataReady() && sol.rpcReady() }),

  // auth
  'POST /api/auth/nonce': async (req) => {
    rateLimit(`nonce:${clientIp(req)}`, 20, 60);
    const b = await readJson(req);
    return { message: createNonce(db, str(b.wallet, 64), req.headers.host || 'witness') };
  },
  'POST /api/auth/verify': async (req, res) => {
    rateLimit(`verify:${clientIp(req)}`, 20, 60);
    const b = await readJson(req);
    const { user, token } = verifySignIn(db, b);
    const secure = req.headers['x-forwarded-proto'] === 'https';
    return [{ user: publicUser(user) }, { 'Set-Cookie': sessionCookie(token, secure) }];
  },
  'POST /api/auth/logout': (req) => {
    logout(db, req);
    return [{ ok: true }, { 'Set-Cookie': sessionCookie('', false, 0) }];
  },
  'GET /api/me': (req) => ({ user: publicUser(currentUser(db, req)) }),
  'PATCH /api/me': async (req) => {
    const u = requireUser(req);
    const b = await readJson(req);
    const username = str(b.username, 20).toLowerCase();
    const bio = str(b.bio, 200);
    if (!/^[a-z0-9_]{3,20}$/.test(username)) throw new HttpError(400, 'Username must be 3–20 characters: letters, numbers or underscores.');
    const taken = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, u.id);
    if (taken) throw new HttpError(409, 'That username is taken.');
    db.prepare('UPDATE users SET username = ?, bio = ? WHERE id = ?').run(username, bio, u.id);
    return { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) };
  },

  // stats
  'GET /api/stats': () => {
    const rows = db.prepare(invSelect).all().map(shapeInv);
    return {
      activeInvestigations: rows.filter((r) => r.status === 'open' || r.status === 'under_review').length,
      verifiedDiscoveries: rows.filter((r) => r.status === 'verified').length,
      investigatorsOnline: db.prepare('SELECT COUNT(*) AS n FROM users WHERE last_seen > ?').get(now() - 900).n,
      investigators: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
      trackedWallets: db.prepare('SELECT COUNT(*) AS n FROM (SELECT wallet FROM investigations UNION SELECT wallet FROM watchlist)').get().n,
      launches: db.prepare('SELECT COUNT(*) AS n FROM launches').get().n,
      rules: RULES,
    };
  },

  // investigations
  'GET /api/investigations': (req, res, url) => {
    const q = str(url.searchParams.get('q'), 100).toLowerCase();
    const status = url.searchParams.get('status') || 'all';
    const author = str(url.searchParams.get('author'), 20);
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 100);
    let rows = db.prepare(`${invSelect} ${author ? 'WHERE u.username = ?' : ''} ORDER BY i.created_at DESC LIMIT 1000`)
      .all(...(author ? [author] : [])).map(shapeInv);
    if (status === 'active') rows = rows.filter((r) => r.status === 'open' || r.status === 'under_review');
    else if (status !== 'all') rows = rows.filter((r) => r.status === status);
    if (q) rows = rows.filter((r) => `${r.title} ${r.wallet} ${r.author} ${r.category}`.toLowerCase().includes(q));
    return { investigations: rows.slice(0, limit), total: rows.length };
  },
  'POST /api/investigations': async (req) => {
    const u = requireUser(req);
    rateLimit(`write:${u.id}`, 10, 600);
    const b = await readJson(req);
    const title = str(b.title, 140), wallet = str(b.wallet, 64), category = str(b.category, 40);
    const interpretation = str(b.interpretation, 4000), speculation = str(b.speculation, 2000);
    if (title.length < 10) throw new HttpError(400, 'Give the investigation a clear title (at least 10 characters).');
    if (!isSolAddress(wallet)) throw new HttpError(400, 'Enter a valid Solana wallet address.');
    if (!CATEGORIES.includes(category)) throw new HttpError(400, 'Pick a category.');
    if (interpretation.length < 30) throw new HttpError(400, 'Explain your interpretation (at least 30 characters).');
    const sigs = parseSignatures(b.signatures);
    if (!sigs.length) throw new HttpError(400, 'Add at least one transaction signature as confirmed on-chain evidence.');
    if (sigs.length > 20) throw new HttpError(400, 'Add at most 20 signatures at once.');

    const t = now();
    const { lastInsertRowid: id } = db.prepare(`INSERT INTO investigations (author_id, title, wallet, chain, category, interpretation, speculation, created_at)
      VALUES (?, ?, ?, 'Solana', ?, ?, ?, ?)`).run(u.id, title, wallet, category, interpretation, speculation, t);
    const ins = db.prepare('INSERT INTO evidence (investigation_id, user_id, signature, created_at) VALUES (?, ?, ?, ?)');
    for (const s of sigs) ins.run(id, u.id, s, t);
    checkEvidence(db.prepare('SELECT id, signature FROM evidence WHERE investigation_id = ?').all(id), wallet);
    return { id: Number(id) };
  },
  'GET /api/investigations/:id': (req, res, url, p) => {
    const row = db.prepare(`${invSelect} WHERE i.id = ?`).get(Number(p.id));
    if (!row) throw new HttpError(404, 'Investigation not found.');
    const me = currentUser(db, req);
    const evidence = db.prepare(`SELECT e.*, u.username FROM evidence e JOIN users u ON u.id = e.user_id WHERE investigation_id = ? ORDER BY e.created_at`).all(row.id)
      .map((e) => ({ id: e.id, signature: e.signature, note: e.note, by: e.username, onchain: e.onchain_ok, involvesWallet: e.involves_wallet, blockTime: e.block_time, createdAt: e.created_at }));
    const reviews = db.prepare(`SELECT r.*, u.username FROM reviews r JOIN users u ON u.id = r.user_id WHERE investigation_id = ? ORDER BY r.created_at DESC`).all(row.id)
      .map((r) => ({ verdict: r.verdict, comment: r.comment, by: r.username, createdAt: r.created_at }));
    if (sol.rpcReady()) { // retry any checks that failed earlier (e.g. RPC hiccup)
      const pending = db.prepare('SELECT id, signature FROM evidence WHERE investigation_id = ? AND onchain_ok IS NULL').all(row.id);
      if (pending.length) checkEvidence(pending, row.wallet);
    }
    const rep = computeReputation(db);
    const contributors = db.prepare(`SELECT DISTINCT u.id, u.username FROM users u WHERE u.id = ?
      OR u.id IN (SELECT user_id FROM evidence WHERE investigation_id = ?) OR u.id IN (SELECT user_id FROM reviews WHERE investigation_id = ?)`)
      .all(row.author_id, row.id, row.id).map((c) => ({ username: c.username, reputation: rep.get(c.id)?.reputation || 0 }));
    const activity = [
      { at: row.created_at, by: row.author, text: 'opened the investigation.' },
      ...evidence.filter((e) => e.by !== row.author || e.createdAt !== row.created_at).map((e) => ({ at: e.createdAt, by: e.by, text: 'added a transaction as evidence.' })),
      ...reviews.map((r) => ({ at: r.createdAt, by: r.by, text: r.verdict === 'confirm' ? 'confirmed the finding.' : 'challenged the finding.' })),
    ].sort((a, b) => b.at - a.at);
    return {
      investigation: { ...shapeInv(row), interpretation: row.interpretation, speculation: row.speculation, authorWallet: row.author_wallet },
      evidence, reviews, contributors, activity,
      checksEnabled: sol.rpcReady(),
      viewer: me ? { isAuthor: me.id === row.author_id, review: reviews.find((r) => r.by === me.username)?.verdict || null } : null,
      rules: RULES,
    };
  },
  'POST /api/investigations/:id/evidence': async (req, res, url, p) => {
    const u = requireUser(req);
    rateLimit(`write:${u.id}`, 30, 600);
    const inv = db.prepare('SELECT * FROM investigations WHERE id = ?').get(Number(p.id));
    if (!inv) throw new HttpError(404, 'Investigation not found.');
    const b = await readJson(req);
    const sigs = parseSignatures(b.signature);
    if (sigs.length !== 1) throw new HttpError(400, 'Add one transaction signature at a time.');
    if (db.prepare('SELECT 1 FROM evidence WHERE investigation_id = ? AND signature = ?').get(inv.id, sigs[0])) throw new HttpError(409, 'That transaction is already in this case.');
    const { lastInsertRowid } = db.prepare('INSERT INTO evidence (investigation_id, user_id, signature, note, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(inv.id, u.id, sigs[0], str(b.note, 500), now());
    await checkEvidence([{ id: lastInsertRowid, signature: sigs[0] }], inv.wallet);
    return { ok: true };
  },
  'POST /api/investigations/:id/reviews': async (req, res, url, p) => {
    const u = requireUser(req);
    rateLimit(`write:${u.id}`, 30, 600);
    const inv = db.prepare('SELECT * FROM investigations WHERE id = ?').get(Number(p.id));
    if (!inv) throw new HttpError(404, 'Investigation not found.');
    if (inv.author_id === u.id) throw new HttpError(403, 'You cannot review your own investigation.');
    const b = await readJson(req);
    const verdict = b.verdict === 'challenge' ? 'challenge' : b.verdict === 'confirm' ? 'confirm' : null;
    if (!verdict) throw new HttpError(400, 'Choose confirm or challenge.');
    const comment = str(b.comment, 2000);
    if (verdict === 'challenge' && comment.length < 20) throw new HttpError(400, 'Explain what the evidence does not support (at least 20 characters).');
    if (db.prepare('SELECT 1 FROM reviews WHERE investigation_id = ? AND user_id = ?').get(inv.id, u.id)) throw new HttpError(409, 'You have already reviewed this investigation.');
    db.prepare('INSERT INTO reviews (investigation_id, user_id, verdict, comment, created_at) VALUES (?, ?, ?, ?, ?)').run(inv.id, u.id, verdict, comment, now());
    return { ok: true };
  },

  // leaderboard & profiles
  'GET /api/leaderboard': (req, res, url) => {
    const period = PERIODS[url.searchParams.get('period')] !== undefined ? url.searchParams.get('period') : 'all';
    const since = PERIODS[period] ? now() - PERIODS[period] : 0;
    const rep = computeReputation(db, since);
    const users = new Map(db.prepare('SELECT id, username, wallet FROM users').all().map((u) => [u.id, u]));
    const rows = [...rep.values()].filter((r) => users.has(r.userId) && (r.reputation !== 0 || r.authored || r.reviews))
      .map((r) => ({ ...r, username: users.get(r.userId).username, wallet: users.get(r.userId).wallet }))
      .sort((a, b) => b.reputation - a.reputation || b.verified - a.verified).slice(0, 100)
      .map((r, i) => ({ rank: i + 1, ...r }));
    return { period, leaders: rows };
  },
  'GET /api/users/:username': (req, res, url, p) => {
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(str(p.username, 20));
    if (!u) throw new HttpError(404, 'Investigator not found.');
    const r = computeReputation(db).get(u.id) || { reputation: 0, verified: 0, disputed: 0, authored: 0, reviews: 0, challengesWon: 0, challenges: 0, accuracy: null };
    return { user: publicUser(u), stats: r };
  },

  // watchlist
  'GET /api/watchlist': async (req) => {
    const u = requireUser(req);
    const rows = db.prepare('SELECT * FROM watchlist WHERE user_id = ? ORDER BY created_at DESC').all(u.id);
    const out = await Promise.all(rows.map(async (w) => {
      let last = null;
      try { last = sol.rpcReady() ? await sol.lastActivity(w.wallet) : null; } catch { /* show without */ }
      const cases = db.prepare('SELECT COUNT(*) AS n FROM investigations WHERE wallet = ?').get(w.wallet).n;
      return { id: w.id, wallet: w.wallet, label: w.label, createdAt: w.created_at, lastActivity: last, investigations: cases };
    }));
    return { items: out };
  },
  'POST /api/watchlist': async (req) => {
    const u = requireUser(req);
    const b = await readJson(req);
    const wallet = str(b.wallet, 64);
    if (!isSolAddress(wallet)) throw new HttpError(400, 'Enter a valid Solana wallet address.');
    if (db.prepare('SELECT COUNT(*) AS n FROM watchlist WHERE user_id = ?').get(u.id).n >= 100) throw new HttpError(400, 'Watchlist is full (100 wallets).');
    try { db.prepare('INSERT INTO watchlist (user_id, wallet, label, created_at) VALUES (?, ?, ?, ?)').run(u.id, wallet, str(b.label, 60), now()); }
    catch { throw new HttpError(409, 'That wallet is already on your watchlist.'); }
    return { ok: true };
  },
  'DELETE /api/watchlist/:id': (req, res, url, p) => {
    const u = requireUser(req);
    db.prepare('DELETE FROM watchlist WHERE id = ? AND user_id = ?').run(Number(p.id), u.id);
    return { ok: true };
  },

  // explore
  'GET /api/explore/:query': async (req, res, url, p) => {
    rateLimit(`explore:${clientIp(req)}`, 30, 60);
    const q = str(p.query, 100);
    if (isSolAddress(q)) {
      const data = await sol.lookupAddress(q);
      const cases = db.prepare(`${invSelect} WHERE i.wallet = ? ORDER BY i.created_at DESC LIMIT 10`).all(q).map(shapeInv);
      return { kind: 'address', ...data, investigations: cases };
    }
    if (isSolSignature(q)) return { kind: 'transaction', ...(await sol.lookupTransaction(q)) };
    throw new HttpError(400, 'Paste a Solana wallet address or transaction signature.');
  },

  // launch
  'POST /api/launch/metadata': async (req) => {
    rateLimit(`meta:${clientIp(req)}`, 5, 600);
    const b = await readJson(req, 4 * 1024 * 1024);
    const name = str(b.name, 32), symbol = str(b.symbol, 10).toUpperCase();
    const urlOk = (v) => !v || /^https?:\/\/\S+$/i.test(v);
    const twitter = str(b.twitter, 200), telegram = str(b.telegram, 200), website = str(b.website, 200);
    if (!name || !symbol) throw new HttpError(400, 'Name and ticker are required.');
    if (![twitter, telegram, website].every(urlOk)) throw new HttpError(400, 'Links must start with http:// or https://');
    const imageType = str(b.image?.type, 40);
    if (!/^image\/(png|jpeg|gif|webp)$/.test(imageType)) throw new HttpError(400, 'Image must be PNG, JPG, GIF or WEBP.');
    const imageBytes = Buffer.from(str(b.image?.data, 4 * 1024 * 1024), 'base64');
    if (!imageBytes.length || imageBytes.length > 2 * 1024 * 1024) throw new HttpError(400, 'Image must be under 2 MB.');
    const { uri, image } = await sol.uploadTokenMetadata({ name, symbol, description: str(b.description, 1000), twitter, telegram, website, imageBytes, imageType });
    return { uri, image, name, symbol };
  },
  'POST /api/launch/create-tx': async (req) => {
    rateLimit(`create:${clientIp(req)}`, 10, 600);
    const b = await readJson(req);
    if (!isSolAddress(b.publicKey) || !isSolAddress(b.mint)) throw new HttpError(400, 'Invalid wallet or mint address.');
    const name = str(b.name, 32), symbol = str(b.symbol, 10).toUpperCase(), uri = str(b.uri, 300);
    if (!name || !symbol || !/^https:\/\//.test(uri)) throw new HttpError(400, 'Missing token metadata.');
    const devBuy = Number(b.devBuy);
    if (!Number.isFinite(devBuy) || devBuy < 0 || devBuy > 85) throw new HttpError(400, 'Initial buy must be between 0 and 85 SOL.');
    const tx = await sol.buildCreateTx({
      publicKey: b.publicKey, mint: b.mint, name, symbol, uri, devBuy,
      slippage: Math.min(Math.max(Number(b.slippage) || 10, 1), 50),
      priorityFee: Math.min(Math.max(Number(b.priorityFee) || 0.0005, 0), 0.01),
    });
    return { tx };
  },
  'POST /api/launch/send': async (req) => {
    rateLimit(`send:${clientIp(req)}`, 10, 600);
    const b = await readJson(req);
    const tx = str(b.tx, 20000);
    if (!tx) throw new HttpError(400, 'Missing signed transaction.');
    return { signature: await sol.sendRawTransaction(tx) };
  },
  'GET /api/launch/status': async (req, res, url) => {
    const sig = url.searchParams.get('sig') || '';
    if (!isSolSignature(sig)) throw new HttpError(400, 'Bad signature.');
    return sol.signatureStatus(sig);
  },
  'POST /api/launches': async (req) => {
    const b = await readJson(req);
    const mint = str(b.mint, 64), signature = str(b.signature, 100);
    if (!isSolAddress(mint) || !isSolSignature(signature)) throw new HttpError(400, 'Bad launch record.');
    const v = await sol.verifySignature(signature, mint);
    if (!v?.ok || !v.involves) throw new HttpError(400, 'That transaction did not create this mint.');
    const creator = v.keys[0];
    const me = currentUser(db, req);
    try {
      db.prepare('INSERT INTO launches (user_id, creator_wallet, mint, name, symbol, image, signature, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(me?.wallet === creator ? me.id : null, creator, mint, str(b.name, 32), str(b.symbol, 10).toUpperCase(), str(b.image, 300), signature, now());
    } catch { /* already recorded */ }
    return { ok: true };
  },
  'GET /api/launches': () => ({
    launches: db.prepare(`SELECT l.mint, l.name, l.symbol, l.image, l.signature, l.creator_wallet AS creatorWallet, l.created_at AS createdAt, u.username
      FROM launches l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.created_at DESC LIMIT 50`).all(),
  }),
};

// Compile "METHOD /path/:param" keys into matchers.
const routes = Object.entries(api).map(([key, fn]) => {
  const [method, pattern] = key.split(' ');
  const names = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '$');
  return { method, re, names, fn };
});

// ---------- static files ----------
const PUBLIC = path.join(here, 'public');
const PAGES = { '/': 'index.html', '/app': 'app.html', '/investigations': 'investigations.html', '/investigation': 'investigation.html', '/leaderboard': 'leaderboard.html', '/how-it-works': 'how-it-works.html', '/launch': 'launch.html' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN', // the landing page shows the real dashboard in a frame
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' https://esm.sh; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://esm.sh; frame-src 'self'; frame-ancestors 'self'; base-uri 'self'",
};

async function serveStatic(req, res, pathname) {
  const file = PAGES[pathname] || pathname.slice(1);
  const full = path.normalize(path.join(PUBLIC, file));
  if (!full.startsWith(PUBLIC + path.sep)) return false;
  try {
    const info = await stat(full);
    if (!info.isFile()) return false;
    const ext = path.extname(full);
    // Browsers keep a copy but must check with us before using it, so a new deploy shows up
    // on the next visit. If the file hasn't changed we answer "304 Not Modified" with no body.
    // Bundled libraries (/vendor) never change under the same name, so they cache for a week.
    const etag = `"${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}"`;
    const headers = {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': file.startsWith('vendor/') ? 'public, max-age=604800' : 'no-cache',
      ETag: etag,
      'Last-Modified': info.mtime.toUTCString(),
      ...SECURITY,
    };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return true; }
    res.writeHead(200, headers);
    res.end(await readFile(full));
    return true;
  } catch { return false; }
}

// ---------- server ----------
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      if (['POST', 'PATCH', 'DELETE'].includes(req.method)) {
        // CSRF guard: browsers send Origin on cross-site requests; it must match our host.
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Cross-site request blocked.');
      }
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = url.pathname.match(r.re);
        if (!m) continue;
        const params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
        const out = await r.fn(req, res, url, params);
        const [body, headers] = Array.isArray(out) ? out : [out, {}];
        return sendJson(res, 200, body, headers);
      }
      throw new HttpError(404, 'Not found');
    }
    if (req.method === 'GET' && await serveStatic(req, res, url.pathname)) return;
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY });
    res.end(await readFile(path.join(PUBLIC, '404.html')).catch(() => 'Not found'));
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(e);
    sendJson(res, status, { error: status >= 500 && !e.status ? 'Something went wrong on our side.' : e.message });
  }
}).listen(PORT, () => {
  console.log(`WITNESS running on http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
  if (!sol.heliusReady()) console.warn('HELIUS_API_KEY not set: Explore, evidence checks and launches are disabled.');
  if (!sol.pinataReady()) console.warn('PINATA_JWT not set: coin launches are disabled.');
});
