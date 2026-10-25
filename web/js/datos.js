// Panel Datos: patrones, curvas, controles, reglas y opciones de cálculo. Cada cambio es una edición del escenario
// (se deshace con Ctrl+Z) y el servidor la prueba con EPANET 2.2 antes de aceptarla.
import { S, bus, get, post, esc, n, h, aviso, fallo, modal, formulario, esqueleto, $, $$, U } from './estado.js';

const P = () => document.getElementById('panel');
let pestana = 'patrones';
let D = null;                                   // GET /datos del modelo activo
const sel = { patrones: null, curvas: null };    // el que se está editando (un borrador si es nuevo)

const TABS = [['patrones', 'Patrones'], ['curvas', 'Curvas'], ['controles', 'Controles'], ['reglas', 'Reglas'], ['opciones', 'Opciones'], ['rotulos', 'Rótulos']];
const TIPOS_CURVA = {
  PUMP: { nombre: 'Bomba', x: 'Caudal', ux: 'caudal', y: 'Carga', uy: 'carga', ayuda: 'Carga que da la bomba según el caudal. Con un punto EPANET arma la curva sola; con tres o más, la ajusta.' },
  EFFICIENCY: { nombre: 'Eficiencia', x: 'Caudal', ux: 'caudal', y: 'Eficiencia', uy: '%', ayuda: 'Eficiencia de la bomba (%) según el caudal; sirve para el informe de energía.' },
  VOLUME: { nombre: 'Volumen', x: 'Nivel', ux: 'nivel', y: 'Volumen', uy: 'volumen', ayuda: 'Volumen del tanque según el nivel, para tanques que no son cilíndricos.' },
  HEADLOSS: { nombre: 'Pérdida', x: 'Caudal', ux: 'caudal', y: 'Pérdida', uy: 'carga', ayuda: 'Pérdida de carga según el caudal, para válvulas GPV.' },
};

// ====================================================================== utilidades
async function editar(op, mensaje) {
  try {
    const r = await post(`/api/doc/${S.doc}/editar`, { op });
    (r.avisos || []).forEach((a) => aviso(a));
    if (mensaje) aviso(mensaje, 'ok');
    bus.emit('recargar', { mantener: true });     // recarga el modelo y vuelve a pintar este panel
    return true;
  } catch (e) { error(e); return false; }
}
function error(e) {
  const t = e.message || String(e);
  if (!t.includes('\n')) { fallo(e); return; }
  const [titulo, ...resto] = t.split('\n');
  modal({ titulo: titulo.replace(/:$/, ''), chico: true, cuerpo: `<div class="texto-inp">${esc(resto.join('\n'))}</div><p class="sub" style="margin-top:10px">No se cambió nada.</p>`, botones: [{ texto: 'Entendido', clase: 'prim' }] });
}
// números pegados desde Excel (coma decimal, tabuladores, saltos de línea o punto y coma)
function numeros(texto) {
  return String(texto).split(/[\s;]+/).map((x) => x.trim().replace(',', '.')).filter((x) => x !== '').map(Number).filter((x) => Number.isFinite(x));
}
// "1:00", "0:15:00", "2", "30 MIN", "1 HOURS" -> horas
function horas(t, defecto = 1) {
  const s = String(t ?? '').trim().toUpperCase();
  if (!s) return defecto;
  if (s.includes(':')) { const [a, b = 0, c = 0] = s.split(/\s+/)[0].split(':').map(Number); return a + b / 60 + c / 3600; }
  const [v, uni = 'HOURS'] = s.split(/\s+/);
  const x = Number(v);
  if (!Number.isFinite(x)) return defecto;
  if (uni.startsWith('SEC')) return x / 3600;
  if (uni.startsWith('MIN')) return x / 60;
  if (uni.startsWith('DAY')) return x * 24;
  return x;
}
function reloj(hh) { const m = Math.round(hh * 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; }

// Lo que ya tiene el modelo, plegado para que no estorbe (hay modelos con más de cien). Se recuerda si quedó
// abierto; al elegir uno se pliega y su editor queda arriba. Con muchos, un buscador.
const abierto = { patrones: false, curvas: false };
function desplegable(clave, titulo, filas, alElegir) {
  const d = h(`<details class="tarjeta desplegable"${abierto[clave] ? ' open' : ''}><summary><b>${esc(titulo)}</b><span class="chip">${n(filas.length, 0)}</span></summary></details>`);
  d.ontoggle = () => { abierto[clave] = d.open; };
  const ul = h('<ul class="lista"></ul>');
  const lis = filas.map(({ id, detalle, activo }) => {
    const li = h(`<li><button class="enlace">${esc(id)}</button><span class="d">${detalle}</span></li>`);
    if (activo) li.classList.add('activo');
    $('button', li).onclick = () => { abierto[clave] = false; alElegir(id); };
    ul.append(li);
    return [id.toLowerCase(), li];
  });
  if (filas.length > 10) {
    const f = h(`<input type="search" class="filtro" placeholder="Buscar entre los ${n(filas.length, 0)}…" aria-label="Buscar">`);
    f.oninput = () => { const q = f.value.trim().toLowerCase(); lis.forEach(([k, li]) => { li.hidden = !!q && !k.includes(q); }); };
    d.append(f);
  }
  d.append(ul);
  return d;
}
// el editor recién abierto, a la vista
function aLaVista(caja) { requestAnimationFrame(() => caja.scrollIntoView({ block: 'nearest' })); }

// gráfica pequeña: barras (patrón) o línea con puntos (curva)
function dibujo(canvas, { tipo, valores = [], puntos = [], extra = [], ex = '', ey = '' }) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 300, H = canvas.clientHeight || 150;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const izq = 40, der = 8, arr = 10, aba = 22;
  c.font = '10.5px Geist, "Segoe UI", sans-serif'; c.fillStyle = '#958a8a'; c.strokeStyle = '#2a2525'; c.lineWidth = 1;
  if (tipo === 'barras') {
    const max = Math.max(1.2, ...valores) * 1.08;
    const Y = (v) => arr + (H - arr - aba) * (1 - v / max);
    for (let j = 0; j <= 4; j++) { const v = max * j / 4; c.beginPath(); c.moveTo(izq, Y(v)); c.lineTo(W - der, Y(v)); c.stroke(); c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText(n(v, 2), izq - 5, Y(v)); }
    const w = (W - izq - der) / Math.max(1, valores.length);
    valores.forEach((v, j) => { c.fillStyle = v >= 1 ? '#d62a29' : '#7d3a39'; c.fillRect(izq + j * w + 1, Y(v), Math.max(1, w - 2), Y(0) - Y(v)); });
    c.strokeStyle = 'rgba(243,238,238,.55)'; c.setLineDash([4, 3]); c.beginPath(); c.moveTo(izq, Y(1)); c.lineTo(W - der, Y(1)); c.stroke(); c.setLineDash([]);
    c.fillStyle = '#958a8a'; c.textAlign = 'center'; c.textBaseline = 'top';
    const paso = Math.max(1, Math.ceil(valores.length / 8));
    valores.forEach((_, j) => { if (j % paso === 0) c.fillText(String(j + 1), izq + j * w + w / 2, H - aba + 5); });
    return;
  }
  const todos = [...puntos, ...extra];
  if (!todos.length) { c.fillText('Sin puntos', izq, H / 2); return; }
  let x1 = Math.max(...todos.map((p) => p[0])), y1 = Math.max(...todos.map((p) => p[1]));
  let x0 = Math.min(0, ...todos.map((p) => p[0])), y0 = Math.min(0, ...todos.map((p) => p[1]));
  if (x1 - x0 < 1e-9) x1 = x0 + 1; if (y1 - y0 < 1e-9) y1 = y0 + 1;
  y1 += (y1 - y0) * 0.08;
  const X = (v) => izq + (W - izq - der) * (v - x0) / (x1 - x0), Y = (v) => arr + (H - arr - aba) * (1 - (v - y0) / (y1 - y0));
  for (let j = 0; j <= 4; j++) { const v = y0 + (y1 - y0) * j / 4; c.beginPath(); c.moveTo(izq, Y(v)); c.lineTo(W - der, Y(v)); c.stroke(); c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText(n(v, Math.abs(y1 - y0) < 10 ? 1 : 0), izq - 5, Y(v)); }
  c.textAlign = 'center'; c.textBaseline = 'top';
  for (let j = 0; j <= 4; j++) { const v = x0 + (x1 - x0) * j / 4; c.fillText(n(v, Math.abs(x1 - x0) < 10 ? 1 : 0), X(v), H - aba + 5); }
  if (extra.length) { c.strokeStyle = 'rgba(243,238,238,.45)'; c.setLineDash([4, 3]); c.beginPath(); extra.forEach(([x, y], j) => (j ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y)))); c.stroke(); c.setLineDash([]); }
  c.strokeStyle = '#d62a29'; c.lineWidth = 2; c.beginPath(); puntos.forEach(([x, y], j) => (j ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y)))); c.stroke();
  c.fillStyle = '#f3eeee'; puntos.forEach(([x, y]) => { c.beginPath(); c.arc(X(x), Y(y), 3, 0, Math.PI * 2); c.fill(); });
  c.fillStyle = '#958a8a'; c.textAlign = 'right'; c.textBaseline = 'bottom'; c.fillText(ex, W - der, H - aba - 2);
  c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText(ey, izq + 4, arr);
}

// ====================================================================== panel
export async function pDatos() {
  P().innerHTML = `<h1>Datos del modelo</h1>
    <p class="sub">Patrones, curvas, controles, reglas y opciones de cálculo. Cada cambio queda en ${S.info.propio ? 'el modelo (Ctrl+S lo guarda)' : 'el escenario, sin tocar el archivo original'}, se deshace con Ctrl+Z y EPANET lo revisa antes de aceptarlo.</p>
    <div class="seg pestanas-d" id="d-tabs">${TABS.map(([k, t]) => `<button data-k="${k}">${t}</button>`).join('')}</div>
    <div id="d-cont" style="margin-top:14px">${esqueleto(5, true)}</div>`;
  $$('#d-tabs button').forEach((b) => { b.classList.toggle('on', b.dataset.k === pestana); b.onclick = () => { pestana = b.dataset.k; $$('#d-tabs button').forEach((x) => x.classList.toggle('on', x === b)); pintar(); }; });
  try { D = await get(`/api/doc/${S.doc}/datos`); } catch (e) { fallo(e); return; }
  pintar();
}
function pintar() {
  const c = $('#d-cont');
  if (!c || !D) return;
  c.innerHTML = '';
  ({ patrones: tPatrones, curvas: tCurvas, controles: tControles, reglas: tReglas, opciones: tOpciones, rotulos: tRotulos })[pestana](c);
}

// ====================================================================== patrones
function tPatrones(c) {
  const ids = Object.keys(D.patrones);
  const paso = horas(D.tiempos['PATTERN TIMESTEP']), inicio = horas(D.tiempos['PATTERN START'], 0);
  c.append(h(`<p class="sub" style="margin:0 0 10px">Multiplicadores por periodo (cada ${reloj(paso)} h). La demanda o la carga de un elemento con patrón es su valor base por el multiplicador de cada periodo.</p>`));
  const cab = h('<div class="fila" style="margin-bottom:8px"><button class="btn chico prim" id="p-nuevo">Patrón nuevo</button></div>');
  c.append(cab);
  $('#p-nuevo', cab).onclick = async () => {
    const v = await formulario('Patrón nuevo', [{ id: 'id', etiqueta: 'ID', valor: '' }, { id: 'periodos', etiqueta: 'Periodos', tipo: 'number', valor: Math.round(24 / paso) || 24 }], 'Crear');
    if (!v || !v.id.trim()) return;
    if (D.patrones[v.id.trim()]) { aviso(`Ya existe el patrón ${v.id.trim()}.`, 'error'); return; }
    sel.patrones = { id: v.id.trim(), valores: Array(Math.max(1, Math.min(2000, v.periodos || 24))).fill(1), nuevo: true };
    abierto.patrones = false;
    pintar();
  };
  if (sel.patrones && (sel.patrones.nuevo || D.patrones[sel.patrones.id])) { const ed = editorPatron(paso, inicio); c.append(ed); aLaVista(ed); }
  if (!ids.length) { c.append(h('<div class="vacio">Este modelo no tiene patrones: todo es constante en el tiempo.</div>')); return; }
  c.append(desplegable('patrones', 'Patrones del modelo', ids.map((id) => {
    const v = D.patrones[id], prom = v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
    return { id, activo: sel.patrones?.id === id, detalle: `${n(v.length, 0)} periodos · promedio ${n(prom, 2)} · máx. ${n(Math.max(...v), 2)}` };
  }), (id) => { sel.patrones = { id, valores: [...D.patrones[id]] }; pintar(); }));
}
function editorPatron(paso, inicio) {
  const p = sel.patrones;
  const caja = h(`<div class="tarjeta" style="margin-top:12px"><h3>${p.nuevo ? 'Patrón nuevo' : 'Patrón'} ${esc(p.id)}</h3>
    <canvas class="grafica"></canvas><div class="rejilla-pat"></div>
    <div class="acciones"><button class="btn prim" data-a="guardar">${p.nuevo ? 'Crear patrón' : 'Guardar'}</button><button class="btn" data-a="mas">Agregar periodo</button><button class="btn" data-a="menos">Quitar el último</button>
      <button class="btn" data-a="pegar">Pegar valores…</button><button class="btn" data-a="norm" title="Divide todo por el promedio">Promedio 1</button>${p.nuevo ? '' : '<button class="btn peligro" data-a="borrar">Borrar</button>'}</div></div>`);
  const cv = $('canvas', caja), rej = $('.rejilla-pat', caja);
  const redibujar = () => dibujo(cv, { tipo: 'barras', valores: p.valores });
  const celdas = () => {
    rej.innerHTML = '';
    p.valores.forEach((v, j) => {
      const l = h(`<label><span>${j + 1} · ${reloj(inicio + j * paso)}</span><input type="number" step="any" value="${v}"></label>`);
      $('input', l).oninput = (e) => { const x = Number(e.target.value); if (Number.isFinite(x)) { p.valores[j] = x; redibujar(); } };
      rej.append(l);
    });
    setTimeout(redibujar, 0);
  };
  celdas();
  $('[data-a=mas]', caja).onclick = () => { p.valores.push(p.valores[p.valores.length - 1] ?? 1); celdas(); };
  $('[data-a=menos]', caja).onclick = () => { if (p.valores.length > 1) { p.valores.pop(); celdas(); } };
  $('[data-a=norm]', caja).onclick = () => { const m = p.valores.reduce((a, b) => a + b, 0) / p.valores.length; if (m > 0) { p.valores = p.valores.map((v) => +(v / m).toFixed(4)); celdas(); } };
  $('[data-a=pegar]', caja).onclick = () => {
    const t = h('<div><p class="sub">Pega una fila o columna de Excel (sirve la coma decimal). Reemplaza todos los valores.</p><textarea rows="6" style="width:100%" class="mono"></textarea></div>');
    modal({ titulo: `Pegar valores en ${p.id}`, chico: true, cuerpo: t, botones: [{ texto: 'Cancelar' }, { texto: 'Usar estos valores', clase: 'prim', accion: () => { const v = numeros($('textarea', t).value); if (!v.length) { aviso('No encontré números.', 'error'); return false; } p.valores = v; celdas(); return undefined; } }] });
  };
  $('[data-a=guardar]', caja).onclick = async () => { if (await editar({ op: 'patron', id: p.id, valores: p.valores }, `Patrón ${p.id} ${p.nuevo ? 'creado' : 'guardado'}.`)) p.nuevo = false; };
  const b = $('[data-a=borrar]', caja);
  if (b) b.onclick = async () => { if (await editar({ op: 'patron', id: p.id, valores: null }, `Patrón ${p.id} borrado.`)) sel.patrones = null; };
  return caja;
}

// ====================================================================== curvas
function tCurvas(c) {
  const ids = Object.keys(D.curvas);
  c.append(h('<p class="sub" style="margin:0 0 10px">Curvas de bombas (carga y eficiencia), de volumen de tanques y de pérdida de válvulas GPV.</p>'));
  const cab = h('<div class="fila" style="margin-bottom:8px"><button class="btn chico prim" id="c-nueva">Curva nueva</button></div>');
  c.append(cab);
  $('#c-nueva', cab).onclick = async () => {
    const v = await formulario('Curva nueva', [{ id: 'id', etiqueta: 'ID', valor: '' }, { id: 'tipo', etiqueta: 'Tipo', opciones: Object.entries(TIPOS_CURVA).map(([k, t]) => ({ v: k, t: t.nombre })) }], 'Crear');
    if (!v || !v.id.trim()) return;
    if (D.curvas[v.id.trim()]) { aviso(`Ya existe la curva ${v.id.trim()}.`, 'error'); return; }
    sel.curvas = { id: v.id.trim(), tipo: v.tipo, puntos: [[0, 0]], nuevo: true };
    abierto.curvas = false;
    pintar();
  };
  if (sel.curvas && (sel.curvas.nuevo || D.curvas[sel.curvas.id])) { const ed = editorCurva(); c.append(ed); aLaVista(ed); }
  if (!ids.length) { c.append(h('<div class="vacio">Este modelo no tiene curvas.</div>')); return; }
  c.append(desplegable('curvas', 'Curvas del modelo', ids.map((id) => {
    const cu = D.curvas[id];
    return { id, activo: sel.curvas?.id === id, detalle: `${esc(TIPOS_CURVA[cu.tipo]?.nombre || cu.tipo)} · ${n(cu.puntos.length, 0)} ${cu.puntos.length === 1 ? 'punto' : 'puntos'}` };
  }), (id) => { const cu = D.curvas[id]; sel.curvas = { id, tipo: cu.tipo, puntos: cu.puntos.map((p) => [...p]) }; pintar(); }));
}
// la curva de una bomba de un punto, como la arma EPANET: carga de cierre 1,33 h y caudal máximo 2 q
function curvaUnPunto([q, hh]) { const pts = []; for (let j = 0; j <= 20; j++) { const x = 2 * q * j / 20; pts.push([x, 1.33334 * hh * (1 - (x / (2 * q)) ** 2)]); } return pts; }
function editorCurva() {
  const cu = sel.curvas, T = () => TIPOS_CURVA[cu.tipo] || TIPOS_CURVA.PUMP;
  const caja = h(`<div class="tarjeta" style="margin-top:12px"><h3>${cu.nuevo ? 'Curva nueva' : 'Curva'} ${esc(cu.id)}</h3>
    <label class="campo">Tipo <select ${cu.nuevo ? '' : 'disabled title="El tipo sale de quién usa la curva"'}>${Object.entries(TIPOS_CURVA).map(([k, t]) => `<option value="${k}">${t.nombre}</option>`).join('')}</select></label>
    <p class="sub ayuda-c" style="margin:0 0 6px"></p><canvas class="grafica"></canvas>
    <table class="tabla" style="margin-top:8px"><thead><tr><th class="hx"></th><th class="hy"></th><th></th></tr></thead><tbody></tbody></table>
    <div class="acciones"><button class="btn prim" data-a="guardar">${cu.nuevo ? 'Crear curva' : 'Guardar'}</button><button class="btn" data-a="mas">Agregar punto</button><button class="btn" data-a="pegar">Pegar puntos…</button>${cu.nuevo ? '' : '<button class="btn peligro" data-a="borrar">Borrar</button>'}</div></div>`);
  const tipoSel = $('select', caja); tipoSel.value = cu.tipo;
  const cv = $('canvas', caja), tb = $('tbody', caja);
  const uni = (k) => (k === '%' ? '%' : U(k));
  const redibujar = () => {
    const t = T();
    $('.hx', caja).textContent = `${t.x} (${uni(t.ux)})`; $('.hy', caja).textContent = `${t.y} (${uni(t.uy)})`;
    $('.ayuda-c', caja).textContent = t.ayuda;
    const pts = cu.puntos.filter((p) => p.every(Number.isFinite));
    dibujo(cv, { tipo: 'curva', puntos: pts, extra: cu.tipo === 'PUMP' && pts.length === 1 && pts[0][0] > 0 ? curvaUnPunto(pts[0]) : [], ex: uni(t.ux), ey: uni(t.uy) });
  };
  const filas = () => {
    tb.innerHTML = '';
    cu.puntos.forEach((p, j) => {
      const tr = h(`<tr><td><input type="number" step="any" value="${p[0]}" style="width:100%"></td><td><input type="number" step="any" value="${p[1]}" style="width:100%"></td><td><button class="btn chico" title="Quitar este punto">×</button></td></tr>`);
      const [a, b] = $$('input', tr);
      a.oninput = () => { p[0] = Number(a.value); redibujar(); };
      b.oninput = () => { p[1] = Number(b.value); redibujar(); };
      $('button', tr).onclick = () => { if (cu.puntos.length > 1) { cu.puntos.splice(j, 1); filas(); } };
      tb.append(tr);
    });
    setTimeout(redibujar, 0);
  };
  filas();
  tipoSel.onchange = () => { cu.tipo = tipoSel.value; redibujar(); };
  $('[data-a=mas]', caja).onclick = () => { const u = cu.puntos[cu.puntos.length - 1] || [0, 0]; cu.puntos.push([u[0] + (u[0] || 10), u[1]]); filas(); };
  $('[data-a=pegar]', caja).onclick = () => {
    const t = h('<div><p class="sub">Pega dos columnas de Excel (X y Y). Reemplaza todos los puntos.</p><textarea rows="8" style="width:100%" class="mono"></textarea></div>');
    modal({ titulo: `Pegar puntos en ${cu.id}`, chico: true, cuerpo: t, botones: [{ texto: 'Cancelar' }, { texto: 'Usar estos puntos', clase: 'prim', accion: () => {
      const v = numeros($('textarea', t).value);
      if (v.length < 2 || v.length % 2) { aviso('Hacen falta parejas de números (X y Y).', 'error'); return false; }
      cu.puntos = []; for (let j = 0; j < v.length; j += 2) cu.puntos.push([v[j], v[j + 1]]);
      filas(); return undefined;
    } }] });
  };
  $('[data-a=guardar]', caja).onclick = async () => {
    if (cu.puntos.some((p) => !p.every(Number.isFinite))) { aviso('Hay puntos sin número.', 'error'); return; }
    if (await editar({ op: 'curva', id: cu.id, puntos: cu.puntos, tipo: cu.tipo }, `Curva ${cu.id} ${cu.nuevo ? 'creada' : 'guardada'}.`)) cu.nuevo = false;
  };
  const b = $('[data-a=borrar]', caja);
  if (b) b.onclick = async () => { if (await editar({ op: 'curva', id: cu.id, puntos: null }, `Curva ${cu.id} borrada.`)) sel.curvas = null; };
  return caja;
}

// ====================================================================== controles
function tControles(c) {
  c.append(h(`<p class="sub" style="margin:0 0 10px">Controles simples: cambian un tramo cuando un tanque o nudo pasa de un valor, a cierta hora de la simulación o a cierta hora del día. Uno por línea.</p>`));
  c.append(h(`<details class="tarjeta" style="padding:8px 12px"><summary><b>Cómo se escriben</b></summary><div class="mono detalle">
    LINK 12 CLOSED IF NODE T1 ABOVE 4.5<br>LINK 12 OPEN IF NODE T1 BELOW 1.2<br>LINK B1 OPEN AT TIME 6:00<br>LINK V3 35 AT CLOCKTIME 6 AM</div>
    <p class="detalle">El valor del nudo es el nivel si es un tanque y la presión si es un nudo. En lugar de OPEN o CLOSED se puede poner un número: la consigna de una válvula o la velocidad relativa de una bomba.</p></details>`));
  const ta = h(`<textarea class="mono" spellcheck="false" style="width:100%;margin-top:8px" rows="${Math.min(24, Math.max(6, D.controles.length + 2))}"></textarea>`);
  ta.value = D.controles.join('\n');
  c.append(ta);
  const acc = h('<div class="acciones fila" style="margin-top:8px"><button class="btn prim" data-a="guardar">Guardar controles</button><button class="btn" data-a="agregar">Agregar uno…</button><span class="sub" style="margin:0"></span></div>');
  c.append(acc);
  const cuenta = () => { $('span', acc).textContent = `${ta.value.split('\n').filter((x) => x.trim()).length} controles`; };
  ta.oninput = cuenta; cuenta();
  $('[data-a=guardar]', acc).onclick = () => editar({ op: 'controles', lineas: ta.value.split('\n') }, 'Controles guardados.');
  $('[data-a=agregar]', acc).onclick = async () => {
    const v = await formulario('Control nuevo', [
      { id: 'tramo', etiqueta: 'Tramo que cambia (ID)', valor: '' },
      { id: 'accion', etiqueta: 'Qué hace', opciones: [{ v: 'OPEN', t: 'Abrir o prender' }, { v: 'CLOSED', t: 'Cerrar o apagar' }, { v: 'VALOR', t: 'Poner una consigna o velocidad' }] },
      { id: 'valor', etiqueta: 'Consigna o velocidad (si eligió eso)', tipo: 'number', valor: '' },
      { id: 'cuando', etiqueta: 'Cuándo', opciones: [{ v: 'ABOVE', t: 'Cuando un tanque o nudo sube de…' }, { v: 'BELOW', t: 'Cuando un tanque o nudo baja de…' }, { v: 'TIME', t: 'A una hora de la simulación' }, { v: 'CLOCKTIME', t: 'A una hora del día' }] },
      { id: 'nudo', etiqueta: 'Tanque o nudo (si es por nivel o presión)', valor: '' },
      { id: 'limite', etiqueta: 'Nivel, presión u hora (6:00, o 6 AM para hora del día)', valor: '' },
    ], 'Agregar');
    if (!v || !v.tramo.trim()) return;
    const que = v.accion === 'VALOR' ? (v.valor ?? 0) : v.accion;
    const cond = ['ABOVE', 'BELOW'].includes(v.cuando) ? `IF NODE ${v.nudo.trim()} ${v.cuando} ${v.limite.trim()}` : `AT ${v.cuando} ${v.limite.trim()}`;
    ta.value = `${ta.value.trim() ? `${ta.value.trimEnd()}\n` : ''}LINK ${v.tramo.trim()} ${que} ${cond}`;
    cuenta();
    aviso('Control agregado al texto. Revísalo y dale Guardar controles.');
  };
}

// ====================================================================== reglas
function tReglas(c) {
  c.append(h(`<p class="sub" style="margin:0 0 10px">Reglas con condiciones combinadas (IF … AND/OR … THEN … ELSE … PRIORITY). Este modelo tiene ${n(D.n_reglas, 0)}.</p>`));
  c.append(h(`<details class="tarjeta" style="padding:8px 12px"><summary><b>Cómo se escriben</b></summary><div class="mono detalle">
    RULE LLENAR_T1<br>IF TANK T1 LEVEL BELOW 1.5<br>AND SYSTEM CLOCKTIME &gt;= 5 AM<br>THEN PUMP B1 STATUS IS OPEN<br>ELSE PUMP B1 STATUS IS CLOSED<br>PRIORITY 2</div>
    <p class="detalle">Objetos: TANK, JUNCTION (o NODE), PIPE, PUMP, VALVE y SYSTEM. Atributos: LEVEL, PRESSURE, HEAD, DEMAND, FLOW, STATUS, SETTING, TIME, CLOCKTIME. Comparaciones: = &lt;&gt; &lt; &gt; &lt;= &gt;= o ABOVE, BELOW, IS. La regla de mayor prioridad gana cuando dos chocan.</p></details>`));
  const ta = h('<textarea class="mono" spellcheck="false" style="width:100%;margin-top:8px" rows="18"></textarea>');
  ta.value = D.reglas;
  c.append(ta);
  const acc = h('<div class="acciones fila" style="margin-top:8px"><button class="btn prim" data-a="guardar">Guardar reglas</button><button class="btn" data-a="plantilla">Agregar una plantilla</button></div>');
  c.append(acc);
  $('[data-a=guardar]', acc).onclick = () => editar({ op: 'reglas', texto: ta.value }, 'Reglas guardadas.');
  $('[data-a=plantilla]', acc).onclick = () => {
    const k = (ta.value.match(/^\s*RULE\s/gim) || []).length + 1;
    ta.value = `${ta.value.trimEnd()}${ta.value.trim() ? '\n\n' : ''}RULE NUEVA_${k}\nIF TANK T1 LEVEL BELOW 1.5\nTHEN PUMP B1 STATUS IS OPEN\nPRIORITY 1`;
    ta.scrollTop = ta.scrollHeight; ta.focus();
    aviso('Plantilla agregada al final: cambia los IDs y valores, y dale Guardar reglas.');
  };
}

// ====================================================================== rótulos
function tRotulos(c) {
  const lista = (D.rotulos || []).map((r) => [...r]);
  c.append(h('<p class="sub" style="margin:0 0 10px">Textos sobre el mapa ([LABELS]). Se ponen con la herramienta Rótulo (L) de Editar red; aquí se cambian o se quitan.</p>'));
  const t = h('<table class="tabla"><tr><th>Texto</th><th class="n">X</th><th class="n">Y</th><th></th></tr></table>');
  if (!lista.length) c.append(h('<div class="vacio">Este modelo no tiene rótulos.</div>'));
  lista.forEach((r, j) => {
    const tr = h(`<tr><td><input value="${esc(r[2])}" style="width:100%"></td><td class="n">${n(r[0], 0)}</td><td class="n">${n(r[1], 0)}</td><td><button class="btn chico" title="Quitar">×</button></td></tr>`);
    $('input', tr).oninput = (e) => { r[2] = e.target.value; };
    $('button', tr).onclick = () => { lista.splice(j, 1); tr.remove(); };
    t.append(tr);
  });
  if (lista.length) {
    c.append(t);
    const acc = h('<div class="acciones fila" style="margin-top:8px"><button class="btn prim">Guardar rótulos</button></div>');
    $('button', acc).onclick = () => editar({ op: 'rotulos', lista }, 'Rótulos guardados.');
    c.append(acc);
  }
}

// ====================================================================== opciones
function tOpciones(c) {
  const O = D.opciones, Ti = D.tiempos, R = D.reacciones, E = D.energia, sis = D.sistema;
  const ayuda = (k) => S.textos?.opciones?.[k] || '';
  const tarjeta = (titulo, sub) => { const t = h(`<div class="tarjeta"><h3>${esc(titulo)}</h3>${sub ? `<p style="margin:0 0 8px">${esc(sub)}</p>` : ''}<div class="opciones-d"></div></div>`); c.append(t); return $('.opciones-d', t); };
  const guardar = (seccion, clave, valor) => editar({ op: 'opcion', seccion, clave, valor: String(valor ?? '').trim() }, `${clave}: ${String(valor ?? '').trim() || 'valor por defecto'}.`);
  const campo = (dest, seccion, clave, etiqueta, valor, { tipo = 'text', opciones = null, defecto = '', solo = false } = {}) => {
    const l = h(`<label class="campo"><span>${esc(etiqueta)} ${ayuda(clave) ? `<i class="ayuda" tabindex="0" data-t="${esc(ayuda(clave))}">?</i>` : ''}</span></label>`);
    let x;
    if (opciones) x = h(`<select ${solo ? 'disabled' : ''}>${opciones.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('')}</select>`);
    else x = h(`<input type="${tipo}" ${tipo === 'number' ? 'step="any"' : ''} ${solo ? 'disabled' : ''} placeholder="${esc(defecto)}">`);
    x.value = valor ?? '';
    if (opciones && valor && !opciones.some(([v]) => v.toUpperCase() === String(valor).toUpperCase())) x.append(h(`<option value="${esc(valor)}">${esc(valor)}</option>`));
    if (opciones) x.value = opciones.find(([v]) => v.toUpperCase() === String(valor ?? '').toUpperCase())?.[0] ?? valor ?? '';
    x.onchange = () => guardar(seccion, clave, x.value);
    l.append(x); dest.append(l);
    return x;
  };
  const pats = [['', '(ninguno)'], ...Object.keys(D.patrones).map((p) => [p, p])];

  let d = tarjeta('Unidades', 'Salen del archivo. Cambiarlas no convierte los números ya escritos, por eso aquí solo se muestran.');
  campo(d, '[OPTIONS]', 'UNITS', 'Caudal', `${sis.codigo_caudal} · ${sis.caudal}`, { solo: true });
  campo(d, '[OPTIONS]', 'HEADLOSS', 'Fórmula de pérdidas', { 'H-W': 'Hazen-Williams', 'D-W': 'Darcy-Weisbach', 'C-M': 'Chezy-Manning' }[sis.headloss] || sis.headloss, { solo: true });

  d = tarjeta('Demandas');
  campo(d, '[OPTIONS]', 'DEMAND MULTIPLIER', 'Multiplicador de demandas', O['DEMAND MULTIPLIER'], { tipo: 'number', defecto: '1' });
  campo(d, '[OPTIONS]', 'PATTERN', 'Patrón por defecto', O.PATTERN, { opciones: pats });
  const dm = campo(d, '[OPTIONS]', 'DEMAND MODEL', 'Modelo de demanda', O['DEMAND MODEL'] || 'DDA', { opciones: [['DDA', 'DDA · la demanda se entrega siempre'], ['PDA', 'PDA · depende de la presión']] });
  if ((O['DEMAND MODEL'] || '').toUpperCase() === 'PDA') {
    campo(d, '[OPTIONS]', 'MINIMUM PRESSURE', `Presión mínima (${U('presion')})`, O['MINIMUM PRESSURE'], { tipo: 'number', defecto: '0' });
    campo(d, '[OPTIONS]', 'REQUIRED PRESSURE', `Presión requerida (${U('presion')})`, O['REQUIRED PRESSURE'], { tipo: 'number', defecto: '0.1' });
    campo(d, '[OPTIONS]', 'PRESSURE EXPONENT', 'Exponente de presión', O['PRESSURE EXPONENT'], { tipo: 'number', defecto: '0.5' });
  }
  void dm;
  campo(d, '[OPTIONS]', 'EMITTER EXPONENT', 'Exponente de emisores', O['EMITTER EXPONENT'], { tipo: 'number', defecto: '0.5' });

  d = tarjeta('Convergencia');
  campo(d, '[OPTIONS]', 'TRIALS', 'Iteraciones máximas', O.TRIALS, { tipo: 'number', defecto: '200' });
  campo(d, '[OPTIONS]', 'ACCURACY', 'Precisión', O.ACCURACY, { tipo: 'number', defecto: '0.001' });
  campo(d, '[OPTIONS]', 'UNBALANCED', 'Si no converge', O.UNBALANCED, { defecto: 'STOP · CONTINUE · CONTINUE 10' });
  campo(d, '[OPTIONS]', 'CHECKFREQ', 'Revisar estados cada', O.CHECKFREQ, { tipo: 'number', defecto: '2' });
  campo(d, '[OPTIONS]', 'MAXCHECK', 'Revisar estados hasta la iteración', O.MAXCHECK, { tipo: 'number', defecto: '10' });
  campo(d, '[OPTIONS]', 'DAMPLIMIT', 'Amortiguar desde', O.DAMPLIMIT, { tipo: 'number', defecto: '0' });
  campo(d, '[OPTIONS]', 'HEADERROR', `Error de carga máximo (${U('carga')})`, O.HEADERROR, { tipo: 'number', defecto: '0' });
  campo(d, '[OPTIONS]', 'FLOWCHANGE', `Cambio de caudal máximo (${U('caudal')})`, O.FLOWCHANGE, { tipo: 'number', defecto: '0' });
  campo(d, '[OPTIONS]', 'SPECIFIC GRAVITY', 'Densidad relativa', O['SPECIFIC GRAVITY'], { tipo: 'number', defecto: '1' });
  campo(d, '[OPTIONS]', 'VISCOSITY', 'Viscosidad relativa', O.VISCOSITY, { tipo: 'number', defecto: '1' });

  d = tarjeta('Tiempos', 'En horas y minutos (1:00, 0:15) o con unidad (30 MIN).');
  [['DURATION', 'Duración', '0:00'], ['HYDRAULIC TIMESTEP', 'Paso hidráulico', '1:00'], ['PATTERN TIMESTEP', 'Paso de los patrones', '1:00'], ['PATTERN START', 'Inicio de los patrones', '0:00'],
    ['REPORT TIMESTEP', 'Paso de los resultados', '1:00'], ['REPORT START', 'Resultados desde', '0:00'], ['START CLOCKTIME', 'Hora del día al empezar', '12 AM'],
    ['QUALITY TIMESTEP', 'Paso de la calidad', '0:05'], ['RULE TIMESTEP', 'Paso de las reglas', '0:06']].forEach(([k, t, def]) => campo(d, '[TIMES]', k, t, Ti[k], { defecto: def }));
  campo(d, '[TIMES]', 'STATISTIC', 'Estadística del reporte', Ti.STATISTIC || 'NONE', { opciones: [['NONE', 'Ninguna'], ['AVERAGED', 'Promedio'], ['MINIMUM', 'Mínimo'], ['MAXIMUM', 'Máximo'], ['RANGE', 'Rango']] });

  d = tarjeta('Calidad del agua', 'Las fuentes, la calidad inicial y las reacciones de cada elemento se ponen en su ficha.');
  const q = String(O.QUALITY || 'NONE').trim(), q0 = q.split(/\s+/)[0].toUpperCase();
  const tipoQ = ['NONE', 'AGE', 'TRACE'].includes(q0) ? q0 : 'CHEMICAL';
  const lq = h(`<label class="campo"><span>Qué se calcula <i class="ayuda" tabindex="0" data-t="${esc(ayuda('QUALITY'))}">?</i></span><select>
      <option value="NONE">Nada (solo hidráulica)</option><option value="CHEMICAL">Un químico (cloro, por ejemplo)</option><option value="AGE">Edad del agua</option><option value="TRACE">Rastreo desde un nudo</option></select></label>`);
  d.append(lq);
  const sq = $('select', lq); sq.value = tipoQ;
  const extraQ = h('<div class="fila"></div>'); d.append(extraQ);
  const pintarQ = () => {
    extraQ.innerHTML = '';
    if (sq.value === 'CHEMICAL') {
      const partes = tipoQ === 'CHEMICAL' ? q.split(/\s+/) : ['Cloro', 'mg/L'];
      const nom = h(`<label>Nombre<input value="${esc(partes[0] || 'Cloro')}"></label>`), un = h('<label>Unidades<select><option>mg/L</option><option>ug/L</option></select></label>');
      $('select', un).value = /ug/i.test(partes[1] || '') ? 'ug/L' : 'mg/L';
      const ok = h('<button class="btn chico prim" style="align-self:flex-end">Aplicar</button>');
      ok.onclick = () => guardar('[OPTIONS]', 'QUALITY', `${$('input', nom).value.trim().replace(/\s+/g, '_') || 'Cloro'} ${$('select', un).value}`);
      extraQ.append(nom, un, ok);
    } else if (sq.value === 'TRACE') {
      const nd = h(`<label>Nudo de origen<input value="${esc(tipoQ === 'TRACE' ? q.split(/\s+/)[1] || '' : '')}"></label>`);
      const ok = h('<button class="btn chico prim" style="align-self:flex-end">Aplicar</button>');
      ok.onclick = () => { const v = $('input', nd).value.trim(); if (!v) { aviso('Falta el nudo de origen.', 'error'); return; } guardar('[OPTIONS]', 'QUALITY', `TRACE ${v}`); };
      extraQ.append(nd, ok);
    }
  };
  sq.onchange = () => { pintarQ(); if (['NONE', 'AGE'].includes(sq.value)) guardar('[OPTIONS]', 'QUALITY', sq.value); };
  pintarQ();
  campo(d, '[OPTIONS]', 'DIFFUSIVITY', 'Difusividad relativa', O.DIFFUSIVITY, { tipo: 'number', defecto: '1' });
  campo(d, '[OPTIONS]', 'TOLERANCE', 'Tolerancia de calidad', O.TOLERANCE, { tipo: 'number', defecto: '0.01' });

  d = tarjeta('Reacciones', 'Valores globales; cada tubería o tanque puede tener el suyo en su ficha. Negativo = decae.');
  [['ORDER BULK', 'Orden en el agua', '1'], ['ORDER WALL', 'Orden en la pared (0 o 1)', '1'], ['ORDER TANK', 'Orden en tanques', '1'], ['GLOBAL BULK', 'Coeficiente en el agua (1/día)', '0'],
    ['GLOBAL WALL', 'Coeficiente en la pared', '0'], ['LIMITING POTENTIAL', 'Concentración límite', '0'], ['ROUGHNESS CORRELATION', 'Correlación con la rugosidad', '0']]
    .forEach(([k, t, def]) => campo(d, '[REACTIONS]', k, t, R[k], { tipo: 'number', defecto: def }));

  d = tarjeta('Energía', 'Para el informe de energía de las bombas.');
  campo(d, '[ENERGY]', 'GLOBAL EFFICIENCY', 'Eficiencia de las bombas sin curva (%)', E['GLOBAL EFFICIENCY'], { tipo: 'number', defecto: '75' });
  campo(d, '[ENERGY]', 'GLOBAL PRICE', 'Precio de la energía (por kWh)', E['GLOBAL PRICE'], { tipo: 'number', defecto: '0' });
  campo(d, '[ENERGY]', 'GLOBAL PATTERN', 'Patrón del precio', E['GLOBAL PATTERN'], { opciones: pats });
  campo(d, '[ENERGY]', 'DEMAND CHARGE', 'Cargo por potencia máxima (por kW)', E['DEMAND CHARGE'], { tipo: 'number', defecto: '0' });
}
