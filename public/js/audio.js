// WITNESS audio layer: controls, preference, and the scroll-reactive moments.
// The site always starts silent. Sound only begins after the visitor chooses it
// (one click), and a remembered "on" preference resumes on their first click or key press.
import { Sonic } from './sonic.js';

const KEY = 'witness.audio';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const save = (p) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode */ } };

// The opening sound carries the whole page: the same bright bed, soft pulse and shimmer
// from top to bottom, never darkening. Sections only nudge it very slightly.
const OPENING = { drone: 1, shimmer: 0.45, pulse: 0.55, signals: 0 };
const SCENES = {
  hero: OPENING,
  trace: OPENING,
  closer: { ...OPENING, pulse: 0.65 },   // the pulse leans in a touch while the investigation unfolds
  together: OPENING,
  product: OPENING,
  finale: { ...OPENING, drone: 0.85 },   // stays bright; the logo moment blooms on top
};

const WAVE = '<span class="wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span>';

export function mountAudio({ header }) {
  if (!(window.AudioContext || window.webkitAudioContext)) return { closer() {} };
  const pref = { on: false, vol: 0.2, ...load() };          // volume starts at 20%
  if (pref.vol === 0.6) pref.vol = 0.2;                      // the old default, never changed by the visitor
  let engine = null, scene = 'hero', lastStage = -1, impactArmed = true;

  // ── nav control (sits beside the wallet button) ────────────────
  const slot = header.querySelector('#auth-slot');
  const right = document.createElement('div'); right.className = 'nav-right';
  slot.replaceWith(right);
  const ctl = document.createElement('div'); ctl.className = 'audio-ctl';
  ctl.innerHTML = `
    <button class="audio-btn" aria-haspopup="true" aria-expanded="false" aria-label="Sound settings">${WAVE}<span class="audio-lbl mono">Audio off</span></button>
    <div class="audio-pop hidden" role="group" aria-label="Sound">
      <button class="audio-toggle mono" aria-pressed="false">Turn audio on</button>
      <label class="audio-vol mono"><span>Volume</span><input type="range" min="0" max="100" step="1" aria-label="Volume"></label>
    </div>`;
  right.append(ctl, slot);
  const btn = ctl.querySelector('.audio-btn'), lbl = ctl.querySelector('.audio-lbl'), pop = ctl.querySelector('.audio-pop');
  const toggle = ctl.querySelector('.audio-toggle'), range = ctl.querySelector('input');
  range.value = Math.round(pref.vol * 100);

  // ── understated invitation (top centre of the hero, never a popup) ──
  const invite = document.createElement('div');
  invite.className = 'audio-invite';
  invite.innerHTML = `${WAVE}<span class="mono">Experience WITNESS with sound</span><button class="mono invite-on">Enable audio</button><button class="invite-x" aria-label="No thanks">×</button>`;
  document.body.appendChild(invite);
  // only ask people who haven't chosen yet, and only while they're still at the opening
  if (!('on' in load())) setTimeout(() => { if (scrollY < innerHeight * 0.35) invite.classList.add('show'); }, 2600);

  function render() {
    const playing = pref.on && engine?.ctx.state === 'running';
    ctl.classList.toggle('on', pref.on); ctl.classList.toggle('playing', playing);
    lbl.textContent = pref.on ? 'Audio on' : 'Audio off';
    btn.setAttribute('aria-label', `Sound settings (audio ${pref.on ? 'on' : 'off'})`);
    btn.title = pref.on ? 'Audio on' : 'Audio off';
    toggle.textContent = pref.on ? 'Turn audio off' : 'Turn audio on';
    toggle.setAttribute('aria-pressed', String(pref.on));
  }

  async function enable() {
    pref.on = true; save(pref);
    range.value = Math.round(pref.vol * 100);
    invite.classList.remove('show');
    if (!engine) { engine = new Sonic(); engine.vol = pref.vol; }
    engine.mix(SCENES[scene], 0.01);
    await engine.start();
    render();
  }
  function disable() { pref.on = false; save(pref); engine?.stop(); render(); }

  btn.addEventListener('click', (e) => { e.stopPropagation(); pop.classList.toggle('hidden'); btn.setAttribute('aria-expanded', String(!pop.classList.contains('hidden'))); engine?.uiTransition(); });
  toggle.addEventListener('click', () => (pref.on ? disable() : enable()));
  range.addEventListener('input', () => { pref.vol = range.value / 100; save(pref); engine?.setVolume(pref.vol); });
  document.addEventListener('click', (e) => { if (!ctl.contains(e.target)) { pop.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false'); } });
  invite.querySelector('.invite-on').addEventListener('click', enable);
  invite.querySelector('.invite-x').addEventListener('click', () => { invite.classList.remove('show'); pref.on = false; save(pref); render(); });

  // a remembered "on" resumes on the visitor's first click or key press (a real gesture, no autoplay tricks)
  if (pref.on) {
    const resume = () => { removeEventListener('pointerdown', resume, true); removeEventListener('keydown', resume, true); if (pref.on) enable(); };
    addEventListener('pointerdown', resume, true); addEventListener('keydown', resume, true);
  }
  // pause the engine while the tab is hidden
  document.addEventListener('visibilitychange', () => {
    if (!engine || !pref.on) return;
    if (document.hidden) engine.ctx.suspend(); else engine.ctx.resume().then(render);
  });

  // ── scroll: which section is on screen, and the finale moment ──
  const sections = [['hero', '.hero'], ['trace', '.trace'], ['closer', '#closer'], ['together', '.together'], ['product', '.reveal'], ['finale', '.finale']]
    .map(([name, sel]) => [name, document.querySelector(sel)]);
  function update() {
    // the invitation only belongs to the opening; once they scroll on, it bows out (the nav control stays)
    if (scrollY > innerHeight * 0.35) invite.classList.remove('show');
    const mid = innerHeight / 2;
    const hit = sections.find(([, el]) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.top <= mid && r.bottom > mid; });
    if (hit) scene = hit[0];
    if (engine && pref.on) engine.mix(SCENES[scene], 2.5);
    // the finale bloom lands as the logo arrives; re-armed once they scroll back up
    const mark = document.querySelector('.finale-mark');
    if (mark) {
      const r = mark.getBoundingClientRect(), visible = r.top < innerHeight * 0.62 && r.bottom > 0;
      if (visible && impactArmed) { impactArmed = false; engine?.impact(); }
      if (r.top > innerHeight) impactArmed = true;
    }
  }
  let ticking = false;
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; update(); }); } }, { passive: true });

  // ── selected interaction sounds, throttled so nothing stacks up ─
  const last = new WeakMap(); let lastAny = 0;
  const allow = (el, gap) => { const t = performance.now(); if (t - lastAny < 90 || t - (last.get(el) || 0) < gap) return false; last.set(el, t); lastAny = t; return true; };
  document.addEventListener('pointerover', (e) => {
    const el = e.target.closest('.l-btn, .site-header .wallet-btn');
    if (el && !el.contains(e.relatedTarget) && allow(el, 600)) engine?.uiHover();
  });
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a, button'); if (!a || !engine) return;
    if (a.closest('.audio-ctl, .audio-invite')) return;
    if (a.matches('[href*="investigation?"], [data-src="case"]')) { if (allow(a, 300)) engine.uiActivate(); }
    else if (a.matches('.l-btn-p')) { if (allow(a, 300)) engine.uiClick(); }
    else if (a.matches('#tabs [role="tab"], #acct')) { if (allow(a, 250)) engine.uiTransition(); }
  }, true);

  render();
  return {
    // called by the Look closer sequence: a clean signal each time a new connection forms on screen
    closer(stage) {
      if (stage !== lastStage) {
        if (stage > lastStage && lastStage !== -1) engine?.connect(0.7 + stage * 0.15);
        lastStage = stage;
      }
    },
  };
}
