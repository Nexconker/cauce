// Panel Informes: perfil entre dos nudos, frecuencia, flujo del sistema, tablas exportables y energía, sobre la
// corrida activa. También la edición en grupo (desde una tabla filtrada o desde un área del mapa).
import { S, bus, get, post, binario, esc, n, h, hora, aviso, fallo, modal, formulario, explorar, conjunto, esqueleto, $, $$, U, nombreCalidad, claseTexto } from './estado.js';
import { mapa } from './mapa.js';
import { elegirReporte } from './reporte.js';
import { grafica, ajustarCanvas } from './grafica.js';

const P = () => document.getElementById('panel');
let pestana = 'perfil';
const perfil = { desde: '', hasta: '', camino: null };
const tabla = { clase: 'nudos', orden: null, desc: false, filtro: { col: '', op: '<', valor: '' } };
const TABS = [['perfil', 'Perfil'], ['frecuencia', 'Frecuencia'], ['flujo', 'Flujo'], ['tablas', 'Tablas'], ['energia', 'Energía']];
const MAX_FILAS = 1500;
const energia = { orden: 'kwh', desc: true };

async function asegurar(v) {
  if (!S.corrida || S.res[v]) return;
  const b = await binario(`/api/corrida/${S.corrida}/var/${v}`, { doc: S.doc });
  S.res[v] = b.datos;
}
const hayCalidad = () => !!S.resumen?.calidad?.variables?.includes('calidad');
// número para CSV de Excel en español: coma decimal, sin separador de miles
const csvNum = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d).replace(/\.?0+$/, '').replace('.', ',') : '');

export async function pInformes() {
  P().innerHTML = `<div class="i-cab"><h1>Informes</h1><span class="i-botones"><button class="btn chico" id="i-rpt" title="Abrir un reporte .rpt de EPANET en otra ventana: avisos, paso a paso, resultados y texto">Leer un .rpt</button><button class="btn chico" id="i-amplio" aria-pressed="false" title="Usar todo el ancho para leer las tablas (el mapa vuelve al reducir)">Ampliar</button></span></div>
    <p class="sub">Sobre la corrida que estás viendo${S.resumen ? ` (motor ${esc(S.resumen.version)})` : ''}. La hora es la de la barra de tiempo.</p>
    <div class="seg pestanas-d" id="i-tabs">${TABS.map(([k, t]) => `<button data-k="${k}">${t}</button>`).join('')}</div><div id="i-cont" style="margin-top:14px"></div>`;
  $('#i-rpt').onclick = () => elegirReporte(S.doc || '');
  const amp = $('#i-amplio');
  const pintarAmp = () => { const on = document.body.classList.contains('panel-amplio'); amp.setAttribute('aria-pressed', String(on)); amp.textContent = on ? 'Reducir' : 'Ampliar'; };
  amp.onclick = () => { document.body.classList.toggle('panel-amplio'); pintarAmp(); };
  pintarAmp();
  $$('#i-tabs button').forEach((b) => { b.classList.toggle('on', b.dataset.k === pestana); b.onclick = () => { pestana = b.dataset.k; $$('#i-tabs button').forEach((x) => x.classList.toggle('on', x === b)); pintar(); }; });
  pintar();
}
async function pintar() {
  const c = $('#i-cont');
  if (!c) return;
  c.innerHTML = '';
  if (!S.corrida || !S.resumen || !S.T) {
    c.append(h('<div class="tarjeta info"><h3>Primero corre el modelo</h3><p>Los informes salen de los resultados de una corrida.</p><div class="acciones"><button class="btn prim">Ir a Correr</button></div></div>'));
    $('button', c).onclick = () => bus.emit('panel', 'correr');
    return;
  }
  c.innerHTML = esqueleto(4, true);
  try {
    await ({ perfil: tPerfil, frecuencia: tFrecuencia, flujo: tFlujo, tablas: tTablas, energia: tEnergia })[pestana](c);
  } catch (e) { fallo(e); }
}
bus.on('hora', () => { if (document.getElementById('i-cont') && ['perfil', 'frecuencia', 'tablas'].includes(pestana)) pintar(); });

// ====================================================================== perfil
// El perfil piezométrico también se pide desde la ficha de un nudo («Perfil desde aquí» / «hasta aquí»): abre
// Informes › Perfil con los dos nudos puestos y lo traza.
export function abrirPerfil(desde, hasta) {
  Object.assign(perfil, { desde, hasta, camino: null, auto: true, doc: S.doc });
  pestana = 'perfil';
  bus.emit('panel', 'informes');
}
async function tPerfil(c) {
  // el perfil es de un modelo: en otra pestaña los mismos ID son otros nudos
  if (perfil.doc !== S.doc) Object.assign(perfil, { desde: '', hasta: '', camino: null, auto: false, doc: S.doc });
  await asegurar('carga'); await asegurar('presion');
  c.innerHTML = '';
  c.append(h('<p class="sub" style="margin:0 0 10px">El terreno y la línea de carga a lo largo del camino más corto entre dos nudos. La banda punteada es la carga mínima y máxima del día.</p>'));
  const f = h(`<div class="fila"><label>Desde<input id="pf-d" value="${esc(perfil.desde)}" style="width:110px"></label><label>Hasta<input id="pf-h" value="${esc(perfil.hasta)}" style="width:110px"></label>
    <button class="btn chico" id="pf-sel" style="align-self:flex-end" title="Pone el nudo seleccionado en el mapa">Usar el seleccionado</button><button class="btn chico prim" id="pf-ir" style="align-self:flex-end">Trazar</button></div>`);
  c.append(f);
  $('#pf-sel', f).onclick = () => {
    if (S.sel?.clase !== 'nudo') { aviso('Selecciona un nudo en el mapa.', 'error'); return; }
    const id = S.M.nudos.id[S.sel.i];
    if (!$('#pf-d', f).value) $('#pf-d', f).value = id; else $('#pf-h', f).value = id;
  };
  const trazar = async () => {
    perfil.desde = $('#pf-d', f).value.trim(); perfil.hasta = $('#pf-h', f).value.trim();
    if (!perfil.desde || !perfil.hasta) { aviso('Faltan los dos nudos.', 'error'); return; }
    try { perfil.camino = await get(`/api/doc/${S.doc}/camino`, { desde: perfil.desde, hasta: perfil.hasta }); } catch (e) { fallo(e); return; }
    S.resaltar = conjunto([...perfil.camino.nudos.map((id) => ({ clase: 'nudo', id })), ...perfil.camino.tramos.map((id) => ({ clase: 'tramo', id }))]);
    mapa.ajustarA(S.resaltar); mapa.pedir();
    pintar();
  };
  $('#pf-ir', f).onclick = trazar;
  if (perfil.auto) { perfil.auto = false; await trazar(); return; }        // pedido desde la ficha de un nudo
  const k = perfil.camino;
  if (!k) return;
  const nN = S.M.nudos.id.length;
  const idx = k.nudos.map((id) => S.idxN.get(id));
  const carga = idx.map((i) => S.res.carga[S.hora * nN + i]);
  const pres = idx.map((i) => S.res.presion[S.hora * nN + i]);
  const cmin = idx.map((i) => { let m = Infinity; for (let t = 0; t < S.T; t++) m = Math.min(m, S.res.carga[t * nN + i]); return m; });
  const cmax = idx.map((i) => { let m = -Infinity; for (let t = 0; t < S.T; t++) m = Math.max(m, S.res.carga[t * nN + i]); return m; });
  c.append(h(`<p class="sub" style="margin:12px 0 4px">${n(k.nudos.length, 0)} nudos, ${n(k.longitud, 0)} ${esc(U('longitud'))} · presión a las ${hora(S.horas[S.hora])}: mínima ${n(Math.min(...pres.filter(isFinite)), 1)} ${esc(U('presion'))}</p>`));
  const cv = h('<canvas style="width:100%;height:240px;display:block"></canvas>');
  c.append(cv);
  setTimeout(() => dibujoPerfil(cv, { x: k.distancias, cota: k.cotas, carga, cmin, cmax, pres, ids: k.nudos }), 0);
}
function dibujoPerfil(canvas, datos) {
  const { x, cota, carga, cmin, cmax, pres, ids } = datos;
  if (!ajustarCanvas(canvas, () => dibujoPerfil(canvas, datos))) return;
  const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const izq = 46, der = 8, arr = 10, aba = 22;
  const vals = [...cota, ...carga, ...cmin, ...cmax].filter(isFinite);
  let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
  const x1 = Math.max(1, x[x.length - 1]);
  const X = (v) => izq + (W - izq - der) * v / x1, Y = (v) => arr + (H - arr - aba) * (1 - (v - lo) / (hi - lo));
  const dibujar = (cursor) => {
    c.clearRect(0, 0, W, H);
    c.font = '10.5px Geist, "Segoe UI", sans-serif'; c.strokeStyle = '#2a2525'; c.fillStyle = '#958a8a'; c.lineWidth = 1;
    for (let j = 0; j <= 4; j++) { const v = lo + (hi - lo) * j / 4; c.beginPath(); c.moveTo(izq, Y(v)); c.lineTo(W - der, Y(v)); c.stroke(); c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText(n(v, 0), izq - 5, Y(v)); }
    c.textAlign = 'center'; c.textBaseline = 'top';
    for (let j = 0; j <= 4; j++) c.fillText(n(x1 * j / 4, 0), X(x1 * j / 4), H - aba + 5);
    // terreno
    c.fillStyle = 'rgba(149,138,138,.18)'; c.beginPath(); c.moveTo(X(x[0]), Y(lo)); x.forEach((v, j) => c.lineTo(X(v), Y(cota[j]))); c.lineTo(X(x[x.length - 1]), Y(lo)); c.closePath(); c.fill();
    c.strokeStyle = '#958a8a'; c.lineWidth = 1.5; c.beginPath(); x.forEach((v, j) => (j ? c.lineTo(X(v), Y(cota[j])) : c.moveTo(X(v), Y(cota[j])))); c.stroke();
    // banda del día
    c.strokeStyle = 'rgba(255,107,98,.45)'; c.setLineDash([4, 3]); c.lineWidth = 1;
    for (const s of [cmin, cmax]) { c.beginPath(); x.forEach((v, j) => (j ? c.lineTo(X(v), Y(s[j])) : c.moveTo(X(v), Y(s[j])))); c.stroke(); }
    c.setLineDash([]);
    c.strokeStyle = '#ff6b62'; c.lineWidth = 2; c.beginPath(); let emp = false;
    x.forEach((v, j) => { if (!isFinite(carga[j])) { emp = false; return; } if (emp) c.lineTo(X(v), Y(carga[j])); else { c.moveTo(X(v), Y(carga[j])); emp = true; } }); c.stroke();
    c.fillStyle = '#958a8a'; c.textAlign = 'right'; c.textBaseline = 'bottom'; c.fillText(U('longitud'), W - der, H - aba - 2);
    c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText(`cota y carga (${U('carga')})`, izq + 4, arr);
    if (cursor !== undefined) {
      const j = cursor, px = X(x[j]);
      c.strokeStyle = 'rgba(243,238,238,.35)'; c.beginPath(); c.moveTo(px, arr); c.lineTo(px, H - aba); c.stroke();
      const txt = [`${ids[j]} · ${n(x[j], 0)} ${U('longitud')}`, `carga ${n(carga[j], 1)}`, `cota ${n(cota[j], 1)}`, `presión ${n(pres[j], 1)} ${U('presion')}`];
      c.font = '11px Geist, "Segoe UI", sans-serif';
      const w = Math.max(...txt.map((t) => c.measureText(t).width)) + 12, bx = Math.min(px + 8, W - w - 2);
      c.fillStyle = 'rgba(12,10,10,.95)'; c.fillRect(bx, arr + 14, w, txt.length * 15 + 6);
      txt.forEach((t, q) => { c.fillStyle = q === 1 ? '#ff6b62' : '#f3eeee'; c.fillText(t, bx + 6, arr + 18 + q * 15); });
    }
  };
  dibujar();
  canvas.onmousemove = (e) => { let m = 0, dm = Infinity; x.forEach((v, j) => { const d = Math.abs(X(v) - e.offsetX); if (d < dm) { dm = d; m = j; } }); dibujar(m); };
  canvas.onmouseleave = () => dibujar();
}

// ====================================================================== frecuencia
let frec = { v: 'presion', momento: 'hora', demanda: true };
async function tFrecuencia(c) {
  const ops = [['presion', `Presión (${U('presion')})`], ['velocidad', `Velocidad (${U('velocidad')})`]];
  if (hayCalidad()) { const [nq, uq] = nombreCalidad(); ops.push(['calidad', `${nq} (${uq})`]); }
  if (!ops.some(([v]) => v === frec.v)) frec.v = 'presion';
  await asegurar(frec.v); await asegurar('demanda');
  c.innerHTML = '';
  const f = h(`<div class="fila"><label>Qué<select id="fq-v">${ops.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select></label>
    <label>Cuándo<select id="fq-m"><option value="hora">A la hora de la barra</option><option value="min">Mínimo del día</option><option value="max">Máximo del día</option></select></label>
    <label class="chk" style="align-self:flex-end"><input type="checkbox" id="fq-d"> Solo nudos con demanda</label></div>`);
  c.append(f);
  $('#fq-v', f).value = frec.v; $('#fq-m', f).value = frec.momento; $('#fq-d', f).checked = frec.demanda;
  $('#fq-d', f).parentElement.style.display = frec.v === 'velocidad' ? 'none' : '';
  $('#fq-v', f).onchange = (e) => { frec.v = e.target.value; pintar(); };
  $('#fq-m', f).onchange = (e) => { frec.momento = e.target.value; pintar(); };
  $('#fq-d', f).onchange = (e) => { frec.demanda = e.target.checked; pintar(); };
  const nodal = frec.v !== 'velocidad';
  const a = S.res[frec.v], cnt = nodal ? S.M.nudos.id.length : S.M.tramos.id.length;
  const vals = [];
  for (let i = 0; i < cnt; i++) {
    if (nodal) {
      if (S.M.nudos.tipo[i] !== 0) continue;
      if (frec.demanda && !(S.res.demanda[S.hora * cnt + i] > 0 || S.M.nudos.dem[i] > 0)) continue;
    } else if (!['PIPE', 'CV'].includes(S.M.tramos.tipo[i])) continue;
    let v;
    if (frec.momento === 'hora') v = a[S.hora * cnt + i];
    else { v = frec.momento === 'min' ? Infinity : -Infinity; for (let t = 0; t < S.T; t++) { const x = a[t * cnt + i]; if (isFinite(x)) v = frec.momento === 'min' ? Math.min(v, x) : Math.max(v, x); } }
    if (frec.v === 'velocidad') v = Math.abs(v);
    if (isFinite(v)) vals.push(v);
  }
  if (!vals.length) { c.append(h('<div class="vacio">No hay valores para mostrar.</div>')); return; }
  vals.sort((x, y) => x - y);
  const q = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
  c.append(h(`<div class="cifras" style="margin-top:12px">
    <div class="cifra"><div class="v">${n(vals.length, 0)}</div><div class="t">${nodal ? 'nudos' : 'tuberías'}</div></div>
    <div class="cifra"><div class="v">${n(vals[0], 1)}</div><div class="t">mínimo</div></div>
    <div class="cifra"><div class="v">${n(q(0.5), 1)}</div><div class="t">mediana</div></div>
    <div class="cifra"><div class="v">${n(vals[vals.length - 1], 1)}</div><div class="t">máximo</div></div></div>`));
  const cv = h('<canvas style="width:100%;height:200px;display:block;margin-top:8px"></canvas>');
  c.append(cv);
  setTimeout(() => dibujoFrecuencia(cv, vals), 0);
  const cortes = frec.v === 'presion' ? (S.M.clases?.presion || []) : frec.v === 'velocidad' ? (S.M.clases?.velocidad || []) : [];
  if (cortes.length) {
    const t = h(`<table class="tabla" style="margin-top:10px"><tr><th>Por debajo de</th><th class="n">${nodal ? 'Nudos' : 'Tuberías'}</th><th class="n">%</th></tr></table>`);
    cortes.forEach((k) => { const m = vals.filter((v) => v < k).length; t.append(h(`<tr><td>${n(k, 1)} ${esc(frec.v === 'presion' ? U('presion') : U('velocidad'))}</td><td class="n">${n(m, 0)}</td><td class="n">${n(100 * m / vals.length, 1)}</td></tr>`)); });
    c.append(t);
  }
}
function dibujoFrecuencia(canvas, vals) {
  if (!ajustarCanvas(canvas, () => dibujoFrecuencia(canvas, vals))) return;
  const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const izq = 40, der = 34, arr = 10, aba = 22, B = 16;
  const lo = vals[0], hi = vals[vals.length - 1] > lo ? vals[vals.length - 1] : lo + 1;
  const cuenta = Array(B).fill(0);
  vals.forEach((v) => { cuenta[Math.min(B - 1, Math.floor(B * (v - lo) / (hi - lo)))]++; });
  const max = Math.max(...cuenta);
  const X = (v) => izq + (W - izq - der) * (v - lo) / (hi - lo), Yb = (v) => arr + (H - arr - aba) * (1 - v / max), Yp = (p) => arr + (H - arr - aba) * (1 - p);
  c.font = '10.5px Geist, "Segoe UI", sans-serif'; c.fillStyle = '#958a8a'; c.strokeStyle = '#2a2525';
  for (let j = 0; j <= 4; j++) { c.beginPath(); c.moveTo(izq, Yp(j / 4)); c.lineTo(W - der, Yp(j / 4)); c.stroke(); c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(`${j * 25} %`, W - der + 4, Yp(j / 4)); c.textAlign = 'right'; c.fillText(n(max * j / 4, 0), izq - 5, Yb(max * j / 4)); }
  const w = (W - izq - der) / B;
  c.fillStyle = 'rgba(214,42,41,.75)';
  cuenta.forEach((k, j) => c.fillRect(izq + j * w + 1, Yb(k), w - 2, Yb(0) - Yb(k)));
  c.strokeStyle = '#f3eeee'; c.lineWidth = 1.6; c.beginPath();
  vals.forEach((v, j) => { const px = X(v), py = Yp((j + 1) / vals.length); j ? c.lineTo(px, py) : c.moveTo(px, py); }); c.stroke();
  c.fillStyle = '#958a8a'; c.textAlign = 'center'; c.textBaseline = 'top';
  for (let j = 0; j <= 4; j++) c.fillText(n(lo + (hi - lo) * j / 4, 1), X(lo + (hi - lo) * j / 4), H - aba + 5);
}

// ====================================================================== flujo del sistema
async function tFlujo(c) {
  c.innerHTML = '';
  const b = S.resumen.balance;
  if (!b) { c.append(h('<div class="vacio">Esta corrida no tiene balance.</div>')); return; }
  const neto = b.serie_prod.map((p, j) => p - b.serie_cons[j]);
  const dq = (x) => (Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2);
  const iMax = b.serie_cons.indexOf(Math.max(...b.serie_cons)), iMin = b.serie_cons.indexOf(Math.min(...b.serie_cons));
  c.append(h(`<p class="sub" style="margin:0 0 10px">Lo que entra a la red (embalses y plantas) contra lo que consumen los nudos, hora a hora (${esc(U('caudal'))}). La diferencia es lo que llena o vacía los tanques.</p>`));
  c.append(h(`<div class="cifras">
    <div class="cifra"><div class="v">${n(b.produccion, dq(b.produccion))}</div><div class="t">producción media</div></div>
    <div class="cifra"><div class="v">${n(b.consumo, dq(b.consumo))}</div><div class="t">consumo medio</div></div>
    <div class="cifra"><div class="v">${n(b.serie_cons[iMax], dq(b.consumo))}</div><div class="t">consumo máximo · ${hora(S.horas[iMax])}</div></div>
    <div class="cifra"><div class="v">${n(b.serie_cons[iMin], dq(b.consumo))}</div><div class="t">consumo mínimo · ${hora(S.horas[iMin])}</div></div></div>`));
  const cv = h('<canvas class="grafica" style="height:200px"></canvas>');
  c.append(cv);
  setTimeout(() => grafica(cv, { series: [{ nombre: 'producción', valores: b.serie_prod, color: '#f3eeee' }, { nombre: 'consumo', valores: b.serie_cons, color: '#f5a524' }, { nombre: 'a tanques', valores: neto, color: '#8ea6ff', punteada: true }], horas: S.horas, unidad: U('caudal'), marca: S.horas[S.hora], decimales: dq(b.consumo) }), 0);
}

// ====================================================================== tablas
function columnas() {
  const M = S.M, nN = M.nudos.id.length, nL = M.tramos.id.length, t = S.hora;
  const R = (v, i, n_) => (S.res[v] ? S.res[v][t * n_ + i] : NaN);
  const [nq, uq] = nombreCalidad();
  if (tabla.clase === 'nudos') {
    const cols = [
      { k: 'id', t: 'ID', f: (i) => M.nudos.id[i], txt: true },
      { k: 'tipo', t: 'Tipo', f: (i) => claseTexto('nudo', i), txt: true },
      { k: 'cota', t: `Cota (${U('cota')})`, f: (i) => M.nudos.cota[i] },
      { k: 'base', t: `Demanda base (${U('caudal')})`, f: (i) => M.nudos.dem[i] },
      { k: 'demanda', t: `Demanda (${U('caudal')})`, f: (i) => R('demanda', i, nN) },
      { k: 'carga', t: `Carga (${U('carga')})`, f: (i) => R('carga', i, nN) },
      { k: 'presion', t: `Presión (${U('presion')})`, f: (i) => R('presion', i, nN) },
    ];
    if (hayCalidad()) cols.push({ k: 'calidad', t: `${nq} (${uq})`, f: (i) => R('calidad', i, nN) });
    return { cols, n: nN };
  }
  const L = M.tramos;
  const cols = [
    { k: 'id', t: 'ID', f: (k) => L.id[k], txt: true },
    { k: 'tipo', t: 'Tipo', f: (k) => claseTexto('tramo', k), txt: true },
    { k: 'lon', t: `Longitud (${U('longitud')})`, f: (k) => L.lon[k] },
    { k: 'diam', t: `Diámetro (${U('diametro')})`, f: (k) => L.diam[k] },
    { k: 'rug', t: 'Rugosidad', f: (k) => L.rug[k] },
    { k: 'caudal', t: `Caudal (${U('caudal')})`, f: (k) => R('caudal', k, nL) },
    { k: 'velocidad', t: `Velocidad (${U('velocidad')})`, f: (k) => R('velocidad', k, nL) },
    { k: 'perdida', t: `Pérdida (${S.M.sistema.us ? 'ft/1000 ft' : 'm/km'})`, f: (k) => { if (!['PIPE', 'CV'].includes(L.tipo[k]) || !L.lon[k]) return NaN; const a = R('carga', L.n1[k], nN), b = R('carga', L.n2[k], nN); return Math.abs(a - b) / L.lon[k] * 1000; } },
    { k: 'estado', t: 'Estado', f: (k) => (R('estado', k, nL) > 0 ? 'abierto' : R('estado', k, nL) === 0 ? 'cerrado' : ''), txt: true },
  ];
  if (hayCalidad()) cols.push({ k: 'calidad', t: `${nq} (${uq})`, f: (k) => R('calidad_t', k, nL) });
  return { cols, n: nL };
}
function filasTabla() {
  const { cols, n: cnt } = columnas();
  let filas = Array.from({ length: cnt }, (_, i) => i);
  const fl = tabla.filtro, col = cols.find((x) => x.k === fl.col);
  if (col && fl.valor !== '') {
    const v = col.txt ? String(fl.valor).toLowerCase() : Number(String(fl.valor).replace(',', '.'));
    filas = filas.filter((i) => {
      const x = col.f(i);
      if (col.txt) { const s = String(x ?? '').toLowerCase(); return fl.op === '≠' ? s !== v : fl.op === '=' ? s === v : s.includes(v); }
      if (!isFinite(x)) return false;
      return { '<': x < v, '<=': x <= v, '>': x > v, '>=': x >= v, '=': Math.abs(x - v) < 1e-9, '≠': Math.abs(x - v) >= 1e-9 }[fl.op] ?? true;
    });
  }
  const oc = cols.find((x) => x.k === tabla.orden);
  if (oc) filas.sort((a, b) => { const x = oc.f(a), y = oc.f(b); const r = oc.txt ? String(x).localeCompare(String(y), 'es', { numeric: true }) : (isFinite(x) ? x : -Infinity) - (isFinite(y) ? y : -Infinity); return tabla.desc ? -r : r; });
  return { cols, filas };
}
async function tTablas(c) {
  for (const v of ['presion', 'carga', 'demanda', 'caudal', 'velocidad', 'estado', ...(hayCalidad() ? ['calidad', 'calidad_t'] : [])]) await asegurar(v);
  c.innerHTML = '';
  const { cols, filas } = filasTabla();
  const f = h(`<div class="fila"><div class="seg" id="tb-c"><button data-v="nudos">Nudos</button><button data-v="tramos">Tramos</button></div></div>`);
  c.append(f);
  $$('#tb-c button', f).forEach((b) => { b.classList.toggle('on', b.dataset.v === tabla.clase); b.onclick = () => { tabla.clase = b.dataset.v; tabla.orden = null; tabla.filtro = { col: '', op: '<', valor: '' }; pintar(); }; });
  const fil = h(`<div class="fila" style="margin-top:8px"><label>Filtrar<select id="tb-col"><option value="">(todos)</option>${cols.map((x) => `<option value="${x.k}">${esc(x.t)}</option>`).join('')}</select></label>
    <label>&nbsp;<select id="tb-op">${['<', '<=', '>', '>=', '=', '≠', 'contiene'].map((o) => `<option>${o}</option>`).join('')}</select></label>
    <label>&nbsp;<input id="tb-val" style="width:90px"></label><button class="btn chico" id="tb-ok" style="align-self:flex-end">Aplicar</button></div>`);
  c.append(fil);
  $('#tb-col', fil).value = tabla.filtro.col; $('#tb-op', fil).value = tabla.filtro.op; $('#tb-val', fil).value = tabla.filtro.valor;
  const aplicar = () => { tabla.filtro = { col: $('#tb-col', fil).value, op: $('#tb-op', fil).value, valor: $('#tb-val', fil).value.trim() }; pintar(); };
  $('#tb-ok', fil).onclick = aplicar;
  $('#tb-val', fil).onkeydown = (e) => { if (e.key === 'Enter') aplicar(); };
  const acc = h(`<div class="fila" style="margin:10px 0 6px"><span class="sub" style="margin:0">${n(filas.length, 0)} ${tabla.clase === 'nudos' ? 'nudos' : 'tramos'} a las ${hora(S.horas[S.hora])}${filas.length > MAX_FILAS ? ` · se ven los primeros ${n(MAX_FILAS, 0)} (exporta para tenerlos todos)` : ''}</span>
    <button class="btn chico" data-a="csv">Exportar CSV…</button><button class="btn chico" data-a="ver">Ver en el mapa</button><button class="btn chico" data-a="grupo">Editar en grupo…</button></div>`);
  c.append(acc);
  const ids = () => filas.map((i) => (tabla.clase === 'nudos' ? S.M.nudos.id[i] : S.M.tramos.id[i]));
  $('[data-a=ver]', acc).onclick = () => { S.resaltar = conjunto(ids().map((id) => ({ clase: tabla.clase === 'nudos' ? 'nudo' : 'tramo', id }))); mapa.ajustarA(S.resaltar); mapa.pedir(); };
  $('[data-a=grupo]', acc).onclick = () => edicionGrupo(tabla.clase === 'nudos' ? { nudos: ids(), tramos: [] } : { nudos: [], tramos: ids() });
  $('[data-a=csv]', acc).onclick = async () => {
    const ruta = await explorar({ titulo: 'Exportar la tabla', guardar: true, filtro: ['.csv'], nombre: `${S.info.nombre.replace(/\.inp$/i, '')}_${tabla.clase}_${hora(S.horas[S.hora]).replace(':', 'h')}.csv` });
    if (!ruta) return;
    const texto = [cols.map((x) => x.t).join(';'), ...filas.map((i) => cols.map((x) => { const v = x.f(i); return x.txt ? String(v ?? '').replace(/;/g, ',') : csvNum(v); }).join(';'))].join('\r\n');
    const enviar = async (sob) => { try { const r = await post('/api/guardar_texto', { ruta, texto, sobrescribir: sob }); aviso(`Tabla guardada en ${r.ruta}`, 'ok'); } catch (e) { if (e.codigo === 409) modal({ titulo: 'Ese archivo ya existe', chico: true, cuerpo: `<p>${esc(e.message)}</p>`, botones: [{ texto: 'Cancelar' }, { texto: 'Reemplazarlo', clase: 'peligro', accion: () => enviar(true) }] }); else fallo(e); } };
    enviar(false);
  };
  const t = h(`<div class="tabla-caja"><table class="tabla"><tr>${cols.map((x) => `<th class="${x.txt ? '' : 'n'}" data-k="${x.k}" style="cursor:pointer">${esc(x.t)}${tabla.orden === x.k ? (tabla.desc ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr></table></div>`);
  $$('th', t).forEach((th) => { th.onclick = () => { if (tabla.orden === th.dataset.k) tabla.desc = !tabla.desc; else { tabla.orden = th.dataset.k; tabla.desc = false; } pintar(); }; });
  const tb = $('table', t);
  filas.slice(0, MAX_FILAS).forEach((i) => {
    const tr = h(`<tr class="clic">${cols.map((x) => { const v = x.f(i); return `<td class="${x.txt ? (x.k === 'id' ? 'mono' : '') : 'n'}">${x.txt ? esc(v) : n(v, Math.abs(v) >= 100 ? 1 : 2)}</td>`; }).join('')}</tr>`);
    tr.onclick = () => bus.emit('ir', { clase: tabla.clase === 'nudos' ? 'nudo' : 'tramo', id: tabla.clase === 'nudos' ? S.M.nudos.id[i] : S.M.tramos.id[i] });
    tb.append(tr);
  });
  c.append(t);
}

// ====================================================================== energía
async function tEnergia(c) {
  c.innerHTML = '';
  const E = S.resumen.energia;
  if (!E?.bombas?.length) { c.append(h('<div class="vacio">Este modelo no tiene bombas.</div>')); return; }
  const uv = E.unidad_volumen;
  c.append(h(`<div class="cifras"><div class="cifra"><div class="v">${n(E.kwh, 0)}</div><div class="t">kWh en la simulación</div></div>
    <div class="cifra"><div class="v">${n(E.costo, 0)}</div><div class="t">costo de la energía</div></div>
    <div class="cifra"><div class="v">${n(E.cargo_potencia, 0)}</div><div class="t">cargo por potencia</div></div>
    <div class="cifra"><div class="v">${n(E.bombas.length, 0)}</div><div class="t">bombas</div></div></div>`));
  const COLS = [['id', 'Bomba'], ['uso_pct', 'Uso %'], ['eficiencia', 'Efic. %'], ['kwh_por_vol', `kWh/${uv}`], ['kw_medio', 'kW medio'], ['kw_max', 'kW pico'], ['kwh', 'kWh'], ['costo', 'Costo']];
  const acc = h(`<div class="fila" style="margin:12px 0 6px"><span class="sub" style="margin:0">${n(E.bombas.length, 0)} bombas · toca un encabezado para ordenar</span><button class="btn chico" data-a="csv">Exportar CSV…</button></div>`);
  c.append(acc);
  const lista = [...E.bombas].sort((a, b) => {
    const va = a[energia.orden], vb = b[energia.orden];
    const r = typeof va === 'string' ? va.localeCompare(vb, 'es', { numeric: true }) : (va ?? -Infinity) - (vb ?? -Infinity);
    return energia.desc ? -r : r;
  });
  const t = h(`<div class="tabla-caja"><table class="tabla"><tr>${COLS.map(([k, tt]) => `<th class="${k === 'id' ? '' : 'n'}" data-k="${k}" style="cursor:pointer">${esc(tt)}${energia.orden === k ? (energia.desc ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr></table></div>`);
  $$('th', t).forEach((th) => { th.onclick = () => { if (energia.orden === th.dataset.k) energia.desc = !energia.desc; else { energia.orden = th.dataset.k; energia.desc = th.dataset.k !== 'id'; } pintar(); }; });
  lista.forEach((b) => {
    const tr = h(`<tr class="clic"><td class="mono">${esc(b.id)}</td><td class="n">${n(b.uso_pct, 0)}</td><td class="n">${n(b.eficiencia, 0)}</td><td class="n">${n(b.kwh_por_vol, b.kwh_por_vol < 10 ? 2 : 0)}</td><td class="n">${n(b.kw_medio, 1)}</td><td class="n">${n(b.kw_max, 1)}</td><td class="n">${n(b.kwh, 0)}</td><td class="n">${n(b.costo, 0)}</td></tr>`);
    tr.onclick = () => bus.emit('ir', { clase: 'tramo', id: b.id });
    $('table', t).append(tr);
  });
  c.append(t);
  $('[data-a=csv]', acc).onclick = async () => {
    const ruta = await explorar({ titulo: 'Exportar la energía', guardar: true, filtro: ['.csv'], nombre: `${S.info.nombre.replace(/\.inp$/i, '')}_energia.csv` });
    if (!ruta) return;
    const texto = [COLS.map(([, tt]) => tt).join(';'), ...lista.map((b) => COLS.map(([k]) => (k === 'id' ? String(b.id).replace(/;/g, ',') : csvNum(b[k], 2))).join(';'))].join('\r\n');
    const enviar = async (sob) => { try { const r = await post('/api/guardar_texto', { ruta, texto, sobrescribir: sob }); aviso(`Tabla guardada en ${r.ruta}`, 'ok'); } catch (e) { if (e.codigo === 409) modal({ titulo: 'Ese archivo ya existe', chico: true, cuerpo: `<p>${esc(e.message)}</p>`, botones: [{ texto: 'Cancelar' }, { texto: 'Reemplazarlo', clase: 'peligro', accion: () => enviar(true) }] }); else fallo(e); } };
    enviar(false);
  };
  c.append(h('<p class="sub" style="margin-top:8px">Uso: porcentaje del tiempo prendida. El precio y su patrón salen de Datos &gt; Opciones (o de la ficha de cada bomba).</p>'));
}

// ====================================================================== edición en grupo
const CAMPOS_GRUPO = {
  tramo: [['diam', `Diámetro (${'{diametro}'})`], ['rug', 'Rugosidad'], ['km', 'Pérdida menor (K)'], ['lon', 'Longitud'], ['estado', 'Estado inicial'], ['tag', 'Etiqueta']],
  nudo: [['cota', 'Cota'], ['dem', 'Demanda base'], ['pat', 'Patrón de demanda'], ['tag', 'Etiqueta']],
};
export async function edicionGrupo(sel) {
  let clase = sel.tramos.length && !sel.nudos.length ? 'tramo' : sel.nudos.length && !sel.tramos.length ? 'nudo' : null;
  if (!sel.tramos.length && !sel.nudos.length) { aviso('No hay elementos para editar.', 'error'); return; }
  if (!clase) {
    const v = await formulario('Edición en grupo', [{ id: 'clase', etiqueta: 'Qué editar', opciones: [{ v: 'tramo', t: `Los ${sel.tramos.length} tramos` }, { v: 'nudo', t: `Los ${sel.nudos.length} nudos` }] }], 'Seguir');
    if (!v) return; clase = v.clase;
  }
  const ids = clase === 'tramo' ? sel.tramos : sel.nudos;
  const v = await formulario(`Editar ${ids.length} ${clase === 'tramo' ? 'tramos' : 'nudos'}`, [
    { id: 'campo', etiqueta: 'Propiedad', opciones: CAMPOS_GRUPO[clase].map(([k, t]) => ({ v: k, t: t.replace('{diametro}', U('diametro')) })) },
    { id: 'accion', etiqueta: 'Qué hacer', opciones: [{ v: 'fijar', t: 'Poner este valor' }, { v: 'multiplicar', t: 'Multiplicar por' }, { v: 'sumar', t: 'Sumar' }] },
    { id: 'valor', etiqueta: 'Valor (estado: OPEN o CLOSED; patrón o etiqueta: el texto)', valor: '' },
  ], 'Aplicar');
  if (!v || v.valor === '') return;
  let lista = ids;
  // la rugosidad y la longitud solo existen en tuberías; el patrón, solo en nudos de consumo
  if (clase === 'tramo' && ['rug', 'lon'].includes(v.campo)) lista = ids.filter((id) => ['PIPE', 'CV'].includes(S.M.tramos.tipo[S.idxL.get(id)]));
  if (clase === 'tramo' && v.campo === 'diam') lista = ids.filter((id) => S.M.tramos.tipo[S.idxL.get(id)] !== 'PUMP');
  if (clase === 'nudo' && ['dem', 'pat'].includes(v.campo)) lista = ids.filter((id) => S.M.nudos.tipo[S.idxN.get(id)] === 0);
  if (['estado', 'pat', 'tag'].includes(v.campo) && v.accion !== 'fijar') { aviso('Esa propiedad solo se puede fijar.', 'error'); return; }
  if (!lista.length) { aviso('Ninguno de los elementos tiene esa propiedad.', 'error'); return; }
  const valor = ['estado', 'pat', 'tag'].includes(v.campo) ? v.valor.trim() : Number(String(v.valor).replace(',', '.'));
  if (typeof valor === 'number' && !Number.isFinite(valor)) { aviso('El valor tiene que ser un número.', 'error'); return; }
  try {
    const r = await post(`/api/doc/${S.doc}/editar`, { op: { op: 'grupo', tipo: clase, ids: lista, campo: v.campo, accion: v.accion, valor } });
    aviso(`${r.resultado} ${clase === 'tramo' ? 'tramos' : 'nudos'} cambiados. Ctrl+Z lo deshace.`, 'ok');
    bus.emit('recargar', { mantener: true });
  } catch (e) { fallo(e); }
}
