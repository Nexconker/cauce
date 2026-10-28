// Vista 3D de la red: three.js r128 guardado en
// web/lib/three (funciona sin internet), tuberías a su cota con exageración vertical y grosor por diámetro, tanques
// como cilindros con su nivel, embalses como conos y partículas que corren por las tuberías con la velocidad de la
// corrida. Toma la hora de la barra de tiempo y pasa suave de una hora a la otra. three.js se carga la primera vez.
import { S, bus, h, n, esc, $, U, aviso, fallo } from './estado.js';
import { cargarVariable } from './paneles.js';
import { mapa } from './mapa.js';
import { desplazar } from './mover.js';

const PAL = {
  bg: '#0c0a0a', suelo: '#1d1818', huella: '#241e1e', tubo: '#33424c', cerrado: '#2e2a2a', agua: '#3987e5', critica: '#d03b3b',
  nd: '#4a4545', particula: '#dff6ff', tinta2: '#b8adad', acento: '#d62a29', bomba: '#f5a524', valvula: '#4cc2ff', sel: '#ffffff',
  pr: ['#c82020', '#e88a2c', '#f2f24c', '#a0ec46', '#289446'],
  v: ['#1a3a63', '#1c5cab', '#2a78d6', '#5598e7', '#9ec5f4', '#cde2fb'], valta: '#fab219',
};
const CLASES = [[0, 250, 1.3], [250, 450, 1.9], [450, 800, 2.7], [800, 1300, 3.6], [1300, 2100, 4.8], [2100, 1e9, 6.4]];   // mm y px
const H_TANQUE = 0.9;
const CLAVE = 'cauce-3d';
const opc = Object.assign({ modo: 'presion', flujo: true, nombres: true, exag: null }, leerOpc());
let tres = null;          // promesa de carga de three.js
let V = null;             // la escena del modelo abierto
let R = null;             // renderer, cámara y controles: se crean una vez y sirven para cada modelo
const camaras = {};       // por pestaña, dónde quedó la cámara: al volver a ese modelo sigue ahí
let abierta = false;

function leerOpc() { try { return JSON.parse(localStorage.getItem(CLAVE) || '{}'); } catch (e) { return {}; } }
function guardarOpc() { try { localStorage.setItem(CLAVE, JSON.stringify(opc)); } catch (e) { /* sin almacenamiento */ } }
const reducido = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function script(src) {
  return new Promise((ok, mal) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => mal(new Error(`No se pudo cargar ${src}`));
    document.head.append(s);
  });
}
function cargarTres() {
  if (!tres) {
    tres = (async () => {
      await script('/lib/three/three.min.js');
      for (const f of ['OrbitControls', 'LineSegmentsGeometry', 'LineMaterial', 'LineSegments2']) await script(`/lib/three/${f}.js`);
    })();
    tres.catch(() => { tres = null; });
  }
  return tres;
}

export function estaAbierta() { return abierta; }
// para revisar desde la consola (como window.VisorRed del visor web)
window.VistaRed3D = { estado: () => V, opciones: opc, cuadro: () => cuadro(performance.now()) };

export async function abrir3d() {
  if (!S.M || abierta) return;
  abierta = true;
  document.body.classList.add('vista-3d');
  $('#b-3d')?.setAttribute('aria-pressed', 'true');
  capa().hidden = false;
  document.getElementById('v3d').classList.toggle('cruz', CRUZ(S.herramienta));
  try { await cargarTres(); } catch (e) { fallo(e); cerrar3d(); return; }
  if (!abierta) return;
  await resultados();
  if (!V || V.M !== S.M) construir();
  pintarControles(); escribirLeyenda();
  V.sucio = V.necesita = V.camMovida = true;
  redimensionar();
  if (!V.bucle) { V.ultimo = performance.now(); V.bucle = requestAnimationFrame(bucle); }
}
export function cerrar3d() {
  abierta = false;
  document.body.classList.remove('vista-3d');
  $('#b-3d')?.setAttribute('aria-pressed', 'false');
  const c = document.getElementById('v3d-capa'); if (c) c.hidden = true;
  if (V?.bucle) { cancelAnimationFrame(V.bucle); V.bucle = null; }
  ocultarTip();
}
export function alternar3d() { if (abierta) cerrar3d(); else abrir3d(); }

// los resultados que usa la vista (presión, velocidad, caudal), en el orden del modelo
async function resultados() {
  if (!S.corrida) return;
  for (const v of ['presion', 'velocidad', 'caudal']) await cargarVariable(v).catch(() => {});
}
bus.on('corrida', async () => { if (abierta && V) { await resultados(); V.sucio = true; escribirLeyenda(); pintarControles(); } });
bus.on('ir', ({ clase, id }) => {
  if (!abierta || !V) return;
  const i = clase === 'nudo' ? S.idxN.get(id) : S.idxL.get(id);
  if (i !== undefined) irA(clase, i);
});

// ====================================================================== capa y controles
function capa() {
  let c = document.getElementById('v3d-capa');
  if (c) return c;
  c = h(`<div id="v3d-capa" hidden>
    <canvas id="v3d" aria-label="La red en 3D"></canvas>
    <div id="v3d-nombres" aria-hidden="true"></div>
    <div id="v3d-tip" role="tooltip" hidden></div>
    <div id="v3d-area" hidden></div>
    <div id="v3d-ctl" class="flota"></div>
    <svg id="v3d-norte" viewBox="-20 -20 40 40" aria-label="Norte"><g><path d="M0 -15 L5 2 L0 -2 L-5 2 Z" /><text y="14" text-anchor="middle">N</text></g></svg>
    <div id="v3d-ayuda">Arrastra para girar · botón derecho para desplazar · rueda para acercar · clic para ver la ficha · E para editar</div>
  </div>`);
  document.getElementById('mapa-caja').append(c);
  return c;
}
function pintarControles() {
  const c = $('#v3d-ctl');
  if (!c) return;
  const hay = !!S.corrida;
  c.innerHTML = `<label>Colorear <select id="v3d-modo" ${hay ? '' : 'disabled'}>
      <option value="presion">Presión en nudos</option><option value="velocidad">Velocidad en tuberías</option></select></label>
    <label class="chk" ${hay ? '' : 'title="Corre el modelo para ver el agua moviéndose"'}><input type="checkbox" id="v3d-flujo" ${opc.flujo ? 'checked' : ''} ${hay ? '' : 'disabled'}> Flujo animado</label>
    <label class="chk"><input type="checkbox" id="v3d-nom" ${opc.nombres ? 'checked' : ''}> Nombres</label>
    <label class="exag">Exageración vertical <input type="range" id="v3d-exag" min="1" max="40" step="1" value="${V.exag}"><b id="v3d-exag-v">×${V.exag}</b></label>
    <button class="btn chico" id="v3d-toda">Toda la red</button>`;
  $('#v3d-modo').value = opc.modo;
  $('#v3d-modo').onchange = (e) => { opc.modo = e.target.value; guardarOpc(); V.sucio = true; escribirLeyenda(); };
  $('#v3d-flujo').onchange = (e) => { opc.flujo = e.target.checked; guardarOpc(); V.particulas.visible = opc.flujo && hay; V.necesita = true; };
  $('#v3d-nom').onchange = (e) => { opc.nombres = e.target.checked; guardarOpc(); V.etiSucias = true; };
  $('#v3d-exag').oninput = (e) => {
    V.exag = opc.exag = Number(e.target.value); guardarOpc();
    $('#v3d-exag-v').textContent = `×${V.exag}`;
    colocarTodo(); V.necesita = V.camMovida = true;
  };
  $('#v3d-toda').onclick = () => volar(cajaToda());
  V.particulas.visible = opc.flujo && hay;
}
export function escribirLeyenda() {
  const l = document.getElementById('leyenda');
  if (!l || !abierta || !V) return;
  const sw = (c, p) => `<span class="sw${p ? ' p' : ''}" style="background:${c}"></span>`;
  if (!S.corrida) {
    l.innerHTML = `<div class="t">Red en 3D</div>${CLASES.slice(0, 5).map(([a, b], k) => `<div class="it">${sw(PAL.tubo)}<span style="opacity:${0.55 + k * 0.1}">${b < 1e9 ? `${a}–${b}` : `≥ ${a}`} mm</span></div>`).join('')}
      <div class="it">${sw(PAL.agua, 1)} Tanque (nivel inicial)</div><div class="it">${sw(PAL.acento, 1)} Embalse</div>
      <div class="it" style="margin-top:4px;max-width:220px">Corre el modelo para colorear por presión y ver el agua moviéndose.</div>`;
    return;
  }
  const up = U('presion'), uv = U('velocidad');
  const P = V.umbP, Vv = V.umbV;
  const pres = [[PAL.pr[0], `< ${n(P[0], 0)}`], [PAL.pr[1], `${n(P[0], 0)}–${n(P[1], 0)}`], [PAL.pr[2], `${n(P[1], 0)}–${n(P[2], 0)}`], [PAL.pr[3], `${n(P[2], 0)}–${n(P[3], 0)}`], [PAL.pr[4], `> ${n(P[3], 0)}`]];
  l.innerHTML = opc.modo === 'presion'
    ? `<div class="t">Presión (${esc(up)})</div>${pres.map(([c, t]) => `<div class="it">${sw(c, 1)} ${t}</div>`).join('')}
       <div class="it">${sw(PAL.agua)} Agua en los tanques</div><div class="it">${sw(PAL.particula, 1)} Flujo (más brillo, más rápido)</div>`
    : `<div class="t">Velocidad (${esc(uv)})</div><div class="it"><span class="sw" style="width:120px;background:linear-gradient(90deg,${PAL.v.join(',')})"></span></div>
       <div class="it" style="justify-content:space-between;width:120px"><span>0</span><span>${n(Vv, 1)}</span></div>
       <div class="it">${sw(PAL.valta)} Más de ${n(Vv, 1)}</div><div class="it">${sw(PAL.cerrado)} Cerrada o quieta</div>`;
}

// ====================================================================== escena
function construir() {
  const T3 = window.THREE;
  const nuevoDoc = !V || V.doc !== S.doc;
  if (V && nuevoDoc) camaras[V.doc] = { obj: R.controles.target.clone(), pos: R.camara.position.clone() };
  if (V) {      // la escena anterior suelta su memoria de video; el renderer y la cámara se quedan
    V.escena.traverse((o) => { o.geometry?.dispose(); [].concat(o.material || []).forEach((m) => m.dispose()); });
  }
  const M = S.M, N = M.nudos.id.length, L = M.tramos.id.length, sis = M.sistema || {};
  const C = (x) => new T3.Color(x);
  // escala: la red ocupa unas 450 unidades
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const cotas = [];
  for (let i = 0; i < N; i++) {
    const x = M.nudos.x[i], y = M.nudos.y[i];
    if (x === null || y === null) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (M.nudos.tipo[i] === 0) cotas.push(M.nudos.cota[i]);
  }
  cotas.sort((a, b) => a - b);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, ext = Math.max(x1 - x0, y1 - y0, 1);
  const Us = ext / 450;
  const Z0 = cotas.length ? cotas[Math.floor(cotas.length * 0.01)] : 0;
  const zr = cotas.length ? cotas[Math.floor(cotas.length * 0.99)] - Z0 : 1;
  const zMed = cotas.length ? cotas[Math.floor(cotas.length / 2)] : 0;
  const exagAuto = Math.round(Math.min(40, Math.max(1, (0.06 * ext) / Math.max(zr, 1e-6))));
  const am = sis.a_metros || 1;
  const factorP = { psi: 1.4219, kPa: 9.80665, bar: 0.0980665 }[sis.presion] || 1;
  const factorV = sis.us ? 3.2808 : 1;
  V = {
    M, N, L, cx, cy, Us, Z0, zMed, am, exag: opc.exag || exagAuto, exagAuto,
    umbP: [15, 30, 50, 80].map((x) => x * factorP), umbV: 2.5 * factorV,
    sucio: true, necesita: true, camMovida: true, etiSucias: true, bucle: V?.bucle ?? null, ultimo: V?.ultimo ?? performance.now(),
    tVis: S.t ?? S.hora ?? 0, ptr: null, distPrev: 0, doc: S.doc,
  };
  V.sx = (x) => (x - cx) / Us; V.sz = (y) => -(y - cy) / Us; V.sy = (z) => ((z - Z0) / Us) * V.exag;
  const canvas = $('#v3d');
  if (!R) {
    const renderer = new T3.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));    // por encima de 1,5 se nota poco y cuesta mucho
    const camara = new T3.PerspectiveCamera(42, 1, 0.5, 8000);
    const controles = new T3.OrbitControls(camara, canvas);
    controles.enableDamping = !reducido(); controles.dampingFactor = 0.08;
    controles.screenSpacePanning = false; controles.maxPolarAngle = Math.PI * 0.48;
    controles.minDistance = 4; controles.maxDistance = 1800;
    controles.addEventListener('change', () => { if (V) { V.necesita = true; V.camMovida = true; } });
    R = { renderer, camara, controles };
  }
  const { renderer, camara, controles } = R;
  const escena = new T3.Scene();
  escena.background = C(PAL.bg);
  Object.assign(V, { renderer, escena, camara, controles, T3 });
  const malla = new T3.GridHelper(900, 90, C(PAL.suelo), C(PAL.suelo));
  malla.position.y = -0.6;
  escena.add(malla);

  // trazados: n1 + vértices + n2, con la cota interpolada a lo largo del tramo
  const off = new Uint32Array(L + 1), px = [], pa = [];
  const largo = new Float32Array(L), clase = new Uint8Array(L), tipoL = M.tramos.tipo;
  const xyz = (i) => [M.nudos.x[i], M.nudos.y[i], M.nudos.cota[i]];
  for (let l = 0; l < L; l++) {
    off[l] = px.length / 3;
    const a = M.tramos.n1[l], b = M.tramos.n2[l];
    const pts = [[M.nudos.x[a], M.nudos.y[a]]];
    for (let k = M.tramos.vi[l]; k < M.tramos.vi[l + 1]; k++) pts.push([M.tramos.vx[k * 2], M.tramos.vx[k * 2 + 1]]);
    pts.push([M.nudos.x[b], M.nudos.y[b]]);
    const ok = pts.every((p) => p[0] !== null && p[1] !== null);
    let tot = 0; const acum = [0];
    if (ok) for (let k = 1; k < pts.length; k++) { tot += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); acum.push(tot); }
    const za = altura(a), zb = altura(b);
    if (ok) pts.forEach((p, k) => { px.push(p[0], p[1], za + (zb - za) * (tot ? acum[k] / tot : 0)); pa.push(acum[k]); });
    largo[l] = tot || 1;
    const dmm = (M.tramos.diam[l] || 0) * (sis.us ? 25.4 : 1);
    clase[l] = CLASES.findIndex(([lo, hi]) => dmm >= lo && dmm < hi);
  }
  off[L] = px.length / 3;
  Object.assign(V, { off, PX: Float32Array.from(px), PA: Float32Array.from(pa), largo, clase });

  // tuberías: un LineSegments2 por clase de diámetro (bombas y válvulas van aparte, como marcas)
  V.lineas = [];
  CLASES.forEach((cl, c) => {
    let cuantos = 0;
    for (let l = 0; l < L; l++) if (clase[l] === c && esTubo(tipoL[l])) cuantos += Math.max(0, off[l + 1] - off[l] - 1);
    if (!cuantos) return;
    const segL = new Int32Array(cuantos), segI = new Uint32Array(cuantos);
    let k = 0;
    for (let l = 0; l < L; l++) if (clase[l] === c && esTubo(tipoL[l])) for (let i = off[l]; i < off[l + 1] - 1; i++) { segL[k] = l; segI[k] = i; k++; }
    const geo = new T3.LineSegmentsGeometry();
    geo.setPositions(new Float32Array(cuantos * 6)); geo.setColors(new Float32Array(cuantos * 6));
    const mat = new T3.LineMaterial({ linewidth: cl[2], vertexColors: true, resolution: new T3.Vector2(1, 1) });
    const obj = new T3.LineSegments2(geo, mat);
    obj.frustumCulled = false;
    escena.add(obj);
    V.lineas.push({ n: cuantos, segL, segI, geo, mat, ancho: cl[2] });
  });
  // huella en planta, a ras de suelo
  {
    let k = 0; for (let l = 0; l < L; l++) k += Math.max(0, off[l + 1] - off[l] - 1);
    const p = new Float32Array(k * 6); let o = 0;
    for (let l = 0; l < L; l++) for (let i = off[l]; i < off[l + 1] - 1; i++) {
      p[o] = V.sx(V.PX[i * 3]); p[o + 1] = -0.4; p[o + 2] = V.sz(V.PX[i * 3 + 1]);
      p[o + 3] = V.sx(V.PX[i * 3 + 3]); p[o + 4] = -0.4; p[o + 5] = V.sz(V.PX[i * 3 + 4]); o += 6;
    }
    const g = new T3.BufferGeometry(); g.setAttribute('position', new T3.BufferAttribute(p, 3));
    escena.add(new T3.LineSegments(g, new T3.LineBasicMaterial({ color: C(PAL.huella) })));
  }

  // nudos: puntos con su color (presión), más grandes si tienen demanda
  const puntos = (cuantos, tam) => {
    const geo = new T3.BufferGeometry();
    const pos = new Float32Array(cuantos * 3), col = new Float32Array(cuantos * 3), t = Float32Array.from(tam);
    geo.setAttribute('position', new T3.BufferAttribute(pos, 3));
    geo.setAttribute('acolor', new T3.BufferAttribute(col, 3));
    geo.setAttribute('tam', new T3.BufferAttribute(t, 1));
    const mat = new T3.ShaderMaterial({
      uniforms: { px: { value: renderer.getPixelRatio() }, escala: { value: 1 } },
      vertexShader: 'attribute vec3 acolor; attribute float tam; uniform float px; uniform float escala; varying vec3 vC;'
        + 'void main(){ vC = acolor; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = tam * px * escala * clamp(460.0 / -mv.z, 1.0, 2.4); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying vec3 vC; void main(){ vec2 c = gl_PointCoord - 0.5; if (dot(c,c) > 0.25) discard; gl_FragColor = vec4(vC, 1.0); }',
      depthTest: false,
    });
    const obj = new T3.Points(geo, mat); obj.frustumCulled = false;
    escena.add(obj);
    return { geo, pos, col, mat, obj };
  };
  V.nudos = puntos(N, Array.from({ length: N }, (_, i) => (M.nudos.tipo[i] !== 0 ? 0 : (M.nudos.dem[i] > 0.05 ? 3.6 : 2.4))));
  V.nudos.obj.renderOrder = 3;
  // bombas y válvulas: una marca en la mitad del tramo
  V.marcas = [];
  for (let l = 0; l < L; l++) if (!esTubo(tipoL[l])) V.marcas.push(l);
  V.equipos = puntos(V.marcas.length, V.marcas.map(() => 6.5));
  V.equipos.obj.renderOrder = 5;
  V.marcas.forEach((l, k) => { const c = C(tipoL[l] === 'PUMP' ? PAL.bomba : PAL.valvula); V.equipos.col.set([c.r, c.g, c.b], k * 3); });
  V.equipos.geo.attributes.acolor.needsUpdate = true;

  // tanques: cilindro con el agua a su nivel; los compartimentos que se tocan se reparten en corro
  V.tanques = [];
  for (let i = 0; i < N; i++) {
    if (M.nudos.tipo[i] !== 2 || M.nudos.x[i] === null) continue;
    const t = M.tanques[i] || {};
    const r = Math.max(1.1, Math.min(3, ((t.diam || 20) * am) / 30));
    const contorno = new T3.Mesh(new T3.CylinderGeometry(r, r, 1, 28, 1, true),
      new T3.MeshBasicMaterial({ color: C(PAL.tinta2), transparent: true, opacity: 0.16, side: T3.DoubleSide, depthWrite: false }));
    const agua = new T3.Mesh(new T3.CylinderGeometry(r * 0.86, r * 0.86, 1, 28), new T3.MeshBasicMaterial({ color: C(PAL.agua) }));
    const aro = []; for (let k = 0; k < 28; k++) { const a = (k / 28) * Math.PI * 2; aro.push(Math.cos(a) * r, 0, Math.sin(a) * r); }
    const ga = new T3.BufferGeometry(); ga.setAttribute('position', new T3.Float32BufferAttribute(aro, 3));
    const tapa = new T3.LineLoop(ga, new T3.LineBasicMaterial({ color: C(PAL.tinta2) }));
    escena.add(contorno, agua, tapa);
    V.tanques.push({ i, t, r, contorno, agua, tapa, dx: 0, dz: 0 });
  }
  agrupar();
  // embalses: un cono rojo con su tallo a la altura de la carga
  V.embalses = [];
  for (let i = 0; i < N; i++) {
    if (M.nudos.tipo[i] !== 1 || M.nudos.x[i] === null) continue;
    const cono = new T3.Mesh(new T3.ConeGeometry(2.4, 5, 4), new T3.MeshBasicMaterial({ color: C(PAL.acento) }));
    cono.rotation.x = Math.PI;
    const g = new T3.BufferGeometry(); g.setAttribute('position', new T3.Float32BufferAttribute([0, 0, 0, 0, 1, 0], 3));
    const tallo = new T3.Line(g, new T3.LineBasicMaterial({ color: C(PAL.acento) }));
    escena.add(cono, tallo);
    V.embalses.push({ i, cono, tallo });
  }
  // selección
  V.selMarca = new T3.Mesh(new T3.RingGeometry(1.6, 2.1, 32), new T3.MeshBasicMaterial({ color: C(PAL.sel), side: T3.DoubleSide, depthTest: false, transparent: true }));
  V.selMarca.rotation.x = -Math.PI / 2; V.selMarca.renderOrder = 6; V.selMarca.visible = false;
  escena.add(V.selMarca);
  // guías de edición: la línea elástica (tubería, unir) y el nudo que se arrastra
  {
    const g = new T3.BufferGeometry(); g.setAttribute('position', new T3.BufferAttribute(new Float32Array(6), 3));
    V.goma = new T3.Line(g, new T3.LineDashedMaterial({ color: C(PAL.sel), dashSize: 1.2, gapSize: 0.8, depthTest: false, transparent: true }));
    V.goma.renderOrder = 7; V.goma.visible = false; V.goma.frustumCulled = false;
    V.arrastreMarca = new T3.Mesh(new T3.SphereGeometry(0.9, 16, 12), new T3.MeshBasicMaterial({ color: C(PAL.sel), depthTest: false, transparent: true }));
    V.arrastreMarca.renderOrder = 7; V.arrastreMarca.visible = false;
    V.origenMarca = new T3.Mesh(new T3.OctahedronGeometry(1.1), new T3.MeshBasicMaterial({ color: C(PAL.acento), depthTest: false, transparent: true, wireframe: true }));
    V.origenMarca.renderOrder = 7; V.origenMarca.visible = false;
    escena.add(V.goma, V.arrastreMarca, V.origenMarca);
  }

  // partículas de flujo: en las tuberías gruesas y largas, unas 3.200 en toda la red
  let dmin = 500;
  const cands = () => { const c = []; let tot = 0; for (let l = 0; l < L; l++) if (esTubo(tipoL[l]) && (M.tramos.diam[l] || 0) * (sis.us ? 25.4 : 1) >= dmin && largo[l] * am > 40) { c.push(l); tot += largo[l]; } return [c, tot]; };
  let [cand, largoTot] = cands();
  let total = 0; for (let l = 0; l < L; l++) if (esTubo(tipoL[l])) total += largo[l];
  while (largoTot < total * 0.25 && dmin > 0) { dmin = dmin > 300 ? 300 : dmin > 150 ? 150 : 0; [cand, largoTot] = cands(); }
  // ~1/110 del ancho como mínimo: en una red pequeña no se amontonan en una línea continua
  const paso = Math.max(largoTot / 3200, ext / 110);
  const pl = [], ps = [];
  cand.forEach((l) => { const k = Math.max(1, Math.round(largo[l] / paso)); for (let j = 0; j < k; j++) { pl.push(l); ps.push(((j + Math.random() * 0.8) * largo[l]) / k); } });
  V.NP = pl.length; V.pLink = Int32Array.from(pl); V.pS = Float32Array.from(ps);
  const pg = new T3.BufferGeometry();
  V.partPos = new Float32Array(V.NP * 3); V.partAlfa = new Float32Array(V.NP);
  pg.setAttribute('position', new T3.BufferAttribute(V.partPos, 3));
  pg.setAttribute('alfa', new T3.BufferAttribute(V.partAlfa, 1));
  const pm = new T3.ShaderMaterial({
    uniforms: { px: { value: renderer.getPixelRatio() }, col: { value: C(PAL.particula) } },
    vertexShader: 'attribute float alfa; uniform float px; varying float vA; void main(){ vA = alfa; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = 3.2 * px * clamp(460.0 / -mv.z, 1.0, 2.2); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 col; varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float d = dot(c,c); if (d > 0.25 || vA < 0.01) discard; gl_FragColor = vec4(col, vA * (1.0 - d * 3.2)); }',
    transparent: true, depthWrite: false, depthTest: false, blending: T3.AdditiveBlending,
  });
  V.partGeo = pg;
  V.particulas = new T3.Points(pg, pm); V.particulas.frustumCulled = false; V.particulas.renderOrder = 4;
  escena.add(V.particulas);

  // nombres: tanques y embalses (los que caben)
  const capaN = $('#v3d-nombres'); capaN.innerHTML = '';
  V.nombres = [];
  for (let i = 0; i < N; i++) {
    if (M.nudos.tipo[i] === 0 || M.nudos.x[i] === null) continue;
    const t = (M.nudos.com[i] || M.nudos.id[i]).replace(/_/g, ' ');
    const d = h(`<div class="${M.nudos.tipo[i] === 1 ? 'emb' : ''}">${esc(t.length > 24 ? `${t.slice(0, 23)}…` : t)}</div>`);
    capaN.append(d);
    V.nombres.push({ i, d });
  }
  V.valN = new Float32Array(N).fill(NaN); V.valL = new Float32Array(L).fill(NaN); V.valQ = new Float32Array(L).fill(NaN);
  V.colTubo = new Float32Array(L * 3);
  colocarTodo();
  ponerEventos(canvas);
  redimensionar();
  if (nuevoDoc && camaras[S.doc]) { controles.target.copy(camaras[S.doc].obj); camara.position.copy(camaras[S.doc].pos); controles.update(); }
  else if (nuevoDoc) volar(cajaToda(), true);
}
function esTubo(t) { return t === 'PIPE' || t === 'CV'; }
// la altura de un nudo en el dibujo: la cota (o la carga, si es embalse)
function altura(i) { return S.M.nudos.cota[i]; }

function agrupar() {
  const tq = V.tanques;
  const pos = tq.map((k) => [V.sx(S.M.nudos.x[k.i]), V.sz(S.M.nudos.y[k.i])]);
  const usado = new Uint8Array(tq.length);
  for (let a = 0; a < tq.length; a++) {
    if (usado[a]) continue;
    const grupo = [a]; usado[a] = 1;
    for (let g = 0; g < grupo.length; g++) for (let b = 0; b < tq.length; b++) {
      if (usado[b]) continue;
      const u = grupo[g];
      if (Math.hypot(pos[u][0] - pos[b][0], pos[u][1] - pos[b][1]) < (tq[u].r + tq[b].r) * 1.15) { grupo.push(b); usado[b] = 1; }
    }
    if (grupo.length < 2) continue;
    const cx = grupo.reduce((s, u) => s + pos[u][0], 0) / grupo.length, cz = grupo.reduce((s, u) => s + pos[u][1], 0) / grupo.length;
    const rmax = Math.max(...grupo.map((u) => tq[u].r));
    const anillo = grupo.length === 2 ? rmax * 1.25 : (rmax * 2.5 * grupo.length) / (2 * Math.PI);
    grupo.sort((u, v) => Math.atan2(pos[u][1] - cz, pos[u][0] - cx) - Math.atan2(pos[v][1] - cz, pos[v][0] - cx));
    const giro = Math.atan2(pos[grupo[0]][1] - cz, pos[grupo[0]][0] - cx) || 0;
    grupo.forEach((u, j) => {
      const ang = giro + (j * 2 * Math.PI) / grupo.length;
      tq[u].dx = cx + Math.cos(ang) * anillo - pos[u][0];
      tq[u].dz = cz + Math.sin(ang) * anillo - pos[u][1];
    });
  }
  const T3 = V.T3;
  tq.forEach((k) => {
    if (!k.dx && !k.dz) return;
    const g = new T3.BufferGeometry(); g.setAttribute('position', new T3.Float32BufferAttribute([0, 0, 0, 1, 0, 1], 3));
    k.guia = new T3.Line(g, new T3.LineBasicMaterial({ color: new T3.Color(PAL.tinta2), transparent: true, opacity: 0.55 }));
    V.escena.add(k.guia);
  });
}

function colocarTodo() {
  const { sx, sy, sz, PX } = V, M = S.M;
  V.lineas.forEach((ln) => {
    const pos = ln.geo.attributes.instanceStart.data.array;
    for (let s = 0; s < ln.n; s++) {
      const i = ln.segI[s] * 3, o = s * 6;
      pos[o] = sx(PX[i]); pos[o + 1] = sy(PX[i + 2]); pos[o + 2] = sz(PX[i + 1]);
      pos[o + 3] = sx(PX[i + 3]); pos[o + 4] = sy(PX[i + 5]); pos[o + 5] = sz(PX[i + 4]);
    }
    ln.geo.attributes.instanceStart.data.needsUpdate = true;
    ln.geo.computeBoundingSphere(); ln.geo.computeBoundingBox();
  });
  for (let i = 0; i < V.N; i++) {
    const x = M.nudos.x[i];
    if (x === null) { V.nudos.pos.set([0, -9999, 0], i * 3); continue; }
    V.nudos.pos[i * 3] = sx(x); V.nudos.pos[i * 3 + 1] = sy(altura(i)); V.nudos.pos[i * 3 + 2] = sz(M.nudos.y[i]);
  }
  V.nudos.geo.attributes.position.needsUpdate = true;
  V.marcas.forEach((l, k) => { posicion(l, V.largo[l] / 2, V.equipos.pos, k * 3); });
  V.equipos.geo.attributes.position.needsUpdate = true;
  V.tanques.forEach((k) => {
    const x0 = sx(M.nudos.x[k.i]), z0 = sz(M.nudos.y[k.i]), y = sy(M.nudos.cota[k.i]);
    const x = x0 + k.dx, z = z0 + k.dz;
    const hh = Math.max(1.2, (k.t.nmax || 4) * V.am * H_TANQUE);
    k.base = y; k.h = hh; k.x = x; k.z = z;
    k.contorno.scale.y = hh; k.contorno.position.set(x, y + hh / 2, z);
    k.tapa.position.set(x, y + hh, z);
    k.agua.position.set(x, y, z);
    if (k.guia) { k.guia.position.set(x0, y + 0.05, z0); k.guia.scale.set(k.dx, 1, k.dz); }
  });
  V.embalses.forEach((k) => {
    const x = sx(M.nudos.x[k.i]), z = sz(M.nudos.y[k.i]), y = sy(M.nudos.cota[k.i]);
    k.y = y + 9; k.x = x; k.z = z;
    k.cono.position.set(x, y + 9, z);
    k.tallo.position.set(x, -0.4, z); k.tallo.scale.y = Math.max(0.1, y + 6.5 + 0.4);
  });
  for (let i = 0; i < V.NP; i++) posicion(V.pLink[i], V.pS[i], V.partPos, i * 3);
  V.partGeo.attributes.position.needsUpdate = true;
  colocarSeleccion();
  V.sucio = V.etiSucias = true;
}
function posicion(l, s, out, o) {
  const { off, PA, PX } = V;
  const i0 = off[l], i1 = off[l + 1] - 1;
  if (i1 <= i0) { out[o + 1] = -9999; return; }
  let k = i0 + 1; while (k < i1 && PA[k] < s) k++;
  const f = Math.min(1, Math.max(0, (s - PA[k - 1]) / Math.max(1e-6, PA[k] - PA[k - 1])));
  const a = (k - 1) * 3, b = k * 3;
  out[o] = V.sx(PX[a] + (PX[b] - PX[a]) * f);
  out[o + 1] = V.sy(PX[a + 2] + (PX[b + 2] - PX[a + 2]) * f);
  out[o + 2] = V.sz(PX[a + 1] + (PX[b + 1] - PX[a + 1]) * f);
}

// ====================================================================== color y hora
function colorPresion(p, c) {
  const u = V.umbP;
  return c.set(Number.isNaN(p) ? PAL.nd : PAL.pr[p < u[0] ? 0 : p < u[1] ? 1 : p < u[2] ? 2 : p <= u[3] ? 3 : 4]);
}
function colorVelocidad(v, c, c2) {
  if (Number.isNaN(v) || Math.abs(v) < 1e-4) return c.set(PAL.cerrado);
  const a = Math.abs(v);
  if (a > V.umbV) return c.set(PAL.valta);
  const x = Math.min(a / V.umbV, 1) * 5, i = Math.min(4, Math.floor(x));
  return c.set(PAL.v[i]).lerp(c2.set(PAL.v[i + 1]), x - i);
}
function muestrear() {
  const T = S.T;
  const t = Math.max(0, Math.min(V.tVis, Math.max(0, T - 1)));
  const t0 = Math.floor(t), t1 = Math.min(t0 + 1, T - 1), f = t - t0;
  const pr = S.res.presion, ve = S.res.velocidad, q = S.res.caudal;
  const N = V.N, L = V.L;
  for (let i = 0; i < N; i++) {
    if (pr && T) { const a = pr[t0 * N + i], b = pr[t1 * N + i]; V.valN[i] = a + (b - a) * f; } else V.valN[i] = NaN;
  }
  for (let l = 0; l < L; l++) {
    if (ve && T) { const a = ve[t0 * L + l], b = ve[t1 * L + l]; V.valL[l] = a + (b - a) * f; } else V.valL[l] = NaN;
    if (q && T) { const a = q[t0 * L + l], b = q[t1 * L + l]; V.valQ[l] = a + (b - a) * f; } else V.valQ[l] = NaN;
    // la velocidad sale en valor absoluto en algunas versiones: el signo lo pone el caudal
    if (!Number.isNaN(V.valQ[l]) && V.valQ[l] < 0 && V.valL[l] > 0) V.valL[l] = -V.valL[l];
  }
}
function pintar() {
  const T3 = V.T3, c = new T3.Color(), c2 = new T3.Color(), tubo = new T3.Color(PAL.tubo), cerr = new T3.Color(PAL.cerrado);
  const hay = !!S.corrida && S.res.velocidad, M = S.M;
  for (let l = 0; l < V.L; l++) {
    if (!hay) {
      const k = V.clase[l];
      c.copy(M.tramos.estado[l] === 'CLOSED' ? cerr : tubo).lerp(c2.set('#9aa8b2'), Math.max(0, k) * 0.07);
    } else if (opc.modo === 'velocidad') colorVelocidad(V.valL[l], c, c2);
    else if (Number.isNaN(V.valL[l]) || Math.abs(V.valL[l]) < 1e-4) c.copy(cerr);
    else colorVelocidad(V.valL[l], c, c2).lerp(tubo, 0.6);
    V.colTubo[l * 3] = c.r; V.colTubo[l * 3 + 1] = c.g; V.colTubo[l * 3 + 2] = c.b;
  }
  V.lineas.forEach((ln) => {
    const a = ln.geo.attributes.instanceColorStart.data.array;
    for (let i = 0; i < ln.n; i++) {
      const l = ln.segL[i] * 3, o = i * 6;
      a[o] = a[o + 3] = V.colTubo[l]; a[o + 1] = a[o + 4] = V.colTubo[l + 1]; a[o + 2] = a[o + 5] = V.colTubo[l + 2];
    }
    ln.geo.attributes.instanceColorStart.data.needsUpdate = true;
  });
  for (let i = 0; i < V.N; i++) {
    if (hay) colorPresion(V.valN[i], c); else c.set('#7d7272');
    V.nudos.col[i * 3] = c.r; V.nudos.col[i * 3 + 1] = c.g; V.nudos.col[i * 3 + 2] = c.b;
  }
  V.nudos.geo.attributes.acolor.needsUpdate = true;
  V.nudos.mat.uniforms.escala.value = hay && opc.modo === 'velocidad' ? 0 : 1;
  V.tanques.forEach((k) => {
    // en EPANET la "presión" de un tanque es su nivel
    const lv = hay ? V.valN[k.i] : (k.t.nini || 0);
    const nivel = Number.isNaN(lv) ? 0 : Math.max(0, lv);
    const hh = Math.max(0.05, nivel * V.am * H_TANQUE);
    k.agua.scale.y = hh; k.agua.position.y = k.base + hh / 2;
    const frac = (nivel - (k.t.nmin || 0)) / Math.max(0.1, (k.t.nmax || 1) - (k.t.nmin || 0));
    k.agua.material.color.set(frac < 0.08 ? PAL.critica : PAL.agua);
  });
}
function colocarSeleccion() {
  const s = S.sel, m = V.selMarca;
  if (!s) { m.visible = false; return; }
  const out = new Float32Array(3);
  if (s.clase === 'nudo') {
    if (S.M.nudos.x[s.i] === null) { m.visible = false; return; }
    out[0] = V.sx(S.M.nudos.x[s.i]); out[1] = V.sy(altura(s.i)); out[2] = V.sz(S.M.nudos.y[s.i]);
  } else posicion(s.i, V.largo[s.i] / 2, out, 0);
  m.position.set(out[0], out[1], out[2]); m.visible = true;
}

// ====================================================================== cámara
function cajaToda() {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const M = S.M;
  for (let i = 0; i < V.N; i++) { const x = M.nudos.x[i], y = M.nudos.y[i]; if (x === null) continue; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [x0, x1, y0, y1];
}
function destino([x0, x1, y0, y1], z) {
  const T3 = V.T3;
  const cx = V.sx((x0 + x1) / 2), cz = V.sz((y0 + y1) / 2), r = Math.max(x1 - x0, y1 - y0) / V.Us;
  const dist = r * 1.25 + 20;
  const y = V.sy(z ?? V.Z0);
  return { obj: new T3.Vector3(cx, y, cz), pos: new T3.Vector3(cx - dist * 0.35, y + dist * 0.62, cz + dist * 0.72) };
}
function volar(caja, inmediato, z) {
  const d = destino(caja, z);
  if (inmediato || reducido()) { V.controles.target.copy(d.obj); V.camara.position.copy(d.pos); V.controles.update(); V.camMovida = V.necesita = true; return; }
  V.vuelo = { t: 0, o0: V.controles.target.clone(), p0: V.camara.position.clone(), o1: d.obj, p1: d.pos };
}
function irA(clase, i) {
  const M = S.M;
  let x, y, z;
  if (clase === 'nudo') { x = M.nudos.x[i]; y = M.nudos.y[i]; z = altura(i); } else {
    const a = M.tramos.n1[i], b = M.tramos.n2[i];
    x = (M.nudos.x[a] + M.nudos.x[b]) / 2; y = (M.nudos.y[a] + M.nudos.y[b]) / 2; z = (altura(a) + altura(b)) / 2;
  }
  if (x === null || Number.isNaN(x)) return;
  const r = 60 * V.Us;
  volar([x - r, x + r, y - r, y + r], false, z);
}

// ====================================================================== puntero y edición
// Los clics del 3D pasan por las mismas herramientas que el mapa 2D: mapa.onClick({clase, i, x, y}) con x, y en
// coordenadas del modelo, mapa.onMover(i, x, y) al soltar un nudo arrastrado y mapa.onArea({nudos, tramos}).
// Un punto vacío se ubica cortando el rayo del ratón con un plano horizontal a la cota del nudo más cercano.
function ponerEventos(canvas) {
  if (canvas.dataset.listo) return;
  canvas.dataset.listo = '1';
  const capaE = document.getElementById('v3d-capa');
  const xy = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  let abajo = null;
  // en captura, antes que los controles de la cámara: arrastrar un nudo o un área no debe girar la vista
  capaE.addEventListener('pointerdown', (e) => {
    if (e.target !== canvas || e.button !== 0 || !V) return;
    const [qx, qy] = xy(e);
    abajo = { x: e.clientX, y: e.clientY };
    ocultarTip();
    if (S.herramienta === 'mover') {
      const o = objetoEn(qx, qy);
      if (o?.clase === 'nudo') {
        V.arrastre = { tipo: 'mover', i: o.i, h: V.sy(altura(o.i)), x0: S.M.nudos.x[o.i], y0: S.M.nudos.y[o.i], movido: false };
        V.controles.enabled = false;
      } else if (o?.equipo) {
        const L = S.M.tramos, N = S.M.nudos, a = L.n1[o.i], b = L.n2[o.i];
        V.arrastre = { tipo: 'mover', tramo: o.i, h: V.sy((altura(a) + altura(b)) / 2), x0: (N.x[a] + N.x[b]) / 2, y0: (N.y[a] + N.y[b]) / 2, movido: false };
        V.controles.enabled = false;
      }
    } else if (S.herramienta === 'area') {
      V.arrastre = { tipo: 'area', ax: qx, ay: qy, bx: qx, by: qy, movido: false };
      V.controles.enabled = false;
    }
  }, true);
  canvas.addEventListener('pointermove', (e) => {
    const [qx, qy] = xy(e);
    V.ptr = { x: qx, y: qy, pend: true };
    const a = V.arrastre;
    if (abajo && a && Math.hypot(e.clientX - abajo.x, e.clientY - abajo.y) > 3) a.movido = true;
    if (a?.tipo === 'mover') { const p = planoDesdePantalla(qx, qy, a.h); if (p) { a.x = p.x; a.y = p.y; } }
    else if (a?.tipo === 'area') { a.bx = qx; a.by = qy; pintarArea(); }
    V.necesita = true;
  });
  canvas.addEventListener('pointerleave', () => { if (!V.arrastre) { V.ptr = null; ocultarTip(); colocarGuias(); } });
  document.addEventListener('pointerup', (e) => {
    if (!V || !abierta) return;
    const a = V.arrastre, clic = abajo && Math.hypot(e.clientX - abajo.x, e.clientY - abajo.y) <= 4 && e.button === 0;
    abajo = null;
    if (a) {
      V.arrastre = null; V.controles.enabled = true; pintarArea(); colocarGuias(); V.necesita = true;
      if (a.tipo === 'mover' && a.movido && a.x !== undefined && a.tramo !== undefined) {
        const L = S.M.tramos, id = L.id[a.tramo];
        desplazar([S.M.nudos.id[L.n1[a.tramo]], S.M.nudos.id[L.n2[a.tramo]]], a.x - a.x0, a.y - a.y0, 0, `Mover ${id}`)
          .then((ok) => { if (ok) aviso(`${id} movido con sus dos nudos. Ctrl+Z lo deshace.`, 'ok'); });
      } else if (a.tipo === 'mover' && a.movido && a.x !== undefined) mapa.onMover?.(a.i, a.x, a.y);
      else if (a.tipo === 'area' && a.movido) mapa.onArea?.(dentroDe(a));
      if (a.movido) return;
    }
    if (!clic || e.target !== canvas) return;
    const [qx, qy] = xy(e);
    const p = elegir3d(qx, qy);
    if (p) mapa.onClick?.(p, e);
  });
}
const CRUZ = (h) => !!h && !['seleccionar', 'mover'].includes(h);
bus.on('herramienta', (h) => { document.getElementById('v3d')?.classList.toggle('cruz', CRUZ(h)); });
bus.on('mover-preciso', () => { if (V && abierta) { colocarGuias(); V.necesita = true; } });

function nudoCercano(x, y) {
  const N = S.M.nudos; let m = -1, d = Infinity;
  for (let i = 0; i < V.N; i++) { if (N.x[i] === null) continue; const dd = (N.x[i] - x) ** 2 + (N.y[i] - y) ** 2; if (dd < d) { d = dd; m = i; } }
  return m;
}
// punto del modelo (x, y) bajo el ratón: plano a la altura dada o, si no se da, a la cota del nudo más cercano
function planoDesdePantalla(qx, qy, alto) {
  const T3 = V.T3;
  if (!V.rayo) { V.rayo = new T3.Raycaster(); V.ndc = new T3.Vector2(); V.pv = new T3.Vector3(); V.plano = new T3.Plane(new T3.Vector3(0, 1, 0), 0); }
  V.ndc.set((qx / V.W) * 2 - 1, -(qy / V.H) * 2 + 1);
  V.rayo.setFromCamera(V.ndc, V.camara);
  let y = alto ?? V.sy(V.zMed), p = null;
  for (let k = 0; k < (alto === undefined ? 3 : 1); k++) {
    V.plano.constant = -y;
    if (!V.rayo.ray.intersectPlane(V.plano, V.pv)) return p;
    p = { x: V.pv.x * V.Us + V.cx, y: -V.pv.z * V.Us + V.cy, h: y };
    if (alto !== undefined) break;
    const j = nudoCercano(p.x, p.y);
    if (j < 0) break;
    y = V.sy(altura(j));
  }
  return p;
}
// lo que hay bajo el ratón, como lo entrega mapa.elegir() en 2D
function elegir3d(qx, qy) {
  // las herramientas que van sobre una tubería no se dejan tapar por los nudos (de lejos hay uno casi encima de cada tubo)
  const o = objetoEn(qx, qy, ['partir', 'valvula', 'bomba'].includes(S.herramienta));
  if (o) return o;
  const p = planoDesdePantalla(qx, qy);
  return p ? { clase: null, x: p.x, y: p.y } : null;
}
function dentroDe(a) {
  const x0 = Math.min(a.ax, a.bx), x1 = Math.max(a.ax, a.bx), y0 = Math.min(a.ay, a.by), y1 = Math.max(a.ay, a.by);
  const v = new V.T3.Vector3(), M = S.M, nudos = [], tramos = [];
  const adentro = (x, y, z) => { const [px, py, pz] = proyectar(x, y, z, v); return pz <= 1 && px >= x0 && px <= x1 && py >= y0 && py <= y1; };
  for (let i = 0; i < V.N; i++) if (M.nudos.x[i] !== null && adentro(V.nudos.pos[i * 3], V.nudos.pos[i * 3 + 1], V.nudos.pos[i * 3 + 2])) nudos.push(i);
  const { off, PX } = V;
  for (let l = 0; l < V.L; l++) {
    if (off[l + 1] <= off[l]) continue;
    let todo = true;
    for (let i = off[l]; i < off[l + 1] && todo; i++) todo = adentro(V.sx(PX[i * 3]), V.sy(PX[i * 3 + 2]), V.sz(PX[i * 3 + 1]));
    if (todo) tramos.push(l);
  }
  return { nudos, tramos };
}
function pintarArea() {
  const d = document.getElementById('v3d-area'), a = V?.arrastre;
  if (!d) return;
  if (!a || a.tipo !== 'area' || !a.movido) { d.hidden = true; return; }
  d.hidden = false;
  d.style.transform = `translate(${Math.min(a.ax, a.bx)}px, ${Math.min(a.ay, a.by)}px)`;
  d.style.width = `${Math.abs(a.bx - a.ax)}px`; d.style.height = `${Math.abs(a.by - a.ay)}px`;
}
// la línea elástica (tubería, unir) y el nudo que se arrastra, dibujados en la escena
function colocarGuias() {
  if (!V?.goma) return;
  const g = V.goma, m = V.arrastreMarca, M = S.M;
  let ver = false;
  const a = V.arrastre, mp = S.moverPreciso;
  V.origenMarca.visible = false;
  if (!a && mp) {
    // «Mover con coordenadas»: del punto de referencia a su destino (con la cota nueva) y una marca en el origen
    const bx = V.sx(mp.x), by = V.sy(mp.z), bz = V.sz(mp.y);
    m.position.set(bx, by, bz); m.visible = true;
    g.geometry.attributes.position.setXYZ(0, V.sx(mp.desde.x), V.sy(mp.desde.z), V.sz(mp.desde.y));
    g.geometry.attributes.position.setXYZ(1, bx, by, bz);
    V.origenMarca.position.set(V.sx(mp.ox), V.sy(mp.oz), V.sz(mp.oy)); V.origenMarca.visible = true;
    ver = true;
  } else if (a?.tipo === 'mover' && a.movido && a.x !== undefined) {
    const x = V.sx(a.x), z = V.sz(a.y);
    m.position.set(x, a.h, z); m.visible = true;
    g.geometry.attributes.position.setXYZ(0, V.sx(a.x0), a.h, V.sz(a.y0));
    g.geometry.attributes.position.setXYZ(1, x, a.h, z);
    ver = true;
  } else {
    m.visible = false;
    const pp = mapa.primerPunto, j = pp ? S.idxN.get(pp.id) : undefined;
    if (j !== undefined && V.ptr) {
      const hov = objetoEn(V.ptr.x, V.ptr.y);
      let b;
      if (hov?.clase === 'nudo') b = [V.nudos.pos[hov.i * 3], V.nudos.pos[hov.i * 3 + 1], V.nudos.pos[hov.i * 3 + 2]];
      else { const p = planoDesdePantalla(V.ptr.x, V.ptr.y); if (p) b = [V.sx(p.x), p.h, V.sz(p.y)]; }
      if (b) {
        g.geometry.attributes.position.setXYZ(0, V.sx(M.nudos.x[j]), V.sy(altura(j)), V.sz(M.nudos.y[j]));
        g.geometry.attributes.position.setXYZ(1, b[0], b[1], b[2]);
        ver = true;
      }
    }
  }
  if (ver) { g.geometry.attributes.position.needsUpdate = true; g.computeLineDistances(); }
  if (g.visible !== ver || ver) V.necesita = true;
  g.visible = ver;
}
function proyectar(x, y, z, v) { v.set(x, y, z).project(V.camara); return [((v.x + 1) / 2) * V.W, ((1 - v.y) / 2) * V.H, v.z]; }
function objetoEn(qx, qy, soloTramos = false) {
  const T3 = V.T3, v = new T3.Vector3(), M = S.M;
  let mejor = null, dm = soloTramos ? -1 : 9;
  if (!soloTramos && [null, undefined, 'seleccionar', 'mover', 'borrar'].includes(S.herramienta)) {
    let de = 9, ke = -1;
    V.marcas.forEach((l, k) => {
      const [px, py, pz] = proyectar(V.equipos.pos[k * 3], V.equipos.pos[k * 3 + 1], V.equipos.pos[k * 3 + 2], v);
      const d = Math.hypot(px - qx, py - qy);
      if (pz <= 1 && d < de) { de = d; ke = l; }
    });
    if (ke >= 0) {
      const a = M.tramos.n1[ke], b = M.tramos.n2[ke];
      return { clase: 'tramo', i: ke, equipo: true, x: (M.nudos.x[a] + M.nudos.x[b]) / 2, y: (M.nudos.y[a] + M.nudos.y[b]) / 2 };
    }
  }
  const esc0 = V.nudos.mat.uniforms.escala.value;
  for (let i = 0; i < V.N; i++) {
    if (M.nudos.x[i] === null || (esc0 === 0 && M.nudos.tipo[i] === 0)) continue;
    const [px, py, pz] = proyectar(V.nudos.pos[i * 3], V.nudos.pos[i * 3 + 1], V.nudos.pos[i * 3 + 2], v);
    if (pz > 1) continue;
    const d = Math.hypot(px - qx, py - qy);
    if (d < dm) { dm = d; mejor = { clase: 'nudo', i }; }
  }
  if (!soloTramos) V.tanques.forEach((k) => {
    const [px, py, pz] = proyectar(k.x, k.base + k.h / 2, k.z, v);
    if (pz <= 1 && Math.hypot(px - qx, py - qy) < 14) { mejor = { clase: 'nudo', i: k.i, tanque: true }; dm = 0; }
  });
  if (mejor) {
    // como en 2D: el punto es el del ratón (a la altura del nudo); en un tanque, el propio tanque
    const p = mejor.tanque ? null : planoDesdePantalla(qx, qy, V.nudos.pos[mejor.i * 3 + 1]);
    return { clase: 'nudo', i: mejor.i, x: p ? p.x : M.nudos.x[mejor.i], y: p ? p.y : M.nudos.y[mejor.i] };
  }
  let dl = soloTramos ? 10 : 6, seg = -1, useg = 0;
  const { off, PX } = V;
  for (let l = 0; l < V.L; l++) {
    for (let i = off[l]; i < off[l + 1] - 1; i++) {
      const [ax, ay, az] = proyectar(V.sx(PX[i * 3]), V.sy(PX[i * 3 + 2]), V.sz(PX[i * 3 + 1]), v);
      const [bx, by, bz] = proyectar(V.sx(PX[i * 3 + 3]), V.sy(PX[i * 3 + 5]), V.sz(PX[i * 3 + 4]), v);
      if (az > 1 || bz > 1) continue;
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      const u = L2 ? Math.max(0, Math.min(1, ((qx - ax) * dx + (qy - ay) * dy) / L2)) : 0;
      const d = Math.hypot(qx - ax - u * dx, qy - ay - u * dy);
      if (d < dl) { dl = d; mejor = { clase: 'tramo', i: l }; seg = i; useg = u; }
    }
  }
  if (mejor) {
    // el punto sobre la tubería (para partir o insertar ahí)
    mejor.x = PX[seg * 3] + (PX[seg * 3 + 3] - PX[seg * 3]) * useg;
    mejor.y = PX[seg * 3 + 1] + (PX[seg * 3 + 4] - PX[seg * 3 + 1]) * useg;
  }
  return mejor;
}
function ocultarTip() { const t = document.getElementById('v3d-tip'); if (t) t.hidden = true; }
function mostrarTip(o, qx, qy) {
  const t = $('#v3d-tip'), M = S.M;
  if (!o) { t.hidden = true; return; }
  let html;
  if (o.clase === 'nudo') {
    const tipo = ['Nudo', 'Embalse', 'Tanque'][M.nudos.tipo[o.i]];
    const v = V.valN[o.i];
    const dato = Number.isNaN(v) ? `cota ${n(M.nudos.cota[o.i], 1)} ${U('cota')}`
      : M.nudos.tipo[o.i] === 2 ? `nivel ${n(v, 2)} ${U('nivel')}` : `presión ${n(v, 1)} ${U('presion')}`;
    html = `<b>${esc(M.nudos.id[o.i])}</b><span>${tipo}${M.nudos.com[o.i] ? ` · ${esc(M.nudos.com[o.i])}` : ''}</span><span>${dato}</span>`;
  } else {
    const tp = M.tramos.tipo[o.i];
    const tipo = tp === 'PIPE' || tp === 'CV' ? 'Tubería' : tp === 'PUMP' ? 'Bomba' : `Válvula ${tp}`;
    const v = V.valL[o.i], q = V.valQ[o.i];
    html = `<b>${esc(M.tramos.id[o.i])}</b><span>${tipo} · ${n(M.tramos.diam[o.i] || 0, 0)} ${U('diametro')}</span>`
      + (Number.isNaN(v) ? `<span>${M.tramos.estado[o.i] === 'CLOSED' ? 'cerrada al inicio' : 'abierta'}</span>` : `<span>${n(Math.abs(v), 2)} ${U('velocidad')} · ${n(Math.abs(q), 1)} ${U('caudal')}</span>`);
  }
  t.innerHTML = html; t.hidden = false;
  const W = V.W, x = Math.min(qx + 14, W - t.offsetWidth - 8), y = Math.max(8, qy - t.offsetHeight - 10);
  t.style.transform = `translate(${x}px, ${y}px)`;
}

// ====================================================================== bucle
function redimensionar() {
  if (!V) return;
  const c = $('#v3d');
  const r = c.parentElement.getBoundingClientRect();
  V.W = r.width; V.H = r.height;
  V.renderer.setSize(r.width, r.height, false);
  V.camara.aspect = r.width / Math.max(1, r.height); V.camara.updateProjectionMatrix();
  const pr = V.renderer.getPixelRatio();
  V.lineas.forEach((ln) => ln.mat.resolution.set(r.width * pr, r.height * pr));
  V.necesita = V.camMovida = true;
}
// setSize borra el lienzo: se pinta ya, antes de que el navegador muestre el cuadro (como mapa.tam en 2D)
function alCambiarTamano() {
  if (!abierta || !V) return;
  redimensionar();
  V.renderer.render(V.escena, V.camara);
}
window.addEventListener('resize', alCambiarTamano);
new ResizeObserver(alCambiarTamano).observe(document.getElementById('mapa-caja'));

function nombres() {
  const capaN = $('#v3d-nombres');
  capaN.hidden = !opc.nombres;
  if (!opc.nombres) return;
  const T3 = V.T3, v = new T3.Vector3();
  const dist = V.camara.position.distanceTo(V.controles.target);
  const tanquesCerca = dist < 320;
  const ocupado = [];
  V.nombres.forEach((k) => {
    const M = S.M;
    const t = V.tanques.find((x) => x.i === k.i);
    const e = V.embalses.find((x) => x.i === k.i);
    const p = t ? [t.x, t.base + t.h + 1.2, t.z] : e ? [e.x, e.y + 3, e.z] : [V.sx(M.nudos.x[k.i]), V.sy(M.nudos.cota[k.i]) + 2, V.sz(M.nudos.y[k.i])];
    const [x, y, z] = proyectar(p[0], p[1], p[2], v);
    const fuera = z > 1 || x < -40 || x > V.W + 40 || y < -20 || y > V.H + 20;
    // de lejos solo los embalses; los tanques cuando la cámara se acerca, sin encimarse
    const choca = ocupado.some(([a, b]) => Math.abs(a - x) < 70 && Math.abs(b - y) < 14);
    if (fuera || (!e && !tanquesCerca) || choca) { k.d.style.display = 'none'; return; }
    ocupado.push([x, y]);
    k.d.style.display = '';
    k.d.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  });
}
function bucle(ahora) {
  V.bucle = requestAnimationFrame(bucle);
  cuadro(ahora);
}
function cuadro(ahora) {
  const dt = Math.min(0.1, Math.max(0, (ahora - V.ultimo) / 1000)); V.ultimo = ahora;
  if (!abierta) return;
  if (!S.M) { cerrar3d(); return; }
  if (S.M !== V.M) { construir(); pintarControles(); escribirLeyenda(); }
  // la hora de la barra de tiempo, que ya avanza continua (S.t): los valores se mezclan entre las dos horas vecinas
  const meta = S.t ?? S.hora ?? 0;
  if (V.tVis !== meta) { V.tVis = meta; V.sucioTiempo = true; }
  if (V.vuelo) {
    const vu = V.vuelo;
    vu.t = Math.min(1, vu.t + dt / 1.3);
    const e = vu.t < 0.5 ? 2 * vu.t * vu.t : 1 - (-2 * vu.t + 2) ** 2 / 2;
    V.controles.target.lerpVectors(vu.o0, vu.o1, e); V.camara.position.lerpVectors(vu.p0, vu.p1, e);
    if (vu.t >= 1) V.vuelo = null;
    V.camMovida = V.necesita = true;
  }
  V.controles.update();
  if (V.camMovida) {
    V.camara.updateMatrixWorld();
    const dist = V.camara.position.distanceTo(V.controles.target);
    if (Math.abs(dist - V.distPrev) > V.distPrev * 0.01) {
      const k = Math.min(2.3, Math.max(0.8, 560 / dist));
      V.lineas.forEach((ln) => { ln.mat.linewidth = ln.ancho * k; });
      V.distPrev = dist;
    }
    const ag = document.querySelector('#v3d-norte g');
    if (ag) ag.setAttribute('transform', `rotate(${((-V.controles.getAzimuthalAngle() * 180) / Math.PI).toFixed(1)})`);
    V.etiSucias = true; V.camMovida = false;
  }
  // reproduciendo, los colores se recalculan unas 20 veces por segundo (como el visor); las partículas, en cada cuadro
  if (V.sucio || (V.sucioTiempo && ahora - (V.ultimoPintado || 0) > 48)) {
    muestrear(); pintar(); colocarSeleccion();
    V.sucio = V.sucioTiempo = false; V.ultimoPintado = ahora; V.necesita = true;
  }
  if (V.selId !== S.selId) { V.selId = S.selId; colocarSeleccion(); V.necesita = true; }
  // partículas: avanzan su velocidad × 260 (como el visor), a unos 30 cuadros por segundo con la red quieta
  V.cuadro = (V.cuadro || 0) + 1;
  if (V.particulas.visible && (V.necesita || (V.cuadro & 1) === 0)) {
    const K = 260, paso = V.necesita ? dt : dt * 2;
    for (let i = 0; i < V.NP; i++) {
      const l = V.pLink[i], v = V.valL[l];
      if (Number.isNaN(v) || Math.abs(v) < 0.03) { V.partAlfa[i] = 0; continue; }
      let s = V.pS[i] + v * paso * K; const tot = V.largo[l];
      if (s > tot) s -= tot; else if (s < 0) s += tot;
      V.pS[i] = s; V.partAlfa[i] = Math.min(1, 0.35 + Math.abs(v) * 0.5);
      posicion(l, s, V.partPos, i * 3);
    }
    V.partGeo.attributes.position.needsUpdate = true; V.partGeo.attributes.alfa.needsUpdate = true;
    V.necesita = true;
  }
  if (V.ptr?.pend) {
    V.ptr.pend = false;
    if (!V.arrastre) mostrarTip(objetoEn(V.ptr.x, V.ptr.y), V.ptr.x, V.ptr.y);
    colocarGuias();
  } else if ((V.goma.visible && !mapa.primerPunto && !V.arrastre) || (S.moverPreciso && !V.goma.visible)) colocarGuias();
  if (V.etiSucias) { nombres(); V.etiSucias = false; }
  if (V.necesita) { V.renderer.render(V.escena, V.camara); V.necesita = false; }
}
