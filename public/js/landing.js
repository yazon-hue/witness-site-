// WITNESS landing page: art direction, motion and microinteractions.
// Uses the same header, wallet sign-in and API as the rest of the site.
import { mountChrome, api, $, $$ } from './core.js';
import { mountLens } from './lens.js';
import { mountCloser } from './closer.js';
import { initMotion } from './motion.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
// GSAP drives the scroll choreography when it loaded; otherwise the simpler built-in motion runs
const motionOn = !reduced && !!(window.gsap && window.ScrollTrigger);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => 1 - Math.pow(1 - t, 3);

mountChrome('home', { headerClass: 'overlay' });
const header = $('.site-header');

/** 0 when the element's top hits the bottom of the viewport, 1 when its bottom leaves the top. */
function progressOf(el, start = 1, end = 0) {
  const r = el.getBoundingClientRect();
  const from = innerHeight * start, to = innerHeight * end - r.height;
  return clamp((from - r.top) / (from - to));
}

// ── reveal on view ────────────────────────────────────────────────
const io = new IntersectionObserver((entries) => entries.forEach((e) => {
  if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
}), { threshold: 0.18, rootMargin: '0px 0px -6% 0px' });
$$('.rv, .rv-lines, .sec-label, .closer-title, .finale-mark').forEach((el) => io.observe(el));
requestAnimationFrame(() => $('.hero-title').classList.add('in'));

// ── 01 hero lens ─────────────────────────────────────────────────
const hero = $('.hero');
const lens = mountLens($('#lens'), hero, { reduced });

// ── 02 trace illustration ────────────────────────────────────────
const traceSvg = $('#trace-net');
const tracePaths = buildTrace(traceSvg);

function buildTrace(svg) {
  const NS = 'http://www.w3.org/2000/svg';
  let seed = 11; const R = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const addr = () => Array.from({ length: 4 }, () => B58[(R() * 58) | 0]).join('') + '…' + Array.from({ length: 4 }, () => B58[(R() * 58) | 0]).join('');
  const cols = [1, 3, 5, 6, 5, 7, 4, 5, 2];
  const W = 1200, H = 460, pad = 40;
  const layers = cols.map((n, ci) => Array.from({ length: n }, (_, i) => ({
    x: pad + (ci / (cols.length - 1)) * (W - pad * 2) + (R() - 0.5) * 30,
    y: n === 1 ? H / 2 : 50 + (i / (n - 1)) * (H - 100) + (R() - 0.5) * 34,
    ci,
  })));
  // the highlighted path: one node per column
  const path = layers.map((l, ci) => (ci === 0 ? 0 : Math.min(l.length - 1, Math.floor(l.length / 2) + (ci % 2 ? -1 : 0))));
  const gE = document.createElementNS(NS, 'g'), gN = document.createElementNS(NS, 'g'), gL = document.createElementNS(NS, 'g');
  svg.append(gE, gN, gL);
  const items = [];
  const curve = (a, b) => { const mx = (a.x + b.x) / 2; return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} C${mx.toFixed(1)} ${a.y.toFixed(1)} ${mx.toFixed(1)} ${b.y.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`; };
  let edges = 0;
  for (let ci = 0; ci < layers.length - 1; ci++) {
    layers[ci].forEach((a, ai) => {
      const next = layers[ci + 1];
      const links = new Set([Math.floor(R() * next.length)]);
      if (R() < 0.4) links.add(Math.floor(R() * next.length));
      if (ai === path[ci]) links.add(path[ci + 1]);
      links.forEach((bi) => {
        const hl = ai === path[ci] && bi === path[ci + 1];
        const el = document.createElementNS(NS, 'path');
        el.setAttribute('d', curve(a, next[bi]));
        el.setAttribute('class', `e${hl ? ' hl' : ''}`);
        gE.appendChild(el); edges++;
        items.push({ el, kind: 'e', at: ci / (layers.length - 1), hl });
      });
    });
  }
  // lift highlighted edges above the rest
  $$('.e.hl', gE).forEach((el) => gE.appendChild(el));
  layers.forEach((l, ci) => l.forEach((n, i) => {
    const hl = i === path[ci];
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', n.x.toFixed(1)); c.setAttribute('cy', n.y.toFixed(1)); c.setAttribute('r', hl ? 5 : 3);
    c.setAttribute('class', `nd${hl ? ' hl' : ''}`);
    gN.appendChild(c);
    items.push({ el: c, kind: 'n', at: ci / (layers.length - 1), hl });
    if (hl || R() < 0.12) {
      const t = document.createElementNS(NS, 'text');
      const right = ci >= layers.length - 2;
      t.setAttribute('x', (n.x + (right ? -9 : 9)).toFixed(1)); t.setAttribute('y', (n.y - 9).toFixed(1));
      if (right) t.setAttribute('text-anchor', 'end');
      t.setAttribute('class', `lb${hl ? ' hl' : ''}`);
      t.textContent = hl && ci === 0 ? `${addr()} · origin` : hl && ci === layers.length - 1 ? `${addr()} · exchange` : addr();
      gL.appendChild(t);
      items.push({ el: t, kind: 'l', at: ci / (layers.length - 1), hl });
    }
  }));
  // a single straight line first: the trace that splits into the network
  const first = layers[0][0], last = layers[layers.length - 1][path[layers.length - 1]];
  const lead = document.createElementNS(NS, 'path');
  lead.setAttribute('d', `M${first.x.toFixed(1)} ${first.y.toFixed(1)} L${last.x.toFixed(1)} ${first.y.toFixed(1)}`);
  lead.setAttribute('class', 'e hl lead');
  gE.appendChild(lead);
  items.push({ el: lead, kind: 'lead', at: 0, hl: true });
  for (const it of items) if (it.kind === 'e' || it.kind === 'lead') { it.len = it.el.getTotalLength() || 1; it.el.style.strokeDasharray = it.len; it.el.style.strokeDashoffset = it.len; }
  const nodes = layers.flat().length;
  const cap = $('.trace-caps span');
  if (cap) cap.textContent = `Fig. 02 — ${nodes} wallets · ${edges} transfers · 1 path`;
  return items;
}

let traceP = 0;
function drawTrace(p) {
  traceP = p;
  // 0–0.12: one straight line draws; then it hands over to the network, which splits out of it
  const net = clamp((p - 0.12) / 0.88);
  for (const it of tracePaths) {
    if (it.kind === 'lead') { it.el.style.strokeDashoffset = it.len * (1 - ease(clamp(p / 0.12))); it.el.style.opacity = 1 - clamp((net - 0.05) / 0.25); continue; }
    const local = clamp((net - it.at * 0.75) / 0.25);
    if (it.kind === 'e') it.el.style.strokeDashoffset = it.len * (1 - ease(local));
    else { const v = clamp(local * 2.2); it.el.style.opacity = v; if (it.kind === 'n') it.el.style.transform = `scale(${lerp(0.2, 1, ease(v))})`; }
  }
}

// ── 03 look closer ───────────────────────────────────────────────
const stageEls = $$('#stages li');
const hudDepth = $('#hud-depth'), hudNodes = $('#hud-nodes'), hudBar = $('#hud-bar');
const closerApi = mountCloser($('#closer'), $('#net3d'), {
  reduced,
  external: motionOn,
  onStage(stage, p, count) {
    stageEls.forEach((li, i) => { li.classList.toggle('on', reduced || i === stage); li.classList.toggle('done', !reduced && i < stage); });
    hudDepth.textContent = `Depth ${String(stage + 1).padStart(2, '0')}`;
    hudNodes.textContent = `${count} wallet${count === 1 ? '' : 's'}`;
    hudBar.style.transform = `scaleX(${p.toFixed(3)})`;
  },
});

// ── 04 evidence converging ───────────────────────────────────────
const evidence = $('#evidence');
const frags = $$('.ev', evidence);
const evLines = $('#ev-lines');
frags.forEach(() => { const l = document.createElementNS('http://www.w3.org/2000/svg', 'line'); l.setAttribute('pathLength', '1'); evLines.appendChild(l); });
const lineEls = $$('line', evLines);
lineEls.forEach((l) => { l.setAttribute('x1', 300); l.setAttribute('y1', 300); l.setAttribute('x2', 300); l.setAttribute('y2', 300); });

function drawEvidence(p) {
  const e = ease(clamp(p));
  const box = evidence.getBoundingClientRect(), k = box.width / 600;
  frags.forEach((f, i) => {
    const x = +f.dataset.x * k, y = +f.dataset.y * k;
    const spread = lerp(1.9, 1, e);
    const dx = x * spread, dy = y * spread;
    f.style.transform = `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px)) rotate(${lerp(i % 2 ? 6 : -6, 0, e).toFixed(2)}deg)`;
    f.style.opacity = lerp(0.25, 1, e).toFixed(3);
    const l = lineEls[i];
    l.setAttribute('x1', 300); l.setAttribute('y1', 300);
    l.setAttribute('x2', (300 + dx / k).toFixed(1)); l.setAttribute('y2', (300 + dy / k).toFixed(1));
    l.style.strokeDashoffset = String(1 - clamp((e - 0.35) / 0.5));
  });
}

// ── 05 product reveal: the real platform in a frame ──────────────
const device = $('#device'), screen = $('#screen'), frame = $('#product-frame'), openLink = $('#device-open'), urlLabel = $('#device-url');
let caseUrl = '/how-it-works';
api('/api/investigations?limit=1').then((r) => { if (r.investigations[0]) caseUrl = `/investigation?id=${r.investigations[0].id}`; }).catch(() => {});

function sizeFrame() {
  const w = screen.clientWidth;
  const base = w < 700 ? 420 : 1440;              // phones get the real mobile layout
  const h = w < 700 ? 760 : 860;
  const s = w / base;
  frame.style.width = `${base}px`; frame.style.height = `${h}px`;
  frame.style.transform = `scale(${s})`;
  screen.style.height = `${Math.round(h * s)}px`;
}
function show(src, label) {
  const url = src === 'case' ? caseUrl : src;
  frame.classList.add('loading');
  frame.src = url; openLink.href = url; urlLabel.textContent = label;
}
frame.addEventListener('load', () => frame.classList.remove('loading'));
$$('#tabs [role="tab"]').forEach((b, i, all) => {
  b.addEventListener('click', () => {
    all.forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    show(b.dataset.src, b.dataset.label);
  });
  b.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const n = all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length]; n.focus(); n.click();
  });
});
new IntersectionObserver(([e], obs) => { if (e.isIntersecting) { show('/app#overview', 'witness / app'); obs.disconnect(); } }, { rootMargin: '800px 0px' }).observe(device);
window.addEventListener('resize', sizeFrame); sizeFrame();

function drawDevice(p) {
  const e = ease(clamp(p / 0.55));
  device.style.setProperty('--rx', `${lerp(20, 0, e).toFixed(2)}deg`);
  device.style.setProperty('--sc', lerp(0.86, 1, e).toFixed(4));
  device.style.setProperty('--ty', `${lerp(70, 0, e).toFixed(1)}px`);
}

// ── 06 finale network (restrained) ───────────────────────────────
const fin = $('#finale-net'), fctx = fin.getContext('2d');
let fPts = [], fVisible = false;
function sizeFinale() {
  const d = Math.min(devicePixelRatio || 1, 2), w = fin.clientWidth, h = fin.clientHeight;
  fin.width = w * d; fin.height = h * d; fctx.setTransform(d, 0, 0, d, 0, 0);
  const n = Math.round(Math.min(70, (w * h) / 22000));
  let s = 3; const R = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  fPts = Array.from({ length: n }, () => ({ x: R() * w, y: R() * h, vx: (R() - 0.5) * 0.12, vy: (R() - 0.5) * 0.12 }));
  drawFinale();
}
function drawFinale() {
  const w = fin.clientWidth, h = fin.clientHeight;
  fctx.clearRect(0, 0, w, h);
  for (const p of fPts) { if (!reduced) { p.x = (p.x + p.vx + w) % w; p.y = (p.y + p.vy + h) % h; } }
  for (let i = 0; i < fPts.length; i++) for (let j = i + 1; j < fPts.length; j++) {
    const a = fPts[i], b = fPts[j], d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d < 150) { fctx.strokeStyle = `rgba(57,135,255,${(0.16 * (1 - d / 150)).toFixed(3)})`; fctx.lineWidth = 0.6; fctx.beginPath(); fctx.moveTo(a.x, a.y); fctx.lineTo(b.x, b.y); fctx.stroke(); }
  }
  fctx.fillStyle = 'rgba(241,245,252,0.35)';
  for (const p of fPts) { fctx.beginPath(); fctx.arc(p.x, p.y, 1, 0, 7); fctx.fill(); }
}
new IntersectionObserver(([e]) => { fVisible = e.isIntersecting; }).observe(fin);
window.addEventListener('resize', sizeFinale); sizeFinale();

// ── header theme, progress bar, scroll-linked frame loop ─────────
const bar = $('.l-progress span');
const themed = $$('[data-theme]');
let lastY = scrollY;
function onFrame() {
  const y = scrollY;
  const max = document.documentElement.scrollHeight - innerHeight;
  bar.style.transform = `scaleX(${(y / Math.max(max, 1)).toFixed(4)})`;
  header.classList.toggle('scrolled', y > 40);
  const probe = themed.find((s) => { const r = s.getBoundingClientRect(); return r.top <= 40 && r.bottom > 40; });
  const light = probe?.dataset.theme === 'light';
  header.classList.toggle('on-light', light);
  cursor?.classList.toggle('light', isLightAt(cursorPos.y));
  // hide the header while scrolling down through the pinned sequence, show on the way up
  header.classList.toggle('hide', !reduced && y > lastY + 2 && y > innerHeight * 1.2 && !header.matches(':focus-within'));
  if (y < lastY - 2) header.classList.remove('hide');
  lastY = y;

  if (fVisible) drawFinale();
  if (!reduced && !motionOn) {
    lens.setScroll(clamp(y / innerHeight));
    const tp = progressOf($('.trace-art'), 0.95, 0.35);
    drawTrace(tp); traceSvg.style.setProperty('--pan', ease(tp).toFixed(4));
    drawEvidence(progressOf(evidence, 0.95, 0.45));
    drawDevice(progressOf($('#stage3d'), 1, 0.2));
  }
  requestAnimationFrame(onFrame);
}
function isLightAt(yy) { const s = themed.find((el) => { const r = el.getBoundingClientRect(); return r.top <= yy && r.bottom > yy; }); return s?.dataset.theme === 'light'; }
if (reduced) { drawTrace(1); drawEvidence(1); drawDevice(1); }

// ── cursor ring & magnetic buttons (fine pointers only) ──────────
const cursor = finePointer && !reduced ? $('.l-cursor') : null;
const cursorPos = { x: -100, y: -100, cx: -100, cy: -100 };
if (cursor) {
  addEventListener('pointermove', (e) => { cursorPos.x = e.clientX; cursorPos.y = e.clientY; cursor.classList.add('on'); }, { passive: true });
  document.addEventListener('pointerleave', () => cursor.classList.remove('on'));
  document.addEventListener('pointerover', (e) => cursor.classList.toggle('hot', !!e.target.closest('a, button, [role="tab"]')));
  (function follow() {
    cursorPos.cx = lerp(cursorPos.cx, cursorPos.x, 0.2); cursorPos.cy = lerp(cursorPos.cy, cursorPos.y, 0.2);
    cursor.style.transform = `translate(${cursorPos.cx.toFixed(1)}px, ${cursorPos.cy.toFixed(1)}px)`;
    requestAnimationFrame(follow);
  })();
  $$('.magnetic').forEach((el) => {
    const inner = el.firstElementChild;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      el.style.transform = `translate(${(dx * 0.22).toFixed(1)}px, ${(dy * 0.3).toFixed(1)}px)`;
      inner.style.transform = `translate(${(dx * 0.1).toFixed(1)}px, ${(dy * 0.12).toFixed(1)}px)`;
    });
    el.addEventListener('pointerleave', () => { el.style.transform = ''; inner.style.transform = ''; });
  });
}

// ── page transition when leaving for another WITNESS page ────────
const curtain = $('.l-curtain');
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || reduced || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank') return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || (url.pathname === location.pathname && url.hash)) return;
  e.preventDefault();
  curtain.classList.add('go');
  setTimeout(() => { location.href = url.href; }, 480);
});
addEventListener('pageshow', () => curtain.classList.remove('go'));

requestAnimationFrame(onFrame);

// ── signals travelling along the trace's lit path (once it is drawn) ──
function startTraceSignals() {
  const NS = 'http://www.w3.org/2000/svg';
  const segs = $$('.e.hl:not(.lead)', traceSvg).map((el) => ({ el, len: el.getTotalLength() }));
  const total = segs.reduce((a, b) => a + b.len, 0);
  if (!total) return;
  const sigs = [0, 0.33, 0.66].map((off) => {
    const halo = document.createElementNS(NS, 'circle'); halo.setAttribute('r', 9); halo.setAttribute('class', 'trace-sig-halo');
    const dot = document.createElementNS(NS, 'circle'); dot.setAttribute('r', 3.2); dot.setAttribute('class', 'trace-sig');
    traceSvg.append(halo, dot); return { halo, dot, off };
  });
  const t0 = performance.now();
  (function run(now) {
    const on = traceP > 0.97;
    for (const s of sigs) {
      s.dot.style.opacity = s.halo.style.opacity = on ? 1 : 0;
      if (!on) continue;
      let d = (((now - t0) / 6000 + s.off) % 1) * total;
      const seg = segs.find((g) => (d <= g.len ? true : ((d -= g.len), false))) || segs[segs.length - 1];
      const pt = seg.el.getPointAtLength(Math.min(d, seg.len));
      s.dot.setAttribute('cx', pt.x); s.dot.setAttribute('cy', pt.y); s.halo.setAttribute('cx', pt.x); s.halo.setAttribute('cy', pt.y);
    }
    requestAnimationFrame(run);
  })(t0);
}

// ── scroll choreography ──
if (motionOn) {
  initMotion({
    lens, drawTrace, traceSvg, startTraceSignals,
    closer: closerApi,
    evLines: lineEls,
    device,
    scrollFrame(p) {
      try { const w = frame.contentWindow, d = w.document.documentElement; w.scrollTo(0, p * Math.max(0, d.scrollHeight - w.innerHeight)); } catch { /* frame not ready */ }
    },
  });
} else if (!reduced) {
  startTraceSignals();
}
