// Everything that talks to the outside world: Helius (Solana RPC + parsed history),
// Pinata (IPFS) and PumpPortal (pump.fun create transactions).
import { HttpError } from './util.js';

const KEY = () => process.env.HELIUS_API_KEY;
const RPC = () => process.env.RPC_URL || (KEY() ? `https://mainnet.helius-rpc.com/?api-key=${KEY()}` : '');
const API_BASE = () => process.env.HELIUS_API_BASE || 'https://api.helius.xyz';
const LAMPORTS = 1e9;

export const heliusReady = () => Boolean(KEY());
export const rpcReady = () => Boolean(RPC());
export const pinataReady = () => Boolean(process.env.PINATA_JWT);

async function fetchJson(url, opts = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    if (!r.ok) throw new HttpError(502, `Upstream error (${r.status}): ${String(typeof body === 'string' ? body : JSON.stringify(body)).slice(0, 200)}`);
    return body;
  } catch (e) {
    if (e.name === 'AbortError') throw new HttpError(504, 'Upstream request timed out');
    throw e;
  } finally { clearTimeout(t); }
}

export async function rpc(method, params) {
  if (!rpcReady()) throw new HttpError(503, 'Solana RPC is not configured (set HELIUS_API_KEY).');
  const j = await fetchJson(RPC(), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (j.error) throw new HttpError(502, j.error.message || 'RPC error');
  return j.result;
}

// ---------- tiny TTL cache ----------
const cache = new Map();
async function cached(key, ttlSec, fn) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.val;
  const val = await fn();
  cache.set(key, { val, exp: Date.now() + ttlSec * 1000 });
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  return val;
}

// ---------- Explore ----------
export function lookupAddress(address) {
  return cached(`addr:${address}`, 60, async () => {
    if (!heliusReady()) throw new HttpError(503, 'Explore is not configured yet (set HELIUS_API_KEY).');
    const [bal, tokA, tokB, history] = await Promise.all([
      rpc('getBalance', [address, { commitment: 'confirmed' }]),
      rpc('getTokenAccountsByOwner', [address, { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, { encoding: 'jsonParsed' }]),
      rpc('getTokenAccountsByOwner', [address, { programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' }, { encoding: 'jsonParsed' }]),
      fetchJson(`${API_BASE()}/v0/addresses/${address}/transactions?api-key=${KEY()}&limit=100`),
    ]);
    const tokens = [...(tokA?.value || []), ...(tokB?.value || [])]
      .map((a) => a.account?.data?.parsed?.info)
      .filter((i) => i && Number(i.tokenAmount?.uiAmount) > 0)
      .map((i) => ({ mint: i.mint, amount: Number(i.tokenAmount.uiAmount) }));

    const txs = Array.isArray(history) ? history : [];
    const cp = new Map();
    const bump = (addr, field, lamports) => {
      if (!addr || addr === address) return;
      const c = cp.get(addr) || { address: addr, inSol: 0, outSol: 0, count: 0 };
      c[field] += lamports / LAMPORTS; c.count += 1; cp.set(addr, c);
    };
    for (const t of txs) {
      for (const n of t.nativeTransfers || []) {
        if (n.toUserAccount === address) bump(n.fromUserAccount, 'inSol', n.amount);
        else if (n.fromUserAccount === address) bump(n.toUserAccount, 'outSol', n.amount);
      }
    }
    const counterparties = [...cp.values()]
      .filter((c) => c.inSol + c.outSol >= 0.001)
      .sort((a, b) => (b.inSol + b.outSol) - (a.inSol + a.outSol))
      .slice(0, 12)
      .map((c) => ({ ...c, inSol: +c.inSol.toFixed(4), outSol: +c.outSol.toFixed(4) }));

    return {
      address,
      balanceSol: (bal?.value ?? 0) / LAMPORTS,
      tokens: tokens.slice(0, 20),
      tokenCount: tokens.length,
      recent: txs.slice(0, 15).map((t) => ({
        signature: t.signature, time: t.timestamp, type: t.type, source: t.source,
        description: t.description || '', feeSol: (t.fee || 0) / LAMPORTS,
      })),
      sampled: txs.length,
      oldestSampled: txs.length ? txs[txs.length - 1].timestamp : null,
      counterparties,
    };
  });
}

export function lookupTransaction(signature) {
  return cached(`tx:${signature}`, 300, async () => {
    if (!heliusReady()) throw new HttpError(503, 'Explore is not configured yet (set HELIUS_API_KEY).');
    const r = await fetchJson(`${API_BASE()}/v0/transactions?api-key=${KEY()}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactions: [signature] }),
    });
    const t = Array.isArray(r) ? r[0] : null;
    if (!t) throw new HttpError(404, 'Transaction not found.');
    return {
      signature: t.signature, time: t.timestamp, type: t.type, source: t.source,
      description: t.description || '', feePayer: t.feePayer, feeSol: (t.fee || 0) / LAMPORTS,
      failed: Boolean(t.transactionError),
      nativeTransfers: (t.nativeTransfers || []).slice(0, 30).map((n) => ({ from: n.fromUserAccount, to: n.toUserAccount, sol: n.amount / LAMPORTS })),
      tokenTransfers: (t.tokenTransfers || []).slice(0, 30).map((n) => ({ from: n.fromUserAccount, to: n.toUserAccount, mint: n.mint, amount: n.tokenAmount })),
    };
  });
}

/** Check a signature on-chain. Returns { ok, involves, blockTime } or null if RPC isn't configured. */
export async function verifySignature(signature, wallet) {
  if (!rpcReady()) return null;
  const tx = await rpc('getTransaction', [signature, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
  if (!tx) return { ok: false, involves: false, blockTime: null };
  const keys = [
    ...(tx.transaction?.message?.accountKeys || []),
    ...(tx.meta?.loadedAddresses?.writable || []),
    ...(tx.meta?.loadedAddresses?.readonly || []),
  ].map((k) => (typeof k === 'string' ? k : k.pubkey));
  return { ok: !tx.meta?.err, involves: wallet ? keys.includes(wallet) : false, blockTime: tx.blockTime ?? null, keys };
}

export async function lastActivity(address) {
  return cached(`last:${address}`, 60, async () => {
    const r = await rpc('getSignaturesForAddress', [address, { limit: 1 }]);
    return r?.[0] ? { signature: r[0].signature, time: r[0].blockTime } : null;
  });
}

// ---------- Launch (Pinata + PumpPortal) ----------
async function pinataUpload(blob, filename) {
  const form = new FormData();
  form.append('network', 'public');
  form.append('file', blob, filename);
  const j = await fetchJson('https://uploads.pinata.cloud/v3/files', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.PINATA_JWT}` }, body: form,
  }, 30000);
  const cid = j?.data?.cid;
  if (!cid) throw new HttpError(502, 'IPFS upload returned no CID');
  return `https://ipfs.io/ipfs/${cid}`;
}

export async function uploadTokenMetadata({ name, symbol, description, twitter, telegram, website, imageBytes, imageType }) {
  if (!pinataReady()) throw new HttpError(503, 'Launching is not configured yet (set PINATA_JWT).');
  const ext = imageType.split('/')[1].replace('jpeg', 'jpg');
  const image = await pinataUpload(new Blob([imageBytes], { type: imageType }), `${symbol}.${ext}`);
  const meta = { name, symbol, description, image, showName: true };
  if (twitter) meta.twitter = twitter;
  if (telegram) meta.telegram = telegram;
  if (website) meta.website = website;
  const uri = await pinataUpload(new Blob([JSON.stringify(meta)], { type: 'application/json' }), 'metadata.json');
  return { uri, image };
}

export async function buildCreateTx({ publicKey, mint, name, symbol, uri, devBuy, slippage, priorityFee }) {
  const r = await fetch('https://pumpportal.fun/api/trade-local', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey, action: 'create', tokenMetadata: { name, symbol, uri }, mint,
      denominatedInSol: 'true', amount: devBuy, slippage, priorityFee, pool: 'pump',
    }),
  });
  if (r.status !== 200) throw new HttpError(502, `PumpPortal refused the request: ${(await r.text()).slice(0, 300)}`);
  return Buffer.from(await r.arrayBuffer()).toString('base64');
}

export async function sendRawTransaction(base64Tx) {
  return rpc('sendTransaction', [base64Tx, { encoding: 'base64', preflightCommitment: 'confirmed', maxRetries: 5 }]);
}

export async function signatureStatus(sig) {
  const r = await rpc('getSignatureStatuses', [[sig], { searchTransactionHistory: false }]);
  const s = r?.value?.[0];
  return { status: s ? (s.err ? 'failed' : s.confirmationStatus || 'processed') : 'pending', error: s?.err ? JSON.stringify(s.err) : null };
}
