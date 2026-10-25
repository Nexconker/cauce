"""Genera el logo de Nex-Industries a partir de su geometría: hexágono negro con la marca blanca de tres brazos.

La marca blanca es un hexágono un poco más chico que el negro, menos seis hexágonos centrados en los vértices (las
muescas) y unos cortes en el centro que dependen de la variante (las ranuras del logo original van del centro a tres
muescas alternas). Todo con la punta del hexágono hacia arriba, como el original.

Uso:
    python -I scripts/generar_marca.py                    logo con la variante elegida (VARIANTE)
    python -I scripts/generar_marca.py --hoja             hoja con todas las alternativas de las ranuras
    python -I scripts/generar_marca.py --variante circuito
Salidas en web/marca/: nex.svg (con el fondo rojo), nex-hex.svg (sin fondo), nex-16/32/256.png (favicon), cauce.ico y,
con --hoja, alternativas.png. También actualiza el logo animado de la presentación dentro de web/index.html.
El .ico lleva cada tamaño dibujado directo (no reducido del grande), incluidos 20 y 40 px, que son los que pide Windows
con la pantalla al 125 %: la barra de tareas usa el que corresponde sin estirar nada.
"""
import math
import os
import sys

ROJO = '#d0201f'
NEGRO = '#0a0a0a'
BLANCO = '#ffffff'
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SALIDA = os.path.join(RAIZ, 'web', 'marca')
VARIANTE = 'seis'          # elegida por el usuario el 24-oct-2026 (H en la hoja de alternativas)

# proporciones medidas sobre el logo original (radio del hexágono negro = 1)
R_BLANCO = 0.885      # hexágono blanco
R_MUESCA = 0.50       # hexágonos negros en los vértices
TRES = (210, 330, 90)                 # direcciones de las ranuras originales (grados, y hacia abajo)
OTRAS_TRES = (270, 30, 150)
SEIS = (210, 270, 330, 30, 90, 150)


def _dir(a):
    return math.cos(math.radians(a)), math.sin(math.radians(a))


def hexagono(cx, cy, r, giro=0):
    return [(cx + r * math.cos(math.radians(a + giro)), cy + r * math.sin(math.radians(a + giro))) for a in (-90, -30, 30, 90, 150, 210)]


def ranura(cx, cy, R, a, desde, hasta, ancho, punta='round'):
    dx, dy = _dir(a)
    return ('linea', (cx + dx * R * desde, cy + dy * R * desde), (cx + dx * R * hasta, cy + dy * R * hasta), R * ancho, punta)


def cortes(cx, cy, R, variante):
    """Piezas negras del centro: ('linea', a, b, ancho, punta), ('circulo', c, r) o ('poli', puntos)."""
    v = variante
    if v == 'original':
        return [ranura(cx, cy, R, a, 0.30, 0.62, 0.17) for a in TRES]
    if v == 'sin_ranuras':
        return []
    if v == 'nucleo_circular':
        return [('circulo', (cx, cy), R * 0.12)] + [ranura(cx, cy, R, a, 0.38, 0.62, 0.13) for a in TRES]
    if v == 'nucleo_hexagonal':
        return [('poli', hexagono(cx, cy, R * 0.19, 30))] + [ranura(cx, cy, R, a, 0.36, 0.62, 0.13, 'butt') for a in TRES]
    if v == 'rectas':
        return [ranura(cx, cy, R, a, 0.26, 0.62, 0.15, 'butt') for a in TRES]
    if v == 'cunas':
        piezas = []
        for a in TRES:
            dx, dy = _dir(a)
            px, py = -dy, dx
            p0 = (cx + dx * R * 0.24, cy + dy * R * 0.24)
            w = R * 0.15
            p1 = (cx + dx * R * 0.64 + px * w, cy + dy * R * 0.64 + py * w)
            p2 = (cx + dx * R * 0.64 - px * w, cy + dy * R * 0.64 - py * w)
            piezas.append(('poli', [p0, p1, p2]))
        return piezas
    if v == 'circuito':
        piezas = []
        for a in TRES:
            dx, dy = _dir(a)
            piezas.append(ranura(cx, cy, R, a, 0.34, 0.62, 0.07))
            piezas.append(('circulo', (cx + dx * R * 0.30, cy + dy * R * 0.30), R * 0.085))
        return piezas
    if v == 'seis':
        return [ranura(cx, cy, R, a, 0.40, 0.62, 0.11) for a in SEIS]
    if v == 'invertidas':
        return [ranura(cx, cy, R, a, 0.30, 0.62, 0.17) for a in OTRAS_TRES]
    if v == 'finas':
        return [ranura(cx, cy, R, a, 0.22, 0.62, 0.075) for a in TRES]
    raise SystemExit(f'Variante desconocida: {v}')


NOMBRES = {
    'original': 'Original', 'sin_ranuras': 'Sin ranuras', 'nucleo_circular': 'Núcleo circular',
    'nucleo_hexagonal': 'Núcleo hexagonal', 'rectas': 'Ranuras rectas', 'cunas': 'Cuñas', 'circuito': 'Circuito',
    'seis': 'Seis ranuras', 'invertidas': 'Invertidas', 'finas': 'Ranuras finas',
}


def geometria(cx, cy, R, variante):
    exterior = hexagono(cx, cy, R)
    blanco = hexagono(cx, cy, R * R_BLANCO)
    muescas = [hexagono(x, y, R * R_MUESCA) for x, y in exterior]
    return exterior, blanco, muescas, cortes(cx, cy, R, variante)


def pts(p):
    return ' '.join(f'{x:.2f},{y:.2f}' for x, y in p)


def _svg_pieza(c):
    if c[0] == 'linea':
        (x1, y1), (x2, y2), w, punta = c[1:]
        return f'<line x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}" stroke="#000" stroke-width="{w:.2f}" stroke-linecap="{punta}"/>'
    if c[0] == 'circulo':
        (x, y), r = c[1:]
        return f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{r:.2f}" fill="#000"/>'
    return f'<polygon points="{pts(c[1])}" fill="#000"/>'


def svg(fondo=True, id_mascara='nx', clase_hex='', clase_marca='', variante=None, presentacion=False):
    """Con presentacion=True agrega el contorno que se dibuja al entrar (pres-trazo, con pathLength 1 para animar el
    trazo de 0 a 1) y la onda que sale del hexágono cuando la marca encaja (pres-onda)."""
    S, R = 240.0, 104.0
    ext, bla, mus, cor = geometria(S / 2, S / 2, R, variante or VARIANTE)
    mascara = (f'<mask id="{id_mascara}"><rect width="{S:g}" height="{S:g}" fill="#000"/><polygon points="{pts(bla)}" fill="#fff"/>'
               + ''.join(f'<polygon points="{pts(m)}" fill="#000"/>' for m in mus) + ''.join(_svg_pieza(c) for c in cor) + '</mask>')
    partes = [f'<defs>{mascara}</defs>']
    if fondo:
        partes.append(f'<rect width="{S:g}" height="{S:g}" rx="46" fill="{ROJO}"/>')
    if presentacion:
        partes.append(f'<polygon class="pres-onda" points="{pts(ext)}" fill="none" stroke="{BLANCO}" stroke-width="2"/>')
    partes.append(f'<polygon class="{clase_hex}" points="{pts(ext)}" fill="{NEGRO}"/>')
    partes.append(f'<g class="{clase_marca}"><rect width="{S:g}" height="{S:g}" fill="{BLANCO}" mask="url(#{id_mascara})"/></g>')
    if presentacion:
        partes.append(f'<polygon class="pres-trazo" points="{pts(ext)}" pathLength="1" fill="none" stroke="{BLANCO}" stroke-width="3" stroke-linejoin="round"/>')
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S:g} {S:g}">' + ''.join(partes) + '</svg>'


def png(tam, variante=None, fondo=True):
    from PIL import Image, ImageDraw
    k = 4                                   # sobremuestreo para bordes suaves
    T = tam * k
    img = Image.new('RGBA', (T, T), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    esc = T / 240.0
    if fondo:
        d.rounded_rectangle([0, 0, T - 1, T - 1], radius=46 * esc, fill=ROJO)
    ext, bla, mus, cor = geometria(120 * esc, 120 * esc, 104 * esc, variante or VARIANTE)
    d.polygon(ext, fill=NEGRO)
    marca = Image.new('L', (T, T), 0)
    dm = ImageDraw.Draw(marca)
    dm.polygon(bla, fill=255)
    for m in mus:
        dm.polygon(m, fill=0)
    for c in cor:
        if c[0] == 'linea':
            a, b, w, punta = c[1:]
            dm.line([a, b], fill=0, width=int(round(w)))
            if punta == 'round':
                for x, y in (a, b):
                    dm.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=0)
        elif c[0] == 'circulo':
            (x, y), r = c[1:]
            dm.ellipse([x - r, y - r, x + r, y + r], fill=0)
        else:
            dm.polygon(c[1], fill=0)
    img.paste(Image.new('RGBA', (T, T), BLANCO), (0, 0), marca)
    return img.resize((tam, tam), Image.LANCZOS)


def hoja(ruta, columnas=5, tam=200):
    """Todas las alternativas en una sola imagen, con su letra y nombre."""
    from PIL import Image, ImageDraw, ImageFont
    vs = list(NOMBRES)
    filas = math.ceil(len(vs) / columnas)
    m, alto_txt = 28, 44
    W, H = columnas * (tam + m) + m, filas * (tam + alto_txt + m) + m
    img = Image.new('RGB', (W, H), '#0c0a0a')
    d = ImageDraw.Draw(img)
    try:
        f1 = ImageFont.truetype('segoeuib.ttf', 20)
        f2 = ImageFont.truetype('segoeui.ttf', 17)
    except OSError:
        f1 = f2 = ImageFont.load_default()
    for k, v in enumerate(vs):
        c, r = k % columnas, k // columnas
        x, y = m + c * (tam + m), m + r * (tam + alto_txt + m)
        logo = png(tam, v)
        img.paste(logo, (x, y), logo)
        d.text((x, y + tam + 10), chr(65 + k), fill='#ff6b62', font=f1)
        d.text((x + 24, y + tam + 12), NOMBRES[v], fill='#f3eeee', font=f2)
    img.save(ruta)
    return ruta


def main():
    global VARIANTE
    a = sys.argv[1:]
    if '--variante' in a:
        VARIANTE = a[a.index('--variante') + 1]
    os.makedirs(SALIDA, exist_ok=True)
    if '--hoja' in a:
        print('hoja:', hoja(os.path.join(SALIDA, 'alternativas.png')))
        return
    with open(os.path.join(SALIDA, 'nex.svg'), 'w', encoding='utf-8') as fh:
        fh.write(svg(True, 'nx-f'))
    with open(os.path.join(SALIDA, 'nex-hex.svg'), 'w', encoding='utf-8') as fh:
        fh.write(svg(False, 'nx-h'))
    tams = (16, 20, 24, 32, 40, 48, 64, 96, 128, 256)
    imgs = {t: png(t) for t in tams}
    for t in (16, 32, 256):
        imgs[t].save(os.path.join(SALIDA, f'nex-{t}.png'))
    # el logo de la presentación va dentro de index.html, con sus partes separadas para animarlas
    html = os.path.join(RAIZ, 'web', 'index.html')
    t = open(html, encoding='utf-8').read()
    i = t.find('<svg class="pres-logo"')
    if i >= 0:
        j = t.index('</svg>', i) + len('</svg>')
        nuevo = svg(False, 'nx-pres', 'pres-hex', 'pres-mark', presentacion=True).replace('<svg xmlns="http://www.w3.org/2000/svg"', '<svg class="pres-logo" aria-hidden="true"')
        open(html, 'w', encoding='utf-8').write(t[:i] + nuevo + t[j:])
    imgs[256].save(os.path.join(SALIDA, 'cauce.ico'), sizes=[(t, t) for t in tams], append_images=[imgs[t] for t in tams[:-1]])
    print(f'listo ({VARIANTE}):', ', '.join(sorted(os.listdir(SALIDA))))


if __name__ == '__main__':
    main()
