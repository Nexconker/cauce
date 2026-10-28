// Panel Reportes (barra de la izquierda): genera el reporte de EPANET (.rpt) de la corrida hecha en Correr (el mismo
// .inp y el mismo motor) con lo que se pida en [REPORT] (estados de cada paso, resumen, energía, nudos, tramos y
// variables), y lo abre en su pestaña. También abre cualquier .rpt del disco o el de la corrida que se está viendo.
import { S, bus, get, post, esc, n, h, aviso, fallo, explorar, modal, $, $$ } from './estado.js';
import { abrirReporte, elegirReporte } from './reporte.js';

const P = () => document.getElementById('panel');
const VAR_NUDOS = [['Demand', 'Demanda'], ['Head', 'Carga'], ['Pressure', 'Presión'], ['Quality', 'Calidad'], ['Elevation', 'Cota']];
const VAR_TRAMOS = [['Flow', 'Caudal'], ['Velocity', 'Velocidad'], ['Headloss', 'Pérdida unitaria'], ['State', 'Estado'], ['Setting', 'Consigna'],
  ['F-Factor', 'Factor de fricción'], ['Reaction', 'Reacción'], ['Diameter', 'Diámetro'], ['Length', 'Longitud']];
const POR_DEFECTO = { estados: 'si', resumen: true, energia: false, nudos: 'all', tramos: 'all',
  variables: ['Demand', 'Head', 'Pressure', 'Flow', 'Velocity', 'Headloss', 'State'] };
let generando = null;      // { tid, doc, ruta } mientras corre un reporte

function leerOpciones() { try { return { ...POR_DEFECTO, ...JSON.parse(localStorage.getItem('cauce-rpt-opciones') || '{}') }; } catch (e) { return { ...POR_DEFECTO }; } }
function guardarOpciones(o) { try { localStorage.setItem('cauce-rpt-opciones', JSON.stringify(o)); } catch (e) { /* sin almacenamiento */ } }
function recientes() { try { return JSON.parse(localStorage.getItem('cauce-rpt-recientes') || '[]'); } catch (e) { return []; } }
function anotar(r) {
  try { localStorage.setItem('cauce-rpt-recientes', JSON.stringify([r, ...recientes().filter((x) => x.ruta !== r.ruta)].slice(0, 8))); } catch (e) { /* sin almacenamiento */ }
}
const rutaSugerida = () => (S.info?.ruta ? S.info.ruta.replace(/\.(inp|json)$/i, '') + '.rpt' : '');
function confirmar(titulo, texto, boton) {
  return new Promise((ok) => {
    let hecho = false;
    modal({ titulo, chico: true, cuerpo: `<p>${esc(texto)}</p>`, alCerrar: () => { if (!hecho) ok(false); },
      botones: [{ texto: 'Cancelar' }, { texto: boton, clase: 'prim', accion: () => { hecho = true; ok(true); } }] });
  });
}

export async function pReportes() {
  const o = leerOpciones();
  P().innerHTML = `<h1>Reportes de EPANET</h1><p class="sub">Genera el reporte .rpt de la corrida con lo que necesites y léelo en Cauce, o abre uno que ya tengas.</p>`;
  const cab = P().firstElementChild;
  const leer = h(`<div class="tarjeta"><h3>Leer un reporte</h3><p>Avisos por elemento y por hora, paso a paso, tablas de resultados y el texto completo con buscador, en su propia pestaña.</p>
    <div class="acciones"><button class="btn" data-a="disco">Abrir un .rpt…</button>${S.corrida ? '<button class="btn" data-a="corrida">El de la corrida que estás viendo</button>' : ''}</div></div>`);
  $('[data-a=disco]', leer).onclick = () => elegirReporte(S.doc || '');
  if (S.corrida) $('[data-a=corrida]', leer).onclick = () => abrirReporte({ corrida: S.corrida, doc: S.doc, nombre: `${S.info?.nombre || 'Modelo'} · corrida` });
  if (!S.doc || !S.info) {
    P().append(h('<div class="tarjeta info"><h3>Abre un modelo para generar su reporte</h3><p>El reporte sale de la corrida que hagas del modelo en Correr.</p></div>'));
    P().append(leer);
    pintarRecientes();
    return;
  }
  // el reporte sale de una corrida hecha en Correr: EPANET la repite con el mismo .inp y el mismo motor
  let C = null;
  if (S.corrida) { try { C = await get(`/api/corrida/${S.corrida}`); } catch (e) { C = null; } }
  if (!cab.isConnected) return;       // se cambió de panel mientras llegaba
  if (!C) {
    const t = h(`<div class="tarjeta info"><h3>Corre el modelo primero</h3><p>El reporte sale de la corrida que hagas en Correr, con su motor y su escenario. Cuando termine, vuelve aquí para generarlo.</p>
      <div class="acciones"><button class="btn prim">Ir a Correr</button></div></div>`);
    $('button', t).onclick = () => bus.emit('panel', 'correr');
    P().append(t, leer);
    pintarRecientes();
    return;
  }
  const chk = (lista, grupo) => lista.map(([k, t]) => `<label class="chk"><input type="checkbox" data-var="${k}" data-g="${grupo}" ${o.variables.includes(k) ? 'checked' : ''}> ${esc(t)}</label>`).join('');
  const f = h(`<form class="tarjeta" autocomplete="off"><h3>Generar el reporte (.rpt)</h3>
    <p>De la corrida de las <b>${esc(String(C.cuando).slice(0, 5))}</b> con el motor <b>${esc(C.motor)}</b>${S.info.escenario && S.info.escenario !== 'Sin cambios' ? ` y el escenario «${esc(S.info.escenario)}»` : ''}. EPANET la repite igual para escribir el reporte, así que tarda lo mismo que ella.</p>
    ${C.al_dia ? '' : '<p class="sub">El modelo cambió después de esa corrida: el reporte sale de lo que se corrió. Para tener lo de ahora, córrelo otra vez en Correr.</p>'}
    <div class="campo">Estado de cada paso (válvulas, bombas y tanques que cambian)<div class="seg" id="g-estados"><button type="button" data-v="no">No</button><button type="button" data-v="si">Sí</button><button type="button" data-v="completo">Completo, con las iteraciones</button></div></div>
    <label class="chk"><input type="checkbox" id="g-resumen" ${o.resumen ? 'checked' : ''}> Resumen de los datos del modelo</label>
    <label class="chk" style="margin-bottom:10px"><input type="checkbox" id="g-energia" ${o.energia ? 'checked' : ''}> Consumo de energía de las bombas</label>
    <label class="campo">Resultados de nudos<select id="g-nudos"><option value="all">Todos los nudos</option><option value="none">Ninguno</option><option value="lista">Solo estos ID…</option></select></label>
    <input id="g-nudos-ids" class="mono" placeholder="ID separados por espacios o comas" hidden style="margin:-6px 0 8px">
    <div class="g-vars" id="g-vn">${chk(VAR_NUDOS, 'n')}</div>
    <label class="campo">Resultados de tramos<select id="g-tramos"><option value="all">Todos los tramos</option><option value="none">Ninguno</option><option value="lista">Solo estos ID…</option></select></label>
    <input id="g-tramos-ids" class="mono" placeholder="ID separados por espacios o comas" hidden style="margin:-6px 0 8px">
    <div class="g-vars" id="g-vt">${chk(VAR_TRAMOS, 't')}</div>
    <div class="campo">Guardar en<div class="g-ruta"><input id="g-ruta" spellcheck="false"><button type="button" class="btn" id="g-cambiar">Cambiar…</button></div></div>
    <p class="sub" style="margin:0 0 10px">Con todos los nudos y tramos el archivo crece rápido: una red de 5.000 nudos a 24 horas da unos 20 MB.</p>
    <div class="acciones"><button class="btn prim" id="g-generar">Generar el reporte</button></div><div class="g-prog" id="g-prog"></div></form>`);
  P().append(f, leer);
  pintarRecientes();
  let estados = o.estados;
  const seg = (sel, v, fn) => $$(`${sel} button`, f).forEach((b) => { b.classList.toggle('on', b.dataset.v === v); b.onclick = () => { fn(b.dataset.v); seg(sel, b.dataset.v, fn); }; });
  seg('#g-estados', estados, (v) => { estados = v; });
  const lista = (clave) => {
    const sel = $(`#g-${clave}`, f), ids = $(`#g-${clave}-ids`, f);
    sel.value = Array.isArray(o[clave]) ? 'lista' : o[clave];
    if (Array.isArray(o[clave])) ids.value = o[clave].join(' ');
    const ver = () => { ids.hidden = sel.value !== 'lista'; $(clave === 'nudos' ? '#g-vn' : '#g-vt', f).hidden = sel.value === 'none'; };
    sel.onchange = ver; ver();
  };
  lista('nudos'); lista('tramos');
  const ruta = $('#g-ruta', f);
  ruta.value = generando?.doc === S.doc ? generando.ruta : rutaSugerida();
  $('#g-cambiar', f).onclick = async () => {
    const r = await explorar({ titulo: 'Guardar el reporte', filtro: ['.rpt'], guardar: true, nombre: ruta.value || rutaSugerida() });
    if (r) ruta.value = /\.(rpt|txt)$/i.test(r) ? r : `${r}.rpt`;
  };
  const opciones = () => {
    const ids = (clave) => $(`#g-${clave}-ids`, f).value.split(/[\s,;]+/).filter(Boolean);
    const sel = (clave) => ($(`#g-${clave}`, f).value === 'lista' ? ids(clave) : $(`#g-${clave}`, f).value);
    return { estados, resumen: $('#g-resumen', f).checked, energia: $('#g-energia', f).checked, nudos: sel('nudos'), tramos: sel('tramos'),
      variables: $$('[data-var]', f).filter((x) => x.checked).map((x) => x.dataset.var) };
  };
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (generando) { aviso(`Ya se está generando el reporte de ${generando.nombre}. Espera a que termine.`); return; }
    let destino = ruta.value.trim();
    if (!/^([A-Za-z]:\\|\\\\)/.test(destino)) { aviso('Escribe la ruta completa del reporte (por ejemplo C:\\Proyectos\\red.rpt) o usa «Cambiar…».', 'error'); return; }
    if (!/\.(rpt|txt)$/i.test(destino)) destino += '.rpt';
    const op = opciones();
    guardarOpciones(op);
    const doc = S.doc, nombre = S.info.nombre, corrida = C.id;
    const enviar = (sobrescribir) => post(`/api/doc/${doc}/reporte`, { ruta: destino, corrida, opciones: op, sobrescribir });
    let r;
    try { r = await enviar(false); } catch (ex) {
      if (ex.codigo !== 409) { fallo(ex); return; }
      if (!(await confirmar('Ya existe', ex.message, 'Reemplazarlo'))) return;
      try { r = await enviar(true); } catch (ex2) { fallo(ex2); return; }
    }
    generando = { tid: r.trabajo, doc, ruta: destino, nombre };
    seguir();
  };
  if (generando?.doc === S.doc) seguir();
}

// sigue el trabajo en el servidor; si el panel ya no está, avisa igual al terminar
async function seguir() {
  const g = generando;
  if (!g) return;
  const caja = () => document.getElementById('g-prog');
  const boton = () => document.getElementById('g-generar');
  for (;;) {
    let t;
    try { t = await get(`/api/trabajo/${g.tid}`); } catch (e) { fallo(e); generando = null; return; }
    if (generando !== g) return;
    if (t.fase === 'en curso') {
      if (boton()) boton().disabled = true;
      if (caja()) caja().innerHTML = `Generando · ${esc(t.progreso?.texto || 'calculando')} · ${n(t.segundos, 0)} s<div class="barra"><i></i></div>`;
      await new Promise((r) => setTimeout(r, 800));
      continue;
    }
    generando = null;
    if (boton()) boton().disabled = false;
    if (t.fase === 'error' || t.error) {
      if (caja()) caja().innerHTML = `<div class="tarjeta error" style="margin:0"><h3>No se pudo generar el reporte</h3><p>${esc(t.error || '')}</p></div>`;
      else aviso(`No se pudo generar el reporte: ${t.error || ''}`, 'error');
      return;
    }
    const r = t.resultado;
    anotar({ ruta: r.ruta, nombre: r.ruta.split('\\').pop(), modelo: g.nombre, doc: g.doc, cuando: new Date().toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }), kb: r.kb });
    const abrir = () => abrirReporte({ ruta: r.ruta, doc: g.doc });
    if (caja()) {
      caja().innerHTML = '';
      const ok = h(`<div class="tarjeta ok" style="margin:0"><h3>Reporte listo</h3><p class="mono" style="word-break:break-all">${esc(r.ruta)}</p>
        <p>${n(r.kb / 1024, r.kb < 10240 ? 1 : 0)} MB · ${n(r.lineas, 0)} líneas · ${n(r.avisos, 0)} avisos · ${n(r.segundos, 0)} s</p>
        <div class="acciones"><button class="btn prim" type="button">Leer el reporte</button><button class="btn" type="button" data-a="copiar">Copiar la ruta</button></div></div>`);
      $('.btn.prim', ok).onclick = abrir;
      $('[data-a=copiar]', ok).onclick = () => navigator.clipboard.writeText(r.ruta).then(() => aviso('Ruta copiada.'));
      caja().append(ok);
      pintarRecientes();
    } else aviso(`Reporte listo: ${r.ruta.split('\\').pop()}. Está en Reportes.`, 'ok', 9000);
    return;
  }
}

function pintarRecientes() {
  document.getElementById('g-recientes')?.remove();
  const rs = recientes();
  if (!rs.length || !P()) return;
  const s = h('<div class="sec" id="g-recientes"><div class="eti">Generados hace poco</div><ul class="lista"></ul></div>');
  rs.forEach((r) => {
    const li = h(`<li><span><b>${esc(r.nombre)}</b><br><span style="color:var(--apagado)">${esc(r.modelo || '')} · ${esc(r.cuando || '')}${r.kb ? ` · ${n(r.kb / 1024, 1)} MB` : ''}</span></span><button class="btn chico">Leer</button></li>`);
    $('button', li).onclick = () => abrirReporte({ ruta: r.ruta, doc: S.docs.some((d) => d.id === r.doc) ? r.doc : S.doc || '' });
    $('ul', s).append(li);
  });
  P().append(s);
}
