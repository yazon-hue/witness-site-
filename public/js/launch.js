import { mountChrome, api, esc, short, ago, $, $$, walletProvider, toB64, toast } from './core.js';

mountChrome('launch');

const state = { provider: null, pubkey: null, imageFile: null, busy: false };
const num = (id) => Number($(`#${id}`).value) || 0;
const fromB64 = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
const fileB64 = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(f); });

api('/api/health').then((h) => { if (!h.launch) { $('#unavailable').classList.remove('hidden'); $('#launchBtn').disabled = true; } });

async function connectWallet() {
  const p = walletProvider();
  if (!p) { $('#formErr').textContent = 'No Solana wallet found. Install Phantom, Solflare or Backpack, then reload.'; return false; }
  try {
    const r = await p.connect();
    state.provider = p; state.pubkey = (r?.publicKey || p.publicKey).toBase58();
    $('#formErr').textContent = ''; render(); return true;
  } catch { $('#formErr').textContent = 'Wallet connection was cancelled.'; return false; }
}

$('#drop').onclick = () => $('#file').click();
$('#file').onchange = () => {
  const f = $('#file').files[0]; if (!f) return;
  if (f.size > 2 * 1024 * 1024) { $('#formErr').textContent = 'Image must be under 2 MB.'; return; }
  state.imageFile = f;
  $('#preview').src = URL.createObjectURL(f); $('#preview').classList.remove('hidden'); $('#placeholder').classList.add('hidden');
  $('#fileName').textContent = f.name;
};
['name', 'symbol', 'devBuy', 'priorityFee', 'ack'].forEach((id) => $(`#${id}`).addEventListener('input', render));

function render() {
  $('#rvWallet').textContent = state.pubkey ? short(state.pubkey) : 'Not connected';
  const n = $('#name').value.trim(), s = $('#symbol').value.trim().toUpperCase();
  $('#rvName').textContent = n ? `${n}${s ? ` ($${s})` : ''}` : '—';
  $('#rvBuy').textContent = `${num('devBuy')} SOL`;
  $('#rvFee').textContent = `${+(num('devBuy') * 0.005).toFixed(6)} SOL`;
  $('#rvPrio').textContent = `${num('priorityFee')} SOL`;
  $('#launchBtn').textContent = state.pubkey ? 'Launch on pump.fun' : 'Connect wallet to launch';
}

function validate() {
  const urlOk = (v) => !v || /^https?:\/\/\S+$/i.test(v);
  if (!state.imageFile) return 'Add an image.';
  if (!$('#name').value.trim()) return 'Add a name.';
  if (!$('#symbol').value.trim()) return 'Add a ticker.';
  if (!['twitter', 'telegram', 'website'].every((id) => urlOk($(`#${id}`).value.trim()))) return 'Links must start with https://';
  if (num('devBuy') < 0 || num('devBuy') > 85) return 'Initial buy must be between 0 and 85 SOL.';
  if (!$('#ack').checked) return 'Tick the box to confirm you understand the launch is permanent.';
  return '';
}
const step = (k, cls) => $$('#steps li').forEach((li) => { if (li.dataset.k === k) li.className = cls; });

$('#form').onsubmit = async (e) => {
  e.preventDefault();
  if (state.busy) return;
  if (!state.pubkey) { await connectWallet(); return; }
  const err = validate(); $('#formErr').textContent = err; if (err) return;

  state.busy = true; $('#launchBtn').disabled = true;
  $('#progressCard').classList.remove('hidden'); $('#doneCard').classList.add('hidden'); $('#runErr').textContent = '';
  $$('#steps li').forEach((li) => { li.className = ''; });
  let current = 'upload';
  try {
    const { Keypair, VersionedTransaction } = await import('https://esm.sh/@solana/web3.js@1.98.0');
    step('upload', 'active');
    const meta = await api('/api/launch/metadata', { method: 'POST', body: {
      name: $('#name').value, symbol: $('#symbol').value, description: $('#description').value,
      twitter: $('#twitter').value, telegram: $('#telegram').value, website: $('#website').value,
      image: { type: state.imageFile.type, data: await fileB64(state.imageFile) },
    } });
    step('upload', 'done');

    current = 'build'; step('build', 'active');
    const mint = Keypair.generate(); // new mint address, created in this browser only
    const { tx } = await api('/api/launch/create-tx', { method: 'POST', body: {
      publicKey: state.pubkey, mint: mint.publicKey.toBase58(), name: meta.name, symbol: meta.symbol, uri: meta.uri,
      devBuy: num('devBuy'), slippage: num('slippage'), priorityFee: num('priorityFee'),
    } });
    const unsigned = VersionedTransaction.deserialize(fromB64(tx));
    step('build', 'done');

    current = 'sign'; step('sign', 'active');
    const signed = await state.provider.signTransaction(unsigned); // wallet signs first
    signed.sign([mint]);                                             // then the mint keypair
    step('sign', 'done');

    current = 'send'; step('send', 'active');
    const { signature } = await api('/api/launch/send', { method: 'POST', body: { tx: toB64(signed.serialize()) } });
    step('send', 'done');

    current = 'confirm'; step('confirm', 'active');
    let status = 'pending';
    for (let i = 0; i < 45 && !['confirmed', 'finalized'].includes(status); i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const r = await api(`/api/launch/status?sig=${signature}`);
      if (r.error) throw new Error(`Transaction failed on-chain: ${r.error}`);
      status = r.status;
    }
    if (!['confirmed', 'finalized'].includes(status)) throw new Error(`Not confirmed after 90 seconds. Check the transaction: https://solscan.io/tx/${signature}`);
    step('confirm', 'done');

    const m = mint.publicKey.toBase58();
    await api('/api/launches', { method: 'POST', body: { mint: m, signature, name: meta.name, symbol: meta.symbol, image: meta.image } }).catch(() => {});
    $('#doneName').textContent = `${meta.name} ($${meta.symbol})`;
    $('#doneMint').textContent = m;
    $('#pumpLink').href = `https://pump.fun/coin/${m}`;
    $('#scanLink').href = `https://solscan.io/tx/${signature}`;
    $('#doneCard').classList.remove('hidden');
    toast('Your coin is live.');
    loadLaunches();
  } catch (e2) {
    step(current, 'fail');
    $('#runErr').textContent = /reject|cancel|denied/i.test(e2.message || '') ? 'You declined the transaction in your wallet. Nothing was launched.' : (e2.message || 'Something went wrong.');
  } finally { state.busy = false; $('#launchBtn').disabled = false; }
};

const COLS = 'grid-template-columns:1.4fr 1fr 1fr .8fr';
async function loadLaunches() {
  const { launches } = await api('/api/launches');
  $('#launches').innerHTML = `<div class="tr th" style="${COLS}"><span>COIN</span><span>CREATOR</span><span>MINT</span><span>WHEN</span></div>` +
    (launches.length ? launches.map((l) => `<div class="tr" style="${COLS};font-size:14px">
      <a class="row" style="gap:10px" href="https://pump.fun/coin/${esc(l.mint)}" target="_blank" rel="noopener">${l.image ? `<img src="${esc(l.image)}" alt="" style="width:28px;height:28px;border-radius:6px;object-fit:cover">` : ''}<span>${esc(l.name)} <span class="mono muted">$${esc(l.symbol)}</span></span></a>
      <a class="mono" href="/app#explore/${esc(l.creatorWallet)}">${l.username ? `@${esc(l.username)}` : esc(short(l.creatorWallet))}</a>
      <a class="mono muted" href="/app#explore/${esc(l.mint)}">${esc(short(l.mint))}</a>
      <span class="mono muted">${esc(ago(l.createdAt))}</span></div>`).join('')
    : '<div class="empty">No coins launched from WITNESS yet.</div>');
}
loadLaunches();
render();
