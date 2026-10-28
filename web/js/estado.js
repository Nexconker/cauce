// Estado compartido de la app, llamadas al servidor y piezas de interfaz comunes (avisos, ventanas, explorador).

export const S = {
  textos: null,          // explicaciones (parámetros, opciones, glosario)
  docs: [],              // modelos abiertos (info del servidor)
  doc: null,             // id del modelo activo
  info: null,            // info del modelo activo
  M: null,               // modelo activo en columnas (nudos, tramos...)
  idxN: null, idxL: null,
  hallazgos: null,
  corrida: null,         // id de la corrida que se está viendo
  resumen: null,
  corridaComp: null,     // otra corrida para comparar en las gráficas
  trabajos: {}, progresos: {}, ultima: {},     // por modelo (pestaña): corrida en curso, su avance y la última corrida vista
  res: {},               // variable -> Float32Array (T × N) en el orden del modelo
  T: 0, horas: [], hora: 0, t: 0, variable: 'presion', envolvente: false,     // t: la hora de la barra, fraccionaria
  modo: 'tipo',
  comparacion: null,
  sel: null,             // {clase: 'nudo'|'tramo', i}
  resaltar: null,        // {nudos: Set, tramos: Set}
  herramienta: null,     // edición en el mapa
  motor: localStorage.getItem('cauce-motor') || '2.2',
};

// ---------------------------------------------------------------- eventos
const oyentes = {};
export const bus = {
  on(ev, fn) { (oyentes[ev] = oyentes[ev] || []).push(fn); },
  emit(ev, x) { (oyentes[ev] || []).forEach((fn) => { try { fn(x); } catch (e) { console.error(e); } }); },
};

// ---------------------------------------------------------------- servidor
async function leer(r) {
  const t = await r.text();
  let j = null;
  try { j = t ? JSON.parse(t) : {}; } catch (e) { throw new Error(`Respuesta inesperada del servidor (${r.status})`); }
  if (!r.ok) { const e = new Error(j.error || `Error ${r.status}`); e.codigo = r.status; throw e; }
  return j;
}
export async function get(ruta, q) {
  const u = q ? `${ruta}?${new URLSearchParams(q)}` : ruta;
  return leer(await fetch(u));
}
export async function post(ruta, cuerpo) {
  return leer(await fetch(ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo || {}) }));
}
export async function binario(ruta, q) {
  const r = await fetch(`${ruta}?${new URLSearchParams(q)}`);
  if (!r.ok) throw new Error(`No se pudieron leer los resultados (${r.status})`);
  const [T, N] = (r.headers.get('X-Forma') || '0,0').split(',').map(Number);
  return { T, N, datos: new Float32Array(await r.arrayBuffer()) };
}

// ---------------------------------------------------------------- utilidades
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export function esc(t) { return String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const nf = (d) => new Intl.NumberFormat('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d });
const F = [nf(0), nf(1), nf(2), nf(3)];
export function n(x, d = 1) { return x === null || x === undefined || Number.isNaN(x) ? '—' : F[d].format(x); }
export function hora(h) { const m = Math.round(h * 60); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
export function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

// aviso abajo a la derecha: se pausa con el ratón encima o con la pestaña oculta; clic para cerrarlo
export function aviso(texto, tipo = '', ms = 0) {
  const el = h(`<div class="toast ${tipo}" role="${tipo === 'error' ? 'alert' : 'status'}"><span>${esc(texto)}</span></div>`);
  $('#toasts').append(el);
  let restante = ms || (tipo === 'error' ? 9000 : 4500), inicio = 0, t = null;
  const salir = () => { clearTimeout(t); document.removeEventListener('visibilitychange', vis); el.classList.add('saliendo'); setTimeout(() => el.remove(), 160); };
  const correr = () => { inicio = Date.now(); t = setTimeout(salir, restante); };
  const pausar = () => { clearTimeout(t); restante = Math.max(800, restante - (Date.now() - inicio)); };
  const vis = () => (document.hidden ? pausar() : correr());
  el.onmouseenter = pausar; el.onmouseleave = correr; el.onclick = salir;
  document.addEventListener('visibilitychange', vis);
  correr();
}
export function fallo(e) { console.error(e); aviso(e.message || String(e), 'error'); }
export function esqueleto(n = 4, alto = false) { return `<div class="esq" aria-hidden="true">${alto ? '<i class="alto"></i>' : ''}${'<i></i>'.repeat(n)}</div>`; }

// ---------------------------------------------------------------- ayuda flotante para los [data-t]
// Una sola, con position: fixed (no la recorta el scroll de los paneles). La primera espera un poco; si ya había
// una abierta hace nada, la siguiente sale al instante.
(function ayudas() {
  const caja = document.createElement('div');
  caja.id = 'ayuda-flotante'; caja.className = 'oculta'; caja.setAttribute('role', 'tooltip');
  document.addEventListener('DOMContentLoaded', () => document.body.append(caja));
  if (document.body) document.body.append(caja);
  let espera = null, cerradaEn = 0, actual = null;
  const mostrar = (el) => {
    const t = el.getAttribute('data-t'); if (!t) return;
    actual = el;
    const instante = Date.now() - cerradaEn < 400;
    clearTimeout(espera);
    espera = setTimeout(() => {
      caja.textContent = t;
      caja.classList.toggle('instante', instante);
      const r = el.getBoundingClientRect();
      const w = Math.min(280, window.innerWidth - 24);
      const derecha = r.right + 10 + w < window.innerWidth;
      caja.style.left = `${derecha ? r.right + 10 : Math.max(12, r.left - w - 10)}px`;
      caja.style.top = `${Math.max(12, Math.min(r.top - 6, window.innerHeight - 140))}px`;
      caja.style.setProperty('--origen', derecha ? 'left top' : 'right top');
      caja.classList.remove('oculta');
    }, instante ? 0 : 320);
  };
  const ocultar = () => { clearTimeout(espera); if (!caja.classList.contains('oculta')) cerradaEn = Date.now(); caja.classList.add('oculta'); actual = null; };
  document.addEventListener('pointerover', (e) => { const el = e.target.closest?.('[data-t]'); if (el && el !== actual) mostrar(el); else if (!el && actual) ocultar(); });
  document.addEventListener('focusin', (e) => { const el = e.target.closest?.('[data-t]'); if (el) mostrar(el); });
  document.addEventListener('focusout', ocultar);
  document.addEventListener('scroll', ocultar, true);
})();

// el escenario por defecto se llama «Sin cambios»: si ya tiene cambios y todavía no tiene nombre, se muestra «sin nombre»
// nombre y unidades de lo que calcula la calidad del agua en la corrida activa
export function nombreCalidad(q = S.resumen?.calidad) {
  if (!q) return ['Calidad', ''];
  if (q.tipo === 'AGE') return ['Edad del agua', 'h'];
  if (q.tipo === 'TRACE') return [`Agua que viene de ${q.nudo}`, '%'];
  const nom = { CHLORINE: 'Cloro', CLORO: 'Cloro' }[String(q.nombre || '').toUpperCase()] || q.nombre || 'Químico';
  return [nom, q.unidades || 'mg/L'];
}
export const nombreEscenario = (I) => (I.escenario === 'Sin cambios' && I.cambios ? 'sin nombre' : I.escenario);

// ---------------------------------------------------------------- otra ventana de Cauce
// En la ventana propia (pywebview) la abre el lanzador con la identidad de Cauce; en el navegador, una ventana emergente.
export function nuevaVentana(ruta, titulo = 'Cauce') {
  try {
    if (window.pywebview?.api?.ventana) { window.pywebview.api.ventana(ruta, titulo); return; }
  } catch (e) { /* sigue con la del navegador */ }
  const w = window.open(ruta, '_blank', 'popup=yes,width=1320,height=880');
  if (!w) aviso('El navegador bloqueó la ventana nueva: permite las ventanas emergentes de Cauce.', 'error');
}

// ---------------------------------------------------------------- ventanas
let salidaModal = null, abierta = null;
export function modal({ titulo, cuerpo, botones = [], chico = false, grande = false, alCerrar }) {
  const capa = $('#capa-modal');
  if (abierta) abierta();         // una ventana nueva reemplaza a la que estuviera abierta
  clearTimeout(salidaModal); capa.classList.remove('saliendo');
  capa.innerHTML = '';
  const m = h(`<div class="modal ${chico ? 'chico' : ''} ${grande ? 'grande' : ''}" role="dialog" aria-modal="true">
    <header><h2>${esc(titulo)}</h2><button class="x" aria-label="Cerrar">×</button></header>
    <div class="cont"></div><footer></footer></div>`);
  const cont = $('.cont', m);
  if (typeof cuerpo === 'string') cont.innerHTML = cuerpo; else if (cuerpo) cont.append(cuerpo);
  // los archivos del explorador se abren con un clic: el segundo de un doble clic cae aquí y no debe seleccionar texto
  const desde = performance.now();
  m.addEventListener('mousedown', (e) => { if (e.detail > 1 && performance.now() - desde < 700) e.preventDefault(); });
  let cerrada = false;
  const soltar = () => {
    if (cerrada) return; cerrada = true;
    document.removeEventListener('keydown', tecla);
    if (abierta === soltar) abierta = null;
    if (alCerrar) alCerrar();
  };
  const cerrar = () => {
    // si otra ventana ya ocupó la capa, esta solo se suelta: no hay que esconder la nueva
    const visible = !cerrada && m.isConnected;
    soltar();
    if (!visible) return;
    // la salida es más rápida que la entrada (150 ms contra 200 ms)
    capa.classList.add('saliendo');
    salidaModal = setTimeout(() => { capa.hidden = true; capa.innerHTML = ''; capa.classList.remove('saliendo'); }, 150);
  };
  const tecla = (e) => { if (e.key === 'Escape') cerrar(); };
  document.addEventListener('keydown', tecla);
  $('.x', m).onclick = cerrar;
  capa.onclick = (e) => { if (e.target === capa) cerrar(); };
  const pie = $('footer', m);
  if (!botones.length) pie.remove();
  botones.forEach((b) => {
    const el = h(`<button class="btn ${b.clase || ''}">${esc(b.texto)}</button>`);
    el.onclick = async () => { if (b.accion) { const r = await b.accion(m); if (r === false) return; } cerrar(); };
    pie.append(el);
  });
  capa.append(m);
  capa.hidden = false;
  abierta = soltar;
  const primero = $('input, select, textarea', cont);
  if (primero) setTimeout(() => primero.focus(), 30);
  return { el: m, cerrar };
}

// formulario simple: campos [{id, etiqueta, tipo, valor, opciones, ayuda}] -> promesa con los valores o null
export function formulario(titulo, campos, textoOk = 'Aceptar') {
  return new Promise((resolver) => {
    let hecho = false;
    const f = h('<form></form>');
    campos.forEach((c) => {
      const lab = h(`<label class="campo"><span>${esc(c.etiqueta)}${c.ayuda ? ` <i class="ayuda" tabindex="0" data-t="${esc(c.ayuda)}">?</i>` : ''}</span></label>`);
      let inp;
      if (c.opciones) {
        inp = h(`<select>${c.opciones.map((o) => `<option value="${esc(o.v ?? o)}">${esc(o.t ?? o)}</option>`).join('')}</select>`);
      } else inp = h(`<input type="${c.tipo || 'text'}" ${c.tipo === 'number' ? 'step="any"' : ''}>`);
      inp.id = `f-${c.id}`;
      if (c.valor !== undefined && c.valor !== null) inp.value = c.valor;
      lab.append(inp);
      f.append(lab);
    });
    f.onsubmit = (e) => { e.preventDefault(); $('.modal footer .prim').click(); };
    // Enter acepta desde cualquier campo (el navegador solo lo hace solo en formularios de un único campo de texto)
    f.onkeydown = (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); $('.modal footer .prim').click(); } };
    modal({
      titulo, cuerpo: f, chico: true,
      botones: [{ texto: 'Cancelar' }, {
        texto: textoOk, clase: 'prim', accion: () => {
          const v = {};
          campos.forEach((c) => { const x = $(`#f-${c.id}`).value; v[c.id] = c.tipo === 'number' ? (x === '' ? null : Number(x)) : x; });
          hecho = true; resolver(v);
        },
      }],
      alCerrar: () => { if (!hecho) resolver(null); },
    });
  });
}

// ---------------------------------------------------------------- explorador de archivos
export function explorar({ titulo = 'Abrir', filtro = ['.inp', '.json'], guardar = false, nombre = '' } = {}) {
  return new Promise((resolver) => {
    let hecho = false;
    const cuerpo = h(`<div>
      <div class="explo-ruta"><button class="btn" data-a="arriba" title="Carpeta de arriba">↑</button><input class="ruta" spellcheck="false"><button class="btn" data-a="ir">Ir</button></div>
      <div class="explo"><div class="atajos"></div><div class="items"></div></div>
      ${guardar ? '<label class="campo" style="margin-top:12px">Nombre del archivo<input class="nombre"></label>' : ''}
    </div>`);
    let actual = '';
    const cargar = async (ruta) => {
      try {
        const r = await get('/api/explorar', { ruta });
        actual = r.ruta;
        $('.ruta', cuerpo).value = r.ruta;
        const at = $('.atajos', cuerpo);
        at.innerHTML = '<div class="eti" style="margin:2px 8px 4px">Atajos</div>';
        r.atajos.forEach((p) => at.append(boton(p.split('\\').slice(-1)[0] || p, p)));
        if (r.recientes.length) {
          at.append(h('<div class="eti" style="margin:10px 8px 4px">Recientes</div>'));
          r.recientes.slice(0, 8).forEach((p) => at.append(boton(p.split('\\').slice(-1)[0], p, true)));
        }
        at.append(h('<div class="eti" style="margin:10px 8px 4px">Unidades</div>'));
        r.unidades.forEach((u) => at.append(boton(u, u)));
        const it = $('.items', cuerpo);
        it.innerHTML = r.error ? `<div class="vacio" style="padding:12px">${esc(r.error)}</div>` : '';
        r.carpetas.forEach((c) => it.append(item('dir', c, '', () => cargar(`${r.ruta}\\${c}`))));
        r.archivos.filter((a) => filtro.some((x) => a.nombre.toLowerCase().endsWith(x))).forEach((a) => {
          const ext = a.nombre.toLowerCase().split('.').pop();
          it.append(item(ext, a.nombre, `${a.mod} · ${n(a.kb, 0)} KB`, () => {
            if (guardar) { $('.nombre', cuerpo).value = a.nombre; return; }
            hecho = true; resolver(`${r.ruta}\\${a.nombre}`); dlg.cerrar();
          }));
        });
        if (!it.children.length) it.append(h(`<div class="vacio" style="padding:12px">No hay carpetas ni archivos ${esc(filtro.join(', '))} aquí.</div>`));
      } catch (e) { fallo(e); }
    };
    const boton = (t, ruta, archivo) => {
      const b = h(`<button title="${esc(ruta)}">${esc(t)}</button>`);
      b.onclick = () => {
        if (archivo && !guardar && filtro.some((x) => ruta.toLowerCase().endsWith(x))) { hecho = true; resolver(ruta); dlg.cerrar(); } else cargar(archivo ? ruta.replace(/\\[^\\]+$/, '') : ruta);
      };
      return b;
    };
    const item = (clase, t, meta, fn) => {
      const ic = clase === 'dir' ? '▸' : clase === 'inp' ? '◆' : clase === 'json' ? '◇' : '▦';
      const b = h(`<button class="item ${clase}"><span class="ic">${ic}</span><span>${esc(t)}</span><span class="m">${esc(meta)}</span></button>`);
      b.onclick = fn;
      return b;
    };
    const dlg = modal({
      titulo, cuerpo,
      botones: guardar ? [{ texto: 'Cancelar' }, {
        texto: 'Guardar aquí', clase: 'prim', accion: () => {
          const nom = $('.nombre', cuerpo).value.trim();
          if (!nom) { aviso('Escribe un nombre de archivo.', 'error'); return false; }
          hecho = true; resolver(`${actual}\\${nom}`);
        },
      }] : [],
      alCerrar: () => { if (!hecho) resolver(null); },
    });
    if (guardar) $('.nombre', cuerpo).value = nombre;
    $('[data-a=arriba]', cuerpo).onclick = () => cargar(actual.replace(/\\[^\\]+\\?$/, '') || actual);
    $('[data-a=ir]', cuerpo).onclick = () => cargar($('.ruta', cuerpo).value);
    $('.ruta', cuerpo).onkeydown = (e) => { if (e.key === 'Enter') cargar(e.target.value); };
    cargar(guardar && nombre.includes('\\') ? nombre.replace(/\\[^\\]+$/, '') : '');
  });
}

// ---------------------------------------------------------------- unidades del modelo abierto
const NOMBRES_UNIDAD = { caudal: 'unidades de caudal', presion: 'unidades de presión', longitud: 'unidades de longitud', cota: 'unidades de longitud',
  carga: 'unidades de longitud', nivel: 'unidades de longitud', diametro: 'unidades de diámetro', diametro_tanque: 'unidades de longitud',
  velocidad: 'unidades de velocidad', volumen: 'unidades de volumen', potencia: 'unidades de potencia', rugosidad: 'unidades de rugosidad' };
export function U(clave) { return S.M?.sistema?.[clave] ?? NOMBRES_UNIDAD[clave] ?? clave; }
// reemplaza los marcadores {caudal}, {presion}... de los textos del servidor por las unidades del modelo
export function u(texto) { return String(texto ?? '').replace(/\{(\w+)\}/g, (_, k) => U(k)); }

// ---------------------------------------------------------------- ayudas para el modelo
export const TIPO_NUDO = ['junction', 'reservoir', 'tank'];
export function nombreNudo(i) { const N = S.M.nudos; return N.com[i] ? `${N.id[i]} · ${N.com[i]}` : N.id[i]; }
export function nombreTramo(k) { const L = S.M.tramos; return L.com[k] ? `${L.id[k]} · ${L.com[k]}` : L.id[k]; }
export function claseTexto(clase, i) {
  const t = S.textos?.tipos || {};
  if (clase === 'nudo') return t[TIPO_NUDO[S.M.nudos.tipo[i]]] || 'Nudo';
  const vt = S.M.tramos.tipo[i];
  return t[vt] || (vt === 'PIPE' ? 'Tubería' : vt === 'PUMP' ? 'Bomba' : vt);
}
// elementos de un hallazgo o lista -> conjuntos de índices
export function conjunto(elementos) {
  const r = { nudos: new Set(), tramos: new Set() };
  for (const e of elementos || []) {
    if (e.clase === 'nudo') { const i = S.idxN.get(e.id); if (i !== undefined) r.nudos.add(i); } else {
      const k = S.idxL.get(e.id); if (k !== undefined) r.tramos.add(k);
    }
  }
  return r;
}

// los campos del modelo en palabras (avisos, lista de ediciones, cambios de un script)
export const CAMPO_TEXTO = { cota: 'cota', dem: 'demanda base', pat: 'patrón', diam: 'diámetro', lon: 'longitud', rug: 'rugosidad',
  km: 'pérdida menor', consigna: 'consigna', vt: 'tipo de válvula', nini: 'nivel inicial', nmin: 'nivel mínimo', nmax: 'nivel máximo',
  vmin: 'volumen mínimo', curva: 'curva', tag: 'etiqueta', estado: 'estado', potencia: 'potencia', velocidad: 'velocidad', patron: 'patrón' };
// la Longitud automática (como el Auto-Length de EPANET): al mover o unir nudos, las tuberías conectadas toman la
// longitud del dibujo. Prendida en los modelos hechos en Cauce, apagada en los demás (no tocar modelos calibrados).
export function longitudAuto() { const v = S.longAuto?.[S.doc]; return v ?? !!S.info?.propio; }
// lo que trae un escenario de EPANET (.scn), en palabras: {DIAMETERS: 64, RULES: 0} -> '64 diámetros, sin reglas'
const SCN_TEXTO = { DIAMETERS: ['diámetro', 'diámetros'], ROUGHNESS: ['rugosidad', 'rugosidades'], DEMANDS: ['demanda', 'demandas'],
  QUALITY: ['calidad inicial', 'calidades iniciales'], REACTIONS: ['reacción', 'reacciones'], CONTROLS: ['control', 'controles'], RULES: ['regla', 'reglas'] };
export function textoScn(cuentas) {
  return Object.entries(cuentas || {}).map(([k, v]) => { const [uno, varios] = SCN_TEXTO[k] || [k, k]; return v ? `${n(v, 0)} ${v === 1 ? uno : varios}` : `sin ${varios}`; }).join(', ');
}
export function cuentasScn(secciones) {
  // elementos distintos (un nudo con varias categorías de demanda cuenta una vez), como lo cuenta el servidor
  const datos = (t) => t.trim() && !t.trim().startsWith(';');
  const elementos = (k, v) => new Set(v.map((x) => (k === 'REACTIONS' ? `${x[0].toUpperCase()} ${x[1]}` : x[0]))).size;
  return Object.fromEntries(Object.entries(secciones || {}).map(([k, v]) => [k, k === 'CONTROLS' ? v.filter(datos).length : k === 'RULES' ? v.filter((t) => /^\s*RULE\s/i.test(t)).length : elementos(k, v)]));
}
// una edición del escenario, en palabras (lista de ediciones, cambios de un script)
export function describir(o) {
  const t = {
    nudo: () => `Nudo nuevo ${o.id || ''}`, tanque: () => `Tanque nuevo ${o.id || ''}`, embalse: () => `Embalse nuevo ${o.id || ''}`,
    tuberia: () => `Tubería ${o.id || ''} de ${o.n1} a ${o.n2} (${o.diam} ${U('diametro')})`, partir: () => `Partir ${o.tramo} (nudo ${o.id_nudo || ''})`,
    insertar: () => `${o.clase === 'bomba' ? 'Bomba' : `Válvula ${o.vt || ''}`} ${o.id || ''} en ${o.tramo}`, borrar: () => `Borrar ${o.tipo} ${o.id}`,
    mover: () => `Mover ${o.id}`, unir: () => `Unir ${o.nudo} con ${o.destino}`, propiedad: () => `${o.id}: ${CAMPO_TEXTO[o.campo] || o.campo} = ${o.valor}`, estado: () => `${o.id}: estado ${o.valor || 'como en el archivo'}`,
    valvula: () => `Válvula ${o.id || ''}`, bomba_nueva: () => `Bomba ${o.id || ''}`, etiqueta: () => `${o.id}: etiqueta ${o.valor}`,
    opcion: () => `${o.clave} = ${o.valor}`, multiplicador: () => `Multiplicador ${o.valor}`,
    patron: () => `Patrón ${o.id}${o.valores ? '' : ' (borrado)'}`, curva: () => `Curva ${o.id}${o.puntos ? '' : ' (borrada)'}`, controles: () => 'Controles', reglas: () => 'Reglas',
    varias: () => o.nombre || `${o.ops?.length || 0} cambios`,
    script: () => `Script «${o.nombre || 'sin nombre'}» · ${o.ops?.length || 0} ${o.ops?.length === 1 ? 'cambio' : 'cambios'}`,
    scn: () => `Escenario de EPANET «${o.nombre || 'sin nombre'}» · ${textoScn(cuentasScn(o.secciones))}`,
  }[o.op];
  return t ? t() : o.op;
}
