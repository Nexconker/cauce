// El lector de reportes .rpt dentro de Cauce: una ventana grande de la propia app, como las de abrir y guardar.
// «Mapa» la esconde, muestra el elemento en el mapa y deja un botón para volver al reporte tal como estaba.
import { S, h, $, modal, explorar, nuevaVentana } from './estado.js';
import { crearLector } from './lector.js';

let vivo = null;          // { raiz, lector, cerrarPorMapa }
const canal = (() => { try { return new BroadcastChannel('cauce'); } catch (e) { return null; } })();

function volver(mostrar) {
  let c = document.getElementById('volver-reporte');
  if (!mostrar) { c?.remove(); return; }
  if (c) return;
  c = h('<div id="volver-reporte" class="volver-reporte" role="group" aria-label="Reporte de EPANET"><button class="btn prim chico" data-a="volver">Volver al reporte</button><button class="btn chico" data-a="cerrar" title="Cerrar el reporte" aria-label="Cerrar el reporte">×</button></div>');
  $('[data-a=volver]', c).onclick = () => ventana();
  $('[data-a=cerrar]', c).onclick = () => { vivo = null; volver(false); };
  $('#mapa-caja').append(c);
}

function ventana() {
  if (!vivo) return;
  let porMapa = false;
  const dlg = modal({
    titulo: 'Reporte de EPANET', cuerpo: vivo.raiz, grande: true,
    alCerrar: () => { if (!porMapa) { vivo = null; volver(false); } },
  });
  vivo.cerrarPorMapa = () => { porMapa = true; dlg.cerrar(); };
  volver(false);
  requestAnimationFrame(() => vivo?.lector.repintar());       // las gráficas se redibujan con el tamaño de la ventana
}

// el elemento se pide por el canal «cauce», el mismo que usa la ventana aparte: app.js cambia de modelo si hace falta
function verEnMapa(doc, clase, id) {
  vivo?.cerrarPorMapa?.();
  volver(true);
  canal?.postMessage({ tipo: 'ir', doc, clase, id });
}

export function abrirReporte({ corrida = '', ruta = '', doc = '', nombre = '' } = {}) {
  const raiz = document.createElement('div');
  const lector = crearLector(raiz, {
    doc: doc || S.doc || '', enApp: true, alVerEnMapa: verEnMapa,
    abrirOtro: (d) => elegirReporte(d),
    otraVentana: (consulta) => nuevaVentana(`rpt.html?${consulta}`, 'Reporte de EPANET'),
  });
  vivo = { raiz, lector };
  ventana();
  lector.cargar({ corrida, ruta, nombre });
}

export async function elegirReporte(doc = '') {
  const previo = vivo;      // la ventana de abrir reemplaza a la del reporte: si se cancela, el reporte vuelve como estaba
  const r = await explorar({ titulo: 'Leer un reporte de EPANET (.rpt)', filtro: ['.rpt', '.txt', '.log'] });
  if (r) abrirReporte({ ruta: r, doc: doc || S.doc || '' });
  else if (previo && !vivo) { vivo = previo; ventana(); }
}
