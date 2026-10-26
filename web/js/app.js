// Arranque de Cauce: pestañas de modelos, bienvenida, buscador, barra de tiempo y herramientas de edición.
import { S, bus, get, post, esc, n, h, hora, aviso, fallo, modal, formulario, explorar, $, $$, nombreNudo, nombreTramo, claseTexto, U, nombreEscenario, nombreCalidad, longitudAuto } from './estado.js';
import { mapa, leyenda } from './mapa.js';
import { mostrarPanel, panelActual, revisar, usarCorrida, cargarVariable, quitarResaltado, guardar } from './paneles.js';
import { mostrarInspector, cerrarInspector } from './inspector.js';
import { edicionGrupo } from './informes.js';
import { alternar3d, estaAbierta, cerrar3d } from './vista3d.js';
import { abrirMover, abrirMoverTramo, cerrarMover, esperandoOrigen, ponerOrigen } from './mover.js';

// ====================================================================== modelos abiertos
async function refrescarDocs() {
  const e = await get('/api/estado');
  if (e.actualizacion) aviso(`Cauce se actualizó a la versión ${e.actualizacion.a} (antes ${e.actualizacion.de}).`, 'ok');
  S.docs = e.docs;
  S.recientes = e.recientes;
  pintarPestanas();
  return e;
}
function pintarPestanas() {
  const c = $('#pestanas'); c.innerHTML = '';
  S.docs.forEach((d) => {
    const b = h(`<button class="pestana ${d.id === S.doc ? 'activa' : ''}" role="tab" title="${esc(d.ruta)}"><span class="nom">${esc(d.nombre)}</span>
      ${d.cambios && !d.propio ? `<span class="esc">${esc(nombreEscenario(d))}</span>` : ''}<span class="x ${d.sin_guardar ? 'mod' : ''}" title="${d.sin_guardar ? 'Cambios sin guardar · Cerrar' : 'Cerrar'}">×</span></button>`);
    b.onclick = (e) => { if (e.target.classList.contains('x')) { e.stopPropagation(); cerrarDoc(d.id); } else activar(d.id); };
    c.append(b);
  });
}
async function abrir(ruta) {
  try {
    const info = await post('/api/abrir', { ruta });
    await refrescarDocs();
    await activar(info.id);
    aviso(`Abierto ${info.nombre}`, 'ok');
  } catch (e) { fallo(e); }
}
async function cerrarDoc(id) {
  const d = S.docs.find((x) => x.id === id);
  if (d?.sin_guardar && !(await confirmarCambios([d], 'cerrar'))) return;
  await post('/api/cerrar', { id });
  delete S.ultima[id]; delete S.trabajos[id]; delete S.progresos[id];
  if (S.doc === id) { S.doc = null; S.M = null; S.corrida = null; S.resumen = null; S.res = {}; S.comparacion = null; }
  await refrescarDocs();
  if (!S.doc && S.docs.length) await activar(S.docs[S.docs.length - 1].id);
  else if (!S.doc) { bienvenida(); mostrarPanel('modelo'); }
}
async function activar(id) {
  const cambia = S.doc !== id;
  S.doc = id;
  if (cambia) { S.corrida = null; S.resumen = null; S.res = {}; S.T = 0; S.comparacion = null; S.hallazgos = null; S.consignas = null; S.sel = null; S.resaltar = null; S.corridaComp = null; S.errorLectura = null; }
  document.body.classList.remove('sin-modelo');
  await cargarModelo(!cambia);
  // al volver a una pestaña se recupera la última corrida que se vio (o que terminó) en ese modelo; después de
  // recargar la página, la más reciente que el servidor tenga en memoria
  if (cambia) {
    let cid = S.ultima[id];
    if (!cid) {
      try { const cs = (await get('/api/corridas')).corridas.filter((c) => c.doc === id && c.fase !== 'fallo'); cid = cs.length ? cs[cs.length - 1].id : null; } catch (e) { /* sin lista */ }
    }
    if (cid && S.doc === id) await usarCorrida(cid).catch(() => { delete S.ultima[id]; });
  }
  pintarPestanas();
  $('#bienvenida').hidden = true;
  pintarLongitud();
  revisar().catch(() => {});
}
async function cargarModelo(mantener) {
  const r = await get(`/api/doc/${S.doc}/modelo`);
  S.M = r.modelo; S.info = r.info;
  S.idxN = new Map(S.M.nudos.id.map((x, i) => [x, i]));
  S.idxL = new Map(S.M.tramos.id.map((x, k) => [x, k]));
  if (S.sel) { const idv = S.selId; const i = S.sel.clase === 'nudo' ? S.idxN.get(idv) : S.idxL.get(idv); if (i === undefined) S.sel = null; else S.sel.i = i; }
  // los resultados se vuelven a pedir en el orden del modelo nuevo
  if (S.corrida) { const vs = Object.keys(S.res); S.res = {}; for (const v of vs) await cargarVariable(v).catch(() => {}); }
  mapa.cargar(S.M, mantener);
  if (!mantener) get(`/api/doc/${S.doc}/fondo`).then((r) => mapa.ponerFondo(r.fondo)).catch(() => mapa.ponerFondo(null));
  document.getElementById('p-esc').className = `punto ${S.info.cambios ? 'cambio' : ''}`;
  actualizarModos();
  mostrarPanel();
  if (S.sel) mostrarInspector(); else document.getElementById('inspector').hidden = true;
}
bus.on('recargar', async (o) => { try { await cargarModelo(o?.mantener ?? true); await refrescarDocs(); revisar(true).catch(() => {}); } catch (e) { fallo(e); } });
bus.on('info', (info) => { S.info = info; refrescarDocs(); });
bus.on('abrir', abrir);
bus.on('cerrar-doc', cerrarDoc);
bus.on('panel', (p) => { if (plegado()) plegar(false); mostrarPanel(p); });
bus.on('motor', (v) => { S.motor = v; localStorage.setItem('cauce-motor', v); $('#motor').value = v; });

// ====================================================================== cambios sin guardar y salida
// pregunta por cada modelo con cambios sin guardar (al cerrar su pestaña o al salir); false si el usuario cancela
async function confirmarCambios(lista, accion = 'salir') {
  const [verbo, si] = accion === 'cerrar' ? ['Cerrar', 'Si lo cierras'] : ['Salir', 'Si sales'];
  for (const d of lista) {
    const quien = d.propio || d.escenario === 'Sin cambios' ? 'Tiene cambios' : `El escenario «${esc(d.escenario)}» tiene cambios`;
    const nota = d.propio ? '' : '; el archivo .inp original no se toca';
    const r = await new Promise((resolver) => {
      let elegido = null;
      modal({ titulo: `¿Guardar los cambios de ${d.nombre}?`, chico: true,
        cuerpo: `<p>${quien} que no has guardado. ${si} sin guardar, se pierden${nota}.</p>`,
        botones: [{ texto: 'Cancelar' }, { texto: `${verbo} sin guardar`, clase: 'peligro', accion: () => { elegido = 'descartar'; } },
          { texto: d.archivo || d.propio ? 'Guardar' : 'Guardar…', clase: 'prim', accion: () => { elegido = 'guardar'; } }],
        alCerrar: () => resolver(elegido) });
    });
    if (!r) return false;
    if (r === 'guardar' && !(await guardar(true, d))) return false;
  }
  return true;
}
let saliendo = false, preguntandoSalida = false, latido = null;
async function salir() {
  if (preguntandoSalida) return;
  preguntandoSalida = true;
  try {
    try { await refrescarDocs(); } catch (e) { S.docs = []; /* el servidor ya no está: no queda nada que guardar */ }
    if (!(await confirmarCambios(S.docs.filter((d) => d.sin_guardar)))) return;
  } finally { preguntandoSalida = false; }
  saliendo = true;
  await Promise.all(S.docs.map((d) => post('/api/cerrar', { id: d.id }).catch(() => {})));
  clearInterval(latido);
  // la ventana propia (lanzar.pyw) se cierra desde Python; en Edge o Chrome, con window.close()
  if (window.pywebview?.api?.cerrar) { window.pywebview.api.cerrar(); return; }
  window.close();
  // en una pestaña normal del navegador no se deja cerrar por código
  setTimeout(() => {
    document.body.innerHTML = `<div class="despedida"><img src="marca/nex.svg" alt=""><h1>Cauce está cerrado</h1><p>Ya puedes cerrar esta pestaña.</p></div>`;
  }, 300);
}
// la X de la ventana propia llega aquí (lanzar.pyw cancela el cierre y llama esto): true = la página se encarga
window.cauceSalir = () => { salir(); return true; };
// la X en Edge o Chrome: pregunta el navegador (no deja poner una ventana propia en ese momento)
window.addEventListener('beforeunload', (e) => {
  if (saliendo || !S.docs.some((d) => d.sin_guardar)) return;
  e.preventDefault();
  e.returnValue = '';
});
async function guardarRapido() {
  const I = S.info;
  if (!S.doc || !I) return;
  if (!I.sin_guardar && (I.archivo || I.propio || !I.cambios)) { aviso(I.cambios || I.propio ? 'No hay cambios sin guardar.' : 'No hay cambios que guardar: es el archivo tal cual.'); return; }
  if (await guardar(true)) await refrescarDocs();
}

// ====================================================================== modelo nuevo, desde cero
// crea un .inp casi vacío (con las unidades y la fórmula elegidas) y lo abre con la edición puesta; ese archivo es
// "propio" de Cauce: Guardar escribe en él (los .inp que vienen de afuera nunca se sobrescriben)
async function nuevoModelo() {
  const v = await formulario('Modelo nuevo', [
    { id: 'titulo', etiqueta: 'Nombre', valor: '' },
    { id: 'unidades', etiqueta: 'Unidades de caudal (con ellas sale todo el sistema: longitudes, diámetros y presión)', opciones: [
      { v: 'LPS', t: 'LPS · litros por segundo (m, mm, presión en m)' }, { v: 'LPM', t: 'LPM · litros por minuto' },
      { v: 'CMH', t: 'CMH · metros cúbicos por hora' }, { v: 'CMD', t: 'CMD · metros cúbicos por día' },
      { v: 'MLD', t: 'MLD · millones de litros por día' }, { v: 'GPM', t: 'GPM · galones por minuto (ft, in, psi)' },
      { v: 'CFS', t: 'CFS · pies cúbicos por segundo' }, { v: 'MGD', t: 'MGD · millones de galones por día' }] },
    { id: 'perdidas', etiqueta: 'Fórmula de pérdidas', opciones: [{ v: 'H-W', t: 'Hazen-Williams (rugosidad C)' },
      { v: 'D-W', t: 'Darcy-Weisbach (rugosidad absoluta)' }, { v: 'C-M', t: 'Chezy-Manning (n de Manning)' }] },
  ], 'Elegir dónde guardarlo…');
  if (!v) return;
  const nombre = `${(v.titulo.trim() || 'Modelo nuevo').replace(/[\\/:*?"<>|]+/g, '_')}.inp`;
  const ruta = await explorar({ titulo: 'Dónde guardar el modelo nuevo', guardar: true, filtro: ['.inp'], nombre });
  if (!ruta) return;
  try {
    const info = await post('/api/nuevo', { ruta, titulo: v.titulo.trim(), unidades: v.unidades, perdidas: v.perdidas });
    await refrescarDocs();
    await activar(info.id);
    bus.emit('editar', true);
    aviso('Modelo nuevo listo. Empieza por un embalse (R) o un tanque (K) y conéctalo con tuberías (T); Ctrl+S lo guarda.', 'ok');
  } catch (e) { fallo(e); }
}

// ====================================================================== bienvenida
function bienvenida() {
  const b = $('#bienvenida');
  b.hidden = false;
  document.body.classList.add('sin-modelo');
  document.getElementById('p-rev').className = 'punto';
  document.getElementById('p-esc').className = 'punto';
  document.getElementById('herramientas').hidden = true;
  S.editando = false;
  document.getElementById('leyenda').innerHTML = '';
  // red pequeña: un embalse, dos tanques y el agua corriendo por las tuberías (solo en esta pantalla)
  const tubos = ['M40 120 H150', 'M150 120 V48 H262', 'M150 120 H300 L352 86 H430', 'M300 120 V186 H410', 'M262 48 H372 V86'];
  const red = `<svg class="red" viewBox="0 0 470 220" aria-hidden="true">
    ${tubos.map((d) => `<path class="t" d="${d}"/>`).join('')}
    ${tubos.map((d, k) => `<path class="f ${k % 2 ? 'l' : ''}" d="${d}"/>`).join('')}
    <path class="e" d="M40 106 L54 130 H26 Z"/>
    <circle class="n" cx="150" cy="120" r="5"/><circle class="n" cx="300" cy="120" r="5"/><circle class="n" cx="352" cy="86" r="4.5"/><circle class="n" cx="300" cy="186" r="4.5"/><circle class="n" cx="372" cy="86" r="4.5"/>
    <rect class="k" x="254" y="40" width="16" height="16" rx="2"/><rect class="k" x="422" y="78" width="16" height="16" rx="2"/><rect class="k" x="402" y="178" width="16" height="16" rx="2"/>
  </svg>`;
  b.innerHTML = `<div class="bienv"><div>
      <h1>Revisa, corre y compara modelos de EPANET sin adivinar qué pasó.</h1>
      <p class="lema">El mismo motor de cálculo del programa EPANET, con un mapa que se entiende, revisión antes de correr, escenarios sin copiar archivos y una explicación en cada paso. Todo corre en tu PC.</p>
      <div class="acc"><button class="btn prim" id="w-abrir">Abrir un modelo .inp</button><button class="btn" id="w-nuevo">Empezar uno desde cero</button><button class="btn" id="w-esc">Abrir un escenario guardado</button></div>
      ${S.docs.length ? '<div class="rec-t">Abiertos ahora</div><div id="w-abiertos"></div>' : ''}
      <div class="rec-t">Abiertos hace poco</div><div id="w-rec"></div>
    </div>
    <div class="lado">${red}
      <div class="caract">
        <div><b>Revisión antes de correr</b><span>Islas, nudos sueltos, proyectos sin entrada, tanques unidos sin control, cotas en 0, bombas sin curva. Con el arreglo sugerido.</span></div>
        <div><b>Corridas que se explican</b><span>Motor 2.2 (el del programa de escritorio) o 2.3. Tiempo, convergencia, balance producción/consumo, qué oscila y en qué nudo falla.</span></div>
        <div><b>Escenarios sin copiar archivos</b><span>Proyectos por horizonte, estados, consignas y demandas del Excel. El .inp se arma al exportar.</span></div>
        <div><b>Edición en el mapa</b><span>Nudos, tuberías, válvulas y bombas; partir y unir tramos con la cota estimada. Todo se deshace.</span></div>
        <div><b>Consignas de las FCV</b><span>Corrida con los patrones en 1 para ver cuánto pide cada tanque y proponer consignas.</span></div>
        <div><b>Comparar versiones</b><span>Qué cambió entre dos .inp o dos escenarios, marcado en el mapa.</span></div>
      </div></div></div>`;
  $('#w-abrir').onclick = abrirDialogo;
  $('#w-nuevo').onclick = nuevoModelo;
  $('#w-esc').onclick = async () => { const r = await explorar({ titulo: 'Abrir un escenario guardado', filtro: ['.json'] }); if (r) abrir(r); };
  const abiertos = $('#w-abiertos');
  S.docs.forEach((d) => {
    const x = h(`<button class="reciente abierto"><span class="ic"></span><b>${esc(d.nombre)}</b><span class="r">${esc(d.cambios ? nombreEscenario(d) : d.ruta)}${d.sin_guardar ? ' · cambios sin guardar' : ''}</span></button>`);
    x.onclick = () => { pintarPestanas(); activar(d.id); };
    abiertos.append(x);
  });
  const rec = $('#w-rec');
  (S.recientes || []).filter((r) => /\.inp$/i.test(r)).slice(0, 6).forEach((r) => {
    const x = h(`<button class="reciente"><span class="ic"></span><b>${esc(r.split('\\').pop())}</b><span class="r">${esc(r)}</span></button>`);
    x.onclick = () => abrir(r);
    rec.append(x);
  });
  if (!rec.children.length) rec.append(h('<div class="vacio">Todavía nada. Abre cualquier .inp de EPANET para empezar.</div>'));
}
// el logo de arriba a la izquierda: vuelve al inicio sin cerrar nada; una pestaña o «Abiertos ahora» regresa al modelo
function irAlInicio() {
  if (estaAbierta()) cerrar3d();
  if (S.editando) bus.emit('editar', false);
  bienvenida();
  $$('#pestanas .pestana').forEach((b) => b.classList.remove('activa'));
}
async function abrirDialogo() { const r = await explorar({ titulo: 'Abrir un modelo', filtro: ['.inp', '.json'] }); if (r) abrir(r); }

// ====================================================================== selección y búsqueda
function seleccionar(clase, i, centrar) {
  if (i === undefined || i === null) return;
  S.sel = { clase, i };
  S.selId = clase === 'nudo' ? S.M.nudos.id[i] : S.M.tramos.id[i];
  if (centrar) mapa.irA(clase, i);
  mapa.pedir();
  mostrarInspector();
}
bus.on('ir', ({ clase, id }) => {
  const i = clase === 'nudo' ? S.idxN.get(id) : S.idxL.get(id);
  if (i === undefined) { const j = clase === 'nudo' ? S.idxL.get(id) : S.idxN.get(id); if (j !== undefined) return seleccionar(clase === 'nudo' ? 'tramo' : 'nudo', j, true); aviso(`${id} no está en este modelo.`, 'error'); return; }
  seleccionar(clase, i, true);
});
bus.on('seleccion-cambio', () => { mapa.pedir(); if (S.sel) mostrarInspector(); });

function buscador() {
  const inp = $('#buscar'), sug = $('#sugerencias');
  let lista = [], sel = 0;
  const pintar = () => {
    sug.innerHTML = '';
    lista.forEach((x, j) => {
      const b = h(`<button class="${j === sel ? 'on' : ''}"><span>${esc(x.t)}</span><span class="t">${esc(x.tipo)}</span></button>`);
      b.onmousedown = (e) => { e.preventDefault(); elegir(x); };
      sug.append(b);
    });
    sug.hidden = !lista.length;
  };
  const elegir = (x) => { inp.value = ''; lista = []; pintar(); seleccionar(x.clase, x.i, true); };
  inp.oninput = () => {
    const q = inp.value.trim().toLowerCase();
    lista = []; sel = 0;
    if (!q || !S.M) return pintar();
    const N = S.M.nudos, L = S.M.tramos;
    const exactos = [], otros = [];
    for (let i = 0; i < N.id.length && otros.length < 40; i++) {
      const id = N.id[i].toLowerCase(), c = (N.com[i] || '').toLowerCase();
      if (id === q) exactos.push({ clase: 'nudo', i, t: nombreNudo(i), tipo: claseTexto('nudo', i) });
      else if (id.startsWith(q) || c.includes(q)) otros.push({ clase: 'nudo', i, t: nombreNudo(i), tipo: claseTexto('nudo', i) });
    }
    for (let k = 0; k < L.id.length && otros.length < 60; k++) {
      const id = L.id[k].toLowerCase(), c = (L.com[k] || '').toLowerCase();
      if (id === q) exactos.push({ clase: 'tramo', i: k, t: nombreTramo(k), tipo: claseTexto('tramo', k) });
      else if (id.startsWith(q) || c.includes(q)) otros.push({ clase: 'tramo', i: k, t: nombreTramo(k), tipo: claseTexto('tramo', k) });
    }
    lista = [...exactos, ...otros].slice(0, 14);
    pintar();
  };
  inp.onkeydown = (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, lista.length - 1); pintar(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); pintar(); e.preventDefault(); }
    if (e.key === 'Enter' && lista[sel]) elegir(lista[sel]);
    if (e.key === 'Escape') { inp.value = ''; lista = []; pintar(); }
  };
  inp.onblur = () => setTimeout(() => { sug.hidden = true; }, 150);
}

// ====================================================================== modos de color y barra de tiempo
function actualizarModos() {
  const sel = $('#modo-color');
  sel.querySelector('[value=resultado]').disabled = !S.corrida || !S.T;
  sel.querySelector('[value=diferencias]').disabled = !S.comparacion;
  if ((S.modo === 'resultado' && (!S.corrida || !S.T)) || (S.modo === 'diferencias' && !S.comparacion)) S.modo = 'tipo';
  sel.value = S.modo;
  leyenda();
  pintarTiempo();
}
bus.on('corrida', async () => {
  if (S.T) S.modo = 'resultado'; actualizarModos(); mapa.estilar(); leyenda(); if (S.sel) mostrarInspector();
  if (verFlechas() || verGrosor()) { await cargarVariable('caudal').catch(() => {}); mapa.estilar(); leyenda(); }
});
// flechas con el sentido del agua y grosor por caudal: necesitan el caudal de la corrida aunque el mapa esté
// coloreado por otra variable
const verFlechas = () => !!document.getElementById('ver-flechas')?.checked;
const verGrosor = () => !!document.getElementById('ver-grosor')?.checked;
bus.on('comparacion', () => { S.modo = 'diferencias'; actualizarModos(); mapa.estilar(); leyenda(); });

// La barra de tiempo avanza continua, como la del visor web: S.t es la hora como posición fraccionaria entre los
// resultados (0 … T-1) y el mapa mezcla los valores de las dos horas vecinas; S.hora (entera, la más cercana) es la
// que usan las fichas, tablas y gráficas. Al reproducir, S.t avanza en cada cuadro a 1, 2 o 4 h por segundo y el mapa
// se repinta unas 20 veces por segundo.
let reproduciendo = false, ultimoCuadro = 0, ultimoPintado = 0;
let velTiempo = (() => { try { return Number(localStorage.getItem('cauce-vel')) || 2; } catch (e) { return 2; } })();
function horaDe(t) {
  const t0 = Math.max(0, Math.floor(t)), t1 = Math.min(t0 + 1, S.T - 1), f = t - t0;
  const a = S.horas[t0] ?? 0, b = S.horas[t1] ?? a;
  return a + (b - a) * f;
}
function ponerTiempo(t, pintar = true) {
  S.t = Math.max(0, Math.min(Math.max(0, S.T - 1), t));
  S.hora = Math.round(S.t);
  const f = $('#tiempo'), r = f && $('input[type=range]', f);
  if (r) {
    if (Number(r.value) !== S.t) r.value = S.t;
    r.style.setProperty('--avance', `${(100 * S.t) / Math.max(1, S.T - 1)}%`);
    $('.reloj', f).textContent = hora(horaDe(S.t));
  }
  if (pintar) mapa.estilar();
}
function cuadroTiempo(ahora) {
  if (!reproduciendo) return;
  requestAnimationFrame(cuadroTiempo);
  const dt = Math.min(0.1, Math.max(0, (ahora - ultimoCuadro) / 1000)); ultimoCuadro = ahora;
  const dh = Math.max(1e-6, (S.horas[1] ?? 1) - (S.horas[0] ?? 0));       // horas entre resultados
  let t = (S.t ?? S.hora) + (dt * velTiempo) / dh;
  if (t > S.T - 1) t = 0;                                                 // el día vuelve a empezar
  const pintar = ahora - ultimoPintado > 48;
  if (pintar) ultimoPintado = ahora;
  ponerTiempo(t, pintar);
}
function reproducir(on) {
  reproduciendo = on;
  const play = $('#tiempo .play');
  if (play) { play.classList.toggle('on', on); play.innerHTML = on ? ICONO_PAUSA : ICONO_PLAY; play.setAttribute('aria-label', on ? 'Pausar' : 'Reproducir el día'); }
  if (on) { ultimoCuadro = performance.now(); requestAnimationFrame(cuadroTiempo); } else { ponerTiempo(S.t ?? S.hora); if (S.sel) mostrarInspector(); bus.emit('hora', S.hora); }
}
function pintarTiempo() {
  const f = $('#tiempo');
  const hay = S.corrida && S.T > 0;
  f.hidden = !hay;
  document.body.classList.toggle('con-tiempo', !!hay);
  setTimeout(() => mapa.tam(), 0);
  if (!hay) { reproduciendo = false; return; }
  if (S.t === undefined || S.t > S.T - 1) S.t = S.hora;
  const vars = [['presion', 'Presión'], ['velocidad', 'Velocidad'], ['caudal', 'Caudal'], ['carga', 'Carga'], ['demanda', 'Demanda'], ['estado', 'Abierto / cerrado']];
  if (S.resumen?.calidad?.variables?.includes('calidad')) vars.push(['calidad', nombreCalidad()[0]]);
  const t0 = S.horas[0] ?? 0, t1 = S.horas[S.T - 1] ?? 24;
  const marcas = [0, 0.25, 0.5, 0.75, 1].map((x) => `<span>${n(t0 + (t1 - t0) * x, 0)} h</span>`).join('');
  f.innerHTML = `<button class="play ${reproduciendo ? 'on' : ''}" aria-label="${reproduciendo ? 'Pausar' : 'Reproducir el día'}" title="Reproducir el día (espacio)">${reproduciendo ? ICONO_PAUSA : ICONO_PLAY}</button>
    <div class="seg vel" role="group" aria-label="Velocidad de reproducción">${[1, 2, 4].map((v) => `<button data-v="${v}" class="${v === velTiempo ? 'on' : ''}">${v} h/s</button>`).join('')}</div>
    <div class="reloj">${hora(horaDe(S.t))}</div>
    <div class="pista"><input type="range" min="0" max="${S.T - 1}" step="any" value="${S.t}" aria-label="Hora de la simulación"><div class="marcas">${marcas}</div></div>
    <label class="motor-sel">Ver <select id="t-var">${vars.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
    <label class="chk" id="t-env-l"><input type="checkbox" id="t-env"> <span id="t-env-t"></span></label>
    <span class="nombre" title="${esc(S.resumen?.version || '')}">Corrida con motor ${esc(S.resumen?.version || '')}${S.resumen?.fallo ? ' · falló' : ''}</span>`;
  $('#t-var').value = S.variable;
  const env = () => { const v = S.variable; $('#t-env-l').style.display = ['presion', 'velocidad'].includes(v) ? '' : 'none'; $('#t-env-t').textContent = v === 'presion' ? 'Mínima del día' : 'Máxima del día'; $('#t-env').checked = S.envolvente; };
  env();
  const rango = $('input[type=range]', f);
  ponerTiempo(S.t, false);
  // arrastrando, continuo (la mezcla de las dos horas vecinas se ve en el mapa); las flechas saltan de hora en hora
  rango.oninput = () => ponerTiempo(Number(rango.value));
  rango.onchange = () => { if (S.sel) mostrarInspector(); bus.emit('hora', S.hora); };
  rango.onkeydown = (e) => {
    const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    ponerTiempo(d > 0 ? Math.floor(S.t + 1e-6) + 1 : Math.ceil(S.t - 1e-6) - 1);
    if (S.sel) mostrarInspector(); bus.emit('hora', S.hora);
  };
  $$('.vel button', f).forEach((b) => { b.onclick = () => { velTiempo = Number(b.dataset.v); try { localStorage.setItem('cauce-vel', String(velTiempo)); } catch (e) { /* sin almacenamiento */ } $$('.vel button', f).forEach((x) => x.classList.toggle('on', x === b)); }; });
  $('#t-var').onchange = async (e) => { S.variable = e.target.value; S.envolvente = false; env(); try { await cargarVariable(S.variable); if (S.variable === 'calidad') await cargarVariable('calidad_t'); } catch (ex) { fallo(ex); } S.modo = 'resultado'; $('#modo-color').value = 'resultado'; mapa.estilar(); leyenda(); };
  $('#t-env').onchange = (e) => { S.envolvente = e.target.checked; mapa.estilar(); leyenda(); };
  $('.play', f).onclick = () => reproducir(!reproduciendo);     // si ya venía reproduciendo, su bucle sigue solo
}
const ICONO_PLAY = '<svg viewBox="0 0 16 16"><path d="M4.5 2.6l8.6 5.4-8.6 5.4z"/></svg>';
const ICONO_PAUSA = '<svg viewBox="0 0 16 16"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/></svg>';

// ====================================================================== edición en el mapa
async function editar(op, mensaje) {
  try {
    const r = await post(`/api/doc/${S.doc}/editar`, { op });
    (r.avisos || []).forEach((a) => aviso(a));
    if (mensaje) aviso(mensaje(r.resultado), 'ok');
    await cargarModelo(true); await refrescarDocs(); revisar(true).catch(() => {});
    return r.resultado;
  } catch (e) { fallo(e); return null; }
}
function cotaCercana(x, y) {
  const N = S.M.nudos; let mejor = null, d = Infinity;
  for (let i = 0; i < N.id.length; i++) { if (N.x[i] === null || N.tipo[i] !== 0 || Math.abs(N.cota[i]) < 1) continue; const dd = Math.hypot(N.x[i] - x, N.y[i] - y); if (dd < d) { d = dd; mejor = N.cota[i]; } }
  return mejor ?? 0;
}
async function nudoPara(p) {
  // nudo existente, nudo nuevo partiendo una tubería, o nudo suelto: {id, nuevo}
  if (p.clase === 'nudo') return { id: S.M.nudos.id[p.i], nuevo: false };
  if (p.clase === 'tramo' && ['PIPE', 'CV'].includes(S.M.tramos.tipo[p.i])) { const r = await editar({ op: 'partir', tramo: S.M.tramos.id[p.i], x: p.x, y: p.y }); return r ? { id: r[0], nuevo: true } : null; }
  const id = await editar({ op: 'nudo', x: p.x, y: p.y });
  return id ? { id, nuevo: true } : null;
}
// Los nudos que se crearon para una tubería que al final no se hizo (se canceló el formulario o se soltó con Esc)
// se quitan, pero solo si siguen siendo la última edición: así nunca se deshace otra cosa.
async function quitarCreados(ids) {
  let quitados = 0;
  for (const id of ids.filter(Boolean)) {
    try {
      const esc_ = await get(`/api/doc/${S.doc}/escenario`);
      const u = esc_.ediciones?.[esc_.ediciones.length - 1];
      if (!u || !((u.op === 'nudo' && u.id === id) || (u.op === 'partir' && u.id_nudo === id))) break;
      S.info = await post(`/api/doc/${S.doc}/deshacer`);
      quitados++;
    } catch (e) { fallo(e); break; }
  }
  if (!quitados) return;
  await cargarModelo(true); await refrescarDocs(); revisar(true).catch(() => {});
  aviso(quitados === 1 ? 'Tubería cancelada: se quitó el nudo que se había creado para ella.' : 'Tubería cancelada: se quitaron los nudos que se habían creado para ella.');
}
// Un clic que todavía está editando (creando un nudo, partiendo una tubería) no deja pasar otro: un doble clic
// creaba dos nudos y dos formularios, y quedaba un nudo suelto.
let clicOcupado = false;
mapa.onClick = async (p, e) => {
  if (clicOcupado) return;
  clicOcupado = true;
  try { await clicMapa(p, e); } finally { clicOcupado = false; }
};
async function clicMapa(p) {
  const hta = S.herramienta;
  // Mover: arrastrar mueve; un clic en un nudo abre «Mover con coordenadas» (y el siguiente clic puede ser su origen)
  if (hta === 'mover') {
    if (esperandoOrigen()) { ponerOrigen(p); return; }
    if (p.clase === 'nudo') { seleccionar('nudo', p.i); abrirMover(p.i); } else if (p.clase === 'tramo') { seleccionar('tramo', p.i); abrirMoverTramo(p.i); } else { cerrarMover(); cerrarInspector(); quitarResaltado(); }
    return;
  }
  if (!hta || hta === 'seleccionar') {
    if (p.clase) seleccionar(p.clase, p.i); else { cerrarInspector(); quitarResaltado(); }
    return;
  }
  if (hta === 'nudo') { await editar({ op: 'nudo', x: p.x, y: p.y }, (id) => `Nudo ${id} creado (cota estimada por los vecinos).`); return; }
  if (hta === 'tuberia') {
    if (!mapa.primerPunto) {
      const r = await nudoPara(p); if (!r) return;
      const i = S.idxN.get(r.id);
      mapa.primerPunto = { id: r.id, x: S.M.nudos.x[i], y: S.M.nudos.y[i], nuevo: r.nuevo };
      aviso(`Desde ${r.id}: haz clic donde llega la tubería (Esc para cancelar).`);
      return;
    }
    const pp = mapa.primerPunto, a = pp.id;
    const rb = await nudoPara(p); if (!rb) return;
    const b = rb.id;
    mapa.primerPunto = null;
    if (a === b) { aviso('Los dos extremos son el mismo nudo.', 'error'); return; }
    const v = await formulario(`Tubería de ${a} a ${b}`, [
      { id: 'diam', etiqueta: `Diámetro interno (${U('diametro')})`, tipo: 'number', valor: S.M.sistema.nuevo.diametro },
      { id: 'rug', etiqueta: `Rugosidad (${U('rugosidad')})`, tipo: 'number', valor: S.M.sistema.nuevo.rugosidad },
      { id: 'lon', etiqueta: `Longitud (${U('longitud')}) — vacío = la del dibujo`, tipo: 'number', valor: '' },
      { id: 'tag', etiqueta: 'Etiqueta (opcional; con un año, marca el horizonte del proyecto)', valor: '' },
      { id: 'id', etiqueta: 'ID — vacío = automático', valor: '' },
    ], 'Crear tubería');
    if (!v) { await quitarCreados([rb.nuevo && b, pp.nuevo && a]); return; }
    await editar({ op: 'tuberia', n1: a, n2: b, diam: v.diam, rug: v.rug, ...(v.lon ? { lon: v.lon } : {}), ...(v.tag ? { tag: v.tag } : {}), ...(v.id ? { id: v.id } : {}) }, (id) => `Tubería ${id} creada.`);
    return;
  }
  if (hta === 'unir') {
    if (!mapa.primerPunto) {
      if (p.clase !== 'nudo') { aviso('Primero haz clic en el nudo que quieres unir.', 'error'); return; }
      const i = p.i;
      mapa.primerPunto = { id: S.M.nudos.id[i], x: S.M.nudos.x[i], y: S.M.nudos.y[i] };
      aviso(`Unir ${mapa.primerPunto.id}: haz clic en el nudo o la tubería donde debe quedar conectado.`);
      return;
    }
    const a = mapa.primerPunto.id; mapa.primerPunto = null;
    let b = null;
    if (p.clase === 'nudo') b = S.M.nudos.id[p.i];
    else if (p.clase === 'tramo' && ['PIPE', 'CV'].includes(S.M.tramos.tipo[p.i])) { const r = await editar({ op: 'partir', tramo: S.M.tramos.id[p.i], x: p.x, y: p.y }); b = r ? r[0] : null; }
    if (!b) { aviso('Haz clic en un nudo o en una tubería.', 'error'); return; }
    await editar({ op: 'unir', nudo: a, destino: b, ...(longitudAuto() ? { longitud: true } : {}) }, () => `${a} unido a ${b}: sus tramos ahora llegan a ${b}.`);
    return;
  }
  if (hta === 'partir') {
    if (p.clase !== 'tramo' || !['PIPE', 'CV'].includes(S.M.tramos.tipo[p.i])) { aviso('Haz clic sobre una tubería.', 'error'); return; }
    await editar({ op: 'partir', tramo: S.M.tramos.id[p.i], x: p.x, y: p.y }, (r) => `Tubería partida: nudo ${r[0]} y tramo ${r[1]}.`);
    return;
  }
  if (hta === 'valvula' || hta === 'bomba') {
    if (p.clase !== 'tramo' || !['PIPE', 'CV'].includes(S.M.tramos.tipo[p.i])) { aviso('Haz clic sobre una tubería.', 'error'); return; }
    const t = S.M.tramos.id[p.i], d = S.M.tramos.diam[p.i];
    const campos = hta === 'valvula' ? [
      { id: 'vt', etiqueta: 'Tipo', opciones: [{ v: 'FCV', t: 'FCV · control de caudal' }, { v: 'PRV', t: 'PRV · reductora de presión' }, { v: 'PSV', t: 'PSV · sostenedora' }, { v: 'TCV', t: 'TCV · estrangulamiento' }, { v: 'PBV', t: 'PBV · quiebre' }] },
      { id: 'consigna', etiqueta: `Consigna (${U('caudal')} en FCV, ${U('presion')} en PRV/PSV/PBV, coeficiente en TCV)`, tipo: 'number', valor: 0 },
      { id: 'diam', etiqueta: `Diámetro (${U('diametro')})`, tipo: 'number', valor: d },
      { id: 'id', etiqueta: 'ID — vacío = automático (V###)', valor: '' },
    ] : [
      { id: 'curva', etiqueta: 'Curva de la bomba', opciones: [{ v: '', t: '(usar potencia)' }, ...S.M.curvas.map((c) => ({ v: c, t: c }))] },
      { id: 'potencia', etiqueta: `Potencia (${U('potencia')}) si no hay curva`, tipo: 'number', valor: '' },
      { id: 'id', etiqueta: 'ID — vacío = automático (PU###)', valor: '' },
    ];
    const v = await formulario(hta === 'valvula' ? `Válvula en ${t}` : `Bomba en ${t}`, campos, 'Insertar');
    if (!v) return;
    const op = { op: 'insertar', tramo: t, x: p.x, y: p.y, clase: hta, ...(v.id ? { id: v.id } : {}) };
    if (hta === 'valvula') Object.assign(op, { vt: v.vt, consigna: v.consigna ?? 0, diam: v.diam || d }); else Object.assign(op, v.curva ? { curva: v.curva } : { potencia: v.potencia });
    await editar(op, (id) => `${hta === 'valvula' ? 'Válvula' : 'Bomba'} ${id} insertada en ${t}.`);
    return;
  }
  if (hta === 'tanque') {
    const v = await formulario('Tanque nuevo', [
      { id: 'cota', etiqueta: `Cota de fondo (${U('cota')})`, tipo: 'number', valor: Math.round(cotaCercana(p.x, p.y)) },
      { id: 'nini', etiqueta: `Nivel inicial (${U('nivel')})`, tipo: 'number', valor: S.M.sistema.nuevo.nivel_ini }, { id: 'nmin', etiqueta: `Nivel mínimo (${U('nivel')})`, tipo: 'number', valor: S.M.sistema.nuevo.nivel_min },
      { id: 'nmax', etiqueta: `Nivel máximo (${U('nivel')})`, tipo: 'number', valor: S.M.sistema.nuevo.nivel_max }, { id: 'diam', etiqueta: `Diámetro equivalente (${U('diametro_tanque')})`, tipo: 'number', valor: S.M.sistema.nuevo.diam_tanque },
      { id: 'com', etiqueta: 'Nombre', valor: '' }, { id: 'id', etiqueta: 'ID — vacío = automático (T###)', valor: '' },
    ], 'Crear tanque');
    if (!v) return;
    await editar({ op: 'tanque', x: p.x, y: p.y, cota: v.cota, nini: v.nini, nmin: v.nmin, nmax: v.nmax, diam: v.diam, ...(v.com ? { com: v.com } : {}), ...(v.id ? { id: v.id } : {}) }, (id) => `Tanque ${id} creado. Conéctalo con una tubería.`);
    return;
  }
  if (hta === 'embalse') {
    const v = await formulario('Embalse o planta nueva', [
      { id: 'cota', etiqueta: `Carga total (${U('carga')})`, tipo: 'number', valor: Math.round(cotaCercana(p.x, p.y) + (S.M.sistema.us ? 100 : 30)) },
      { id: 'com', etiqueta: 'Nombre', valor: '' }, { id: 'id', etiqueta: 'ID — vacío = automático', valor: '' },
    ], 'Crear embalse');
    if (!v) return;
    await editar({ op: 'embalse', x: p.x, y: p.y, cota: v.cota, ...(v.com ? { com: v.com } : {}), ...(v.id ? { id: v.id } : {}) }, (id) => `Embalse ${id} creado. Conéctalo con una tubería.`);
    return;
  }
  if (hta === 'rotulo') {
    const v = await formulario('Rótulo nuevo', [{ id: 'texto', etiqueta: 'Texto', valor: '' }], 'Poner');
    if (v?.texto?.trim()) await editar({ op: 'rotulo', x: p.x, y: p.y, texto: v.texto.trim() }, () => 'Rótulo puesto. Se cambian o quitan en Datos > Rótulos.');
    return;
  }
  if (hta === 'borrar') {
    if (!p.clase) return;
    const id = p.clase === 'nudo' ? S.M.nudos.id[p.i] : S.M.tramos.id[p.i];
    modal({ titulo: `Borrar ${id}`, chico: true, cuerpo: `<p>${p.clase === 'nudo' ? 'Se borra el nudo con todos sus tramos.' : 'Se borra el tramo.'} Si un control o regla lo nombra, también se quita (te aviso cuáles). Puedes deshacerlo.</p>`,
      botones: [{ texto: 'Cancelar' }, { texto: 'Borrar', clase: 'peligro', accion: () => { editar({ op: 'borrar', tipo: p.clase, id }, () => `${id} borrado.`); } }] });
  }
};
mapa.onArea = ({ nudos, tramos }) => {
  if (!nudos.length && !tramos.length) { aviso('No quedó nada adentro del área.'); return; }
  S.resaltar = { nudos: new Set(nudos), tramos: new Set(tramos) }; mapa.pedir();
  edicionGrupo({ nudos: nudos.map((i) => S.M.nudos.id[i]), tramos: tramos.map((k) => S.M.tramos.id[k]) });
};
mapa.onMover = (i, x, y) => editar({ op: 'mover', id: S.M.nudos.id[i], x, y, ...(longitudAuto() ? { longitud: true } : {}) }, () => `${S.M.nudos.id[i]} movido${longitudAuto() ? ' (sus tuberías toman la longitud del dibujo)' : ''}.`);
const PISTAS = {
  seleccionar: 'Clic en un elemento para ver y cambiar sus datos en la ficha. Arrastra para mover el mapa.',
  mover: 'Arrastra un nudo hasta su nueva posición, o haz clic en un nudo, bomba o válvula para moverlo con coordenadas desde un origen (X, Y y cota).',
  nudo: 'Clic en el mapa para poner un nudo; la cota se estima con los nudos vecinos.',
  tuberia: 'Clic en el nudo de inicio y luego en el de llegada. Sobre una tubería, la parte ahí; en un sitio vacío, crea el nudo. Esc cancela.',
  partir: 'Clic sobre una tubería para partirla en dos con un nudo nuevo.',
  unir: 'Clic en el nudo suelto y luego en el nudo o la tubería donde debe quedar conectado.',
  valvula: 'Clic sobre una tubería para meter una válvula (FCV, PRV, PSV, TCV o PBV).',
  bomba: 'Clic sobre una tubería para meter una bomba con su curva.',
  tanque: 'Clic en el mapa para poner un tanque; después conéctalo con una tubería.',
  embalse: 'Clic en el mapa para poner un embalse o planta (carga fija); después conéctalo con una tubería.',
  borrar: 'Clic sobre un nudo o un tramo para borrarlo (se puede deshacer).',
  area: 'Arrastra para encerrar un área; después eliges qué cambiarle a todo lo que quedó adentro.',
  rotulo: 'Clic donde va el rótulo y escribe el texto.',
};
function pintarPista() {
  const p = $('#pista-herramienta');
  if (!p) return;
  const esc_ = S.info ? nombreEscenario(S.info) : 'Sin cambios';
  p.textContent = S.info?.propio ? `${PISTAS[S.herramienta || 'seleccionar']} Ctrl+S guarda el modelo en su archivo.`
    : `${PISTAS[S.herramienta || 'seleccionar']} Los cambios van al escenario «${esc_}»; el archivo original no se toca.`;
}
bus.on('herramienta', (hta) => {
  // una tubería empezada en un punto vacío y que no se terminó no deja su nudo suelto
  const pp = mapa.primerPunto;
  if (pp?.nuevo && S.herramienta === 'tuberia') quitarCreados([pp.id]);
  S.herramienta = hta; mapa.primerPunto = null;
  $$('#herramientas [data-h]').forEach((b) => b.classList.toggle('activo', b.dataset.h === (hta || 'seleccionar')));
  $('#mapa').classList.toggle('cruz', !!hta && !['seleccionar', 'mover'].includes(hta));
  pintarPista();
});
// la barra de edición va debajo de la barra de modos (con el mapa angosto ocupa dos líneas y la tapaba); lo que
// flota debajo de la barra (la ficha de Mover con coordenadas) usa --bajo-barra
function ubicarHerramientas() {
  const caja = $('#mapa-caja')?.getBoundingClientRect(), modos = $('#modos')?.getBoundingClientRect(), hb = $('#herramientas');
  if (!caja || !modos || !hb) return;
  const arriba = Math.max(12, Math.round(modos.bottom - caja.top + 8));
  hb.style.top = `${arriba}px`;
  const abajo = hb.hidden ? arriba : Math.round(hb.getBoundingClientRect().bottom - caja.top + 10);
  $('#mapa-caja').style.setProperty('--bajo-barra', `${abajo}px`);
}
new ResizeObserver(ubicarHerramientas).observe(document.getElementById('modos'));
new ResizeObserver(ubicarHerramientas).observe(document.getElementById('herramientas'));
function pintarLongitud() {
  const b = $('#b-longitud');
  if (!b || !S.M) return;
  const on = longitudAuto();
  b.setAttribute('aria-pressed', String(on));
  b.title = `Longitud automática ${on ? 'prendida' : 'apagada'}: al mover o unir nudos, las tuberías conectadas ${on ? 'toman' : 'conservan'} `
    + `${on ? 'la longitud del dibujo' : 'su longitud'} (como el Auto-Length de EPANET). En los modelos hechos en Cauce viene prendida; en los demás, apagada.`;
}
// modo edición: la barra de herramientas sobre el mapa, en cualquier panel
bus.on('editar', (on) => {
  S.editando = !!on && !!S.M;
  $('#herramientas').hidden = !S.editando;
  const b = $('#b-editar');
  b.setAttribute('aria-pressed', String(S.editando));
  b.textContent = S.editando ? 'Editando' : 'Editar red';
  const c = $('#e-editar'); if (c) c.checked = S.editando;
  if (!S.editando) bus.emit('herramienta', null); else { pintarPista(); pintarLongitud(); }
  ubicarHerramientas();
});
bus.on('deshacer', async () => { try { const info = await post(`/api/doc/${S.doc}/deshacer`); S.info = info; await cargarModelo(true); await refrescarDocs(); aviso('Se deshizo la última edición.'); } catch (e) { fallo(e); } });

// ====================================================================== panel lateral desplegable
function plegado() { return document.body.classList.contains('panel-plegado'); }
function plegar(on) {
  document.body.classList.toggle('panel-plegado', on);
  const b = $('#b-plegar');
  b.setAttribute('aria-expanded', String(!on));
  b.title = on ? 'Desplegar el panel ( [ )' : 'Plegar el panel ( [ )';
  b.setAttribute('aria-label', on ? 'Desplegar el panel' : 'Plegar el panel');
  try { localStorage.setItem('cauce-panel-plegado', on ? '1' : '0'); } catch (e) { /* sin almacenamiento */ }
  $$('#rail button').forEach((x) => x.classList.toggle('activo', !on && x.dataset.panel === panelActual));
}

// ====================================================================== inicio
// presentación de Nex-Industries: una vez por ventana; un clic o una tecla la saltan
function presentacion() {
  let vista = false;
  try { vista = sessionStorage.getItem('cauce-presentado') === '1'; sessionStorage.setItem('cauce-presentado', '1'); } catch (e) { /* sin almacenamiento: se muestra */ }
  if (vista) return;
  const p = $('#presentacion');
  p.hidden = false;
  let fuera = false;
  const salir = () => {
    if (fuera) return;
    fuera = true;
    document.removeEventListener('keydown', salir);
    p.classList.add('saliendo');
    setTimeout(() => { p.hidden = true; }, 900);   // lo que dura la salida: 140 ms de espera + 720 ms de barrido
  };
  p.onclick = salir;
  document.addEventListener('keydown', salir);
  setTimeout(salir, 4100);    // con movimiento reducido dura lo mismo: cambia cómo entra cada parte, no el ritmo
}

async function iniciar() {
  presentacion();
  mapa.iniciar($('#mapa'));
  document.fonts?.ready.then(() => mapa.pedir());     // los rótulos del mapa con la fuente ya cargada
  try { S.textos = await get('/api/textos'); } catch (e) { fallo(e); }
  $('#motor').value = S.motor;
  $('#motor').onchange = (e) => { bus.emit('motor', e.target.value); if (panelActual === 'correr') mostrarPanel(); };
  $('#b-abrir').onclick = abrirDialogo;
  $('#b-inicio').onclick = irAlInicio;
  $('#b-nuevo').onclick = nuevoModelo;
  $('#b-salir').onclick = salir;
  // clic en el panel que ya está abierto: lo pliega; en otro: lo abre (y despliega si estaba plegado)
  $$('#rail button').forEach((b) => { b.onclick = () => { if (b.dataset.panel === panelActual && !plegado()) plegar(true); else { plegar(false); mostrarPanel(b.dataset.panel); } }; });
  $('#b-plegar').onclick = () => plegar(!plegado());
  let guardado = null; try { guardado = localStorage.getItem('cauce-panel-plegado'); } catch (e) { /* sin almacenamiento */ }
  if (guardado === '1') plegar(true);
  $('#modo-color').onchange = async (e) => { S.modo = e.target.value; if (S.modo === 'resultado') await cargarVariable(S.variable).catch(fallo); mapa.estilar(); leyenda(); };
  $('#ver-rotulos').onchange = () => mapa.pedir();
  try { $('#ver-flechas').checked = localStorage.getItem('cauce-flechas') !== '0'; } catch (e) { /* sin almacenamiento */ }
  $('#ver-flechas').onchange = async () => {
    try { localStorage.setItem('cauce-flechas', verFlechas() ? '1' : '0'); } catch (e) { /* sin almacenamiento */ }
    if (verFlechas() && S.corrida) await cargarVariable('caudal').catch(fallo);
    mapa.pedir(); leyenda();
  };
  try { $('#ver-grosor').checked = localStorage.getItem('cauce-grosor') === '1'; } catch (e) { /* sin almacenamiento */ }
  $('#ver-grosor').onchange = async () => {
    try { localStorage.setItem('cauce-grosor', verGrosor() ? '1' : '0'); } catch (e) { /* sin almacenamiento */ }
    if (verGrosor() && S.corrida) await cargarVariable('caudal').catch(fallo);
    mapa.estilar(); leyenda();
  };
  $('#b-encuadrar').onclick = () => mapa.encuadrar();
  const vista3d = async () => { await alternar3d(); if (!estaAbierta()) leyenda(); };       // la edición sigue abierta en 3D
  $('#b-3d').onclick = vista3d;
  $$('#herramientas [data-h]').forEach((b) => { b.onclick = () => bus.emit('herramienta', b.dataset.h === 'seleccionar' ? null : b.dataset.h); });
  $('#b-deshacer').onclick = () => bus.emit('deshacer');
  $('#b-longitud').onclick = () => {
    S.longAuto = { ...(S.longAuto || {}), [S.doc]: !longitudAuto() }; pintarLongitud();
    aviso(longitudAuto() ? 'Longitud automática prendida: al mover o unir nudos, las tuberías toman la longitud del dibujo.' : 'Longitud automática apagada: mover o unir nudos no cambia la longitud de las tuberías.');
  };
  $('#b-editar').onclick = () => bus.emit('editar', !S.editando);
  $('#b-cerrar-edicion').onclick = () => bus.emit('editar', false);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if ($('#capa-modal').hidden) guardarRapido(); return; }
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'Escape') { bus.emit('herramienta', null); quitarResaltado(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && S.doc) { e.preventDefault(); bus.emit('deshacer'); }
    if (e.key === '/' ) { e.preventDefault(); $('#buscar').focus(); }
    if (e.key === '[' && S.M) { e.preventDefault(); plegar(!plegado()); }
    if (e.key === '3' && !e.ctrlKey && !e.metaKey && !e.altKey && S.M) { vista3d(); return; }
    if (e.key === ' ' && S.corrida && S.T && !$('#tiempo').hidden && !e.target.matches('button')) { e.preventDefault(); reproducir(!reproduciendo); return; }
    if (e.key.toLowerCase() === 'e' && !e.ctrlKey && !e.metaKey && !e.altKey && S.M) bus.emit('editar', !S.editando);
    // con la edición abierta, cada herramienta tiene su letra (la que se ve en la esquina del botón)
    else if (S.editando && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
      const b = document.querySelector(`#herramientas [data-k="${e.key.toUpperCase()}"]`);
      if (b) { e.preventDefault(); bus.emit('herramienta', b.dataset.h === 'seleccionar' ? null : b.dataset.h); }
    }
  });
  buscador();
  // latido: le dice al servidor que la ventana sigue abierta (si se lanzó con apagado automático)
  latido = setInterval(() => { fetch('/api/estado').catch(() => {}); }, 20000);
  const e = await refrescarDocs();
  if (S.docs.length) await activar(S.docs[0].id); else { bienvenida(); mostrarPanel('modelo'); }
  leyenda();
  void e;
}
iniciar();
