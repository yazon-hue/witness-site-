import { mountChrome, api, $ } from './core.js';

mountChrome('how');

api('/api/stats').then(({ rules: R }) => {
  const p = R.points, sign = (n) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);
  const rows = [
    ['Your finding is verified', p.authoredVerified],
    ['On-chain evidence added to someone else’s case', p.evidenceOnchain],
    ['You confirmed a finding that ended verified', p.confirmRight],
    ['You challenged a finding that ended disputed', p.challengeRight],
    ['You reviewed against the final outcome', p.reviewWrong],
    ['Your finding is disputed', p.authoredDisputed],
  ];
  $('#points').innerHTML = rows.map(([a, v]) => `<div class="kv" style="padding:16px 22px;border-top:0;border-bottom:1px solid #141E30"><span style="color:var(--soft)">${a}</span><span class="mono" style="color:${v > 0 ? 'var(--ok)' : 'var(--bad)'}">${sign(v)}</span></div>`).join('');
  $('#status-rule').textContent = `A finding is verified once it has ${R.verifyMin} or more confirmations and at least ${R.verifyRatio} for every challenge. It is disputed once ${R.disputeMin} or more challenges match or outnumber confirmations. Reputation follows those outcomes.`;
});
