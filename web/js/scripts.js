// Panel Scripts: Python sobre la red, como el nodo de Python de Dynamo. El script corre aparte en el servidor (se
// puede cancelar), lo que imprime sale en la consola mientras corre, y lo que cambia queda como UNA edición del
// escenario solo cuando se le da Aplicar (Ctrl+Z la deshace entera). El borrador se recuerda en este navegador.
import { S, bus, get, post, esc, n, h, aviso, fallo, modal, formulario, conjunto, describir, $ } from './estado.js';
import { mapa } from './mapa.js';

const P = () => document.getElementById('panel');
const CLAVE = 'cauce-script';
const NUEVO = `# Script nuevo
# «red» trae los nudos, tramos y resultados: abre «Qué trae red», abajo, para ver todo.
# Correr no cambia nada; los cambios esperan a que les des Aplicar.

for t in red.tuberias():
    if t.diametro < 100:
        print(t.id, t.diametro)
`;
let LIB = null;                 // {mios, ejemplos, referencia}
let ED = borrador();            // {nombre, grupo: 'mios' | 'ejemplos' | '', codigo, sucio}
let corriendo = null;           // trabajo en curso: {id, consola, segundos}
let sondeo = null;
let ultimo = null;              // el último que terminó: {trabajo, r, aplicado}
let editor = null;

function borrador() {
  try { const x = JSON.parse(localStorage.getItem(CLAVE) || 'null'); if (x && typeof x.codigo === 'string') return x; } catch (e) { /* sin almacenamiento */ }
  return { nombre: '', grupo: '', codigo: NUEVO, sucio: false };
}
function recordar() { try { localStorage.setItem(CLAVE, JSON.stringify(ED)); } catch (e) { /* sin almacenamiento */ } }
function confirmar(titulo, texto, boton) {
  return new Promise((ok) => {
    let hecho = false;
    modal({ titulo, chico: true, cuerpo: `<p>${esc(texto)}</p>`, alCerrar: () => { if (!hecho) ok(false); },
      botones: [{ texto: 'Cancelar' }, { texto: boton, clase: 'prim', accion: () => { hecho = true; ok(true); } }] });
  });
}

// ====================================================================== editor de código
const KW = new Set('and as assert break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield None True False'.split(' '));
const TOK = /(#[^\n]*)|([rRbBfF]{0,2}(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?))|\b(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)\b|([A-Za-z_]\w*)/g;
function pintarPy(t) {
  let out = '', i = 0;
  t.replace(TOK, (m, com, str, num, pal, pos) => {
    out += esc(t.slice(i, pos)); i = pos + m.length;
    if (com) out += `<span class="c">${esc(m)}</span>`;
    else if (str) out += `<span class="s">${esc(m)}</span>`;
    else if (num) out += `<span class="nu">${m}</span>`;
    else if (KW.has(pal)) out += `<span class="k">${m}</span>`;
    else if (pal === 'red' || pal === 'print') out += `<span class="r">${m}</span>`;
    else if (t[pos + m.length] === '(') out += `<span class="f">${m}</span>`;
    else out += m;
    return m;
  });
  return `${out}${esc(t.slice(i))}\n`;
}

function editorCodigo(caja, { valor, alCambiar, alCorrer, alGuardar }) {
  caja.innerHTML = `<div class="margen" aria-hidden="true"></div><div class="area"><pre class="pinta" aria-hidden="true"></pre>
    <textarea spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" aria-label="Código del script (Escape para salir con Tab)"></textarea></div>`;
  const ta = $('textarea', caja), pre = $('.pinta', caja), mar = $('.margen', caja);
  let lineas = 0, errLinea = null;
  const numeros = () => {
    const k = ta.value.split('\n').length;
    if (k === lineas) return;
    lineas = k;
    mar.innerHTML = Array.from({ length: k }, (_, j) => `<div${j + 1 === errLinea ? ' class="err"' : ''}>${j + 1}</div>`).join('');
  };
  const refrescar = () => { pre.innerHTML = pintarPy(ta.value); numeros(); sincronizar(); };
  const sincronizar = () => { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; mar.scrollTop = ta.scrollTop; };
  const cambio = () => { if (errLinea) { errLinea = null; lineas = 0; } refrescar(); alCambiar?.(ta.value); };
  // insertText deja el cambio en la pila de deshacer del navegador (Ctrl+Z dentro del código)
  const poner = (texto, a, b, selA = null, selB = null) => {
    ta.focus(); ta.setSelectionRange(a, b);
    if (!document.execCommand('insertText', false, texto)) { ta.setRangeText(texto, a, b, 'end'); cambio(); }
    if (selA !== null) ta.setSelectionRange(selA, selB ?? selA);
  };
  const inicioLinea = (p) => ta.value.lastIndexOf('\n', p - 1) + 1;
  const sangrar = (quitar) => {
    const { selectionStart: a, selectionEnd: b, value: v } = ta;
    if (a === b && !quitar) { poner('    ', a, b); return; }
    const ls = inicioLinea(a), le = b > a && v[b - 1] === '\n' ? b - 1 : (v.indexOf('\n', b) === -1 ? v.length : v.indexOf('\n', b));
    const bloque = v.slice(ls, le).split('\n');
    const nuevo = bloque.map((l) => (quitar ? l.replace(/^ {1,4}/, '') : `    ${l}`)).join('\n');
    poner(nuevo, ls, le, ls, ls + nuevo.length);
  };
  const comentar = () => {
    const { selectionStart: a, selectionEnd: b, value: v } = ta;
    const ls = inicioLinea(a), le = v.indexOf('\n', b) === -1 ? v.length : v.indexOf('\n', b);
    const bloque = v.slice(ls, le).split('\n');
    const llenas = bloque.filter((l) => l.trim());
    const quitar = llenas.length && llenas.every((l) => l.trim().startsWith('#'));
    const sang = Math.min(...llenas.map((l) => l.match(/^ */)[0].length), 99);
    const nuevo = bloque.map((l) => (!l.trim() ? l : quitar ? l.replace(/^(\s*)# ?/, '$1') : `${l.slice(0, sang)}# ${l.slice(sang)}`)).join('\n');
    poner(nuevo, ls, le, ls, ls + nuevo.length);
  };
  const enter = () => {
    const { selectionStart: a, selectionEnd: b, value: v } = ta;
    const linea = v.slice(inicioLinea(a), a);
    let sang = linea.match(/^ */)[0];
    if (/:\s*(#.*)?$/.test(linea)) sang += '    ';
    poner(`\n${sang}`, a, b);
  };
  ta.value = valor;
  ta.oninput = cambio;
  ta.onscroll = sincronizar;
  ta.onkeydown = (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'Enter') { e.preventDefault(); alCorrer?.(); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); e.stopPropagation(); alGuardar?.(); return; }
    if (mod && e.key === '/') { e.preventDefault(); comentar(); return; }
    if (e.key === 'Tab') { e.preventDefault(); sangrar(e.shiftKey); return; }
    if (e.key === 'Enter' && !mod && !e.shiftKey && !e.altKey) { e.preventDefault(); enter(); return; }
    if (e.key === 'Escape') { e.stopPropagation(); ta.blur(); }
  };
  refrescar();
  return {
    valor: () => ta.value,
    poner: (t) => { ta.value = t; errLinea = null; lineas = 0; refrescar(); ta.scrollTop = 0; },
    // los ejemplos de varias líneas van en una línea propia
    insertar: (t) => { const a = ta.selectionStart; poner(t.endsWith('\n') && a > 0 && ta.value[a - 1] !== '\n' ? `\n${t}` : t, a, ta.selectionEnd); },
    marcar: (k) => { errLinea = k || null; lineas = 0; numeros(); },
    irA: (k) => {
      const v = ta.value; let p = 0;
      for (let j = 1; j < k && p !== -1; j++) p = v.indexOf('\n', p) + 1;
      ta.focus(); ta.setSelectionRange(p, p);
      const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
      ta.scrollTop = Math.max(0, (k - 4) * lh); sincronizar();
    },
  };
}

// ====================================================================== panel
export async function pScripts() {
  P().innerHTML = `<h1>Scripts</h1>
    <p class="sub">Python para revisar o cambiar la red de una vez, como en Dynamo. <code>red</code> trae los nudos, tramos y resultados. Correr no cambia nada: los cambios esperan a que les des Aplicar, y Ctrl+Z los deshace todos juntos.</p>
    <div class="scr-barra">
      <select id="s-lista" aria-label="Script"></select>
      <button class="btn chico" data-a="nuevo">Nuevo</button>
      <button class="btn chico" data-a="guardar" title="Ctrl+S con el cursor en el código">Guardar</button>
      <button class="btn chico" data-a="como">Guardar como…</button>
      <button class="btn chico" data-a="borrar" title="Borrar este script de «Mis scripts»">Borrar</button>
    </div>
    <div class="codigo" id="s-ed"></div>
    <div class="scr-correr"><button class="btn prim" data-a="correr">Correr</button><kbd>Ctrl</kbd><kbd>Enter</kbd><span id="s-titulo" class="sub"></span></div>
    <div id="s-res" aria-live="polite"></div>
    <details class="tarjeta desplegable" id="s-ref"><summary><b>Qué trae red</b></summary><div id="s-ref-c" class="scr-ref"></div></details>`;
  editor = editorCodigo($('#s-ed'), {
    valor: ED.codigo,
    alCambiar: (t) => { ED.codigo = t; if (!ED.sucio) { ED.sucio = true; pintarLista(); } recordar(); },
    alCorrer: correr, alGuardar: guardar,
  });
  $('[data-a=nuevo]').onclick = nuevo;
  $('[data-a=guardar]').onclick = guardar;
  $('[data-a=como]').onclick = guardarComo;
  $('[data-a=borrar]').onclick = borrar;
  $('[data-a=correr]').onclick = correr;
  $('#s-lista').onchange = (e) => elegir(e.target.value);
  pintarLista();
  pintarResultado();
  try { LIB = await get('/api/scripts'); } catch (e) { fallo(e); return; }
  pintarLista();
  pintarReferencia();
}

function pintarLista() {
  const sel = $('#s-lista');
  if (!sel) return;
  const opcion = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`;
  const mios = LIB?.mios || [], ej = LIB?.ejemplos || [];
  const actual = ED.grupo ? `${ED.grupo}:${ED.nombre}` : '';
  sel.innerHTML = (ED.grupo ? '' : opcion('', ED.sucio ? 'Borrador sin guardar •' : 'Borrador sin guardar'))
    + (mios.length ? `<optgroup label="Mis scripts">${mios.map((s) => opcion(`mios:${s.nombre}`, `${s.nombre}${ED.sucio && actual === `mios:${s.nombre}` ? ' •' : ''}`)).join('')}</optgroup>` : '')
    + (ej.length ? `<optgroup label="Ejemplos">${ej.map((s) => opcion(`ejemplos:${s.nombre}`, `${s.nombre}${ED.sucio && actual === `ejemplos:${s.nombre}` ? ' •' : ''}`)).join('')}</optgroup>` : '');
  sel.value = actual;
  if (sel.value !== actual) { sel.insertAdjacentHTML('afterbegin', opcion(actual, `${ED.nombre} •`)); sel.value = actual; }
  const b = $('[data-a=borrar]'); if (b) b.disabled = ED.grupo !== 'mios';
  const t = $('#s-titulo');
  if (t) {
    const d = (ED.grupo === 'ejemplos' ? ej : mios).find((s) => s.nombre === ED.nombre)?.descripcion;
    t.textContent = ED.grupo === 'ejemplos' ? `Ejemplo${d ? ` · ${d}` : ''}. Para guardarlo cambiado, Guardar como.` : (d || '');
  }
}

async function elegir(v) {
  if (ED.sucio && !(await confirmar('Cambios sin guardar', 'Este script tiene cambios que no guardaste. Si abres otro se pierden.', 'Abrir el otro'))) { pintarLista(); return; }
  if (!v) return;
  const [grupo, ...resto] = v.split(':'), nombre = resto.join(':');
  try {
    const r = await get('/api/scripts/leer', { grupo, nombre });
    ED = { nombre, grupo, codigo: r.codigo, sucio: false };
    editor.poner(r.codigo); recordar(); pintarLista();
  } catch (e) { fallo(e); pintarLista(); }
}
async function nuevo() {
  if (ED.sucio && !(await confirmar('Cambios sin guardar', 'Este script tiene cambios que no guardaste. Si empiezas otro se pierden.', 'Empezar otro'))) return;
  ED = { nombre: '', grupo: '', codigo: NUEVO, sucio: false };
  editor.poner(NUEVO); recordar(); pintarLista();
}
async function guardar() {
  if (ED.grupo !== 'mios' || !ED.nombre) { guardarComo(); return; }
  try {
    await post('/api/scripts/guardar', { nombre: ED.nombre, codigo: editor.valor(), sobrescribir: true });
    ED.sucio = false; recordar(); pintarLista(); aviso(`Guardado «${ED.nombre}».`, 'ok');
  } catch (e) { fallo(e); }
}
async function guardarComo() {
  const v = await formulario('Guardar script', [{ id: 'nombre', etiqueta: 'Nombre', valor: ED.grupo === 'ejemplos' ? `${ED.nombre} (mío)` : ED.nombre }], 'Guardar');
  if (!v || !v.nombre.trim()) return;
  const enviar = async (sobrescribir) => post('/api/scripts/guardar', { nombre: v.nombre, codigo: editor.valor(), sobrescribir });
  let r;
  try { r = await enviar(false); } catch (e) {
    if (e.codigo !== 409) { fallo(e); return; }
    if (!(await confirmar('Ya existe', e.message, 'Reemplazarlo'))) return;
    try { r = await enviar(true); } catch (e2) { fallo(e2); return; }
  }
  ED = { nombre: r.nombre, grupo: 'mios', codigo: editor.valor(), sucio: false };
  recordar();
  try { LIB = await get('/api/scripts'); } catch (e) { /* la lista se pinta con lo que había */ }
  pintarLista(); aviso(`Guardado «${r.nombre}» en Mis scripts.`, 'ok');
}
async function borrar() {
  if (ED.grupo !== 'mios') return;
  if (!(await confirmar('Borrar script', `Se borra «${ED.nombre}» de Mis scripts. El código queda en el editor como borrador.`, 'Borrar'))) return;
  try {
    await post('/api/scripts/borrar', { nombre: ED.nombre });
    ED = { nombre: '', grupo: '', codigo: editor.valor(), sucio: true };
    recordar(); LIB = await get('/api/scripts'); pintarLista();
  } catch (e) { fallo(e); }
}

function pintarReferencia() {
  const c = $('#s-ref-c');
  if (!c || !LIB) return;
  c.innerHTML = '';
  LIB.referencia.forEach(([grupo, items]) => {
    c.append(h(`<h3>${esc(grupo)}</h3>`));
    const ul = h('<ul class="lista"></ul>');
    items.forEach(([firma, desc, ejemplo]) => {
      const li = h(`<li><div><button class="enlace" title="Insertar en el código">${esc(firma)}</button><p>${esc(desc)}</p></div></li>`);
      $('button', li).onclick = () => { editor.insertar(ejemplo); };
      ul.append(li);
    });
    c.append(ul);
  });
}

// ====================================================================== correr, seguir, aplicar
async function correr() {
  if (!S.doc) { aviso('Abre un modelo primero.', 'error'); return; }
  if (corriendo) return;
  try {
    const r = await post(`/api/doc/${S.doc}/script`, { codigo: editor.valor() });
    corriendo = { id: r.trabajo, consola: '', segundos: 0 };
    ultimo = null; editor.marcar(null);
    pintarResultado(); seguir();
  } catch (e) { fallo(e); }
}
function seguir() {
  clearTimeout(sondeo);
  const paso = async () => {
    if (!corriendo) return;
    let t;
    try { t = await get(`/api/trabajo/${corriendo.id}`); } catch (e) { fallo(e); corriendo = null; pintarResultado(); return; }
    if (t.fase === 'en curso') {
      corriendo.consola = t.progreso?.consola || ''; corriendo.segundos = t.segundos;
      pintarResultado(); sondeo = setTimeout(paso, 350); return;
    }
    const id = corriendo.id;
    corriendo = null;
    ultimo = t.fase === 'error' ? { r: { error: t.error, consola: '', ops: [], marcados: { nudos: [], tramos: [] } } } : { trabajo: id, r: t.resultado };
    if (ultimo.r.linea) editor?.marcar(ultimo.r.linea);
    resaltar(false);
    pintarResultado();
  };
  paso();
}
function cancelar() { if (corriendo) post(`/api/trabajo/${corriendo.id}/cancelar`).catch(fallo); }

// lo que marcó el script o, si no marcó nada, lo que cambia (los elementos nuevos aún no están en el mapa)
function elementos(r) {
  const out = [];
  r.marcados.nudos.forEach((id) => out.push({ clase: 'nudo', id }));
  r.marcados.tramos.forEach((id) => out.push({ clase: 'tramo', id }));
  if (out.length || r.error) return out;
  for (const o of r.ops || []) {
    if (['propiedad', 'etiqueta'].includes(o.op)) out.push({ clase: o.tipo, id: o.id });
    else if (o.op === 'estado') out.push({ clase: 'tramo', id: o.id });
    else if (o.op === 'mover') out.push({ clase: 'nudo', id: o.id });
    else if (['partir', 'insertar'].includes(o.op)) out.push({ clase: 'tramo', id: o.tramo });
    else if (o.op === 'unir') out.push({ clase: 'nudo', id: o.destino });
    else if (['tuberia', 'valvula', 'bomba_nueva'].includes(o.op)) { out.push({ clase: 'nudo', id: o.n1 }, { clase: 'nudo', id: o.n2 }); }
  }
  return out;
}
function resaltar(ajustar) {
  if (!ultimo || !S.idxN) return;
  const c = conjunto(elementos(ultimo.r));
  if (!c.nudos.size && !c.tramos.size) return;
  S.resaltar = c;
  if (ajustar) mapa.ajustarA(c);
  mapa.pedir();
}

function consola(texto) {
  const pre = h('<pre class="consola"></pre>');
  pre.textContent = texto;
  requestAnimationFrame(() => { pre.scrollTop = pre.scrollHeight; });
  return pre;
}
function pintarResultado() {
  const caja = $('#s-res'), boton = $('[data-a=correr]');
  if (!caja) return;
  caja.innerHTML = '';
  if (boton) { boton.disabled = !!corriendo; boton.textContent = corriendo ? 'Corriendo…' : 'Correr'; }
  if (corriendo) {
    const f = h(`<div class="fila scr-estado"><span class="cargando"></span><span>Corriendo · ${n(corriendo.segundos, 0)} s</span><button class="btn chico">Cancelar</button></div>`);
    $('button', f).onclick = cancelar;
    caja.append(f, consola(corriendo.consola || ''));
    return;
  }
  if (!ultimo) return;
  const r = ultimo.r, ops = r.ops || [];
  if (r.error) {
    const t = h(`<div class="tarjeta error"><h3>${r.cancelado ? 'Cancelado' : r.linea ? `El script se detuvo en la línea ${r.linea}` : 'El script no pudo correr'}</h3>
      <p>${esc(r.error)}</p>${r.traza ? `<div class="texto-inp">${esc(r.traza)}</div>` : ''}
      <p class="sub" style="margin:8px 0 0">No se aplicó nada${ops.length ? ` (los ${n(ops.length, 0)} cambios que alcanzó a hacer se descartan)` : ''}.</p>
      ${r.linea ? '<div class="acciones"><button class="btn chico">Ir a la línea</button></div>' : ''}</div>`);
    const b = $('.acciones button', t); if (b) b.onclick = () => editor.irA(r.linea);
    caja.append(t);
  }
  if (r.consola) caja.append(consola(r.consola));
  const marcados = r.marcados.nudos.length + r.marcados.tramos.length;
  if (!r.error && ops.length) {
    const tipos = {};
    ops.forEach((o) => { tipos[o.op] = (tipos[o.op] || 0) + 1; });
    const nombres = { propiedad: 'propiedades', estado: 'estados', etiqueta: 'etiquetas', mover: 'movidos', nudo: 'nudos nuevos', tanque: 'tanques nuevos', embalse: 'embalses nuevos', tuberia: 'tuberías nuevas', valvula: 'válvulas nuevas', bomba_nueva: 'bombas nuevas', partir: 'partidas', insertar: 'insertadas', unir: 'uniones', borrar: 'borrados', patron: 'patrones', curva: 'curvas', controles: 'controles', reglas: 'reglas', opcion: 'opciones', multiplicador: 'multiplicador' };
    const t = h(`<div class="tarjeta ${ultimo.aplicado ? '' : 'ok'}"><h3>${ultimo.aplicado ? 'Aplicado' : `${n(ops.length, 0)} ${ops.length === 1 ? 'cambio listo' : 'cambios listos'}`}</h3>
      <p>${Object.entries(tipos).map(([k, v]) => `${n(v, 0)} ${nombres[k] || k}`).join(' · ')}</p>
      <ul class="lista scr-cambios"></ul>
      <div class="acciones">${ultimo.aplicado ? '' : '<button class="btn prim" data-a="aplicar">Aplicar al modelo</button><button class="btn" data-a="descartar">Descartar</button>'}
        <button class="btn" data-a="ver">Ver en el mapa</button></div></div>`);
    const ul = $('ul', t);
    ops.slice(0, 40).forEach((o) => ul.append(h(`<li><span>${esc(describir(o))}</span></li>`)));
    if (ops.length > 40) ul.append(h(`<li class="vacio">y ${n(ops.length - 40, 0)} más</li>`));
    const ap = $('[data-a=aplicar]', t); if (ap) ap.onclick = () => aplicar(false);
    const de = $('[data-a=descartar]', t); if (de) de.onclick = () => { ultimo = null; S.resaltar = null; mapa.pedir(); pintarResultado(); };
    $('[data-a=ver]', t).onclick = () => resaltar(true);
    caja.append(t);
  } else if (!r.error) {
    const t = h(`<div class="fila scr-estado"><span class="sub" style="margin:0">El script no cambió nada${r.segundos !== undefined ? ` · ${n(r.segundos, 1)} s` : ''}.</span>${marcados ? `<button class="btn chico">Ver ${n(marcados, 0)} en el mapa</button>` : ''}</div>`);
    const b = $('button', t); if (b) b.onclick = () => resaltar(true);
    caja.append(t);
  }
}

async function aplicar(forzar) {
  if (!ultimo?.trabajo) return;
  try {
    const r = await post(`/api/doc/${S.doc}/script_aplicar`, { trabajo: ultimo.trabajo, nombre: ED.nombre || 'sin nombre', forzar });
    if (!r.ok) {
      modal({ titulo: 'EPANET no aceptaría estos cambios', cuerpo: `<div class="texto-inp">${esc(r.errores.join('\n'))}</div><p class="sub" style="margin-top:10px">No se aplicó nada. Puedes aplicarlos igual y arreglar después (Ctrl+Z los quita).</p>`,
        botones: [{ texto: 'Cancelar' }, { texto: 'Aplicar igual', clase: 'peligro', accion: () => { aplicar(true); } }] });
      return;
    }
    (r.avisos || []).forEach((a) => aviso(a));
    ultimo.aplicado = true;
    aviso(`Script aplicado: ${n(r.cambios, 0)} ${r.cambios === 1 ? 'cambio' : 'cambios'}. Ctrl+Z lo deshace.`, 'ok');
    bus.emit('recargar', { mantener: true });
  } catch (e) { fallo(e); }
}
