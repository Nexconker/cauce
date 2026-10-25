#!/usr/bin/env python3
"""
Cauce: un EPANET más claro para trabajar modelos de redes de agua.

Arranca un servidor en tu propia máquina (127.0.0.1) y abre el navegador. Todo corre en tu PC: los .inp no salen
de tu equipo. Usa el mismo motor de cálculo que el programa EPANET (versiones 2.2 y 2.3 en la carpeta motor).

    python -I cauce.py                 abre el navegador
    python -I cauce.py --sin-navegador solo el servidor (puerto 8790)
    pythonw -I lanzar.pyw              como programa: ventana propia y apagado automático al cerrarla

Nunca sobrescribe un .inp que tú no hayas exportado desde aquí: los cambios viven en escenarios (trabajo/) y se
exportan a un archivo nuevo, validado con el motor 2.2 antes de escribirlo.
"""
import http.server
import json
import os
import re
import socketserver
import string
import sys
import threading
import time
import traceback
import urllib.parse
import uuid
import webbrowser
from array import array

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# lo que instala "Instalar Cauce.bat" (openpyxl, pywebview) va en lib/, al lado de Cauce: no depende de dónde ni cómo
# esté instalado Python, y funciona con -I (que no mira las carpetas de paquetes del usuario)
if os.path.isdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib')):
    sys.path.insert(1, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from nucleo import actualizar, calibracion, comparar, consignas, convenciones, diagnostico, escenarios, guiones, inp, motor, quinquenios, scn, textos, unidades  # noqa: E402

HOST = '127.0.0.1'
PUERTO = int(os.environ.get('CAUCE_PUERTO', '8790'))
if '--puerto' in sys.argv:          # para probar al lado de la ventana instalada, que usa el 8790
    PUERTO = int(sys.argv[sys.argv.index('--puerto') + 1])
RAIZ = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(RAIZ, 'web')
TRABAJO = os.path.join(RAIZ, 'trabajo')
CONFIG = os.path.join(TRABAJO, 'config.json')
MIS_SCRIPTS = os.path.join(TRABAJO, 'scripts')      # los del usuario
EJEMPLOS = os.path.join(RAIZ, 'ejemplos')            # los que trae Cauce (solo lectura)
VERSION = actualizar.version_local(RAIZ)      # archivo VERSION (lo sube scripts/publicar.py)

LOCK = threading.RLock()
ULTIMO_PEDIDO = [time.time()]   # para el apagado automático cuando se cierra la ventana
DOCS = {}        # id -> Documento
TRABAJOS = {}    # id -> dict
CORRIDAS = {}    # id -> dict(corrida, doc, nombre, cuando)


# ====================================================================== configuración
def leer_config():
    try:
        with open(CONFIG, encoding='utf-8') as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {'recientes': [], 'carpeta': ''}


def guardar_config(c):
    os.makedirs(TRABAJO, exist_ok=True)
    with open(CONFIG, 'w', encoding='utf-8') as fh:
        json.dump(c, fh, ensure_ascii=False, indent=1)


def leer_convenciones():
    return convenciones.normalizar(leer_config().get('convenciones'))


CONV = None      # convenciones vigentes (Ajustes); se cargan al arrancar


def recordar(ruta):
    c = leer_config()
    r = [x for x in c.get('recientes', []) if os.path.normcase(x) != os.path.normcase(ruta)]
    c['recientes'] = [ruta] + r[:14]
    c['carpeta'] = os.path.dirname(ruta)
    guardar_config(c)


# ====================================================================== documentos
# los modelos empezados desde cero en Cauce llevan esta primera línea: solo esos se guardan en su propio .inp (los
# demás, como los del equipo, nunca se sobrescriben: se exportan con otro nombre o se guarda el escenario)
MARCA_PROPIO = '; Creado con Cauce'
UNIDADES_CAUDAL = ('LPS', 'LPM', 'MLD', 'CMH', 'CMD', 'CMS', 'CFS', 'GPM', 'MGD', 'IMGD', 'AFD')
FORMULAS = ('H-W', 'D-W', 'C-M')


def plantilla(titulo, unidades, formula):
    s = ['; Creado con Cauce · Nex-Industries', '[TITLE]', titulo or 'Modelo nuevo', '',
         '[JUNCTIONS]', ';ID              \tElev        \tDemand      \tPattern         ', '',
         '[RESERVOIRS]', ';ID              \tHead        \tPattern         ', '',
         '[TANKS]', ';ID              \tElevation   \tInitLevel   \tMinLevel    \tMaxLevel    \tDiameter    \tMinVol      \tVolCurve', '',
         '[PIPES]', ';ID              \tNode1           \tNode2           \tLength      \tDiameter    \tRoughness   \tMinorLoss   \tStatus', '',
         '[PUMPS]', ';ID              \tNode1           \tNode2           \tParameters', '',
         '[VALVES]', ';ID              \tNode1           \tNode2           \tDiameter    \tType\tSetting     \tMinorLoss   ', '',
         '[TAGS]', '', '[DEMANDS]', '', '[STATUS]', '', '[PATTERNS]', '', '[CURVES]', '', '[CONTROLS]', '', '[RULES]', '',
         '[ENERGY]', ' Global Efficiency  \t75', ' Global Price       \t0', ' Demand Charge      \t0', '',
         '[EMITTERS]', '', '[QUALITY]', '', '[SOURCES]', '', '[REACTIONS]', '', '[MIXING]', '',
         '[TIMES]', ' Duration           \t24:00', ' Hydraulic Timestep \t1:00', ' Quality Timestep   \t0:05',
         ' Pattern Timestep   \t1:00', ' Pattern Start      \t0:00', ' Report Timestep    \t1:00', ' Report Start       \t0:00',
         ' Start ClockTime    \t12 am', ' Statistic          \tNONE', '',
         '[REPORT]', ' Status             \tNo', ' Summary            \tNo', '',
         '[OPTIONS]', f' Units              \t{unidades}', f' Headloss           \t{formula}', ' Specific Gravity   \t1',
         ' Viscosity          \t1', ' Trials             \t40', ' Accuracy           \t0.001', ' Unbalanced         \tContinue 10',
         ' Checkfreq          \t2', ' Maxcheck           \t10', ' Damplimit          \t0',
         ' Demand Multiplier  \t1.0', ' Emitter Exponent   \t0.5', ' Quality            \tNone mg/L', ' Diffusivity        \t1',
         ' Tolerance          \t0.01', '',
         '[COORDINATES]', ';Node            \tX-Coord           \tY-Coord', '',
         '[VERTICES]', ';Link            \tX-Coord           \tY-Coord', '',
         '[LABELS]', '', '[END]', '']
    return '\r\n'.join(s)


# lo que define un escenario (sin fechas ni ruta): si cambia desde la última vez que se guardó, hay cambios sin guardar
CLAVES_ESC = ('nombre', 'notas', 'ediciones', 'proyectos', 'estados', 'consignas', 'demandas', 'multiplicador', 'opciones',
              'quinquenio')


def firma(esc):
    return json.dumps({k: esc.get(k) for k in CLAVES_ESC}, sort_keys=True, ensure_ascii=False, default=str)


class Documento:
    def __init__(self, ruta, esc=None, archivo=None):
        self.id = uuid.uuid4().hex[:8]
        self.ruta = os.path.abspath(ruta)
        with open(self.ruta, encoding='latin-1', newline='') as fh:
            self.original = fh.read()
        self.base = inp.Modelo(self.original, self.ruta)
        self.esc = esc or escenarios.nuevo(self.ruta, 'Sin cambios')
        self.esc['base'] = self.ruta
        self.archivo = archivo          # el .json del escenario, si vino de uno o ya se guardó
        self.propio = self.original.lstrip().startswith(MARCA_PROPIO)
        self.guardado = firma(self.esc)
        self.version = 0
        self.rehacer()

    @property
    def nombre(self):
        return os.path.basename(self.ruta)

    def rehacer(self):
        if escenarios.vacio(self.esc):
            self.texto, self.avisos, self.modelo = self.original, [], self.base
        else:
            self.texto, self.avisos, _ = escenarios.aplicar(self.base, self.esc, CONV)
            self.modelo = inp.Modelo(self.texto, self.ruta)
        self.hallazgos = None
        self._validez = None
        self.version += 1

    def validez(self):
        # (ok, errores) de EPANET 2.2 para el texto actual; se calcula una vez por versión
        if self._validez is None:
            self._validez = motor.validar(self.texto, '2.2')
        return self._validez

    def marcar_guardado(self):
        self.guardado = firma(self.esc)

    def info(self):
        return {'id': self.id, 'nombre': self.nombre, 'ruta': self.ruta, 'escenario': self.esc.get('nombre'),
                'cambios': not escenarios.vacio(self.esc), 'sin_guardar': firma(self.esc) != self.guardado,
                'archivo': self.archivo, 'propio': self.propio, 'version': self.version, 'avisos': self.avisos,
                'corridas': [c for c, v in CORRIDAS.items() if v['doc'] == self.id]}


def modelo_json(m):
    ids_n = list(m.nudos)
    idx = {n: k for k, n in enumerate(ids_n)}
    T = {'junction': 0, 'reservoir': 1, 'tank': 2}
    N = {'id': ids_n, 'tipo': [], 'x': [], 'y': [], 'cota': [], 'dem': [], 'pat': [], 'tag': [], 'com': []}
    tanques = {}
    for k, n in enumerate(ids_n):
        d = m.nudos[n]
        N['tipo'].append(T[d['tipo']])
        x, y = m.coords.get(n, (None, None))
        N['x'].append(x); N['y'].append(y)
        N['cota'].append(d.get('cota', 0))
        N['dem'].append(d.get('dem', 0) if d['tipo'] == 'junction' else 0)
        N['pat'].append(d.get('pat', ''))
        N['tag'].append(m.tag('nudo', n))
        N['com'].append(d.get('com', ''))
        if d['tipo'] == 'tank':
            tanques[k] = {c: d[c] for c in ('nini', 'nmin', 'nmax', 'diam', 'vmin', 'curva')}
    L = {'id': [], 'tipo': [], 'n1': [], 'n2': [], 'vi': [0], 'vx': [], 'diam': [], 'lon': [], 'rug': [], 'estado': [],
         'consigna': [], 'tag': [], 'com': [], 'curva': []}
    for l, d in m.tramos.items():
        if d['n1'] not in idx or d['n2'] not in idx:
            continue
        L['id'].append(l)
        L['tipo'].append(d['vt'])
        L['n1'].append(idx[d['n1']]); L['n2'].append(idx[d['n2']])
        for x, y in m.vertices.get(l, []):
            L['vx'] += [x, y]
        L['vi'].append(len(L['vx']) // 2)
        L['diam'].append(d.get('diam', 0))
        L['lon'].append(d.get('lon', 0))
        L['rug'].append(d.get('rug', 0))
        L['estado'].append(m.estado_inicial(l))
        L['consigna'].append(d.get('consigna', ''))
        L['tag'].append(m.tag('tramo', l))
        L['com'].append(d.get('com', ''))
        p = d.get('params', {})
        L['curva'].append(p.get('HEAD') or (f'POWER {p["POWER"]}' if 'POWER' in p else ''))
    idx_l = {l: k for k, l in enumerate(L['id'])}
    L['horizonte'] = [convenciones.horizonte(t, CONV) or 0 for t in L['tag']]
    sis = unidades.sistema(m)
    pres, vel = unidades.clases_por_defecto(sis)
    gs = []
    for g in escenarios.grupos(m, CONV):
        gs.append({k: v for k, v in g.items() if k != 'tramos'} | {'tramos': [idx_l[l] for l in g['tramos'] if l in idx_l]})
    return {'nudos': N, 'tramos': L, 'tanques': tanques, 'rotulos': m.rotulos,
            'opciones': m.opciones('[OPTIONS]'), 'tiempos': m.opciones('[TIMES]'),
            'unidades': m.opciones('[OPTIONS]').get('UNITS', 'LPS'), 'patrones': list(m.patrones),
            'curvas': list(m.curvas), 'n_controles': len(m.controles), 'n_reglas': len(m.reglas), 'grupos': gs,
            'sistema': sis, 'horizontes': sorted({a for a in L['horizonte'] if a}),
            # las clases de Ajustes solo valen para modelos con la misma unidad de presión en que se escribieron
            'clases': {'presion': CONV['clases_presion'] if CONV['clases_presion'] and CONV['clases_unidad'] in ('', sis['presion']) else pres,
                       'velocidad': CONV['clases_velocidad'] if CONV['clases_velocidad'] and CONV['clases_unidad'] in ('', sis['presion']) else vel},
            'meta_balance': CONV['meta_balance']}


def datos_json(m):
    # Patrones, curvas (con su tipo, el escrito o el que sale de quién la usa), controles, reglas y opciones
    uso = {}
    for l, d in m.tramos.items():
        if d.get('params', {}).get('HEAD'):
            uso.setdefault(d['params']['HEAD'], 'PUMP')
        if d['tipo'] == 'valve' and d.get('vt') == 'GPV':
            uso.setdefault(d.get('consigna'), 'HEADLOSS')
    for n, d in m.nudos.items():
        if d.get('curva'):
            uso.setdefault(d['curva'], 'VOLUME')
    for (b, k), v in m.energia_bomba.items():
        if k == 'EFFIC':
            uso.setdefault(v, 'EFFICIENCY')
    curvas = {c: {'puntos': p, 'tipo': m.tipo_curva.get(c) or uso.get(c) or 'PUMP'} for c, p in m.curvas.items()}
    reglas = []
    if '[RULES]' in m.cab:
        for cab in m.cab['[RULES]']:
            i = cab + 1
            while i < len(m.lineas) and not m.lineas[i].strip().startswith('['):
                reglas.append(m.lineas[i])
                i += 1
    while reglas and not reglas[-1].strip():
        reglas.pop()
    reac = m.opciones('[REACTIONS]')
    return {'patrones': m.patrones, 'curvas': curvas, 'controles': [t for _, t in m.controles],
            'reglas': '\n'.join(reglas), 'n_reglas': len(m.reglas), 'rotulos': m.rotulos,
            'opciones': m.opciones('[OPTIONS]'), 'tiempos': m.opciones('[TIMES]'),
            'reacciones': {k: v for k, v in reac.items() if k not in ('BULK', 'WALL', 'TANK')},
            'energia': {k: v for k, v in m.opciones('[ENERGY]').items() if k != 'PUMP'},
            'sistema': unidades.sistema(m)}


def elemento_json(doc, clase, ident):
    m = doc.modelo
    if clase == 'nudo':
        d = m.nudos.get(ident)
        if d is None:
            return None
        tramos = [{'id': l, 'tipo': t['vt'], 'otro': t['n2'] if t['n1'] == ident else t['n1']}
                  for l, t in m.tramos.items() if ident in (t['n1'], t['n2'])]
        props = {k: d.get(k) for k in textos.PARAMETROS.get(d['tipo'], {}) if k in d}
        extra = {'tramos': tramos, 'demandas': m.demandas.get(ident, []),
                 'calidad': {'inicial': m.calidad_ini.get(ident, ''), 'fuente': m.fuentes.get(ident, []),
                             'emisor': m.emisores.get(ident, ''), 'mezcla': m.mezcla.get(ident, []),
                             'reaccion': m.reacciones.get(('TANK', ident), '')}}
    else:
        d = m.tramos.get(ident)
        if d is None:
            return None
        props = {}
        if d['tipo'] == 'pump':
            p = d.get('params', {})
            props = {'curva': p.get('HEAD', ''), 'potencia': p.get('POWER', ''), 'velocidad': p.get('SPEED', ''),
                     'estado': m.estado_inicial(ident)}
        else:
            props = {k: d.get(k) for k in textos.PARAMETROS.get(d['tipo'], {}) if k in d}
            props['estado'] = m.estado_inicial(ident)
        extra = {'n1': d['n1'], 'n2': d['n2'], 'grupo': diagnostico.grupo_de(m, ident, CONV),
                 'calidad': {'bulk': m.reacciones.get(('BULK', ident), ''), 'wall': m.reacciones.get(('WALL', ident), '')},
                 'energia': {k.lower(): v for (b, k), v in m.energia_bomba.items() if b == ident},
                 'patron_bomba': d.get('params', {}).get('PATTERN', '')}
    ctl, reg = m.referencias(ident)
    return {'clase': clase, 'id': ident, 'tipo': d['tipo'], 'vt': d.get('vt'), 'com': d.get('com', ''),
            'tag': m.tag(clase, ident), 'linea': m.lineas[d['linea']].strip(), 'props': props,
            'controles': ctl, 'reglas': [{'nombre': r, 'texto': m.reglas[r]['texto']} for r in reg], **extra}


# ====================================================================== trabajos en segundo plano
def lanzar(tipo, doc, fn, obj=None):
    tid = uuid.uuid4().hex[:8]
    t = {'id': tid, 'tipo': tipo, 'doc': doc.id, 'inicio': time.time(), 'fase': 'en curso', 'obj': obj,
         'resultado': None, 'error': None}

    def correr():
        try:
            t['resultado'] = fn()
            t['fase'] = 'lista'
        except Exception as ex:   # el error se muestra en la interfaz
            t['error'] = f'{type(ex).__name__}: {ex}'
            t['traza'] = traceback.format_exc()
            t['fase'] = 'error'
    with LOCK:
        TRABAJOS[tid] = t
    threading.Thread(target=correr, daemon=True).start()
    return tid


def iniciar_corrida(doc, version, analizar, calidad=True):
    c = motor.Corrida(doc.texto, version, analizar, nombre=doc.esc.get('nombre', ''), calidad=calidad)
    rid = uuid.uuid4().hex[:8]

    def fn():
        c.correr()
        with LOCK:
            CORRIDAS[rid] = {'corrida': c, 'doc': doc.id, 'nombre': f'{doc.nombre} · {doc.esc.get("nombre")} · motor {version}',
                             'cuando': time.strftime('%H:%M:%S'), 'version_doc': doc.version}
        return {'corrida': rid, 'fase': c.fase, 'resumen': c.resumen, 'error': c.error}
    return lanzar('corrida', doc, fn, c)


def iniciar_script(doc, codigo):
    # la última corrida de este modelo tal como está ahora, para red.resultados
    corrida = None
    for v in CORRIDAS.values():
        if v['doc'] == doc.id and v.get('version_doc') == doc.version and v['corrida'].fase in ('lista', 'fallo'):
            corrida = v['corrida']
    ej = guiones.Ejecucion(doc.texto, codigo, CONV, RAIZ, corrida)
    version = doc.version

    def fn():
        r = ej.correr()
        r['version_doc'] = version
        r['codigo'] = codigo
        return r
    return lanzar('script', doc, fn, ej)


def estado_trabajo(tid):
    t = TRABAJOS.get(tid)
    if not t:
        return None
    out = {k: t[k] for k in ('id', 'tipo', 'doc', 'fase', 'resultado', 'error')}
    out['segundos'] = round(time.time() - t['inicio'], 1)
    if t['obj'] is not None and hasattr(t['obj'], 'progreso'):
        out['progreso'] = t['obj'].progreso()
    return out


def resultados_ordenados(rid, var, doc):
    """Los resultados de una variable en el orden de nudos/tramos del modelo actual (NaN si no está)."""
    run = CORRIDAS[rid]['corrida']
    nodos = var in ('presion', 'carga', 'demanda', 'calidad')
    ids_run = run.ids_n if nodos else run.ids_l
    ids_mod = list(doc.modelo.nudos) if nodos else [l for l, d in doc.modelo.tramos.items()
                                                     if d['n1'] in doc.modelo.nudos and d['n2'] in doc.modelo.nudos]
    pos = {i: k for k, i in enumerate(ids_run)}
    n = len(ids_run)
    T = len(run.horas)
    a = run.res.get(var, array('f'))
    out = array('f', [float('nan')]) * (T * len(ids_mod))
    mapa = [pos.get(i, -1) for i in ids_mod]
    M = len(ids_mod)
    for h in range(T):
        b = h * n
        o = h * M
        for j, k in enumerate(mapa):
            if k >= 0:
                out[o + j] = a[b + k]
    return T, M, out.tobytes()


# ====================================================================== explorador de archivos
IMAGENES = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.bmp': 'image/bmp', '.gif': 'image/gif', '.webp': 'image/webp'}
EXT = ('.inp', '.xlsx', '.xlsm', '.json', '.csv', '.dat', '.txt', '.scn') + tuple(IMAGENES)
CALIBRACION = os.path.join(TRABAJO, 'calibracion')     # mediciones de campo por modelo


def camino(m, desde, hasta):
    # El camino más corto (por longitud) entre dos nudos, para el perfil. Las tuberías cuentan su longitud;
    # bombas y válvulas, la distancia entre sus nudos en el mapa.
    import heapq
    import math
    if desde not in m.nudos or hasta not in m.nudos:
        raise ErrorApi(400, 'Uno de los dos nudos no existe en el modelo.')
    ady = {}
    for l, d in m.tramos.items():
        a, b = d['n1'], d['n2']
        if a not in m.nudos or b not in m.nudos:
            continue
        lon = d.get('lon') if d['tipo'] == 'pipe' else None
        if not lon:
            pa, pb = m.coords.get(a), m.coords.get(b)
            lon = math.dist(pa, pb) if pa and pb else 1.0
        ady.setdefault(a, []).append((b, l, lon))
        ady.setdefault(b, []).append((a, l, lon))
    dist, prev, cola = {desde: 0.0}, {}, [(0.0, desde)]
    while cola:
        dd, x = heapq.heappop(cola)
        if x == hasta:
            break
        if dd > dist.get(x, float('inf')):
            continue
        for y, l, lon in ady.get(x, []):
            nd = dd + lon
            if nd < dist.get(y, float('inf')):
                dist[y], prev[y] = nd, (x, l)
                heapq.heappush(cola, (nd, y))
    if hasta not in dist:
        raise ErrorApi(400, f'No hay camino entre {desde} y {hasta}.')
    nudos, tramos = [hasta], []
    while nudos[-1] != desde:
        x, l = prev[nudos[-1]]
        tramos.append(l)
        nudos.append(x)
    nudos.reverse(); tramos.reverse()
    return {'nudos': nudos, 'tramos': tramos, 'distancias': [round(dist[x], 3) for x in nudos],
            'cotas': [m.nudos[x].get('cota', 0) for x in nudos], 'longitud': round(dist[hasta], 3)}


def fondo_de(ruta_modelo):
    return leer_config().get('fondos', {}).get(os.path.normcase(ruta_modelo))


def explorar(ruta):
    if not ruta:
        ruta = leer_config().get('carpeta') or os.path.expanduser('~')
    ruta = os.path.abspath(ruta)
    if os.path.isfile(ruta):
        ruta = os.path.dirname(ruta)
    carpetas, archivos = [], []
    try:
        for e in sorted(os.scandir(ruta), key=lambda e: e.name.lower()):
            if e.name.startswith(('.', '$')):
                continue
            try:
                if e.is_dir():
                    carpetas.append(e.name)
                elif e.name.lower().endswith(EXT):
                    st = e.stat()
                    archivos.append({'nombre': e.name, 'kb': round(st.st_size / 1024), 'mod': time.strftime('%Y-%m-%d %H:%M', time.localtime(st.st_mtime))})
            except OSError:
                pass
    except OSError as ex:
        return {'ruta': ruta, 'error': str(ex), 'carpetas': [], 'archivos': []}
    unidades = [f'{u}:\\' for u in string.ascii_uppercase if os.path.exists(f'{u}:\\')]
    padre = os.path.dirname(ruta) if os.path.dirname(ruta) != ruta else ''
    return {'ruta': ruta, 'padre': padre, 'carpetas': carpetas, 'archivos': archivos, 'unidades': unidades,
            'recientes': leer_config().get('recientes', []),
            'atajos': [p for p in (os.path.expanduser('~\\Desktop'), os.path.expanduser('~\\Downloads'),
                                   os.path.expanduser('~\\Documents'), os.path.join(os.path.expanduser('~'), 'OneDrive', 'Desktop'))
                       if os.path.isdir(p)]}


# ====================================================================== API
def doc_de(partes):
    d = DOCS.get(partes[2]) if len(partes) > 2 else None
    if d is None:
        raise ErrorApi(404, 'Ese modelo ya no está abierto.')
    return d


class ErrorApi(Exception):
    def __init__(self, codigo, msg):
        super().__init__(msg)
        self.codigo = codigo


def api_get(ruta, q):
    p = ruta.strip('/').split('/')        # ['api', ...]
    if p[1] == 'estado':
        return {'version': VERSION, 'actualizacion': actualizar.aviso_pendiente(RAIZ), 'docs': [d.info() for d in DOCS.values()],
                'motores': {v: motor.version_dll(v) for v in motor.DLLS}, 'recientes': leer_config().get('recientes', [])}
    if p[1] == 'textos':
        return textos.todo()
    if p[1] == 'explorar':
        return explorar(q.get('ruta', ''))
    if p[1] == 'excel':
        return {'hojas': escenarios.hojas_excel(q['ruta'])}
    if p[1] == 'escenarios':
        return {'escenarios': escenarios.listar(os.path.join(TRABAJO, 'escenarios'))}
    if p[1] == 'ajustes':
        return {'convenciones': CONV, 'presets': convenciones.PRESETS}
    if p[1] == 'quinquenio':
        return {'config': quinquenios.normalizar(leer_config().get('quinquenio'))}
    if p[1] == 'scripts':
        if len(p) > 2 and p[2] == 'leer':
            carpeta = EJEMPLOS if q.get('grupo') == 'ejemplos' else MIS_SCRIPTS
            try:
                return {'codigo': guiones.leer(carpeta, q.get('nombre', ''))}
            except (OSError, ValueError):
                raise ErrorApi(404, 'No encuentro ese script.')
        return {'mios': guiones.listar(MIS_SCRIPTS), 'ejemplos': guiones.listar(EJEMPLOS), 'carpeta': MIS_SCRIPTS,
                'referencia': guiones.REFERENCIA}
    if p[1] == 'doc':
        d = doc_de(p)
        if len(p) == 3:
            return d.info()
        if p[3] == 'modelo':
            return {'info': d.info(), 'modelo': modelo_json(d.modelo)}
        if p[3] == 'elemento':
            e = elemento_json(d, q.get('clase', 'nudo'), q.get('id', ''))
            if e is None:
                raise ErrorApi(404, 'No existe ese elemento.')
            return e
        if p[3] == 'escenario':
            return d.esc
        if p[3] == 'datos':
            return datos_json(d.modelo)
        if p[3] == 'camino':
            return camino(d.modelo, q.get('desde', ''), q.get('hasta', ''))
        if p[3] == 'fondo':
            return {'fondo': fondo_de(d.ruta)}
        if p[3] == 'calibracion':
            series = calibracion.cargar(CALIBRACION, d.ruta)
            if len(p) > 4 and p[4] == 'comparar':
                c = CORRIDAS.get(q.get('corrida', ''))
                if c is None:
                    raise ErrorApi(404, 'Esa corrida ya no está en memoria: vuelve a correr el modelo.')
                return calibracion.comparar(series, c['corrida'], q.get('variable', 'presion'))
            return {'resumen': calibracion.resumen(series)}
        if p[3] == 'texto':
            return {'texto': d.texto[:200000], 'largo': len(d.texto)}
    if p[1] == 'trabajo':
        t = estado_trabajo(p[2])
        if t is None:
            raise ErrorApi(404, 'No existe ese trabajo.')
        return t
    if p[1] == 'corrida':
        if p[2] not in CORRIDAS:
            raise ErrorApi(404, 'Esa corrida ya no está en memoria.')
        c = CORRIDAS[p[2]]
        if len(p) == 3 or p[3] == 'resumen':
            return {'id': p[2], 'nombre': c['nombre'], 'cuando': c['cuando'], 'resumen': c['corrida'].resumen,
                    'fase': c['corrida'].fase, 'error': c['corrida'].error}
        if p[3] == 'serie':
            run = c['corrida']
            ids = run.ids_n if q.get('clase') == 'nudo' else run.ids_l
            try:
                k = ids.index(q['id'])
            except ValueError:
                return {'horas': run.horas, 'valores': []}
            return {'horas': run.horas, 'valores': run.serie(q['var'], k, len(ids))}
    if p[1] == 'corridas':
        return {'corridas': [{'id': k, 'nombre': v['nombre'], 'cuando': v['cuando'], 'doc': v['doc'],
                              'fase': v['corrida'].fase} for k, v in CORRIDAS.items()]}
    raise ErrorApi(404, f'No conozco {ruta}')


def api_post(ruta, cuerpo):
    global CONV
    p = ruta.strip('/').split('/')
    if p[1] == 'abrir':
        r = cuerpo['ruta']
        if r.lower().endswith('.json'):
            with open(r, encoding='utf-8') as fh:
                esc = json.load(fh)
            if not os.path.isfile(esc.get('base', '')):
                raise ErrorApi(400, f'El escenario usa un modelo que no encuentro: {esc.get("base")}')
            d = Documento(esc['base'], esc, os.path.abspath(r))
        else:
            if not os.path.isfile(r):
                raise ErrorApi(400, f'No existe {r}')
            d = Documento(r)
        with LOCK:
            DOCS[d.id] = d
        recordar(d.ruta)
        return d.info()
    if p[1] == 'cerrar':
        with LOCK:
            DOCS.pop(cuerpo['id'], None)
        return {'ok': True}
    if p[1] == 'calibracion' and len(p) > 2 and p[2] == 'vista':
        if not os.path.isfile(cuerpo['ruta']):
            raise ErrorApi(400, 'No existe ese archivo.')
        return calibracion.vista(cuerpo['ruta'], cuerpo.get('hoja') or None)
    if p[1] == 'guardar_texto':
        # tablas de los informes (CSV con BOM para que Excel lea bien las tildes)
        r = os.path.abspath(cuerpo['ruta'])
        if not r.lower().endswith(('.csv', '.txt')):
            r += '.csv'
        if os.path.exists(r) and not cuerpo.get('sobrescribir'):
            raise ErrorApi(409, f'Ya existe {os.path.basename(r)}. Elige otro nombre o confirma que lo reemplace.')
        with open(r, 'w', encoding='utf-8-sig', newline='') as fh:
            fh.write(cuerpo['texto'])
        return {'ruta': r}
    if p[1] == 'nuevo':
        r = os.path.abspath(cuerpo['ruta'])
        if not r.lower().endswith('.inp'):
            r += '.inp'
        if os.path.exists(r):
            raise ErrorApi(409, f'Ya existe {os.path.basename(r)}: elige otro nombre (un modelo nuevo nunca reemplaza un archivo).')
        unidades_ = str(cuerpo.get('unidades', 'LPS')).upper()
        formula = str(cuerpo.get('perdidas', 'H-W')).upper()
        if unidades_ not in UNIDADES_CAUDAL or formula not in FORMULAS:
            raise ErrorApi(400, 'Unidades o fórmula de pérdidas desconocidas.')
        titulo = ' '.join(str(cuerpo.get('titulo') or '').split())[:79]
        os.makedirs(os.path.dirname(r), exist_ok=True)
        with open(r, 'w', encoding='latin-1', errors='replace', newline='') as fh:
            fh.write(plantilla(titulo, unidades_, formula))
        d = Documento(r)
        with LOCK:
            DOCS[d.id] = d
        recordar(d.ruta)
        return d.info()
    if p[1] == 'ajustes' and len(p) > 2 and p[2] == 'probar':
        # vista previa: qué grupos sale con estas convenciones en el modelo abierto
        c = convenciones.normalizar(cuerpo.get('convenciones'))
        d = DOCS.get(cuerpo.get('doc', ''))
        if d is None:
            return {'grupos': []}
        gs = escenarios.grupos(d.modelo, c)
        return {'horizontes': [g['nombre'] for g in gs if g['tipo'] == 'horizonte'],
                'proyectos': [g['nombre'] for g in gs if g['tipo'] == 'proyecto'],
                'etiquetas': sum(1 for g in gs if g['tipo'] == 'etiqueta')}
    if p[1] == 'ajustes':
        c = convenciones.normalizar(cuerpo.get('convenciones'))
        cfg = leer_config(); cfg['convenciones'] = c; guardar_config(cfg)
        CONV = c
        with LOCK:
            for d in DOCS.values():
                d.rehacer()
        return {'convenciones': CONV}
    if p[1] == 'quinquenio':
        # la configuración de Armar quinquenio (.scn por año y demanda por año): una para todos los modelos
        c = quinquenios.normalizar(cuerpo.get('config'))
        cfg = leer_config(); cfg['quinquenio'] = c; guardar_config(cfg)
        return {'config': c}
    if p[1] == 'scripts' and len(p) > 2 and p[2] == 'guardar':
        try:
            nombre = guiones.guardar(MIS_SCRIPTS, cuerpo.get('nombre'), str(cuerpo.get('codigo') or ''), bool(cuerpo.get('sobrescribir')))
        except FileExistsError:
            raise ErrorApi(409, f'Ya tienes un script llamado «{guiones.limpiar_nombre(cuerpo.get("nombre"))}». Elige otro nombre o confirma que lo reemplace.')
        except ValueError as ex:
            raise ErrorApi(400, str(ex))
        return {'nombre': nombre}
    if p[1] == 'scripts' and len(p) > 2 and p[2] == 'borrar':
        try:
            os.remove(guiones.ruta_de(MIS_SCRIPTS, cuerpo.get('nombre')))
        except (OSError, ValueError):
            raise ErrorApi(404, 'No encuentro ese script.')
        return {'ok': True}
    if p[1] == 'trabajo' and len(p) > 3 and p[3] == 'cancelar':
        t = TRABAJOS.get(p[2])
        if t and t['obj'] is not None and hasattr(t['obj'], 'cancelar'):
            t['obj'].cancelar()
        return {'ok': True}
    if p[1] == 'corrida' and len(p) > 3 and p[3] == 'olvidar':
        CORRIDAS.pop(p[2], None)
        return {'ok': True}
    if p[1] != 'doc':
        raise ErrorApi(404, f'No conozco {ruta}')
    d = doc_de(p)
    accion = p[3]
    if accion == 'revisar':
        if d.hallazgos is None:
            tol = cuerpo.get('tolerancia')
            d.hallazgos = diagnostico.revisar(d.modelo, float(tol) if tol is not None else None, CONV)
        return {'hallazgos': d.hallazgos}
    if accion == 'correr':
        return {'trabajo': iniciar_corrida(d, cuerpo.get('motor', '2.3'), bool(cuerpo.get('estados', True)),
                                           bool(cuerpo.get('calidad', True)))}
    if accion == 'comparar':
        if cuerpo.get('otro') in DOCS:
            otro = DOCS[cuerpo['otro']].modelo
            nombre = DOCS[cuerpo['otro']].nombre + ' · ' + DOCS[cuerpo['otro']].esc.get('nombre', '')
        else:
            otro = inp.leer(cuerpo['ruta'])
            nombre = os.path.basename(cuerpo['ruta'])
        ref, nuevo = (otro, d.modelo) if cuerpo.get('sentido', 'otro_es_referencia') == 'otro_es_referencia' else (d.modelo, otro)
        r = comparar.comparar(ref, nuevo)
        # geometría de lo que no está en el modelo abierto, para dibujarlo como fantasma
        fant = {'nudos': [], 'tramos': []}
        for n in (r['nudos_quitados'] if ref is otro else r['nudos_nuevos']):
            if n in otro.coords:
                fant['nudos'].append([n, *otro.coords[n]])
        for l in (r['tramos_quitados'] if ref is otro else r['tramos_nuevos']):
            if l in otro.tramos:
                fant['tramos'].append([l, otro.trazado(l)])
        r['fantasmas'] = fant
        r['nombre_otro'] = nombre
        r['referencia'] = 'otro' if ref is otro else 'abierto'
        return r
    if accion == 'consignas':
        return consignas.analizar(d.texto, cuerpo.get('motor', '2.3'), float(cuerpo.get('margen', 0.05)))
    if accion == 'escenario':
        esc = cuerpo['escenario']
        esc['base'] = d.ruta
        d.esc = esc
        d.rehacer()
        return d.info()
    if accion == 'editar':
        op = dict(cuerpo['op'])
        e = inp.Editor(d.base, CONV)
        for o in d.esc.get('ediciones', []):
            try:
                e.aplicar(o)
            except inp.ErrorEdicion:
                pass
        try:
            res = e.aplicar(op)
        except (inp.ErrorEdicion, ValueError, TypeError, KeyError) as ex:
            raise ErrorApi(400, str(ex))
        # los IDs que se generaron quedan escritos en la operación: rehacerla da lo mismo
        if isinstance(res, str) and op['op'] in ('nudo', 'tanque', 'embalse', 'tuberia', 'valvula', 'bomba_nueva', 'insertar'):
            op['id'] = res
        elif isinstance(res, tuple) and op['op'] == 'partir':
            op['id_nudo'], op['id_nuevo'] = res
        validar = op['op'] in ('patron', 'curva', 'controles', 'reglas', 'opcion', 'dato')
        antes = d.validez() if validar else None
        d.esc.setdefault('ediciones', []).append(op)
        d.rehacer()
        if validar:
            # solo se rechaza si el cambio trae errores nuevos (un modelo a medio armar puede tener otros)
            ok, errores = d.validez()
            clave = lambda t: re.sub(r'\d+', '#', t)
            nuevos = [t for t in errores if clave(t) not in {clave(x) for x in antes[1]}]
            if not ok and nuevos:
                d.esc['ediciones'].pop()
                d.rehacer()
                raise ErrorApi(400, 'EPANET no aceptaría este cambio:\n' + '\n'.join(nuevos[:8]))
        return {'info': d.info(), 'resultado': res, 'avisos': e.avisos}
    if accion == 'script':
        codigo = str(cuerpo.get('codigo') or '')
        if not codigo.strip():
            raise ErrorApi(400, 'El script está vacío.')
        return {'trabajo': iniciar_script(d, codigo)}
    if accion == 'script_aplicar':
        # los cambios del script que ya corrió, como UNA edición (se toman del trabajo, no de la interfaz)
        t = TRABAJOS.get(cuerpo.get('trabajo', ''))
        if not t or t['tipo'] != 'script' or t['doc'] != d.id or t['fase'] != 'lista':
            raise ErrorApi(404, 'Ese resultado ya no está: vuelve a correr el script.')
        r = t['resultado']
        if r.get('error'):
            raise ErrorApi(400, 'El script terminó con error: no hay cambios que aplicar.')
        if not r.get('ops'):
            raise ErrorApi(400, 'El script no cambió nada.')
        if r['version_doc'] != d.version:
            raise ErrorApi(409, 'El modelo cambió desde que corriste el script. Córrelo otra vez para aplicarlo sobre lo que hay ahora.')
        op = {'op': 'script', 'nombre': str(cuerpo.get('nombre') or 'sin nombre')[:80], 'codigo': r['codigo'], 'ops': r['ops']}
        e = inp.Editor(d.base, CONV)
        for o in d.esc.get('ediciones', []):
            try:
                e.aplicar(o)
            except inp.ErrorEdicion:
                pass
        try:
            e.aplicar(op)
        except inp.ErrorEdicion as ex:
            raise ErrorApi(400, str(ex))
        antes = d.validez()
        d.esc.setdefault('ediciones', []).append(op)
        d.rehacer()
        ok, errores = d.validez()
        clave = lambda x: re.sub(r'\d+', '#', x)
        nuevos = [x for x in errores if clave(x) not in {clave(y) for y in antes[1]}]
        if not ok and nuevos and not cuerpo.get('forzar'):
            d.esc['ediciones'].pop()
            d.rehacer()
            return {'ok': False, 'errores': nuevos[:12]}
        return {'ok': True, 'info': d.info(), 'avisos': e.avisos, 'cambios': len(r['ops']), 'errores': nuevos[:12]}
    if accion == 'scn':
        # escenario de EPANET (.scn): sin «aplicar» devuelve lo que haría; con «aplicar» queda como UNA edición.
        # «omitir» = aplicar sin los elementos que no están en el modelo (o no son del tipo que toca).
        r = os.path.abspath(str(cuerpo.get('ruta') or ''))
        if not r.lower().endswith('.scn') or not os.path.isfile(r):
            raise ErrorApi(400, 'Elige un escenario de EPANET (.scn).')
        try:
            datos = scn.leer_archivo(r)
        except ValueError as ex:
            raise ErrorApi(400, str(ex))
        malos = inp.Editor(d.modelo, CONV).revisar_scn(datos['secciones'])
        if not cuerpo.get('aplicar'):
            return {'resumen': scn.resumen(d.modelo, datos, malos)}
        secciones = datos['secciones']
        if malos:
            if not cuerpo.get('omitir'):
                raise ErrorApi(400, f'{len(malos)} elementos del escenario no sirven en este modelo.')
            secciones = scn.quitar(secciones, malos)
        if not secciones:
            raise ErrorApi(400, 'El escenario no trae nada que Cauce sepa aplicar.')
        op = {'op': 'scn', 'nombre': os.path.basename(r), 'ruta': r, 'notas': datos['notas'], 'secciones': secciones}
        e = inp.Editor(d.base, CONV)
        for o in d.esc.get('ediciones', []):
            try:
                e.aplicar(o)
            except inp.ErrorEdicion:
                pass
        try:
            hechos = e.aplicar(op)
        except (inp.ErrorEdicion, ValueError) as ex:
            raise ErrorApi(400, str(ex))
        antes = d.validez()
        d.esc.setdefault('ediciones', []).append(op)
        d.rehacer()
        ok, errores = d.validez()
        clave = lambda x: re.sub(r'\d+', '#', x)
        nuevos = [x for x in errores if clave(x) not in {clave(y) for y in antes[1]}]
        if not ok and nuevos and not cuerpo.get('forzar'):
            d.esc['ediciones'].pop()
            d.rehacer()
            return {'ok': False, 'errores': nuevos[:12]}
        return {'ok': True, 'info': d.info(), 'avisos': e.avisos, 'hechos': hechos, 'omitidos': len(malos),
                'errores': nuevos[:12]}
    if accion == 'deshacer':
        if d.esc.get('ediciones'):
            d.esc['ediciones'].pop()
            d.rehacer()
        return d.info()
    if accion == 'quinquenio':
        # sin «armar» devuelve lo que haría; con «armar» reemplaza el escenario del modelo por el del quinquenio
        try:
            anio = int(cuerpo['anio'])
        except (KeyError, TypeError, ValueError):
            raise ErrorApi(400, 'Elige el año del quinquenio.')
        if not 1900 < anio < 2200:
            raise ErrorApi(400, 'Elige un año entre 1900 y 2200.')
        try:
            esc, resumen = quinquenios.armar(d.base, anio, leer_config().get('quinquenio'), CONV,
                                             quinquenios.nombre_valido(cuerpo.get('nombre')) or None)
        except ImportError:
            raise ErrorApi(400, 'Para leer la demanda del Excel hace falta openpyxl (pip install openpyxl).')
        if not cuerpo.get('armar'):
            return {'resumen': resumen}
        d.esc = esc
        d.archivo = None                # es otro escenario: Ctrl+S lo guarda con su nombre, no encima del anterior
        d.rehacer()
        return {'resumen': resumen, 'info': d.info()}
    if accion == 'proyecto':
        if cuerpo['accion'] == 'base':
            d.esc.setdefault('proyectos', {}).pop(cuerpo['clave'], None)
        else:
            d.esc.setdefault('proyectos', {})[cuerpo['clave']] = cuerpo['accion']
        d.rehacer()
        return d.info()
    if accion == 'importar':
        filas, malos = escenarios.leer_tabla(cuerpo['ruta'], cuerpo['hoja'], int(cuerpo['fila']), int(cuerpo['col_id']),
                                             int(cuerpo['col_valor']), int(cuerpo['col_patron']) if cuerpo.get('col_patron') else None)
        r = escenarios.importar(d.esc, d.base, filas, cuerpo['destino'])
        r['no_numericos'] = malos
        d.rehacer()
        return {'info': d.info(), 'importado': r}
    if accion == 'guardar_escenario':
        nombre = (cuerpo.get('nombre') or d.esc.get('nombre') or '').strip()
        if not nombre:
            raise ErrorApi(400, 'Ponle un nombre al escenario.')
        carpeta = os.path.join(TRABAJO, 'escenarios')
        # con el mismo nombre va al mismo archivo, esté donde esté; con otro, a la carpeta de escenarios
        if d.archivo and nombre == d.esc.get('nombre'):
            destino = d.archivo
        else:
            destino = escenarios.ruta_para(nombre, carpeta)
            otro = os.path.normcase(destino) != os.path.normcase(d.archivo or '')
            if os.path.exists(destino) and otro and not cuerpo.get('sobrescribir'):
                raise ErrorApi(409, f'Ya hay un escenario guardado con el nombre «{nombre}». Elige otro o confirma que lo reemplace.')
        d.esc['nombre'] = nombre
        r = escenarios.guardar(d.esc, carpeta, destino)
        d.archivo = r
        d.marcar_guardado()
        return {'ruta': r, 'info': d.info()}
    if accion == 'calibracion':
        series = calibracion.cargar(CALIBRACION, d.ruta)
        if cuerpo.get('accion') == 'borrar':
            v = cuerpo.get('variable')
            series = [s for s in series if v and s['variable'] != v]
            calibracion.guardar(CALIBRACION, d.ruta, series)
            return {'resumen': calibracion.resumen(series)}
        v = cuerpo['variable']
        if v not in calibracion.VARIABLES:
            raise ErrorApi(400, f'Variable desconocida: {v}')
        ruta = cuerpo['ruta']
        malas = 0
        if os.path.splitext(ruta)[1].lower() in ('.dat', '.txt') and cuerpo.get('formato', 'dat') == 'dat':
            nuevas = calibracion.leer_dat(ruta)
        else:
            nuevas, malas = calibracion.importar_tabla(ruta, cuerpo.get('hoja') or None, cuerpo.get('formato', 'largo'),
                                                       int(cuerpo.get('fila', 2)), int(cuerpo.get('col_id', 1)),
                                                       int(cuerpo.get('col_hora', 2)), int(cuerpo.get('col_valor', 3)),
                                                       int(cuerpo.get('col_desde', 2)))
        if not nuevas:
            raise ErrorApi(400, 'No encontré mediciones con esas columnas.')
        clase = calibracion.VARIABLES[v][1]
        existen = d.modelo.nudos if clase == 'nudo' else d.modelo.tramos
        faltan = [i for i in nuevas if i not in existen]
        series = calibracion.agregar(series, v, nuevas, os.path.basename(ruta))
        calibracion.guardar(CALIBRACION, d.ruta, series)
        return {'resumen': calibracion.resumen(series), 'importadas': {'puntos': len(nuevas), 'mediciones': sum(len(x) for x in nuevas.values())},
                'no_encontrados': faltan, 'malas': malas}
    if accion == 'fondo':
        # imagen de fondo del mapa, guardada por modelo en trabajo/config.json (None = quitarla)
        cfg = leer_config()
        fondos = cfg.setdefault('fondos', {})
        f = cuerpo.get('fondo')
        if f:
            if os.path.splitext(f['ruta'])[1].lower() not in IMAGENES or not os.path.isfile(f['ruta']):
                raise ErrorApi(400, 'La imagen no existe o no es PNG, JPG, BMP, GIF o WEBP.')
            fondos[os.path.normcase(d.ruta)] = {k: f[k] for k in ('ruta', 'x0', 'y0', 'x1', 'y1', 'opacidad') if k in f}
        else:
            fondos.pop(os.path.normcase(d.ruta), None)
        guardar_config(cfg)
        return {'fondo': fondo_de(d.ruta)}
    if accion == 'guardar_inp':
        # solo los modelos creados en Cauce. Las ediciones siguen como capa sobre lo que había al abrirlo, así que
        # Ctrl+Z sigue funcionando después de guardar; el archivo queda con todo aplicado. No se exige que EPANET lo
        # pueda correr (un modelo a medio armar también se guarda), pero se avisa.
        if not d.propio:
            raise ErrorApi(400, 'Este modelo no se creó en Cauce: su archivo no se sobrescribe. Exporta con otro nombre o guarda el escenario.')
        with open(d.ruta, 'w', encoding='latin-1', errors='replace', newline='') as fh:
            fh.write(d.texto)
        recordar(d.ruta)
        d.marcar_guardado()
        ok, errores = motor.validar(d.texto, '2.2')
        return {'ok': True, 'ruta': d.ruta, 'valido': ok, 'errores': errores, 'info': d.info()}
    if accion == 'exportar':
        destino = os.path.abspath(cuerpo['ruta'])
        if not destino.lower().endswith('.inp'):
            destino += '.inp'
        if os.path.normcase(destino) == os.path.normcase(d.ruta):
            raise ErrorApi(400, 'No sobrescribo el archivo base: exporta con otro nombre.')
        if os.path.exists(destino) and not cuerpo.get('sobrescribir'):
            raise ErrorApi(409, f'Ya existe {os.path.basename(destino)}. Elige otro nombre o confirma que lo reemplace.')
        ok, errores = motor.validar(d.texto, '2.2')
        if not ok and not cuerpo.get('forzar'):
            return {'ok': False, 'errores': errores}
        with open(destino, 'w', encoding='latin-1', errors='replace', newline='') as fh:
            fh.write(d.texto)
        recordar(destino)
        d.marcar_guardado()             # los cambios quedaron en el .inp exportado
        return {'ok': True, 'ruta': destino, 'valido': ok, 'errores': errores, 'info': d.info()}
    raise ErrorApi(404, f'No conozco {ruta}')


# ====================================================================== servidor HTTP
TIPOS = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
         '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json'}


class Manejador(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _json(self, obj, codigo=200):
        try:
            cuerpo = json.dumps(obj, ensure_ascii=False, allow_nan=False, default=_por_defecto).encode('utf-8')
        except ValueError:      # NaN o infinito en algún número: el navegador no los acepta
            cuerpo = json.dumps(_limpiar(obj), ensure_ascii=False, allow_nan=False, default=_por_defecto).encode('utf-8')
        self.send_response(codigo)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(cuerpo)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(cuerpo)

    def _error(self, codigo, msg):
        self._json({'error': msg}, codigo)

    def _ajeno(self, post=False):
        # Solo se atiende a la propia ventana de Cauce. Una página de internet abierta en el navegador podría mandar
        # pedidos a 127.0.0.1 (y desde que hay scripts, eso sería correr código en este PC):
        #  - Host distinto: un dominio que apunta a 127.0.0.1 (DNS rebinding)
        #  - Origin distinto: un pedido desde otra página
        #  - POST sin JSON: los formularios y fetch "simples" de otros sitios no pueden mandar application/json sin
        #    pedir permiso antes (OPTIONS), y este servidor no lo da
        propios = {f'127.0.0.1:{PUERTO}', f'localhost:{PUERTO}', f'[::1]:{PUERTO}'}
        if (self.headers.get('Host') or '').lower() not in propios:
            return True
        origen = (self.headers.get('Origin') or '').lower()
        if origen and origen not in {f'http://{x}' for x in propios}:
            return True
        return post and not (self.headers.get('Content-Type') or '').lower().startswith('application/json')

    def do_GET(self):
        if self._ajeno():
            return self._error(403, 'Cauce solo atiende pedidos de su propia ventana.')
        ULTIMO_PEDIDO[0] = time.time()
        u = urllib.parse.urlparse(self.path)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
        try:
            if u.path.startswith('/api/corrida/') and '/var/' in u.path:
                partes = u.path.strip('/').split('/')
                d = DOCS.get(q.get('doc', ''))
                if partes[2] not in CORRIDAS or d is None:
                    return self._error(404, 'Corrida o modelo no disponible.')
                T, M, datos = resultados_ordenados(partes[2], partes[4], d)
                self.send_response(200)
                self.send_header('Content-Type', 'application/octet-stream')
                self.send_header('Content-Length', str(len(datos)))
                self.send_header('X-Forma', f'{T},{M}')
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                self.wfile.write(datos)
                return
            if u.path == '/api/imagen':
                # la imagen de fondo del mapa: solo archivos de imagen
                r = q.get('ruta', '')
                tipo = IMAGENES.get(os.path.splitext(r)[1].lower())
                if not tipo or not os.path.isfile(r):
                    return self._error(404, 'No encuentro esa imagen.')
                with open(r, 'rb') as fh:
                    datos = fh.read()
                self.send_response(200)
                self.send_header('Content-Type', tipo)
                self.send_header('Content-Length', str(len(datos)))
                self.end_headers()
                self.wfile.write(datos)
                return
            if u.path.startswith('/api/'):
                return self._json(api_get(u.path, q))
            return self._estatico(u.path)
        except ErrorApi as ex:
            self._error(ex.codigo, str(ex))
        except Exception as ex:
            traceback.print_exc()
            self._error(500, f'{type(ex).__name__}: {ex}')

    def do_POST(self):
        if self._ajeno(post=True):
            return self._error(403, 'Cauce solo atiende pedidos de su propia ventana.')
        ULTIMO_PEDIDO[0] = time.time()
        u = urllib.parse.urlparse(self.path)
        try:
            n = int(self.headers.get('Content-Length', 0))
            cuerpo = json.loads(self.rfile.read(n).decode('utf-8') or '{}')
            return self._json(api_post(u.path, cuerpo))
        except ErrorApi as ex:
            self._error(ex.codigo, str(ex))
        except Exception as ex:
            traceback.print_exc()
            self._error(500, f'{type(ex).__name__}: {ex}')

    def _estatico(self, ruta):
        if ruta in ('', '/'):
            ruta = '/index.html'
        f = os.path.normpath(os.path.join(WEB, ruta.lstrip('/')))
        if not f.startswith(WEB) or not os.path.isfile(f):
            return self._error(404, 'No existe.')
        with open(f, 'rb') as fh:
            datos = fh.read()
        self.send_response(200)
        self.send_header('Content-Type', TIPOS.get(os.path.splitext(f)[1], 'application/octet-stream'))
        self.send_header('Content-Length', str(len(datos)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(datos)


def _por_defecto(o):
    if isinstance(o, (set, tuple)):
        return list(o)
    return str(o)


def _limpiar(o):
    if isinstance(o, float):
        return o if o == o and abs(o) != float('inf') else None
    if isinstance(o, dict):
        return {k: _limpiar(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_limpiar(v) for v in o]
    return o


class Servidor(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    global CONV
    if '--sin-actualizar' not in sys.argv:
        # desde "Iniciar Cauce.bat" (el acceso directo actualiza en lanzar.pyw y llama con --sin-actualizar)
        r = actualizar.actualizar(RAIZ)
        if r['estado'] == 'actualizado':
            print(f'Cauce se actualizó de {r["local"]} a {r["remota"]}; arrancando la versión nueva...', flush=True)
            os.execv(sys.executable, [sys.executable, '-I', os.path.abspath(__file__), *sys.argv[1:], '--sin-actualizar'])
        elif r['estado'] == 'error':
            print(f'No se pudo buscar actualizaciones ({r["motivo"]}); abro la versión {r["local"]}.', flush=True)
    CONV = leer_convenciones()
    sin_nav = '--sin-navegador' in sys.argv
    os.makedirs(os.path.join(TRABAJO, 'escenarios'), exist_ok=True)
    srv = Servidor((HOST, PUERTO), Manejador)
    url = f'http://{HOST}:{PUERTO}/'
    print(f'Cauce {VERSION} en {url}  (Ctrl+C para cerrar)', flush=True)
    if not sin_nav:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    if '--auto-apagar' in sys.argv:
        # la interfaz avisa cada 20 s que sigue abierta; sin avisos por 90 s y sin corridas en curso, se apaga
        def vigilar():
            while True:
                time.sleep(10)
                ocupado = any(t['fase'] == 'en curso' for t in list(TRABAJOS.values()))
                if not ocupado and time.time() - ULTIMO_PEDIDO[0] > 90:
                    srv.shutdown()
                    return
        threading.Thread(target=vigilar, daemon=True).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
