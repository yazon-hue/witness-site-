// WITNESS sonic identity — an original, fully procedural soundscape (Web Audio API).
// No audio files and no noise sources: every sound is a clean synthesised tone.
//
// The page plays one steady, bright atmosphere (the opening sound) from top to bottom:
//   drone    an A chord of detuned tones under a gently breathing low-pass — kept low, a bed not a hum
//   shimmer  delicate high partials that drift in and out
//   pulse    a soft electronic heartbeat, slightly irregular
// On top of it: a clean signal each time a wallet connection forms on screen, a bright
// bloom of the same chord as the finale logo appears, and a few quiet interface tones.

const ROOT = 55.0;                                   // A1
const DRONE = [55.0, 82.41, 110.0, 164.81];          // A: root, fifth, octave, upper fifth
const PENTA = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2];    // scale for pings, relative to the root

export class Sonic {
  constructor(ctx) {
    this.ctx = ctx || new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
    const C = this.ctx;
    this.vol = 0.6;
    this.levels = { drone: 0, shimmer: 0, pulse: 0, signals: 0 };

    // master → rumble filter → gentle compressor → limiter → out
    this.master = C.createGain(); this.master.gain.value = 0;
    const rumble = C.createBiquadFilter(); rumble.type = 'highpass'; rumble.frequency.value = 30; rumble.Q.value = 0.7;
    const comp = C.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.02; comp.release.value = 0.5;
    const limit = C.createDynamicsCompressor();
    limit.threshold.value = -3; limit.knee.value = 0; limit.ratio.value = 20; limit.attack.value = 0.002; limit.release.value = 0.1;
    this.master.connect(rumble).connect(comp).connect(limit).connect(C.destination);

    // generated stereo hall; lows kept out of it, and its top rolled off so the tail stays clean
    this.verbIn = C.createGain();
    const hp = C.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 220; hp.Q.value = 0.6;
    const pre = C.createDelay(0.2); pre.delayTime.value = 0.045;
    const verb = C.createConvolver(); verb.buffer = this.impulse(6.5, 2.6);
    const lp = C.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4200; lp.Q.value = 0.5;
    const verbOut = C.createGain(); verbOut.gain.value = 0.85;
    this.verbIn.connect(hp).connect(pre).connect(verb).connect(lp).connect(verbOut).connect(this.master);

    this.bus = {};
    const sends = { drone: 0.35, shimmer: 0.9, pulse: 0.8, signals: 0.85 };
    for (const [name, send] of Object.entries(sends)) {
      const g = C.createGain(); g.gain.value = 0; g.connect(this.master);
      const s = C.createGain(); s.gain.value = send; g.connect(s).connect(this.verbIn);
      this.bus[name] = g;
    }
    this.ui = C.createGain(); this.ui.gain.value = 0.9; this.ui.connect(this.master);
    const uiSend = C.createGain(); uiSend.gain.value = 0.35; this.ui.connect(uiSend).connect(this.verbIn);

    this.buildDrone(); this.buildShimmer();
    this.next = { pulse: C.currentTime + 1, signal: C.currentTime + 2, shimmer: C.currentTime + 40 };
  }

  // ── building blocks ─────────────────────────────────────────────
  impulse(seconds, decay) {
    const C = this.ctx, len = Math.floor(C.sampleRate * seconds), b = C.createBuffer(2, len, C.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch); let lp = 0;
      for (let i = 0; i < len; i++) {
        lp = lp * 0.6 + (Math.random() * 2 - 1) * 0.4;
        d[i] = lp * Math.pow(1 - i / len, decay) * (i < 200 ? i / 200 : 1);
      }
    }
    return b;
  }
  lfo(freq, depth, target) {
    const C = this.ctx, o = C.createOscillator(), g = C.createGain();
    o.frequency.value = freq; g.gain.value = depth; o.connect(g).connect(target); o.start();
    return o;
  }
  pan(value = 0) { const p = this.ctx.createStereoPanner(); p.pan.value = value; return p; }

  // ── continuous layers ───────────────────────────────────────────
  buildDrone() {
    const C = this.ctx, lp = C.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.5; lp.connect(this.bus.drone);
    this.lfo(0.027, 160, lp.frequency);                                  // the bed breathes open and closed
    DRONE.forEach((f, i) => {
      const o = C.createOscillator(); o.type = i < 2 ? 'sine' : 'triangle'; o.frequency.value = f; o.detune.value = (i % 2 ? 1 : -1) * (3 + i * 2);
      const g = C.createGain(); g.gain.value = [0.16, 0.22, 0.32, 0.3][i];
      const p = this.pan((i % 2 ? 1 : -1) * 0.35);
      this.lfo(0.013 + i * 0.007, 0.35, p.pan);                          // slow stereo drift
      this.lfo(0.035 + i * 0.009, g.gain.value * 0.7, g.gain);           // slow, deep swells: it breathes rather than drones
      o.connect(g).connect(p).connect(lp); o.start();
    });
    const sub = C.createOscillator(); sub.type = 'sine'; sub.frequency.value = ROOT / 2;
    const sg = C.createGain(); sg.gain.value = 0.03; sub.connect(sg).connect(lp); sub.start();
  }
  buildShimmer() {
    const C = this.ctx;
    this.shimmer = [12, 16, 18, 24, 27].map((m, i) => {
      const o = C.createOscillator(); o.type = 'sine'; o.frequency.value = ROOT * m;
      const g = C.createGain(); g.gain.value = [0.03, 0.02, 0.025, 0.015, 0.012][i];
      const p = this.pan((i / 4) * 1.6 - 0.8);
      o.connect(g).connect(p).connect(this.bus.shimmer); o.start();
      return { o, g };
    });
  }

  // ── mix ─────────────────────────────────────────────────────────
  /** Move layer levels toward new values (0–1). `glide` is the time constant in seconds. */
  mix(levels, glide = 2.5) {
    const t = this.ctx.currentTime;
    const base = { drone: 0.075, shimmer: 1.0, pulse: 0.42, signals: 1.0 };
    for (const [k, v] of Object.entries(levels)) {
      if (!(k in this.bus)) continue;
      this.levels[k] = v;
      this.bus[k].gain.setTargetAtTime(v * base[k], t, glide);
    }
  }
  setVolume(v, glide = 0.3) { this.vol = v; if (this.on) this.master.gain.setTargetAtTime(this.curve(v), this.ctx.currentTime, glide); }
  curve(v) { return Math.pow(v, 1.6) * 0.7; }   // perceptual volume curve, kept low overall

  async start() {
    this.on = true;
    if (this.ctx.state !== 'running') await this.ctx.resume();
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(this.curve(this.vol), this.ctx.currentTime, 1.3);   // smooth fade-in
    if (!this.timer) this.timer = setInterval(() => this.schedule(), 60);
  }
  stop() {
    this.on = false;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.35);
    clearTimeout(this.sleep);
    this.sleep = setTimeout(() => { if (!this.on) { clearInterval(this.timer); this.timer = null; this.ctx.suspend(); } }, 2000);
  }

  // ── scheduled events (look-ahead) ───────────────────────────────
  schedule(until = this.ctx.currentTime + 0.25) {
    const L = this.levels, n = this.next;
    while (n.pulse < until) { if (L.pulse > 0.02) this.pulse(n.pulse); n.pulse += 2.4 + Math.random() * 0.9; }
    while (n.signal < until) {
      if (L.signals > 0.03) this.ping(n.signal, 0.5 + Math.random() * 0.5);
      n.signal += L.signals > 0.03 ? (0.7 + Math.random() * 2.2) / (0.4 + L.signals) : 1;
    }
    // every ~40–60 s the shimmer partials re-balance at random, so the top end stays alive
    if (n.shimmer < until) {
      this.shimmer.forEach((s) => s.g.gain.setTargetAtTime(Math.random() < 0.6 ? 0.016 + Math.random() * 0.026 : 0, n.shimmer, 5));
      n.shimmer += 38 + Math.random() * 26;
    }
  }

  env(g, at, peak, attack, decay) {
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  }
  tone(at, freq, { type = 'sine', peak = 0.2, attack = 0.005, decay = 0.6, panTo = 0, out, glideTo } = {}) {
    const C = this.ctx, o = C.createOscillator(), g = C.createGain(), p = this.pan(panTo);
    o.type = type; o.frequency.setValueAtTime(freq, at);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, at + attack + decay);
    this.env(g, at, peak, attack, decay);
    o.connect(g).connect(p).connect(out); o.start(at); o.stop(at + attack + decay + 0.05);
  }

  pulse(at) {                      // soft electronic heartbeat
    const r = ROOT * 2;
    this.tone(at, r, { peak: 0.35, attack: 0.008, decay: 1.4, out: this.bus.pulse, glideTo: r * 0.98 });
    this.tone(at, r * 4, { peak: 0.14, attack: 0.004, decay: 0.6, out: this.bus.pulse, panTo: Math.random() - 0.5 });
  }
  ping(at, strength = 1) {         // distant digital signal
    const f = ROOT * 8 * PENTA[Math.floor(Math.random() * PENTA.length)] * (Math.random() < 0.3 ? 2 : 1);
    const panTo = Math.random() * 1.8 - 0.9;
    this.tone(at, f, { peak: 0.12 * strength, attack: 0.003, decay: 0.35 + Math.random() * 0.5, out: this.bus.signals, panTo });
    this.tone(at + 0.09, f * 1.5, { peak: 0.04 * strength, attack: 0.003, decay: 0.25, out: this.bus.signals, panTo: -panTo });
  }

  // ── one-shot moments ────────────────────────────────────────────
  connect(strength = 1) {          // a wallet connection forms
    if (!this.on) return;
    const at = this.ctx.currentTime + 0.02, f = ROOT * 16;
    this.tone(at, f, { peak: 0.07 * strength, attack: 0.002, decay: 0.6, out: this.bus.signals, panTo: 0.2 });
    this.tone(at + 0.07, f * 1.25, { peak: 0.05 * strength, attack: 0.002, decay: 0.8, out: this.bus.signals, panTo: -0.2 });
    this.tone(at, ROOT * 2, { peak: 0.12 * strength, attack: 0.01, decay: 1.2, out: this.bus.pulse });
  }
  impact() {                       // the finale: a bright, clean bloom of the chord as the logo appears
    if (!this.on) return;
    const at = this.ctx.currentTime + 0.03, C = this.ctx;
    const hit = C.createGain(); hit.gain.value = 1; hit.connect(this.master);
    const hs = C.createGain(); hs.gain.value = 0.8; hit.connect(hs).connect(this.verbIn);
    this.tone(at, ROOT * 2, { peak: 0.22, attack: 0.02, decay: 3.5, out: hit });
    [4, 6, 8, 10, 12].forEach((m, i) =>
      this.tone(at + i * 0.07, ROOT * m, { peak: 0.07 - i * 0.008, attack: 0.015, decay: 4.5 + i * 0.6, out: hs, panTo: (i - 2) * 0.3 }));
  }

  // ── interface sounds (throttled by the caller) ──────────────────
  uiHover() {
    if (!this.on) return; const at = this.ctx.currentTime + 0.005;
    this.tone(at, 2093, { peak: 0.022, attack: 0.002, decay: 0.07, out: this.ui });
    this.tone(at + 0.045, 3136, { peak: 0.016, attack: 0.002, decay: 0.09, out: this.ui });
  }
  uiClick() {
    if (!this.on) return; const at = this.ctx.currentTime + 0.005;
    this.tone(at, 1320, { peak: 0.05, attack: 0.002, decay: 0.05, out: this.ui });
    this.tone(at + 0.03, 880, { peak: 0.04, attack: 0.002, decay: 0.12, out: this.ui });
  }
  uiActivate() {
    if (!this.on) return; const at = this.ctx.currentTime + 0.005, r = ROOT * 8;
    [1, 1.25, 1.5].forEach((m, i) => this.tone(at + i * 0.055, r * m, { peak: 0.04, attack: 0.003, decay: 0.35, out: this.ui, panTo: (i - 1) * 0.4 }));
  }
  uiTransition() {
    if (!this.on) return; const at = this.ctx.currentTime + 0.005;
    this.tone(at, 660, { peak: 0.03, attack: 0.04, decay: 0.3, out: this.ui, glideTo: 990 });
  }
}
