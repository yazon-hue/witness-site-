// "Look closer": a scroll-driven investigation in pseudo-3D.
// One wallet → a transaction → new wallets → the whole network. The camera pulls
// back and orbits as you scroll; depth of field softens far nodes; only the
// evidence path is lit in blue.

function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function buildGraph() {
  const R = rng(7), nodes = [], edges = [];
  const addr = () => { let s = ''; for (let i = 0; i < 4; i++) s += B58[(R() * 58) | 0]; s += '…'; for (let i = 0; i < 4; i++) s += B58[(R() * 58) | 0]; return s; };
  const node = (x, y, z, at, o = {}) => { nodes.push({ x, y, z, at, addr: addr(), ...o }); return nodes.length - 1; };
  const edge = (a, b, at, hl = false) => edges.push({ a, b, at, hl });

  const root = node(0, 0, 0, 0, { hl: true, label: true, big: true });
  const b = node(2.4, -0.7, -0.9, 0.2, { hl: true, label: true, amount: '412.6 SOL' });
  edge(root, b, 0.2, true);
  // stage 3: fresh wallets fan out from the funder
  const fresh = [];
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + R() * 0.3, rr = 1.6 + R() * 1.3;
    const n = node(2.4 + Math.cos(a) * rr, -0.7 + Math.sin(a) * rr * 0.75, -0.9 + (R() - 0.5) * 2.4, 0.4 + i * 0.016, { hl: i < 3, label: i < 3 });
    edge(b, n, 0.4 + i * 0.016, i < 3); fresh.push(n);
  }
  // stage 4: the wider network — clusters linked through a few hubs
  const centers = [[-5, 2.5, -3], [7, 3, -5], [6.5, -5, 3], [-4.5, -4.5, 4], [1, 6, 5]];
  const hubs = [];
  centers.forEach(([cx, cy, cz], ci) => {
    const hub = node(cx, cy, cz, 0.62 + ci * 0.04, { hl: ci === 1, label: ci === 1, big: true });
    hubs.push(hub);
    for (let i = 0; i < 24; i++) {
      const u = R() * 2 - 1, th = R() * Math.PI * 2, rr = 0.8 + R() * 2.6, s = Math.sqrt(1 - u * u);
      const n = node(cx + rr * s * Math.cos(th), cy + rr * u, cz + rr * s * Math.sin(th), 0.66 + ci * 0.04 + R() * 0.2);
      edge(hub, n, nodes[n].at);
      if (R() < 0.18) edge(n, hub + 1 + ((R() * 24) | 0), nodes[n].at + 0.02);
    }
  });
  fresh.forEach((f, i) => edge(f, hubs[i % hubs.length], 0.68 + i * 0.012, i === 0));
  edge(hubs[0], hubs[1], 0.78); edge(hubs[1], hubs[2], 0.8); edge(hubs[3], hubs[4], 0.82); edge(hubs[2], hubs[3], 0.84); edge(root, hubs[0], 0.86);
  // the evidence path continues into the second cluster
  edges.forEach((e) => { if (e.a === fresh[0] && e.b === hubs[0]) e.hl = false; });
  edge(fresh[0], hubs[1], 0.7, true);
  return { nodes, edges };
}

export function mountCloser(section, canvas, { reduced, onStage }) {
  const ctx = canvas.getContext('2d');
  const { nodes, edges } = buildGraph();
  let W = 0, H = 0, dpr = 1, target = reduced ? 1 : 0, prog = target, visible = false, lastStage = -1;
  const t0 = performance.now();

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(performance.now());
  }

  function draw(now) {
    const t = reduced ? 0 : (now - t0) / 1000;
    const p = prog, mobile = W < 760;
    const e = smooth(0, 1, p);
    const dist = 4.2 + 16 * Math.pow(e, 1.3);
    const yaw = -0.35 + p * 1.5 + t * 0.025, pitch = 0.22 + 0.12 * Math.sin(p * 3.1);
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const focal = Math.min(W, H) * (mobile ? 1.0 : 1.15);
    const cx0 = W * (mobile ? 0.5 : 0.62), cy0 = H * (mobile ? 0.36 : 0.5);
    // look slightly toward the funder early on, then back to the whole
    const lx = 1.2 * smooth(0.12, 0.35, p) * (1 - smooth(0.55, 0.9, p)), ly = -0.35 * smooth(0.12, 0.35, p) * (1 - smooth(0.55, 0.9, p));
    const P = nodes.map((n) => {
      const x = n.x - lx, y = n.y - ly, z = n.z;
      const x1 = x * cy - z * sy, z1 = x * sy + z * cy;
      const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp + dist;
      const s = focal / Math.max(z2, 0.5);
      const vis = smooth(n.at, n.at + 0.06, p);
      return { sx: cx0 + x1 * s, sy: cy0 + y2 * s, z: z2, s, vis, n };
    });

    ctx.clearRect(0, 0, W, H);
    // edges
    for (const ed of edges) {
      const A = P[ed.a], Bn = P[ed.b];
      const v = smooth(ed.at, ed.at + 0.07, p) * Math.min(A.vis, 1);
      if (v <= 0.01) continue;
      const depth = Math.abs((A.z + Bn.z) / 2 - dist) / dist;
      const k = v;
      const ex = A.sx + (Bn.sx - A.sx) * k, ey = A.sy + (Bn.sy - A.sy) * k;
      ctx.beginPath(); ctx.moveTo(A.sx, A.sy); ctx.lineTo(ex, ey);
      if (ed.hl) {
        ctx.strokeStyle = 'rgba(57,135,255,0.22)'; ctx.lineWidth = 5; ctx.stroke();
        ctx.strokeStyle = 'rgba(66,217,255,0.95)'; ctx.lineWidth = 1.2; ctx.stroke();
      } else {
        ctx.strokeStyle = `rgba(241,245,252,${(0.16 * (1 - Math.min(depth, 0.8))).toFixed(3)})`; ctx.lineWidth = 0.7; ctx.stroke();
      }
    }
    // travelling packets on lit edges
    if (!reduced) for (const ed of edges) {
      if (!ed.hl) continue;
      const v = smooth(ed.at + 0.05, ed.at + 0.1, p); if (v <= 0) continue;
      const A = P[ed.a], Bn = P[ed.b], f = (t * 0.5 + ed.a * 0.13) % 1;
      ctx.fillStyle = 'rgba(200,240,255,0.95)';
      ctx.beginPath(); ctx.arc(A.sx + (Bn.sx - A.sx) * f, A.sy + (Bn.sy - A.sy) * f, 1.8, 0, 7); ctx.fill();
    }
    // nodes, far to near, with depth-of-field
    const order = P.map((_, i) => i).sort((i, j) => P[j].z - P[i].z);
    for (const i of order) {
      const q = P[i]; if (q.vis <= 0.01) continue;
      const blur = Math.min(Math.abs(q.z - dist) / (dist * 0.55), 1.6);
      const base = (q.n.big ? 0.09 : 0.05) * q.s * (0.6 + 0.4 * q.vis);
      const rad = Math.max(1.2, base * (1 + blur * 2.2));
      const alpha = q.vis * (q.n.hl ? 1 : 0.85) / (1 + blur * 2.4);
      const g = ctx.createRadialGradient(q.sx, q.sy, 0, q.sx, q.sy, rad);
      if (q.n.hl) { g.addColorStop(0, `rgba(200,240,255,${alpha})`); g.addColorStop(0.35, `rgba(66,217,255,${alpha})`); g.addColorStop(1, 'rgba(57,135,255,0)'); }
      else { g.addColorStop(0, `rgba(241,245,252,${alpha})`); g.addColorStop(0.45 - blur * 0.2, `rgba(241,245,252,${alpha * 0.5})`); g.addColorStop(1, 'rgba(241,245,252,0)'); }
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(q.sx, q.sy, rad, 0, 7); ctx.fill();
      if (q.n.hl && q.vis > 0.5) { ctx.strokeStyle = `rgba(66,217,255,${0.35 * q.vis})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(q.sx, q.sy, rad + 6, 0, 7); ctx.stroke(); }
    }
    // labels on the evidence path
    ctx.font = `500 ${mobile ? 10 : 11}px "Geist Mono", ui-monospace, monospace`;
    ctx.textBaseline = 'middle';
    for (const q of P) {
      if (!q.n.label || q.vis < 0.3) continue;
      // as the full network appears, only the first wallet keeps its label
      const fade = q.n.at === 0 ? 1 : 1 - smooth(0.6, 0.78, p);
      if (fade <= 0.01) continue;
      const a = q.vis * fade;
      const lx2 = q.sx + 14, ly2 = q.sy - 14;
      ctx.strokeStyle = `rgba(132,147,168,${a * 0.6})`; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(q.sx + 4, q.sy - 4); ctx.lineTo(lx2, ly2); ctx.lineTo(lx2 + 10, ly2); ctx.stroke();
      ctx.fillStyle = `rgba(241,245,252,${a})`;
      ctx.fillText(q.n.addr, lx2 + 14, ly2);
      if (q.n.amount && p > 0.22) { ctx.fillStyle = `rgba(66,217,255,${a * smooth(0.22, 0.3, p)})`; ctx.fillText(`← ${q.n.amount}`, lx2 + 14, ly2 + 15); }
    }

    const stage = p < 0.18 ? 0 : p < 0.38 ? 1 : p < 0.6 ? 2 : 3;
    const count = P.filter((q) => q.vis > 0.5).length;
    if (stage !== lastStage || true) onStage?.(stage, p, count);
    lastStage = stage;
  }

  function tick(now) {
    if (visible) {
      if (!reduced) {
        const r = section.getBoundingClientRect();
        const total = r.height - innerHeight;
        target = Math.min(1, Math.max(0, -r.top / Math.max(total, 1)));
      }
      prog += (target - prog) * 0.08;
      draw(now);
    }
    requestAnimationFrame(tick);
  }

  new IntersectionObserver(([en]) => { visible = en.isIntersecting; }, { rootMargin: '100px' }).observe(section);
  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(tick);
}
