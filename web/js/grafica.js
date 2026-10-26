// Gráficas de líneas en canvas: series de 24 h, varias curvas, banda opcional y lectura al pasar el ratón.
import { n, hora } from './estado.js';

// Un canvas guarda los píxeles del tamaño que tenía al dibujarse: si se pinta con el panel plegado (ancho 0) o el
// panel cambia de ancho después (plegar, Ampliar), el navegador estira esa imagen y las letras salen anchas y
// borrosas. Cada gráfica se vuelve a pintar cuando su canvas cambia de tamaño y no se pinta mientras no se ve:
// devuelve false si ahora no hay que pintar (el observador la repinta en cuanto tenga tamaño).
export function ajustarCanvas(canvas, repintar) {
  canvas._repintar = repintar;
  if (!canvas._ro) {
    canvas._ro = new ResizeObserver(() => {
      if (!canvas.isConnected) { canvas._ro.disconnect(); return; }
      if (`${canvas.clientWidth}x${canvas.clientHeight}` !== canvas._tam && canvas.clientWidth >= 40) canvas._repintar();
    });
    canvas._ro.observe(canvas);
  }
  if (canvas.clientWidth < 40 || canvas.clientHeight < 20) return false;
  canvas._tam = `${canvas.clientWidth}x${canvas.clientHeight}`;
  return true;
}

export function grafica(canvas, opciones) {
  const { series, horas, unidad = '', banda = null, marca = null, decimales = 1 } = opciones;
  if (!ajustarCanvas(canvas, () => grafica(canvas, opciones))) return { redibujar() {} };
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const izq = 44, der = 8, arr = 10, aba = 20;
  let lo = Infinity, hi = -Infinity;
  for (const s of series) for (const v of s.valores) if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (banda) { lo = Math.min(lo, banda[0]); hi = Math.max(hi, banda[1]); }
  if (!isFinite(lo)) { ctx.fillStyle = '#958a8a'; ctx.font = '12px Geist, Segoe UI'; ctx.fillText('Sin datos', izq, H / 2); return; }
  if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const t0 = horas[0] ?? 0, t1 = horas[horas.length - 1] ?? 24;
  const X = (t) => izq + (W - izq - der) * ((t - t0) / Math.max(1e-6, t1 - t0));
  const Y = (v) => arr + (H - arr - aba) * (1 - (v - lo) / (hi - lo));
  const dibujar = (cursor) => {
    ctx.clearRect(0, 0, W, H);
    ctx.font = '10.5px Geist, "Segoe UI", sans-serif'; ctx.fillStyle = '#958a8a'; ctx.strokeStyle = '#2a2525'; ctx.lineWidth = 1;
    for (let j = 0; j <= 4; j++) {
      const v = lo + (hi - lo) * j / 4, y = Y(v);
      ctx.beginPath(); ctx.moveTo(izq, y); ctx.lineTo(W - der, y); ctx.stroke();
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(n(v, Math.abs(hi - lo) < 5 ? 2 : Math.abs(hi - lo) < 50 ? 1 : 0), izq - 5, y);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let t = Math.ceil(t0 / 6) * 6; t <= t1; t += 6) ctx.fillText(`${t} h`, X(t), H - aba + 5);
    if (banda) { ctx.fillStyle = 'rgba(70,195,123,.10)'; ctx.fillRect(izq, Y(banda[1]), W - izq - der, Y(banda[0]) - Y(banda[1])); }
    for (const s of series) {
      ctx.strokeStyle = s.color; ctx.lineWidth = s.ancho || 1.8; ctx.setLineDash(s.punteada ? [5, 4] : []);
      ctx.beginPath(); let empezado = false;
      s.valores.forEach((v, j) => { if (!isFinite(v)) { empezado = false; return; } const x = X(horas[j]), y = Y(v); if (empezado) ctx.lineTo(x, y); else { ctx.moveTo(x, y); empezado = true; } });
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (marca !== null && marca !== undefined) { ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.beginPath(); ctx.moveTo(X(marca), arr); ctx.lineTo(X(marca), H - aba); ctx.stroke(); }
    if (cursor !== undefined) {
      const j = cursor, x = X(horas[j]);
      ctx.strokeStyle = 'rgba(243,238,238,.35)'; ctx.beginPath(); ctx.moveTo(x, arr); ctx.lineTo(x, H - aba); ctx.stroke();
      const txt = [`${hora(horas[j])}`, ...series.map((s) => `${s.nombre}: ${n(s.valores[j], decimales)} ${unidad}`)];
      ctx.font = '11px Geist, "Segoe UI", sans-serif';
      const w = Math.max(...txt.map((t) => ctx.measureText(t).width)) + 12, hh = txt.length * 15 + 6;
      const bx = Math.min(x + 8, W - w - 2);
      ctx.fillStyle = 'rgba(12,10,10,.95)'; ctx.fillRect(bx, arr, w, hh);
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      txt.forEach((t, q) => { ctx.fillStyle = q === 0 ? '#f3eeee' : series[q - 1].color; ctx.fillText(t, bx + 6, arr + 4 + q * 15); });
    }
  };
  dibujar();
  canvas.onmousemove = (e) => {
    const x = e.offsetX; let mejor = 0, dm = Infinity;
    horas.forEach((t, j) => { const d = Math.abs(X(t) - x); if (d < dm) { dm = d; mejor = j; } });
    dibujar(mejor);
  };
  canvas.onmouseleave = () => dibujar();
  return { redibujar: () => dibujar() };
}

// barras pequeñas (pasos por hora)
export function barras(canvas, valores, color = '#b8adad') {
  if (!ajustarCanvas(canvas, () => barras(canvas, valores, color))) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const max = Math.max(1, ...valores), w = W / Math.max(1, valores.length);
  ctx.fillStyle = color;
  valores.forEach((v, j) => { const h = (H - 14) * v / max; ctx.fillRect(j * w + 1, H - 14 - h, Math.max(1, w - 2), h); });
  ctx.fillStyle = '#958a8a'; ctx.font = '10px Geist, Segoe UI'; ctx.textBaseline = 'bottom';
  ctx.fillText('0 h', 0, H); ctx.textAlign = 'right'; ctx.fillText(`${valores.length - 1} h`, W, H);
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(`máx. ${max} pasos en una hora`, 2, 0);
}
