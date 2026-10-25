"""Lectura y edición de archivos .inp de EPANET sin perder nada de lo que no se toca.

Modelo(texto) parte el archivo en secciones y arma nudos, tramos, etiquetas, patrones, curvas, controles y reglas,
recordando en qué línea está cada cosa. Editor(modelo) acumula cambios (cambiar un campo, agregar o quitar líneas)
y texto() devuelve el archivo con solo esas líneas cambiadas: lo demás queda byte a byte igual, que es lo que
hace falta para que EPANET 2.2 lo abra como el original. Los .inp de EPANET en Windows van en latin-1.
"""
import math
import re
from collections import OrderedDict

from . import convenciones

SEC_NUDOS = ('[JUNCTIONS]', '[RESERVOIRS]', '[TANKS]')
SEC_TRAMOS = ('[PIPES]', '[PUMPS]', '[VALVES]')
TIPO_NUDO = {'[JUNCTIONS]': 'junction', '[RESERVOIRS]': 'reservoir', '[TANKS]': 'tank'}
TIPO_TRAMO = {'[PIPES]': 'pipe', '[PUMPS]': 'pump', '[VALVES]': 'valve'}

# claves de [OPTIONS], [TIMES] y [REPORT] que llevan espacios: se buscan antes que la primera palabra sola
CLAVES_LARGAS = ['SPECIFIC GRAVITY', 'DEMAND MULTIPLIER', 'EMITTER EXPONENT', 'DEMAND MODEL', 'MINIMUM PRESSURE',
                 'REQUIRED PRESSURE', 'PRESSURE EXPONENT', 'BACKFLOW ALLOWED', 'HYDRAULIC TIMESTEP',
                 'QUALITY TIMESTEP', 'RULE TIMESTEP', 'PATTERN TIMESTEP', 'PATTERN START', 'REPORT TIMESTEP',
                 'REPORT START', 'START CLOCKTIME', 'GLOBAL EFFICIENCY', 'GLOBAL PRICE', 'GLOBAL PATTERN',
                 'DEMAND CHARGE', 'ORDER BULK', 'ORDER WALL', 'ORDER TANK', 'GLOBAL BULK', 'GLOBAL WALL',
                 'LIMITING POTENTIAL', 'ROUGHNESS CORRELATION']
# secciones con una línea por elemento que se editan con op_dato (la clave es el ID, o palabra + ID)
SECCIONES_DATO = ('[QUALITY]', '[SOURCES]', '[EMITTERS]', '[MIXING]', '[REACTIONS]', '[ENERGY]')
TIPOS_CURVA = ('PUMP', 'EFFICIENCY', 'VOLUME', 'HEADLOSS')

_TOKEN = re.compile(r'\S+')


def campos(linea):
    return linea.split(';', 1)[0].split()


def comentario(linea):
    return linea.split(';', 1)[1].strip() if ';' in linea else ''


def num(x, defecto=0.0):
    try:
        return float(x)
    except (TypeError, ValueError):
        return defecto


def reemplazar_campo(linea, k, valor):
    """La línea con el campo k (contando desde 0, antes del ';') cambiado por valor, sin tocar el resto."""
    datos, sep, com = linea.partition(';')
    tok = list(_TOKEN.finditer(datos))
    valor = str(valor)
    if k < len(tok):
        a, b = tok[k].span()
        ancho = b - a
        # conserva el ancho de la columna si cabe, para que el archivo siga alineado
        resto = datos[b:]
        valor_p = valor + ' ' * (ancho - len(valor)) if len(valor) < ancho else valor
        datos = datos[:a] + valor_p + resto
    else:
        relleno = '\t' if '\t' in datos else ' '
        base = datos.rstrip()
        faltan = k - len(tok)
        datos = base + (relleno + '*') * faltan + relleno + valor + datos[len(base):]
    return datos + sep + com


def fmt(x):
    """Número con pocos decimales, como lo escribiría EPANET."""
    if isinstance(x, str):
        return x
    if float(x).is_integer() and abs(x) < 1e12:
        return str(int(x))
    s = f'{x:.6f}'.rstrip('0').rstrip('.')
    return s


class Modelo:
    def __init__(self, texto, ruta=''):
        self.ruta = ruta
        partes = texto.split('\n')
        # cada línea guarda su propio final (hay programas que guardan el .inp con finales mezclados)
        self.finales = ['\r\n' if p.endswith('\r') else '\n' for p in partes[:-1]] + ['']
        self.lineas = [p[:-1] if p.endswith('\r') else p for p in partes]
        self.nl = '\r\n' if self.finales.count('\r\n') * 2 >= len(self.finales) else '\n'
        self.sec = OrderedDict()          # sección -> [(línea, campos)]
        self.cab = OrderedDict()          # sección -> [líneas de encabezado]  (puede repetirse)
        s = None
        for i, raw in enumerate(self.lineas):
            t = raw.strip()
            if t.startswith('['):
                s = t.split(']')[0].upper() + ']'
                self.sec.setdefault(s, [])
                self.cab.setdefault(s, []).append(i)
                continue
            if s is None or not t or t.startswith(';'):
                continue
            f = campos(raw)
            if f:
                self.sec[s].append((i, f))
        self._armar()

    # ------------------------------------------------------------------ armado
    def filas(self, s):
        return [f for _, f in self.sec.get(s, [])]

    def _armar(self):
        self.nudos = OrderedDict()
        self.tramos = OrderedDict()
        self.duplicados = []
        for s in SEC_NUDOS:
            for i, f in self.sec.get(s, []):
                d = {'tipo': TIPO_NUDO[s], 'linea': i, 'com': comentario(self.lineas[i])}
                if s == '[JUNCTIONS]':
                    d.update(cota=num(f[1] if len(f) > 1 else 0), dem=num(f[2] if len(f) > 2 else 0),
                             pat=f[3] if len(f) > 3 else '')
                elif s == '[RESERVOIRS]':
                    d.update(cota=num(f[1] if len(f) > 1 else 0), pat=f[2] if len(f) > 2 else '')
                else:
                    d.update(cota=num(f[1] if len(f) > 1 else 0), nini=num(f[2] if len(f) > 2 else 0),
                             nmin=num(f[3] if len(f) > 3 else 0), nmax=num(f[4] if len(f) > 4 else 0),
                             diam=num(f[5] if len(f) > 5 else 0), vmin=num(f[6] if len(f) > 6 else 0),
                             curva=(f[7] if len(f) > 7 and f[7] != '*' else ''),
                             rebose=(f[8].upper() if len(f) > 8 else ''))
                if f[0] in self.nudos:
                    self.duplicados.append(('nudo', f[0]))
                self.nudos[f[0]] = d
        for s in SEC_TRAMOS:
            for i, f in self.sec.get(s, []):
                d = {'tipo': TIPO_TRAMO[s], 'n1': f[1] if len(f) > 1 else '', 'n2': f[2] if len(f) > 2 else '',
                     'linea': i, 'com': comentario(self.lineas[i])}
                if s == '[PIPES]':
                    d.update(lon=num(f[3] if len(f) > 3 else 0), diam=num(f[4] if len(f) > 4 else 0),
                             rug=num(f[5] if len(f) > 5 else 0), km=num(f[6] if len(f) > 6 else 0),
                             estado_col=(f[7].upper() if len(f) > 7 else 'OPEN'))
                    d['vt'] = 'CV' if d['estado_col'] == 'CV' else 'PIPE'
                elif s == '[PUMPS]':
                    p = f[3:]
                    par = {}
                    for k in range(0, len(p) - 1, 2):
                        par[p[k].upper()] = p[k + 1]
                    d.update(params=par, vt='PUMP')
                else:
                    d.update(diam=num(f[3] if len(f) > 3 else 0), vt=(f[4].upper() if len(f) > 4 else 'TCV'),
                             consigna=(f[5] if len(f) > 5 else '0'), km=num(f[6] if len(f) > 6 else 0))
                if f[0] in self.tramos:
                    self.duplicados.append(('tramo', f[0]))
                self.tramos[f[0]] = d
        self.estado = OrderedDict()                 # [STATUS]: id -> (línea, valor)
        for i, f in self.sec.get('[STATUS]', []):
            if len(f) > 1:
                self.estado[f[0]] = (i, f[1])
        self.coords = {}
        for i, f in self.sec.get('[COORDINATES]', []):
            if len(f) > 2:
                self.coords[f[0]] = (num(f[1]), num(f[2]))
        self.vertices = {}
        for i, f in self.sec.get('[VERTICES]', []):
            if len(f) > 2:
                self.vertices.setdefault(f[0], []).append((num(f[1]), num(f[2])))
        self.tags = {}
        for i, f in self.sec.get('[TAGS]', []):
            if len(f) > 2:
                self.tags[('nudo' if f[0].upper() == 'NODE' else 'tramo', f[1])] = f[2]
        self.patrones = OrderedDict()
        for i, f in self.sec.get('[PATTERNS]', []):
            self.patrones.setdefault(f[0], []).extend(num(x) for x in f[1:])
        self.curvas = OrderedDict()
        for i, f in self.sec.get('[CURVES]', []):
            if len(f) > 2:
                self.curvas.setdefault(f[0], []).append((num(f[1]), num(f[2])))
        self.demandas = {}
        for i, f in self.sec.get('[DEMANDS]', []):
            if len(f) > 1:
                self.demandas.setdefault(f[0], []).append((num(f[1]), f[2] if len(f) > 2 else ''))
        self.controles = [(i, self.lineas[i].split(';', 1)[0].strip()) for i, f in self.sec.get('[CONTROLS]', [])]
        self.reglas = OrderedDict()                 # nombre -> {'lineas': [índices], 'texto': [...]}
        actual = None
        for i, f in self.sec.get('[RULES]', []):
            if f[0].upper() == 'RULE' and len(f) > 1:
                nombre = f[1]
                if nombre in self.reglas:
                    nombre = f'{nombre} (repetida {i})'
                actual = self.reglas.setdefault(nombre, {'lineas': [], 'texto': []})
            if actual is not None:
                actual['lineas'].append(i)
                actual['texto'].append(self.lineas[i].split(';', 1)[0].strip())
        # tipo de cada curva: el comentario ";PUMP:" (o EFFICIENCY, VOLUME, HEADLOSS) que EPANET escribe antes
        self.tipo_curva = {}
        for i, f in self.sec.get('[CURVES]', []):
            if f[0] in self.tipo_curva:
                continue
            j = i - 1
            while j >= 0 and self.lineas[j].strip().startswith(';'):
                m = re.match(r';\s*(PUMP|EFFICIENCY|VOLUME|HEADLOSS)\s*:', self.lineas[j].strip(), re.I)
                if m:
                    self.tipo_curva[f[0]] = m.group(1).upper()
                    break
                j -= 1
        # calidad del agua y energía por elemento
        self.calidad_ini = {f[0]: f[1] for _, f in self.sec.get('[QUALITY]', []) if len(f) > 1}
        self.fuentes = {f[0]: f[1:] for _, f in self.sec.get('[SOURCES]', []) if len(f) > 2}
        self.emisores = {f[0]: f[1] for _, f in self.sec.get('[EMITTERS]', []) if len(f) > 1}
        self.mezcla = {f[0]: f[1:] for _, f in self.sec.get('[MIXING]', []) if len(f) > 1}
        self.reacciones = {(f[0].upper(), f[1]): f[2] for _, f in self.sec.get('[REACTIONS]', [])
                           if len(f) > 2 and f[0].upper() in ('BULK', 'WALL', 'TANK')}
        self.energia_bomba = {(f[1], f[2].upper()): f[3] for _, f in self.sec.get('[ENERGY]', [])
                              if len(f) > 3 and f[0].upper() == 'PUMP'}
        self.rotulos = []
        for i, f in self.sec.get('[LABELS]', []):
            m = re.match(r'\s*(\S+)\s+(\S+)\s+"([^"]*)"', self.lineas[i])
            if m:
                self.rotulos.append((num(m.group(1)), num(m.group(2)), m.group(3)))

    # ------------------------------------------------------------------ consultas
    def opciones(self, s='[OPTIONS]'):
        o = OrderedDict()
        for i, f in self.sec.get(s, []):
            t = self.lineas[i].split(';', 1)[0].strip()
            k = clave_opcion(t)
            o[k] = t[len(k):].strip()
        return o

    def estado_inicial(self, lid):
        """OPEN, CLOSED, CV o la consigna, como queda al empezar la simulación."""
        d = self.tramos[lid]
        e = self.estado.get(lid)
        if e is not None:
            v = e[1].upper()
            return v if v in ('OPEN', 'CLOSED', 'ACTIVE') else e[1]
        if d['tipo'] == 'pipe':
            return 'CLOSED' if d['estado_col'] == 'CLOSED' else ('CV' if d['estado_col'] == 'CV' else 'OPEN')
        return 'OPEN' if d['tipo'] == 'pump' else 'ACTIVE'

    def cerrado_al_inicio(self, lid):
        return self.estado_inicial(lid) == 'CLOSED'

    def tag(self, tipo, ident):
        return self.tags.get((tipo, ident), '')

    def adyacencia(self, solo_abiertos=False):
        ady = {n: [] for n in self.nudos}
        for l, d in self.tramos.items():
            if solo_abiertos and self.cerrado_al_inicio(l):
                continue
            if d['n1'] in ady and d['n2'] in ady:
                ady[d['n1']].append((d['n2'], l))
                ady[d['n2']].append((d['n1'], l))
        return ady

    def trazado(self, lid):
        d = self.tramos[lid]
        pts = []
        if d['n1'] in self.coords:
            pts.append(self.coords[d['n1']])
        pts += self.vertices.get(lid, [])
        if d['n2'] in self.coords:
            pts.append(self.coords[d['n2']])
        return pts

    def referencias(self, ident):
        """Controles y reglas que nombran a un elemento."""
        pat = re.compile(r'(?<![\w.-])' + re.escape(ident) + r'(?![\w.-])')
        ctl = [t for _, t in self.controles if pat.search(t)]
        reg = [n for n, r in self.reglas.items() if any(pat.search(x) for x in r['texto'][1:])]
        return ctl, reg


def clave_opcion(texto):
    up = texto.upper()
    for k in CLAVES_LARGAS:
        if up.startswith(k) and (len(up) == len(k) or up[len(k)] in ' \t'):
            return texto[:len(k)].upper()
    return texto.split()[0].upper() if texto.split() else ''


def leer(ruta):
    with open(ruta, encoding='latin-1', newline='') as fh:
        return Modelo(fh.read(), ruta)


# ====================================================================== edición
CAMPOS = {   # campo editable -> (sección, índice del campo en la línea)
    'junction': {'cota': 1, 'dem': 2, 'pat': 3},
    'reservoir': {'cota': 1, 'pat': 2},
    'tank': {'cota': 1, 'nini': 2, 'nmin': 3, 'nmax': 4, 'diam': 5, 'vmin': 6, 'curva': 7},
    'pipe': {'lon': 3, 'diam': 4, 'rug': 5, 'km': 6},
    'valve': {'diam': 3, 'vt': 4, 'consigna': 5, 'km': 6},
}
SEC_DE = {'junction': '[JUNCTIONS]', 'reservoir': '[RESERVOIRS]', 'tank': '[TANKS]',
          'pipe': '[PIPES]', 'pump': '[PUMPS]', 'valve': '[VALVES]'}


class ErrorEdicion(Exception):
    pass


class Editor:
    """Cambios sobre un Modelo. Las líneas nuevas van al final de su sección; las borradas desaparecen."""

    def __init__(self, modelo, conv=None):
        self.m = modelo
        self.conv = convenciones.normalizar(conv)
        self.pref = self.conv['prefijos']
        self.mod = {}                 # índice de línea -> texto nuevo (None = borrar)
        self.nuevas = OrderedDict()   # sección -> [texto]
        self.nuevo_nudo = OrderedDict()    # id -> dict como en Modelo.nudos (+ 'x', 'y')
        self.nuevo_tramo = OrderedDict()   # id -> dict (+ 'verts')
        self.borrados = set()              # ('nudo'|'tramo', id)
        self.coords = {}                   # id -> (x, y) de nudos movidos o nuevos
        self.estados = {}                  # id -> valor de [STATUS] ('' = quitar la línea)
        self.tramo_mod = {}                # id de un tramo del archivo -> su dict ya editado (reconectado, partido)
        self.tag_pos = {}                  # ('NODE'|'LINK', id) -> posición de la etiqueta agregada
        self.dato_pos = {}                 # llave de un patrón, curva, sección o línea de dato -> dónde quedó
        self.patrones = OrderedDict(modelo.patrones)     # cómo van quedando con las ediciones
        self.curvas = OrderedDict(modelo.curvas)
        self.avisos = []

    # ---------------------------------------------------------------- utilidades
    def linea(self, i):
        return self.mod.get(i, self.m.lineas[i])

    def cambiar_linea(self, i, texto):
        self.mod[i] = texto

    def agregar(self, seccion, texto):
        self.nuevas.setdefault(seccion, []).append(texto)
        return (seccion, len(self.nuevas[seccion]) - 1)

    def existe_nudo(self, n):
        return (n in self.m.nudos and ('nudo', n) not in self.borrados) or n in self.nuevo_nudo

    def existe_tramo(self, l):
        return (l in self.m.tramos and ('tramo', l) not in self.borrados) or l in self.nuevo_tramo

    def nudo(self, n):
        if n in self.nuevo_nudo:
            return self.nuevo_nudo[n]
        if n in self.m.nudos and ('nudo', n) not in self.borrados:
            return self.m.nudos[n]
        raise ErrorEdicion(f'No existe el nudo {n}')

    def tramo(self, l):
        if l in self.nuevo_tramo:
            return self.nuevo_tramo[l]
        if l in self.m.tramos and ('tramo', l) not in self.borrados:
            return self.tramo_mod.get(l, self.m.tramos[l])
        raise ErrorEdicion(f'No existe el tramo {l}')

    def xy(self, n):
        if n in self.coords:
            return self.coords[n]
        if n in self.m.coords:
            return self.m.coords[n]
        raise ErrorEdicion(f'El nudo {n} no tiene coordenadas')

    def trazado(self, l):
        d = self.tramo(l)
        verts = d['verts'] if 'verts' in d else self.m.vertices.get(l, [])
        return [self.xy(d['n1'])] + list(verts) + [self.xy(d['n2'])]

    def id_libre(self, prefijo, nudo=True):
        usados = set(self.m.nudos) | set(self.nuevo_nudo) if nudo else set(self.m.tramos) | set(self.nuevo_tramo)
        k = 1
        patron = re.compile(re.escape(prefijo) + r'(\d+)$')
        for u in usados:
            mm = patron.match(u)
            if mm:
                k = max(k, int(mm.group(1)) + 1)
        while f'{prefijo}{k}' in usados:
            k += 1
        return f'{prefijo}{k}'

    def _cambiar_campo(self, tipo_sec, ident, k, valor):
        """Cambia un campo de la línea del elemento (existente o nuevo)."""
        if ident in self.nuevo_nudo or ident in self.nuevo_tramo:
            d = self.nuevo_nudo.get(ident) or self.nuevo_tramo.get(ident)
            sec, j = d['_pos']
            self.nuevas[sec][j] = reemplazar_campo(self.nuevas[sec][j], k, valor)
            return
        d = self.m.nudos.get(ident) if tipo_sec in ('junction', 'reservoir', 'tank') else self.m.tramos.get(ident)
        if d is None:
            raise ErrorEdicion(f'No existe {ident}')
        self.cambiar_linea(d['linea'], reemplazar_campo(self.linea(d['linea']), k, valor))

    # ---------------------------------------------------------------- operaciones
    def aplicar(self, op):
        f = getattr(self, 'op_' + op['op'], None)
        if f is None:
            raise ErrorEdicion(f'Operación desconocida: {op["op"]}')
        args = {k: v for k, v in op.items() if k != 'op'}
        return f(**args)

    def op_estado(self, id, valor):
        """[STATUS] de un tramo: OPEN, CLOSED, una consigna, o '' para quitar la línea (vuelve a lo del archivo)."""
        if not self.existe_tramo(id):
            raise ErrorEdicion(f'No existe el tramo {id}')
        valor = str(valor).strip()
        if valor.upper() in ('OPEN', 'CLOSED'):
            valor = valor.upper()
        self.estados[id] = valor

    def op_propiedad(self, tipo, id, campo, valor):
        """Cambia un campo simple de un nudo o tramo (cota, demanda, diámetro, consigna...)."""
        d = self.nudo(id) if tipo == 'nudo' else self.tramo(id)
        t = d['tipo']
        if t == 'pump':
            return self.op_bomba(id, **{campo: valor})
        if campo == 'estado':
            return self.op_estado(id, valor)
        if campo == 'tag':
            return self.op_etiqueta(tipo, id, valor)
        k = CAMPOS.get(t, {}).get(campo)
        if k is None:
            raise ErrorEdicion(f'El campo {campo} no se puede editar en un {t}')
        if campo in ('pat', 'curva', 'vt'):
            v = str(valor).strip() or ('' if campo == 'pat' else '*')
            if campo == 'vt':
                v = v.upper()
                if v not in ('PRV', 'PSV', 'PBV', 'FCV', 'TCV', 'GPV'):
                    raise ErrorEdicion(f'Tipo de válvula desconocido: {v}')
            elif campo == 'pat' and v and v not in self.patrones:
                raise ErrorEdicion(f'El patrón "{v}" no existe en el modelo')
            elif campo == 'curva' and v not in ('', '*') and v not in self.curvas:
                raise ErrorEdicion(f'La curva "{v}" no existe en el modelo')
        else:
            v = fmt(float(valor))
        if campo == 'dem' and id in self.m.demandas and id not in self.nuevo_nudo:
            # [DEMANDS] manda sobre la demanda de [JUNCTIONS]: se deja una sola demanda allí
            self._quitar_de_seccion('[DEMANDS]', 0, id)
            self.agregar('[DEMANDS]', f' {id:<16}\t{v:<12}\t{d.get("pat", "")}')
        self._cambiar_campo(t, id, k, v)
        if id in self.nuevo_nudo:
            self.nuevo_nudo[id][campo] = v if campo in ('pat', 'curva') else float(v)
        elif id in self.nuevo_tramo:
            self.nuevo_tramo[id][campo] = v if campo in ('vt', 'consigna') else float(v)

    def op_bomba(self, id, curva=None, potencia=None, velocidad=None, patron=None):
        d = self.tramo(id)
        if d['tipo'] != 'pump':
            raise ErrorEdicion(f'{id} no es una bomba')
        par = dict(d.get('params', {}))
        if curva is not None:
            par.pop('POWER', None)
            if curva:
                par['HEAD'] = curva
        if potencia is not None:
            par.pop('HEAD', None)
            par['POWER'] = fmt(float(potencia))
        if velocidad is not None:
            par['SPEED'] = fmt(float(velocidad))
        if patron is not None:
            if patron:
                par['PATTERN'] = patron
            else:
                par.pop('PATTERN', None)
        texto = f' {id:<16}\t{d["n1"]:<16}\t{d["n2"]:<16}\t' + '\t'.join(f'{k} {v}' for k, v in par.items()) + '\t;'
        if id in self.nuevo_tramo:
            sec, j = d['_pos']
            self.nuevas[sec][j] = texto
            d['params'] = par
        else:
            com = comentario(self.linea(d['linea']))
            self.cambiar_linea(d['linea'], texto + com)

    def op_etiqueta(self, tipo, id, valor):
        clave = 'NODE' if tipo == 'nudo' else 'LINK'
        if (clave, id) in self.tag_pos:
            sec, j = self.tag_pos[(clave, id)]
            self.nuevas[sec][j] = f' {clave:<6}\t{id:<16}\t{valor}' if valor else None
            return
        for i, f in self.m.sec.get('[TAGS]', []):
            if len(f) > 1 and f[0].upper() == clave and f[1] == id and self.mod.get(i, '') is not None:
                self.cambiar_linea(i, f' {clave:<6}\t{id:<16}\t{valor}' if valor else None)
                return
        if valor:
            self.tag_pos[(clave, id)] = self.agregar('[TAGS]', f' {clave:<6}\t{id:<16}\t{valor}')

    def op_multiplicador(self, valor):
        self.op_opcion('[OPTIONS]', 'DEMAND MULTIPLIER', fmt(float(valor)))

    def op_opcion(self, seccion, clave, valor):
        clave = clave.upper()
        for i, f in self.m.sec.get(seccion, []):
            t = self.linea(i)
            if t is None:
                continue
            if clave_opcion(t.split(';', 1)[0].strip()) == clave:
                if valor in ('', None):
                    self.cambiar_linea(i, None)
                else:
                    self.cambiar_linea(i, f' {clave:<20}\t{valor}')
                return
        if valor not in ('', None):
            self.agregar(seccion, f' {clave:<20}\t{valor}')

    # ---------------------------------------------------------------- patrones, curvas, controles, reglas, datos
    def _poner_lineas(self, seccion, llave, coincide, lineas, origen=None):
        # Reemplaza en su sitio las líneas del archivo que cumplen `coincide` (la primera recibe las nuevas, las
        # demás se quitan) o, si no hay, las agrega al final de la sección. lineas None = quitarlas. La llave
        # recuerda lo agregado para que una segunda edición de lo mismo en la misma pasada no lo duplique.
        # origen = esas líneas ya buscadas (op_scn las busca todas de una vez).
        if origen is None:
            origen = [i for i, f in self.m.sec.get(seccion, []) if coincide(f)]
        for i in origen:
            self.cambiar_linea(i, None)
        previo = self.dato_pos.pop(llave, None)
        if isinstance(previo, list):
            for s, j in previo:
                self.nuevas[s][j] = None
        if lineas is None:
            return
        if origen:
            self.cambiar_linea(origen[0], self.m.nl.join(lineas))
            self.dato_pos[llave] = 'archivo'
        else:
            self.dato_pos[llave] = [self.agregar(seccion, t) for t in lineas]

    @staticmethod
    def _id_valido(id, que):
        id = str(id).strip()
        if not id or re.search(r'[\s;"]', id) or len(id) > 31:
            raise ErrorEdicion(f'El ID {que} no puede estar vacío, tener espacios, ";" ni comillas, ni pasar de 31 letras')
        return id

    def usos(self, clase, ident):
        # Quién usa un patrón o una curva (para no borrar algo que el modelo necesita)
        m = Modelo(self.texto())
        out = []
        if clase == 'patron':
            out += [n for n, d in m.nudos.items() if d.get('pat') == ident]
            out += [f'{n} (demanda)' for n, ds in m.demandas.items() if any(p == ident for _, p in ds)]
            out += [l for l, d in m.tramos.items() if d.get('params', {}).get('PATTERN') == ident]
            out += [f'{n} (fuente)' for n, f in m.fuentes.items() if len(f) > 2 and f[2] == ident]
            out += [f'{b} (precio)' for (b, k), v in m.energia_bomba.items() if k == 'PATTERN' and v == ident]
            if (m.opciones().get('PATTERN') or '').strip() == ident:
                out.append('patrón por defecto de [OPTIONS]')
            if (m.opciones('[ENERGY]').get('GLOBAL PATTERN') or '').strip() == ident:
                out.append('patrón de precio de [ENERGY]')
        else:
            out += [l for l, d in m.tramos.items() if d.get('params', {}).get('HEAD') == ident]
            out += [n for n, d in m.nudos.items() if d.get('curva') == ident]
            out += [l for l, d in m.tramos.items() if d['tipo'] == 'valve' and d.get('vt') == 'GPV' and d.get('consigna') == ident]
            out += [f'{b} (eficiencia)' for (b, k), v in m.energia_bomba.items() if k == 'EFFIC' and v == ident]
        return out

    def op_patron(self, id, valores=None):
        # Crea o cambia un patrón (valores = multiplicadores por periodo) o lo borra (valores = None)
        id = self._id_valido(id, 'del patrón')
        if valores is None:
            if id not in self.patrones:
                raise ErrorEdicion(f'No existe el patrón {id}')
            u = self.usos('patron', id)
            if u:
                raise ErrorEdicion(f'No se puede borrar el patrón {id}: lo usan {", ".join(u[:6])}{"…" if len(u) > 6 else ""}')
            self._poner_lineas('[PATTERNS]', ('patron', id), lambda f: f[0] == id, None)
            del self.patrones[id]
            return id
        vals = [float(v) for v in valores]
        if not vals:
            raise ErrorEdicion('Un patrón necesita al menos un multiplicador')
        lineas = [f' {id:<16}\t' + '\t'.join(f'{fmt(v):<12}' for v in vals[k:k + 6]) for k in range(0, len(vals), 6)]
        self._poner_lineas('[PATTERNS]', ('patron', id), lambda f: f[0] == id, lineas)
        self.patrones[id] = vals
        return id

    def op_curva(self, id, puntos=None, tipo='PUMP'):
        # Crea o cambia una curva (puntos = [[x, y], ...] con x creciente) o la borra (puntos = None)
        id = self._id_valido(id, 'de la curva')
        if puntos is None:
            if id not in self.curvas:
                raise ErrorEdicion(f'No existe la curva {id}')
            u = self.usos('curva', id)
            if u:
                raise ErrorEdicion(f'No se puede borrar la curva {id}: la usan {", ".join(u[:6])}{"…" if len(u) > 6 else ""}')
            self._poner_lineas('[CURVES]', ('curva', id), lambda f: f[0] == id, None)
            del self.curvas[id]
            return id
        pts = [(float(x), float(y)) for x, y in puntos]
        if not pts:
            raise ErrorEdicion('Una curva necesita al menos un punto')
        if any(b[0] <= a[0] for a, b in zip(pts, pts[1:])):
            raise ErrorEdicion('Los valores de X de la curva tienen que ir creciendo')
        tipo = str(tipo or 'PUMP').upper()
        if tipo not in TIPOS_CURVA:
            raise ErrorEdicion(f'Tipo de curva desconocido: {tipo}')
        lineas = [f' {id:<16}\t{fmt(x):<12}\t{fmt(y):<12}' for x, y in pts]
        if id not in self.m.curvas:
            lineas.insert(0, f';{tipo}:')     # el tipo, como lo escribe EPANET, para las curvas nuevas
        self._poner_lineas('[CURVES]', ('curva', id), lambda f: f[0] == id, lineas)
        self.curvas[id] = pts
        return id

    def _reemplazar_seccion(self, seccion, lineas):
        # Todo el contenido de una sección (datos y comentarios) por estas líneas
        for cab in self.m.cab.get(seccion, []):
            i = cab + 1
            while i < len(self.m.lineas) and not self.m.lineas[i].strip().startswith('['):
                if self.m.lineas[i].strip():
                    self.cambiar_linea(i, None)
                i += 1
        previo = self.dato_pos.pop(('seccion', seccion), None)
        for s, j in previo or []:
            self.nuevas[s][j] = None
        self.dato_pos[('seccion', seccion)] = [self.agregar(seccion, t) for t in lineas]

    def op_controles(self, lineas):
        # [CONTROLS] completa: una línea por control
        self._reemplazar_seccion('[CONTROLS]', [' ' + str(t).strip() for t in lineas if str(t).strip()])

    def op_reglas(self, texto):
        # [RULES] completa, como texto (RULE ... IF ... THEN ... PRIORITY ...)
        lineas = [t.rstrip() for t in str(texto).replace('\r\n', '\n').split('\n')]
        while lineas and not lineas[-1].strip():
            lineas.pop()
        self._reemplazar_seccion('[RULES]', lineas)

    def op_dato(self, seccion, clave, valores=None):
        # Una línea de [QUALITY], [SOURCES], [EMITTERS], [MIXING], [REACTIONS] o [ENERGY] identificada por su
        # clave: el ID, o palabra + ID ("BULK P1", "PUMP B1 PRICE"). valores None o vacío = quitar la línea.
        seccion = str(seccion).upper()
        if seccion not in SECCIONES_DATO:
            raise ErrorEdicion(f'No se editan líneas sueltas de {seccion}')
        clave = [str(c).strip() for c in (clave if isinstance(clave, (list, tuple)) else [clave])]
        cu = [c.upper() for c in clave]
        k = len(cu)
        vals = [str(v).strip() for v in (valores if isinstance(valores, (list, tuple)) else [valores])
                if v is not None and str(v).strip() != ''] if valores not in (None, '') else []
        lineas = [' ' + '\t'.join([f'{clave[0]:<16}'] + clave[1:] + vals)] if vals else None
        self._poner_lineas(seccion, ('dato', seccion) + tuple(cu), lambda f: [x.upper() for x in f[:k]] == cu, lineas)

    def op_rotulo(self, x, y, texto):
        # Un rótulo nuevo en [LABELS]
        texto = str(texto).replace('"', "'").strip()
        if not texto:
            raise ErrorEdicion('El rótulo está vacío')
        self.agregar('[LABELS]', f' {float(x):<16.2f}\t{float(y):<16.2f}\t"{texto}"')

    def op_rotulos(self, lista):
        # Todos los rótulos: [[x, y, texto], ...]
        self._reemplazar_seccion('[LABELS]', [f' {float(x):<16.2f}\t{float(y):<16.2f}\t"{str(t).replace(chr(34), chr(39)).strip()}"'
                                              for x, y, t in lista if str(t).strip()])

    def op_grupo(self, tipo, ids, campo, accion, valor):
        # La misma propiedad para muchos elementos: fijar un valor, multiplicar o sumar
        n = 0
        for id in ids:
            if campo == 'estado':
                self.op_estado(id, valor)
            elif accion == 'fijar':
                self.op_propiedad(tipo, id, campo, valor)
            else:
                actual = (self.nudo(id) if tipo == 'nudo' else self.tramo(id)).get(campo)
                if not isinstance(actual, (int, float)):
                    continue
                nuevo = actual * float(valor) if accion == 'multiplicar' else actual + float(valor)
                self.op_propiedad(tipo, id, campo, nuevo)
            n += 1
        return n

    def op_script(self, ops, nombre='', codigo=''):
        """Los cambios de un script del panel Scripts, como una sola edición (Ctrl+Z la deshace entera). Trae las op
        ya con sus IDs, así que se aplican sin volver a correr el script; el código queda solo de referencia."""
        for k, o in enumerate(ops):
            if o.get('op') == 'script':
                raise ErrorEdicion('Un script no puede traer otro script adentro')
            try:
                self.aplicar(o)
            except (ErrorEdicion, ValueError, TypeError, KeyError) as ex:
                raise ErrorEdicion(f'cambio {k + 1} del script «{nombre}» ({o.get("op")}): {ex}') from None

    def op_varias(self, ops, nombre=''):
        """Varias op como una sola edición (Mover con coordenadas: posición y cota de una vez)."""
        for o in ops:
            if o.get('op') in ('varias', 'script', 'scn'):
                raise ErrorEdicion('Una edición compuesta no puede traer otra adentro')
            self.aplicar(o)

    # ---------------------------------------------------------------- escenarios de EPANET (.scn)
    def revisar_scn(self, secciones):
        """Lo que un escenario de EPANET (nucleo/scn.py) nombra y no sirve en este modelo: [(sección, id, motivo)].
        Como el importador de EPANET: diámetros, rugosidades y reacciones Bulk/Wall solo van a tuberías, demandas
        solo a nudos de consumo, calidad inicial a cualquier nudo y la reacción Tank a tanques."""
        malos = OrderedDict()

        def tipo_tramo(l):
            return self.tramo(l)['tipo'] if self.existe_tramo(l) else None

        def tipo_nudo(n):
            return self.nudo(n)['tipo'] if self.existe_nudo(n) else None

        def revisar(sec, ident, tipo, quiere, nombre):
            if tipo is None:
                malos.setdefault((sec, ident), 'no existe')
            elif quiere and tipo not in quiere:
                malos.setdefault((sec, ident), f'no es {nombre}')
        for sec in ('DIAMETERS', 'ROUGHNESS'):
            for l, _ in secciones.get(sec, []):
                revisar(sec, l, tipo_tramo(l), ('pipe',), 'una tubería')
        for n, _, pat, _ in secciones.get('DEMANDS', []):
            revisar('DEMANDS', n, tipo_nudo(n), ('junction',), 'un nudo de consumo')
            if pat and pat not in self.patrones:
                malos.setdefault(('DEMANDS', n), f'el patrón {pat} no existe')
        for n, _ in secciones.get('QUALITY', []):
            revisar('QUALITY', n, tipo_nudo(n), None, '')
        for t, x, _ in secciones.get('REACTIONS', []):
            if t.upper() == 'TANK':
                revisar('REACTIONS', x, tipo_nudo(x), ('tank',), 'un tanque')
            else:
                revisar('REACTIONS', x, tipo_tramo(x), ('pipe',), 'una tubería')
        return [(s, i, m) for (s, i), m in malos.items()]

    def op_scn(self, secciones, nombre='', notas='', ruta=''):
        """Un escenario de EPANET (.scn, File > Import > Scenario) como una sola edición: Ctrl+Z lo quita entero.
        Trae lo ya leído (nucleo/scn.py), no la ruta: rehacer el escenario no depende de que el archivo siga ahí.
        Si algún elemento no existe o no es del tipo que toca, no se aplica nada. Devuelve cuántos por sección."""
        malos = self.revisar_scn(secciones)
        if malos:
            raise ErrorEdicion(f'El escenario «{nombre}» nombra {len(malos)} elementos que no sirven en este modelo: '
                               + ', '.join(f'{i} ({m})' for _, i, m in malos[:8]) + ('…' if len(malos) > 8 else ''))
        hechos = OrderedDict()
        for sec, campo in (('DIAMETERS', 'diam'), ('ROUGHNESS', 'rug')):
            for l, v in secciones.get(sec, []):
                v = str(v).strip()
                float(v)
                # el valor tal como viene en el .scn, como hace EPANET
                self._cambiar_campo('pipe', l, CAMPOS['pipe'][campo], v)
                for d in (self.nuevo_tramo.get(l), self.tramo_mod.get(l)):
                    if d is not None:
                        d[campo] = float(v)
            if sec in secciones:
                hechos[sec] = len({l for l, _ in secciones[sec]})
        if secciones.get('DEMANDS'):
            por_nudo = OrderedDict()
            for n, q, pat, cat in secciones['DEMANDS']:
                float(q)
                por_nudo.setdefault(n, []).append((str(q).strip(), str(pat or '').strip(), str(cat or '').strip()))
            for n, filas in por_nudo.items():
                self._demandas_scn(n, filas)
            hechos['DEMANDS'] = len(por_nudo)
        for sec, seccion, k in (('QUALITY', '[QUALITY]', 1), ('REACTIONS', '[REACTIONS]', 2)):
            if not secciones.get(sec):
                continue
            # las líneas que ya hay, buscadas una sola vez (op_dato relee la sección en cada cambio)
            hay = {}
            for i, f in self.m.sec.get(seccion, []):
                if len(f) >= k:
                    hay.setdefault(tuple(x.upper() for x in f[:k]), []).append(i)
            claves = set()
            for fila in secciones[sec]:
                clave, v = [str(x).strip() for x in fila[:k]], str(fila[k]).strip()
                float(v)
                cu = tuple(x.upper() for x in clave)
                claves.add(cu)
                self._poner_lineas(seccion, ('dato', seccion) + cu, None,
                                   [' ' + '\t'.join([f'{clave[0]:<16}'] + clave[1:] + [v])], origen=hay.get(cu, []))
            hechos[sec] = len(claves)
        if 'CONTROLS' in secciones:
            self.op_controles(secciones['CONTROLS'])
            hechos['CONTROLS'] = sum(1 for t in secciones['CONTROLS'] if t.strip() and not t.strip().startswith(';'))
        if 'RULES' in secciones:
            self.op_reglas('\n'.join(secciones['RULES']))
            hechos['RULES'] = sum(1 for t in secciones['RULES'] if campos(t)[:1] and campos(t)[0].upper() == 'RULE')
        return hechos

    def _demandas_scn(self, n, filas):
        # Como el importador de EPANET: las demandas del nudo se reemplazan por las del .scn. La primera va a
        # [JUNCTIONS] (sin patrón deja el que tenía); con varias categorías van todas a [DEMANDS], que en EPANET 2.2
        # manda sobre la de [JUNCTIONS] (input3.c, demanddata).
        q, pat, _ = filas[0]
        self._cambiar_campo('junction', n, CAMPOS['junction']['dem'], q)
        if pat:
            self._cambiar_campo('junction', n, CAMPOS['junction']['pat'], pat)
        if n in self.nuevo_nudo:
            self.nuevo_nudo[n]['dem'] = float(q)
            if pat:
                self.nuevo_nudo[n]['pat'] = pat
        self._quitar_de_seccion('[DEMANDS]', 0, n)
        previas = self.nuevas.get('[DEMANDS]', [])
        for j, t in enumerate(previas):
            if t is not None and campos(t)[:1] == [n]:
                previas[j] = None
        if len(filas) > 1:
            for q, pat, cat in filas:
                self.agregar('[DEMANDS]', f' {n:<16}\t{q:<12}\t{pat:<16}' + (f'\t;{cat}' if cat else ''))

    def op_mover(self, id, x, y, longitud=False):
        self.nudo(id)
        self.coords[id] = (float(x), float(y))
        if id in self.nuevo_nudo:
            self.nuevo_nudo[id]['x'], self.nuevo_nudo[id]['y'] = float(x), float(y)
        if longitud:
            self._ajustar_longitudes(id)

    def op_nudo(self, x, y, cota=None, dem=0.0, pat='', id=None, tag=''):
        id = id or self.id_libre(self.pref['nudo'])
        if self.existe_nudo(id):
            raise ErrorEdicion(f'Ya existe el nudo {id}')
        if cota is None:
            cota = self.cota_cercana(float(x), float(y))
        pos = self.agregar('[JUNCTIONS]', f' {id:<16}\t{fmt(float(cota)):<12}\t{fmt(float(dem)):<12}\t{pat:<16}\t;')
        self.nuevo_nudo[id] = {'tipo': 'junction', 'cota': float(cota), 'dem': float(dem), 'pat': pat, 'com': '',
                               'x': float(x), 'y': float(y), '_pos': pos}
        self.coords[id] = (float(x), float(y))
        if tag:
            self.op_etiqueta('nudo', id, tag)
        return id

    def op_tanque(self, x, y, cota, nini, nmin, nmax, diam, id=None, vmin=0.0, tag='', com=''):
        id = id or self.id_libre(self.pref['tanque'])
        if self.existe_nudo(id):
            raise ErrorEdicion(f'Ya existe el nudo {id}')
        pos = self.agregar('[TANKS]', f' {id:<16}\t{fmt(float(cota)):<12}\t{fmt(float(nini)):<12}\t{fmt(float(nmin)):<12}\t'
                                      f'{fmt(float(nmax)):<12}\t{fmt(float(diam)):<12}\t{fmt(float(vmin)):<12}\t{"":<16}\t;{com}')
        self.nuevo_nudo[id] = {'tipo': 'tank', 'cota': float(cota), 'nini': float(nini), 'nmin': float(nmin),
                               'nmax': float(nmax), 'diam': float(diam), 'vmin': float(vmin), 'curva': '', 'com': com,
                               'x': float(x), 'y': float(y), '_pos': pos}
        self.coords[id] = (float(x), float(y))
        if tag:
            self.op_etiqueta('nudo', id, tag)
        return id

    def op_embalse(self, x, y, cota, id=None, pat='', tag='', com=''):
        id = id or self.id_libre(self.pref['embalse'])
        if self.existe_nudo(id):
            raise ErrorEdicion(f'Ya existe el nudo {id}')
        pos = self.agregar('[RESERVOIRS]', f' {id:<16}\t{fmt(float(cota)):<12}\t{pat:<16}\t;{com}')
        self.nuevo_nudo[id] = {'tipo': 'reservoir', 'cota': float(cota), 'pat': pat, 'com': com,
                               'x': float(x), 'y': float(y), '_pos': pos}
        self.coords[id] = (float(x), float(y))
        if tag:
            self.op_etiqueta('nudo', id, tag)
        return id

    def _linea_tubo(self, id, n1, n2, lon, diam, rug, km=0.0, estado='OPEN', com=''):
        return (f' {id:<16}\t{n1:<16}\t{n2:<16}\t{fmt(float(lon)):<12}\t{fmt(float(diam)):<12}\t'
                f'{fmt(float(rug)):<12}\t{fmt(float(km)):<12}\t{estado:<6}\t;{com}')

    def op_tuberia(self, n1, n2, diam, rug, lon=None, km=0.0, id=None, verts=None, estado='OPEN', tag='', com=''):
        id = id or self.id_libre(self.pref['tuberia'], nudo=False)
        if self.existe_tramo(id):
            raise ErrorEdicion(f'Ya existe el tramo {id}')
        if n1 == n2:
            raise ErrorEdicion('Una tubería necesita dos nudos distintos')
        self.nudo(n1); self.nudo(n2)
        verts = [tuple(map(float, v)) for v in (verts or [])]
        if lon is None:
            pts = [self.xy(n1)] + verts + [self.xy(n2)]
            lon = max(0.1, sum(math.dist(a, b) for a, b in zip(pts, pts[1:])))
        pos = self.agregar('[PIPES]', self._linea_tubo(id, n1, n2, lon, diam, rug, km, estado, com))
        self.nuevo_tramo[id] = {'tipo': 'pipe', 'vt': 'CV' if estado == 'CV' else 'PIPE', 'n1': n1, 'n2': n2,
                                'lon': float(lon), 'diam': float(diam), 'rug': float(rug), 'km': float(km),
                                'estado_col': estado, 'verts': verts, 'com': com, '_pos': pos}
        if tag:
            self.op_etiqueta('tramo', id, tag)
        return id

    def op_valvula(self, n1, n2, vt, diam, consigna, km=0.0, id=None, tag='', com=''):
        id = id or self.id_libre(self.pref['valvula'], nudo=False)
        if self.existe_tramo(id):
            raise ErrorEdicion(f'Ya existe el tramo {id}')
        self.nudo(n1); self.nudo(n2)
        vt = vt.upper()
        pos = self.agregar('[VALVES]', f' {id:<16}\t{n1:<16}\t{n2:<16}\t{fmt(float(diam)):<12}\t{vt:<4}\t'
                                       f'{fmt(consigna) if not isinstance(consigna, str) else consigna:<12}\t{fmt(float(km)):<12}\t;{com}')
        self.nuevo_tramo[id] = {'tipo': 'valve', 'vt': vt, 'n1': n1, 'n2': n2, 'diam': float(diam),
                                'consigna': str(consigna), 'km': float(km), 'verts': [], 'com': com, '_pos': pos}
        if tag:
            self.op_etiqueta('tramo', id, tag)
        return id

    def op_bomba_nueva(self, n1, n2, curva='', potencia=None, id=None, tag='', com=''):
        id = id or self.id_libre(self.pref['bomba'], nudo=False)
        if self.existe_tramo(id):
            raise ErrorEdicion(f'Ya existe el tramo {id}')
        self.nudo(n1); self.nudo(n2)
        par = {'HEAD': curva} if curva else {'POWER': fmt(float(potencia or 0))}
        if not curva and not potencia:
            raise ErrorEdicion('La bomba necesita una curva o una potencia')
        pos = self.agregar('[PUMPS]', f' {id:<16}\t{n1:<16}\t{n2:<16}\t' + '\t'.join(f'{k} {v}' for k, v in par.items()) + f'\t;{com}')
        self.nuevo_tramo[id] = {'tipo': 'pump', 'vt': 'PUMP', 'n1': n1, 'n2': n2, 'params': par, 'verts': [],
                                'com': com, '_pos': pos}
        if tag:
            self.op_etiqueta('tramo', id, tag)
        return id

    def punto_en_tramo(self, l, x, y):
        """Proyección de (x, y) sobre el trazado: (punto, fracción de longitud, índice del segmento)."""
        pts = self.trazado(l)
        largos = [math.dist(a, b) for a, b in zip(pts, pts[1:])]
        total = sum(largos) or 1.0
        mejor = (float('inf'), None, 0, 0)
        acum = 0.0
        for k, ((ax, ay), (bx, by)) in enumerate(zip(pts, pts[1:])):
            dx, dy = bx - ax, by - ay
            L2 = dx * dx + dy * dy
            u = 0.0 if L2 == 0 else max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / L2))
            px, py = ax + u * dx, ay + u * dy
            dd = math.hypot(x - px, y - py)
            if dd < mejor[0]:
                mejor = (dd, (px, py), (acum + u * largos[k]) / total, k)
            acum += largos[k]
        return mejor[1], min(0.999, max(0.001, mejor[2])), mejor[3], pts

    def op_partir(self, tramo, x, y, id_nudo=None, id_nuevo=None):
        """Parte una tubería en (x, y): el tramo original va de n1 al nudo nuevo y uno nuevo del nudo a n2."""
        d = self.tramo(tramo)
        if d['tipo'] != 'pipe':
            raise ErrorEdicion('Solo se pueden partir tuberías')
        p, frac, k, pts = self.punto_en_tramo(tramo, float(x), float(y))
        c1, c2 = self.nudo(d['n1'])['cota'], self.nudo(d['n2'])['cota']
        cota = c1 + (c2 - c1) * frac if not (c1 == 0 or c2 == 0) else (c1 or c2)
        tag = self.m.tag('tramo', tramo) if tramo in self.m.tramos else ''
        nid = self.op_nudo(p[0], p[1], cota=round(cota, 3), id=id_nudo or self.id_libre(self.pref['nudo']), tag='')
        id_nuevo = id_nuevo or self._sufijo_libre(tramo)
        lon = d['lon']
        n2 = d['n2']
        verts_a, verts_b = list(pts[1:k + 1]), list(pts[k + 1:-1])
        estado = self.estado_texto(tramo)
        # el original termina en el nudo nuevo
        self._reconectar(tramo, n1=None, n2=nid, lon=lon * frac, verts=verts_a)
        self.op_tuberia(nid, n2, d['diam'], d['rug'], lon=lon * (1 - frac), km=0.0, id=id_nuevo, verts=verts_b,
                        estado='CV' if d.get('estado_col') == 'CV' else 'OPEN', tag=tag)
        if estado == 'CLOSED':
            self.op_estado(id_nuevo, 'CLOSED')
        return nid, id_nuevo

    def _sufijo_libre(self, base):
        k = 2
        while self.existe_tramo(f'{base}_{k}'):
            k += 1
        return f'{base}_{k}'

    def estado_texto(self, l):
        if l in self.estados:
            return self.estados[l].upper() or ('OPEN' if l not in self.m.tramos else self.m.estado_inicial(l))
        if l in self.m.tramos:
            return self.m.estado_inicial(l)
        return 'OPEN'

    def _reconectar(self, l, n1=None, n2=None, lon=None, verts=None):
        d = self.tramo(l)
        if l in self.nuevo_tramo:
            sec, j = d['_pos']
            if n1:
                d['n1'] = n1; self.nuevas[sec][j] = reemplazar_campo(self.nuevas[sec][j], 1, n1)
            if n2:
                d['n2'] = n2; self.nuevas[sec][j] = reemplazar_campo(self.nuevas[sec][j], 2, n2)
            if lon is not None:
                d['lon'] = lon; self.nuevas[sec][j] = reemplazar_campo(self.nuevas[sec][j], 3, fmt(round(lon, 4)))
            if verts is not None:
                d['verts'] = verts
            return
        i = d['linea']
        t = self.linea(i)
        if n1:
            t = reemplazar_campo(t, 1, n1)
        if n2:
            t = reemplazar_campo(t, 2, n2)
        if lon is not None and d['tipo'] == 'pipe':
            t = reemplazar_campo(t, 3, fmt(round(lon, 4)))
        self.cambiar_linea(i, t)
        # el dict del modelo base no se toca: la versión editada va aparte, con sus vértices propios
        nd = dict(d)
        nd.setdefault('verts', list(self.m.vertices.get(l, [])))
        if n1:
            nd['n1'] = n1
        if n2:
            nd['n2'] = n2
        if lon is not None:
            nd['lon'] = lon
        if verts is not None:
            nd['verts'] = verts
            nd['verts_cambiados'] = True
        self.tramo_mod[l] = nd

    def op_insertar(self, tramo, x, y, clase, vt='TCV', diam=None, consigna=0, curva='', potencia=None, id=None):
        """Mete una válvula o bomba en una tubería, con dos nudos a 1 m (sufijos de Ajustes: _Up/_Dw, _Suc/_Dis...)."""
        d = self.tramo(tramo)
        if d['tipo'] != 'pipe':
            raise ErrorEdicion('Solo se puede insertar en tuberías')
        clase = clase.lower()
        id = id or self.id_libre(self.pref['valvula'] if clase == 'valvula' else self.pref['bomba'], nudo=False)
        if self.existe_tramo(id):
            raise ErrorEdicion(f'Ya existe el tramo {id}')
        a, b = self.conv['sufijos_valvula'] if clase == 'valvula' else self.conv['sufijos_bomba']
        p, frac, k, pts = self.punto_en_tramo(tramo, float(x), float(y))
        # dirección del segmento para separar los dos nudos 1 m
        (ax, ay), (bx, by) = pts[k], pts[k + 1]
        L = math.hypot(bx - ax, by - ay) or 1.0
        ux, uy = (bx - ax) / L, (by - ay) / L
        n_a, n_b = self.op_partir(tramo, p[0] - ux * 0.5, p[1] - uy * 0.5, id_nudo=id + a)
        # el tramo nuevo (n_a -> n2) se vuelve a partir 1 m más allá para dejar el hueco de la válvula o bomba
        nb_nudo, resto = self.op_partir(n_b, p[0] + ux * 0.5, p[1] + uy * 0.5, id_nudo=id + b)
        # el pedacito entre los dos nudos (n_b) se cambia por la válvula o bomba
        self.op_borrar('tramo', n_b, silencioso=True)
        diam = diam or d['diam']
        if clase == 'valvula':
            self.op_valvula(id + a, id + b, vt, diam, consigna, id=id)
        else:
            self.op_bomba_nueva(id + a, id + b, curva=curva, potencia=potencia, id=id)
        return id

    def _ajustar_longitudes(self, nudo):
        """Las tuberías que tocan `nudo` toman la longitud de su trazado (Longitud automática, como el Auto-Length de
        EPANET). Supone las coordenadas en las mismas unidades que las longitudes: por eso es opcional."""
        for l in list(self.todos_tramos()):
            d = self.tramo(l)
            if d['tipo'] != 'pipe' or nudo not in (d['n1'], d['n2']):
                continue
            pts = self.trazado(l)
            largo = sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))
            if largo > 0:
                self.op_propiedad('tramo', l, 'lon', round(largo, 3))

    def op_unir(self, nudo, destino, longitud=False):
        """Pasa todos los tramos de `nudo` a `destino` y borra `nudo` (para puntas que debían quedar conectadas)."""
        if nudo == destino:
            raise ErrorEdicion('Elige dos nudos distintos')
        self.nudo(nudo); self.nudo(destino)
        for l in [l for l in self.todos_tramos() if nudo in (self.tramo(l)['n1'], self.tramo(l)['n2'])]:
            d = self.tramo(l)
            otro = d['n2'] if d['n1'] == nudo else d['n1']
            if otro == destino:
                self.op_borrar('tramo', l, silencioso=True)      # quedaría con los dos extremos iguales
                continue
            self._reconectar(l, n1=destino if d['n1'] == nudo else None, n2=destino if d['n2'] == nudo else None)
        self.op_borrar('nudo', nudo, silencioso=True)
        if longitud:
            self._ajustar_longitudes(destino)
        return destino

    def op_borrar(self, tipo, id, silencioso=False):
        """Borra un nudo (con sus tramos) o un tramo, en todas las secciones donde aparece."""
        if tipo == 'nudo':
            self.nudo(id)
            for l in [l for l in self.todos_tramos() if id in (self.tramo(l)['n1'], self.tramo(l)['n2'])]:
                self.op_borrar('tramo', l, silencioso)
            if id in self.nuevo_nudo:
                sec, j = self.nuevo_nudo.pop(id)['_pos']
                self.nuevas[sec][j] = None
                self.coords.pop(id, None)
                self._quitar_tag_nuevo('NODE', id)
                return
            self.borrados.add(('nudo', id))
            for s, k in (('[JUNCTIONS]', 0), ('[RESERVOIRS]', 0), ('[TANKS]', 0), ('[COORDINATES]', 0),
                         ('[DEMANDS]', 0), ('[EMITTERS]', 0), ('[QUALITY]', 0), ('[SOURCES]', 0), ('[MIXING]', 0)):
                self._quitar_de_seccion(s, k, id)
            self._quitar_tag('NODE', id)
        else:
            self.tramo(id)
            if id in self.nuevo_tramo:
                sec, j = self.nuevo_tramo.pop(id)['_pos']
                self.nuevas[sec][j] = None
                self.estados.pop(id, None)
                self._quitar_tag_nuevo('LINK', id)
                return
            self.tramo_mod.pop(id, None)
            self.borrados.add(('tramo', id))
            for s in ('[PIPES]', '[PUMPS]', '[VALVES]', '[STATUS]', '[VERTICES]'):
                self._quitar_de_seccion(s, 0, id)
            for i, f in self.m.sec.get('[ENERGY]', []):
                if len(f) > 1 and f[0].upper() == 'PUMP' and f[1] == id:
                    self.cambiar_linea(i, None)
            self._quitar_tag('LINK', id)
            self.estados.pop(id, None)
        self._quitar_referencias(id, silencioso)

    def todos_tramos(self):
        return [l for l in self.m.tramos if ('tramo', l) not in self.borrados] + list(self.nuevo_tramo)

    def _quitar_de_seccion(self, s, k, id):
        for i, f in self.m.sec.get(s, []):
            if len(f) > k and f[k] == id:
                self.cambiar_linea(i, None)

    def _quitar_tag_nuevo(self, clase, id):
        if (clase, id) in self.tag_pos:
            sec, j = self.tag_pos.pop((clase, id))
            self.nuevas[sec][j] = None

    def _quitar_tag(self, clase, id):
        for i, f in self.m.sec.get('[TAGS]', []):
            if len(f) > 1 and f[0].upper() == clase and f[1] == id:
                self.cambiar_linea(i, None)

    def _quitar_referencias(self, id, silencioso):
        pat = re.compile(r'(?<![\w.-])' + re.escape(id) + r'(?![\w.-])')
        for i, t in self.m.controles:
            if pat.search(t) and self.mod.get(i, '') is not None:
                self.cambiar_linea(i, None)
                self.avisos.append(f'Se quitó el control "{t}" porque nombraba a {id}.')
        for nombre, r in self.m.reglas.items():
            if any(pat.search(x) for x in r['texto'][1:]) and self.mod.get(r['lineas'][0], '') is not None:
                for i in r['lineas']:
                    self.cambiar_linea(i, None)
                self.avisos.append(f'Se quitó la regla {nombre} porque nombraba a {id}.')

    def cota_cercana(self, x, y, k=3):
        """Cota estimada por los nudos más cercanos con cota distinta de cero (inverso de la distancia)."""
        cand = []
        for n, (nx_, ny_) in list(self.m.coords.items()) + [(n, (d['x'], d['y'])) for n, d in self.nuevo_nudo.items()]:
            try:
                c = self.nudo(n)['cota']
            except ErrorEdicion:
                continue
            if self.nudo(n)['tipo'] != 'junction' or abs(c) < 1:
                continue
            cand.append((math.hypot(x - nx_, y - ny_), c))
        cand.sort()
        cerca = cand[:k]
        if not cerca:
            return 0.0
        if cerca[0][0] < 0.01:
            return cerca[0][1]
        w = [1 / d for d, _ in cerca]
        return round(sum(wi * c for wi, (_, c) in zip(w, cerca)) / sum(w), 3)

    # ---------------------------------------------------------------- salida
    def texto(self):
        """El archivo editado. No cambia el estado del editor: se puede pedir las veces que sea."""
        L = list(self.m.lineas)
        mod = dict(self.mod)
        nuevas = OrderedDict((s, list(v)) for s, v in self.nuevas.items())

        def agregar(s, t):
            nuevas.setdefault(s, []).append(t)
        # [STATUS]: reemplaza o quita las líneas existentes, agrega las nuevas
        for i, f in self.m.sec.get('[STATUS]', []):
            if f and f[0] in self.estados and mod.get(i, '') is not None:
                v = self.estados[f[0]]
                mod[i] = f' {f[0]:<16}\t{v}' if v else None
        ya = {f[0] for _, f in self.m.sec.get('[STATUS]', []) if f}
        for l, v in self.estados.items():
            if l not in ya and v:
                agregar('[STATUS]', f' {l:<16}\t{v}')
        # coordenadas de nudos movidos y nuevos
        for i, f in self.m.sec.get('[COORDINATES]', []):
            if f and f[0] in self.coords and f[0] not in self.nuevo_nudo and mod.get(i, '') is not None:
                x, y = self.coords[f[0]]
                mod[i] = f'{f[0]:<16}\t{x:<17.3f}\t{y:<17.3f}'
        for n, d in self.nuevo_nudo.items():
            agregar('[COORDINATES]', f'{n:<16}\t{d["x"]:<17.3f}\t{d["y"]:<17.3f}')
        # vértices: los de tramos partidos se reescriben; los de tramos nuevos se agregan
        vn = {l: d['verts'] for l, d in self.tramo_mod.items() if d.get('verts_cambiados')}
        for i, f in self.m.sec.get('[VERTICES]', []):
            if f and f[0] in vn:
                mod[i] = None
        for l, vs in vn.items():
            for x, y in vs:
                agregar('[VERTICES]', f'{l:<16}\t{x:<17.3f}\t{y:<17.3f}')
        for l, d in self.nuevo_tramo.items():
            for x, y in d.get('verts', []):
                agregar('[VERTICES]', f'{l:<16}\t{x:<17.3f}\t{y:<17.3f}')
        for i, t in mod.items():
            L[i] = t
        # líneas nuevas al final de su sección (o en una sección nueva antes de [END])
        inserciones = {}
        for s, nuevas in nuevas.items():
            nuevas = [t for t in nuevas if t is not None]
            if not nuevas:
                continue
            if s in self.m.cab:
                cab = self.m.cab[s][-1]
                fin = cab + 1
                while fin < len(self.m.lineas) and not self.m.lineas[fin].strip().startswith('['):
                    fin += 1
                j = fin
                while j - 1 > cab and not self.m.lineas[j - 1].strip():
                    j -= 1
                inserciones.setdefault(j, []).extend(nuevas)
            else:
                fin = self.m.cab.get('[END]', [len(self.m.lineas)])[0]
                inserciones.setdefault(fin, []).extend([s] + nuevas + [''])
        out = []
        nl = self.m.nl
        for i, t in enumerate(L):
            if i in inserciones:
                out.extend(x + nl for x in inserciones[i])
            if t is not None:
                out.append(t + self.m.finales[i])
        if len(L) in inserciones:
            if out and not out[-1].endswith('\n'):
                out[-1] += nl
            out.extend(x + nl for x in inserciones[len(L)])
        return ''.join(out)
