import { mountChrome, api, esc, short, ago, badge, $, $$ } from './core.js';

mountChrome('investigations');

const TABS = [['all', 'All'], ['open', 'Open'], ['under_review', 'Under review'], ['verified', 'Verified'], ['disputed', 'Disputed']];
let tab = new URLSearchParams(location.search).get('status') || 'all';
let timer;
const COLS = 'grid-template-columns:2.2fr 1fr 1fr .7fr .9fr';

function renderTabs() {
  $('#tabs').innerHTML = TABS.map(([k, l]) => `<button class="pill ${k === tab ? 'on' : ''}" data-k="${k}">${l}</button>`).join('');
  $$('#tabs .pill').forEach((b) => b.onclick = () => { tab = b.dataset.k; renderTabs(); load(); });
}

async function load() {
  const q = $('#q').value.trim();
  try {
    const { investigations } = await api(`/api/investigations?status=${tab}&limit=100&q=${encodeURIComponent(q)}`);
    $('#rows').innerHTML = `<div class="tr th" style="${COLS}"><span>INVESTIGATION</span><span>CATEGORY</span><span>INVESTIGATOR</span><span>CONTRIB.</span><span>STATUS</span></div>` +
      (investigations.length ? investigations.map((r) => `<a class="tr" style="${COLS}" href="/investigation?id=${r.id}">
        <div class="stack" style="gap:6px;min-width:0"><span style="font-size:15px;font-weight:500">${esc(r.title)}</span><span class="mono muted" style="font-size:12px">${esc(short(r.wallet, 6, 6))} · ${esc(ago(r.createdAt))}</span></div>
        <span class="muted" style="font-size:13px">${esc(r.category)}</span>
        <span style="font-size:13px">@${esc(r.author)}</span>
        <span class="mono muted" style="font-size:13px">${r.contributors}</span>
        <span>${badge(r.status)}</span></a>`).join('')
        : `<div class="empty">${q || tab !== 'all' ? 'No investigations match.' : 'No investigations yet. <a href="/app#submit" style="color:var(--cyan)">Submit the first one</a>.'}</div>`);
  } catch (e) { $('#rows').innerHTML = `<div class="empty err">${esc(e.message)}</div>`; }
}

$('#q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 250); });
renderTabs(); load();
