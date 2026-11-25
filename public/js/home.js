import { mountChrome, api, investigationCard, $ } from './core.js';

mountChrome('home');

api('/api/investigations?limit=6').then(({ investigations }) => {
  $('#feed').innerHTML = investigations.length
    ? investigations.map(investigationCard).join('')
    : `<div class="card empty" style="grid-column:1/-1">No investigations yet. Be the first: <a href="/app#submit" style="color:var(--cyan)">submit a discovery</a>.</div>`;
}).catch(() => { $('#feed').innerHTML = `<div class="card empty" style="grid-column:1/-1">The feed could not load. Refresh to try again.</div>`; });
