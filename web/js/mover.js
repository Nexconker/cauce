// Mover con coordenadas (herramienta Mover): un clic en un nudo, o en una bomba o válvula, abre una ficha flotante.
// Se elige un origen (el mismo objeto, otro nudo o un punto del mapa, en 2D o en 3D) y se escribe desde ahí cuánto
// se corre: ΔX (este), ΔY (norte) y ΔZ (cota), o directamente dónde queda. Una bomba o válvula se mueve entera: sus
// dos nudos a la vez (su punto de referencia es la mitad entre ellos). El destino se ve en el mapa mientras se
// escribe. Todo va en una sola edición (op varias), así que Ctrl+Z la deshace entera.
import { S, bus, h, n, esc, $, U, aviso, fallo, post, longitudAuto } from './estado.js';
import { mapa } from './mapa.js';

// M = {clase: 'nudo'|'tramo', id, nombre, nudos: [{id, x, y, z}], ref: {x, y, z}, o: {x, y, z, texto}, t: {x, y, z},
//      esperando, equipo (si es un nudo de una bomba o válvula: el ID de ese tramo)}
let M = null;

export const moverAbierto = () => !!M;
export const esperandoOrigen = () => !!M?.esperando;
const r3 = (v) => Math.round(v * 1000) / 1000;
const TIPO = { PUMP: 'la bomba', PRV: 'la válvula', PSV: 'la válvula', PBV: 'la válvula', FCV: 'la válvula', TCV: 'la válvula', GPV: 'la válvula', PIPE: 'la tubería', CV: 'la tubería' };
const esEquipo = (k) => !['PIPE', 'CV'].includes(S.M.tramos.tipo[k]);

function cotaCercana(x, y) {
  const N = S.M.nudos; let mejor = null, d = Infinity;
  for (let i = 0; i < N.id.length; i++) {
    if (N.x[i] === null || N.tipo[i] !== 0 || Math.abs(N.cota[i]) < 1) continue;
    const dd = Math.hypot(N.x[i] - x, N.y[i] - y);
    if (dd < d) { d = dd; mejor = N.cota[i]; }
  }
  return mejor ?? 0;
}
const datosNudo = (i) => ({ id: S.M.nudos.id[i], x: S.M.nudos.x[i], y: S.M.nudos.y[i], z: S.M.nudos.cota[i] });
// el tramo de bomba o válvula que toca un nudo (para ofrecer moverlo entero)
function equipoDe(i) {
  const L = S.M.tramos;
  for (let k = 0; k < L.id.length; k++) if ((L.n1[k] === i || L.n2[k] === i) && esEquipo(k)) return k;
  return -1;
}

function empezar(obj) {
  const r = obj.ref;
  M = { ...obj, o: { x: r.x, y: r.y, z: r.z, texto: `${obj.nombre} (el mismo)` }, t: { x: r.x, y: r.y, z: r.z }, esperando: false };
  pintar();
  vista();
  setTimeout(() => { const d = $('#mp-dx'); d?.focus(); d?.select(); }, 30);
}
export function abrirMover(i) {
  const N = S.M.nudos;
  if (N.x[i] === null) { aviso('Ese nudo no tiene coordenadas.', 'error'); return; }
  const k = equipoDe(i);
  empezar({ clase: 'nudo', id: N.id[i], nombre: N.id[i], tipoNudo: N.tipo[i], nudos: [datosNudo(i)], ref: datosNudo(i), equipo: k >= 0 ? k : null });
}
export function abrirMoverTramo(k) {
  const L = S.M.tramos, a = L.n1[k], b = L.n2[k];
  if (S.M.nudos.x[a] === null || S.M.nudos.x[b] === null) { aviso('A ese tramo le faltan coordenadas.', 'error'); return; }
  const A = datosNudo(a), B = datosNudo(b);
  empezar({ clase: 'tramo', id: L.id[k], nombre: L.id[k], tipoTramo: L.tipo[k], nudos: [A, B],
    ref: { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2, z: (A.z + B.z) / 2 } });
}
export function cerrarMover() {
  if (!M) return;
  M = null;
  const c = document.getElementById('mover-p'); if (c) c.hidden = true;
  S.moverPreciso = null;
  mapa.pedir(); bus.emit('mover-preciso');
}
bus.on('herramienta', (hta) => { if (hta !== 'mover') cerrarMover(); });

// el clic en el mapa (2D o 3D) mientras se elige el origen
export function ponerOrigen(p) {
  if (!M) return;
  const N = S.M.nudos;
  if (p.clase === 'nudo') M.o = { x: N.x[p.i], y: N.y[p.i], z: N.cota[p.i], texto: M.clase === 'nudo' && N.id[p.i] === M.id ? `${M.id} (el mismo)` : `nudo ${N.id[p.i]}` };
  else if (p.x !== undefined) M.o = { x: p.x, y: p.y, z: cotaCercana(p.x, p.y), texto: p.clase === 'tramo' ? `punto sobre ${S.M.tramos.id[p.i]}` : 'punto del mapa' };
  else return;
  M.esperando = false;
  // el destino no cambia al cambiar el origen: lo que cambia es cómo se escribe (los Δ)
  pintar();
  vista();
  setTimeout(() => { const d = $('#mp-dx'); d?.focus(); d?.select(); }, 30);
}

function caja() {
  let c = document.getElementById('mover-p');
  if (!c) {
    c = h('<div id="mover-p" class="flota" role="dialog" aria-label="Mover con coordenadas" hidden></div>');
    document.getElementById('mapa-caja').append(c);
  }
  return c;
}
function titulo() {
  if (M.clase === 'tramo') return `Mover ${TIPO[M.tipoTramo] || 'el tramo'} ${M.id}`;
  return `Mover ${M.id}`;
}
function pintar() {
  const c = caja(), ul = U('longitud');
  const zn = M.clase === 'tramo' ? 'cota' : ({ 1: 'carga', 2: 'fondo' }[M.tipoNudo] || 'cota');
  const L = S.M.tramos;
  c.hidden = false;
  c.innerHTML = `<div class="mp-cab"><b>${esc(titulo())} con coordenadas</b><button class="x" aria-label="Cerrar" title="Cerrar (Esc)">×</button></div>
    ${M.clase === 'tramo' ? `<p class="mp-nota">Se mueven sus dos nudos (${esc(M.nudos[0].id)} y ${esc(M.nudos[1].id)}); las coordenadas son las de la mitad entre ellos.</p>` : ''}
    ${M.clase === 'nudo' && M.equipo !== null ? `<p class="mp-nota">Este nudo es de ${esc(TIPO[L.tipo[M.equipo]] || 'el tramo')} ${esc(L.id[M.equipo])}. <button class="enlace" data-a="equipo">Mover ${esc(TIPO[L.tipo[M.equipo]] || 'el tramo')} entera</button></p>` : ''}
    <div class="mp-orig"><span class="et">Origen</span><span class="v">${esc(M.o.texto)}</span>
      <button class="btn chico ${M.esperando ? 'on' : ''}" data-a="elegir">${M.esperando ? 'Haz clic en el mapa…' : 'Elegir en el mapa'}</button>
      ${M.o.texto.endsWith('(el mismo)') ? '' : '<button class="btn chico" data-a="mismo">El mismo</button>'}</div>
    <div class="mp-oxyz">X ${n(M.o.x, 2)} · Y ${n(M.o.y, 2)} · Z ${n(M.o.z, 2)} ${esc(ul)}</div>
    <div class="mp-t">Desde el origen (${esc(ul)})</div>
    <div class="mp-rej">
      <label><span>ΔX <small>este</small></span><input id="mp-dx" type="number" step="any"></label>
      <label><span>ΔY <small>norte</small></span><input id="mp-dy" type="number" step="any"></label>
      <label><span>ΔZ <small>${zn}</small></span><input id="mp-dz" type="number" step="any"></label>
    </div>
    <div class="mp-t">Queda en (${esc(ul)})</div>
    <div class="mp-abs">
      <label><span>X <small>este</small></span><input id="mp-x" type="number" step="any"></label>
      <label><span>Y <small>norte</small></span><input id="mp-y" type="number" step="any"></label>
      <label><span>Z <small>${zn}</small></span><input id="mp-z" type="number" step="any"></label>
    </div>
    <p class="mp-info" id="mp-info"></p>
    <div class="acciones"><button class="btn prim" data-a="ok">Mover</button><button class="btn" data-a="no">Cancelar</button></div>`;
  const campo = (k) => $(`#mp-${k}`, c);
  const llenar = (excepto) => {
    const d = { dx: M.t.x - M.o.x, dy: M.t.y - M.o.y, dz: M.t.z - M.o.z, x: M.t.x, y: M.t.y, z: M.t.z };
    Object.entries(d).forEach(([k, v]) => { if (k !== excepto) campo(k).value = r3(v); });
    info();
  };
  const leer = (k) => { const v = Number(campo(k).value); return Number.isFinite(v) ? v : null; };
  ['dx', 'dy', 'dz'].forEach((k) => {
    campo(k).oninput = () => { const v = leer(k); if (v === null) return; const eje = k[1]; M.t[eje] = M.o[eje] + v; llenar(k); vista(); };
  });
  ['x', 'y', 'z'].forEach((k) => {
    campo(k).oninput = () => { const v = leer(k); if (v === null) return; M.t[k] = v; llenar(k); vista(); };
  });
  c.onkeydown = (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); aplicar(); }
    if (e.key === 'Escape') { e.stopPropagation(); if (M.esperando) { M.esperando = false; pintar(); } else cerrarMover(); }
  };
  $('.x', c).onclick = cerrarMover;
  $('[data-a=no]', c).onclick = cerrarMover;
  $('[data-a=ok]', c).onclick = aplicar;
  $('[data-a=elegir]', c).onclick = () => {
    M.esperando = !M.esperando; pintar();
    if (M.esperando) aviso('Haz clic en el nudo o el punto que será el origen. Esc cancela.');
  };
  const mismo = $('[data-a=mismo]', c);
  if (mismo) mismo.onclick = () => { M.o = { ...M.ref, texto: `${M.nombre} (el mismo)` }; pintar(); vista(); };
  const eq = $('[data-a=equipo]', c);
  if (eq) eq.onclick = () => abrirMoverTramo(M.equipo);
  llenar();
}
function info() {
  const p = $('#mp-info');
  if (!p) return;
  const dx = M.t.x - M.ref.x, dy = M.t.y - M.ref.y, dz = M.t.z - M.ref.z, ul = U('longitud');
  const plano = Math.hypot(dx, dy);
  if (plano < 1e-9 && Math.abs(dz) < 1e-9) { p.textContent = 'Todavía en su sitio.'; return; }
  const rumbo = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  const partes = [];
  if (plano >= 1e-9) partes.push(`se corre ${n(plano, 2)} ${ul} en planta (rumbo ${n(rumbo, 0)}°)`);
  if (Math.abs(dz) >= 1e-9) partes.push(`${dz > 0 ? 'sube' : 'baja'} ${n(Math.abs(dz), 2)} ${ul}`);
  p.textContent = `Desde donde está ${partes.join(' y ')}.`;
}
// el destino en el mapa 2D y en el 3D: desde el punto de referencia (el nudo o la mitad del tramo)
function vista() {
  S.moverPreciso = M ? { desde: { ...M.ref }, x: M.t.x, y: M.t.y, z: M.t.z, ox: M.o.x, oy: M.o.y, oz: M.o.z } : null;
  mapa.pedir(); bus.emit('mover-preciso');
}

// corre unos nudos (dx, dy, dz) en una sola edición; lo usan la ficha y el arrastre de bombas y válvulas en 3D
export async function desplazar(ids, dx, dy, dz, nombre) {
  const N = S.M.nudos, ops = [];
  for (const id of ids) {
    const i = S.idxN.get(id);
    if (i === undefined) { aviso(`${id} ya no está en el modelo.`, 'error'); return false; }
    if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) ops.push({ op: 'mover', id, x: N.x[i] + dx, y: N.y[i] + dy, ...(longitudAuto() ? { longitud: true } : {}) });
    if (Math.abs(dz) > 1e-9) ops.push({ op: 'propiedad', tipo: 'nudo', id, campo: 'cota', valor: r3(N.cota[i] + dz) });
  }
  if (!ops.length) { aviso('Ya está ahí: no hay nada que mover.'); return false; }
  const op = ops.length === 1 ? ops[0] : { op: 'varias', nombre, ops };
  try {
    const r = await post(`/api/doc/${S.doc}/editar`, { op });
    (r.avisos || []).forEach((a) => aviso(a));
    bus.emit('recargar', { mantener: true });
    return true;
  } catch (e) { fallo(e); return false; }
}

async function aplicar() {
  if (!M) return;
  const { x, y, z } = M.t;
  if (![x, y, z].every(Number.isFinite)) { aviso('Hay coordenadas sin número.', 'error'); return; }
  // los Δ salen de dónde está ahora el punto de referencia (por si algo cambió mientras la ficha estaba abierta)
  const ahora = M.nudos.map((d) => { const i = S.idxN.get(d.id); return i === undefined ? null : datosNudo(i); });
  if (ahora.some((d) => !d)) { aviso('Uno de los nudos ya no está en el modelo.', 'error'); cerrarMover(); return; }
  const ref = { x: ahora.reduce((s, d) => s + d.x, 0) / ahora.length, y: ahora.reduce((s, d) => s + d.y, 0) / ahora.length, z: ahora.reduce((s, d) => s + d.z, 0) / ahora.length };
  const nombre = `Mover ${M.clase === 'tramo' ? `${TIPO[M.tipoTramo] || 'el tramo'} ` : ''}${M.id} a X ${r3(x)}, Y ${r3(y)}, Z ${r3(z)}`;
  const etiqueta = titulo().replace(/^Mover /, '');
  if (await desplazar(ahora.map((d) => d.id), x - ref.x, y - ref.y, z - ref.z, nombre)) {
    aviso(`${etiqueta[0].toUpperCase()}${etiqueta.slice(1)} movid${M.clase === 'tramo' ? 'a' : 'o'}. Ctrl+Z lo deshace.`, 'ok');
    cerrarMover();
  }
}
