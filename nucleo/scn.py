"""Escenarios de EPANET (.scn): lo que el programa EPANET guarda con File > Export > Scenario y carga con
File > Import > Scenario sobre la red abierta.

Se leen como los lee su importador (Uimport.pas y Uexport.pas del GUI de EPANET 2.2, USEPA/EPANET2.2):
- comentarios antes de la primera sección = la descripción que se escribió al exportar;
- [DIAMETERS] y [ROUGHNESS]: «tubería valor», solo tuberías (no válvulas ni bombas);
- [DEMANDS]: «nudo demanda [patrón] [;categoría]», solo nudos de consumo; la primera línea de un nudo reemplaza
  todas sus demandas y las siguientes agregan categorías;
- [QUALITY]: «nudo valor», calidad inicial de cualquier nudo;
- [REACTIONS]: «Bulk|Wall tubería valor» y «Tank tanque valor» (las opciones globales no se importan);
- [CONTROLS] y [RULES]: reemplazan todos los que hay, aunque la sección venga vacía (EPANET exporta las dos juntas).
EPANET reconoce las secciones por sus primeras letras ("[DIAM"); las que no sabe importar las salta en silencio:
aquí quedan en 'desconocidas' para avisar. Lo que se aplica es Editor.op_scn (nucleo/inp.py), una sola edición.
"""
from collections import OrderedDict

# las primeras cuatro letras, como FindKeyWord(..., 5) de EPANET con el corchete
SECCIONES = OrderedDict([('DEMA', 'DEMANDS'), ('DIAM', 'DIAMETERS'), ('ROUG', 'ROUGHNESS'), ('QUAL', 'QUALITY'),
                         ('REAC', 'REACTIONS'), ('CONT', 'CONTROLS'), ('RULE', 'RULES')])
TITULOS = {'DEMANDS': 'Demandas', 'DIAMETERS': 'Diámetros', 'ROUGHNESS': 'Rugosidades', 'QUALITY': 'Calidad inicial',
           'REACTIONS': 'Reacciones', 'CONTROLS': 'Controles', 'RULES': 'Reglas'}
TEXTO = ('CONTROLS', 'RULES')          # se copian como texto; las demás son datos por elemento


def _num(x):
    try:
        return float(x)
    except ValueError:
        return None


def leer(texto):
    """{'notas', 'secciones': {DIAMETERS: [[id, v]], ROUGHNESS: [[id, v]], DEMANDS: [[id, q, patrón, categoría]],
    QUALITY: [[id, v]], REACTIONS: [[Bulk|Wall|Tank, id, v]], CONTROLS: [líneas], RULES: [líneas]},
    'desconocidas': [encabezados], 'malas': [[n.º de línea, línea, motivo]]}. ValueError si no es un .scn."""
    notas, sec, ignorar = [], None, False
    secciones, desconocidas, malas = OrderedDict(), [], []
    for k, raw in enumerate(texto.replace('\r\n', '\n').replace('\r', '\n').split('\n'), 1):
        datos, _, com = raw.partition(';')
        f = datos.split()
        if f and f[0].startswith('['):
            cab = datos.strip()
            sec = SECCIONES.get(cab[1:5].upper())
            ignorar = sec is None
            if sec is None:
                if cab[1:5].upper() == 'TITL':
                    sec, ignorar = 'TITLE', False      # EPANET lo suma a las notas del proyecto
                else:
                    desconocidas.append(cab)
            elif sec in TEXTO:
                secciones[sec] = []                 # como EPANET: un encabezado nuevo borra lo leído antes
            continue
        if sec is None and not ignorar:
            if f:
                raise ValueError(f'No parece un escenario de EPANET: la línea {k} trae datos antes de la primera sección.')
            if com.strip():
                notas.append(com.strip())
            continue
        if ignorar:
            continue
        if sec == 'TITLE':
            if raw.strip():
                notas.append(raw.strip())
            continue
        if sec in TEXTO:
            if raw.strip():
                secciones[sec].append(raw.rstrip())
            continue
        if not f:
            continue
        lin = raw.strip()
        if sec == 'REACTIONS':
            tipo = f[0][:4].upper()
            if tipo not in ('BULK', 'WALL', 'TANK'):
                malas.append([k, lin, 'de [REACTIONS] solo se importan Bulk, Wall y Tank'])
            elif len(f) < 3 or _num(f[2]) is None:
                malas.append([k, lin, 'falta el coeficiente'])
            else:
                secciones.setdefault(sec, []).append([tipo.capitalize(), f[1], f[2]])
            continue
        v = _num(f[1]) if len(f) > 1 else None
        if v is None:
            malas.append([k, lin, 'falta el valor o no es un número'])
        elif sec in ('DIAMETERS', 'ROUGHNESS') and v <= 0:
            malas.append([k, lin, 'tiene que ser mayor que cero'])
        elif sec == 'DEMANDS':
            secciones.setdefault(sec, []).append([f[0], f[1], f[2] if len(f) > 2 else '', com.strip()])
        else:
            secciones.setdefault(sec, []).append([f[0], f[1]])
    return {'notas': '\n'.join(notas), 'secciones': secciones, 'desconocidas': desconocidas, 'malas': malas}


def leer_archivo(ruta):
    # EPANET en Windows los guarda en ANSI (latin-1, como los .inp); uno escrito a mano puede venir en UTF-8
    with open(ruta, 'rb') as fh:
        crudo = fh.read()
    try:
        texto = crudo.decode('utf-8-sig')
    except UnicodeDecodeError:
        texto = crudo.decode('latin-1')
    return leer(texto)


def ids(secciones, sec):
    # el elemento de cada línea de datos (en [REACTIONS] va después de Bulk/Wall/Tank)
    return [x[1] if sec == 'REACTIONS' else x[0] for x in secciones.get(sec, [])]


def quitar(secciones, malos):
    """Las secciones sin las líneas de los elementos que no sirven ([(sección, id, motivo)] de Editor.revisar_scn)."""
    fuera = {(s, i) for s, i, _ in malos}
    out = OrderedDict()
    for sec, filas in secciones.items():
        if sec in TEXTO:
            out[sec] = filas
            continue
        quedan = [x for x, i in zip(filas, ids(secciones, sec)) if (sec, i) not in fuera]
        if quedan:
            out[sec] = quedan
    return out


def resumen(m, datos, malos):
    """Lo que haría el escenario sobre el modelo m (el que se ve, con sus ediciones), para mostrarlo antes de
    aplicar: por sección cuántos elementos, de qué a qué valor y cuántos ya tienen ese valor."""
    secs = datos['secciones']
    fuera = {(s, i) for s, i, _ in malos}
    out, nudos, tramos = [], set(), set()
    for sec, filas in secs.items():
        r = {'clave': sec, 'titulo': TITULOS[sec], 'lineas': len(filas)}
        if sec == 'CONTROLS':
            r.update(antes=len(m.controles), despues=sum(1 for t in filas if not t.strip().startswith(';')))
        elif sec == 'RULES':
            r.update(antes=len(m.reglas), despues=sum(1 for t in filas if t.split()[0].upper() == 'RULE'))
        elif sec in ('DIAMETERS', 'ROUGHNESS'):
            campo = 'diam' if sec == 'DIAMETERS' else 'rug'
            ultimo = OrderedDict((l, float(v)) for l, v in filas if (sec, l) not in fuera)
            grupos = OrderedDict()
            for l, v in ultimo.items():
                d = m.tramos[l]
                g = grupos.setdefault((d[campo], v), [0, 0.0])
                g[0] += 1
                g[1] += d.get('lon', 0)
            tramos.update(l for l, v in ultimo.items() if m.tramos[l][campo] != v)
            r.update(elementos=len(ultimo), cambian=sum(1 for l, v in ultimo.items() if m.tramos[l][campo] != v),
                     longitud=round(sum(m.tramos[l].get('lon', 0) for l in ultimo), 3),
                     grupos=sorted([[de, a, k, round(lon, 3)] for (de, a), (k, lon) in grupos.items() if de != a],
                                   key=lambda g: -g[2]))
        elif sec == 'DEMANDS':
            nuevas = OrderedDict()
            for n, q, pat, _ in filas:
                if ('DEMANDS', n) not in fuera:
                    nuevas.setdefault(n, []).append((float(q), pat))
            antes = despues = 0.0
            cambian = 0
            for n, ds in nuevas.items():
                actual = m.demandas.get(n) or [(m.nudos[n].get('dem', 0), m.nudos[n].get('pat', ''))]
                antes += sum(q for q, _ in actual)
                despues += sum(q for q, _ in ds)
                # sin patrón en una sola línea, EPANET le deja al nudo el que tenía en [JUNCTIONS]
                if len(ds) == 1 and not ds[0][1]:
                    ds = [(ds[0][0], m.nudos[n].get('pat', ''))]
                if [(q, p or '') for q, p in actual] != [(q, p or '') for q, p in ds]:
                    cambian += 1
                    nudos.add(n)
            r.update(elementos=len(nuevas), cambian=cambian, antes=round(antes, 6), despues=round(despues, 6),
                     categorias=sum(1 for ds in nuevas.values() if len(ds) > 1))
        elif sec == 'QUALITY':
            ultimo = OrderedDict((n, float(v)) for n, v in filas if (sec, n) not in fuera)
            cambia = [n for n, v in ultimo.items() if _num(m.calidad_ini.get(n, '0')) != v]
            nudos.update(cambia)
            r.update(elementos=len(ultimo), cambian=len(cambia))
        elif sec == 'REACTIONS':
            ultimo = OrderedDict(((t.upper(), x), float(v)) for t, x, v in filas if (sec, x) not in fuera)
            cambia = [(t, x) for (t, x), v in ultimo.items() if _num(m.reacciones.get((t, x), '')) != v]
            for t, x in cambia:
                (nudos if t == 'TANK' else tramos).add(x)
            r.update(elementos=len(ultimo), cambian=len(cambia))
        out.append(r)
    return {'notas': datos['notas'], 'secciones': out, 'desconocidas': datos['desconocidas'], 'malas': datos['malas'],
            'faltan': [list(x) for x in malos], 'nudos': sorted(nudos), 'tramos': sorted(tramos)}
