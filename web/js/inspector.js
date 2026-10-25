// Ficha del elemento seleccionado: parámetros explicados y editables, conexiones, reglas que lo nombran,
// la línea del .inp y la gráfica de 24 h (con la corrida de comparación si hay una).
import { S, bus, get, post, esc, n, h, fallo, aviso, esqueleto, $, claseTexto, u, U, nombreCalidad, CAMPO_TEXTO } from './estado.js';
import { grafica } from './grafica.js';

const el = () => document.getElementById('inspector');
let token = 0;

export function cerrarInspector() {
  S.sel = null; el().hidden = true; bus.emit('seleccion-cambio');
}

export async function mostrarInspector() {
  const caja = el();
  if (!S.sel || !S.M) { caja.hidden = true; return; }
  const { clase, i } = S.sel;
  const id = clase === 'nudo' ? S.M.nudos.id[i] : S.M.tramos.id[i];
  const mio = ++token;
  caja.hidden = false;
  // se deja la ficha anterior; el esqueleto solo aparece si la respuesta tarda (así no parpadea en cada clic)
  const lento = setTimeout(() => { if (mio === token) caja.innerHTML = esqueleto(8, true); }, 150);
  let e;
  try { e = await get(`/api/doc/${S.doc}/elemento`, { clase, id }); } catch (ex) { clearTimeout(lento); if (mio === token) caja.innerHTML = `<div class="vacio">${esc(ex.message)}</div>`; return; }
  clearTimeout(lento);
  if (mio !== token) return;
  const P = S.textos.parametros[e.tipo] || {};
  const sigla = { junction: 'N', reservoir: 'E', tank: 'T', pipe: 'TU', pump: 'B', valve: 'V' }[e.tipo] || '?';
  caja.innerHTML = '';
  caja.append(h(`<div class="ins-cab"><div class="ic">${sigla}</div><div><h2>${esc(e.id)}</h2>
    <div class="t">${esc(claseTexto(clase, i))}${e.com ? ` · ${esc(e.com)}` : ''}${e.tag ? ` · etiqueta ${esc(e.tag)}` : ''}</div></div>
    <button class="cerrar" title="Cerrar ficha">×</button></div>`));
  $('.cerrar', caja).onclick = cerrarInspector;

  // parámetros editables
  const tabla = h('<table class="props"></table>');
  const fila = (campo, etiqueta, unidad, ayuda, control) => {
    const tr = h(`<tr><td>${esc(etiqueta)}${unidad ? ` <span style="color:var(--apagado)">(${esc(unidad)})</span>` : ''}${ayuda ? ` <i class="ayuda" tabindex="0" data-t="${esc(ayuda)}">?</i>` : ''}</td><td></td></tr>`);
    tr.children[1].append(control);
    tabla.append(tr);
  };
  const entrada = (valor, campo, tipo = 'number') => {
    const x = h(`<input type="${tipo}" ${tipo === 'number' ? 'step="any"' : ''}>`);
    x.value = valor ?? '';
    x.onchange = () => editar(e, campo, x.value);
    return x;
  };
  const selector = (valor, opciones, campo) => {
    const x = h(`<select>${opciones.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('')}</select>`);
    x.value = valor ?? '';
    x.onchange = () => editar(e, campo, x.value);
    return x;
  };
  const pats = [['', '(sin patrón)'], ...S.M.patrones.map((p) => [p, p])];
  for (const [campo, [etq, uniT, ayudaT]] of Object.entries(P)) {
    const v = e.props[campo], uni = u(uniT), ayuda = u(ayudaT);
    if (campo === 'estado') {
      let ops;
      if (e.tipo === 'valve') ops = [['', 'Con su consigna (activa)'], ['OPEN', 'Totalmente abierta'], ['CLOSED', 'Cerrada']];
      else if (e.tipo === 'pump') ops = [['OPEN', 'Prendida'], ['CLOSED', 'Apagada']];
      else ops = [['OPEN', 'Abierta'], ['CLOSED', 'Cerrada']];
      let actual = v;
      if (e.tipo === 'valve' && !['OPEN', 'CLOSED'].includes(String(v).toUpperCase())) actual = '';
      if (e.tipo === 'pipe' && v === 'CV') { fila(campo, etq, uni, ayuda, h('<span>Antirretorno (CV)</span>')); continue; }
      fila(campo, etq, uni, ayuda, selector(actual, ops, 'estado'));
    } else if (campo === 'pat') fila(campo, etq, uni, ayuda, selector(v, pats, campo));
    else if (campo === 'vt') fila(campo, etq, uni, ayuda, selector(v, ['PRV', 'PSV', 'PBV', 'FCV', 'TCV', 'GPV'].map((x) => [x, x]), campo));
    else if (campo === 'curva' && e.tipo === 'pump') fila(campo, etq, uni, ayuda, selector(v, [['', '(sin curva)'], ...S.M.curvas.map((c) => [c, c])], campo));
    else if (campo === 'curva' && e.tipo === 'tank') fila(campo, etq, uni, ayuda, selector(v, [['', '(cilíndrico)'], ...S.M.curvas.map((c) => [c, c])], campo));
    else if (campo === 'consigna' && e.props.vt === 'GPV') fila(campo, etq, uni, ayuda, selector(v, S.M.curvas.map((c) => [c, c]), campo));
    else if (v !== undefined) fila(campo, etq, uni, ayuda, entrada(v, campo));
  }
  fila('tag', 'Etiqueta', '', 'Etiqueta del modelo ([TAGS]). Si lleva un año, Cauce la usa como horizonte del proyecto (la regla está en Ajustes).', entrada(e.tag, 'tag', 'text'));
  caja.append(tabla);
  const extra = bloqueCalidadEnergia(e);
  if (extra) caja.append(extra);
  caja.append(h(`<p class="sub" style="font-size:11.5px;margin:8px 0 0">${S.info?.propio ? 'Los cambios quedan en el modelo; Ctrl+S lo guarda.' : 'Los cambios van al escenario activo; el archivo original no se toca.'}</p>`));

  // resultados
  if (S.corrida) caja.append(await bloqueResultados(e, clase, i, mio));
  if (mio !== token) return;

  // conexiones
  const con = h('<div class="sec"><div class="eti">Conexiones</div><ul class="lista"></ul></div>');
  const ul = $('ul', con);
  if (clase === 'nudo') {
    e.tramos.forEach((t) => ul.append(itemIr('tramo', t.id, `${t.id}`, `${t.tipo} → ${t.otro}`)));
    if (!e.tramos.length) ul.append(h('<li class="vacio">Sin tramos: este nudo deja el modelo sin solución.</li>'));
  } else {
    ul.append(itemIr('nudo', e.n1, e.n1, 'nudo inicial'));
    ul.append(itemIr('nudo', e.n2, e.n2, 'nudo final'));
    if (e.grupo) ul.append(h(`<li><span>Proyecto o grupo</span><span class="d">${esc(e.grupo)}</span></li>`));
  }
  caja.append(con);
  if (e.controles.length || e.reglas.length) {
    const r = h('<div class="sec"><div class="eti">Controles y reglas que lo nombran</div></div>');
    e.controles.forEach((c) => r.append(h(`<div class="mono" style="margin:4px 0">${esc(c)}</div>`)));
    e.reglas.forEach((g) => r.append(h(`<details style="margin:4px 0"><summary class="mono">RULE ${esc(g.nombre)}</summary><div class="mono detalle">${g.texto.slice(1).map(esc).join('<br>')}</div></details>`)));
    caja.append(r);
  }
  caja.append(h(`<details class="sec"><summary class="eti">Línea en el .inp</summary><div class="mono detalle" style="white-space:pre-wrap;word-break:break-all">${esc(e.linea)}</div></details>`));
}

// calidad del agua y energía del elemento: cada valor es una línea de [QUALITY], [SOURCES], [EMITTERS], [MIXING],
// [REACTIONS] o [ENERGY] (vacío = quitar la línea y usar lo global)
function bloqueCalidadEnergia(e) {
  const filas = [];
  const dato = (seccion, clave, valores, etiqueta) => editarOp({ op: 'dato', seccion, clave, valores }, `${e.id}: ${etiqueta} cambiado.`);
  const inp = (v, fn, ph = '') => { const x = h(`<input type="number" step="any" placeholder="${esc(ph)}">`); x.value = v ?? ''; x.onchange = () => fn(x.value); return x; };
  const sel = (v, ops, fn) => { const x = h(`<select>${ops.map(([a, b]) => `<option value="${esc(a)}">${esc(b)}</option>`).join('')}</select>`); x.value = v ?? ''; x.onchange = () => fn(x.value); return x; };
  const pats = [['', '(ninguno)'], ...S.M.patrones.map((p) => [p, p])];
  const fila = (etq, ayuda, ...controles) => { const tr = h(`<tr><td>${esc(etq)}${ayuda ? ` <i class="ayuda" tabindex="0" data-t="${esc(ayuda)}">?</i>` : ''}</td><td class="dobles"></td></tr>`); controles.forEach((c) => tr.children[1].append(c)); filas.push(tr); };
  let titulo = 'Calidad del agua', abierto = false;
  if (e.clase === 'nudo') {
    const q = e.calidad || {};
    abierto = !!(q.inicial || q.fuente?.length || q.emisor || q.mezcla?.length || q.reaccion);
    fila('Calidad inicial', 'Concentración, edad o porcentaje con que empieza la simulación en este nudo.', inp(q.inicial, (v) => dato('[QUALITY]', e.id, v, 'calidad inicial')));
    const f = q.fuente || [];
    const tipo = sel(f[0] || '', [['', 'Sin fuente'], ['CONCEN', 'Concentración'], ['MASS', 'Masa'], ['FLOWPACED', 'Según caudal'], ['SETPOINT', 'Consigna']], () => guardarFuente());
    const fuerza = inp(f[1], () => guardarFuente(), 'intensidad');
    const patron = sel(f[2] || '', pats, () => guardarFuente());
    const guardarFuente = () => dato('[SOURCES]', e.id, tipo.value ? [tipo.value, fuerza.value || '0', patron.value] : null, 'fuente');
    fila('Fuente de calidad', 'Inyección de un químico en este nudo: concentración fija, masa por minuto, según caudal o una consigna de salida.', tipo, fuerza, patron);
    if (e.tipo === 'junction') fila('Coeficiente de emisor', 'Fuga o aspersor: caudal = coeficiente × presión ^ exponente (el exponente está en Datos > Opciones).', inp(q.emisor, (v) => dato('[EMITTERS]', e.id, v, 'emisor')));
    if (e.tipo === 'tank') {
      const m = q.mezcla || [];
      const modelo = sel(m[0] || '', [['', 'Mezcla completa (por defecto)'], ['MIXED', 'Mezcla completa'], ['2COMP', 'Dos compartimentos'], ['FIFO', 'Primero en entrar, primero en salir'], ['LIFO', 'Último en entrar, primero en salir']], () => guardarMezcla());
      const frac = inp(m[1], () => guardarMezcla(), 'fracción 2COMP');
      const guardarMezcla = () => dato('[MIXING]', e.id, modelo.value ? [modelo.value, ...(modelo.value === '2COMP' ? [frac.value || '1'] : [])] : null, 'mezcla');
      fila('Mezcla en el tanque', 'Cómo se mezcla el agua dentro del tanque; afecta la edad y el cloro de lo que sale.', modelo, frac);
      fila('Reacción en el tanque', 'Coeficiente propio de este tanque (vacío = el global de Datos > Opciones).', inp(q.reaccion, (v) => dato('[REACTIONS]', ['TANK', e.id], v, 'reacción del tanque')));
    }
  } else if (e.tipo === 'pipe') {
    const q = e.calidad || {};
    abierto = !!(q.bulk || q.wall);
    fila('Reacción en el agua', 'Coeficiente bulk de esta tubería (1/día; vacío = el global).', inp(q.bulk, (v) => dato('[REACTIONS]', ['BULK', e.id], v, 'reacción en el agua')));
    fila('Reacción en la pared', 'Coeficiente wall de esta tubería (vacío = el global).', inp(q.wall, (v) => dato('[REACTIONS]', ['WALL', e.id], v, 'reacción en la pared')));
  } else if (e.tipo === 'pump') {
    titulo = 'Energía'; const en = e.energia || {};
    abierto = !!(en.effic || en.price || en.pattern || e.patron_bomba);
    fila('Curva de eficiencia', 'Eficiencia según el caudal (vacío = la eficiencia global).', sel(en.effic || '', [['', '(global)'], ...S.M.curvas.map((c) => [c, c])], (v) => dato('[ENERGY]', ['PUMP', e.id, 'EFFIC'], v, 'curva de eficiencia')));
    fila('Precio de la energía', 'Por kWh (vacío = el global).', inp(en.price, (v) => dato('[ENERGY]', ['PUMP', e.id, 'PRICE'], v, 'precio')));
    fila('Patrón del precio', '', sel(en.pattern || '', pats, (v) => dato('[ENERGY]', ['PUMP', e.id, 'PATTERN'], v, 'patrón del precio')));
    fila('Patrón de velocidad', 'Multiplica la velocidad de la bomba a lo largo del día (0 = apagada).', sel(e.patron_bomba || '', pats, (v) => editarOp({ op: 'bomba', id: e.id, patron: v }, `${e.id}: patrón de velocidad cambiado.`)));
  }
  if (!filas.length) return null;
  const d = h(`<details class="sec" ${abierto ? 'open' : ''}><summary class="eti">${titulo}</summary><table class="props"></table></details>`);
  filas.forEach((tr) => $('table', d).append(tr));
  return d;
}
async function editarOp(op, mensaje) {
  try {
    const r = await post(`/api/doc/${S.doc}/editar`, { op });
    (r.avisos || []).forEach((a) => aviso(a));
    aviso(mensaje, 'ok');
    bus.emit('recargar', { mantener: true });
  } catch (ex) { fallo(ex); mostrarInspector(); }
}

function itemIr(clase, id, t, d) {
  const li = h(`<li><button class="enlace">${esc(t)}</button><span class="d">${esc(d)}</span></li>`);
  li.querySelector('button').onclick = () => bus.emit('ir', { clase, id });
  return li;
}

async function editar(e, campo, valor) {
  const op = campo === 'estado' ? { op: 'estado', id: e.id, valor } : { op: 'propiedad', tipo: e.clase, id: e.id, campo, valor };
  try {
    const r = await post(`/api/doc/${S.doc}/editar`, { op });
    (r.avisos || []).forEach((a) => aviso(a));
    aviso(`${e.id}: ${CAMPO_TEXTO[campo] || campo} = ${valor === '' ? '(vacío)' : valor}. ${S.info?.propio ? 'Ctrl+S lo guarda en el archivo.' : 'Queda en el escenario.'}`, 'ok');
    bus.emit('recargar', { mantener: true });
  } catch (ex) { fallo(ex); mostrarInspector(); }
}

async function bloqueResultados(e, clase, i, mio) {
  const sec = h('<div class="sec"><div class="eti">Resultados de la corrida</div></div>');
  const vars = clase === 'nudo'
    ? (e.tipo === 'tank' ? [['presion', 'Nivel', U('nivel')], ['demanda', 'Entrada neta', U('caudal')], ['carga', 'Carga', U('carga')]]
      : e.tipo === 'reservoir' ? [['demanda', 'Caudal (negativo = entrega)', U('caudal')], ['carga', 'Carga', U('carga')]]
        : [['presion', 'Presión', U('presion')], ['carga', 'Carga', U('carga')], ['demanda', 'Demanda', U('caudal')]])
    : [['caudal', 'Caudal', U('caudal')], ['velocidad', 'Velocidad', U('velocidad')], ['estado', 'Estado (1 abierto, 0 cerrado)', '']];
  if (S.resumen?.calidad?.variables?.includes('calidad')) { const [nq, uq] = nombreCalidad(); vars.push([clase === 'nudo' ? 'calidad' : 'calidad_t', nq, uq]); }
  const seg = h('<div class="seg" style="margin:6px 0"></div>');
  const cv = h('<canvas class="grafica"></canvas>');
  const nota = h('<div class="sub" style="font-size:12px;margin:4px 0"></div>');
  let actual = vars[0][0];
  const pintar = async () => {
    const [v, nombre, uni] = vars.find((x) => x[0] === actual);
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    try {
      const a = await get(`/api/corrida/${S.corrida}/serie`, { clase, id: e.id, var: v });
      const series = [{ nombre: 'esta corrida', valores: a.valores, color: '#f3eeee' }];
      if (S.corridaComp && S.corridaComp !== S.corrida) {
        const b = await get(`/api/corrida/${S.corridaComp}/serie`, { clase, id: e.id, var: v });
        if (b.valores.length) series.push({ nombre: 'comparación', valores: b.valores, color: '#ff6b62', punteada: true });
      }
      if (mio !== token) return;
      const vals = a.valores.filter(isFinite);
      nota.textContent = vals.length ? `${nombre}: ahora ${n(a.valores[S.hora], 2)} ${uni} · mín. ${n(Math.min(...vals), 2)} · máx. ${n(Math.max(...vals), 2)}` : 'Este elemento no estaba en la corrida.';
      grafica(cv, { series, horas: a.horas, unidad: uni, marca: a.horas[S.hora], decimales: 2 });
    } catch (ex) { nota.textContent = ex.message; }
  };
  vars.forEach(([v, nombre]) => { const b = h(`<button data-v="${v}">${esc(nombre.split(' (')[0])}</button>`); b.onclick = () => { actual = v; pintar(); }; seg.append(b); });
  sec.append(seg, nota, cv);
  setTimeout(pintar, 0);
  return sec;
}
