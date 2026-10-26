// Mapa de la red en un canvas 2D: dibujo por lotes de color, índice espacial para elegir elementos,
// colores por tipo / horizonte / estado / resultados / diferencias, y las herramientas de edición.
import { nombreCalidad, S, bus, esc, n, U, claseTexto, nombreNudo, nombreTramo } from './estado.js';

const COL = {
  fondo: '#0c0a0a', tubo: ['#4a4444', '#6d6565', '#9a9090', '#d2c9c9'], cerrado: '#3a3333', bomba: '#f5a524', valvula: '#4cc2ff',
  cv: '#c9a227', sel: '#ffffff', resalte: '#ffe066', nudo: '#958a8a', tanque: '#f3eeee', embalse: '#46c37b',
  h: ['#f5a524', '#3aa0ff', '#c46cff', '#ff7a59', '#2ec4b6', '#e5d14a'], hotro: '#46c37b', tenue: '#2e2828',
  p: ['#e5484d', '#f5a524', '#46c37b', '#3aa0ff', '#9b6cff'], v: ['#6d6565', '#46c37b', '#f5a524', '#e5484d'],
  nuevo: '#46c37b', quitado: '#e5484d', cambio: '#f5a524', geo: '#3aa0ff', nan: '#4a4343',
};
// clases de color del mapa: cortes de Ajustes o según las unidades del modelo (los manda el servidor)
function muestra(paleta, total) { return Array.from({ length: total }, (_, j) => paleta[total === 1 ? 0 : Math.round((j * (paleta.length - 1)) / (total - 1))]); }
function nombresRangos(c, u) {
  const d = c.some((x) => !Number.isInteger(x)) ? 1 : 0;
  return [`< ${n(c[0], d)} ${u}`, ...c.slice(1).map((x, j) => `${n(c[j], d)} – ${n(x, d)} ${u}`), `> ${n(c[c.length - 1], d)} ${u}`];
}
export function clases() {
  const cp = S.M?.clases?.presion?.length ? S.M.clases.presion : [15, 30, 50, 80];
  const cv = S.M?.clases?.velocidad?.length ? S.M.clases.velocidad : [0.3, 1, 2];
  const np = nombresRangos(cp, U('presion'));
  const etq = ['muy baja', 'baja', 'normal', 'alta', 'muy alta'];
  return {
    presion: { cortes: cp, colores: muestra(COL.p, cp.length + 1), nombres: np.map((t, j) => (np.length === 5 ? `${t} (${etq[j]})` : t)) },
    velocidad: { cortes: cv, colores: muestra(COL.v, cv.length + 1), nombres: nombresRangos(cv, U('velocidad')) },
  };
}
function claseDe(v, c) { const j = c.cortes.findIndex((x) => v < x); return c.colores[j === -1 ? c.colores.length - 1 : j]; }
function cortesDiametro() { return S.M?.sistema?.us ? [12, 24, 40] : [300, 600, 1000]; }
function colorHorizonte(anio) { const j = (S.M?.horizontes || []).indexOf(anio); return j < 0 ? null : COL.h[j % COL.h.length]; }
const RAMPA = ['#1d3b58', '#21608d', '#2a8fc4', '#4cc2ff', '#9be2ff'];

export const mapa = {
  cv: null, ctx: null, W: 0, H: 0, dpr: 1, s: 1, cx: 0, cy: 0, pendiente: false,
  P: null, po: null, bb: null, gridN: null, gridS: null, G: 120, estilos: null, estN: null,
  arrastre: null, hover: null, primerPunto: null, raton: null, fantasmas: null,
  onClick: null, onMover: null,

  iniciar(cv) {
    this.cv = cv; this.ctx = cv.getContext('2d');
    new ResizeObserver(() => this.tam()).observe(cv);
    this.tam();
    cv.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.offsetX, e.offsetY); }, { passive: false });
    cv.addEventListener('mousedown', (e) => this.abajo(e));
    window.addEventListener('mousemove', (e) => this.mueve(e));
    window.addEventListener('mouseup', (e) => this.arriba(e));
    cv.addEventListener('dblclick', (e) => { if (!S.herramienta || S.herramienta === 'seleccionar') this.zoom(2, e.offsetX, e.offsetY); });
    cv.addEventListener('mouseleave', () => { this.hover = null; document.getElementById('tip').hidden = true; this.pedir(); });
  },
  tam() {
    const r = this.cv.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.W = r.width; this.H = r.height;
    this.cv.width = Math.round(r.width * this.dpr); this.cv.height = Math.round(r.height * this.dpr);
    if (this.encuadrarAlCrecer && this.W > 80 && this.H > 80) { this.encuadrarAlCrecer = false; this.encuadrar(); }
    // cambiar el tamaño del canvas lo borra: se dibuja ya (el ResizeObserver corre antes de pintar) y no en el cuadro
    // siguiente; si no, mientras se anima el ancho del panel (Scripts, plegar) el mapa se pintaba negro cada cuadro
    this.dibujar();
  },
  pedir() { if (!this.pendiente) { this.pendiente = true; requestAnimationFrame(() => { this.pendiente = false; this.dibujar(); }); } },

  // ------------------------------------------------------------ carga y geometría
  cargar(M, mantener) {
    const N = M.nudos, L = M.tramos, nL = L.id.length;
    let tot = 0;
    for (let k = 0; k < nL; k++) tot += 2 + (L.vi[k + 1] - L.vi[k]);
    this.P = new Float64Array(tot * 2); this.po = new Uint32Array(nL + 1); this.bb = new Float64Array(nL * 4);
    let o = 0;
    for (let k = 0; k < nL; k++) {
      this.po[k] = o / 2;
      const a = L.n1[k], b = L.n2[k];
      const pts = [];
      if (N.x[a] !== null) pts.push(N.x[a], N.y[a]);
      for (let j = L.vi[k]; j < L.vi[k + 1]; j++) pts.push(L.vx[2 * j], L.vx[2 * j + 1]);
      if (N.x[b] !== null) pts.push(N.x[b], N.y[b]);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let j = 0; j < pts.length; j += 2) { this.P[o++] = pts[j]; this.P[o++] = pts[j + 1]; x0 = Math.min(x0, pts[j]); x1 = Math.max(x1, pts[j]); y0 = Math.min(y0, pts[j + 1]); y1 = Math.max(y1, pts[j + 1]); }
      this.bb.set([x0, y0, x1, y1], k * 4);
    }
    this.po[nL] = o / 2;
    this.P = this.P.subarray(0, o);
    // índice espacial
    const G = this.G; this.gridN = new Map(); this.gridS = new Map();
    const key = (x, y) => `${Math.floor(x / G)},${Math.floor(y / G)}`;
    for (let i = 0; i < N.id.length; i++) if (N.x[i] !== null) { const kk = key(N.x[i], N.y[i]); (this.gridN.get(kk) || this.gridN.set(kk, []).get(kk)).push(i); }
    for (let k = 0; k < nL; k++) {
      for (let j = this.po[k]; j < this.po[k + 1] - 1; j++) {
        const ax = this.P[2 * j], ay = this.P[2 * j + 1], bx = this.P[2 * j + 2], by = this.P[2 * j + 3];
        for (let gx = Math.floor(Math.min(ax, bx) / G); gx <= Math.floor(Math.max(ax, bx) / G); gx++) {
          for (let gy = Math.floor(Math.min(ay, by) / G); gy <= Math.floor(Math.max(ay, by) / G); gy++) {
            const kk = `${gx},${gy}`; (this.gridS.get(kk) || this.gridS.set(kk, []).get(kk)).push(k, j);
          }
        }
      }
    }
    this.limites = (() => { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (let i = 0; i < N.id.length; i++) if (N.x[i] !== null) { x0 = Math.min(x0, N.x[i]); x1 = Math.max(x1, N.x[i]); y0 = Math.min(y0, N.y[i]); y1 = Math.max(y1, N.y[i]); } return [x0, y0, x1, y1]; })();
    // un modelo vacío (recién creado) arranca mostrando un kilómetro alrededor del origen
    if (!mantener) this.encuadrar(isFinite(this.limites[0]) ? this.limites : [-500, -350, 500, 350]);
    this.estilar();
  },
  encuadrar(b = this.limites, margen = 40) {
    if (!b || !isFinite(b[0])) return;
    // con el mapa aún sin tamaño (pestaña oculta al cargar) la escala saldría negativa: se encuadra cuando crezca
    if (this.W <= 2 * margen || this.H <= 2 * margen) { this.encuadrarAlCrecer = true; return; }
    const [x0, y0, x1, y1] = b;
    const w = Math.max(x1 - x0, 50), hh = Math.max(y1 - y0, 50);
    this.s = Math.min((this.W - 2 * margen) / w, (this.H - 2 * margen) / hh);
    this.cx = (x0 + x1) / 2; this.cy = (y0 + y1) / 2;
    this.pedir();
  },
  irA(clase, i, s) {
    const M = S.M;
    let x, y;
    if (clase === 'nudo') { x = M.nudos.x[i]; y = M.nudos.y[i]; } else { const b = this.bb.subarray(i * 4, i * 4 + 4); x = (b[0] + b[2]) / 2; y = (b[1] + b[3]) / 2; }
    if (x === null || x === undefined) return;
    this.cx = x; this.cy = y; this.s = Math.max(this.s, s || 0.6);
    this.pedir();
  },
  ajustarA(conj) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const N = S.M.nudos;
    conj.nudos.forEach((i) => { if (N.x[i] !== null) { x0 = Math.min(x0, N.x[i]); x1 = Math.max(x1, N.x[i]); y0 = Math.min(y0, N.y[i]); y1 = Math.max(y1, N.y[i]); } });
    conj.tramos.forEach((k) => { const b = this.bb.subarray(k * 4, k * 4 + 4); x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); });
    if (!isFinite(x0)) return;
    const pad = Math.max(60, (x1 - x0 + y1 - y0) * 0.15);
    this.encuadrar([x0 - pad, y0 - pad, x1 + pad, y1 + pad]);
  },
  zoom(f, px, py) {
    const [wx, wy] = this.mundo(px, py);
    this.s = Math.min(Math.max(this.s * f, 0.002), 80);
    this.cx = wx - (px - this.W / 2) / this.s; this.cy = wy + (py - this.H / 2) / this.s;
    this.pedir();
  },
  ponerFondo(f) {
    if (!f) { this.fondo = null; this.pedir(); return; }
    const img = new Image();
    img.onload = () => this.pedir();
    img.src = `/api/imagen?ruta=${encodeURIComponent(f.ruta)}`;
    this.fondo = { ...f, img };
  },
  pant(x, y) { return [(x - this.cx) * this.s + this.W / 2, (this.cy - y) * this.s + this.H / 2]; },
  mundo(px, py) { return [(px - this.W / 2) / this.s + this.cx, this.cy - (py - this.H / 2) / this.s]; },

  // ------------------------------------------------------------ estilos por modo
  // el valor a la hora de la barra (S.t, fraccionaria): la mezcla de las dos horas de resultados vecinas, como el
  // visor web; el estado abierto/cerrado no se mezcla
  muestra(a, cnt, j, mezclar = true) {
    const T = S.T, t = Math.max(0, Math.min(T - 1, S.t ?? S.hora));
    const t0 = Math.floor(t), t1 = Math.min(t0 + 1, T - 1), f = t - t0;
    if (!mezclar) return a[Math.round(t) * cnt + j];
    const x0 = a[t0 * cnt + j];
    return f < 1e-6 || t1 === t0 ? x0 : x0 + (a[t1 * cnt + j] - x0) * f;
  },
  valorTramo(k) {
    const v = S.variable, a = S.res[v];
    if (!a || !S.T) return NaN;
    const nL = S.M.tramos.id.length;
    if (S.envolvente && v === 'velocidad') { let m = 0; for (let t = 0; t < S.T; t++) m = Math.max(m, Math.abs(a[t * nL + k])); return m; }
    return this.muestra(a, nL, k, v !== 'estado');
  },
  valorCalidadTramo(k) {
    const a = S.res.calidad_t;
    if (!a || !S.T) return NaN;
    return this.muestra(a, S.M.tramos.id.length, k);
  },
  valorNudo(i) {
    const v = S.variable, a = S.res[v];
    if (!a || !S.T) return NaN;
    const nN = S.M.nudos.id.length;
    if (S.envolvente && v === 'presion') { let m = Infinity; for (let t = 0; t < S.T; t++) m = Math.min(m, a[t * nN + i]); return m; }
    return this.muestra(a, nN, i);
  },
  estilar() {
    const M = S.M; if (!M) return;
    const L = M.tramos, nL = L.id.length, N = M.nudos;
    const est = new Array(nL), tabla = new Map();
    const clave = (c, w, d) => { const kk = `${c}|${w}|${d ? 1 : 0}`; if (!tabla.has(kk)) tabla.set(kk, { c, w, d, ks: [] }); return tabla.get(kk); };
    const [d1, d2, d3] = cortesDiametro();
    const ancho = (k) => { const d = L.diam[k] || 0; return d >= d3 ? 2.6 : d >= d2 ? 1.9 : d >= d1 ? 1.3 : 0.8; };
    const CL = clases();
    const cerrado = (k) => L.estado[k] === 'CLOSED';
    const modo = S.modo;
    let rango = null;
    if (modo === 'resultado' && ['carga', 'demanda', 'caudal', 'calidad'].includes(S.variable)) {
      const nodal = S.variable !== 'caudal';
      const cnt = nodal ? N.id.length : nL; let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < cnt; i++) { const x = nodal ? this.valorNudo(i) : Math.abs(this.valorTramo(i)); if (isFinite(x)) { lo = Math.min(lo, x); hi = Math.max(hi, x); } }
      rango = [lo, hi];
    }
    this.rango = rango;
    const cmp = S.comparacion;
    const setCmp = cmp ? {
      nuevo: new Set((cmp.referencia === 'otro' ? cmp.tramos_nuevos : cmp.tramos_quitados) || []),
      estado: new Set((cmp.tramos_estado || []).map((x) => x.id)),
      geo: new Set([...(cmp.tramos_geometria || []).map((x) => x.id), ...(cmp.tramos_consigna || []).map((x) => x.id)]),
    } : null;
    for (let k = 0; k < nL; k++) {
      const t = L.tipo[k];
      let c, w = ancho(k), d = false;
      if (modo === 'horizonte') {
        const tg = L.tag[k];
        c = colorHorizonte(L.horizonte?.[k]) || (tg && !/^[\d.]+$/.test(tg) ? COL.hotro : COL.tenue);
        if (c === COL.tenue) w = Math.min(w, 1); else w = Math.max(w, 1.6);
        d = cerrado(k);
      } else if (modo === 'estado') {
        c = cerrado(k) ? COL.p[0] : t === 'CV' ? COL.cv : t === 'PUMP' ? COL.bomba : t !== 'PIPE' ? COL.valvula : COL.tubo[1];
        d = cerrado(k);
      } else if (modo === 'resultado') {
        if (S.variable === 'velocidad') {
          const v = Math.abs(this.valorTramo(k));
          c = !isFinite(v) ? COL.nan : claseDe(v, CL.velocidad);
        } else if (S.variable === 'caudal') {
          const v = Math.abs(this.valorTramo(k));
          if (!isFinite(v)) c = COL.nan; else { const f = rango && rango[1] > rango[0] ? Math.sqrt((v - rango[0]) / (rango[1] - rango[0])) : 0; c = RAMPA[Math.min(4, Math.floor(f * 5))]; w = 0.7 + f * 3.2; }
        } else if (S.variable === 'estado') {
          const v = this.valorTramo(k); c = !isFinite(v) ? COL.nan : v > 0 ? COL.tubo[1] : COL.p[0]; d = v <= 0;
        } else if (S.variable === 'calidad') {
          const v = this.valorCalidadTramo(k);
          if (!isFinite(v)) c = COL.nan; else { const f = rango && rango[1] > rango[0] ? (v - rango[0]) / (rango[1] - rango[0]) : 0; c = RAMPA[Math.max(0, Math.min(4, Math.floor(f * 5)))]; w = Math.max(w, 1.4); }
        } else { c = '#3a3434'; w = Math.min(w, 1.2); }
      } else if (modo === 'diferencias' && setCmp) {
        const id = L.id[k];
        c = setCmp.nuevo.has(id) ? COL.nuevo : setCmp.estado.has(id) ? COL.cambio : setCmp.geo.has(id) ? COL.geo : COL.tenue;
        if (c !== COL.tenue) w = Math.max(w, 2.2);
      } else {
        c = t === 'PUMP' ? COL.bomba : t !== 'PIPE' && t !== 'CV' ? COL.valvula : COL.tubo[w >= 2.6 ? 3 : w >= 1.9 ? 2 : w >= 1.3 ? 1 : 0];
        if (cerrado(k)) { c = COL.cerrado; d = true; }
      }
      est[k] = clave(c, w, d);
    }
    for (let k = 0; k < nL; k++) est[k].ks.push(k);
    this.estilos = Array.from(tabla.values());
    // nudos coloreados solo con resultados nodales
    this.estN = null;
    if (modo === 'resultado' && ['presion', 'carga', 'demanda', 'calidad'].includes(S.variable)) {
      const nN = N.id.length, cols = new Array(nN), CLp = clases().presion;
      for (let i = 0; i < nN; i++) {
        const v = this.valorNudo(i);
        if (!isFinite(v)) { cols[i] = null; continue; }
        if (S.variable === 'presion') { cols[i] = claseDe(v, CLp); } else {
          const f = rango && rango[1] > rango[0] ? (v - rango[0]) / (rango[1] - rango[0]) : 0; cols[i] = RAMPA[Math.min(4, Math.floor(f * 5))];
        }
      }
      this.estN = cols;
    }
    this.fantasmas = modo === 'diferencias' && cmp ? cmp.fantasmas : null;
    this.pedir();
  },

  // ------------------------------------------------------------ dibujo
  dibujar() {
    const ctx = this.ctx, M = S.M;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = COL.fondo; ctx.fillRect(0, 0, this.W, this.H);
    if (!M || !this.P) return;
    const F = this.fondo;
    if (F?.img?.complete && F.img.naturalWidth) {
      const [ax, ay] = this.pant(F.x0, F.y1), [bx, by] = this.pant(F.x1, F.y0);
      ctx.globalAlpha = F.opacidad ?? 0.5; ctx.drawImage(F.img, ax, ay, bx - ax, by - ay); ctx.globalAlpha = 1;
    }
    const [vx0, vy1] = this.mundo(0, 0), [vx1, vy0] = this.mundo(this.W, this.H);
    const P = this.P, po = this.po, bb = this.bb, s = this.s;
    const zf = Math.max(0.75, Math.min(2.2, Math.pow(s / 0.03, 0.18)));
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const trazar = (k) => {
      const a = po[k], b = po[k + 1];
      if (b - a < 2) return;
      let [x, y] = this.pant(P[2 * a], P[2 * a + 1]);
      ctx.moveTo(x, y);
      for (let j = a + 1; j < b; j++) { [x, y] = this.pant(P[2 * j], P[2 * j + 1]); ctx.lineTo(x, y); }
    };
    const visible = (k) => !(bb[4 * k + 2] < vx0 || bb[4 * k] > vx1 || bb[4 * k + 3] < vy0 || bb[4 * k + 1] > vy1);
    // fantasmas de la comparación (lo que no está en este modelo)
    if (this.fantasmas) {
      ctx.strokeStyle = COL.quitado; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.beginPath();
      for (const [, pts] of this.fantasmas.tramos) { pts.forEach(([x, y], j) => { const [a, b] = this.pant(x, y); j ? ctx.lineTo(a, b) : ctx.moveTo(a, b); }); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    for (const e of this.estilos || []) {
      ctx.strokeStyle = e.c; ctx.lineWidth = e.w * zf;
      ctx.setLineDash(e.d ? [4, 4] : []);
      ctx.beginPath();
      for (const k of e.ks) if (visible(k)) trazar(k);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // resaltados y selección
    const R = S.resaltar;
    if (R && R.tramos.size) { ctx.strokeStyle = COL.resalte; ctx.lineWidth = 4 * zf; ctx.globalAlpha = 0.85; ctx.beginPath(); R.tramos.forEach((k) => trazar(k)); ctx.stroke(); ctx.globalAlpha = 1; }
    if (S.sel && S.sel.clase === 'tramo') { ctx.strokeStyle = COL.sel; ctx.lineWidth = 5 * zf; ctx.beginPath(); trazar(S.sel.i); ctx.stroke(); }
    const L = M.tramos, N = M.nudos;
    if (S.corrida && S.T && S.res.caudal && document.getElementById('ver-flechas')?.checked) this.flechas(L, visible, zf);
    // símbolos de bombas y válvulas
    if (s > 0.02) {
      for (let k = 0; k < L.id.length; k++) {
        const t = L.tipo[k];
        if (t === 'PIPE' || t === 'CV' || !visible(k)) continue;
        if (t !== 'PUMP' && s < 0.06) continue;
        const a = po[k], b = po[k + 1];
        const mx = (P[2 * a] + P[2 * (b - 1)]) / 2, my = (P[2 * a + 1] + P[2 * (b - 1) + 1]) / 2;
        const [x, y] = this.pant(mx, my);
        const r = t === 'PUMP' ? 5.5 : 4.5;
        ctx.fillStyle = COL.fondo; ctx.strokeStyle = L.estado[k] === 'CLOSED' ? COL.cerrado : t === 'PUMP' ? COL.bomba : COL.valvula; ctx.lineWidth = 1.6;
        ctx.beginPath();
        if (t === 'PUMP') { ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x - 2, y - 3); ctx.lineTo(x + 3, y); ctx.lineTo(x - 2, y + 3); ctx.closePath(); ctx.fillStyle = ctx.strokeStyle; ctx.fill(); } else { ctx.moveTo(x - r, y - r * 0.7); ctx.lineTo(x + r, y + r * 0.7); ctx.lineTo(x + r, y - r * 0.7); ctx.lineTo(x - r, y + r * 0.7); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      }
    }
    // nudos
    const verNudos = s > 0.25 || this.estN;
    const rN = this.estN ? Math.max(1.6, Math.min(4, s * 4)) : Math.max(1.2, Math.min(3.5, s * 3));
    for (let i = 0; i < N.id.length; i++) {
      const x0 = N.x[i]; if (x0 === null || x0 < vx0 || x0 > vx1 || N.y[i] < vy0 || N.y[i] > vy1) continue;
      const t = N.tipo[i];
      const [x, y] = this.pant(x0, N.y[i]);
      // en un tanque la "presión" es el nivel: no va con las clases de presión
      if (t === 2) { ctx.fillStyle = COL.tanque; ctx.strokeStyle = COL.fondo; ctx.lineWidth = 1.5; ctx.fillRect(x - 5, y - 5, 10, 10); ctx.strokeRect(x - 5, y - 5, 10, 10); continue; }
      if (t === 1) { ctx.fillStyle = COL.embalse; ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + 7, y + 5); ctx.lineTo(x - 7, y + 5); ctx.closePath(); ctx.fill(); continue; }
      if (!verNudos) continue;
      const c = this.estN ? this.estN[i] : COL.nudo;
      if (!c) continue;
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, rN, 0, 7); ctx.fill();
    }
    if (R && R.nudos.size) {
      ctx.strokeStyle = COL.resalte; ctx.lineWidth = 2;
      R.nudos.forEach((i) => { if (N.x[i] === null) return; const [x, y] = this.pant(N.x[i], N.y[i]); ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.stroke(); });
    }
    if (S.sel && S.sel.clase === 'nudo' && N.x[S.sel.i] !== null) {
      const [x, y] = this.pant(N.x[S.sel.i], N.y[S.sel.i]);
      ctx.strokeStyle = COL.sel; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.stroke();
    }
    // rótulos
    if (document.getElementById('ver-rotulos')?.checked) {
      ctx.font = '600 11px Geist, "Segoe UI", sans-serif'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(184,173,173,.55)'; ctx.textAlign = 'center';
      // de lejos solo los rótulos cortos (municipios); los largos (puntos de control) al acercarse
      for (const [x0, y0, t] of M.rotulos || []) {
        if (x0 < vx0 || x0 > vx1 || y0 < vy0 || y0 > vy1) continue;
        if (s < 0.06 && t.length > 14) continue;
        const [x, y] = this.pant(x0, y0); ctx.fillText(t, x, y);
      }
      if (s > 0.06) {
        ctx.textAlign = 'left'; ctx.font = '11px Geist, "Segoe UI", sans-serif'; ctx.fillStyle = '#cfc6c6';
        for (let i = 0; i < N.id.length; i++) {
          if (N.tipo[i] === 0 && s < 1.2) continue;
          const x0 = N.x[i]; if (x0 === null || x0 < vx0 || x0 > vx1 || N.y[i] < vy0 || N.y[i] > vy1) continue;
          const [x, y] = this.pant(x0, N.y[i]);
          ctx.fillStyle = N.tipo[i] === 0 ? '#958a8a' : '#cfc6c6';
          ctx.fillText(N.tipo[i] === 0 ? N.id[i] : (N.com[i] || N.id[i]), x + 8, y);
        }
      }
    }
    // línea elástica de la herramienta tubería
    if (this.primerPunto && this.raton) {
      const [x, y] = this.pant(this.primerPunto.x, this.primerPunto.y);
      ctx.strokeStyle = COL.sel; ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(this.raton[0], this.raton[1]); ctx.stroke(); ctx.setLineDash([]);
    }
    if (this.arrastre?.area && this.arrastre.movido && this.raton) {
      const [ax, ay] = this.arrastre.area, [bx, by] = this.raton;
      ctx.fillStyle = 'rgba(214,42,41,.08)'; ctx.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
      ctx.strokeStyle = COL.sel; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2; ctx.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay)); ctx.setLineDash([]);
    }
    const mp = S.moverPreciso;
    if (mp) {
      const [ax, ay] = this.pant(mp.desde.x, mp.desde.y), [bx, by] = this.pant(mp.x, mp.y), [ox, oy] = this.pant(mp.ox, mp.oy);
      ctx.strokeStyle = COL.sel; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(bx, by, 7, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ox - 6, oy); ctx.lineTo(ox + 6, oy); ctx.moveTo(ox, oy - 6); ctx.lineTo(ox, oy + 6); ctx.stroke();
    }
    if (this.arrastre?.nudo !== undefined && this.arrastre.movido) {
      const [x, y] = this.raton; ctx.fillStyle = COL.sel; ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill();
    }
    document.getElementById('estado-mapa').textContent = `escala 1:${n((M.sistema?.a_metros || 1) / (this.s * 0.00026), 0)}`;
  },

  // sentido del agua a la hora de la barra: una flecha en la mitad de cada tubería que en pantalla mide lo bastante
  // para que no se amontonen. El caudal positivo va del nudo inicial al final, que es el orden en que se dibuja el
  // tramo. Bombas y válvulas no llevan flecha: en su mitad está su símbolo.
  flechas(L, visible, zf) {
    const ctx = this.ctx, P = this.P, po = this.po, Q = S.res.caudal, nL = L.id.length;
    const tam = 4 * zf, ancho = 0.72, minimo = 36;
    const pts = [];
    ctx.beginPath();
    for (let k = 0; k < nL; k++) {
      if ((L.tipo[k] !== 'PIPE' && L.tipo[k] !== 'CV') || !visible(k)) continue;
      const a = po[k], b = po[k + 1];
      if (b - a < 2) continue;
      const q = this.muestra(Q, nL, k);
      if (!isFinite(q) || Math.abs(q) < 0.01) continue;
      pts.length = 0;
      let largo = 0;
      for (let j = a; j < b; j++) {
        const [x, y] = this.pant(P[2 * j], P[2 * j + 1]);
        if (pts.length) largo += Math.hypot(x - pts[pts.length - 2], y - pts[pts.length - 1]);
        pts.push(x, y);
      }
      if (largo < minimo) continue;
      let resto = largo / 2, j = 0, d = 0;
      for (; j < pts.length - 2; j += 2) { d = Math.hypot(pts[j + 2] - pts[j], pts[j + 3] - pts[j + 1]); if (resto <= d) break; resto -= d; }
      if (!d) continue;
      const ux = (pts[j + 2] - pts[j]) / d * Math.sign(q), uy = (pts[j + 3] - pts[j + 1]) / d * Math.sign(q);
      const mx = pts[j] + (pts[j + 2] - pts[j]) * resto / d, my = pts[j + 1] + (pts[j + 3] - pts[j + 1]) * resto / d;
      ctx.moveTo(mx + ux * tam, my + uy * tam);
      ctx.lineTo(mx - ux * tam - uy * tam * ancho, my - uy * tam + ux * tam * ancho);
      ctx.lineTo(mx - ux * tam * 0.45, my - uy * tam * 0.45);
      ctx.lineTo(mx - ux * tam + uy * tam * ancho, my - uy * tam - ux * tam * ancho);
      ctx.closePath();
    }
    ctx.lineWidth = 2.2; ctx.strokeStyle = 'rgba(12,10,10,.9)'; ctx.stroke();
    ctx.fillStyle = 'rgba(243,238,238,.92)'; ctx.fill();
  },

  // ------------------------------------------------------------ elegir elementos
  elegir(px, py) {
    if (!S.M) return null;
    const [wx, wy] = this.mundo(px, py);
    const G = this.G, N = S.M.nudos;
    const rN = 9 / this.s, rL = 6 / this.s;
    const gx = Math.floor(wx / G), gy = Math.floor(wy / G);
    const rad = Math.max(1, Math.ceil(Math.max(rN, rL) / G));
    let mejorN = null, dN = Infinity, mejorL = null, dL = Infinity;
    for (let i = -rad; i <= rad; i++) for (let j = -rad; j <= rad; j++) {
      for (const k of this.gridN.get(`${gx + i},${gy + j}`) || []) { const d = Math.hypot(N.x[k] - wx, N.y[k] - wy); if (d < dN) { dN = d; mejorN = k; } }
      const segs = this.gridS.get(`${gx + i},${gy + j}`) || [];
      for (let q = 0; q < segs.length; q += 2) {
        const k = segs[q], s0 = segs[q + 1];
        const ax = this.P[2 * s0], ay = this.P[2 * s0 + 1], bx = this.P[2 * s0 + 2], by = this.P[2 * s0 + 3];
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
        const u = L2 ? Math.max(0, Math.min(1, ((wx - ax) * dx + (wy - ay) * dy) / L2)) : 0;
        const d = Math.hypot(wx - ax - u * dx, wy - ay - u * dy);
        if (d < dL) { dL = d; mejorL = k; }
      }
    }
    if (mejorN !== null && dN <= rN) return { clase: 'nudo', i: mejorN, x: wx, y: wy };
    if (mejorL !== null && dL <= rL) return { clase: 'tramo', i: mejorL, x: wx, y: wy };
    return { clase: null, x: wx, y: wy };
  },

  // ------------------------------------------------------------ ratón
  abajo(e) {
    if (e.button !== 0) return;
    const p = this.elegir(e.offsetX, e.offsetY);
    this.arrastre = { x: e.clientX, y: e.clientY, cx: this.cx, cy: this.cy, movido: false };
    if (S.herramienta === 'mover' && p?.clase === 'nudo') this.arrastre.nudo = p.i;
    else if (S.herramienta === 'area') this.arrastre.area = [e.offsetX, e.offsetY];
    else this.cv.classList.add('arrastrando');
  },
  mueve(e) {
    const r = this.cv.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    this.raton = [px, py];
    if (this.arrastre) {
      const dx = e.clientX - this.arrastre.x, dy = e.clientY - this.arrastre.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) this.arrastre.movido = true;
      if (this.arrastre.nudo === undefined && !this.arrastre.area && this.arrastre.movido) { this.cx = this.arrastre.cx - dx / this.s; this.cy = this.arrastre.cy + dy / this.s; }
      this.pedir();
      return;
    }
    if (e.target !== this.cv) return;
    if (this.primerPunto) this.pedir();
    const p = this.elegir(px, py);
    const tip = document.getElementById('tip');
    if (!p || !p.clase) { tip.hidden = true; if (this.hover) { this.hover = null; } return; }
    this.hover = p;
    tip.innerHTML = this.textoTip(p);
    tip.hidden = false;
    tip.style.left = `${Math.min(px + 14, this.W - 300)}px`; tip.style.top = `${py + 14}px`;
  },
  arriba(e) {
    const a = this.arrastre; this.arrastre = null; this.cv.classList.remove('arrastrando');
    if (!a) return;
    const r = this.cv.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    if (a.area) {
      if (a.movido && this.onArea) {
        const [x0, y0] = this.mundo(Math.min(a.area[0], px), Math.max(a.area[1], py)), [x1, y1] = this.mundo(Math.max(a.area[0], px), Math.min(a.area[1], py));
        const N = S.M.nudos, nudos = [], tramos = [];
        for (let i = 0; i < N.id.length; i++) if (N.x[i] !== null && N.x[i] >= x0 && N.x[i] <= x1 && N.y[i] >= y0 && N.y[i] <= y1) nudos.push(i);
        for (let k = 0; k < S.M.tramos.id.length; k++) { const b = this.bb.subarray(k * 4, k * 4 + 4); if (b[0] >= x0 && b[2] <= x1 && b[1] >= y0 && b[3] <= y1) tramos.push(k); }
        this.onArea({ nudos, tramos });
      }
      this.pedir();
      return;
    }
    if (a.nudo !== undefined) {
      if (a.movido && this.onMover) { const [x, y] = this.mundo(px, py); this.onMover(a.nudo, x, y); }
      this.pedir();
      return;
    }
    if (!a.movido && e.target === this.cv && this.onClick) this.onClick(this.elegir(px, py), e);
  },
  textoTip(p) {
    const M = S.M;
    if (p.clase === 'nudo') {
      const i = p.i, v = this.valorNudo(i);
      const lineas = [`<b>${esc(nombreNudo(i))}</b>`, `<span class="g">${esc(claseTexto('nudo', i))} · cota ${n(M.nudos.cota[i], 1)} ${U('cota')}</span>`];
      if (M.nudos.tipo[i] === 0 && M.nudos.dem[i]) lineas.push(`<span class="g">demanda base ${n(M.nudos.dem[i], 2)} ${U('caudal')}</span>`);
      if (isFinite(v) && S.variable === 'calidad') { const [nq, uq] = nombreCalidad(); lineas.push(`${esc(nq)}: <b>${n(v, 2)}</b> ${esc(uq)}`); }
      if (isFinite(v) && ['presion', 'carga', 'demanda'].includes(S.variable)) lineas.push(`${{ presion: 'Presión', carga: 'Carga', demanda: 'Demanda' }[S.variable]}${S.envolvente ? ' mínima' : ''}: <b>${n(v, 1)}</b> ${U(S.variable === 'demanda' ? 'caudal' : S.variable === 'presion' ? 'presion' : 'carga')}`);
      return lineas.join('<br>');
    }
    const k = p.i, L = M.tramos, v = this.valorTramo(k);
    const lineas = [`<b>${esc(nombreTramo(k))}</b>`, `<span class="g">${esc(claseTexto('tramo', k))}${L.diam[k] ? ` · ${n(L.diam[k], 0)} ${U('diametro')}` : ''}${L.tipo[k] === 'PIPE' || L.tipo[k] === 'CV' ? ` · ${n(L.lon[k], 0)} ${U('longitud')}` : ''}${L.estado[k] === 'CLOSED' ? ' · cerrado al inicio' : ''}</span>`];
    if (L.tag[k]) lineas.push(`<span class="g">etiqueta ${esc(L.tag[k])}</span>`);
    if (S.variable === 'calidad') { const q = this.valorCalidadTramo(k); if (isFinite(q)) { const [nq, uq] = nombreCalidad(); lineas.push(`${esc(nq)}: <b>${n(q, 2)}</b> ${esc(uq)}`); } }
    if (isFinite(v) && ['caudal', 'velocidad'].includes(S.variable)) lineas.push(`${S.variable === 'caudal' ? 'Caudal' : 'Velocidad'}: <b>${n(v, S.variable === 'caudal' ? 1 : 2)}</b> ${U(S.variable === 'caudal' ? 'caudal' : 'velocidad')}`);
    return lineas.join('<br>');
  },
};

export function leyenda() {
  if (document.body.classList.contains('vista-3d')) return;      // en 3D la escribe vista3d.js
  const el = document.getElementById('leyenda');
  const it = (c, t, extra = '') => `<div class="it"><span class="sw ${extra}" style="background:${c}"></span>${esc(t)}</div>`;
  let h = '';
  if (S.modo === 'tipo') {
    const [d1, d2, d3] = cortesDiametro(), ud = U('diametro');
    h = `<div class="t">Red</div>${it(COL.tubo[3], `Tubería ≥ ${d3} ${ud}`)}${it(COL.tubo[2], `${d2} – ${d3} ${ud}`)}${it(COL.tubo[1], `${d1} – ${d2} ${ud}`)}${it(COL.tubo[0], `< ${d1} ${ud}`)}${it(COL.cerrado, 'Cerrada al inicio', 'd')}${it(COL.bomba, 'Bomba', 'p')}${it(COL.valvula, 'Válvula', 'p')}${it(COL.tanque, 'Tanque', 'p')}${it(COL.embalse, 'Embalse o planta', 'p')}`;
  } else if (S.modo === 'horizonte') {
    const hs = S.M?.horizontes || [];
    h = `<div class="t">Proyectos por horizonte</div>${hs.length ? hs.map((a) => it(colorHorizonte(a), `Entra en ${a}`)).join('') : '<div class="it">Ninguna etiqueta tiene año (regla en Ajustes)</div>'}${it(COL.hotro, 'Otro grupo etiquetado')}${it(COL.tenue, 'Red existente')}${it(COL.tenue, 'Línea punteada: cerrada al inicio', 'd')}`;
  } else if (S.modo === 'estado') {
    h = `<div class="t">Estado inicial</div>${it(COL.tubo[1], 'Abierta')}${it(COL.p[0], 'Cerrada', 'd')}${it(COL.cv, 'Antirretorno (CV)')}${it(COL.bomba, 'Bomba')}${it(COL.valvula, 'Válvula')}`;
  } else if (S.modo === 'resultado') {
    const v = S.variable;
    const CL = clases();
    if (v === 'presion') h = `<div class="t">Presión${S.envolvente ? ' mínima del día' : ''}</div>` + CL.presion.nombres.map((t, j) => it(CL.presion.colores[j], t, 'p')).join('');
    else if (v === 'velocidad') h = `<div class="t">Velocidad${S.envolvente ? ' máxima del día' : ''}</div>` + CL.velocidad.nombres.map((t, j) => it(CL.velocidad.colores[j], t)).join('');
    else if (v === 'calidad' && mapa.rango) {
      const [lo, hi] = mapa.rango, [nq, uq] = nombreCalidad();
      h = `<div class="t">${esc(nq)} (${esc(uq)})</div>` + RAMPA.map((c, j) => it(c, `${n(lo + (hi - lo) * j / 5, 2)} – ${n(lo + (hi - lo) * (j + 1) / 5, 2)}`)).join('');
    } else if (mapa.rango) {
      const [lo, hi] = mapa.rango; const u = U(v === 'carga' ? 'carga' : 'caudal');
      h = `<div class="t">${{ caudal: 'Caudal (valor absoluto)', carga: 'Carga hidráulica', demanda: 'Demanda' }[v] || v}</div>` + RAMPA.map((c, j) => it(c, `${n(lo + (hi - lo) * (j / 5) ** (v === 'caudal' ? 2 : 1), 0)} – ${n(lo + (hi - lo) * ((j + 1) / 5) ** (v === 'caudal' ? 2 : 1), 0)} ${u}`)).join('');
    } else if (v === 'estado') h = `<div class="t">Estado a esta hora</div>${it(COL.tubo[1], 'Abierto')}${it(COL.p[0], 'Cerrado', 'd')}`;
  } else if (S.modo === 'diferencias') {
    h = `<div class="t">Diferencias</div>${it(COL.nuevo, 'Solo en el modelo abierto')}${it(COL.quitado, 'Solo en el otro (fantasma)', 'd')}${it(COL.cambio, 'Cambia el estado inicial')}${it(COL.geo, 'Cambia geometría o consigna')}`;
  }
  if (h && S.corrida && S.T && document.getElementById('ver-flechas')?.checked) h += '<div class="it"><span class="sw flecha">➤</span>Sentido del agua a esta hora</div>';
  el.innerHTML = h;
}
