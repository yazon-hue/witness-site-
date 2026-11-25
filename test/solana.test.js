// Tests the Solana integration against a local mock of Helius (RPC + enhanced API).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { b58encode } from '../lib/util.js';

const addr = () => b58encode(crypto.randomBytes(32));
const sig = () => b58encode(crypto.randomBytes(64));
const SUSPECT = addr(), PEER = addr(), GOOD_SIG = sig(), MISSING_SIG = sig(), FAILED_SIG = sig(), MINT = addr(), LAUNCH_SIG = sig(), CREATOR = addr();

const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const send = (x) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(x)); };
    if (req.url.startsWith('/v0/addresses/')) {
      return send([
        { signature: sig(), timestamp: 1764000000, type: 'TRANSFER', source: 'SYSTEM_PROGRAM', description: 'peer sent 2 SOL', fee: 5000, nativeTransfers: [{ fromUserAccount: PEER, toUserAccount: SUSPECT, amount: 2e9 }] },
        { signature: sig(), timestamp: 1763990000, type: 'TRANSFER', source: 'SYSTEM_PROGRAM', description: 'sent 0.5 SOL', fee: 5000, nativeTransfers: [{ fromUserAccount: SUSPECT, toUserAccount: PEER, amount: 5e8 }] },
      ]);
    }
    if (req.url.startsWith('/v0/transactions')) {
      return send([{ signature: GOOD_SIG, timestamp: 1764000000, type: 'SWAP', source: 'PUMP_FUN', description: 'swap', feePayer: SUSPECT, fee: 5000, nativeTransfers: [], tokenTransfers: [] }]);
    }
    const { method, params } = JSON.parse(body || '{}');
    const result = {
      getBalance: { value: 3.5e9 },
      getTokenAccountsByOwner: { value: params?.[1]?.programId?.startsWith('Tokenkeg') ? [{ account: { data: { parsed: { info: { mint: MINT, tokenAmount: { uiAmount: 1000 } } } } } }] : [] },
      getSignaturesForAddress: [{ signature: GOOD_SIG, blockTime: 1764000000 }],
      getTransaction: params?.[0] === GOOD_SIG ? { blockTime: 1764000000, meta: { err: null }, transaction: { message: { accountKeys: [SUSPECT, PEER] } } }
        : params?.[0] === FAILED_SIG ? { blockTime: 1764000000, meta: { err: { InstructionError: [0, 'x'] } }, transaction: { message: { accountKeys: [PEER] } } }
        : params?.[0] === LAUNCH_SIG ? { blockTime: 1764000000, meta: { err: null }, transaction: { message: { accountKeys: [CREATOR, MINT] } } }
        : null,
    }[method];
    send({ jsonrpc: '2.0', id: 1, result });
  });
});

let proc, BASE;
const dir = mkdtempSync(path.join(tmpdir(), 'witness-sol-'));
before(async () => {
  await new Promise((r) => mock.listen(0, r));
  const MOCK = `http://localhost:${mock.address().port}`;
  const PORT = 40000 + Math.floor(Math.random() * 1000);
  BASE = `http://localhost:${PORT}`;
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { PATH: process.env.PATH, PORT: String(PORT), DATABASE_PATH: path.join(dir, 't.db'), HELIUS_API_KEY: 'test', HELIUS_API_BASE: MOCK, RPC_URL: MOCK, PINATA_JWT: '' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 100)); }
});
after(() => { proc?.kill(); mock.close(); rmSync(dir, { recursive: true, force: true }); });

const json = async (p, opts = {}) => { const r = await fetch(BASE + p, opts); return { status: r.status, body: await r.json() }; };

test('explore a wallet aggregates balance, tokens and counterparties', async () => {
  const { status, body } = await json(`/api/explore/${SUSPECT}`);
  assert.equal(status, 200);
  assert.equal(body.kind, 'address');
  assert.equal(body.balanceSol, 3.5);
  assert.equal(body.tokenCount, 1);
  assert.equal(body.counterparties[0].address, PEER);
  assert.equal(body.counterparties[0].inSol, 2);
  assert.equal(body.counterparties[0].outSol, 0.5);
  assert.equal(body.recent.length, 2);
});

test('explore a transaction', async () => {
  const { status, body } = await json(`/api/explore/${GOOD_SIG}`);
  assert.equal(status, 200);
  assert.equal(body.kind, 'transaction');
  assert.equal(body.type, 'SWAP');
});

test('evidence is checked on-chain', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const wallet = b58encode(publicKey.export({ format: 'der', type: 'spki' }).subarray(12));
  const h = { 'Content-Type': 'application/json' };
  const { body: { message } } = await json('/api/auth/nonce', { method: 'POST', headers: h, body: JSON.stringify({ wallet }) });
  const r = await fetch(`${BASE}/api/auth/verify`, { method: 'POST', headers: h, body: JSON.stringify({ wallet, message, signature: crypto.sign(null, Buffer.from(message), privateKey).toString('base64') }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const { body: { id } } = await json('/api/investigations', { method: 'POST', headers: { ...h, Cookie: cookie }, body: JSON.stringify({
    title: 'Suspect wallet received funds from peer', wallet: SUSPECT, category: 'Fund movement',
    interpretation: 'The peer wallet funded the suspect right before the launch window.', signatures: [GOOD_SIG, MISSING_SIG, FAILED_SIG].join('\n'),
  }) });
  await new Promise((r2) => setTimeout(r2, 500));
  const { body } = await json(`/api/investigations/${id}`);
  const by = Object.fromEntries(body.evidence.map((e) => [e.signature, e]));
  assert.equal(by[GOOD_SIG].onchain, 1);
  assert.equal(by[GOOD_SIG].involvesWallet, 1);
  assert.equal(by[MISSING_SIG].onchain, 0);
  assert.equal(by[FAILED_SIG].onchain, 0);
  assert.equal(body.checksEnabled, true);
});

test('launch records are verified against the chain', async () => {
  const h = { 'Content-Type': 'application/json' };
  const bad = await json('/api/launches', { method: 'POST', headers: h, body: JSON.stringify({ mint: addr(), signature: LAUNCH_SIG, name: 'Fake', symbol: 'FAKE' }) });
  assert.equal(bad.status, 400);
  const ok = await json('/api/launches', { method: 'POST', headers: h, body: JSON.stringify({ mint: MINT, signature: LAUNCH_SIG, name: 'Test Coin', symbol: 'test' }) });
  assert.equal(ok.status, 200);
  const { body } = await json('/api/launches');
  assert.equal(body.launches[0].mint, MINT);
  assert.equal(body.launches[0].creatorWallet, CREATOR);
  assert.equal(body.launches[0].symbol, 'TEST');
});

test('launch metadata refuses without Pinata configured', async () => {
  const r = await json('/api/launch/metadata', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'A', symbol: 'B', image: { type: 'image/png', data: Buffer.from('x').toString('base64') } }) });
  assert.equal(r.status, 503);
  assert.match(r.body.error, /PINATA_JWT/);
});
