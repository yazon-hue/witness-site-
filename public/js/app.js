import { mountChrome, api, esc, short, ago, utc, fmt, badge, solscan, investigationCard, $, $$, session, onAuth, requireSignIn, toast } from './core.js';

mountChrome('explore');

const TITLES = { overview: 'Intelligence Overview', explore: 'Explore', watchlists: 'Watchlists', submit: 'Submit a discovery', profile: 'Profile' };
const CATEGORIES = ['Token launch', 'Fund movement', 'Wallet cluster', 'Liquidity event', 'Attribution', 'Contract change', 'Other'];
const view = () => $('#view');
const signInBox = (what) => `<div class="card empty stack" style="gap:16px;align-items:center"><div>Connect your wallet to ${what}.</div><button class="btn btn-p" id="si">Connect Wallet</button><div class="hint">Signing in only proves you own the wallet. It never sends a transaction.</div></div>`;
const bindSignIn = () => $('#si')?.addEventListener('click', async () => { if (await requireSignIn()) route(); });

function route() {
  const [v, arg] = (location.hash.slice(1) || 'overview').split('/');
  const name = TITLES[v] ? v : 'overview';
  $$('.side a[data-v]').forEach((a) => a.classList.toggle('on', a.dataset.v === name));
  $('#heading').textContent = name === 'profile' && arg ? `@${decodeURIComponent(arg)}` : TITLES[name];
  $('#crumb').textContent = name === 'overview' ? 'Dashboard' : `Dashboard / ${TITLES[name]}`;
  ({ overview, explore, watchlists, submit, profile })[name](arg ? decodeURIComponent(arg) : '');
}
window.addEventListener('hashchange', route);
let booted = false;
onAuth(() => { if (!booted) { booted = true; route(); } else if (['watchlists', 'submit', 'profile'].includes((location.hash.slice(1) || '').split('/')[0])) route(); });

// ---------- Overview ----------
let feedFilter = 'all';
async function overview() {
  view().innerHTML = `
    <div class="grid-auto" id="metrics" style="grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr))">${'<div class="skeleton" style="height:104px"></div>'.repeat(4)}</div>
    <div class="row" style="justify-content:space-between;gap:12px;flex-wrap:wrap;margin:32px 0 18px">
      <div class="row mono" style="gap:10px;font-size:12px;letter-spacing:.16em;color:var(--soft)"><span class="live"></span>LIVE INTELLIGENCE FEED</div>
      <div class="wrap-row" style="gap:6px" id="filters">${[['all', 'All'], ['active', 'Active'], ['verified', 'Verified'], ['under_review', 'Under review'], ['disputed', 'Disputed']].map(([k, l]) => `<button class="pill ${k === feedFilter ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
    </div>
    <div id="feed" class="grid-auto" style="grid-template-columns:repeat(auto-fit,minmax(min(460px,100%),1fr))"></div>`;
  $$('#filters .pill').forEach((b) => b.onclick = () => { feedFilter = b.dataset.f; overview(); });
  api('/api/stats').then((s) => {
    const m = [['Active investigations', s.activeInvestigations], ['Verified discoveries', s.verifiedDiscoveries], ['Investigators online', s.investigatorsOnline, `of ${fmt(s.investigators)}`], ['Tracked wallets', s.trackedWallets]];
    $('#metrics').innerHTML = m.map(([l, v, sub]) => `<div class="metric"><div style="font-size:13px;color:var(--muted)">${l}</div><div class="row" style="justify-content:space-between;align-items:baseline"><span class="v">${fmt(v)}</span>${sub ? `<span class="mono" style="font-size:12px;color:var(--muted)">${sub}</span>` : ''}</div></div>`).join('');
  });
  const { investigations } = await api(`/api/investigations?status=${feedFilter}&limit=20`);
  $('#feed').innerHTML = investigations.length ? investigations.map(investigationCard).join('')
    : `<div class="card empty" style="grid-column:1/-1">Nothing here yet. <a href="#submit" style="color:var(--cyan)">Submit the first discovery</a>.</div>`;
}

// ---------- Explore ----------
async function explore(q) {
  view().innerHTML = `
    <form id="xf" class="wrap-row" style="gap:10px;margin-bottom:24px">
      <label for="xq" class="sr">Wallet address or transaction signature</label>
      <input id="xq" class="input mono" style="flex:1 1 360px" placeholder="Paste a Solana wallet address or transaction signature" value="${esc(q)}" autocomplete="off" spellcheck="false">
      <button class="btn btn-p">Investigate</button>
    </form>
    <div id="xr">${q ? '<div class="skeleton" style="height:320px"></div>' : '<div class="card empty">Look up any Solana wallet to see its balance, holdings, recent activity and the wallets it moves SOL with. Everything shown comes straight from the chain.</div>'}</div>`;
  $('#xf').onsubmit = (e) => { e.preventDefault(); const v = $('#xq').value.trim(); if (v) location.hash = `explore/${encodeURIComponent(v)}`; };
  if (!q) return;
  try {
    const d = await api(`/api/explore/${encodeURIComponent(q)}`);
    $('#xr').innerHTML = d.kind === 'transaction' ? renderTx(d) : renderAddress(d);
    $('#watch-add')?.addEventListener('click', async () => {
      if (!(await requireSignIn())) return;
      try { await api('/api/watchlist', { method: 'POST', body: { wallet: d.address } }); toast('Added to your watchlist.'); } catch (e) { toast(e.message); }
    });
  } catch (e) { $('#xr').innerHTML = `<div class="card empty err">${esc(e.message)}</div>`; }
}

function renderAddress(d) {
  return `<div class="stack" style="gap:16px">
    <div class="card pad stack" style="gap:14px">
      <div class="row" style="justify-content:space-between;gap:12px;flex-wrap:wrap"><span class="eyebrow l-confirmed">Confirmed on-chain</span>
        <div class="wrap-row" style="gap:8px"><button class="btn btn-s btn-sm" id="watch-add">Add to watchlist</button><a class="btn btn-s btn-sm" href="#submit/${esc(d.address)}">Open investigation</a><a class="btn btn-s btn-sm" href="${solscan('account', d.address)}" target="_blank" rel="noopener">Solscan ↗</a></div></div>
      <div class="mono break" style="font-size:15px">${esc(d.address)}</div>
      <div class="grid-auto" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
        <div class="metric"><span class="muted" style="font-size:12px">SOL balance</span><span class="v" style="font-size:24px">${fmt(d.balanceSol, 4)}</span></div>
        <div class="metric"><span class="muted" style="font-size:12px">Tokens held</span><span class="v" style="font-size:24px">${fmt(d.tokenCount)}</span></div>
        <div class="metric"><span class="muted" style="font-size:12px">Recent txs sampled</span><span class="v" style="font-size:24px">${fmt(d.sampled)}</span></div>
        <div class="metric"><span class="muted" style="font-size:12px">Oldest in sample</span><span class="v" style="font-size:16px">${esc(d.oldestSampled ? utc(d.oldestSampled) : '—')}</span></div>
      </div>
    </div>
    ${d.investigations.length ? `<div class="card pad stack" style="gap:10px"><span class="eyebrow">Investigations on this wallet</span>${d.investigations.map((i) => `<a class="kv" href="/investigation?id=${i.id}"><span style="color:var(--text)">${esc(i.title)}</span>${badge(i.status)}</a>`).join('')}</div>` : ''}
    <div class="grid-auto" style="grid-template-columns:repeat(auto-fit,minmax(min(380px,100%),1fr))">
      <div class="card pad stack"><span class="eyebrow" style="margin-bottom:8px">Counterparties by SOL moved</span>
        ${d.counterparties.length ? d.counterparties.map((c) => `<div class="kv"><a class="mono" href="#explore/${esc(c.address)}">${esc(short(c.address, 6, 6))}</a><span class="mono" style="text-align:right"><span class="l-confirmed">+${c.inSol}</span> / <span style="color:var(--soft)">−${c.outSol}</span> SOL · ${c.count}×</span></div>`).join('') : '<div class="hint">No SOL transfers in the recent sample.</div>'}
        <div class="hint" style="margin-top:10px">From the last ${d.sampled} transactions. A shared counterparty is a lead, not proof of common control.</div></div>
      <div class="card pad stack"><span class="eyebrow" style="margin-bottom:8px">Recent activity</span>
        ${d.recent.length ? d.recent.map((t) => `<div class="kv" style="flex-direction:column;gap:4px"><div class="row" style="justify-content:space-between;gap:10px"><a class="mono" href="#explore/${esc(t.signature)}" style="font-size:12px">${esc(short(t.signature, 8, 8))}</a><span class="mono muted" style="font-size:12px">${esc(ago(t.time))}</span></div><span style="color:var(--soft);font-size:13px;line-height:1.5">${esc(t.description || t.type)}</span></div>`).join('') : '<div class="hint">No recent transactions.</div>'}</div>
    </div>
    ${d.tokens.length ? `<div class="card pad stack"><span class="eyebrow" style="margin-bottom:8px">Token holdings</span>${d.tokens.map((t) => `<div class="kv"><a class="mono" href="${solscan('token', t.mint)}" target="_blank" rel="noopener">${esc(short(t.mint, 6, 6))} ↗</a><span class="mono">${fmt(t.amount, 4)}</span></div>`).join('')}</div>` : ''}
  </div>`;
}

function renderTx(d) {
  return `<div class="card pad stack" style="gap:14px">
    <div class="row" style="justify-content:space-between;gap:12px;flex-wrap:wrap"><span class="eyebrow l-confirmed">Confirmed on-chain · ${esc(d.type)}</span><a class="btn btn-s btn-sm" href="${solscan('tx', d.signature)}" target="_blank" rel="noopener">Solscan ↗</a></div>
    <div class="mono break" style="font-size:13px">${esc(d.signature)}</div>
    ${d.failed ? '<div class="err">This transaction failed on-chain.</div>' : ''}
    <p style="margin:0;color:var(--soft);line-height:1.6">${esc(d.description || 'No description available.')}</p>
    <div class="kv"><span>Time</span><span class="mono">${esc(utc(d.time))}</span></div>
    <div class="kv"><span>Fee payer</span><a class="mono" href="#explore/${esc(d.feePayer)}">${esc(short(d.feePayer, 6, 6))}</a></div>
    ${d.nativeTransfers.map((n) => `<div class="kv"><span class="mono"><a href="#explore/${esc(n.from)}">${esc(short(n.from))}</a> → <a href="#explore/${esc(n.to)}">${esc(short(n.to))}</a></span><span class="mono">${fmt(n.sol, 6)} SOL</span></div>`).join('')}
    ${d.tokenTransfers.map((n) => `<div class="kv"><span class="mono"><a href="#explore/${esc(n.from)}">${esc(short(n.from))}</a> → <a href="#explore/${esc(n.to)}">${esc(short(n.to))}</a></span><span class="mono">${fmt(n.amount, 4)} · ${esc(short(n.mint))}</span></div>`).join('')}
  </div>`;
}

// ---------- Watchlists ----------
async function watchlists() {
  if (!session.user) { view().innerHTML = signInBox('keep a watchlist'); return bindSignIn(); }
  view().innerHTML = `
    <form id="wf" class="card pad wrap-row" style="gap:10px;margin-bottom:20px;align-items:flex-end">
      <label class="f" style="flex:2 1 320px">Wallet address<input id="ww" class="input mono" placeholder="Solana address" autocomplete="off"></label>
      <label class="f" style="flex:1 1 180px">Label<input id="wl" class="input" maxlength="60" placeholder="e.g. Launch deployer"></label>
      <button class="btn btn-p">Add</button>
    </form>
    <div id="wlist"><div class="skeleton" style="height:180px"></div></div>`;
  $('#wf').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/watchlist', { method: 'POST', body: { wallet: $('#ww').value.trim(), label: $('#wl').value } }); watchlists(); }
    catch (err) { toast(err.message); }
  };
  const { items } = await api('/api/watchlist');
  $('#wlist').innerHTML = items.length ? `<div class="table"><div style="min-width:720px">
    <div class="tr th" style="grid-template-columns:1.6fr 1.4fr .8fr 90px"><span>WALLET</span><span>LAST ACTIVITY</span><span>CASES</span><span></span></div>
    ${items.map((w) => `<div class="tr" style="grid-template-columns:1.6fr 1.4fr .8fr 90px;font-size:13px">
      <div class="stack" style="gap:4px"><a class="mono" href="#explore/${esc(w.wallet)}">${esc(short(w.wallet, 6, 6))}</a><span class="muted" style="font-size:12px">${esc(w.label || 'No label')}</span></div>
      <span style="color:var(--soft)">${w.lastActivity ? `<a href="#explore/${esc(w.lastActivity.signature)}">${esc(ago(w.lastActivity.time))}</a>` : '—'}</span>
      <span class="mono">${w.investigations}</span>
      <button class="btn btn-s btn-sm" data-del="${w.id}">Remove</button></div>`).join('')}
  </div></div>` : '<div class="card empty">Your watchlist is empty. Add a wallet above, or from any Explore result.</div>';
  $$('[data-del]').forEach((b) => b.onclick = async () => { await api(`/api/watchlist/${b.dataset.del}`, { method: 'DELETE' }); watchlists(); });
}

// ---------- Submit ----------
function submit(prefill) {
  if (!session.user) { view().innerHTML = signInBox('submit a discovery'); return bindSignIn(); }
  view().innerHTML = `<div class="grid-auto" style="grid-template-columns:repeat(auto-fit,minmax(min(440px,100%),1fr));gap:28px;align-items:start">
    <form id="sf" class="card pad stack" style="gap:18px" novalidate>
      <label class="f">Title<input id="s-title" class="input" maxlength="140" placeholder="What did you find, in one line?"></label>
      <div class="grid-auto" style="grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr));gap:14px">
        <label class="f">Wallet under investigation<input id="s-wallet" class="input mono" placeholder="Solana address" value="${esc(prefill)}" autocomplete="off"></label>
        <label class="f">Category<select id="s-cat" class="input">${CATEGORIES.map((c) => `<option>${c}</option>`).join('')}</select></label>
      </div>
      <label class="f"><span class="l-confirmed">Confirmed on-chain data</span><textarea id="s-sigs" class="input mono" rows="4" placeholder="Transaction signatures or Solscan links, one per line"></textarea><span class="hint">Each one is checked against the chain automatically.</span></label>
      <label class="f"><span class="l-interp">Your interpretation</span><textarea id="s-interp" class="input" rows="4" maxlength="4000" placeholder="What you believe the transactions show, and why"></textarea></label>
      <label class="f"><span class="l-spec">Open questions (speculation)</span><textarea id="s-spec" class="input" rows="2" maxlength="2000" placeholder="Anything you suspect but cannot prove yet (optional)"></textarea></label>
      <label class="row" style="gap:10px;align-items:flex-start;font-size:13px;color:var(--muted);line-height:1.5"><input type="checkbox" id="s-ack" style="margin-top:3px;accent-color:var(--blue)">I have not presented speculation as fact, and I accept that reviewers may challenge this submission.</label>
      <div class="err" id="s-err" role="alert"></div>
      <button class="btn btn-p" id="s-btn">Submit for review</button>
    </form>
    <div class="stack" style="gap:14px"><span class="eyebrow">How review works</span>
      <div class="kv" style="justify-content:flex-start;gap:16px"><span class="mono" style="color:var(--blue)">01</span><span style="color:var(--soft);line-height:1.55">Your transactions are checked against Solana the moment you submit.</span></div>
      <div class="kv" style="justify-content:flex-start;gap:16px"><span class="mono" style="color:var(--blue)">02</span><span style="color:var(--soft);line-height:1.55">Other investigators confirm or challenge your reasoning. You cannot review your own case.</span></div>
      <div class="kv" style="justify-content:flex-start;gap:16px"><span class="mono" style="color:var(--blue)">03</span><span style="color:var(--soft);line-height:1.55">Reputation moves with the outcome, both ways. See <a href="/how-it-works" style="color:var(--cyan)">How it works</a>.</span></div>
    </div></div>`;
  $('#sf').onsubmit = async (e) => {
    e.preventDefault();
    if (!$('#s-ack').checked) { $('#s-err').textContent = 'Tick the box to confirm before submitting.'; return; }
    $('#s-btn').disabled = true; $('#s-err').textContent = '';
    try {
      const { id } = await api('/api/investigations', { method: 'POST', body: {
        title: $('#s-title').value, wallet: $('#s-wallet').value.trim(), category: $('#s-cat').value,
        signatures: $('#s-sigs').value, interpretation: $('#s-interp').value, speculation: $('#s-spec').value,
      } });
      location.href = `/investigation?id=${id}`;
    } catch (err) { $('#s-err').textContent = err.message; $('#s-btn').disabled = false; }
  };
}

// ---------- Profile ----------
async function profile(username) {
  const me = session.user;
  const target = username || me?.username;
  if (!target) { view().innerHTML = signInBox('see your profile'); return bindSignIn(); }
  view().innerHTML = '<div class="skeleton" style="height:260px"></div>';
  try {
    const [{ user, stats }, { investigations }] = await Promise.all([api(`/api/users/${encodeURIComponent(target)}`), api(`/api/investigations?author=${encodeURIComponent(target)}&limit=50`)]);
    const own = me && me.id === user.id;
    view().innerHTML = `<div class="grid-auto" style="grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr))">
      <div class="card pad stack" style="gap:16px">
        <div style="width:56px;height:56px;border-radius:14px;background:var(--card);border:1px solid var(--line2);display:flex;align-items:center;justify-content:center;font-weight:600;color:var(--cyan)">${esc(user.username.slice(0, 2).toUpperCase())}</div>
        <div class="stack" style="gap:4px"><div style="font-size:20px;font-weight:600">@${esc(user.username)}</div><a class="mono muted" style="font-size:12px" href="#explore/${esc(user.wallet)}">${esc(short(user.wallet, 6, 6))}</a><span class="muted" style="font-size:12px">Joined ${esc(ago(user.createdAt))}</span></div>
        ${user.bio ? `<p style="margin:0;color:var(--soft);font-size:14px;line-height:1.55">${esc(user.bio)}</p>` : ''}
        ${own ? `<form id="pf" class="stack" style="gap:12px;border-top:1px solid var(--line);padding-top:16px">
          <label class="f">Username<input id="p-user" class="input" value="${esc(user.username)}" maxlength="20"></label>
          <label class="f">Bio<textarea id="p-bio" class="input" rows="2" maxlength="200">${esc(user.bio)}</textarea></label>
          <div class="err" id="p-err"></div><button class="btn btn-s">Save profile</button></form>` : ''}
      </div>
      <div class="grid-auto" style="grid-template-columns:repeat(2,minmax(0,1fr));align-content:start">
        ${[['Reputation', fmt(stats.reputation)], ['Accuracy', stats.accuracy == null ? '—' : `${stats.accuracy}%`], ['Verified discoveries', stats.verified], ['Challenges won', `${stats.challengesWon} / ${stats.challenges}`]].map(([k, v]) => `<div class="metric"><span class="muted" style="font-size:12px">${k}</span><span class="v" style="font-size:24px">${esc(v)}</span></div>`).join('')}
      </div></div>
      <h2 style="margin:36px 0 16px;font-size:18px;font-weight:600">Investigations</h2>
      <div class="grid-auto" style="grid-template-columns:repeat(auto-fit,minmax(min(460px,100%),1fr))">${investigations.length ? investigations.map(investigationCard).join('') : '<div class="card empty" style="grid-column:1/-1">No investigations yet.</div>'}</div>`;
    $('#pf')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { const r = await api('/api/me', { method: 'PATCH', body: { username: $('#p-user').value, bio: $('#p-bio').value } }); session.user = r.user; toast('Profile saved.'); location.hash = 'profile'; location.reload(); }
      catch (err) { $('#p-err').textContent = err.message; }
    });
  } catch (e) { view().innerHTML = `<div class="card empty err">${esc(e.message)}</div>`; }
}
