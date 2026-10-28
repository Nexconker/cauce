// Lector de reportes de EPANET (.rpt) en su propia ventana. Lo abren el panel Correr (el reporte de la corrida que se
// está viendo), Informes y la pantalla de inicio (cualquier .rpt del disco); también se le puede soltar un archivo encima.
// Con un modelo abierto relacionado, cada elemento se ve en el mapa de la ventana principal (BroadcastChannel «cauce»).
import { get, esc, h, $, $$, n, aviso, fallo, explorar, esqueleto } from './estado.js';
import { TIPOS, leerReporte, reloj } from './rpt_lector.js';

const Q = new URLSearchParams(location.search);
const st = {
  texto: '', lineas: [], R: null, nombre: '', fuente: '', doc: Q.get('doc') || '', mod: null, pestana: 'resumen',
  tipo: '', busca: '', orden: { col: 'n', dir: -1 }, abierto: '', todos: false,
  paso: -1, soloAvisos: true, tipoPaso: '', porT: null,
  resClase: '', resVar: -1, resId: '', resHora: -1, resSentido: 0,
  txtBusca: '', aciertos: [], acierto: -1, marca: -1, minus: null,
};
const canal = (() => { try { return new BroadcastChannel('cauce'); } catch (e) { return null; } })();
// los cinco tipos de aviso más frecuentes del reporte, en orden fijo; el resto va junto, en gris
const PALETA = ['#7aa2ff', '#ffb547', '#ef6f6c', '#4fc3a1', '#c58cf0'];
const GRIS = '#7d7272';
const LH = 18;      // alto de una línea del texto (px), el mismo de .ln en rpt.css
let colorTipo = {};
const PESTANAS = [['resumen', 'Resumen'], ['avisos', 'Avisos por elemento'], ['pasos', 'Paso a paso'], ['resultados', 'Resultados'], ['texto', 'Texto']];
const C = () => $('#rcuerpo');
const corto = (k) => TIPOS[k]?.corto || k;
const largo = (k) => TIPOS[k]?.nombre || k;

// ====================================================================== carga
async function iniciar() {
  $('#r-abrir').onclick = abrirDisco;
  $('#r-pc').onclick = () => $('#r-local').click();
  $('#r-local').onchange = (e) => { const f = e.target.files?.[0]; if (f) leerArchivo(f); e.target.value = ''; };
  soltar();
  document.addEventListener('keydown', teclas);
  window.addEventListener('resize', () => { if (st.pestana === 'texto') pintarLineas(); else if (st.R && ['resumen', 'resultados'].includes(st.pestana)) pintar(); });
  C().addEventListener('click', clics);
  await modelos();
  try {
    const corrida = Q.get('corrida'), ruta = Q.get('ruta');
    if (corrida) await traer(`/api/corrida/${encodeURIComponent(corrida)}/rpt`, Q.get('nombre') || 'Reporte de la corrida', 'Corrida de Cauce');
    else if (ruta) await traer(`/api/rpt?ruta=${encodeURIComponent(ruta)}`, ruta.split('\\').pop(), ruta);
    else vacio();
  } catch (e) { fallo(e); vacio(e.message); }
}

async function traer(url, nombre, fuente) {
  cargando(nombre, 'Trayendo el reporte…');
  const r = await fetch(url);
  if (!r.ok) {
    let m = `No pude leer el reporte (${r.status}).`;
    try { m = (await r.json()).error || m; } catch (e) { /* sin JSON */ }
    throw new Error(m);
  }
  await usar(await r.text(), nombre, fuente);
}

function leerArchivo(f) {
  const lector = new FileReader();
  lector.onload = () => usar(String(lector.result || ''), f.name, 'Archivo del PC').catch(fallo);
  lector.onerror = () => aviso(`No pude leer ${f.name}.`, 'error');
  cargando(f.name, 'Leyendo el archivo…');
  lector.readAsText(f, 'windows-1252');      // EPANET escribe el reporte en ANSI
}

async function abrirDisco() {
  const r = await explorar({ titulo: 'Abrir un reporte de EPANET', filtro: ['.rpt', '.txt', '.log'] });
  if (!r) return;
  const q = new URLSearchParams({ ruta: r });
  if (st.doc) q.set('doc', st.doc);
  history.replaceState(null, '', `?${q}`);
  try { await traer(`/api/rpt?ruta=${encodeURIComponent(r)}`, r.split('\\').pop(), r); } catch (e) { fallo(e); }
}

async function usar(texto, nombre, fuente) {
  Object.assign(st, { texto, lineas: texto.split(/\r?\n/), nombre, fuente, tipo: '', busca: '', abierto: '', todos: false, paso: -1, porT: null,
    resId: '', resVar: -1, resHora: -1, txtBusca: '', aciertos: [], acierto: -1, marca: -1, minus: null, lim: null });
  cargando(nombre, `Leyendo ${n(texto.length / 1048576, 1)} MB y ${n(st.lineas.length, 0)} líneas…`);
  const t0 = performance.now();
  st.R = await analizar(texto);
  st.ms = performance.now() - t0;
  colorTipo = {};
  Object.entries(st.R.porTipo).sort((a, b) => b[1] - a[1]).forEach(([k], j) => { colorTipo[k] = j < PALETA.length ? PALETA[j] : GRIS; });
  st.resClase = st.R.resultados.nudo ? 'nudo' : st.R.resultados.tramo ? 'tramo' : '';
  document.title = `${nombre} · Reporte de EPANET · Cauce`;
  st.pestana = 'resumen';
  pintar();
}

// el reporte se lee en un Worker para que la ventana no se congele con los de decenas de MB
function analizar(texto) {
  return new Promise((listo) => {
    let w;
    try { w = new Worker('js/rpt_obra.js', { type: 'module' }); } catch (e) { listo(leerReporte(texto)); return; }
    w.onmessage = (e) => { w.terminate(); listo(e.data.ok ? e.data.r : leerReporte(texto)); };
    w.onerror = () => { w.terminate(); listo(leerReporte(texto)); };
    w.postMessage(texto);
  });
}

function cargando(nombre, msg) {
  $('#rtabs').hidden = true;
  $('#r-titulo').innerHTML = `<b>${esc(nombre)}</b><span>${esc(msg)}</span>`;
  C().className = '';
  C().innerHTML = `<div class="r-cargando">${esc(msg)}${esqueleto(5, true)}</div>`;
}

function vacio(error = '') {
  $('#rtabs').hidden = true;
  $('#r-titulo').innerHTML = '<b>Ningún reporte abierto</b><span>Ábrelo de una carpeta, desde el PC o suéltalo aquí</span>';
  C().className = '';
  C().innerHTML = `<div class="r-vacio">
    <h1>Lee un reporte de EPANET</h1>
    <p>Los avisos agrupados por elemento y por hora, el paso a paso de la simulación, las tablas de resultados si el reporte las trae y el texto completo con buscador.</p>
    ${error ? `<div class="tarjeta error" style="text-align:left"><h3>${esc(error)}</h3></div>` : ''}
    <div class="zona">Suelta aquí un archivo .rpt</div>
    <div class="acciones"><button class="btn prim" data-a="disco">Abrir de una carpeta</button><button class="btn" data-a="pc">Desde el PC</button></div></div>`;
  $('[data-a=disco]', C()).onclick = abrirDisco;
  $('[data-a=pc]', C()).onclick = () => $('#r-local').click();
}

function soltar() {
  const capa = $('#r-soltar');
  let dentro = 0;
  const tiene = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  document.addEventListener('dragenter', (e) => { if (!tiene(e)) return; dentro++; capa.hidden = false; });
  document.addEventListener('dragleave', () => { dentro = Math.max(0, dentro - 1); if (!dentro) capa.hidden = true; });
  document.addEventListener('dragover', (e) => { if (tiene(e)) e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    if (!tiene(e)) return;
    e.preventDefault(); dentro = 0; capa.hidden = true;
    const f = e.dataTransfer.files?.[0];
    if (f) leerArchivo(f);
  });
}

// ====================================================================== modelo relacionado (para ver en el mapa)
async function modelos() {
  try {
    const { docs = [] } = await get('/api/estado');
    const sel = $('#r-modelo');
    sel.innerHTML = '<option value="">ninguno</option>' + docs.map((d) => `<option value="${esc(d.id)}">${esc(d.nombre)}</option>`).join('');
    $('#r-modelo-caja').hidden = !docs.length;
    if (st.doc && docs.some((d) => d.id === st.doc)) { sel.value = st.doc; await relacionar(st.doc, false); } else st.doc = '';
    sel.onchange = () => relacionar(sel.value, true);
  } catch (e) { $('#r-modelo-caja').hidden = true; }
}

async function relacionar(doc, repintar) {
  st.doc = doc; st.mod = null;
  if (doc) {
    try {
      const { info, modelo: M } = await get(`/api/doc/${encodeURIComponent(doc)}/modelo`);
      const N = new Map(), T = new Map(), tn = ['Nudo', 'Embalse', 'Tanque'];
      M.nudos.id.forEach((id, i) => N.set(id, { clase: 'nudo', com: M.nudos.com[i] || '', tipo: tn[M.nudos.tipo[i]] || 'Nudo' }));
      M.tramos.id.forEach((id, i) => T.set(id, { clase: 'tramo', com: M.tramos.com[i] || '', tipo: M.tramos.tipo[i] || '' }));
      st.mod = { doc, nombre: info?.nombre || '', N, T };
    } catch (e) { fallo(e); }
  }
  if (repintar && st.R) pintar();
}

function datoEl(clase, id) {
  if (!st.mod || !id) return null;
  return (clase === 'nudo' ? st.mod.N.get(id) : st.mod.T.get(id)) || st.mod.T.get(id) || st.mod.N.get(id) || null;
}
function etiquetaEl(clase, id) {
  const d = datoEl(clase, id);
  return `<b class="mono">${esc(id)}</b>${d?.com ? `<span class="com">${esc(d.com)}</span>` : ''}`;
}
function botonMapa(clase, id) {
  const d = datoEl(clase, id);
  return d ? `<button class="btn chico r-mapa" data-clase="${d.clase}" data-id="${esc(id)}" title="Ver ${esc(id)} en el mapa de la ventana principal">Mapa</button>` : '';
}
const botonTexto = (linea) => `<button class="btn chico r-linea" data-linea="${linea}" title="Ver esta línea en el texto del reporte">Texto</button>`;

function verEnMapa(clase, id) {
  if (!canal || !st.mod) return;
  canal.postMessage({ tipo: 'ir', doc: st.mod.doc, clase, id });
  try { window.pywebview?.api?.al_frente?.(); } catch (e) { /* sin ventana propia */ }
  aviso(`${id}: en el mapa de la ventana principal.`);
}

function clics(e) {
  const m = e.target.closest('.r-mapa');
  if (m) { e.stopPropagation(); verEnMapa(m.dataset.clase, m.dataset.id); return; }
  const l = e.target.closest('.r-linea');
  if (l) { e.stopPropagation(); irALinea(+l.dataset.linea); }
}

// ====================================================================== pintar
function pintar() {
  const R = st.R;
  if (!R) return;
  const mb = st.texto.length / 1048576;
  const partes = [st.fuente, `${n(mb, mb < 10 ? 1 : 0)} MB`, `${n(st.lineas.length, 0)} líneas`];
  if (R.meta.version) partes.push(`EPANET ${R.meta.version}`);
  if (R.meta.segundos !== null) partes.push(`cálculo de ${duracion(R.meta.segundos)}`);
  $('#r-titulo').innerHTML = `<b>${esc(st.nombre)}</b><span title="${esc(partes.join(' · '))}">${esc(partes.join(' · '))}</span>`;
  const hayRes = !!(R.resultados.nudo || R.resultados.tramo);
  const cuentas = { avisos: R.porElemento.length, pasos: R.pasos.filter((p) => p.avisos).length };
  const tabs = $('#rtabs');
  tabs.hidden = false;
  const hayAvisos = R.avisos.length > 0 || R.estados.length > 0;
  tabs.innerHTML = PESTANAS.filter(([k]) => (k !== 'resultados' || hayRes) && (!['avisos', 'pasos'].includes(k) || hayAvisos))
    .map(([k, t]) => `<button role="tab" data-k="${k}" class="${k === st.pestana ? 'on' : ''}" aria-selected="${k === st.pestana}">${t}${cuentas[k] ? `<span class="c">${n(cuentas[k], 0)}</span>` : ''}</button>`).join('');
  $$('#rtabs button').forEach((b) => { b.onclick = () => { st.pestana = b.dataset.k; pintar(); }; });
  if ((st.pestana === 'resultados' && !hayRes) || (['avisos', 'pasos'].includes(st.pestana) && !hayAvisos)) st.pestana = 'resumen';
  const c = C();
  c.className = ['pasos', 'texto'].includes(st.pestana) ? 'lleno' : '';
  c.innerHTML = '';
  ({ resumen: tResumen, avisos: tAvisos, pasos: tPasos, resultados: tResultados, texto: tTexto })[st.pestana](c);
}

function duracion(s) {
  if (s < 90) return `${n(s, 0)} s`;
  if (s < 5400) return `${n(s / 60, 1)} min`;
  return `${n(s / 3600, 1)} h`;
}
const fmtHora = (t) => reloj(t, true);

// límites de cada tipo (primera y última hora, elementos distintos), una vez por reporte
function limites() {
  if (st.lim) return st.lim;
  const L = {};
  for (const [t, tipo] of st.R.avisos) {
    const x = (L[tipo] ||= { t0: Infinity, t1: -1, els: 0, linea: -1 });
    if (t >= 0) { x.t0 = Math.min(x.t0, t); x.t1 = Math.max(x.t1, t); }
  }
  st.R.porElemento.forEach((e) => { L[e.tipo].els++; });
  st.R.avisos.forEach(([, tipo, , ln]) => { if (L[tipo].linea < 0) L[tipo].linea = ln; });
  return (st.lim = L);
}

// ====================================================================== resumen
function tResumen(c) {
  const R = st.R;
  const L = limites();
  const A = R.avisos.length;
  const tipos = Object.entries(R.porTipo).sort((a, b) => b[1] - a[1]);
  const pasosAv = R.pasos.filter((p) => p.avisos).length;
  const pasosTot = R.iteraciones.length;      // sin el reporte de estados no se sabe cuántos pasos hubo en total
  const itMax = R.iteraciones.reduce((m, x) => Math.max(m, x[1]), 0);
  const ultima = R.pasos.length ? R.pasos[R.pasos.length - 1].t : null;
  const RS = R.resultados, TT = RS.nudo || RS.tramo;
  c.append(h(`<div class="r-cifras">
    <div class="cifra ${A ? 'ojo' : 'bien'}"><div class="v">${n(A, 0)}</div><div class="t">avisos de EPANET</div></div>
    ${A ? `<div class="cifra"><div class="v">${n(R.porElemento.length, 0)}</div><div class="t">elementos con algún aviso</div></div>
    <div class="cifra"><div class="v">${n(pasosAv, 0)}${pasosTot ? `<small>de ${n(pasosTot, 0)}</small>` : ''}</div><div class="t">pasos de cálculo con avisos</div></div>
    <div class="cifra"><div class="v">${ultima === null ? '—' : reloj(ultima, false)}</div><div class="t">último paso con mensajes</div></div>` : ''}
    ${!A && RS.nudo ? `<div class="cifra"><div class="v">${n(RS.nudo.ids.length, 0)}</div><div class="t">nudos en las tablas</div></div>` : ''}
    ${!A && RS.tramo ? `<div class="cifra"><div class="v">${n(RS.tramo.ids.length, 0)}</div><div class="t">tramos en las tablas</div></div>` : ''}
    ${!A && TT ? `<div class="cifra"><div class="v">${n(TT.horas.length, 0)}</div><div class="t">horas de reporte</div></div>` : ''}
    ${R.iteraciones.length ? `<div class="cifra"><div class="v">${n(itMax, 0)}</div><div class="t">iteraciones en el paso más difícil</div></div>` : ''}
    ${R.errores.length ? `<div class="cifra mal"><div class="v">${n(R.errores.length, 0)}</div><div class="t">errores al leer el modelo</div></div>` : ''}
  </div>`));
  if (R.errores.length) {
    const t = h(`<div class="tarjeta error" style="margin-top:14px"><h3>EPANET encontró errores al leer el modelo</h3><table class="tabla"></table></div>`);
    R.errores.slice(0, 30).forEach((e) => $('table', t).append(h(`<tr><td class="mono">${esc(e.texto)}</td><td class="acc">${botonTexto(e.linea)}</td></tr>`)));
    c.append(t);
  }
  if (!A) {
    c.append(h(`<div class="tarjeta ok" style="margin-top:14px"><h3>Sin avisos</h3><p>EPANET no dejó ningún aviso en este reporte${R.resultados.nudo || R.resultados.tramo ? '. Las tablas de resultados están en su pestaña.' : '.'}</p></div>`));
  } else {
    const series = seriesHoras();
    const g = h(`<div class="r-sec"><div class="eti">Avisos por hora<span class="sub">Cada barra suma los avisos de todos los pasos de cálculo de esa hora</span></div>
      <div class="r-leyenda">${series.map((s) => `<span><i class="sw" style="background:${s.color}"></i>${esc(s.nombre)}</span>`).join('')}</div>
      <div class="r-graf"><canvas aria-label="Avisos por hora"></canvas></div></div>`);
    c.append(g);
    requestAnimationFrame(() => graficaHoras($('canvas', g), series));
    const dos = h('<div class="r-dos r-sec"></div>');
    const porTipo = h(`<div><div class="eti" style="margin-bottom:8px">Por tipo de aviso</div><div class="tabla-caja r-tabla"><table class="tabla">
      <tr><th>Tipo</th><th class="n">Avisos</th><th class="n">Elementos</th><th class="n">Primera</th><th class="n">Última</th><th></th></tr></table></div></div>`);
    tipos.forEach(([k, v]) => {
      const x = L[k];
      const tr = h(`<tr class="${TIPOS[k]?.clase ? 'clic' : ''}"><td><i class="sw" style="background:${colorTipo[k]}"></i>${esc(largo(k))}</td><td class="n">${n(v, 0)}</td>
        <td class="n">${TIPOS[k]?.clase ? n(x.els, 0) : '—'}</td><td class="n">${fmtHora(x.t0 === Infinity ? -1 : x.t0)}</td><td class="n">${fmtHora(x.t1)}</td><td class="acc">${botonTexto(x.linea)}</td></tr>`);
      if (TIPOS[k]?.clase) tr.onclick = (e) => { if (e.target.closest('button')) return; st.tipo = k; st.pestana = 'avisos'; pintar(); };
      $('table', porTipo).append(tr);
    });
    dos.append(porTipo);
    const top = h(`<div><div class="eti" style="margin-bottom:8px">Lo que más se repite</div><div class="tabla-caja r-tabla"><table class="tabla">
      <tr><th>Elemento</th><th>Aviso</th><th class="n">Veces</th><th class="n">Horas</th><th></th></tr></table></div></div>`);
    R.porElemento.slice(0, 12).forEach((x) => {
      const tr = h(`<tr class="clic"><td>${etiquetaEl(TIPOS[x.tipo]?.clase, x.el)}</td><td><i class="sw" style="background:${colorTipo[x.tipo]}"></i>${esc(corto(x.tipo))}</td>
        <td class="n">${n(x.n, 0)}</td><td class="n">${n(x.horas, 0)}</td><td class="acc">${botonMapa(TIPOS[x.tipo]?.clase, x.el)}</td></tr>`);
      tr.onclick = (e) => { if (e.target.closest('button')) return; st.tipo = ''; st.busca = ''; st.abierto = `${x.tipo}|${x.el}`; st.pestana = 'avisos'; pintar(); };
      $('table', top).append(tr);
    });
    if (!R.porElemento.length) $('table', top).append(h('<tr><td colspan="5" class="vacio">Ningún aviso señala un elemento concreto.</td></tr>'));
    dos.append(top);
    c.append(dos);
  }
  const res = R.resultados;
  if (res.nudo || res.tramo) {
    const T = res.nudo || res.tramo;
    const t = h(`<div class="tarjeta info r-sec"><h3>El reporte trae tablas de resultados</h3>
      <p>${res.nudo ? `${n(res.nudo.ids.length, 0)} nudos` : ''}${res.nudo && res.tramo ? ' y ' : ''}${res.tramo ? `${n(res.tramo.ids.length, 0)} tramos` : ''} en ${n(T.horas.length, 0)} horas de reporte.
      En Resultados se ve cada elemento hora a hora y los más bajos o más altos de cada variable.</p><div class="acciones"><button class="btn">Ver resultados</button></div></div>`);
    $('button', t).onclick = () => { st.pestana = 'resultados'; pintar(); };
    c.append(t);
  }
  if (R.meta.resumen.length) {
    const d = h(`<details class="r-sec"><summary class="eti">Resumen de datos del modelo, como lo leyó EPANET</summary><table class="tabla" style="margin-top:8px;max-width:640px"></table></details>`);
    R.meta.resumen.forEach(([k, v]) => $('table', d).append(h(`<tr><td>${esc(k)}</td><td class="n">${esc(v)}</td></tr>`)));
    c.append(d);
  }
  if (!st.mod && $('#r-modelo-caja').hidden === false) {
    c.append(h('<p class="sub r-sec" style="color:var(--apagado)">Elige arriba el modelo al que corresponde este reporte para ver cada elemento en el mapa y con su nombre.</p>'));
  }
}

function seriesHoras() {
  const R = st.R;
  const orden = Object.entries(R.porTipo).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const top = orden.slice(0, PALETA.length), resto = orden.slice(PALETA.length);
  const series = top.map((k) => ({ nombre: corto(k), color: colorTipo[k], v: R.porHora[k] || new Array(R.horas).fill(0) }));
  if (resto.length) {
    const v = new Array(R.horas).fill(0);
    resto.forEach((k) => (R.porHora[k] || []).forEach((x, i) => { v[i] += x; }));
    series.push({ nombre: 'Otros', color: GRIS, v });
  }
  return series;
}

function paso(max) {
  const bruto = max / 4, e = 10 ** Math.floor(Math.log10(bruto)), f = bruto / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e;
}

function lienzo(cv) {
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement);
  return { g, W, H, apagado: css.getPropertyValue('--apagado').trim() || '#958a8a', linea: css.getPropertyValue('--linea').trim() || '#2a2525' };
}

function graficaHoras(cv, series) {
  if (!cv) return;
  const { g, W, H, apagado, linea } = lienzo(cv);
  const nH = st.R.horas, tot = new Array(nH).fill(0);
  series.forEach((s) => s.v.forEach((x, i) => { tot[i] += x; }));
  const max = Math.max(1, ...tot), p = paso(max), ymax = Math.ceil(max / p) * p;
  const m = { l: 52, r: 8, t: 8, b: 22 };
  const x0 = m.l, x1 = W - m.r, y0 = H - m.b, y1 = m.t, bw = (x1 - x0) / nH;
  const Y = (v) => y0 - (v / ymax) * (y0 - y1);
  g.font = '11px "Geist Mono", Consolas, monospace';
  g.strokeStyle = linea; g.fillStyle = apagado; g.lineWidth = 1;
  for (let v = 0; v <= ymax + 1e-9; v += p) {
    const y = Math.round(Y(v)) + 0.5;
    g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
    g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(n(v, 0), x0 - 8, y);
  }
  const hueco = Math.min(2, bw * 0.2);
  for (let i = 0; i < nH; i++) {
    let base = 0;
    const x = x0 + i * bw + hueco / 2, w = Math.max(1, bw - hueco);
    series.forEach((s) => {
      const v = s.v[i];
      if (!v) return;
      const ya = Y(base + v), yb = Y(base);
      g.fillStyle = s.color;
      g.fillRect(x, ya, w, Math.max(1, yb - ya - (base ? 1 : 0)));      // 1 px de fondo entre tramos apilados
      base += v;
    });
  }
  g.fillStyle = apagado; g.textAlign = 'center'; g.textBaseline = 'top';
  const cada = nH > 48 ? 6 : nH > 24 ? 3 : nH > 12 ? 2 : 1;
  for (let i = 0; i < nH; i += cada) g.fillText(`${i} h`, x0 + i * bw + bw / 2, y0 + 6);
  const tip = $('#r-tip');
  cv.onmousemove = (e) => {
    const r = cv.getBoundingClientRect();
    const i = Math.floor((e.clientX - r.left - x0) / bw);
    if (i < 0 || i >= nH || !tot[i]) { tip.hidden = true; return; }
    tip.innerHTML = `<b>De ${i}:00 a ${i + 1}:00</b>${series.filter((s) => s.v[i]).map((s) => `<div><i class="sw" style="background:${s.color}"></i>${esc(s.nombre)}<span>${n(s.v[i], 0)}</span></div>`).join('')}<div class="tot">Total<span>${n(tot[i], 0)}</span></div>`;
    tip.hidden = false;
    const x = Math.min(window.innerWidth - tip.offsetWidth - 12, e.clientX + 14), y = Math.max(8, e.clientY - tip.offsetHeight - 10);
    tip.style.left = `${x}px`; tip.style.top = `${y}px`;
  };
  cv.onmouseleave = () => { tip.hidden = true; };
}

// ====================================================================== avisos por elemento
function filasAvisos() {
  const q = st.busca.trim().toLowerCase();
  let filas = st.R.porElemento.filter((x) => (!st.tipo || x.tipo === st.tipo) && (!q || x.el.toLowerCase().includes(q) || (datoEl(TIPOS[x.tipo]?.clase, x.el)?.com || '').toLowerCase().includes(q)));
  const { col, dir } = st.orden;
  const val = { el: (x) => x.el, tipo: (x) => corto(x.tipo), n: (x) => x.n, horas: (x) => x.horas, t0: (x) => x.t0, t1: (x) => x.t1 }[col];
  filas = filas.slice().sort((a, b) => { const p = val(a), q2 = val(b); return (typeof p === 'string' ? p.localeCompare(q2, 'es', { numeric: true }) : p - q2) * dir || b.n - a.n; });
  return filas;
}

function tAvisos(c) {
  const R = st.R;
  const conEl = Object.entries(R.porTipo).filter(([k]) => TIPOS[k]?.clase).sort((a, b) => b[1] - a[1]);
  const cuentaEl = (k) => R.porElemento.filter((x) => x.tipo === k).length;
  c.append(h(`<div class="r-chips"><button data-tipo="" class="${st.tipo ? '' : 'on'}">Todos<span>${n(R.porElemento.length, 0)}</span></button>${conEl.map(([k]) =>
    `<button data-tipo="${k}" class="${st.tipo === k ? 'on' : ''}"><i class="sw" style="background:${colorTipo[k]}"></i>${esc(corto(k))}<span>${n(cuentaEl(k), 0)}</span></button>`).join('')}</div>`));
  $$('.r-chips button', c).forEach((b) => { b.onclick = () => { st.tipo = b.dataset.tipo; st.todos = false; pintar(); }; });
  const f = h(`<div class="r-filtros"><input type="search" id="r-busca" placeholder="Buscar por ID${st.mod ? ' o por nombre' : ''}" value="${esc(st.busca)}" spellcheck="false">
    <div class="der"><span class="sub" id="r-n" style="color:var(--apagado)"></span><button class="btn chico" id="r-copiar" title="Copia la tabla filtrada para pegarla en Excel">Copiar para Excel</button></div></div>`);
  c.append(f);
  const caja = h('<div class="tabla-caja r-tabla"></div>');
  c.append(caja);
  const general = Object.entries(R.porTipo).filter(([k]) => !TIPOS[k]?.clase).sort((a, b) => b[1] - a[1]);
  if (general.length && !st.tipo) {
    const L = limites();
    const g = h(`<div class="r-sec"><div class="eti">Avisos generales<span class="sub">No señalan un elemento: afectan a toda la red en ese paso</span></div><div class="tabla-caja r-tabla"><table class="tabla">
      <tr><th>Aviso</th><th class="n">Veces</th><th class="n">Primera</th><th class="n">Última</th><th></th></tr></table></div></div>`);
    general.forEach(([k, v]) => $('table', g).append(h(`<tr><td><i class="sw" style="background:${colorTipo[k]}"></i>${esc(largo(k))}</td><td class="n">${n(v, 0)}</td><td class="n">${fmtHora(L[k].t0 === Infinity ? -1 : L[k].t0)}</td><td class="n">${fmtHora(L[k].t1)}</td><td class="acc">${botonTexto(L[k].linea)}</td></tr>`)));
    c.append(g);
  }
  const pintarTabla = () => {
    const filas = filasAvisos();
    $('#r-n').textContent = `${n(filas.length, 0)} ${filas.length === 1 ? 'elemento' : 'elementos'}`;
    const flecha = (k) => (st.orden.col === k ? `<span class="fl">${st.orden.dir > 0 ? '↑' : '↓'}</span>` : '');
    const t = h(`<table class="tabla"><tr><th class="orden" data-col="el">Elemento${flecha('el')}</th><th class="orden" data-col="tipo">Aviso${flecha('tipo')}</th>
      <th class="orden n" data-col="n">Veces${flecha('n')}</th><th class="orden n" data-col="horas" title="Horas distintas con este aviso">Horas${flecha('horas')}</th>
      <th class="orden n" data-col="t0">Primera${flecha('t0')}</th><th class="orden n" data-col="t1">Última${flecha('t1')}</th><th></th></tr></table>`);
    $$('th.orden', t).forEach((th) => { th.onclick = () => { const k = th.dataset.col; st.orden = { col: k, dir: st.orden.col === k ? -st.orden.dir : (['el', 'tipo', 't0'].includes(k) ? 1 : -1) }; pintarTabla(); }; });
    const tope = st.todos ? filas.length : Math.min(filas.length, 300);
    for (let j = 0; j < tope; j++) {
      const x = filas[j], k = `${x.tipo}|${x.el}`, cl = TIPOS[x.tipo]?.clase;
      const tr = h(`<tr class="clic ${st.abierto === k ? 'abierta' : ''}"><td>${etiquetaEl(cl, x.el)}</td><td><i class="sw" style="background:${colorTipo[x.tipo]}"></i>${esc(corto(x.tipo))}</td>
        <td class="n">${n(x.n, 0)}</td><td class="n">${n(x.horas, 0)}</td><td class="n">${fmtHora(x.t0)}</td><td class="n">${fmtHora(x.t1)}</td><td class="acc">${botonMapa(cl, x.el)}${botonTexto(x.linea)}</td></tr>`);
      tr.onclick = (e) => { if (e.target.closest('button')) return; st.abierto = st.abierto === k ? '' : k; pintarTabla(); };
      t.append(tr);
      if (st.abierto === k) t.append(detalle(x));
    }
    if (!filas.length) t.append(h('<tr><td colspan="7" class="vacio">Nada con ese filtro.</td></tr>'));
    caja.innerHTML = ''; caja.append(t);
    if (tope < filas.length) {
      const m = h(`<div class="r-mas"><button class="btn chico">Mostrar los ${n(filas.length, 0)}</button></div>`);
      $('button', m).onclick = () => { st.todos = true; pintarTabla(); };
      caja.append(m);
    }
  };
  pintarTabla();
  let espera = null;
  $('#r-busca').oninput = (e) => { clearTimeout(espera); espera = setTimeout(() => { st.busca = e.target.value; st.todos = false; pintarTabla(); }, 160); };
  $('#r-copiar').onclick = () => {
    const filas = filasAvisos();
    const tsv = [['Elemento', 'Nombre', 'Aviso', 'Veces', 'Horas', 'Primera', 'Última'].join('\t'),
      ...filas.map((x) => [x.el, datoEl(TIPOS[x.tipo]?.clase, x.el)?.com || '', largo(x.tipo), x.n, x.horas, fmtHora(x.t0), fmtHora(x.t1)].join('\t'))].join('\r\n');
    navigator.clipboard.writeText(tsv).then(() => aviso(`${n(filas.length, 0)} filas copiadas: pégalas en Excel.`), () => aviso('No pude copiar al portapapeles.', 'error'));
  };
  if (st.abierto) requestAnimationFrame(() => $('tr.abierta', caja)?.scrollIntoView({ block: 'center' }));
}

function detalle(x) {
  const veces = st.R.avisos.filter((a) => a[1] === x.tipo && a[2] === x.el);
  const horas = new Map();
  veces.forEach((a) => { const hh = Math.floor(a[0] / 3600); horas.set(hh, (horas.get(hh) || 0) + 1); });
  const d = datoEl(TIPOS[x.tipo]?.clase, x.el);
  const ej = st.lineas[x.linea]?.trim() || '';
  const tr = h(`<tr class="det"><td colspan="7">
    <div>${d ? `${esc(d.tipo)} ${d.com ? `· ${esc(d.com)} ` : ''}· ` : ''}${n(veces.length, 0)} avisos en ${n(horas.size, 0)} horas. Por hora:</div>
    <div class="r-horas">${[...horas.entries()].sort((a, b) => a[0] - b[0]).map(([hh, k]) => `<span title="${n(k, 0)} avisos entre las ${hh}:00 y las ${hh + 1}:00">${hh} h · ${n(k, 0)}</span>`).join('')}</div>
    <div class="mono" style="margin-top:8px;color:var(--tinta-2)">${esc(ej)}</div></td></tr>`);
  return tr;
}

// ====================================================================== paso a paso
function indicesPorPaso() {
  if (st.porT) return st.porT;
  const m = new Map();
  const de = (t) => { let x = m.get(t); if (!x) m.set(t, x = { a: [], e: [] }); return x; };
  st.R.avisos.forEach((a, i) => { if (a[0] >= 0) de(a[0]).a.push(i); });
  st.R.estados.forEach((e, i) => { de(e[0]).e.push(i); });
  return (st.porT = m);
}

function tPasos(c) {
  const R = st.R;
  const idx = indicesPorPaso();
  const tipos = Object.entries(R.porTipo).sort((a, b) => b[1] - a[1]);
  const barra = h(`<div class="r-filtros"><label class="motor-sel">Aviso <select id="r-ptipo"><option value="">cualquiera</option>${tipos.map(([k]) => `<option value="${k}">${esc(largo(k))}</option>`).join('')}</select></label>
    ${R.estados.length ? `<label class="chk"><input type="checkbox" id="r-psolo" ${st.soloAvisos ? 'checked' : ''}> Solo pasos con avisos</label>` : ''}
    <span class="sub" style="color:var(--apagado)" id="r-pn"></span><div class="der"><span class="sub" style="color:var(--apagado)">↑ ↓ para recorrer los pasos</span></div></div>`);
  c.append(barra);
  $('#r-ptipo').value = st.tipoPaso;
  $('#r-ptipo').onchange = (e) => { st.tipoPaso = e.target.value; pintar(); };
  if ($('#r-psolo')) $('#r-psolo').onchange = (e) => { st.soloAvisos = e.target.checked; pintar(); };
  let pasos = R.pasos;
  if (st.soloAvisos || !R.estados.length) pasos = pasos.filter((p) => p.avisos);
  if (st.tipoPaso) pasos = pasos.filter((p) => p.tipos[st.tipoPaso]);
  $('#r-pn').textContent = `${n(pasos.length, 0)} pasos`;
  if (!pasos.length) { c.append(h('<div class="vacio">Ningún paso con ese filtro.</div>')); return; }
  if (!pasos.some((p) => p.t === st.paso)) st.paso = pasos[0].t;
  const caja = h('<div class="r-pasos"><div class="r-lista-p" tabindex="0" aria-label="Pasos de cálculo"></div><div class="r-msgs"></div></div>');
  c.append(caja);
  const lista = $('.r-lista-p', caja);
  const frag = document.createDocumentFragment();
  pasos.forEach((p) => {
    const b = document.createElement('button');
    b.dataset.s = p.t;         // data-t no: es el atributo de las ayudas flotantes de Cauce
    if (p.t === st.paso) b.className = 'on';
    b.innerHTML = `<span class="mono">${fmtHora(p.t)}</span><span class="pt">${Object.keys(p.tipos).slice(0, 5).map((k) => `<i class="sw" style="background:${colorTipo[k]}"></i>`).join('')}</span><span class="cuenta">${p.avisos ? n(p.avisos, 0) : ''}</span>`;
    frag.append(b);
  });
  lista.append(frag);
  const mostrar = (t) => {
    st.paso = t;
    $$('button.on', lista).forEach((b) => b.classList.remove('on'));
    const b = lista.querySelector(`button[data-s="${t}"]`);
    if (b) { b.classList.add('on'); b.scrollIntoView({ block: 'nearest' }); }
    const x = idx.get(t) || { a: [], e: [] };
    const filas = [...x.a.map((i) => ({ ln: R.avisos[i][3], tipo: R.avisos[i][1], el: R.avisos[i][2] })), ...x.e.map((i) => ({ ln: R.estados[i][4], estado: R.estados[i] }))]
      .sort((p, q) => p.ln - q.ln);
    const m = $('.r-msgs', caja);
    m.innerHTML = `<h3>${fmtHora(t)} · ${n(x.a.length, 0)} avisos${x.e.length ? ` y ${n(x.e.length, 0)} cambios de estado` : ''}</h3>`;
    filas.forEach((f) => {
      const txt = (st.lineas[f.ln] || '').trim();
      if (f.estado) {
        const [, clase, el] = f.estado;
        const cl = ['Tank', 'Reservoir', 'Junction', 'Node'].includes(clase) ? 'nudo' : 'tramo';
        m.append(h(`<div class="r-msg estado"><i class="sw" style="background:var(--linea-2)"></i><span class="tx" title="${esc(txt)}">${esc(txt)}</span>${el ? botonMapa(cl, el) : ''}${botonTexto(f.ln)}</div>`));
      } else {
        m.append(h(`<div class="r-msg"><i class="sw" style="background:${colorTipo[f.tipo]}"></i><span class="tx" title="${esc(txt)}">${esc(txt)}</span>${f.el ? botonMapa(TIPOS[f.tipo]?.clase, f.el) : ''}${botonTexto(f.ln)}</div>`));
      }
    });
  };
  lista.onclick = (e) => { const b = e.target.closest('button'); if (b) mostrar(+b.dataset.s); };
  lista.onkeydown = (e) => {
    if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const j = pasos.findIndex((p) => p.t === st.paso) + (e.key === 'ArrowDown' ? 1 : -1);
    if (j >= 0 && j < pasos.length) mostrar(pasos[j].t);
  };
  mostrar(st.paso);
}

// ====================================================================== resultados
function tResultados(c) {
  const RS = st.R.resultados;
  const T = RS[st.resClase];
  if (!T) { c.append(h('<div class="tarjeta info"><h3>Este reporte no trae tablas de resultados</h3><p>EPANET las escribe cuando en [REPORT] se piden nudos y tramos (NODES ALL, LINKS ALL) o con el informe completo del programa de escritorio.</p></div>')); return; }
  const vars = T.cols.map((cc, i) => ({ ...cc, i })).filter((cc) => cc.clave !== 'status');
  if (!vars.some((v) => v.i === st.resVar)) {
    const pref = st.resClase === 'nudo' ? 'pressure' : 'velocity';
    st.resVar = (vars.find((v) => v.clave === pref) || vars[0]).i;
    st.resSentido = st.resClase === 'nudo' ? 1 : -1;
  }
  const V = T.cols[st.resVar];
  const barra = h(`<div class="r-filtros">
    ${RS.nudo && RS.tramo ? `<div class="seg" id="r-rclase"><button data-v="nudo" class="${st.resClase === 'nudo' ? 'on' : ''}">Nudos</button><button data-v="tramo" class="${st.resClase === 'tramo' ? 'on' : ''}">Tramos</button></div>` : ''}
    <label class="motor-sel">Variable <select id="r-rvar">${vars.map((v) => `<option value="${v.i}" ${v.i === st.resVar ? 'selected' : ''}>${esc(v.nombre)}${v.unidad ? ` (${esc(v.unidad)})` : ''}</option>`).join('')}</select></label>
    <label class="motor-sel">Hora <select id="r-rhora"><option value="-1">todo el día</option>${T.horas.map((t, j) => `<option value="${j}" ${j === st.resHora ? 'selected' : ''}>${reloj(t, false)}</option>`).join('')}</select></label>
    <div class="seg" id="r-rsent"><button data-v="1" class="${st.resSentido > 0 ? 'on' : ''}">Más bajos</button><button data-v="-1" class="${st.resSentido < 0 ? 'on' : ''}">Más altos</button></div>
    <input id="r-rid" list="r-rids" placeholder="Buscar un ${st.resClase === 'nudo' ? 'nudo' : 'tramo'} por ID" value="${esc(st.resId)}" spellcheck="false" autocomplete="off"><datalist id="r-rids"></datalist></div>`);
  c.append(barra);
  $$('#r-rclase button', barra).forEach((b) => { b.onclick = () => { st.resClase = b.dataset.v; st.resVar = -1; st.resId = ''; pintar(); }; });
  $('#r-rvar').onchange = (e) => { st.resVar = +e.target.value; pintar(); };
  $('#r-rhora').onchange = (e) => { st.resHora = +e.target.value; pintar(); };
  $$('#r-rsent button', barra).forEach((b) => { b.onclick = () => { st.resSentido = +b.dataset.v; pintar(); }; });
  const dl = $('#r-rids', barra);
  dl.innerHTML = T.ids.slice(0, 20000).map((id) => `<option value="${esc(id)}">`).join('');
  $('#r-rid').onchange = (e) => { const id = e.target.value.trim(); if (T.ids.includes(id)) { st.resId = id; pintar(); } else if (id) aviso(`${id} no está en las tablas del reporte.`, 'error'); };

  // ranking: el valor de cada elemento a la hora elegida, o su mínimo (o máximo) del día
  const vals = T.valores[st.resVar] || [];
  const nT = T.horas.length, dir = st.resSentido;
  const filas = [];
  T.ids.forEach((id, k) => {
    let v = null, j0 = -1;
    if (st.resHora >= 0) { v = vals[st.resHora]?.[k] ?? null; j0 = st.resHora; } else {
      for (let j = 0; j < nT; j++) { const x = vals[j]?.[k]; if (x === null || x === undefined) continue; if (v === null || (dir > 0 ? x < v : x > v)) { v = x; j0 = j; } }
    }
    if (v !== null) filas.push([id, v, j0]);
  });
  filas.sort((a, b) => (a[1] - b[1]) * dir);
  const dos = h('<div class="r-res"></div>');
  const izq = h(`<div><div class="eti" style="margin-bottom:8px">${dir > 0 ? 'Los más bajos' : 'Los más altos'} · ${esc(V.nombre)}${st.resHora >= 0 ? ` a las ${reloj(T.horas[st.resHora], false)}` : ` del día (su ${dir > 0 ? 'mínimo' : 'máximo'})`}</div>
    <div class="tabla-caja"><table class="tabla"><tr><th>${st.resClase === 'nudo' ? 'Nudo' : 'Tramo'}</th><th class="n">${esc(V.nombre)}${V.unidad ? ` (${esc(V.unidad)})` : ''}</th><th class="n">Hora</th><th></th></tr></table></div></div>`);
  filas.slice(0, 40).forEach(([id, v, j]) => {
    const tr = h(`<tr class="clic ${id === st.resId ? 'abierta' : ''}"><td>${etiquetaEl(st.resClase, id)}</td><td class="n">${n(v, 2)}</td><td class="n">${reloj(T.horas[j], false)}</td><td class="acc">${botonMapa(st.resClase, id)}</td></tr>`);
    tr.onclick = (e) => { if (e.target.closest('button')) return; st.resId = id; pintar(); };
    $('table', izq).append(tr);
  });
  dos.append(izq);
  const der = h('<div></div>');
  if (!st.resId) {
    der.append(h(`<div class="tarjeta"><h3>Elige un ${st.resClase === 'nudo' ? 'nudo' : 'tramo'}</h3><p>Haz clic en uno de la lista o búscalo por su ID para ver sus valores hora a hora.</p></div>`));
  } else {
    const k = T.ids.indexOf(st.resId);
    const serie = T.horas.map((_, j) => vals[j]?.[k] ?? null);
    const d = datoEl(st.resClase, st.resId);
    der.append(h(`<div class="eti" style="margin-bottom:8px">${esc(st.resId)}${d?.com ? ` · ${esc(d.com)}` : ''} <span class="sub" style="font-weight:400;color:var(--apagado)">${esc(V.nombre)} hora a hora</span> ${botonMapa(st.resClase, st.resId)}</div>`));
    const g = h('<div class="r-graf"><canvas></canvas></div>');
    der.append(g);
    requestAnimationFrame(() => graficaSerie($('canvas', g), T.horas, serie, V));
    const tabla = h(`<div class="tabla-caja" style="margin-top:12px"><table class="tabla"><tr><th>Hora</th>${T.cols.map((cc) => `<th class="${cc.clave === 'status' ? '' : 'n'}">${esc(cc.nombre)}${cc.unidad ? ` (${esc(cc.unidad)})` : ''}</th>`).join('')}</tr></table></div>`);
    T.horas.forEach((t, j) => {
      $('table', tabla).append(h(`<tr><td class="mono">${reloj(t, false)}</td>${T.cols.map((cc, ci) => (cc.clave === 'status' ? `<td>${esc(T.estados[j]?.[k] || '')}</td>` : `<td class="n">${n(T.valores[ci]?.[j]?.[k] ?? null, 2)}</td>`)).join('')}</tr>`));
    });
    der.append(tabla);
  }
  dos.append(der);
  c.append(dos);
}

function graficaSerie(cv, horas, serie, V) {
  if (!cv) return;
  const { g, W, H, apagado, linea } = lienzo(cv);
  const vs = serie.filter((v) => v !== null);
  if (!vs.length) return;
  let lo = Math.min(...vs), hi = Math.max(...vs);
  if (lo === hi) { lo -= 1; hi += 1; }
  const p = paso(hi - lo), y0v = Math.floor(lo / p) * p, y1v = Math.ceil(hi / p) * p;
  const m = { l: 56, r: 12, t: 10, b: 22 };
  const X = (j) => m.l + (horas.length === 1 ? 0.5 : j / (horas.length - 1)) * (W - m.l - m.r);
  const Y = (v) => H - m.b - ((v - y0v) / (y1v - y0v)) * (H - m.t - m.b);
  g.font = '11px "Geist Mono", Consolas, monospace';
  g.strokeStyle = linea; g.fillStyle = apagado; g.lineWidth = 1;
  for (let v = y0v; v <= y1v + 1e-9; v += p) {
    const y = Math.round(Y(v)) + 0.5;
    g.beginPath(); g.moveTo(m.l, y); g.lineTo(W - m.r, y); g.stroke();
    g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(n(v, Math.abs(p) < 1 ? 2 : 0), m.l - 8, y);
  }
  const cada = horas.length > 48 ? 6 : horas.length > 24 ? 3 : horas.length > 12 ? 2 : 1;
  g.textAlign = 'center'; g.textBaseline = 'top';
  horas.forEach((t, j) => { if (j % cada === 0) g.fillText(reloj(t, false), X(j), H - m.b + 6); });
  g.strokeStyle = '#7aa2ff'; g.lineWidth = 2; g.lineJoin = 'round';
  g.beginPath();
  let empezado = false;
  serie.forEach((v, j) => { if (v === null) { empezado = false; return; } if (!empezado) { g.moveTo(X(j), Y(v)); empezado = true; } else g.lineTo(X(j), Y(v)); });
  g.stroke();
  const tip = $('#r-tip');
  cv.onmousemove = (e) => {
    const r = cv.getBoundingClientRect();
    const j = Math.round(((e.clientX - r.left - m.l) / (W - m.l - m.r)) * (horas.length - 1));
    if (j < 0 || j >= horas.length || serie[j] === null) { tip.hidden = true; return; }
    tip.innerHTML = `<b>${reloj(horas[j], false)}</b><div>${esc(V.nombre)}<span>${n(serie[j], 2)}${V.unidad ? ` ${esc(V.unidad)}` : ''}</span></div>`;
    tip.hidden = false;
    tip.style.left = `${Math.min(window.innerWidth - tip.offsetWidth - 12, e.clientX + 14)}px`;
    tip.style.top = `${Math.max(8, e.clientY - tip.offsetHeight - 10)}px`;
  };
  cv.onmouseleave = () => { tip.hidden = true; };
}

// ====================================================================== texto
function claseLinea(l) {
  if (l.includes('WARNING')) return 'av';
  if (/Error \d+/.test(l)) return 'er';
  if (/Results at|Energy Usage|Analysis (begun|ended)|Input Data File/.test(l)) return 'cab';
  if (/^\s*\d+:\d\d:\d\d:/.test(l)) return 'es';
  return '';
}
function resaltar(l, q) {
  const bajo = l.toLowerCase();
  let out = '', i = 0, j;
  while ((j = bajo.indexOf(q, i)) >= 0) { out += `${esc(l.slice(i, j))}<mark>${esc(l.slice(j, j + q.length))}</mark>`; i = j + q.length; }
  return out + esc(l.slice(i));
}

function tTexto(c) {
  const R = st.R;
  const secs = R.secciones.filter((s, j, a) => !(s.tipo.startsWith('Resultados') && a.findIndex((x) => x.tipo === s.tipo) !== j && R.secciones.length > 60 && j % 4));
  c.append(h(`<div class="r-tbarra"><input id="r-tbusca" type="search" placeholder="Buscar en el texto: Enter, siguiente · Mayús+Enter, anterior" value="${esc(st.txtBusca)}" spellcheck="false">
    <span id="r-tcuenta" class="mono"></span><button class="btn chico" id="r-tant" title="Anterior (Mayús+Enter)">↑</button><button class="btn chico" id="r-tsig" title="Siguiente (Enter)">↓</button>
    <select id="r-tir"><option value="">Ir a…</option>${R.avisos.length ? `<option value="${R.avisos[0][3]}">Primer aviso</option>` : ''}${secs.map((s) => `<option value="${s.linea}">${esc(s.tipo)}${s.t !== null && s.t !== undefined ? ` · ${reloj(s.t, false)}` : ''}</option>`).join('')}</select>
    <button class="btn chico" id="r-tcopiar" title="Copiar el reporte entero">Copiar todo</button></div>`));
  const caja = h('<div class="r-texto" id="r-texto" tabindex="0"><div class="r-alto"></div><div class="r-ventana"></div></div>');
  c.append(caja);
  let pedido = false;
  caja.onscroll = () => { if (pedido) return; pedido = true; requestAnimationFrame(() => { pedido = false; pintarLineas(); }); };
  const busca = $('#r-tbusca');
  let espera = null;
  busca.oninput = () => { clearTimeout(espera); espera = setTimeout(() => buscarTexto(busca.value), 200); };
  busca.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); if (busca.value !== st.txtBusca) buscarTexto(busca.value); else saltar(e.shiftKey ? -1 : 1); } };
  $('#r-tsig').onclick = () => saltar(1);
  $('#r-tant').onclick = () => saltar(-1);
  $('#r-tir').onchange = (e) => { if (e.target.value !== '') irALinea(+e.target.value); e.target.value = ''; };
  $('#r-tcopiar').onclick = () => navigator.clipboard.writeText(st.texto).then(() => aviso('Reporte copiado.'), () => aviso('No pude copiar al portapapeles.', 'error'));
  contar();
  requestAnimationFrame(() => { if (st.marca >= 0) centrar(st.marca); else pintarLineas(); });
}

function pintarLineas() {
  const box = $('#r-texto');
  if (!box) return;
  const total = st.lineas.length;
  $('.r-alto', box).style.height = `${total * LH}px`;
  const ini = Math.max(0, Math.floor(box.scrollTop / LH) - 40), fin = Math.min(total, Math.ceil((box.scrollTop + box.clientHeight) / LH) + 40);
  const q = st.txtBusca.toLowerCase(), actual = st.aciertos[st.acierto];
  let html = '';
  for (let i = ini; i < fin; i++) {
    const l = st.lineas[i];
    const cls = `${claseLinea(l)}${i === st.marca ? ' actual' : ''}${i === actual ? ' acierto' : ''}`;
    html += `<div class="ln ${cls}"><span class="no">${i + 1}</span><span class="tx">${q ? resaltar(l, q) : esc(l)}</span></div>`;
  }
  const v = $('.r-ventana', box);
  v.style.transform = `translateY(${ini * LH}px)`;
  v.innerHTML = html;
}

function centrar(i) {
  const box = $('#r-texto');
  if (!box) return;
  $('.r-alto', box).style.height = `${st.lineas.length * LH}px`;       // primero el alto, si no el scroll no llega
  box.scrollTop = Math.max(0, i * LH - box.clientHeight / 2 + LH);
  pintarLineas();
}

function buscarTexto(q) {
  st.txtBusca = q;
  st.aciertos = [];
  st.acierto = -1;
  const b = q.trim().toLowerCase();
  if (b) {
    st.minus ||= st.lineas.map((l) => l.toLowerCase());
    st.minus.forEach((l, i) => { if (l.includes(b)) st.aciertos.push(i); });
    const desde = Math.floor(($('#r-texto')?.scrollTop || 0) / LH);
    st.acierto = Math.max(0, st.aciertos.findIndex((i) => i >= desde));
  }
  contar();
  if (st.acierto >= 0 && st.aciertos.length) centrar(st.aciertos[st.acierto]); else pintarLineas();
}
function saltar(d) {
  if (!st.aciertos.length) return;
  st.acierto = (st.acierto + d + st.aciertos.length) % st.aciertos.length;
  contar();
  centrar(st.aciertos[st.acierto]);
}
function contar() {
  const el = $('#r-tcuenta');
  if (!el) return;
  el.textContent = !st.txtBusca.trim() ? '' : st.aciertos.length ? `${n(st.acierto + 1, 0)} de ${n(st.aciertos.length, 0)}` : 'sin resultados';
}

function irALinea(i) {
  if (!Number.isFinite(i) || i < 0) return;
  st.marca = i;
  if (st.pestana !== 'texto') { st.pestana = 'texto'; pintar(); } else centrar(i);
}

function teclas(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && st.R) {
    e.preventDefault();
    if (st.pestana !== 'texto') { st.pestana = 'texto'; pintar(); }
    requestAnimationFrame(() => { const b = $('#r-tbusca'); b?.focus(); b?.select(); });
  }
}

iniciar();
