// Worker del lector de reportes: lee el .rpt fuera de la página para que la ventana no se congele con los grandes.
import { leerReporte } from './rpt_lector.js';

self.onmessage = (e) => {
  try { self.postMessage({ ok: true, r: leerReporte(e.data) }); } catch (err) { self.postMessage({ ok: false, error: String(err?.message || err) }); }
};
