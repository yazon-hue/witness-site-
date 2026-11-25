import { mountChrome, api, esc, short, fmt, $, $$ } from './core.js';

mountChrome('leaderboard');
const PERIODS = [['week', 'This week'], ['month', 'This month'], ['all', 'All time']];
let period = 'all';
const COLS = 'grid-template-columns:60px 1.6fr 1fr .8fr .8fr .8fr';
const acc = (a) => (a == null ? '—' : `${a}%`);

async function load() {
  $('#periods').innerHTML = PERIODS.map(([k, l]) => `<button class="pill ${k === period ? 'on' : ''}" data-k="${k}">${l}</button>`).join('');
  $$('#periods .pill').forEach((b) => b.onclick = () => { period = b.dataset.k; load(); });
  const { leaders } = await api(`/api/leaderboard?period=${period}`);
  $('#top').innerHTML = leaders.slice(0, 3).map((t, i) => `
    <a class="card pad stack" href="/app#profile/${esc(t.username)}" style="gap:20px;border-color:${i === 0 ? 'rgba(57,135,255,.5)' : 'var(--line)'}">
      <div class="row" style="justify-content:space-between"><span class="mono" style="color:${i === 0 ? 'var(--cyan)' : 'var(--muted)'}">#${t.rank}</span><span class="mono muted" style="font-size:12px">${esc(short(t.wallet))}</span></div>
      <span style="font-size:22px;font-weight:600">@${esc(t.username)}</span>
      <div class="grid-auto" style="grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding-top:16px;border-top:1px solid var(--line)">
        <div class="stack" style="gap:4px"><span class="muted" style="font-size:11px">Reputation</span><span style="font-size:18px;font-weight:600">${fmt(t.reputation)}</span></div>
        <div class="stack" style="gap:4px"><span class="muted" style="font-size:11px">Accuracy</span><span style="font-size:18px;font-weight:600;color:var(--ok)">${acc(t.accuracy)}</span></div>
        <div class="stack" style="gap:4px"><span class="muted" style="font-size:11px">Verified</span><span style="font-size:18px;font-weight:600">${t.verified}</span></div>
      </div></a>`).join('');
  $('#rows').innerHTML = `<div class="tr th" style="${COLS}"><span>RANK</span><span>INVESTIGATOR</span><span>REPUTATION</span><span>ACCURACY</span><span>VERIFIED</span><span>REVIEWS</span></div>` +
    (leaders.length ? leaders.slice(3).map((r) => `<a class="tr" style="${COLS};font-size:14px" href="/app#profile/${esc(r.username)}">
      <span class="mono muted">${r.rank}</span><span>@${esc(r.username)}</span><span class="mono">${fmt(r.reputation)}</span><span class="mono" style="color:var(--ok)">${acc(r.accuracy)}</span><span class="mono">${r.verified}</span><span class="mono muted">${r.reviews}</span></a>`).join('')
      : '<div class="empty">No ranked investigators yet for this period.</div>');
  if (leaders.length && leaders.length <= 3) $('#rows').insertAdjacentHTML('beforeend', '<div class="empty">Everyone ranked so far is shown above.</div>');
}
load();
