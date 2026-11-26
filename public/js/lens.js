// Hero visual: a procedural optical lens rendered in WebGL.
// One illuminated focal point, aperture blades that breathe, a lit barrel with
// a chromatic fringe, controlled reflections and drifting dust in a light beam.
// Falls back to a CSS composition if WebGL is unavailable or fails to compile.

const VERT = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;uniform float uTime;uniform vec2 uMouse;uniform float uScroll;uniform vec2 uCenter;uniform float uScale;
#define PI 3.14159265
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),u.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),u.x),u.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*noise(p);p=p*2.03+17.1;a*=.5;}return v;}
float ring(float r,float rad,float w){return smoothstep(w,0.,abs(r-rad));}
float barrel(float r,float a){
  float s=ring(r,.640,.0030)*.45+ring(r,.612,.0012)*.30+ring(r,.560,.0016)*.35
         +ring(r,.520,.0010)*.22+ring(r,.455,.0020)*.40+ring(r,.430,.0010)*.25+ring(r,.372,.0016)*.45;
  s+=smoothstep(.55,1.,abs(sin(a*180.)))*step(.575,r)*step(r,.605)*.10;
  return s;
}
void main(){
  vec2 frag=gl_FragCoord.xy;
  vec2 p=(frag-uCenter*uRes)/uRes.y/uScale;
  vec2 m=uMouse*.08;
  float md=length(p-m*3.);
  p+=(p-m*3.)*.012*sin(md*30.-uTime*1.2)*exp(-md*3.);   // soft displacement around the pointer
  p/=1.+uScroll*1.8;                                     // push into the lens as the hero scrolls away
  float r=length(p),a=atan(p.y,p.x),t=uTime;
  vec2 L=normalize(vec2(-.55,.75)+m*4.);
  float facing=.5+.5*dot(p/(r+1e-4),L);
  vec3 col=vec3(.012,.016,.028);
  float beam=pow(max(dot(normalize(p+1e-4),L),0.),6.)*smoothstep(1.4,.2,r);
  col+=vec3(.03,.07,.18)*beam*.6;
  float lit=.18+1.4*pow(facing,4.);
  col.r+=barrel(r*1.004,a)*lit*.78;col.g+=barrel(r,a)*lit*.86;col.b+=barrel(r*.996,a)*lit;
  float glass=smoothstep(.372,0.,r);
  col+=vec3(.010,.028,.075)*glass;
  float ap=.115+.018*sin(t*.31)+.01*sin(t*.73)-uScroll*.05;
  float n=9.,sec=2.*PI/n,rot=t*.04+uScroll*1.4;
  float aa=mod(a+rot,sec)-sec*.5;
  float apR=ap*cos(sec*.5)/cos(aa);
  float iris=smoothstep(apR,apR+.003,r)*smoothstep(.37,.345,r);
  float f=fbm(vec2(a*9.,r*22.-t*.04));
  float fib=pow(.5+.5*sin(a*170.+f*7.),5.);
  float ig=smoothstep(.36,apR,r);
  vec3 irisCol=mix(vec3(.015,.04,.10),vec3(.16,.45,1.),ig*ig);
  col+=irisCol*(fib*.55+f*.35)*iris*(.45+.9*pow(facing,2.));
  col+=vec3(.26,.85,1.)*smoothstep(.005,0.,abs(r-apR))*.55*step(r,.36);
  float pupil=1.-smoothstep(apR-.002,apR+.002,r);
  col=mix(col,vec3(.004,.006,.012),pupil*.94);
  float pulse=.85+.15*sin(t*1.3);
  col+=vec3(.22,.53,1.)*exp(-r*r/.01)*.45*pupil*pulse+vec3(.65,.93,1.)*exp(-r*r/.0006)*1.3*pulse;
  vec2 h1=p+L*.17;col+=vec3(.85,.92,1.)*exp(-dot(h1,h1)/.0012)*.55*glass;
  vec2 h2=(p-L*.24)*mat2(L.x,-L.y,L.y,L.x);col+=vec3(.45,.65,1.)*exp(-(h2.x*h2.x+h2.y*h2.y*14.)/.004)*.12;
  vec2 g=frag/uRes.y*28.+vec2(t*.05,-t*.02);vec2 gi=floor(g);
  vec2 gp=fract(g)-vec2(hash(gi+3.1),hash(gi+7.7));
  col+=vec3(.5,.7,1.)*smoothstep(.04,0.,length(gp))*step(.985,hash(gi))*beam*1.5;
  vec2 v=frag/uRes-.5;col*=1.-dot(v,v)*1.1;
  col+=(hash(frag+fract(t)*91.)-.5)*.025;
  gl_FragColor=vec4(max(col,0.),1.);
}`;

export function mountLens(canvas, hero, { reduced }) {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) return fail();
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
  const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return fail();
  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return fail();
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = Object.fromEntries(['uRes', 'uTime', 'uMouse', 'uScroll', 'uCenter', 'uScale'].map((n) => [n, gl.getUniformLocation(prog, n)]));

  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  let visible = true, scroll = 0, raf = 0;
  const start = performance.now();

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    const mobile = w < 760;
    // lens sits right of centre on desktop (headline overlaps it), high and centred on phones
    gl.uniform2f(U.uCenter, mobile ? 0.5 : 0.66, mobile ? 0.64 : 0.54);
    gl.uniform1f(U.uScale, mobile ? Math.min(0.62, (w / h) * 0.78) : 0.8);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    if (reduced) frame(start + 9000);
  }

  function frame(now) {
    mouse.x += (mouse.tx - mouse.x) * 0.05; mouse.y += (mouse.ty - mouse.y) * 0.05;
    gl.uniform1f(U.uTime, (now - start) / 1000 + 4);
    gl.uniform2f(U.uMouse, mouse.x, mouse.y);
    gl.uniform1f(U.uScroll, scroll);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function loop(now) { if (visible) frame(now); raf = requestAnimationFrame(loop); }

  window.addEventListener('resize', resize);
  if (!reduced) {
    window.addEventListener('pointermove', (e) => { mouse.tx = (e.clientX / innerWidth) * 2 - 1; mouse.ty = -((e.clientY / innerHeight) * 2 - 1); }, { passive: true });
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(hero);
    raf = requestAnimationFrame(loop);
  }
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); cancelAnimationFrame(raf); fail(); });
  resize();
  return { setScroll(v) { scroll = v; } };

  function fail() { hero.classList.add('no-webgl'); return { setScroll() {} }; }
}
