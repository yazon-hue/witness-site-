// WITNESS landing page — scroll choreography (GSAP + ScrollTrigger).
// Nothing here changes how the page looks at rest: it only moves what already exists.
// Each section hands over to the next with its own transition:
//   hero → trace     the lens focal point opens into the warm page (iris)
//   trace → closer   the warm page recedes into depth while the dark scene rides over it
//   closer → together the camera flies into the lit cluster, which opens into the next page
//   together → product the dark panel widens from a card into the full screen
//   product → finale  the live dashboard expands to fill the screen

const { gsap, ScrollTrigger } = window;

/** Split an element's text into word and character spans, keeping inner markup (<em>, <br>). */
function split(el) {
  if (el.dataset.split) return [...el.querySelectorAll('.c')];
  el.setAttribute('aria-label', el.textContent.replace(/\s+/g, ' ').trim());
  const walk = (node) => {
    [...node.childNodes].forEach((n) => {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.append(' '); return; }
          const w = document.createElement('span'); w.className = 'w'; w.setAttribute('aria-hidden', 'true');
          [...part].forEach((ch) => { const c = document.createElement('span'); c.className = 'c'; c.textContent = ch; w.append(c); });
          frag.append(w);
        });
        n.replaceWith(frag);
      } else if (n.nodeType === 1 && n.tagName !== 'BR') walk(n);
    });
  };
  walk(el); el.dataset.split = '1';
  return [...el.querySelectorAll('.c')];
}

export function initMotion(k) {
  gsap.registerPlugin(ScrollTrigger);
  // Every timeline below assumes it is built at the top of the page. ScrollTrigger keeps its
  // own memory of scroll positions across reloads; switch that off and start from the top.
  ScrollTrigger.clearScrollMemory('manual');
  const hash = location.hash;
  window.scrollTo(0, 0);
  document.documentElement.classList.add('gsap');
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const R = gsap.utils.random;
  const mm = gsap.matchMedia();

  // Scroll speed feeds the lens shader's ripple (image displacement)
  ScrollTrigger.create({ start: 0, end: 'max', onUpdate: (st) => k.lens.setWarp(st.getVelocity() / 3000) });

  mm.add({ desktop: '(min-width: 761px)', mobile: '(max-width: 760px)' }, (c) => {
    const { mobile } = c.conditions;

    // ── 01 HERO ────────────────────────────────────────────────────
    const hero = $('.hero');
    const heroChars = split($('.hero-title'));
    // opening shot: characters rise through their line masks, the lens fades up
    gsap.timeline({ delay: 0.1 })
      .fromTo('#lens', { opacity: 0, scale: 1.12 }, { opacity: 1, scale: 1, duration: 2.6, ease: 'power2.out' }, 0)
      .fromTo(heroChars, { yPercent: 118, rotate: 7 }, { yPercent: 0, rotate: 0, duration: 1.5, ease: 'expo.out', stagger: 0.028 }, 0.25)
      .fromTo('.hero-foot', { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 1.6, ease: 'expo.inOut', clearProps: 'clipPath' }, 0.5);

    // scroll-out: pinned. Letters separate and fly past the camera, the lens pulls us in,
    // then its focal point opens into the warm page of the next section.
    const iris = $('.hero-iris');
    const irisAt = () => (mobile ? '50% 36%' : '66% 46%');
    gsap.timeline({
      scrollTrigger: {
        trigger: hero, start: 'top top', end: () => `+=${innerHeight * (mobile ? 0.9 : 1.4)}`,
        pin: true, scrub: 1, anticipatePin: 1, invalidateOnRefresh: true,
        onUpdate: (st) => { k.lens.setScroll(st.progress); hero.dataset.theme = st.progress > 0.86 ? 'light' : 'dark'; },
      },
    })
      .fromTo(heroChars,
        { z: 0, xPercent: 0, yPercent: 0, rotationX: 0, opacity: 1 },
        { z: () => R(260, 900), xPercent: () => R(-90, 90), yPercent: () => R(-160, -30), rotationX: () => R(-70, 70), opacity: 0,
          ease: 'power2.in', stagger: { each: 0.012, from: 'center' }, duration: 0.5, immediateRender: false }, 0)
      .fromTo(['.hero-meta', '.hero-v'], { y: 0, opacity: 1 }, { y: -120, opacity: 0, ease: 'power1.in', duration: 0.35, immediateRender: false }, 0)
      .fromTo('.hero-foot', { y: 0, opacity: 1 }, { y: 80, opacity: 0, ease: 'power1.in', duration: 0.3, immediateRender: false }, 0)
      .fromTo(iris, { clipPath: () => `circle(0% at ${irisAt()})` }, { clipPath: () => `circle(150% at ${irisAt()})`, ease: 'power2.in', duration: 0.45, immediateRender: false }, 0.55);

    // ── 02 TRACE ───────────────────────────────────────────────────
    const traceTitle = $('.trace-title');
    const traceChars = split(traceTitle);
    gsap.fromTo(traceChars, { yPercent: 118, rotate: 5 }, {
      yPercent: 0, rotate: 0, ease: 'none', stagger: 0.018,
      scrollTrigger: { trigger: traceTitle, start: 'top 92%', end: 'top 30%', scrub: 1 },
    });
    // the two lines travel at different rates, and the headline grows into place
    gsap.fromTo($$('.ln', traceTitle)[0], { xPercent: -7 }, { xPercent: 2, ease: 'none', scrollTrigger: { trigger: '.trace', start: 'top bottom', end: 'bottom top', scrub: true } });
    gsap.fromTo($$('.ln', traceTitle)[1], { xPercent: 9 }, { xPercent: -3, ease: 'none', scrollTrigger: { trigger: '.trace', start: 'top bottom', end: 'bottom top', scrub: true } });
    gsap.fromTo(traceTitle, { scale: 0.94, transformOrigin: '0% 50%' }, { scale: 1, ease: 'none', scrollTrigger: { trigger: traceTitle, start: 'top bottom', end: 'top 25%', scrub: true } });
    // "trace." is unmasked left to right
    const traceEm = $('.trace-title .serif');
    gsap.fromTo(traceEm, { clipPath: 'inset(-20% 100% -20% 0)' }, { clipPath: 'inset(-20% 0% -20% 0)', ease: 'none', scrollTrigger: { trigger: traceTitle, start: 'top 55%', end: 'top 20%', scrub: 1 } });

    // the network: one line draws as you approach, then (pinned) it splits into the network
    // while the drawing tilts up from the page into three dimensions
    const art = $('.trace-art'), svg = k.traceSvg;
    ScrollTrigger.create({ trigger: art, start: 'top 92%', end: mobile ? 'top 30%' : 'top 14%', scrub: true, onUpdate: (st) => k.drawTrace(st.progress * 0.12) });
    gsap.timeline({
      scrollTrigger: {
        trigger: art, start: mobile ? 'top 30%' : 'top 14%', end: () => `+=${innerHeight * (mobile ? 0.9 : 1.2)}`,
        pin: !mobile, scrub: 1, anticipatePin: 1,
        onUpdate: (st) => { const p = 0.12 + st.progress * 0.88; k.drawTrace(p); svg.style.setProperty('--pan', gsap.parseEase('power3.out')(st.progress)); },
      },
    }).fromTo(svg, { rotationX: mobile ? 18 : 34, scale: 0.9, transformPerspective: 1400, transformOrigin: '50% 100%', filter: 'blur(0px)' },
      { rotationX: 0, scale: 1, ease: 'power2.out' });
    // once drawn, transaction signals run along the lit path
    k.startTraceSignals?.();

    // trace → closer: the warm page recedes into depth as the dark scene rides over it
    // (a clip-path mask, not a transform, so the pinned network inside keeps working)
    gsap.fromTo('.trace', { clipPath: 'inset(0% 0% 0% 0% round 0px)' }, {
      clipPath: mobile ? 'inset(0% 3% 6% 3% round 20px)' : 'inset(0% 5% 9% 5% round 28px)', ease: 'none',
      scrollTrigger: { trigger: '#closer', start: 'top bottom', end: 'top top', scrub: true },
    });
    gsap.fromTo('.trace .l-wrap', { opacity: 1 }, { opacity: 0.35, ease: 'none', scrollTrigger: { trigger: '#closer', start: 'top 70%', end: 'top top', scrub: true } });

    // ── 03 LOOK CLOSER ─────────────────────────────────────────────
    const closer = $('#closer'), cIris = $('.closer-iris'), cTitle = $('.closer-title');
    const cChars = split(cTitle);
    const span = () => closer.offsetHeight - innerHeight;
    gsap.fromTo(cChars, { yPercent: 118, rotate: 6 }, { yPercent: 0, rotate: 0, ease: 'none', stagger: 0.03, scrollTrigger: { trigger: closer, start: 'top 75%', end: 'top top', scrub: 1 } });
    ScrollTrigger.create({
      trigger: closer, start: 'top top', end: 'bottom bottom', scrub: true,
      onUpdate: (st) => {
        const p = st.progress;
        k.closer.setTarget(p);
        // exit: the lit cluster opens into the warm page of the next section
        const o = gsap.utils.clamp(0, 1, (p - 0.9) / 0.1);
        const f = k.closer.focus();
        const cl = gsap.utils.clamp(18, 82);
        const fx = cl(f.w ? (f.x / f.w) * 100 : 60), fy = cl(f.h ? (f.y / f.h) * 100 : 50);
        cIris.style.clipPath = `circle(${(o * o * 150).toFixed(2)}% at ${fx.toFixed(1)}% ${fy.toFixed(1)}%)`;
        closer.dataset.theme = o > 0.6 ? 'light' : 'dark';
      },
    });
    // as the camera flies in, the headline passes through depth and the UI falls away
    gsap.timeline({ scrollTrigger: { trigger: closer, start: () => `top+=${span() * 0.74} top`, end: () => `top+=${span() * 0.9} top`, scrub: 1, invalidateOnRefresh: true } })
      .to(cChars, { z: () => R(300, 800), yPercent: () => R(-60, 60), opacity: 0, filter: mobile ? 'none' : 'blur(6px)', stagger: { each: 0.02, from: 'random' }, ease: 'power2.in' }, 0)
      .to(['#stages', '.closer-hud', '.closer .sec-label'], { y: -40, opacity: 0, ease: 'power1.in' }, 0);

    // ── 04 TOGETHER ────────────────────────────────────────────────
    const tTitle = $('.together-title');
    const tChars = split(tTitle);
    gsap.fromTo(tChars, { yPercent: 118, rotate: 5 }, { yPercent: 0, rotate: 0, ease: 'none', stagger: 0.016, scrollTrigger: { trigger: tTitle, start: 'top 90%', end: 'top 35%', scrub: 1 } });
    gsap.fromTo($('.together-title .serif'), { clipPath: 'inset(-20% 100% -20% 0)' }, { clipPath: 'inset(-20% 0% -20% 0)', ease: 'none', scrollTrigger: { trigger: tTitle, start: 'top 65%', end: 'top 30%', scrub: 1 } });

    // evidence comes in from all depths and directions, sharpening as it converges
    const ev = $('#evidence'), frags = $$('.ev', ev), lines = k.evLines;
    const depth = [-600, 420, -300, 560, -480], ry = [55, -40, 35, -60, 25], rx = [-25, 30, 20, -15, -35];
    const base = (f, axis) => +f.dataset[axis] * (ev.clientWidth / 600);
    const evTl = gsap.timeline({
      scrollTrigger: { trigger: ev, start: 'top 95%', end: 'center 45%', scrub: 1, invalidateOnRefresh: true },
      onUpdate: () => frags.forEach((f, i) => {
        const x = gsap.getProperty(f, 'x'), y = gsap.getProperty(f, 'y'), s = 600 / ev.clientWidth;
        lines[i].setAttribute('x2', (300 + x * s).toFixed(1)); lines[i].setAttribute('y2', (300 + y * s).toFixed(1));
      }),
    });
    gsap.set(ev, { perspective: 1100 });
    frags.forEach((f, i) => {
      evTl.fromTo(f,
        { xPercent: -50, yPercent: -50, x: () => base(f, 'x') * 2.6, y: () => base(f, 'y') * 2.6, z: depth[i], rotationY: ry[i], rotationX: rx[i], opacity: 0, filter: mobile ? 'none' : 'blur(10px)' },
        { xPercent: -50, yPercent: -50, x: () => base(f, 'x'), y: () => base(f, 'y'), z: 0, rotationY: 0, rotationX: 0, opacity: 1, filter: 'blur(0px)', ease: 'power3.out', duration: 1 }, i * 0.12);
      evTl.fromTo(lines[i], { strokeDashoffset: 1 }, { strokeDashoffset: 0, ease: 'none', duration: 0.6 }, 0.5 + i * 0.1);
    });
    evTl.fromTo('.ev-core', { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, ease: 'back.out(2.5)', duration: 0.5 }, 0.55);

    // chapters: the outlined numerals drift on a slower layer than the words
    $$('.chapter').forEach((ch, i) => {
      gsap.fromTo($('.ch-n', ch), { yPercent: 35 }, { yPercent: -25, ease: 'none', scrollTrigger: { trigger: ch, start: 'top bottom', end: 'bottom top', scrub: true } });
      gsap.fromTo($('h3', ch), { x: i % 2 ? 80 : -80, clipPath: 'inset(0 0 100% 0)' }, { x: 0, clipPath: 'inset(0 0 0% 0)', ease: 'power2.out', scrollTrigger: { trigger: ch, start: 'top 92%', end: 'top 55%', scrub: 1 } });
    });

    // together → product: the dark panel arrives as a card and widens into the full screen
    gsap.fromTo('.reveal', { clipPath: mobile ? 'inset(0 3% 0 3% round 20px)' : 'inset(0 6% 0 6% round 32px)' }, {
      clipPath: 'inset(0 0% 0 0% round 0px)', ease: 'none',
      scrollTrigger: { trigger: '.reveal', start: 'top bottom', end: 'top 15%', scrub: true },
    });

    // ── 05 PRODUCT ─────────────────────────────────────────────────
    const rTitle = $('.reveal-title');
    const rChars = split(rTitle);
    gsap.fromTo(rChars, { yPercent: 118, rotate: 5 }, { yPercent: 0, rotate: 0, ease: 'none', stagger: 0.02, scrollTrigger: { trigger: rTitle, start: 'top 90%', end: 'top 40%', scrub: 1 } });
    gsap.fromTo($('.reveal-title .serif'), { clipPath: 'inset(-20% 100% -20% 0)' }, { clipPath: 'inset(-20% 0% -20% 0)', ease: 'none', scrollTrigger: { trigger: rTitle, start: 'top 60%', end: 'top 30%', scrub: 1 } });
    gsap.fromTo('.reveal-head', { y: 0 }, { y: -90, ease: 'none', scrollTrigger: { trigger: '.reveal', start: 'top top', end: 'bottom top', scrub: true } });

    const device = k.device, stage = $('#stage3d');
    // the frame tilts up from the page as it arrives
    gsap.fromTo(device, { '--rx': '20deg', '--sc': 0.86, '--ty': '70px' }, {
      '--rx': '0deg', '--sc': 1, '--ty': '0px', ease: 'none',
      scrollTrigger: { trigger: stage, start: 'top 95%', end: mobile ? 'top 30%' : 'top 12%', scrub: 1 },
    });
    // then (pinned) it expands to fill the screen and the real dashboard scrolls inside it
    const fill = () => Math.max(1, innerWidth / device.offsetWidth);
    gsap.timeline({
      scrollTrigger: {
        trigger: stage, start: mobile ? 'top 30%' : 'top 12%', end: () => `+=${innerHeight * (mobile ? 0.8 : 1.3)}`,
        pin: !mobile, scrub: 1, anticipatePin: 1, invalidateOnRefresh: true,
        onUpdate: (st) => k.scrollFrame(gsap.utils.clamp(0, 1, (st.progress - 0.3) / 0.7)),
      },
    })
      .to(device, { '--sc': () => (mobile ? 1 : fill()), borderRadius: mobile ? 14 : 0, ease: 'power2.inOut', duration: 0.3 }, 0)
      .to(['#tabs', '.device-cap'], { opacity: 0, y: -20, duration: 0.15 }, 0)
      .to({}, { duration: 0.7 });

    // ── 06 FINALE ──────────────────────────────────────────────────
    const fin = $('.finale'), fTitle = $('.finale-title');
    const fChars = split(fTitle);
    gsap.fromTo('#finale-net', { yPercent: -18, scale: 1.15 }, { yPercent: 12, scale: 1, ease: 'none', scrollTrigger: { trigger: fin, start: 'top bottom', end: 'bottom top', scrub: true } });
    gsap.fromTo('.finale-mark', { scale: 2.6, opacity: 0, filter: mobile ? 'none' : 'blur(8px)' }, { scale: 1, opacity: 1, filter: 'blur(0px)', ease: 'power3.out', scrollTrigger: { trigger: fin, start: 'top 85%', end: 'top 30%', scrub: 1 } });
    gsap.fromTo('.finale-mark .draw', { strokeDashoffset: 1 }, { strokeDashoffset: 0, ease: 'none', scrollTrigger: { trigger: fin, start: 'top 70%', end: 'top 10%', scrub: 1 } });
    gsap.set(fTitle, { perspective: 900 });
    gsap.fromTo(fChars, { z: -500, rotationX: 75, opacity: 0, filter: mobile ? 'none' : 'blur(10px)' }, {
      z: 0, rotationX: 0, opacity: 1, filter: 'blur(0px)', ease: 'power3.out', stagger: { each: 0.025, from: 'center' },
      scrollTrigger: { trigger: fTitle, start: 'top 95%', end: 'top 40%', scrub: 1 },
    });
    // the cropped wordmark rises out of the floor, one letter at a time
    const word = $('.finale-word');
    const wChars = split(word);
    gsap.fromTo(wChars, { yPercent: 70, opacity: 0 }, { yPercent: 0, opacity: 1, ease: 'power2.out', stagger: 0.06, scrollTrigger: { trigger: fin, start: 'top 40%', end: 'bottom bottom', scrub: 1 } });

    return () => { /* matchMedia reverts everything created above when the breakpoint changes */ };
  });

  // fonts change line widths; recalculate positions once they are in
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
  // a link straight to a section (e.g. /#trace) still lands there, once everything is measured
  if (hash) requestAnimationFrame(() => { const t = document.querySelector(hash); if (t) window.scrollTo(0, t.getBoundingClientRect().top + scrollY); });
  // coming Back from another page restores this page from memory with its state intact;
  // re-measure in case the window size changed while we were away
  addEventListener('pageshow', (e) => { if (e.persisted) ScrollTrigger.refresh(); });
}
