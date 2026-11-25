import { mountChrome, api, esc, short, ago, utc, badge, solscan, $, onAuth, requireSignIn, session, toast } from './core.js';

mountChrome('investigations');
const id = Number(new URLSearchParams(location.search).get('id'));
const root = $('#root');

let checksEnabled = true, polls = 0;
const onchainBadge = (e) => !checksEnabled && e.onchain == null ? '<span class="badge b-open" title="On-chain checks are not switched on for this site">Not checked</span>' : e.onchain === 1
  ? `<span class="badge b-verified" title="Found on Solana and succeeded">On-chain ✓</span>${e.involvesWallet ? '' : ' <span class="badge b-under_review" title="The investigated wallet does not appear in this transaction">Wallet not in tx</span>'}`
  : e.onchain === 0 ? '<span class="badge b-disputed" title="Not found, or the transaction failed">Not found</span>'
  : '<span class="badge b-open">Checking…</span>';

async function load() {
  if (!id) { root.innerHTML = '<div class="card empty">No investigation selected. <a href="/investigations" style="color:var(--cyan)">Browse investigations</a>.</div>'; return; }
  let d;
  try { d = await api(`/api/investigations/${id}`); }
  catch (e) { root.innerHTML = `<div class="card empty err">${esc(e.message)}</div>`; return; }
  const i = d.investigation, v = d.viewer, R = d.rules;
  checksEnabled = d.checksEnabled;
  document.title = `WITNESS — ${i.title}`;
  const total = i.confirms + i.challenges;
  const pct = total ? Math.round((i.confirms / total) * 100) : 0;

  let reviewBlock;
  if (!session.user) reviewBlock = '<button class="btn btn-p" id="rv-signin">Connect wallet to review</button>';
  else if (v?.isAuthor) reviewBlock = '<div class="hint">You opened this investigation, so you cannot review it. You can still add evidence.</div>';
  else if (v?.review) reviewBlock = `<div class="hint">You ${v.review === 'confirm' ? 'confirmed' : 'challenged'} this finding.</div>`;
  else reviewBlock = `<div class="row" style="gap:8px"><button class="btn btn-p" style="flex:1" id="rv-confirm">Confirm</button><button class="btn btn-d" style="flex:1" id="rv-challenge">Challenge</button></div>
    <form id="rv-form" class="stack hidden" style="gap:10px"><label class="f" for="rv-text" id="rv-label">Comment</label><textarea id="rv-text" class="input" rows="3" maxlength="2000"></textarea><div class="err" id="rv-err"></div><button class="btn btn-s" id="rv-send">Submit</button></form>`;

  root.innerHTML = `
    <a href="/investigations" class="mono muted" style="font-size:12px;letter-spacing:.08em">← ALL INVESTIGATIONS</a>
    <div class="stack" style="gap:16px">
      <div class="wrap-row" style="gap:10px;align-items:center">${badge(i.status)}<span class="mono muted" style="font-size:11px;letter-spacing:.08em">CASE WX-${String(i.id).padStart(5, '0')} · ${esc(i.category.toUpperCase())} · ${esc(i.chain.toUpperCase())}</span></div>
      <h1 style="margin:0;font-size:clamp(28px,4vw,44px);line-height:1.12;font-weight:600;letter-spacing:-.025em;max-width:860px">${esc(i.title)}</h1>
      <div class="wrap-row" style="gap:24px;font-size:13px;color:var(--muted)">
        <span>Opened by <a href="/app#profile/${esc(i.author)}" style="color:var(--text)">@${esc(i.author)}</a></span><span class="mono">${esc(utc(i.createdAt))}</span><span>${i.contributors} contributor${i.contributors === 1 ? '' : 's'}</span>
        <a class="mono" href="/app#explore/${esc(i.wallet)}" style="color:var(--cyan)">${esc(short(i.wallet, 6, 6))}</a>
      </div>
    </div>
    <div class="wrap-row" style="gap:24px;align-items:flex-start">
      <div class="stack" style="flex:999 1 560px;min-width:0;gap:20px">
        <section class="card" style="overflow:hidden">
          <div class="row" style="padding:18px 22px;border-bottom:1px solid var(--line);justify-content:space-between;gap:12px;flex-wrap:wrap"><span class="eyebrow l-confirmed">1 · Confirmed on-chain data</span><span class="hint">Checked automatically against Solana</span></div>
          <div style="overflow-x:auto"><div style="min-width:620px">
            ${d.evidence.map((e) => `<div class="row" style="padding:14px 22px;border-top:1px solid #141E30;gap:16px;justify-content:space-between">
              <div class="stack" style="gap:4px;min-width:0"><a class="mono" href="${solscan('tx', e.signature)}" target="_blank" rel="noopener" style="color:var(--cyan);font-size:13px">${esc(short(e.signature, 10, 10))} ↗</a>
              <span class="muted" style="font-size:12px">${e.blockTime ? esc(utc(e.blockTime)) + ' · ' : ''}added by @${esc(e.by)}${e.note ? ` · ${esc(e.note)}` : ''}</span></div>
              <div class="row" style="gap:6px;flex-shrink:0">${onchainBadge(e)}</div></div>`).join('')}
          </div></div>
          <form id="ev-form" class="wrap-row" style="gap:10px;padding:16px 22px;border-top:1px solid var(--line);background:var(--deep)">
            <label for="ev-sig" class="sr">Transaction signature</label><input id="ev-sig" class="input mono" style="flex:2 1 260px" placeholder="Add a transaction signature or Solscan link" autocomplete="off">
            <label for="ev-note" class="sr">Note</label><input id="ev-note" class="input" style="flex:1 1 160px" maxlength="500" placeholder="What it shows (optional)">
            <button class="btn btn-s">Add evidence</button>
          </form>
        </section>
        <section class="card pad stack" style="gap:12px"><span class="eyebrow l-interp">2 · Interpretation</span>
          <p style="margin:0;font-size:15px;line-height:1.7;color:var(--soft);white-space:pre-line">${esc(i.interpretation)}</p></section>
        ${i.speculation ? `<section class="card pad stack" style="gap:12px"><span class="eyebrow l-spec">3 · Speculation · not established</span>
          <p style="margin:0;font-size:15px;line-height:1.7;color:var(--soft);white-space:pre-line">${esc(i.speculation)}</p></section>` : ''}
        ${d.reviews.length ? `<section class="stack" style="gap:4px"><span class="eyebrow" style="margin-bottom:8px">Reviews</span>
          ${d.reviews.map((r) => `<div class="kv" style="flex-direction:column;gap:6px;align-items:flex-start"><div class="row" style="gap:10px"><span class="badge ${r.verdict === 'confirm' ? 'b-verified' : 'b-disputed'}">${r.verdict === 'confirm' ? 'Confirmed' : 'Challenged'}</span><a href="/app#profile/${esc(r.by)}">@${esc(r.by)}</a><span class="mono muted" style="font-size:12px">${esc(ago(r.createdAt))}</span></div>${r.comment ? `<p style="margin:0;color:var(--soft);font-size:14px;line-height:1.6;white-space:pre-line">${esc(r.comment)}</p>` : ''}</div>`).join('')}</section>` : ''}
        <section class="stack"><span class="eyebrow" style="margin-bottom:8px">Activity</span>
          ${d.activity.map((a) => `<div class="kv" style="justify-content:flex-start;gap:16px"><span class="mono" style="width:80px;flex-shrink:0;font-size:12px">${esc(ago(a.at))}</span><span style="color:var(--soft)"><a href="/app#profile/${esc(a.by)}" style="color:var(--text)">@${esc(a.by)}</a> ${esc(a.text)}</span></div>`).join('')}</section>
      </div>
      <aside class="stack" style="flex:1 1 300px;gap:16px">
        <div class="card pad stack" style="gap:16px;background:var(--card)">
          <span class="eyebrow">Community review</span>
          <div class="row" style="justify-content:space-between;align-items:baseline"><span style="font-size:28px;font-weight:600">${i.confirms} <span class="muted" style="font-size:14px;font-weight:400">confirm</span></span><span style="color:var(--bad)">${i.challenges} challenge</span></div>
          <div style="height:6px;border-radius:3px;background:#1A2536;overflow:hidden;display:flex">${total ? `<div style="width:${pct}%;background:var(--ok)"></div><div style="flex:1;background:var(--bad);opacity:.7"></div>` : ''}</div>
          <div class="hint">Verified at ${R.verifyMin}+ confirmations with at least ${R.verifyRatio} for every challenge. Disputed at ${R.disputeMin}+ challenges that match or outnumber confirmations.</div>
          ${reviewBlock}
        </div>
        <div class="card pad stack"><span class="eyebrow" style="margin-bottom:8px">Contributors</span>
          ${d.contributors.map((c) => `<div class="kv"><a href="/app#profile/${esc(c.username)}">@${esc(c.username)}</a><span class="mono muted">REP ${c.reputation}</span></div>`).join('')}</div>
      </aside>
    </div>`;

  $('#ev-form').onsubmit = async (e) => {
    e.preventDefault();
    if (!(await requireSignIn())) return;
    try { await api(`/api/investigations/${id}/evidence`, { method: 'POST', body: { signature: $('#ev-sig').value.trim(), note: $('#ev-note').value } }); toast('Evidence added and checked on-chain.'); load(); }
    catch (err) { toast(err.message); }
  };
  $('#rv-signin')?.addEventListener('click', async () => { if (await requireSignIn()) load(); });
  let verdict = null;
  const open = (vd) => {
    verdict = vd; $('#rv-form').classList.remove('hidden');
    $('#rv-label').textContent = vd === 'confirm' ? 'Why does the evidence hold up? (optional)' : 'What does the evidence not support? (required)';
    $('#rv-send').textContent = vd === 'confirm' ? 'Submit confirmation' : 'Submit challenge';
    $('#rv-text').focus();
  };
  $('#rv-confirm')?.addEventListener('click', () => open('confirm'));
  $('#rv-challenge')?.addEventListener('click', () => open('challenge'));
  $('#rv-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api(`/api/investigations/${id}/reviews`, { method: 'POST', body: { verdict, comment: $('#rv-text').value } }); toast('Review recorded.'); load(); }
    catch (err) { $('#rv-err').textContent = err.message; }
  });

  if (checksEnabled && d.evidence.some((e) => e.onchain == null) && polls++ < 8) setTimeout(load, 4000); // refresh while checks run
}

onAuth(() => load());
