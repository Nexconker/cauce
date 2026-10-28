// La página suelta del lector de reportes (rpt.html): el mismo lector de Cauce en una ventana aparte, para tenerlo en
// otra pantalla. «Mapa» le pide el elemento a la ventana principal por el canal «cauce».
import { crearLector } from './lector.js';

const Q = new URLSearchParams(location.search);
const canal = (() => { try { return new BroadcastChannel('cauce'); } catch (e) { return null; } })();
const lector = crearLector(document.getElementById('lector'), {
  doc: Q.get('doc') || '',
  alTitulo: (t) => { document.title = t; },
  alVerEnMapa: (doc, clase, id) => {
    canal?.postMessage({ tipo: 'ir', doc, clase, id });
    try { window.pywebview?.api?.al_frente?.(); } catch (e) { /* sin ventana propia */ }
  },
});
lector.cargar({ corrida: Q.get('corrida') || '', ruta: Q.get('ruta') || '', nombre: Q.get('nombre') || '' });
