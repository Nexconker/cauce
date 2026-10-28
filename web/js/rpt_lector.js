// Lector del reporte de EPANET (.rpt): los avisos y estados de cada paso, los errores de lectura y, si el reporte las
// trae, las tablas de resultados de nudos y tramos. No toca el DOM: corre igual en un Worker que en la página.

// Tipos de aviso, en el orden en que se muestran. «clase» dice si el elemento es un nudo o un tramo.
export const TIPOS = {
  fcv: { nombre: 'Válvula que no da su caudal', corto: 'Válvula sin caudal', clase: 'tramo' },
  presion: { nombre: 'Válvula que no da su presión', corto: 'Válvula sin presión', clase: 'tramo' },
  bomba_max: { nombre: 'Bomba por encima de su caudal máximo', corto: 'Bomba sobre su máximo', clase: 'tramo' },
  bomba_altura: { nombre: 'Bomba cerrada porque no da la altura', corto: 'Bomba sin altura', clase: 'tramo' },
  mal_cond: { nombre: 'Elemento que vuelve inestable el cálculo', corto: 'Mal condicionamiento', clase: 'tramo' },
  desconectado: { nombre: 'Nudo desconectado', corto: 'Nudo desconectado', clase: 'nudo' },
  sist_desc: { nombre: 'Red partida por un tramo', corto: 'Red partida', clase: 'tramo' },
  negativas: { nombre: 'Presiones negativas', corto: 'Presiones negativas', clase: null },
  iteraciones: { nombre: 'Máximo de iteraciones: cálculo inestable', corto: 'Sin converger', clase: null },
  desequilibrio: { nombre: 'Sistema sin equilibrar', corto: 'Sin equilibrar', clase: null },
  bombas: { nombre: 'Las bombas no dan el caudal o la altura', corto: 'Bombas cortas', clase: null },
  valvulas: { nombre: 'Las válvulas no dan su caudal', corto: 'Válvulas cortas', clase: null },
  otro: { nombre: 'Otros avisos', corto: 'Otros', clase: null },
};

const REGLAS = [
  [/^FCV (\S+) open but cannot deliver flow/, 'fcv'],
  [/^(?:PRV|PSV|PBV|TCV|GPV|PCV|Valve) (\S+) open but cannot deliver pressure/, 'presion'],
  [/^\w+ (\S+) open but cannot deliver flow/, 'fcv'],
  [/^Pump (\S+) open but exceeds maximum flow/, 'bomba_max'],
  [/^Pump (\S+) .*cannot deliver head/, 'bomba_altura'],
  [/^\w+ (\S+) caused ill-conditioning/, 'mal_cond'],
  [/^Node (\S+) disconnected/, 'desconectado'],
  [/^System disconnected because of Link (\S+)/, 'sist_desc'],
  [/^System disconnected at/, 'sist_desc'],
  [/^(?:System has )?[Nn]egative pressures/, 'negativas'],
  [/^Maximum trials exceeded/, 'iteraciones'],
  [/^System unbalanced/, 'desequilibrio'],
  [/^Pumps cannot deliver/, 'bombas'],
  [/^Valves cannot deliver/, 'valvulas'],
];

const NOMBRE_COL = {
  demand: 'Demanda', head: 'Carga', pressure: 'Presión', quality: 'Calidad', flow: 'Caudal', velocity: 'Velocidad',
  'unit headloss': 'Pérdida unitaria', headloss: 'Pérdida', 'friction factor': 'Factor de fricción', 'reaction rate': 'Reacción',
  setting: 'Consigna', status: 'Estado', elevation: 'Cota', length: 'Longitud', diameter: 'Diámetro', reaction: 'Reacción',
  'f-factor': 'Factor de fricción',
};
// columnas que no llevan unidad: en la fila de unidades dejan un hueco que la partición por espacios no ve
const SIN_UNIDAD = new Set(['status', 'setting', 'f-factor', 'friction factor']);
const ESTADO_TRAMO = { open: 'abierto', closed: 'cerrado', active: 'activo' };
const estadoTramo = (pal) => pal.filter(Boolean).map((w, i) => (i === 0 ? ESTADO_TRAMO[w.toLowerCase()] || w : w)).join(' · ');
const MESES = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

const segundos = (h, m, s) => (+h) * 3600 + (+m) * 60 + (+(s || 0));
function fecha(t) {
  const m = /(\w{3})\s+(\d+)\s+(\d+):(\d+):(\d+)\s+(\d{4})/.exec(t || '');
  return m && m[1] in MESES ? new Date(+m[6], MESES[m[1]], +m[2], +m[3], +m[4], +m[5]) : null;
}

// Nombres de columna de una tabla de resultados. EPANET pega «Velocity» con «Unit Headloss» en la cabecera, así que se
// separan las palabras conocidas antes de partir.
function columnas(cab, unidades) {
  const t = cab.replace(/^\s*(Node|Link)\s+/, '').replace(/(Velocity)(Unit)/, '$1 $2').replace(/(Head)(Pressure)/, '$1 $2');
  const pal = t.split(/\s+/).filter(Boolean);
  const cols = [];
  for (let i = 0; i < pal.length; i++) {
    const dos = `${pal[i]} ${pal[i + 1] || ''}`.toLowerCase();
    if (dos in NOMBRE_COL) { cols.push(dos); i++; } else cols.push(pal[i].toLowerCase() === 'state' ? 'status' : pal[i].toLowerCase());     // la librería lo llama State
  }
  // la fila de unidades empieza por «ID» en el reporte de la interfaz y por «Node»/«Link» en el de la librería
  const u = unidades.replace(/^\s*(ID|Node|Link)\b\s*/, '').split(/\s+/).filter(Boolean);
  let ui = 0;
  return cols.map((c) => ({ clave: c, nombre: NOMBRE_COL[c] || c, unidad: SIN_UNIDAD.has(c) ? '' : (u[ui++] || '') }));
}

export function leerReporte(texto) {
  const L = texto.split(/\r?\n/);
  const R = {
    meta: { lineas: L.length, caracteres: texto.length, version: '', inicio: '', fin: '', segundos: null, titulo: '', resumen: [] },
    avisos: [],        // [t, tipo, elemento, línea]  (t en segundos; -1 si no se sabe)
    estados: [],       // [t, clase, elemento, texto, línea]
    iteraciones: [],   // [t, iteraciones]
    errores: [],       // {texto, línea}
    secciones: [],     // {tipo, t, linea, texto}
    resultados: { nudo: null, tramo: null },
  };
  let tUlt = -1, tabla = null, enResumen = false;
  const nuevaTabla = (clase) => (R.resultados[clase] ||= { cols: null, ids: [], idx: new Map(), horas: [], tIdx: new Map(), valores: [], estados: [] });

  for (let i = 0; i < L.length; i++) {
    const l = L[i];
    const s = l.trim();
    if (!s) { if (tabla && tabla.datos) tabla = null; enResumen = false; continue; }

    // cabeceras de página del reporte completo
    if (/^Page \d+/.test(s)) { if (!R.meta.titulo) { const m = /Scenario:\s*(.*)$/.exec(s); if (m) R.meta.titulo = m[1].trim(); } continue; }

    // tablas de resultados: cabecera, unidades y filas
    // (una corrida de un solo instante escribe «Node Results:», sin hora)
    let m = /^(Node|Link) Results(?: at (\d+):(\d\d)(?::(\d\d))?\s*[Hh]rs)?:?\s*(\(continued\))?$/.exec(s);
    if (m) {
      const clase = m[1] === 'Node' ? 'nudo' : 'tramo';
      const t = m[2] ? segundos(m[2], m[3], m[4]) : 0;
      const T = nuevaTabla(clase);
      if (!T.tIdx.has(t)) { T.tIdx.set(t, T.horas.length); T.horas.push(t); }
      if (!m[5]) R.secciones.push({ tipo: clase === 'nudo' ? 'Resultados de nudos' : 'Resultados de tramos', t, linea: i });
      tabla = { clase, T, j: T.tIdx.get(t), cab: null, uni: null, guiones: 0, datos: false };
      continue;
    }
    if (tabla && !tabla.datos) {
      if (/^-{10,}$/.test(s)) { tabla.guiones++; if (tabla.guiones >= 2 && tabla.cab) { tabla.datos = true; if (!tabla.T.cols) tabla.T.cols = columnas(tabla.cab, tabla.uni || ''); } continue; }
      if (!tabla.cab) { tabla.cab = l; continue; }
      if (!tabla.uni) { tabla.uni = l; continue; }
    }
    if (tabla && tabla.datos) {
      const p = s.split(/\s+/);
      const T = tabla.T, cols = T.cols;
      let k = T.idx.get(p[0]);
      if (k === undefined) { k = T.ids.length; T.idx.set(p[0], k); T.ids.push(p[0]); }
      cols.forEach((c, ci) => {
        // el estado es una palabra; si es la última columna se le suma el tipo que EPANET pone detrás (PRV, Pump...)
        if (c.clave === 'status') { (T.estados[tabla.j] ||= [])[k] = estadoTramo(ci === cols.length - 1 ? p.slice(1 + ci) : [p[1 + ci]]); return; }
        const v = parseFloat(p[1 + ci]);
        ((T.valores[ci] ||= [])[tabla.j] ||= [])[k] = Number.isFinite(v) ? v : null;
      });
      continue;
    }

    // avisos
    m = /^WARNING:\s*(.*)$/.exec(s);
    if (m) {
      const msg = m[1];
      const mt = /at (\d+):(\d\d):(\d\d) hrs/.exec(msg);
      if (mt) tUlt = segundos(mt[1], mt[2], mt[3]);
      let tipo = 'otro', el = '';
      for (const [re, t] of REGLAS) { const x = re.exec(msg); if (x) { tipo = t; el = x[1] || ''; break; } }
      R.avisos.push([tUlt, tipo, el, i]);
      continue;
    }

    // estados de cada paso (con el reporte de estados encendido)
    m = /^(\d+):(\d\d):(\d\d): (.*)$/.exec(s);
    if (m) {
      const t = segundos(m[1], m[2], m[3]);
      tUlt = t;
      const msg = m[4];
      const b = /^Balanced after (\d+) trials/.exec(msg);
      if (b) { R.iteraciones.push([t, +b[1]]); continue; }
      const e = /^(Tank|Reservoir|Junction|Pump|Pipe|CV|PRV|PSV|PBV|FCV|TCV|GPV|PCV|Valve|Link|Node) (\S+)/.exec(msg);
      R.estados.push([t, e ? e[1] : '', e ? e[2] : '', msg, i]);
      continue;
    }

    // con el reporte de estados completo, los cambios de estado dentro de las iteraciones de un paso van sin hora
    m = /^(Tank|Reservoir|Pump|Pipe|CV|PRV|PSV|PBV|FCV|TCV|GPV|PCV|Valve) (\S+) (?:switched|changed|is) /.exec(s);
    if (m && tUlt >= 0) { R.estados.push([tUlt, m[1], m[2], s, i]); continue; }

    // errores de lectura del .inp
    m = /^(?:Input )?Error (\d+):\s*(.*)$/.exec(s);
    if (m) { R.errores.push({ texto: s, linea: i }); continue; }

    // cabecera, resumen y energía
    m = /\*\s+Version\s+([\d.]+)/.exec(s);
    if (m) { R.meta.version = m[1]; continue; }
    m = /^Analysis begun\s+(.*)$/.exec(s);
    if (m) { R.meta.inicio = m[1]; R.secciones.push({ tipo: 'Inicio del cálculo', t: null, linea: i }); continue; }
    m = /^Analysis ended\s+(.*)$/.exec(s);
    if (m) { R.meta.fin = m[1]; R.secciones.push({ tipo: 'Fin del cálculo', t: null, linea: i }); continue; }
    if (/^Energy Usage:?/.test(s)) { R.secciones.push({ tipo: 'Consumo de energía', t: null, linea: i }); continue; }
    if (/^Input Data File/i.test(s) || /^Number of Junctions/i.test(s)) {
      if (!enResumen) R.secciones.push({ tipo: 'Resumen de datos', t: null, linea: i });
      enResumen = true;
    }
    if (enResumen) { const kv = /^(.+?)\.{3,}\s*(.+)$/.exec(s); if (kv) R.meta.resumen.push([kv[1].trim(), kv[2].trim()]); }
  }
  const a = fecha(R.meta.inicio), b = fecha(R.meta.fin);
  if (a && b) R.meta.segundos = Math.max(0, (b - a) / 1000);

  // agregados: por tipo, por elemento, por hora y por paso
  const porTipo = {}, porEl = new Map(), pasos = new Map();
  let tMax = 0;
  for (const [t, tipo, el, ln] of R.avisos) {
    porTipo[tipo] = (porTipo[tipo] || 0) + 1;
    if (t > tMax) tMax = t;
    if (el) {
      const k = `${tipo}|${el}`;
      let x = porEl.get(k);
      if (!x) { x = { tipo, el, n: 0, t0: t, t1: t, horas: new Set(), linea: ln }; porEl.set(k, x); }
      x.n++; if (t >= 0) { x.t0 = x.t0 < 0 ? t : Math.min(x.t0, t); x.t1 = Math.max(x.t1, t); x.horas.add(Math.floor(t / 3600)); }
    }
    if (t >= 0) { let p = pasos.get(t); if (!p) { p = { t, avisos: 0, tipos: {} }; pasos.set(t, p); } p.avisos++; p.tipos[tipo] = (p.tipos[tipo] || 0) + 1; }
  }
  for (const [t] of R.estados) { if (t > tMax) tMax = t; let p = pasos.get(t); if (!p) { p = { t, avisos: 0, tipos: {} }; pasos.set(t, p); } p.estados = (p.estados || 0) + 1; }
  for (const [t] of R.iteraciones) if (t > tMax) tMax = t;
  const horas = Math.floor(tMax / 3600) + 1;
  const porHora = {};
  for (const [t, tipo] of R.avisos) { if (t < 0) continue; (porHora[tipo] ||= new Array(horas).fill(0))[Math.min(horas - 1, Math.floor(t / 3600))]++; }
  R.porTipo = porTipo;
  R.porElemento = [...porEl.values()].map((x) => ({ ...x, horas: x.horas.size })).sort((p, q) => q.n - p.n);
  R.porHora = porHora;
  R.horas = horas;
  R.pasos = [...pasos.values()].sort((p, q) => p.t - q.t);

  // de cada tabla de resultados, la parte que el clon estructurado puede pasar sin el Map
  for (const c of ['nudo', 'tramo']) { const T = R.resultados[c]; if (T) { delete T.idx; delete T.tIdx; } }
  return R;
}

export function reloj(t, conSegundos = true) {
  if (t === null || t === undefined || t < 0) return '—';
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.round(t % 60);
  return conSegundos ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${h}:${String(m).padStart(2, '0')}`;
}
