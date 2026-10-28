// Los reportes .rpt dentro de Cauce: cada uno se abre en su pestaña de la barra de arriba, junto a las de los modelos,
// y ocupa toda el área de trabajo. «Mapa» pasa a la pestaña del modelo con el elemento elegido; para volver al reporte
// basta su pestaña.
import { S, bus, h, esc, explorar, nuevaVentana } from './estado.js';
import { crearLector } from './lector.js';

const abiertos = [];      // { id, clave, nombre, titulo, raiz, lector }
let activo = null;        // id del reporte que se ve; null cuando se ve el modelo
let cuenta = 0, abiertoEn = 0;

function caja() {
  let c = document.getElementById('lectores');
  if (!c) {
    c = h('<section id="lectores" hidden aria-label="Reportes de EPANET"></section>');
    // el explorador abre con un clic: el segundo de un doble clic cae en el reporte y no debe seleccionar su texto
    c.addEventListener('mousedown', (e) => { if (e.detail > 1 && performance.now() - abiertoEn < 700) e.preventDefault(); });
    document.body.append(c);
  }
  return c;
}

export const reporteActivo = () => activo !== null;

// muestra un reporte, o el modelo con null
function mostrar(id) {
  activo = id;
  abiertos.forEach((r) => { r.raiz.hidden = r.id !== id; });
  caja().hidden = id === null;
  document.body.classList.toggle('con-reporte', id !== null);
  bus.emit('pestanas');
  const r = abiertos.find((x) => x.id === id);
  if (r) requestAnimationFrame(() => r.lector.repintar());       // las gráficas se dibujan con el tamaño que tienen al verse
}
export function mostrarModelo() { if (activo !== null) mostrar(null); }

function cerrar(id) {
  const k = abiertos.findIndex((x) => x.id === id);
  if (k < 0) return;
  const [r] = abiertos.splice(k, 1);
  r.lector.destruir();
  r.raiz.remove();
  if (activo === id) mostrar(abiertos.length ? abiertos[Math.min(k, abiertos.length - 1)].id : null); else bus.emit('pestanas');
}

// las pestañas de los reportes van detrás de las de los modelos: app.js las pide al pintar la barra
export function pestanasReportes(c) {
  abiertos.forEach((r) => {
    const b = h(`<button class="pestana rpt ${r.id === activo ? 'activa' : ''}" role="tab" title="${esc(r.titulo)}">
      <svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7z M14 3v4h4 M10 12h5 M10 16h5"/></svg>
      <span class="nom">${esc(r.nombre)}</span><span class="x" title="Cerrar el reporte">×</span></button>`);
    b.onclick = (e) => { if (e.target.classList.contains('x')) { e.stopPropagation(); cerrar(r.id); } else mostrar(r.id); };
    c.append(b);
  });
}

export function abrirReporte({ corrida = '', ruta = '', doc = '', nombre = '' } = {}) {
  const clave = corrida ? `corrida:${corrida}` : ruta.toLowerCase();
  let r = clave ? abiertos.find((x) => x.clave === clave) : null;
  if (!r) {
    const raiz = document.createElement('div');
    r = { id: ++cuenta, clave, nombre: nombre || ruta.split('\\').pop() || 'Reporte', titulo: ruta || nombre, raiz };
    r.lector = crearLector(raiz, {
      doc: doc || S.doc || '', enApp: true,
      alVerEnMapa: (d, clase, id) => bus.emit('ir-modelo', { doc: d, clase, id }),
      alNombre: (t) => { if (t && r.nombre !== t) { r.nombre = t; bus.emit('pestanas'); } },
      abrirOtro: (d) => elegirReporte(d),
      otraVentana: (consulta) => nuevaVentana(`rpt.html?${consulta}`, 'Reporte de EPANET'),
    });
    abiertos.push(r);
    caja().append(raiz);
  }
  abiertoEn = performance.now();
  mostrar(r.id);
  r.lector.cargar({ corrida, ruta, nombre });     // si ya estaba abierto se vuelve a leer: puede ser un .rpt recién generado
}

export async function elegirReporte(doc = '') {
  const r = await explorar({ titulo: 'Leer un reporte de EPANET (.rpt)', filtro: ['.rpt', '.txt', '.log'] });
  if (r) abrirReporte({ ruta: r, doc: doc || S.doc || '' });
}
