// Paneles de la izquierda: Modelo, Revisión, Correr, Escenario, Consignas, Comparar y Glosario.
import { S, bus, get, post, binario, esc, n, h, hora, aviso, fallo, modal, formulario, explorar, conjunto, esqueleto, u, U, $, $$, nombreNudo, nombreEscenario, nombreCalidad, describir, textoScn } from './estado.js';
import { mapa } from './mapa.js';
import { abrirReporte } from './reporte.js';
import { pReportes } from './reportes.js';
import { grafica, barras } from './grafica.js';
import { pDatos } from './datos.js';
import { pInformes } from './informes.js';
import { pScripts } from './scripts.js';

const P = () => document.getElementById('panel');
export let panelActual = 'modelo';

export function mostrarPanel(nombre) {
  panelActual = nombre || panelActual;
  $$('#rail button').forEach((b) => b.classList.toggle('activo', b.dataset.panel === panelActual));
  const f = { modelo: pModelo, revision: pRevision, correr: pCorrer, escenario: pEscenario, datos: pDatos, consignas: pConsignas, comparar: pComparar, informes: pInformes, reportes: pReportes, scripts: pScripts, glosario: pGlosario, ajustes: pAjustes }[panelActual];
  document.getElementById('herramientas').hidden = !(S.M && S.editando);
  // el código y las tablas de los informes necesitan más ancho; «Ampliar» (todo el ancho) es solo de Informes
  document.body.classList.toggle('panel-ancho', ['scripts', 'informes'].includes(panelActual));
  if (panelActual !== 'informes') document.body.classList.remove('panel-amplio');
  if (!S.M && !['glosario', 'ajustes', 'reportes'].includes(panelActual)) { P().innerHTML = '<h1>Ningún modelo abierto</h1><p class="sub">Abre un .inp para empezar.</p>'; return; }
  f();
}

function resaltar(elementos, ajustar = true) {
  S.resaltar = conjunto(elementos);
  if (ajustar && (S.resaltar.nudos.size || S.resaltar.tramos.size)) mapa.ajustarA(S.resaltar);
  mapa.pedir();
}
export function quitarResaltado() { S.resaltar = null; mapa.pedir(); }
function botonVer(elementos, texto = 'Ver en el mapa') {
  const b = h(`<button class="btn chico">${esc(texto)}</button>`);
  b.onclick = () => resaltar(elementos);
  return b;
}
function enlaceId(clase, id, texto) {
  const b = h(`<button class="enlace">${esc(texto || id)}</button>`);
  b.onclick = () => bus.emit('ir', { clase, id });
  return b;
}

// ====================================================================== Modelo
async function pModelo() {
  const M = S.M, I = S.info, N = M.nudos, L = M.tramos;
  const cuenta = (arr, f) => arr.reduce((a, x) => a + (f(x) ? 1 : 0), 0);
  const tipos = {}; L.tipo.forEach((t) => { tipos[t] = (tipos[t] || 0) + 1; });
  const dem = N.dem.reduce((a, x) => a + (x > 0 ? x : 0), 0);
  const op = M.opciones, ti = M.tiempos;
  P().innerHTML = '';
  P().append(h(`<div><h1>${esc(I.nombre)}</h1><p class="sub mono" style="word-break:break-all">${esc(I.ruta)}</p></div>`));
  P().append(h(I.propio ? `<div class="tarjeta ${I.sin_guardar ? 'info' : ''}"><h3>Modelo creado en Cauce</h3>
    <p>${I.sin_guardar ? 'Tiene cambios sin guardar: Guardar (Ctrl+S) los escribe en su .inp.' : 'Todo está guardado en su .inp.'} Nudos, tuberías, tanques y bombas se agregan en el mapa.</p>
    <div class="acciones"><button class="btn" data-a="editar">Editar red (E)</button></div></div>`
    : `<div class="tarjeta ${I.cambios ? 'info' : ''}"><h3>Escenario: ${esc(nombreEscenario(I))}</h3>
    <p>${I.cambios ? 'Tiene cambios sobre el archivo base. Lo que ves en el mapa, la revisión y las corridas ya los incluye.' : 'Sin cambios: es el archivo tal cual.'}${I.sin_guardar ? ' Hay cambios sin guardar (Ctrl+S los guarda).' : ''}</p>
    <div class="acciones"><button class="btn" data-a="esc">Ir al escenario</button></div></div>`));
  if (I.propio) $('[data-a=editar]', P()).onclick = () => bus.emit('editar', true);
  else $('[data-a=esc]', P()).onclick = () => mostrarPanel('escenario');
  P().append(h(`<div class="cifras">
    <div class="cifra"><div class="v">${n(cuenta(N.tipo, (t) => t === 0), 0)}</div><div class="t">nudos</div></div>
    <div class="cifra"><div class="v">${n((tipos.PIPE || 0) + (tipos.CV || 0), 0)}</div><div class="t">tuberías${tipos.CV ? ` (${n(tipos.CV, 0)} con antirretorno)` : ''}</div></div>
    <div class="cifra"><div class="v">${n(cuenta(N.tipo, (t) => t === 2), 0)}</div><div class="t">tanques</div></div>
    <div class="cifra"><div class="v">${n(cuenta(N.tipo, (t) => t === 1), 0)}</div><div class="t">embalses o plantas</div></div>
    <div class="cifra"><div class="v">${n(tipos.PUMP || 0, 0)}</div><div class="t">bombas</div></div>
    <div class="cifra"><div class="v">${n(L.tipo.length - (tipos.PIPE || 0) - (tipos.CV || 0) - (tipos.PUMP || 0), 0)}</div><div class="t">válvulas</div></div>
    <div class="cifra"><div class="v">${n(dem, dem >= 100 ? 0 : 2)}<small>${esc(U('caudal'))}</small></div><div class="t">demanda base total</div></div>
    <div class="cifra"><div class="v">${n(M.n_reglas, 0)}<small>+ ${n(M.n_controles, 0)}</small></div><div class="t">reglas + controles</div></div>
  </div>`));
  const opc = [['UNITS', op.UNITS], ['HEADLOSS', op.HEADLOSS], ['ACCURACY', op.ACCURACY ?? '0.001 (por defecto)'], ['TRIALS', op.TRIALS ?? '200 (por defecto)'],
    ['QUALITY', op.QUALITY ?? 'NONE'], ['DURATION', ti.DURATION], ['HYDRAULIC TIMESTEP', ti['HYDRAULIC TIMESTEP']], ['PATTERN TIMESTEP', ti['PATTERN TIMESTEP']]];
  const tab = h('<div class="sec"><div class="eti">Opciones principales</div><table class="tabla" style="margin-top:6px"></table></div>');
  opc.forEach(([k, v]) => $('table', tab).append(h(`<tr><td><span class="mono">${esc(k)}</span> <i class="ayuda" tabindex="0" data-t="${esc(u(S.textos.opciones[k] || ''))}">?</i></td><td class="mono">${esc(v ?? '—')}</td></tr>`)));
  P().append(tab);
  const acc = h(`<div class="sec"><div class="eti">Archivo</div><div class="acciones fila" style="margin-top:8px">
    ${I.propio ? '<button class="btn prim" data-a="guardar">Guardar</button><button class="btn" data-a="exportar">Exportar una copia…</button>'
    : '<button class="btn prim" data-a="exportar">Exportar .inp…</button><button class="btn" data-a="guardar">Guardar escenario</button>'}
    <button class="btn" data-a="texto">Ver el .inp</button><button class="btn peligro" data-a="cerrar">Cerrar</button></div></div>`);
  P().append(acc);
  $('[data-a=exportar]', acc).onclick = exportar;
  $('[data-a=guardar]', acc).onclick = () => (I.propio ? guardar() : guardarEscenario());
  $('[data-a=texto]', acc).onclick = async () => {
    const r = await get(`/api/doc/${S.doc}/texto`);
    modal({ titulo: `${I.nombre} · ${I.escenario}`, cuerpo: `<p class="sub">${n(r.largo, 0)} caracteres${r.largo > 200000 ? ' (se muestran los primeros 200.000)' : ''}.</p><div class="texto-inp">${esc(r.texto)}</div>` });
  };
  $('[data-a=cerrar]', acc).onclick = () => bus.emit('cerrar-doc', S.doc);
  const fondo = await seccionFondo();
  if (panelActual !== 'modelo') return;      // se cambió de panel mientras llegaba: lo que falta no va en el otro
  P().append(fondo);
  if (I.avisos?.length) P().append(h(`<div class="tarjeta aviso"><h3>Al armar el escenario</h3>${I.avisos.slice(0, 12).map((a) => `<p>${esc(a)}</p>`).join('')}</div>`));
  const lista = h(`<div class="sec"><div class="eti">Escenarios guardados</div>${esqueleto(2)}</div>`);
  P().append(lista);
  try {
    const r = await get('/api/escenarios');
    lista.lastElementChild.remove();
    if (!r.escenarios.length) lista.append(h('<div class="vacio">Todavía no hay escenarios guardados.</div>'));
    const ul = h('<ul class="lista"></ul>');
    r.escenarios.forEach((e) => {
      const li = h(`<li><button class="enlace">${esc(e.nombre)}</button><span class="d" title="${esc(e.base)}">${esc(e.base.split('\\').pop())} · ${n(e.cambios, 0)} cambios</span></li>`);
      li.querySelector('button').onclick = () => bus.emit('abrir', e.archivo);
      ul.append(li);
    });
    lista.append(ul);
  } catch (e) { fallo(e); }
}

// imagen de fondo del mapa (un plano, una ortofoto): se guarda por modelo en trabajo/config.json
async function seccionFondo() {
  const s = h('<div class="sec"><div class="eti">Mapa de fondo</div><div class="fila" style="margin-top:8px"></div></div>');
  const fila = $('.fila', s);
  let f = null;
  try { f = (await get(`/api/doc/${S.doc}/fondo`)).fondo; } catch (e) { /* sin fondo */ }
  const pedir = async (actual) => {
    const ruta = actual?.ruta || await explorar({ titulo: 'Imagen de fondo', filtro: ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp'] });
    if (!ruta) return;
    const b = mapa.limites && isFinite(mapa.limites[0]) ? mapa.limites : [0, 0, 1000, 1000];
    const v = await formulario('Ubicar la imagen', [
      { id: 'x0', etiqueta: 'X de la esquina izquierda', tipo: 'number', valor: actual?.x0 ?? +b[0].toFixed(2) },
      { id: 'y0', etiqueta: 'Y de la esquina de abajo', tipo: 'number', valor: actual?.y0 ?? +b[1].toFixed(2) },
      { id: 'x1', etiqueta: 'X de la esquina derecha', tipo: 'number', valor: actual?.x1 ?? +b[2].toFixed(2) },
      { id: 'y1', etiqueta: 'Y de la esquina de arriba', tipo: 'number', valor: actual?.y1 ?? +b[3].toFixed(2) },
      { id: 'opacidad', etiqueta: 'Opacidad (0 a 1)', tipo: 'number', valor: actual?.opacidad ?? 0.5 },
    ], 'Poner de fondo');
    if (!v) return;
    try {
      const r = await post(`/api/doc/${S.doc}/fondo`, { fondo: { ruta, ...v, opacidad: Math.max(0, Math.min(1, v.opacidad ?? 0.5)) } });
      mapa.ponerFondo(r.fondo); aviso('Imagen de fondo puesta. Las coordenadas son las del modelo.', 'ok'); mostrarPanel();
    } catch (e) { fallo(e); }
  };
  if (f) {
    fila.append(h(`<span class="sub" style="margin:0;word-break:break-all">${esc(f.ruta.split('\\').pop())} · opacidad ${n(f.opacidad ?? 0.5, 2)}</span>`));
    const aj = h('<button class="btn chico">Ajustar…</button>'), qu = h('<button class="btn chico peligro">Quitar</button>');
    aj.onclick = () => pedir(f);
    qu.onclick = async () => { try { await post(`/api/doc/${S.doc}/fondo`, { fondo: null }); mapa.ponerFondo(null); mostrarPanel(); } catch (e) { fallo(e); } };
    fila.append(aj, qu);
  } else {
    const b = h('<button class="btn chico">Poner una imagen de fondo…</button>');
    b.onclick = () => pedir(null);
    fila.append(h('<span class="sub" style="margin:0">Un plano o una foto aérea debajo de la red, ubicada con las coordenadas del modelo.</span>'), b);
  }
  return s;
}

export async function exportar() {
  const I = S.info;
  const base = I.ruta.replace(/\.inp$/i, '');
  const sug = `${base}_${(I.escenario || 'escenario').replace(/[^\w-]+/g, '_')}.inp`;
  const ruta = await explorar({ titulo: 'Exportar el modelo como .inp', guardar: true, filtro: ['.inp'], nombre: sug.split('\\').pop() });
  if (!ruta) return;
  const enviar = async (extra = {}) => {
    try {
      const r = await post(`/api/doc/${S.doc}/exportar`, { ruta, ...extra });
      if (!r.ok) {
        modal({ titulo: 'EPANET 2.2 no abriría este archivo', cuerpo: `<p class="sub">No lo escribí. Esto dice el motor:</p><div class="texto-inp">${esc(r.errores.join('\n'))}</div>`,
          botones: [{ texto: 'Cancelar' }, { texto: 'Exportar igual', clase: 'peligro', accion: () => enviar({ ...extra, forzar: true }) }] });
        return;
      }
      aviso(`Exportado y verificado con EPANET 2.2: ${r.ruta}`, 'ok');
      if (r.info) bus.emit('info', r.info);
    } catch (e) {
      if (e.codigo === 409) {
        modal({ titulo: 'Ese archivo ya existe', chico: true, cuerpo: `<p>${esc(e.message)}</p>`, botones: [{ texto: 'Cancelar' }, { texto: 'Reemplazarlo', clase: 'peligro', accion: () => enviar({ ...extra, sobrescribir: true }) }] });
      } else fallo(e);
    }
  };
  enviar();
}

// Guardar: un modelo creado en Cauce se guarda en su propio .inp; cualquier otro, como escenario (su .inp no se toca)
export async function guardar(rapido = false, I = S.info) {
  if (!I.propio) return guardarEscenario(rapido, I);
  try {
    const r = await post(`/api/doc/${I.id}/guardar_inp`);
    if (r.valido) aviso(`Guardado en ${r.ruta}`, 'ok');
    else aviso(`Guardado en ${r.ruta}. Todavía no corre en EPANET: ${r.errores[0] || 'revisa el modelo'}`);
    if (I.id === S.doc) { bus.emit('info', r.info); mostrarPanel(); }
    return true;
  } catch (e) { fallo(e); return false; }
}

// guarda el escenario de un modelo abierto (el activo si no se dice). Con rápido y un archivo ya guardado, no pregunta
// el nombre (Ctrl+S y al salir). Devuelve si quedó guardado.
export async function guardarEscenario(rapido = false, I = S.info) {
  let nombre = I.escenario;
  if (!(rapido && I.archivo)) {
    const v = await formulario(I.id === S.doc ? 'Guardar escenario' : `Guardar escenario de ${I.nombre}`,
      [{ id: 'nombre', etiqueta: 'Nombre', valor: I.escenario === 'Sin cambios' ? '' : I.escenario }], 'Guardar');
    if (!v || !v.nombre.trim()) return false;
    nombre = v.nombre.trim();
  }
  const enviar = async (extra = {}) => {
    const r = await post(`/api/doc/${I.id}/guardar_escenario`, { nombre, ...extra });
    aviso(`Escenario guardado en ${r.ruta}`, 'ok');
    if (I.id === S.doc) { bus.emit('info', r.info); mostrarPanel(); }
    return true;
  };
  try { return await enviar(); } catch (e) {
    if (e.codigo !== 409) { fallo(e); return false; }
    return new Promise((resolver) => {
      let r = false;
      modal({ titulo: 'Ese nombre ya existe', chico: true, cuerpo: `<p>${esc(e.message)}</p>`,
        botones: [{ texto: 'Cancelar' }, { texto: 'Reemplazarlo', clase: 'peligro', accion: async () => { try { r = await enviar({ sobrescribir: true }); } catch (ex) { fallo(ex); } } }],
        alCerrar: () => resolver(r) });
    });
  }
}

// ====================================================================== Revisión
export async function revisar(forzar) {
  if (!S.doc) return;
  if (!forzar && S.hallazgos && S.hallazgos.version === S.info.version) return S.hallazgos;
  const r = await post(`/api/doc/${S.doc}/revisar`, {});
  S.hallazgos = { version: S.info.version, lista: r.hallazgos };
  const g = r.hallazgos.some((x) => x.gravedad === 'error') ? 'error' : r.hallazgos.some((x) => x.gravedad === 'aviso') ? 'aviso' : 'ok';
  document.getElementById('p-rev').className = `punto ${g}`;
  return S.hallazgos;
}

async function pRevision() {
  P().innerHTML = '<h1>Revisión antes de correr</h1><p class="sub">Lo que hace fallar a EPANET o lo vuelve lento, con qué hacer en cada caso.</p>' + `<div>${esqueleto(3, true)}${esqueleto(3, true)}</div>`;
  let r;
  try { r = await revisar(); } catch (e) { fallo(e); return; }
  if (panelActual !== 'revision') return;
  P().lastElementChild.remove();
  const c = { error: 0, aviso: 0, info: 0 };
  r.lista.forEach((x) => { c[x.gravedad]++; });
  P().append(h(`<div class="fila" style="margin-bottom:12px"><div class="chips">
    <span class="chip error">${c.error} ${c.error === 1 ? 'error' : 'errores'}</span><span class="chip aviso">${c.aviso} ${c.aviso === 1 ? 'aviso' : 'avisos'}</span><span class="chip info">${c.info} de información</span></div>
    <button class="btn chico" data-a="otra" style="margin-left:auto">Revisar de nuevo</button></div>`));
  $('[data-a=otra]', P()).onclick = async () => { await revisar(true); pRevision(); };
  if (!r.lista.length) P().append(h('<div class="tarjeta ok"><h3>No encontré problemas</h3><p>El modelo pasa todas las revisiones. Igual conviene correrlo completo: algunos problemas solo aparecen a mitad del día.</p></div>'));
  if (c.error) P().append(h('<p class="nota">Con errores, EPANET no abre el archivo o falla al correr. Arréglalos antes de seguir.</p>'));
  // una fila por hallazgo (punto de color, título, cuántos casos y «Ver»); al tocarla se despliega la explicación.
  // Los errores vienen abiertos: sin arreglarlos EPANET no corre.
  r.lista.forEach((x) => {
    // cuántos elementos marca en el mapa (si no marca ninguno, cuántos casos lista)
    const casos = x.elementos.length || x.detalle.length;
    const t = h(`<details class="hallazgo ${x.gravedad}" ${x.gravedad === 'error' ? 'open' : ''}><summary><span class="tit">${esc(x.titulo)}</span>${casos ? `<span class="cuantos" title="${x.elementos.length ? 'elementos que marca en el mapa' : 'casos'}">${n(casos, 0)}</span>` : ''}</summary>
      <div class="cuerpo"><p>${esc(x.que_pasa)}</p><p><b>Qué hacer:</b> ${esc(x.como)}</p></div></details>`);
    if (x.elementos.length) {
      const ver = botonVer(x.elementos, 'Ver');
      ver.onclick = (e) => { e.preventDefault(); e.stopPropagation(); resaltar(x.elementos); };
      $('summary', t).append(ver);
    }
    const cuerpo = $('.cuerpo', t);
    if (x.detalle.length) {
      const d = h('<div class="casos"></div>');
      x.detalle.slice(0, 60).forEach((z) => d.append(h(`<div>${esc(z)}</div>`)));
      if (x.detalle.length > 60) d.append(h(`<div>y ${x.detalle.length - 60} más</div>`));
      cuerpo.append(d);
    }
    if (x.elementos.length) { const b = h('<button class="btn chico">Quitar resaltado</button>'); b.onclick = quitarResaltado; cuerpo.append(h('<div class="acciones"></div>')); $('.acciones', cuerpo).append(b); }
    if (x.arreglos?.length) {
      const a = h('<div class="sec" style="margin:10px 0 0"><div class="eti">Arreglo sugerido (queda en el escenario y se puede deshacer)</div><div class="acciones"></div></div>');
      x.arreglos.slice(0, 8).forEach((z) => { const b = h(`<button class="btn chico prim">${esc(z.texto)}</button>`); b.onclick = () => aplicarArreglo(z); $('.acciones', a).append(b); });
      cuerpo.append(a);
    }
    P().append(t);
  });
}

async function aplicarArreglo(z) {
  try {
    let destino = z.destino;
    if (!destino && z.tramo) {
      const r = await post(`/api/doc/${S.doc}/editar`, { op: { op: 'partir', tramo: z.tramo, x: z.x, y: z.y } });
      destino = r.resultado[0];
    }
    await post(`/api/doc/${S.doc}/editar`, { op: { op: 'unir', nudo: z.nudo, destino } });
    aviso(`${z.nudo} quedó unido a ${destino}.`, 'ok');
    quitarResaltado();
    bus.emit('recargar', { mantener: true });
  } catch (e) { fallo(e); }
}

// ====================================================================== Correr
// Cada modelo abierto (cada pestaña) lleva su propia corrida en curso: el avance, el botón y los resultados no se
// cruzan entre pestañas, y dos modelos pueden correr a la vez (el servidor ya corre cada uno en su proyecto de
// EPANET). Si la corrida termina con otra pestaña delante, queda como la última de su modelo y se carga al volver.
const sondeos = {};
const nombreDoc = (doc) => S.docs.find((d) => d.id === doc)?.nombre || 'Otro modelo';
export async function correr() {
  const doc = S.doc;
  try {
    const r = await post(`/api/doc/${doc}/correr`, { motor: S.motor, estados: $('#c-estados')?.checked ?? true, calidad: $('#c-calidad')?.checked ?? true });
    S.trabajos[doc] = r.trabajo;
    const b = $('#c-correr'); if (b) b.disabled = true;
    seguir(doc);
  } catch (e) { fallo(e); }
}
function seguir(doc) {
  clearTimeout(sondeos[doc]);
  const paso = async () => {
    const tid = S.trabajos[doc];
    if (!tid) return;
    let t;
    try { t = await get(`/api/trabajo/${tid}`); } catch (e) { fallo(e); delete S.trabajos[doc]; if (S.doc === doc) mostrarPanel(); return; }
    S.progresos[doc] = t;
    if (panelActual === 'correr' && S.doc === doc) pintarProgreso();
    if (t.fase === 'en curso') { sondeos[doc] = setTimeout(paso, 400); return; }
    delete S.trabajos[doc]; delete S.progresos[doc];
    const delante = S.doc === doc, de = delante ? '' : `${nombreDoc(doc)}: `;
    if (t.fase === 'error') { fallo(new Error(de + t.error)); if (delante) mostrarPanel(); return; }
    const res = t.resultado;
    if (res.error) {
      aviso(de + res.error.mensaje, 'error');
      if (delante) { S.resumen = null; S.errorLectura = res.error; mostrarPanel(); }
      return;
    }
    S.ultima[doc] = res.corrida;
    if (delante) { S.errorLectura = null; await usarCorrida(res.corrida); }
    const r = res.resumen;
    const txt = r.fallo ? `La corrida falló a las ${hora(r.fallo.hora)}: ${r.fallo.mensaje}` : `Corrida lista en ${n(r.segundos, 1)} s (motor ${r.version}).`;
    aviso(delante ? txt : `${de}${txt} Los resultados están en su pestaña.`, r.fallo ? 'error' : 'ok');
  };
  paso();
}
export async function usarCorrida(id) {
  const doc = S.doc;
  const r = await get(`/api/corrida/${id}`);
  if (S.doc !== doc) return;           // se cambió de pestaña mientras llegaba la respuesta
  S.corrida = id; S.ultima[doc] = id; S.resumen = r.resumen; S.res = {};
  S.horas = r.resumen.horas || []; S.T = S.horas.length; S.hora = Math.min(S.hora, Math.max(0, S.T - 1)); S.t = Math.min(S.t ?? S.hora, Math.max(0, S.T - 1));
  await cargarVariable(S.variable);
  bus.emit('corrida');
  mostrarPanel();
}
export async function cargarVariable(v) {
  if (!S.corrida || S.res[v]) return;
  const b = await binario(`/api/corrida/${S.corrida}/var/${v}`, { doc: S.doc });
  S.res[v] = b.datos;
}

function pintarProgreso() {
  const t = S.progresos[S.doc], caja = $('#c-prog');
  if (!caja || !t) return;
  const p = t.progreso || { pct: 0, hora: 0, duracion: 24 };
  caja.innerHTML = t.fase === 'en curso'
    ? `<div class="fila"><span class="cargando"></span> <b>Calculando</b> · hora ${n(p.hora, 1)} de ${n(p.duracion, 0)} · ${n(t.segundos, 0)} s</div><div class="barra-prog"><i style="transform:scaleX(${(p.pct / 100).toFixed(3)})"></i></div><button class="btn chico" id="c-cancelar">Cancelar</button>`
    : '';
  const b = $('#c-cancelar'); if (b) b.onclick = () => post(`/api/trabajo/${S.trabajos[S.doc]}/cancelar`);
}

async function pCorrer() {
  P().innerHTML = `<h1>Correr la simulación</h1><p class="sub">Con el mismo motor de cálculo del programa EPANET.</p>
    <div class="tarjeta"><div class="campo">Motor
      <div class="seg" id="c-motor"><button data-v="2.2">2.2 · como EPANET de escritorio</button><button data-v="2.3">2.3 · rápido</button></div></div>
      <label class="chk" style="margin-bottom:6px"><input type="checkbox" id="c-estados" checked> Analizar qué oscila (reporte de estados de EPANET)</label>
      ${calidadModelo() ? `<label class="chk" style="margin-bottom:10px"><input type="checkbox" id="c-calidad" checked> Calcular la calidad del agua (${esc(calidadModelo())})</label>` : '<div style="height:4px"></div>'}
      <button class="btn prim" id="c-correr">Correr ${esc(S.info.escenario === 'Sin cambios' ? 'el modelo' : `«${S.info.escenario}»`)}</button>
      <div id="c-prog" style="margin-top:10px"></div></div>`;
  $$('#c-motor button').forEach((b) => { b.classList.toggle('on', b.dataset.v === S.motor); b.onclick = () => { bus.emit('motor', b.dataset.v); pCorrer(); }; });
  $('#c-correr').onclick = correr;
  $('#c-correr').disabled = !!S.trabajos[S.doc];
  if (S.trabajos[S.doc]) pintarProgreso();
  if (S.errorLectura) P().append(h(`<div class="tarjeta error"><h3>${esc(S.errorLectura.mensaje)}</h3><div class="texto-inp">${esc((S.errorLectura.reporte || []).join('\n'))}</div></div>`));
  // corridas guardadas en memoria
  try {
    const cs = (await get('/api/corridas')).corridas.filter((c) => c.doc === S.doc);
    if (cs.length) {
      const sec = h('<div class="sec"><div class="eti">Corridas de este modelo</div><table class="tabla" style="margin-top:6px"><tr><th>Hora</th><th>Escenario y motor</th><th>Ver</th><th>Comparar</th></tr></table></div>');
      cs.reverse().forEach((c) => {
        const tr = h(`<tr><td>${esc(c.cuando)}</td><td>${esc(c.nombre.split(' · ').slice(1).join(' · '))}${c.fase === 'fallo' ? ' <span class="neg">· falló</span>' : ''}</td>
          <td><input type="radio" name="c-ver" ${c.id === S.corrida ? 'checked' : ''}></td><td><input type="radio" name="c-cmp" ${c.id === S.corridaComp ? 'checked' : ''}></td></tr>`);
        tr.querySelector('[name=c-ver]').onchange = () => usarCorrida(c.id);
        tr.querySelector('[name=c-cmp]').onchange = () => { S.corridaComp = c.id; bus.emit('seleccion-cambio'); aviso('Las gráficas de la ficha mostrarán también esta corrida.'); };
        $('table', sec).append(tr);
      });
      P().append(sec);
    }
  } catch (e) { /* sin lista */ }
  if (S.resumen) pintarResumen(S.resumen);
}

// lo que dice QUALITY en [OPTIONS], o '' si no hay calidad del agua
function calidadModelo() {
  const q = String(S.M?.opciones?.QUALITY || 'NONE').trim();
  const t = q.split(/\s+/)[0].toUpperCase();
  if (!q || t === 'NONE') return '';
  return t === 'AGE' ? 'edad del agua' : t === 'TRACE' ? `rastreo desde ${q.split(/\s+/)[1] || '?'}` : q;
}

function pintarResumen(r) {
  const cont = h('<div></div>');
  const nodoFalla = r.fallo?.reporte?.[0]?.match(/at node (\S+)/)?.[1];
  if (r.fallo) {
    const t = h(`<div class="tarjeta error"><h3>Falló a las ${hora(r.fallo.hora)}</h3><p>${esc(r.fallo.mensaje)}</p>
      ${nodoFalla ? '<p><b>EPANET dice que la matriz no tiene solución en el nudo</b> <span class="nf"></span>. Casi siempre es una isla (un grupo sin camino a un tanque) o un grupo cerrado por todos lados; mira la Revisión.</p>' : ''}</div>`);
    if (nodoFalla) $('.nf', t).append(enlaceId('nudo', nodoFalla));
    if (r.fallo.islas?.length) {
      const d = h(`<details open><summary>${r.fallo.islas.length} grupos aislados en ese momento</summary><ul class="lista"></ul></details>`);
      r.fallo.islas.slice(0, 10).forEach((isla) => {
        const li = h(`<li><span>${n(isla.nudos.length, 0)} nudos: ${esc(isla.nudos.slice(0, 4).join(', '))}${isla.nudos.length > 4 ? '…' : ''}</span></li>`);
        li.append(botonVer([...isla.nudos.map((id) => ({ clase: 'nudo', id })), ...isla.tramos.map((id) => ({ clase: 'tramo', id }))], 'Ver'));
        $('ul', d).append(li);
      });
      t.append(d);
    }
    if (r.fallo.ultimos?.length) t.append(h(`<details><summary>Lo último que cambió antes del fallo</summary><div class="mono detalle">${r.fallo.ultimos.map(esc).join('<br>')}</div></details>`));
    cont.append(t);
  }
  const bal = r.balance;
  const meta = S.M?.meta_balance ?? 2;
  const dq = (x) => (Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 3);
  const dif = bal?.diferencia_pct;
  const clase = (v, ok, ojo) => (v <= ok ? 'bien' : v <= ojo ? 'ojo' : 'mal');
  cont.append(h(`<div class="cifras" style="margin-top:10px">
    <div class="cifra"><div class="v">${n(r.segundos, 1)}<small>s</small></div><div class="t">cálculo · motor ${esc(r.version)}</div></div>
    <div class="cifra ${clase(r.intermedios / Math.max(1, r.pasos), 0.85, 0.95)}"><div class="v">${n(r.pasos, 0)}</div><div class="t">pasos (${n(r.intermedios, 0)} intermedios)</div></div>
    <div class="cifra ${r.sin_converger ? (r.sin_converger > 100 ? 'mal' : 'ojo') : 'bien'}"><div class="v">${n(r.sin_converger, 0)}</div><div class="t">pasos sin converger (llegan a ${n(r.trials, 0)} iteraciones)</div></div>
    <div class="cifra ${dif === null || dif === undefined ? '' : clase(Math.abs(dif), meta, meta * 2.5)}"><div class="v">${dif === null || dif === undefined ? '—' : `${dif > 0 ? '+' : ''}${n(dif, 2)}`}<small>%</small></div><div class="t">producción vs consumo (meta ±${n(meta, 1)} %)</div></div>
  </div>`));
  if (S.corrida) {
    const b = h('<div class="acciones-fila"><button class="btn chico" data-t="El reporte de EPANET de esta corrida en otra ventana: avisos por elemento, paso a paso y el texto completo con buscador. Cada elemento se puede ver en el mapa.">Leer el reporte de EPANET</button></div>');
    $('button', b).onclick = () => abrirReporte({ corrida: S.corrida, doc: S.doc, nombre: `${S.info?.nombre || 'Modelo'} · corrida` });
    cont.append(b);
  }
  if (bal) {
    const s = h(`<div class="sec"><div class="eti">Producción y consumo (${esc(U('caudal'))})</div><p class="sub" style="margin:4px 0">Producción media ${n(bal.produccion, dq(bal.produccion))} · consumo medio ${n(bal.consumo, dq(bal.consumo))} · a tanques ${n(bal.almacenamiento, dq(bal.almacenamiento))}</p><canvas class="grafica"></canvas></div>`);
    cont.append(s);
    setTimeout(() => grafica($('canvas', s), { series: [{ nombre: 'producción', valores: bal.serie_prod, color: '#f3eeee' }, { nombre: 'consumo', valores: bal.serie_cons, color: '#f5a524' }], horas: r.horas, unidad: U('caudal'), decimales: dq(bal.consumo) }), 0);
  }
  if (r.calidad?.calculada) {
    const [nq, uq] = nombreCalidad(r.calidad);
    cont.append(h(`<div class="tarjeta ${r.calidad.error ? 'error' : 'ok'}" style="margin-top:10px"><h3>Calidad del agua: ${esc(nq)}</h3>
      <p>${r.calidad.error ? esc(r.calidad.error) : `Calculada en ${n(r.calidad.segundos, 1)} s sobre la misma hidráulica. En la barra de tiempo, elige «${esc(nq)}» para verla en el mapa (${esc(uq)}).`}</p></div>`));
  }
  if (r.pasos_por_hora?.length) {
    const s = h('<div class="sec"><div class="eti">Pasos por hora</div><p class="sub" style="margin:4px 0">Si una hora tiene cientos de pasos, algo está abriendo y cerrando ahí.</p><canvas class="mini"></canvas></div>');
    cont.append(s);
    setTimeout(() => barras($('canvas', s), r.pasos_por_hora), 0);
  }
  if (r.avisos?.length) {
    const s = h('<div class="sec"><div class="eti">Avisos de EPANET</div></div>');
    r.avisos.forEach((a) => s.append(h(`<details class="tarjeta" style="padding:8px 12px"><summary><b>${esc(a.texto)}</b> <span class="d" style="color:var(--apagado)">· ${n(a.pasos, 0)} pasos, desde las ${hora(a.primera_h)}</span></summary><p class="detalle">${esc(S.textos.avisos[a.codigo] || '')}</p></details>`)));
    cont.append(s);
  }
  if (r.oscilan_reporte?.length) {
    const s = h('<div class="sec"><div class="eti">Qué está oscilando</div><p class="sub" style="margin:4px 0">Elementos con más cambios de estado en el reporte de EPANET. Un tanque que se llena y se vacía cientos de veces suele tener una entrada sin control.</p><table class="tabla"><tr><th>Elemento</th><th class="n">Cambios</th><th>Ejemplo</th></tr></table></div>');
    r.oscilan_reporte.forEach((o) => {
      const clase = ['Tank', 'Reservoir', 'Junction'].includes(o.clase) ? 'nudo' : 'tramo';
      const i = clase === 'nudo' ? S.idxN.get(o.id) : S.idxL.get(o.id);
      const nom = i === undefined ? '' : (clase === 'nudo' ? S.M.nudos.com[i] : S.M.tramos.com[i]);
      const tr = h(`<tr class="clic"><td>${esc({ Tank: 'Tanque', Pipe: 'Tubería', Pump: 'Bomba', Reservoir: 'Embalse' }[o.clase] || o.clase)} <b>${esc(o.id)}</b>${nom ? `<br><span style="color:var(--apagado)">${esc(nom)}</span>` : ''}</td><td class="n">${n(o.mensajes, 0)}</td><td style="color:var(--tinta-2)">${esc(o.ejemplo)}</td></tr>`);
      tr.onclick = () => bus.emit('ir', { clase, id: o.id });
      $('table', s).append(tr);
    });
    cont.append(s);
  }
  if (r.tanques_limite?.length) {
    const s = h('<div class="sec"><div class="eti">Tanques en el límite</div><p class="sub" style="margin:4px 0">Horas del día en que el tanque está vacío o lleno. Uno siempre vacío no recibe lo que necesita; uno siempre lleno recibe de más.</p><ul class="lista"></ul></div>');
    r.tanques_limite.forEach((t) => {
      const i = S.idxN.get(t.id);
      const li = h(`<li></li>`);
      li.append(enlaceId('nudo', t.id, i !== undefined ? nombreNudo(i) : t.id));
      li.append(h(`<span class="d ${t.estado === 'vacío' ? 'neg' : ''}">${esc(t.estado)} ${n(t.horas, 0)} de ${n(r.horas.length, 0)} muestras</span>`));
      $('ul', s).append(li);
    });
    cont.append(s);
  }
  if (r.presion_minima?.length) {
    const s = h('<div class="sec"><div class="eti">Presiones más bajas del día (nudos con demanda)</div><ul class="lista"></ul></div>');
    r.presion_minima.slice(0, 15).forEach((p) => { const li = h('<li></li>'); li.append(enlaceId('nudo', p.id)); li.append(h(`<span class="d ${p.presion < (S.M?.clases?.presion?.[0] ?? 15) ? 'neg' : ''}">${n(p.presion, 1)} ${esc(U('presion'))}</span>`)); $('ul', s).append(li); });
    cont.append(s);
  }
  P().append(cont);
}

// ====================================================================== Escenario
async function pEscenario() {
  let esc_, cfgQ;
  try { [esc_, { config: cfgQ }] = await Promise.all([get(`/api/doc/${S.doc}/escenario`), get('/api/quinquenio')]); } catch (e) { fallo(e); return; }
  if (panelActual !== 'escenario') return;
  S.esc = esc_;
  const guardarEsc = async () => {
    try { const info = await post(`/api/doc/${S.doc}/escenario`, { escenario: S.esc }); bus.emit('info', info); bus.emit('recargar', { mantener: true }); } catch (e) { fallo(e); }
  };
  P().innerHTML = '';
  P().append(h(`<div><h1>Escenario</h1><p class="sub">Una capa de cambios sobre el archivo base. El .inp se arma al exportar; el original no se toca.</p></div>`));
  const cab = h(`<div class="tarjeta"><label class="campo">Nombre<input id="e-nombre"></label><label class="campo">Notas<textarea id="e-notas" rows="2"></textarea></label>
    <div class="fila"><button class="btn" data-a="guardar">Guardar escenario</button><button class="btn" data-a="exportar">Exportar .inp…</button></div></div>`);
  $('#e-nombre', cab).value = esc_.nombre || '';
  $('#e-notas', cab).value = esc_.notas || '';
  $('#e-nombre', cab).onchange = (e) => { S.esc.nombre = e.target.value; guardarEsc(); };
  $('#e-notas', cab).onchange = (e) => { S.esc.notas = e.target.value; guardarEsc(); };
  $('[data-a=guardar]', cab).onclick = guardarEscenario;
  $('[data-a=exportar]', cab).onclick = exportar;
  P().append(cab);
  if (S.info.avisos?.length) P().append(h(`<div class="tarjeta aviso"><h3>No se pudo aplicar todo</h3>${S.info.avisos.slice(0, 10).map((a) => `<p>${esc(a)}</p>`).join('')}</div>`));
  P().append(seccionQuinquenio(esc_, cfgQ));

  // proyectos
  const seg = (g) => {
    const actual = esc_.proyectos?.[g.clave] || 'base';
    const s = h(`<div class="seg"><button data-v="base">Como está</button><button data-v="prendido" class="verde">Prendido</button><button data-v="apagado" class="rojo">Apagado</button></div>`);
    $$('button', s).forEach((b) => {
      b.classList.toggle('on', b.dataset.v === actual);
      b.onclick = async () => { try { const info = await post(`/api/doc/${S.doc}/proyecto`, { clave: g.clave, accion: b.dataset.v }); bus.emit('info', info); bus.emit('recargar', { mantener: true }); } catch (e) { fallo(e); } };
    });
    return s;
  };
  const filaGrupo = (g) => {
    const d = h(`<div class="grupo"><span class="nom">${esc(g.nombre)}</span><div class="ctl"></div>
      <div class="meta"><span class="chip">${n(g.n, 0)} tramos · ${g.estado === 'apagado' ? 'apagado en el archivo' : g.estado === 'prendido' ? 'prendido en el archivo' : `${n(g.cerrados, 0)} cerrados en el archivo`}</span>${g.horizontes?.length && g.tipo !== 'horizonte' ? `<span class="chip">${esc(g.horizontes.join(', '))}</span>` : ''}</div></div>`);
    const f = d.querySelector('.ctl');
    f.append(seg(g));
    const ver = h('<button class="btn chico" title="Resaltar en el mapa">Ver</button>');
    ver.onclick = () => { S.resaltar = { nudos: new Set(), tramos: new Set(g.tramos) }; mapa.ajustarA(S.resaltar); mapa.pedir(); };
    f.append(ver);
    return d;
  };
  const gs = S.M.grupos;
  P().append(h(`<div class="sec"><div class="eti">Proyectos por horizonte</div><p class="sub" style="margin:4px 0 8px">Prender abre sus tuberías y bombas y deja las válvulas con su consigna. Apagar cierra lo que toca la red existente y deja una sola entrada a cada parte sin tanque, para que EPANET no falle.</p></div>`));
  gs.filter((g) => g.tipo === 'horizonte').forEach((g) => P().append(filaGrupo(g)));
  const sp = h(`<div class="sec"><div class="eti">Proyectos y grupos</div><input id="e-buscar" placeholder="Filtrar por nombre…" style="width:100%;margin:6px 0 8px"><div id="e-grupos"></div></div>`);
  P().append(sp);
  const pintarGrupos = () => {
    const q = $('#e-buscar').value.trim().toLowerCase();
    const caja = $('#e-grupos'); caja.innerHTML = '';
    const lista = gs.filter((g) => g.tipo !== 'horizonte' && (!q || g.nombre.toLowerCase().includes(q)));
    lista.slice(0, 40).forEach((g) => caja.append(filaGrupo(g)));
    if (lista.length > 40) caja.append(h(`<div class="vacio">y ${lista.length - 40} más: escribe para filtrar.</div>`));
  };
  $('#e-buscar').oninput = pintarGrupos;
  pintarGrupos();

  // cambios puntuales
  const cp = h('<div class="sec"><div class="eti">Cambios puntuales</div></div>');
  const lista = (titulo, obj, fmt, quitar) => {
    const ks = Object.keys(obj || {});
    if (!ks.length) return;
    const d = h(`<details class="tarjeta" style="padding:9px 12px" ${ks.length < 12 ? 'open' : ''}><summary><b>${esc(titulo)}</b> · ${n(ks.length, 0)}</summary><ul class="lista"></ul>
      ${ks.length > 1 ? '<button class="btn chico" style="margin-top:6px">Quitar todos</button>' : ''}</details>`);
    ks.slice(0, 60).forEach((k) => {
      const li = h(`<li></li>`);
      li.append(enlaceId(titulo.startsWith('Demandas') ? 'nudo' : 'tramo', k));
      li.append(h(`<span class="d">${esc(fmt(obj[k]))}</span>`));
      const x = h('<button class="x" title="Quitar">×</button>'); x.onclick = () => { delete obj[k]; guardarEsc(); };
      li.append(x);
      $('ul', d).append(li);
    });
    if (ks.length > 60) $('ul', d).append(h(`<li class="vacio">y ${n(ks.length - 60, 0)} más</li>`));
    const b = $('.btn', d); if (b) b.onclick = () => { quitar(); guardarEsc(); };
    cp.append(d);
  };
  lista('Estados', esc_.estados, (v) => v || 'como en el archivo', () => { S.esc.estados = {}; });
  lista('Consignas', esc_.consignas, (v) => `${n(Number(v), 2)}`, () => { S.esc.consignas = {}; });
  lista('Demandas', esc_.demandas, (v) => `${n(Array.isArray(v) ? v[0] : v, 2)} ${U('caudal')}${Array.isArray(v) && v[1] ? ` · ${v[1]}` : ''}`, () => { S.esc.demandas = {}; });
  const opc = h(`<div class="tarjeta" style="padding:10px 12px"><div class="fila">
    <label>Multiplicador de demanda<input id="e-mult" type="number" step="any" style="width:110px" placeholder="1"></label>
    <label>ACCURACY<input id="e-acc" style="width:100px" placeholder="del archivo"></label>
    <label>TRIALS<input id="e-tri" style="width:80px" placeholder="del archivo"></label></div>
    <label class="chk" style="margin-top:8px"><input type="checkbox" id="e-q"> Sin calidad del agua (QUALITY NONE): la corrida es más rápida</label></div>`);
  const opcion = (sec, clave) => (esc_.opciones || []).find((o) => o.seccion === sec && o.clave === clave)?.valor ?? '';
  const ponerOpcion = (sec, clave, valor) => {
    S.esc.opciones = (S.esc.opciones || []).filter((o) => !(o.seccion === sec && o.clave === clave));
    if (valor !== '' && valor !== null) S.esc.opciones.push({ seccion: sec, clave, valor });
    guardarEsc();
  };
  $('#e-mult', opc).value = esc_.multiplicador ?? '';
  $('#e-acc', opc).value = opcion('[OPTIONS]', 'ACCURACY');
  $('#e-tri', opc).value = opcion('[OPTIONS]', 'TRIALS');
  $('#e-q', opc).checked = /^NONE/i.test(opcion('[OPTIONS]', 'QUALITY'));
  $('#e-mult', opc).onchange = (e) => { S.esc.multiplicador = e.target.value === '' ? null : Number(e.target.value); guardarEsc(); };
  $('#e-acc', opc).onchange = (e) => ponerOpcion('[OPTIONS]', 'ACCURACY', e.target.value.trim());
  $('#e-tri', opc).onchange = (e) => ponerOpcion('[OPTIONS]', 'TRIALS', e.target.value.trim());
  $('#e-q', opc).onchange = (e) => ponerOpcion('[OPTIONS]', 'QUALITY', e.target.checked ? 'NONE' : '');
  cp.append(opc);
  P().append(cp);

  // importar
  const imp = h(`<div class="sec"><div class="eti">Importar desde Excel</div><p class="sub" style="margin:4px 0 8px">Demandas por nudo (por ejemplo, la distribución de demanda proyectada) o consignas de válvulas.</p><button class="btn">Elegir Excel…</button></div>`);
  $('button', imp).onclick = importarExcel;
  P().append(imp);
  const scn = h(`<div class="sec"><div class="eti">Escenario de EPANET (.scn)</div><p class="sub" style="margin:4px 0 8px">Lo que EPANET carga con File › Import › Scenario: diámetros, rugosidades, demandas, calidad inicial, reacciones, controles y reglas. Entra como una sola edición: Ctrl+Z lo quita entero.</p><button class="btn">Elegir .scn…</button></div>`);
  $('button', scn).onclick = importarScn;
  P().append(scn);

  // ediciones en el mapa
  const ed = h(`<div class="sec"><div class="eti">Ediciones en el mapa</div>
    <label class="chk" style="margin:6px 0"><input type="checkbox" id="e-editar" ${S.editando ? 'checked' : ''}> Herramientas de edición sobre el mapa (también con el botón «Editar red» o la tecla E)</label></div>`);
  $('#e-editar', ed).onchange = (e) => bus.emit('editar', e.target.checked);
  const eds = esc_.ediciones || [];
  if (eds.length) {
    const ul = h('<ul class="lista"></ul>');
    eds.slice(-25).forEach((o, j) => ul.append(h(`<li><span>${eds.length - Math.min(25, eds.length) + j + 1}. ${esc(describir(o))}</span></li>`)));
    ed.append(ul);
    const b = h('<button class="btn chico" style="margin-top:6px">Deshacer la última</button>');
    b.onclick = () => bus.emit('deshacer');
    ed.append(b);
  } else ed.append(h('<div class="vacio">Sin ediciones todavía. Pulsa «Editar red» sobre el mapa para agregar nudos, tuberías, válvulas, bombas o tanques; también puedes cambiar valores en la ficha de cualquier elemento.</div>'));
  P().append(ed);
}

// columnas de Excel: 0 -> A (para la muestra) y "D" o "4" -> 4 (numeradas desde 1, como en Excel)
const letras = (k) => { let s = ''; k += 1; while (k > 0) { const m = (k - 1) % 26; s = String.fromCharCode(65 + m) + s; k = Math.floor((k - 1) / 26); } return s; };
const col = (x) => { x = String(x).trim().toUpperCase(); if (/^\d+$/.test(x)) return Number(x); let v = 0; for (const c of x) v = v * 26 + (c.charCodeAt(0) - 64); return v; };
const muestraHoja = (hj) => {
  const ancho = Math.max(...hj.muestra.map((r) => r.length), 1);
  return `<table class="tabla"><tr><th>#</th>${Array.from({ length: ancho }, (_, k) => `<th>${letras(k)}</th>`).join('')}</tr>${hj.muestra.map((r, j) => `<tr><td>${j + 1}</td>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table><div class="sub" style="padding:4px 8px">${n(hj.filas, 0)} filas en la hoja</div>`;
};

async function importarExcel() {
  const ruta = await explorar({ titulo: 'Elegir el Excel', filtro: ['.xlsx', '.xlsm'] });
  if (!ruta) return;
  let hojas;
  try { hojas = (await get('/api/excel', { ruta })).hojas; } catch (e) { fallo(e); return; }
  const cuerpo = h(`<div><div class="fila"><label>Hoja<select id="x-hoja">${hojas.map((x) => `<option>${esc(x.nombre)}</option>`).join('')}</select></label>
    <label>Destino<select id="x-dest"><option value="demandas">Demandas de nudos</option><option value="consignas">Consignas de válvulas</option></select></label></div>
    <div id="x-prev" style="overflow:auto;max-height:220px;margin:10px 0;border:1px solid var(--linea);border-radius:8px"></div>
    <div class="fila"><label>Fila de encabezado<input id="x-fila" type="number" value="1" style="width:80px"></label>
    <label>Columna del ID<input id="x-id" value="A" style="width:60px"></label><label>Columna del valor<input id="x-val" value="B" style="width:60px"></label>
    <label>Columna del patrón (opcional)<input id="x-pat" value="" style="width:60px"></label></div>
    <p class="sub" style="margin-top:8px">Solo entran los IDs que existen en el modelo. Los patrones que no existen se ignoran (queda el del nudo).</p></div>`);
  const prev = () => { $('#x-prev', cuerpo).innerHTML = muestraHoja(hojas.find((x) => x.nombre === $('#x-hoja', cuerpo).value)); };
  $('#x-hoja', cuerpo).onchange = prev;
  modal({
    titulo: ruta.split('\\').pop(), cuerpo,
    botones: [{ texto: 'Cancelar' }, {
      texto: 'Importar', clase: 'prim', accion: async () => {
        try {
          const r = await post(`/api/doc/${S.doc}/importar`, {
            ruta, hoja: $('#x-hoja', cuerpo).value, fila: Number($('#x-fila', cuerpo).value || 1), col_id: col($('#x-id', cuerpo).value),
            col_valor: col($('#x-val', cuerpo).value), col_patron: $('#x-pat', cuerpo).value ? col($('#x-pat', cuerpo).value) : null, destino: $('#x-dest', cuerpo).value,
          });
          const i = r.importado;
          aviso(`Importados ${n(i.aplicados, 0)} valores${i.desconocidos ? `; ${n(i.desconocidos, 0)} IDs no están en el modelo (${i.muestra_desconocidos.slice(0, 5).join(', ')}…)` : ''}${i.patrones_ignorados?.length ? `; patrones ignorados: ${i.patrones_ignorados.join(', ')}` : ''}.`, 'ok');
          bus.emit('info', r.info); bus.emit('recargar', { mantener: true });
        } catch (e) { fallo(e); return false; }
      },
    }],
  });
  prev();
}

// Armar quinquenio: un escenario nuevo con las obras hasta ese año prendidas y las de después apagadas, los .scn que
// van desde ese año y la demanda del año (nucleo/quinquenios.py). La configuración es una sola para todos los modelos.
function seccionQuinquenio(esc_, cfg) {
  const anios = S.M.grupos.filter((g) => g.tipo === 'horizonte').map((g) => Number(g.nombre)).filter((a) => a > 0).sort((a, b) => a - b);
  const actual = esc_.quinquenio?.anio;
  const s = h(`<div class="sec"><div class="eti">Armar quinquenio</div>
    <p class="sub" style="margin:4px 0 8px">Un escenario nuevo con las obras hasta ese año prendidas y las de después apagadas, los .scn que van desde ese año y la demanda del año. Antes de armarlo muestra qué va a hacer.</p>
    <div class="fila q-anios"></div><ul class="lista q-cfg" style="margin-top:8px"></ul><div class="fila q-bot" style="margin-top:6px"></div></div>`);
  const fa = $('.q-anios', s);
  if (anios.length) {
    const seg = h('<div class="seg" role="group" aria-label="Año del quinquenio"></div>');
    anios.forEach((a) => { const b = h(`<button>${a}</button>`); b.classList.toggle('on', a === actual); b.onclick = () => vistaQuinquenio(a); seg.append(b); });
    fa.append(seg);
  } else fa.append(h('<span class="sub">Este modelo no tiene obras con año en sus etiquetas (Ajustes › regla del horizonte).</span>'));
  const otro = h(`<input type="number" min="1900" max="2199" placeholder="otro año" aria-label="Otro año" style="width:96px" ${actual && !anios.includes(actual) ? `value="${actual}"` : ''}>`);
  const ver = () => { if (otro.value) vistaQuinquenio(Number(otro.value)); };
  otro.onkeydown = (e) => { if (e.key === 'Enter') ver(); };
  const bv = h('<button class="btn chico">Ver</button>'); bv.onclick = ver;
  fa.append(otro, bv);
  const ul = $('.q-cfg', s);
  cfg.scn.forEach((x, k) => {
    const li = h(`<li><span><b>${esc(x.ruta.split('\\').pop())}</b> · desde ${x.desde}</span></li>`);
    const q = h('<button class="x" title="Quitar">×</button>'); q.onclick = () => guardarCfgQ({ ...cfg, scn: cfg.scn.filter((_, j) => j !== k) });
    li.append(q); ul.append(li);
  });
  const d = cfg.demanda;
  const ld = h(`<li><span>${d ? `<b>Demanda por año</b> · ${esc(d.ruta.split('\\').pop())}: nudos en «${esc(d.hoja_nudos)}», sectores en «${esc(d.hoja_sectores)}»` : '<b>Demanda</b> · la del archivo'}</span></li>`);
  if (d) { const q = h('<button class="x" title="Quitar">×</button>'); q.onclick = () => guardarCfgQ({ ...cfg, demanda: null }); ld.append(q); }
  ul.append(ld);
  const bs = h('<button class="btn chico">Agregar .scn por año…</button>'); bs.onclick = () => agregarScnQ(cfg);
  const bd = h(`<button class="btn chico">${d ? 'Cambiar la demanda…' : 'Demanda por año desde Excel…'}</button>`); bd.onclick = () => configurarDemandaQ(cfg);
  $('.q-bot', s).append(bs, bd);
  if (actual) s.append(h(`<p class="sub" style="margin:8px 0 0">Este escenario es el quinquenio ${actual}${esc_.quinquenio.conservar?.length ? `; ${n(esc_.quinquenio.conservar.length, 0)} tuberías que cambia un .scn nunca se apagan` : ''}.</p>`));
  return s;
}
async function guardarCfgQ(cfg) {
  try { await post('/api/quinquenio', { config: cfg }); mostrarPanel(); } catch (e) { fallo(e); }
}
async function agregarScnQ(cfg) {
  const ruta = await explorar({ titulo: 'Escenario de EPANET que va desde un año', filtro: ['.scn'] });
  if (!ruta) return;
  const v = await formulario('¿Desde qué año?', [{ id: 'desde', etiqueta: 'Se aplica en los quinquenios desde', tipo: 'number',
    ayuda: 'Las tuberías que cambia nunca se apagan: existen antes de ese año (el .scn solo les cambia el diámetro o la rugosidad).' }], 'Agregar');
  if (!v?.desde) return;
  guardarCfgQ({ ...cfg, scn: [...cfg.scn.filter((x) => x.ruta !== ruta), { ruta, desde: v.desde }] });
}
async function configurarDemandaQ(cfg) {
  const ruta = await explorar({ titulo: 'Excel de demanda por año', filtro: ['.xlsx', '.xlsm'] });
  if (!ruta) return;
  let hojas;
  try { hojas = (await get('/api/excel', { ruta })).hojas; } catch (e) { fallo(e); return; }
  const d0 = cfg.demanda?.ruta === ruta ? cfg.demanda : null;
  // una primera propuesta mirando los encabezados (Junction, Sector, Ponderación, Pattern; una fila con años)
  const buscar = (hj, rx) => { for (let f = 0; f < hj.muestra.length; f++) { const c = hj.muestra[f].findIndex((x) => rx.test(x)); if (c >= 0) return [f + 1, c + 1]; } return null; };
  const esAnio = (c) => /^(19|20)\d\d(\.0)?$/.test(c);
  const hn = hojas.find((x) => buscar(x, /ponderaci|peso/i)) || hojas[0];
  const hs = hojas.find((x) => x !== hn && x.muestra.some((r) => r.some(esAnio)) && buscar(x, /sector/i)) || hojas[hojas.length > 1 ? 1 : 0];
  const opc = hojas.map((x) => `<option>${esc(x.nombre)}</option>`).join('');
  const cuerpo = h(`<div>
    <p class="sub" style="margin:0 0 10px">Demanda del nudo = ponderación × demanda de su sector en el año del quinquenio. Si un sector está en varias filas, se suman. Los nudos que no están en la hoja quedan con su demanda del archivo.</p>
    <div class="eti">Nudos</div><div class="fila"><label>Hoja<select id="q-hn">${opc}</select></label><label>Fila de encabezado<input id="q-fn" type="number" style="width:70px"></label></div>
    <div id="q-pn" style="overflow:auto;max-height:170px;margin:8px 0;border:1px solid var(--linea);border-radius:8px"></div>
    <div class="fila"><label>Nudo<input id="q-ci" style="width:52px"></label><label>Sector<input id="q-cs" style="width:52px"></label><label>Ponderación<input id="q-cp" style="width:52px"></label><label>Patrón (opcional)<input id="q-cpat" style="width:52px"></label></div>
    <div class="eti" style="margin-top:14px">Demanda por sector y año</div><div class="fila"><label>Hoja<select id="q-hs">${opc}</select></label><label>Fila con los años<input id="q-fa" type="number" style="width:70px"></label><label>Sector<input id="q-css" style="width:52px"></label></div>
    <div id="q-ps" style="overflow:auto;max-height:170px;margin:8px 0;border:1px solid var(--linea);border-radius:8px"></div></div>`);
  const hoja = (cual) => hojas.find((x) => x.nombre === $(cual === 'n' ? '#q-hn' : '#q-hs', cuerpo).value);
  const proponer = (cual) => {
    const hj = hoja(cual);
    if (cual === 'n') {
      // sector y patrón, primero en la fila del encabezado (al lado puede haber otra tabla con «Sector»)
      const enFila = (f, rx) => { const c = (hj.muestra[f - 1] || []).findIndex((x) => rx.test(x)); return c >= 0 ? [f, c + 1] : null; };
      const j = buscar(hj, /junction|nudo|^;?id$/i), p = buscar(hj, /ponderaci|peso/i), f = (j || p || [1])[0];
      const s_ = enFila(f, /sector/i) || buscar(hj, /sector/i), pt = enFila(f, /pattern|patr/i) || buscar(hj, /pattern|patr/i);
      $('#q-fn', cuerpo).value = f; $('#q-ci', cuerpo).value = letras((j?.[1] || 1) - 1);
      $('#q-cs', cuerpo).value = s_ ? letras(s_[1] - 1) : 'B'; $('#q-cp', cuerpo).value = p ? letras(p[1] - 1) : 'C'; $('#q-cpat', cuerpo).value = pt ? letras(pt[1] - 1) : '';
    } else {
      const fa = hj.muestra.findIndex((r) => r.some(esAnio)), s_ = buscar(hj, /sector/i);
      $('#q-fa', cuerpo).value = fa >= 0 ? fa + 1 : 1; $('#q-css', cuerpo).value = s_ ? letras(s_[1] - 1) : 'A';
    }
  };
  const pintar = (cual) => { $(cual === 'n' ? '#q-pn' : '#q-ps', cuerpo).innerHTML = muestraHoja(hoja(cual)); };
  $('#q-hn', cuerpo).value = d0?.hoja_nudos && hojas.some((x) => x.nombre === d0.hoja_nudos) ? d0.hoja_nudos : hn.nombre;
  $('#q-hs', cuerpo).value = d0?.hoja_sectores && hojas.some((x) => x.nombre === d0.hoja_sectores) ? d0.hoja_sectores : hs.nombre;
  if (d0) {
    $('#q-fn', cuerpo).value = d0.fila_nudos; $('#q-ci', cuerpo).value = letras(d0.col_id - 1); $('#q-cs', cuerpo).value = letras(d0.col_sector - 1);
    $('#q-cp', cuerpo).value = letras(d0.col_peso - 1); $('#q-cpat', cuerpo).value = d0.col_patron ? letras(d0.col_patron - 1) : '';
    $('#q-fa', cuerpo).value = d0.fila_anios; $('#q-css', cuerpo).value = letras(d0.col_sector_s - 1);
  } else { proponer('n'); proponer('s'); }
  $('#q-hn', cuerpo).onchange = () => { proponer('n'); pintar('n'); };
  $('#q-hs', cuerpo).onchange = () => { proponer('s'); pintar('s'); };
  modal({
    titulo: ruta.split('\\').pop(), cuerpo,
    botones: [{ texto: 'Cancelar' }, {
      texto: 'Guardar', clase: 'prim', accion: async () => {
        const demanda = { ruta, hoja_nudos: $('#q-hn', cuerpo).value, fila_nudos: Number($('#q-fn', cuerpo).value || 1), col_id: col($('#q-ci', cuerpo).value),
          col_sector: col($('#q-cs', cuerpo).value), col_peso: col($('#q-cp', cuerpo).value), col_patron: $('#q-cpat', cuerpo).value.trim() ? col($('#q-cpat', cuerpo).value) : null,
          hoja_sectores: $('#q-hs', cuerpo).value, fila_anios: Number($('#q-fa', cuerpo).value || 1), col_sector_s: col($('#q-css', cuerpo).value) };
        if (![demanda.col_id, demanda.col_sector, demanda.col_peso, demanda.col_sector_s].every((x) => x > 0)) {
          fallo(new Error('Faltan columnas: nudo, sector, ponderación y el sector de la hoja de años.')); return false;
        }
        await guardarCfgQ({ ...cfg, demanda });
      },
    }],
  });
  pintar('n'); pintar('s');
}
function resumenQuinquenio(r) {
  const li = [];
  const lista = (xs) => xs.map((x) => `${x.anio} (${n(x.tramos, 0)} tramos)`).join(', ');
  if (r.prendidos.length) li.push(`<b>Prende</b> ${esc(lista(r.prendidos))}. Sus bombas quedan como en el archivo: las prenden y apagan sus reglas.`);
  if (r.apagados.length) li.push(`<b>Apaga</b> ${esc(lista(r.apagados))}: cierra lo que toca la red existente y deja una sola entrada a cada parte sin tanque.`);
  if (!r.prendidos.length && !r.apagados.length) li.push('No hay obras con año en las etiquetas: no prende ni apaga nada.');
  if (r.conservados) li.push(`<b>Conserva</b> ${n(r.conservados, 0)} tuberías de después de ${r.anio} porque las cambia un .scn: existen antes de su año.`);
  r.scn.forEach((x) => li.push(x.error ? `<b>${esc(x.nombre)}</b>: ${esc(x.error)}`
    : `<b>${esc(x.nombre)}</b> (desde ${x.desde}): ${x.aplica ? `se aplica a ${n(x.tuberias, 0)} tuberías${x.omitidos ? `, sin ${n(x.omitidos, 0)} que no están en el modelo` : ''}` : 'todavía no se aplica'}.`));
  const d = r.demanda;
  if (!d) li.push('<b>Demanda</b>: la del archivo.');
  else if (d.encontrado) {
    li.push(`<b>Demanda ${r.anio}</b> (${esc(d.archivo)}): ${n(d.nudos, 0)} nudos, de ${n(d.antes, 0)} a ${n(d.despues, 0)} ${U('caudal')}`
      + (d.sin_sector_n ? `; ${n(d.sin_sector_n, 0)} nudos con un sector que no está en la hoja de sectores quedan como en el archivo (${esc(d.sin_sector.slice(0, 4).join(', '))}${d.sin_sector_n > 4 ? '…' : ''})` : '')
      + (d.desconocidos ? `; ${n(d.desconocidos, 0)} no están en el modelo` : '') + '.');
  }
  return `<ul class="lista">${li.map((x) => `<li><span>${x}</span></li>`).join('')}</ul>`
    + (r.avisos.length ? `<div class="tarjeta aviso" style="margin-top:10px"><h3>Revisa</h3>${r.avisos.map((a) => `<p>${esc(a)}</p>`).join('')}</div>` : '');
}
async function vistaQuinquenio(anio) {
  let r;
  try { r = (await post(`/api/doc/${S.doc}/quinquenio`, { anio })).resumen; } catch (e) { fallo(e); return; }
  const cuerpo = h(`<div><label class="campo">Nombre del escenario<input id="q-nombre"></label>${resumenQuinquenio(r)}
    <p class="sub" style="margin-top:10px">${S.info?.sin_guardar ? '<b>El escenario actual tiene cambios sin guardar y se reemplaza por este.</b> Guárdalo antes si lo necesitas. ' : S.info?.cambios ? 'Reemplaza el escenario actual (si está guardado, sigue en su archivo). ' : ''}El .inp no se toca. Después: Revisión y Correr; Ctrl+S lo guarda como escenario.</p></div>`);
  $('#q-nombre', cuerpo).value = `Quinquenio ${anio}`;
  modal({
    titulo: `Quinquenio ${anio}`, cuerpo,
    botones: [{ texto: 'Cancelar' }, {
      texto: 'Armar', clase: 'prim', accion: async (m) => {
        const b = $('footer .prim', m); b.disabled = true; b.textContent = 'Armando…';
        try {
          const x = await post(`/api/doc/${S.doc}/quinquenio`, { anio, armar: true, nombre: $('#q-nombre', cuerpo).value });
          aviso(`${x.info.escenario} armado. Pasa por Revisión y Correr; Ctrl+S lo guarda como escenario.`, 'ok');
          bus.emit('info', x.info); bus.emit('recargar', { mantener: true });
        } catch (e) { b.disabled = false; b.textContent = 'Armar'; fallo(e); return false; }
      },
    }],
  });
}

// Escenario de EPANET (.scn): primero lo que haría (de qué a qué valor), después se aplica como una sola edición
const valorScn = (x) => n(x, Number.isInteger(x) ? 0 : 2);
const longitudScn = (x) => (U('longitud') === 'm' && x >= 1000 ? `${n(x / 1000, 1)} km` : `${n(x, 0)} ${U('longitud')}`);
function seccionScn(s) {
  // [qué hace, detalles] de una sección del resumen del servidor
  const ya = s.elementos - s.cambian;
  const yaTxt = ya > 0 ? ` · ${n(ya, 0)} ya ${ya === 1 ? 'tiene' : 'tienen'} ese valor` : '';
  if (s.clave === 'DIAMETERS' || s.clave === 'ROUGHNESS') {
    const uni = s.clave === 'DIAMETERS' ? ` ${U('diametro')}` : '';
    return [`${n(s.elementos, 0)} ${s.elementos === 1 ? 'tubería' : 'tuberías'} · ${longitudScn(s.longitud)}${yaTxt}`,
      s.grupos.map(([de, a, k, lon]) => `${n(k, 0)} de ${valorScn(de)} a ${valorScn(a)}${uni} (${longitudScn(lon)})`)];
  }
  if (s.clave === 'DEMANDS') {
    return [`${n(s.elementos, 0)} ${s.elementos === 1 ? 'nudo' : 'nudos'}${yaTxt}`,
      [`demanda base de esos nudos: de ${valorScn(s.antes)} a ${valorScn(s.despues)} ${U('caudal')}`, ...(s.categorias ? [`${n(s.categorias, 0)} con varias categorías`] : [])]];
  }
  if (s.clave === 'QUALITY') return [`${n(s.elementos, 0)} ${s.elementos === 1 ? 'nudo' : 'nudos'}${yaTxt}`, []];
  if (s.clave === 'REACTIONS') return [`${n(s.elementos, 0)} ${s.elementos === 1 ? 'coeficiente' : 'coeficientes'}${yaTxt}`, []];
  const [uno, varios, el, los_] = s.clave === 'CONTROLS' ? ['control', 'controles', 'el', 'los'] : ['regla', 'reglas', 'la', 'las'];
  const los = (k) => (k === 1 ? `${el} ${uno}` : `${los_} ${n(k, 0)} ${varios}`);
  if (!s.antes && !s.despues) return ['viene vacía y el modelo no tiene: no cambia nada', []];
  return [!s.antes ? `agrega ${n(s.despues, 0)} ${s.despues === 1 ? uno : varios}` : !s.despues ? `quita ${los(s.antes)} que hay`
    : `reemplaza ${los(s.antes)} que hay por ${n(s.despues, 0)}`, []];
}
async function importarScn() {
  const ruta = await explorar({ titulo: 'Escenario de EPANET', filtro: ['.scn'] });
  if (!ruta) return;
  let r;
  try { r = (await post(`/api/doc/${S.doc}/scn`, { ruta })).resumen; } catch (e) { fallo(e); return; }
  const cuerpo = h('<div></div>');
  if (r.notas) cuerpo.append(h(`<p class="sub" style="white-space:pre-line;margin:0 0 10px">${esc(r.notas)}</p>`));
  if (r.secciones.length) {
    const ul = h('<ul class="lista"></ul>');
    r.secciones.forEach((s) => {
      const [que, det] = seccionScn(s);
      ul.append(h(`<li><span><b>${esc(s.titulo)}</b> · ${esc(que)}${det.map((t) => `<br><span class="sub">${esc(t)}</span>`).join('')}</span></li>`));
    });
    cuerpo.append(ul);
  } else cuerpo.append(h('<div class="vacio">No trae ninguna sección que Cauce sepa aplicar.</div>'));
  const prob = [];
  if (r.faltan.length) prob.push(`<p><b>${n(r.faltan.length, 0)} ${r.faltan.length === 1 ? 'elemento no sirve' : 'elementos no sirven'} en este modelo</b> (se puede aplicar sin ${r.faltan.length === 1 ? 'él' : 'ellos'}): ${esc(r.faltan.slice(0, 12).map(([, id, m]) => `${id} (${m})`).join(', '))}${r.faltan.length > 12 ? '…' : ''}</p>`);
  if (r.desconocidas.length) prob.push(`<p><b>Secciones que Cauce no aplica:</b> ${esc(r.desconocidas.join(', '))}</p>`);
  if (r.malas.length) prob.push(`<p><b>Líneas que no se entienden (no se aplican):</b></p><div class="texto-inp">${esc(r.malas.slice(0, 12).map(([k, t, m]) => `línea ${k}: ${t.trim()}  → ${m}`).join('\n'))}${r.malas.length > 12 ? `\ny ${r.malas.length - 12} más` : ''}</div>`);
  if (prob.length) cuerpo.append(h(`<div class="tarjeta aviso" style="margin-top:12px"><h3>Revisa antes de aplicar</h3>${prob.join('')}</div>`));
  cuerpo.append(h('<p class="sub" style="margin-top:10px">Queda como una edición del escenario (Ctrl+Z la quita entera) y se resalta en el mapa. El .inp no se toca.</p>'));
  // la ventana queda abierta mientras EPANET 2.2 revisa el resultado (unos segundos en un modelo grande)
  const aplicar = r.secciones.length ? [{ texto: r.faltan.length ? `Aplicar sin ${r.faltan.length === 1 ? 'ese' : `esos ${n(r.faltan.length, 0)}`}` : 'Aplicar', clase: 'prim',
    accion: async (m) => { const b = $('footer .prim', m); b.disabled = true; b.textContent = 'Aplicando…'; await aplicarScn(ruta, r, false); } }] : [];
  modal({ titulo: ruta.split('\\').pop(), cuerpo, botones: [{ texto: 'Cancelar' }, ...aplicar] });
}
async function aplicarScn(ruta, r, forzar) {
  try {
    const x = await post(`/api/doc/${S.doc}/scn`, { ruta, aplicar: true, omitir: r.faltan.length > 0, forzar });
    if (!x.ok) {
      modal({ titulo: 'EPANET no aceptaría este escenario', cuerpo: `<div class="texto-inp">${esc(x.errores.join('\n'))}</div><p class="sub" style="margin-top:10px">No se aplicó nada. Puedes aplicarlo igual y arreglar después (Ctrl+Z lo quita).</p>`,
        botones: [{ texto: 'Cancelar' }, { texto: 'Aplicar igual', clase: 'peligro', accion: () => { aplicarScn(ruta, r, true); } }] });
      return;
    }
    (x.avisos || []).forEach((a) => aviso(a));
    aviso(`${ruta.split('\\').pop()} aplicado: ${textoScn(x.hechos)}${x.omitidos ? `; quedaron fuera ${n(x.omitidos, 0)} que no sirven en este modelo` : ''}. Ctrl+Z lo deshace.`, 'ok');
    bus.emit('info', x.info);
    resaltar([...r.nudos.map((id) => ({ clase: 'nudo', id })), ...r.tramos.map((id) => ({ clase: 'tramo', id }))]);
    bus.emit('recargar', { mantener: true });
  } catch (e) { fallo(e); }
}

// ====================================================================== Consignas
async function pConsignas() {
  P().innerHTML = `<h1>Consignas de las FCV</h1><p class="sub">Se corre el modelo en estático con todos los patrones de demanda en 1, para ver cuánto le pide la red a cada tanque en promedio, y se ajustan las válvulas que lo llenan. Es un punto de partida: después, corre las 24 h y revisa el balance.</p>
    <div class="tarjeta"><div class="fila"><label>Margen sobre lo que falta (%)<input id="k-margen" type="number" value="5" style="width:90px"></label>
    <label>Motor<select id="k-motor"><option value="2.3">2.3</option><option value="2.2">2.2</option></select></label></div>
    <button class="btn prim" id="k-calc" style="margin-top:10px">Calcular</button></div><div id="k-res"></div>`;
  $('#k-motor').value = S.motor;
  $('#k-calc').onclick = async () => {
    const res = $('#k-res');
    res.innerHTML = `<p class="sub" style="margin:12px 0 0"><span class="cargando"></span> Corriendo en estático…</p>${esqueleto(7)}`;
    try {
      const r = await post(`/api/doc/${S.doc}/consignas`, { motor: $('#k-motor').value, margen: Number($('#k-margen').value || 0) / 100 });
      S.consignas = r;
      pintarConsignas(r);
    } catch (e) { res.innerHTML = ''; fallo(e); }
  };
  if (S.consignas) pintarConsignas(S.consignas);
}

function pintarConsignas(r) {
  const res = $('#k-res'); res.innerHTML = '';
  res.append(h(`<div class="cifras" style="margin:10px 0">
    <div class="cifra"><div class="v">${n(r.produccion, r.produccion >= 100 ? 0 : 2)}<small>${esc(r.unidades)}</small></div><div class="t">producción media</div></div>
    <div class="cifra"><div class="v">${n(r.consumo, r.consumo >= 100 ? 0 : 2)}<small>${esc(r.unidades)}</small></div><div class="t">consumo medio (patrones en 1)</div></div></div>`));
  res.append(h('<p class="nota">Rojo: el tanque pierde agua en promedio (la FCV debe subir). Verde: gana de más (puede bajar). Marca las propuestas que quieras y aplícalas al escenario; después corre las 24 h y revisa el balance.</p>'));
  const tab = h(`<table class="tabla"><tr><th></th><th>Tanque · válvula</th><th class="n">Neto / caudal</th><th class="n">Consigna (${esc(r.unidades)})</th></tr></table>`);
  r.tanques.forEach((t) => {
    const tr = h(`<tr class="clic"><td></td><td><b>${esc(t.nombre || t.tanque)}</b></td><td class="n ${t.neto < -1 ? 'neg' : t.neto > 1 ? 'pos' : ''}">${n(t.neto, 1)}</td><td></td></tr>`);
    tr.onclick = () => bus.emit('ir', { clase: 'nudo', id: t.tanque });
    tab.append(tr);
    t.valvulas.forEach((v) => {
      const cambia = v.propuesta !== null && Math.abs(v.propuesta - v.consigna) > 0.5;
      const fv = h(`<tr><td>${cambia ? `<input type="checkbox" data-v="${esc(v.valvula)}" data-p="${v.propuesta}" checked>` : ''}</td>
        <td style="padding-left:14px">${esc(v.valvula)}<br><span style="color:var(--apagado)">${esc(v.nombre)}</span>${v.cerrada ? ' <span class="chip">cerrada</span>' : ''}</td>
        <td class="n" style="color:var(--apagado)">${n(v.caudal, 1)}</td>
        <td class="n">${n(v.consigna, 0)}${cambia ? ` → <b>${n(v.propuesta, 0)}</b>` : ''}</td></tr>`);
      tab.append(fv);
    });
  });
  const caja = h('<div style="max-height:52vh;overflow:auto;border:1px solid var(--linea);border-radius:8px"></div>');
  caja.append(tab);
  res.append(caja);
  const b = h('<button class="btn prim" style="margin-top:10px">Aplicar las marcadas al escenario</button>');
  b.onclick = async () => {
    const esc_ = await get(`/api/doc/${S.doc}/escenario`);
    let k = 0;
    $$('input[data-v]', tab).forEach((c) => { if (c.checked) { esc_.consignas = esc_.consignas || {}; esc_.consignas[c.dataset.v] = Number(c.dataset.p); k++; } });
    if (!k) { aviso('No hay propuestas marcadas.'); return; }
    try { const info = await post(`/api/doc/${S.doc}/escenario`, { escenario: esc_ }); bus.emit('info', info); bus.emit('recargar', { mantener: true }); aviso(`${k} consignas aplicadas al escenario «${info.escenario}».`, 'ok'); } catch (e) { fallo(e); }
  };
  res.append(b);
  if (r.sin_valvula.length) {
    const s = h('<details class="sec"><summary class="eti">Tanques que pierden o ganan sin FCV que los llene</summary><ul class="lista"></ul></details>');
    r.sin_valvula.forEach((t) => { const li = h('<li></li>'); li.append(enlaceId('nudo', t.tanque, t.nombre || t.tanque)); li.append(h(`<span class="d ${t.neto < 0 ? 'neg' : 'pos'}">${n(t.neto, 1)} L/s</span>`)); $('ul', s).append(li); });
    res.append(s);
  }
}

// ====================================================================== Comparar
async function pComparar() {
  const otros = S.docs.filter((d) => d.id !== S.doc);
  P().innerHTML = `<h1>Comparar versiones</h1><p class="sub">Qué entra, qué sale y qué cambia entre el modelo abierto y otro.</p>
    <div class="tarjeta"><label class="campo">Comparar con<select id="m-otro">${otros.map((d) => `<option value="${d.id}">${esc(d.nombre)} · ${esc(d.escenario)}</option>`).join('')}<option value="__archivo">Elegir un archivo .inp…</option></select></label>
    <label class="campo">¿Cuál es la referencia?<select id="m-sentido"><option value="otro_es_referencia">El otro (lo nuevo es lo que tiene este modelo)</option><option value="abierto_es_referencia">Este (lo nuevo es lo que tiene el otro)</option></select></label>
    <button class="btn prim" id="m-ir">Comparar</button></div><div id="m-res"></div>`;
  $('#m-ir').onclick = async () => {
    let cuerpo = { sentido: $('#m-sentido').value };
    if ($('#m-otro').value === '__archivo') { const r = await explorar({ titulo: 'Comparar con…', filtro: ['.inp'] }); if (!r) return; cuerpo.ruta = r; } else cuerpo.otro = $('#m-otro').value;
    $('#m-res').innerHTML = esqueleto(6);
    try {
      S.comparacion = await post(`/api/doc/${S.doc}/comparar`, cuerpo);
      bus.emit('comparacion');
      pintarComparacion();
    } catch (e) { $('#m-res').innerHTML = ''; fallo(e); }
  };
  if (S.comparacion) pintarComparacion();
}

function pintarComparacion() {
  const c = S.comparacion, res = $('#m-res'); res.innerHTML = '';
  const refOtro = c.referencia === 'otro';
  res.append(h(`<p class="nota">Referencia: <b>${esc(refOtro ? c.nombre_otro : S.info.nombre)}</b>. En el mapa, verde es lo que solo está en el modelo abierto y rojo punteado lo que solo está en el otro.</p>`));
  const bloque = (titulo, items, clase, fmt, todos) => {
    if (!items?.length) return;
    const d = h(`<details class="tarjeta" style="padding:9px 12px"><summary><b>${esc(titulo)}</b> · ${n(items.length, 0)}</summary><ul class="lista"></ul></details>`);
    items.slice(0, 80).forEach((x) => { const li = h('<li></li>'); const id = typeof x === 'string' ? x : x.id; if (clase) li.append(enlaceId(clase, id)); else li.append(h(`<span>${esc(id)}</span>`)); if (fmt) li.append(h(`<span class="d">${esc(fmt(x))}</span>`)); $('ul', d).append(li); });
    if (items.length > 80) $('ul', d).append(h(`<li class="vacio">y ${n(items.length - 80, 0)} más</li>`));
    if (todos && clase) { const b = botonVer(items.map((x) => ({ clase, id: typeof x === 'string' ? x : x.id })), 'Resaltar todos'); b.style.marginTop = '6px'; d.append(b); }
    res.append(d);
  };
  const enAbierto = (lista) => lista; // los que existen en el modelo abierto se pueden señalar
  bloque('Opciones distintas', c.opciones, null, (x) => `${x.seccion} ${x.clave}: ${x.a} → ${x.b}`);
  bloque('Cantidad de elementos por sección', c.conteos, null, (x) => `${x.seccion}: ${x.a} → ${x.b}`);
  bloque('Tramos nuevos', c.tramos_nuevos, refOtro ? 'tramo' : null, null, refOtro);
  bloque('Tramos quitados', c.tramos_quitados, refOtro ? null : 'tramo', null, !refOtro);
  bloque('Tramos que cambian de estado inicial', c.tramos_estado, 'tramo', (x) => `${x.a} → ${x.b}`, true);
  bloque('Tramos con otra geometría', c.tramos_geometria, 'tramo', (x) => Object.entries(x.cambios).map(([k, [a, b]]) => `${k} ${a}→${b}`).join(' · '), true);
  bloque('Válvulas con otra consigna', c.tramos_consigna, 'tramo', (x) => `${x.a} → ${x.b}`, true);
  bloque('Nudos nuevos', enAbierto(c.nudos_nuevos), refOtro ? 'nudo' : null, null, refOtro);
  bloque('Nudos quitados', c.nudos_quitados, refOtro ? null : 'nudo');
  bloque('Nudos movidos', c.nudos_movidos, 'nudo', (x) => `${n(x.metros, 2)} ${U('longitud')}`, true);
  bloque('Nudos con otros datos', c.nudos_cambiados, 'nudo', (x) => Object.entries(x.cambios).map(([k, [a, b]]) => `${k} ${a}→${b}`).join(' · '), true);
  bloque('Reglas nuevas', c.reglas_nuevas?.map((r) => ({ id: r.nombre, t: r.texto.slice(1).join(' / ') })), null, (x) => x.t);
  bloque('Reglas quitadas', c.reglas_quitadas?.map((r) => ({ id: r.nombre, t: r.texto.slice(1).join(' / ') })), null, (x) => x.t);
  bloque('Reglas cambiadas', c.reglas_cambiadas?.map((r) => ({ id: r.nombre, t: r.b.slice(1).join(' / ') })), null, (x) => x.t);
  bloque('Controles nuevos', c.controles_nuevos?.map((t) => ({ id: t })), null);
  bloque('Controles quitados', c.controles_quitados?.map((t) => ({ id: t })), null);
  if (!Object.values(c.resumen).some((v) => v)) res.append(h('<div class="tarjeta ok"><h3>Son iguales</h3><p>No encontré diferencias en elementos, estados, opciones ni reglas.</p></div>'));
}

// ====================================================================== Ajustes
// versión instalada, la publicada y lo que pasó la última vez que Cauce intentó actualizarse
function tarjetaVersion() {
  const t = h('<div class="tarjeta"><h3>Versión de Cauce</h3><div class="v-cont"><p>Buscando…</p></div><div class="acciones"><button class="btn chico">Buscar ahora</button></div></div>');
  const pintarV = async () => {
    const c = $('.v-cont', t);
    try {
      const r = await post('/api/actualizaciones', {});
      const u = r.ultimo;
      const fallo_ = u?.estado === 'error' ? `<p class="neg">La última vez que intentó actualizarse (${esc(u.cuando || '')}) no pudo: ${esc(u.motivo || '')}. Revisa la conexión a internet o que la carpeta de Cauce se pueda escribir.</p>` : '';
      c.innerHTML = `<p>Tienes la <b>${esc(r.version)}</b>.${r.desarrollo ? ' Esta es una copia de desarrollo: se actualiza con git.' : r.apagada ? ' La actualización automática está apagada.' : ''}</p>
        ${r.error ? `<p class="neg">No se pudo consultar GitHub: ${esc(r.error)}.</p>` : r.nueva ? `<p><b>Hay una versión nueva, la ${esc(r.nueva)}.</b> Cierra Cauce con Salir y vuelve a abrirlo: se instala sola al abrir.</p>` : `<p>Estás al día (lo último publicado es la ${esc(r.remota || r.version)}).</p>`}
        ${fallo_}`;
    } catch (e) { c.innerHTML = `<p class="neg">${esc(e.message)}</p>`; }
  };
  $('button', t).onclick = pintarV;
  pintarV();
  return t;
}

async function pAjustes() {
  let r;
  try { r = await get('/api/ajustes'); } catch (e) { fallo(e); return; }
  if (panelActual !== 'ajustes') return;
  const presets = r.presets, sis = S.M?.sistema;
  P().innerHTML = '';
  P().append(h('<div><h1>Ajustes</h1><p class="sub">Cómo lee Cauce los modelos de tu organización. Se guardan en este equipo y valen para todos los modelos.</p></div>'));
  if (sis) {
    P().append(h(`<div class="nota">Este modelo trae sus unidades en el .inp: caudal en <b>${esc(sis.caudal)}</b>, longitudes y cotas en <b>${esc(sis.longitud)}</b>,
      diámetros en <b>${esc(sis.diametro)}</b>, presión en <b>${esc(sis.presion)}</b>, velocidad en <b>${esc(sis.velocidad)}</b>; rugosidad: ${esc(sis.rugosidad)}.
      Cauce las usa tal cual, sin convertir.</div>`));
  }
  const f = h(`<form class="tarjeta" autocomplete="off">
    <label class="campo">Punto de partida<select id="a-preset">${Object.entries(presets).map(([k, p]) => `<option value="${k}">${esc(p.nombre)}</option>`).join('')}<option value="propio">Personalizado</option></select></label>
    <div class="eti" style="margin:14px 0 6px">Proyectos</div>
    <label class="campo">Horizonte: expresión regular sobre la etiqueta del tramo; el primer grupo es el año
      <input id="a-horizonte" class="mono" placeholder="(?<!\\d)((?:19|20)\\d{2})(?!\\d)"></label>
    <label class="campo">Proyecto: expresión regular sobre el ID del tramo; el primer grupo es el nombre (vacío = no agrupar por ID)
      <input id="a-proyecto" class="mono" placeholder="^(PN-\\d+)"></label>
    <div id="a-prueba" class="nota" style="margin-top:0"></div>
    <div class="eti" style="margin:14px 0 6px">Elementos nuevos</div>
    <div class="fila"><label>Sufijos al meter una válvula<span class="fila"><input id="a-sv1" style="width:80px"><input id="a-sv2" style="width:80px"></span></label>
      <label>Sufijos al meter una bomba<span class="fila"><input id="a-sb1" style="width:80px"><input id="a-sb2" style="width:80px"></span></label></div>
    <div class="fila" style="margin-top:10px">${['nudo', 'tuberia', 'valvula', 'bomba', 'tanque', 'embalse'].map((k) => `<label>Prefijo ${{ tuberia: 'tubería', valvula: 'válvula' }[k] || k}<input id="a-p-${k}" style="width:72px"></label>`).join('')}</div>
    <div class="eti" style="margin:14px 0 6px">Mapa y resultados</div>
    <label class="campo">Cortes de las clases de presión, en unidades de presión del modelo (vacío = según las unidades)<input id="a-cp" class="mono" placeholder="${esc((S.M?.clases?.presion || []).join(', '))}"></label>
    <label class="campo">Cortes de las clases de velocidad (vacío = según las unidades)<input id="a-cv" class="mono" placeholder="${esc((S.M?.clases?.velocidad || []).join(', '))}"></label>
    <label class="campo">Meta del balance producción/consumo (± %)<input id="a-meta" type="number" step="any" style="width:100px"></label>
    <div class="fila" style="margin-top:6px"><button class="btn prim" type="submit">Guardar ajustes</button><button class="btn" type="button" id="a-probar">Probar con el modelo abierto</button></div>
  </form>`);
  P().append(f);
  const val = (id) => $(`#${id}`, f).value.trim();
  const lista = (t) => t.split(/[;,\s]+/).filter(Boolean).map(Number).filter((x) => Number.isFinite(x));
  const poner = (c) => {
    $('#a-horizonte', f).value = c.horizonte || ''; $('#a-proyecto', f).value = c.proyecto || '';
    $('#a-sv1', f).value = c.sufijos_valvula[0]; $('#a-sv2', f).value = c.sufijos_valvula[1];
    $('#a-sb1', f).value = c.sufijos_bomba[0]; $('#a-sb2', f).value = c.sufijos_bomba[1];
    for (const k of Object.keys(c.prefijos)) { const x = $(`#a-p-${k}`, f); if (x) x.value = c.prefijos[k]; }
    $('#a-cp', f).value = (c.clases_presion || []).join(', '); $('#a-cv', f).value = (c.clases_velocidad || []).join(', ');
    $('#a-meta', f).value = c.meta_balance;
  };
  const leer = () => ({
    nombre: $('#a-preset', f).selectedOptions[0].textContent, horizonte: val('a-horizonte'), proyecto: val('a-proyecto'),
    sufijos_valvula: [val('a-sv1'), val('a-sv2')], sufijos_bomba: [val('a-sb1'), val('a-sb2')],
    prefijos: Object.fromEntries(['nudo', 'tuberia', 'valvula', 'bomba', 'tanque', 'embalse'].map((k) => [k, val(`a-p-${k}`)])),
    clases_presion: lista(val('a-cp')), clases_velocidad: lista(val('a-cv')), clases_unidad: S.M?.sistema?.presion || '', meta_balance: Number(val('a-meta') || 2),
  });
  const presetDe = (c) => Object.entries(presets).find(([, p]) => p.horizonte === c.horizonte && p.proyecto === c.proyecto && JSON.stringify(p.clases_presion) === JSON.stringify(c.clases_presion))?.[0] || 'propio';
  poner(r.convenciones);
  $('#a-preset', f).value = presetDe(r.convenciones);
  $('#a-preset', f).onchange = (e) => { if (presets[e.target.value]) { poner(presets[e.target.value]); probar(); } };
  let espera = null;
  const probar = async () => {
    const caja = $('#a-prueba', f);
    if (!S.doc) { caja.textContent = 'Abre un modelo para ver qué encuentra cada regla.'; return; }
    try {
      const p = await post('/api/ajustes/probar', { convenciones: leer(), doc: S.doc });
      caja.innerHTML = `En <b>${esc(S.info.nombre)}</b>: ${p.horizontes.length ? `horizontes <b>${esc(p.horizontes.join(', '))}</b>` : 'ningún horizonte'} ·
        ${p.proyectos.length ? `<b>${n(p.proyectos.length, 0)}</b> proyectos por ID (${esc(p.proyectos.slice(0, 6).join(', '))}${p.proyectos.length > 6 ? '…' : ''})` : 'ningún proyecto por ID'} ·
        ${n(p.etiquetas, 0)} grupos por etiqueta.`;
    } catch (e) { caja.textContent = e.message; }
  };
  f.addEventListener('input', (e) => { if (e.target.id !== 'a-preset') $('#a-preset', f).value = presetDe(leer()); clearTimeout(espera); espera = setTimeout(probar, 350); });
  $('#a-probar', f).onclick = probar;
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await post('/api/ajustes', { convenciones: leer() });
      aviso('Ajustes guardados. Los modelos abiertos se rearmaron con ellos.', 'ok');
      S.hallazgos = null;
      bus.emit('recargar', { mantener: true });
    } catch (ex) { fallo(ex); }
  };
  probar();
  P().append(tarjetaVersion());      // al fondo de Ajustes: la versión que tiene instalada y si hay una nueva
}

// ====================================================================== Glosario
function pGlosario() {
  const T = S.textos;
  P().innerHTML = `<h1>Glosario</h1><p class="sub">Qué significa cada cosa, en las palabras del día a día.</p><input id="g-q" placeholder="Buscar…" style="width:100%;margin-bottom:12px"><div id="g-l"></div>`;
  const pintar = () => {
    const q = $('#g-q').value.trim().toLowerCase();
    const l = $('#g-l'); l.innerHTML = '';
    const sec = (titulo, pares) => {
      const f = pares.filter(([a, b]) => !q || a.toLowerCase().includes(q) || b.toLowerCase().includes(q));
      if (!f.length) return;
      l.append(h(`<div class="eti" style="margin:14px 0 6px">${esc(titulo)}</div>`));
      f.forEach(([a, b]) => l.append(h(`<div class="tarjeta" style="padding:9px 12px"><h3>${esc(a)}</h3><p style="margin:0">${esc(b)}</p></div>`)));
    };
    sec('Conceptos', T.glosario.map(([a, b]) => [a, u(b)]));
    sec('Resultados', Object.values(T.resultados).map(([a, un, b]) => [`${a}${un ? ` (${u(un)})` : ''}`, u(b)]));
    sec('Opciones del modelo', Object.entries(T.opciones).map(([a, b]) => [a, u(b)]));
    sec('Avisos de EPANET', Object.entries(T.avisos).map(([k, v]) => [{ 1: 'No converge', 2: 'Inestable', 3: 'Nudos desconectados', 4: 'Bomba sin carga', 5: 'Válvula sin consigna', 6: 'Presiones negativas' }[k], v]));
    const params = [];
    for (const [tipo, ps] of Object.entries(T.parametros)) for (const [, [a, un, b]] of Object.entries(ps)) params.push([`${T.tipos[tipo]}: ${a}${un ? ` (${u(un)})` : ''}`, u(b)]);
    sec('Parámetros de los elementos', params);
  };
  $('#g-q').oninput = pintar;
  pintar();
}
