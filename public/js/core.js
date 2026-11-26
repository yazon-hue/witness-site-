// Shared front-end code: API calls, wallet sign-in, header/footer, formatting.

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export const short = (s, a = 4, b = 4) => (s && s.length > a + b + 1 ? `${s.slice(0, a)}…${s.slice(-b)}` : s || '');
export function ago(ts) {
  if (!ts) return '—';
  const d = Math.max(0, Date.now() / 1000 - ts);
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
export const utc = (ts) => ts ? new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—';
export const fmt = (n, d = 0) => Number(n || 0).toLocaleString('en-GB', { maximumFractionDigits: d });
export const STATUS_LABEL = { open: 'Open', under_review: 'Under review', verified: 'Verified', disputed: 'Disputed' };
export const badge = (s) => `<span class="badge b-${esc(s)}">${esc(STATUS_LABEL[s] || s)}</span>`;
export const solscan = (kind, v) => `https://solscan.io/${kind}/${encodeURIComponent(v)}`;

export async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(path, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || `Request failed (${r.status})`); e.status = r.status; throw e; }
  return j;
}

export function toast(msg, ms = 3200) {
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

// ---------- wallet & session ----------
export const session = { user: null, ready: null };
const listeners = new Set();
export const onAuth = (fn) => { listeners.add(fn); if (session.ready) session.ready.then(() => fn(session.user)); };
const emit = () => listeners.forEach((fn) => fn(session.user));

export function walletProvider() {
  if (window.phantom?.solana?.isPhantom) return window.phantom.solana;
  if (window.solflare?.isSolflare) return window.solflare;
  if (window.backpack?.isBackpack) return window.backpack;
  return window.solana || null;
}

const toB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
export { toB64 };

export async function signIn() {
  const p = walletProvider();
  if (!p) { toast('No Solana wallet found. Install Phantom, Solflare or Backpack, then reload.', 5000); throw new Error('no wallet'); }
  const c = await p.connect();
  const wallet = (c?.publicKey || p.publicKey).toBase58();
  const { message } = await api('/api/auth/nonce', { method: 'POST', body: { wallet } });
  const signed = await p.signMessage(new TextEncoder().encode(message), 'utf8');
  const sig = signed?.signature || signed;
  const { user } = await api('/api/auth/verify', { method: 'POST', body: { wallet, message, signature: toB64(new Uint8Array(sig)) } });
  session.user = user; emit(); renderHeaderAuth();
  return user;
}

export async function signOut() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  try { await walletProvider()?.disconnect?.(); } catch { /* ignore */ }
  session.user = null; emit(); renderHeaderAuth();
}

/** Run fn when signed in; prompts sign-in first if needed. */
export async function requireSignIn() {
  if (session.user) return session.user;
  try { return await signIn(); } catch (e) { if (e.message !== 'no wallet') toast(/reject|cancel|denied/i.test(e.message) ? 'Sign-in cancelled.' : e.message); return null; }
}

// ---------- header / footer ----------
const LOGO = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" stroke="#3987FF" stroke-width="1.6"/><circle cx="12" cy="12" r="3.2" stroke="#42D9FF" stroke-width="1.6"/></svg>`;

function renderHeaderAuth() {
  const slot = $('#auth-slot'); if (!slot) return;
  const u = session.user;
  slot.innerHTML = u
    ? `<div style="position:relative"><button class="wallet-btn on" id="acct" aria-haspopup="true" aria-expanded="false"><span class="d"></span><span>@${esc(u.username)}</span></button>
        <div class="menu hidden" id="acct-menu"><a href="/app#profile">Profile</a><a href="/app#watchlists">Watchlists</a><a href="/app#submit">Submit a discovery</a><button id="signout">Sign out</button></div></div>`
    : `<button class="wallet-btn" id="connect"><span class="d"></span><span>Connect Wallet</span></button>`;
  $('#connect')?.addEventListener('click', () => requireSignIn());
  const acct = $('#acct'), menu = $('#acct-menu');
  acct?.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); acct.setAttribute('aria-expanded', String(!menu.classList.contains('hidden'))); });
  document.addEventListener('click', () => menu?.classList.add('hidden'));
  $('#signout')?.addEventListener('click', signOut);
}

export function mountChrome(active, opts = {}) {
  const links = [['/app#explore', 'Explore', 'explore'], ['/investigations', 'Investigations', 'investigations'], ['/leaderboard', 'Leaderboard', 'leaderboard'], ['/how-it-works', 'How it works', 'how'], ['/launch', 'Launch', 'launch']];
  const header = document.createElement('header');
  header.className = `site-header${opts.headerClass ? ` ${opts.headerClass}` : ''}`;
  header.innerHTML = `<div class="wrap"><nav aria-label="Main"><a class="logo" href="/">${LOGO}WITNESS</a>
    <div class="navlinks">${links.map(([h, l, k]) => `<a href="${h}" class="${k === active ? 'on' : ''}">${l}</a>`).join('')}</div>
    <div id="auth-slot"><button class="wallet-btn"><span class="d"></span><span>Connect Wallet</span></button></div></nav></div>`;
  document.body.prepend(header);
  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.innerHTML = `<div class="wrap"><span style="letter-spacing:.16em;font-weight:600;color:var(--text)">WITNESS</span><span>Don't reward noise. Reward the truth.</span><span>Findings are community analysis, not financial or legal advice.</span></div>`;
  document.body.appendChild(footer);

  session.ready = api('/api/me').then((r) => { session.user = r.user; }).catch(() => {}).finally(() => { renderHeaderAuth(); emit(); });
  const p = walletProvider();
  p?.on?.('accountChanged', () => { if (session.user) signOut(); });
}

export function investigationCard(r) {
  return `<article class="feed-card">
    <div class="row" style="justify-content:space-between;gap:12px;align-items:flex-start">
      <div class="stack" style="gap:8px;min-width:0"><span class="eyebrow">${esc(r.category)}</span>
        <h3 style="margin:0;font-size:17px;font-weight:500;line-height:1.35"><a href="/investigation?id=${r.id}">${esc(r.title)}</a></h3></div>
      ${badge(r.status)}
    </div>
    <div class="meta3">
      <div><span>Wallet</span><span class="mono">${esc(short(r.wallet))}</span></div>
      <div><span>Chain</span><span>${esc(r.chain)}</span></div>
      <div><span>Discovered</span><span class="mono">${esc(ago(r.createdAt))}</span></div>
    </div>
    <div class="row" style="justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div style="font-size:13px;color:var(--muted)">by <a href="/app#profile/${esc(r.author)}" style="color:var(--text)">@${esc(r.author)}</a> · ${r.contributors} contributor${r.contributors === 1 ? '' : 's'}</div>
      <a class="btn btn-s btn-sm" href="/investigation?id=${r.id}">View investigation</a>
    </div>
  </article>`;
}
