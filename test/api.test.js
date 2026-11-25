// End-to-end API tests: starts the real server on a temp database and drives it
// with real ed25519 wallet signatures. Run with `npm test`. No network needed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { b58encode } from '../lib/util.js';

const PORT = 39000 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;
const dir = mkdtempSync(path.join(tmpdir(), 'witness-'));
let proc;

before(async () => {
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { PATH: process.env.PATH, PORT: String(PORT), DATABASE_PATH: path.join(dir, 't.db'), HELIUS_API_KEY: '', PINATA_JWT: '', RPC_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});
after(() => { proc?.kill(); rmSync(dir, { recursive: true, force: true }); });

function newWallet() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
  return { address: b58encode(raw), privateKey, cookie: '' };
}
const fakeSig = () => b58encode(crypto.randomBytes(64));
const fakeAddr = () => b58encode(crypto.randomBytes(32));

async function call(w, method, p, body, extra = {}) {
  const r = await fetch(BASE + p, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(w?.cookie ? { Cookie: w.cookie } : {}), ...extra },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = r.headers.get('set-cookie');
  if (w && set) w.cookie = set.split(';')[0];
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function signIn(w) {
  const { body: { message } } = await call(w, 'POST', '/api/auth/nonce', { wallet: w.address });
  const signature = crypto.sign(null, Buffer.from(message), w.privateKey).toString('base64');
  return call(w, 'POST', '/api/auth/verify', { wallet: w.address, message, signature });
}

const alice = newWallet(), bob = newWallet(), carol = newWallet(), dave = newWallet(), eve = newWallet();
let caseId;

test('pages are served', async () => {
  for (const p of ['/', '/app', '/investigations', '/investigation', '/leaderboard', '/how-it-works', '/launch', '/css/style.css', '/js/core.js']) {
    const r = await fetch(BASE + p);
    assert.equal(r.status, 200, p);
  }
  assert.equal((await fetch(`${BASE}/nope`)).status, 404);
  assert.equal((await fetch(`${BASE}/../server.js`)).status, 404);
});

test('sign-in rejects a bad signature and accepts a good one', async () => {
  const { body: { message } } = await call(alice, 'POST', '/api/auth/nonce', { wallet: alice.address });
  const wrong = crypto.sign(null, Buffer.from(message), bob.privateKey).toString('base64');
  assert.equal((await call(alice, 'POST', '/api/auth/verify', { wallet: alice.address, message, signature: wrong })).status, 401);
  const ok = await signIn(alice);
  assert.equal(ok.status, 200);
  assert.match(alice.cookie, /^witness_session=/);
  assert.equal((await call(alice, 'GET', '/api/me')).body.user.wallet, alice.address);
});

test('a nonce cannot be replayed', async () => {
  const { body: { message } } = await call(bob, 'POST', '/api/auth/nonce', { wallet: bob.address });
  const signature = crypto.sign(null, Buffer.from(message), bob.privateKey).toString('base64');
  assert.equal((await call(bob, 'POST', '/api/auth/verify', { wallet: bob.address, message, signature })).status, 200);
  assert.equal((await call(newWallet(), 'POST', '/api/auth/verify', { wallet: bob.address, message, signature })).status, 401);
});

test('writing requires sign-in, and cross-site writes are blocked', async () => {
  assert.equal((await call(null, 'POST', '/api/investigations', { title: 'x' })).status, 401);
  assert.equal((await call(alice, 'POST', '/api/watchlist', { wallet: fakeAddr() }, { Origin: 'https://evil.example' })).status, 403);
});

test('investigation validation', async () => {
  const base = { title: 'Deployer funded fresh wallets', wallet: fakeAddr(), category: 'Token launch', interpretation: 'The wallets were funded minutes before launch and bought first.', signatures: fakeSig() };
  assert.equal((await call(alice, 'POST', '/api/investigations', { ...base, wallet: 'not-an-address' })).status, 400);
  assert.equal((await call(alice, 'POST', '/api/investigations', { ...base, signatures: '' })).status, 400);
  assert.equal((await call(alice, 'POST', '/api/investigations', { ...base, signatures: 'abc' })).status, 400);
  assert.equal((await call(alice, 'POST', '/api/investigations', { ...base, interpretation: 'short' })).status, 400);
  const r = await call(alice, 'POST', '/api/investigations', { ...base, signatures: `${fakeSig()}\nhttps://solscan.io/tx/${fakeSig()}` });
  assert.equal(r.status, 200);
  caseId = r.body.id;
  const d = await call(null, 'GET', `/api/investigations/${caseId}`);
  assert.equal(d.body.evidence.length, 2);
  assert.equal(d.body.investigation.status, 'open');
});

test('review rules: no self-review, one per user, challenges need a reason', async () => {
  for (const w of [carol, dave, eve]) await signIn(w);
  assert.equal((await call(alice, 'POST', `/api/investigations/${caseId}/reviews`, { verdict: 'confirm' })).status, 403);
  assert.equal((await call(bob, 'POST', `/api/investigations/${caseId}/reviews`, { verdict: 'challenge', comment: 'no' })).status, 400);
  assert.equal((await call(bob, 'POST', `/api/investigations/${caseId}/reviews`, { verdict: 'confirm' })).status, 200);
  assert.equal((await call(bob, 'POST', `/api/investigations/${caseId}/reviews`, { verdict: 'confirm' })).status, 409);
  assert.equal((await call(null, 'GET', `/api/investigations/${caseId}`)).body.investigation.status, 'under_review');
});

test('status becomes verified, and reputation follows', async () => {
  await call(carol, 'POST', `/api/investigations/${caseId}/reviews`, { verdict: 'confirm' });
  await call(dave, 'POST', `/api/investigations/${caseId}/reviews`, { verdict: 'confirm' });
  await call(eve, 'POST', `/api/investigations/${caseId}/reviews`, { verdict: 'challenge', comment: 'Shared funders are common on Solana; this is not proof.' });
  const d = await call(null, 'GET', `/api/investigations/${caseId}`);
  assert.equal(d.body.investigation.status, 'verified'); // 3 confirms >= 2 x 1 challenge
  assert.equal(d.body.investigation.contributors, 5);
  const lb = (await call(null, 'GET', '/api/leaderboard')).body.leaders;
  const rep = Object.fromEntries(lb.map((l) => [l.wallet, l.reputation]));
  assert.equal(rep[alice.address], 40);
  assert.equal(rep[bob.address], 5);
  assert.equal(rep[eve.address], -10);
  assert.equal(lb[0].wallet, alice.address);
  assert.equal(lb[0].accuracy, 100);
});

test('a case becomes disputed when challenges match confirmations', async () => {
  const r = await call(bob, 'POST', '/api/investigations', { title: 'Claimed link between two teams', wallet: fakeAddr(), category: 'Attribution', interpretation: 'Both teams used the same funding wallet within an hour of each other.', signatures: fakeSig() });
  await call(carol, 'POST', `/api/investigations/${r.body.id}/reviews`, { verdict: 'challenge', comment: 'The funding wallet is a public exchange hot wallet.' });
  await call(dave, 'POST', `/api/investigations/${r.body.id}/reviews`, { verdict: 'challenge', comment: 'Timing alone does not show common control.' });
  assert.equal((await call(null, 'GET', `/api/investigations/${r.body.id}`)).body.investigation.status, 'disputed');
  const list = await call(null, 'GET', '/api/investigations?status=disputed');
  assert.equal(list.body.investigations.length, 1);
});

test('stats, search and profiles', async () => {
  const s = (await call(null, 'GET', '/api/stats')).body;
  assert.equal(s.verifiedDiscoveries, 1);
  assert.equal(s.investigators, 5);
  assert.equal(s.trackedWallets, 2);
  assert.equal((await call(null, 'GET', '/api/investigations?q=teams')).body.investigations.length, 1);
  assert.equal((await call(alice, 'PATCH', '/api/me', { username: 'nullpointer', bio: 'Token launches' })).status, 200);
  assert.equal((await call(bob, 'PATCH', '/api/me', { username: 'NullPointer' })).status, 409);
  assert.equal((await call(bob, 'PATCH', '/api/me', { username: 'x!' })).status, 400);
  const p = (await call(null, 'GET', '/api/users/nullpointer')).body;
  assert.equal(p.stats.verified, 1);
  assert.equal((await call(null, 'GET', '/api/investigations?author=nullpointer')).body.investigations.length, 1);
});

test('evidence: duplicates rejected', async () => {
  const d = await call(null, 'GET', `/api/investigations/${caseId}`);
  const sig = d.body.evidence[0].signature;
  assert.equal((await call(bob, 'POST', `/api/investigations/${caseId}/evidence`, { signature: sig })).status, 409);
  assert.equal((await call(bob, 'POST', `/api/investigations/${caseId}/evidence`, { signature: fakeSig(), note: 'second funding tx' })).status, 200);
});

test('watchlist add, list, remove', async () => {
  const addr = fakeAddr();
  assert.equal((await call(alice, 'POST', '/api/watchlist', { wallet: addr, label: 'Deployer' })).status, 200);
  assert.equal((await call(alice, 'POST', '/api/watchlist', { wallet: addr })).status, 409);
  const { items } = (await call(alice, 'GET', '/api/watchlist')).body;
  assert.equal(items.length, 1);
  assert.equal((await call(bob, 'DELETE', `/api/watchlist/${items[0].id}`)).status, 200); // not bob's: no-op
  assert.equal((await call(alice, 'GET', '/api/watchlist')).body.items.length, 1);
  await call(alice, 'DELETE', `/api/watchlist/${items[0].id}`);
  assert.equal((await call(alice, 'GET', '/api/watchlist')).body.items.length, 0);
});

test('explore and launch report clearly when keys are missing', async () => {
  const x = await call(null, 'GET', `/api/explore/${fakeAddr()}`);
  assert.equal(x.status, 503);
  assert.match(x.body.error, /HELIUS_API_KEY/);
  assert.equal((await call(null, 'GET', '/api/explore/hello')).status, 400);
  assert.equal((await call(null, 'GET', '/api/health')).body.launch, false);
});

test('sign out ends the session', async () => {
  await call(alice, 'POST', '/api/auth/logout');
  assert.equal((await call(alice, 'GET', '/api/me')).body.user, null);
});
