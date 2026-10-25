"""Scripts de Python sobre la red (panel Scripts), como el nodo de Python de Dynamo.

El script corre en un proceso aparte (python -I): un bucle infinito o un error grave no tumban a Cauce y se puede
cancelar. Adentro tiene un objeto `red` para leer el modelo, cambiar muchas cosas de una vez, correr la simulación y
leer resultados. Lo que cambia no se escribe en ningún archivo: queda como una lista de ediciones (las mismas op del
Editor) que el servidor aplica, cuando el usuario lo pide, como UNA sola edición del escenario. Así Ctrl+Z la deshace
entera y rehacer el escenario da lo mismo sin volver a correr el script.

Lado del servidor: Ejecucion (lanza el proceso, lee la consola en vivo, cancela) y la biblioteca de scripts
(trabajo/scripts, los del usuario; ejemplos/, los que trae Cauce). Lado del proceso: hijo() y la clase Red.
"""
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
from array import array

from . import inp, motor, unidades

TIPO_NUDO = {'junction': 'nudo', 'reservoir': 'embalse', 'tank': 'tanque'}
TIPO_TRAMO = {'pipe': 'tuberia', 'pump': 'bomba', 'valve': 'valvula'}
# atributo en español -> campo del modelo, por tipo de elemento
ATRIBUTOS = {
    'junction': {'cota': 'cota', 'demanda': 'dem', 'patron': 'pat'},
    'reservoir': {'carga': 'cota', 'cota': 'cota', 'patron': 'pat'},
    'tank': {'cota': 'cota', 'nivel_inicial': 'nini', 'nivel_min': 'nmin', 'nivel_max': 'nmax', 'diametro': 'diam',
             'volumen_min': 'vmin', 'curva_volumen': 'curva'},
    'pipe': {'longitud': 'lon', 'diametro': 'diam', 'rugosidad': 'rug', 'perdida_menor': 'km'},
    'valve': {'diametro': 'diam', 'tipo_valvula': 'vt', 'consigna': 'consigna', 'perdida_menor': 'km'},
    'pump': {'curva': 'curva', 'potencia': 'potencia', 'velocidad': 'velocidad', 'patron': 'patron'},
}
PARAM_BOMBA = {'curva': 'HEAD', 'potencia': 'POWER', 'velocidad': 'SPEED', 'patron': 'PATTERN'}
CREAN = ('nudo', 'tanque', 'embalse', 'tuberia', 'valvula', 'bomba_nueva', 'insertar')
TOPOLOGIA = CREAN + ('partir', 'unir', 'borrar')
MAX_CONSOLA = 200_000          # caracteres de la consola que se muestran (los últimos)


class ErrorScript(Exception):
    """Un error del script contado en español (el elemento no existe, el campo no se puede cambiar...)."""


# ====================================================================== elementos
class _Elemento:
    __slots__ = ('_red', 'id')
    clase = ''

    def __init__(self, red, ident):
        object.__setattr__(self, '_red', red)
        object.__setattr__(self, 'id', ident)

    def __str__(self):
        return self.id

    def __repr__(self):
        return f'<{self.tipo} {self.id}>'

    def __eq__(self, otro):
        return isinstance(otro, _Elemento) and (otro.clase, otro.id) == (self.clase, self.id)

    def __hash__(self):
        return hash((self.clase, self.id))

    def _dato(self):
        m = self._red._modelo()
        d = (m.nudos if self.clase == 'nudo' else m.tramos).get(self.id)
        if d is None:
            raise ErrorScript(f'{self.id} ya no existe en la red')
        return d

    @property
    def etiqueta(self):
        return self._red._modelo().tag(self.clase, self.id)

    @property
    def comentario(self):
        return self._dato().get('com', '')

    def __getattr__(self, k):
        d = self._dato()
        campos = ATRIBUTOS.get(d['tipo'], {})
        if k not in campos:
            raise AttributeError(f'{TIPO_NUDO.get(d["tipo"]) or TIPO_TRAMO.get(d["tipo"])} {self.id} no tiene «{k}». '
                                 f'Tiene: {", ".join(self._nombres(d))}')
        return self._red._leer(self.clase, self.id, d, campos[k])

    def __setattr__(self, k, v):
        if k == 'etiqueta':
            self._red.etiqueta(self.id, v, clase=self.clase)
            return
        d = self._dato()
        campos = ATRIBUTOS.get(d['tipo'], {})
        if k not in campos:
            raise ErrorScript(f'«{k}» no se puede cambiar en {self.id}. Se puede: {", ".join(campos) or "nada"}')
        self._red._poner(self.clase, self.id, campos[k], v)


class Nudo(_Elemento):
    __slots__ = ()
    clase = 'nudo'

    def _nombres(self, d):
        return ['tipo', 'x', 'y', 'etiqueta', 'comentario', 'tramos', 'vecinos'] + list(ATRIBUTOS[d['tipo']])

    @property
    def tipo(self):
        return TIPO_NUDO[self._dato()['tipo']]

    @property
    def x(self):
        return self._red._modelo().coords.get(self.id, (None, None))[0]

    @property
    def y(self):
        return self._red._modelo().coords.get(self.id, (None, None))[1]

    @property
    def tramos(self):
        return [Tramo(self._red, l) for l in self._red._ady().get(self.id, [])]

    @property
    def vecinos(self):
        m = self._red._modelo()
        return [Nudo(self._red, m.tramos[l]['n2'] if m.tramos[l]['n1'] == self.id else m.tramos[l]['n1'])
                for l in self._red._ady().get(self.id, [])]

    def __setattr__(self, k, v):
        if k in ('x', 'y'):
            x, y = (v, self.y) if k == 'x' else (self.x, v)
            self._red.mover(self.id, x, y)
            return
        _Elemento.__setattr__(self, k, v)


class Tramo(_Elemento):
    __slots__ = ()
    clase = 'tramo'

    def _nombres(self, d):
        return ['tipo', 'n1', 'n2', 'estado', 'abierto', 'largo', 'etiqueta', 'comentario'] + list(ATRIBUTOS[d['tipo']])

    @property
    def tipo(self):
        return TIPO_TRAMO[self._dato()['tipo']]

    @property
    def n1(self):
        return Nudo(self._red, self._dato()['n1'])

    @property
    def n2(self):
        return Nudo(self._red, self._dato()['n2'])

    @property
    def estado(self):
        """OPEN, CLOSED, CV o la consigna con que empieza la simulación."""
        return self._red._modelo().estado_inicial(self.id)

    @property
    def abierto(self):
        return self.estado != 'CLOSED'

    @property
    def largo(self):
        """La longitud si es tubería; si no, la distancia en el mapa entre sus nudos."""
        d = self._dato()
        if d['tipo'] == 'pipe':
            return d.get('lon', 0.0)
        pts = self._red._modelo().trazado(self.id)
        return sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))

    def abrir(self):
        self._red.abrir(self.id)

    def cerrar(self):
        self._red.cerrar(self.id)

    def __setattr__(self, k, v):
        if k == 'estado':
            self._red.estado(self.id, v)
            return
        _Elemento.__setattr__(self, k, v)


class _Coleccion:
    """red.nudos y red.tramos: se recorren, se indexan por ID (red.nudos['J1']) y responden a `in`."""

    def __init__(self, red, clase):
        self._red, self._clase = red, clase

    def _dic(self):
        m = self._red._modelo()
        return m.nudos if self._clase == 'nudo' else m.tramos

    def _hacer(self, ident):
        return (Nudo if self._clase == 'nudo' else Tramo)(self._red, ident)

    def __iter__(self):
        return iter([self._hacer(i) for i in self._dic()])

    def __len__(self):
        return len(self._dic())

    def __contains__(self, ident):
        return str(ident) in self._dic()

    def __getitem__(self, ident):
        ident = str(ident)
        if ident not in self._dic():
            raise ErrorScript(f'No hay ningún {"nudo" if self._clase == "nudo" else "tramo"} con ID {ident}')
        return self._hacer(ident)

    def get(self, ident, defecto=None):
        return self._hacer(str(ident)) if str(ident) in self._dic() else defecto

    def ids(self):
        return list(self._dic())

    def __repr__(self):
        return f'<{len(self)} {"nudos" if self._clase == "nudo" else "tramos"}>'


# ====================================================================== resultados
class Resultados:
    """Resultados por hora de reporte: red.correr() o red.resultados (la última corrida hecha en Cauce)."""

    def __init__(self, red, ids_n, ids_l, horas, res, resumen):
        self._red, self.horas, self._res, self.resumen = red, list(horas), res, resumen or {}
        self._ids_n, self._ids_l = list(ids_n), list(ids_l)
        self._in = {x: k for k, x in enumerate(self._ids_n)}
        self._il = {x: k for k, x in enumerate(self._ids_l)}

    def __repr__(self):
        r = self.resumen
        b = (r.get('balance') or {}).get('diferencia_pct')
        return (f'<Resultados: {len(self.horas)} horas, {r.get("sin_converger", "?")} pasos sin converger'
                + (f', balance {b:+.2f} %' if isinstance(b, (int, float)) else '') + '>')

    def _serie(self, var, ident, nudo=True):
        ident = str(ident)
        k = (self._in if nudo else self._il).get(ident)
        if k is None:
            raise ErrorScript(f'{ident} no está en estos resultados')
        a = self._res.get(var)
        if a is None:
            raise ErrorScript(f'Estos resultados no traen «{var}»')
        N = len(self._ids_n if nudo else self._ids_l)
        return [a[h * N + k] for h in range(len(self.horas))]

    def _en(self, serie, hora):
        if hora is None:
            return serie
        j = min(range(len(self.horas)), key=lambda i: abs(self.horas[i] - float(hora)))
        return serie[j]

    def presion(self, nudo, hora=None):
        return self._en(self._serie('presion', nudo), hora)

    def carga(self, nudo, hora=None):
        return self._en(self._serie('carga', nudo), hora)

    def demanda(self, nudo, hora=None):
        return self._en(self._serie('demanda', nudo), hora)

    def nivel(self, tanque, hora=None):
        cota = self._red.nudos[str(tanque)].cota
        return self._en([c - cota for c in self._serie('carga', tanque)], hora)

    def calidad(self, nudo, hora=None):
        return self._en(self._serie('calidad', nudo), hora)

    def caudal(self, tramo, hora=None):
        return self._en(self._serie('caudal', tramo, False), hora)

    def velocidad(self, tramo, hora=None):
        return self._en(self._serie('velocidad', tramo, False), hora)

    def estado(self, tramo, hora=None):
        """1 abierto, 0 cerrado (como lo reporta EPANET)."""
        return self._en(self._serie('estado', tramo, False), hora)

    def extremos(self, variable='presion', n=10, menor=True, ids=None):
        """Los n elementos con el valor más bajo (o más alto) del día: [(id, valor, hora), ...]."""
        nudo = variable in ('presion', 'carga', 'demanda', 'calidad')
        todos = self._ids_n if nudo else self._ids_l
        cuales = [str(i) for i in ids] if ids is not None else todos
        out = []
        for i in cuales:
            if i not in (self._in if nudo else self._il):
                continue
            s = self._serie(variable, i, nudo)
            if variable in ('caudal', 'velocidad'):
                s = [abs(v) for v in s]
            j = min(range(len(s)), key=s.__getitem__) if menor else max(range(len(s)), key=s.__getitem__)
            if s[j] == s[j]:            # sin NaN
                out.append((i, s[j], self.horas[j]))
        out.sort(key=lambda t: t[1], reverse=not menor)
        return out[:n]


# ====================================================================== la red
class Red:
    """Lo que el script ve como `red`."""

    def __init__(self, texto, conv=None, corrida=None):
        self._conv = conv
        self._ed = inp.Editor(inp.Modelo(texto), conv)
        self._m = inp.Modelo(texto)       # lo que lee el script: se mantiene al día con lo que va cambiando
        self._sucio = False               # hubo cambios de forma de la red: releer del editor antes de leer
        self._ady_cache = None
        self._ops = []
        self._marcados = {'nudos': [], 'tramos': []}
        self._corrida = corrida           # la última corrida de Cauce para este modelo (se lee al pedirla)
        self._res_cauce = None
        self.nudos = _Coleccion(self, 'nudo')
        self.tramos = _Coleccion(self, 'tramo')

    def __repr__(self):
        return f'<red: {len(self.nudos)} nudos, {len(self.tramos)} tramos, {len(self._ops)} cambios en este script>'

    # ---------------------------------------------------------------- interno
    def _modelo(self):
        if self._sucio:
            self._m = inp.Modelo(self._ed.texto())
            self._sucio = False
            self._ady_cache = None
        return self._m

    def _ady(self):
        m = self._modelo()
        if self._ady_cache is None:
            a = {}
            for l, d in m.tramos.items():
                a.setdefault(d['n1'], []).append(l)
                a.setdefault(d['n2'], []).append(l)
            self._ady_cache = a
        return self._ady_cache

    def _aplicar(self, op):
        try:
            res = self._ed.aplicar(op)
        except inp.ErrorEdicion as ex:
            raise ErrorScript(str(ex)) from None
        except (ValueError, TypeError, KeyError) as ex:
            raise ErrorScript(f'Valor no válido en {op["op"]}: {ex}') from None
        # los IDs que se generaron quedan escritos: aplicar después da exactamente lo mismo
        if isinstance(res, str) and op['op'] in CREAN:
            op['id'] = res
        elif isinstance(res, tuple) and op['op'] == 'partir':
            op['id_nudo'], op['id_nuevo'] = res
        self._ops.append(op)
        if op['op'] in TOPOLOGIA or op['op'] in ('patron', 'curva', 'controles', 'reglas', 'opcion', 'dato', 'multiplicador'):
            self._sucio = True
        return res

    def _id(self, x):
        return x.id if isinstance(x, _Elemento) else str(x)

    def _clase_de(self, ident):
        m = self._modelo()
        if ident in m.tramos:
            return 'tramo'
        if ident in m.nudos:
            return 'nudo'
        raise ErrorScript(f'No hay ningún nudo ni tramo con ID {ident}')

    def _leer(self, clase, ident, d, campo):
        if d['tipo'] == 'pump':
            v = d.get('params', {}).get(PARAM_BOMBA[campo], '')
            return float(v) if campo in ('potencia', 'velocidad') and v != '' else v
        if campo == 'dem':
            dem = self._modelo().demandas.get(ident)
            return sum(q for q, _ in dem) if dem else d.get('dem', 0.0)
        if campo == 'consigna':
            try:
                return float(d.get('consigna', 0))
            except ValueError:
                return d.get('consigna', '')
        return d.get(campo)

    def _poner(self, clase, ident, campo, valor):
        m = self._modelo()
        d = (m.nudos if clase == 'nudo' else m.tramos)[ident]
        if isinstance(valor, _Elemento):
            valor = valor.id
        self._aplicar({'op': 'propiedad', 'tipo': clase, 'id': ident, 'campo': campo, 'valor': valor})
        # la vista al día sin releer todo el archivo (en un bucle de miles de cambios eso sería lento)
        if d['tipo'] == 'pump':
            p = d.setdefault('params', {})
            k = PARAM_BOMBA[campo]
            if campo == 'curva':
                p.pop('POWER', None)
            if campo == 'potencia':
                p.pop('HEAD', None)
            if valor in ('', None) and campo == 'patron':
                p.pop(k, None)
            else:
                p[k] = str(valor) if campo in ('curva', 'patron') else inp.fmt(float(valor))
        elif campo in ('pat', 'curva'):
            d[campo] = str(valor).strip()
        elif campo == 'vt':
            d['vt'] = str(valor).strip().upper()
        elif campo == 'consigna':
            d['consigna'] = inp.fmt(float(valor))
        else:
            d[campo] = float(valor)
            if campo == 'dem' and ident in m.demandas:
                m.demandas[ident] = [(float(valor), d.get('pat', ''))]

    # ---------------------------------------------------------------- leer
    def tuberias(self):
        return [t for t in self.tramos if t.tipo == 'tuberia']

    def bombas(self):
        return [t for t in self.tramos if t.tipo == 'bomba']

    def valvulas(self):
        return [t for t in self.tramos if t.tipo == 'valvula']

    def tanques(self):
        return [x for x in self.nudos if x.tipo == 'tanque']

    def embalses(self):
        return [x for x in self.nudos if x.tipo == 'embalse']

    def con_etiqueta(self, texto):
        """Nudos y tramos cuya etiqueta ([TAGS]) es `texto` (o la contiene, si termina en *)."""
        m = self._modelo()
        parcial = texto.endswith('*')
        t = texto.rstrip('*')
        ok = (lambda v: v.startswith(t)) if parcial else (lambda v: v == t)
        out = []
        for (clase, ident), v in m.tags.items():
            if ok(v) and ((clase == 'nudo' and ident in m.nudos) or (clase == 'tramo' and ident in m.tramos)):
                out.append((Nudo if clase == 'nudo' else Tramo)(self, ident))
        return out

    def buscar(self, patron):
        """Nudos y tramos cuyo ID cumple la expresión regular `patron` (por ejemplo r'^P-20')."""
        r = re.compile(patron)
        m = self._modelo()
        return [Nudo(self, i) for i in m.nudos if r.search(i)] + [Tramo(self, i) for i in m.tramos if r.search(i)]

    @property
    def patrones(self):
        return {k: list(v) for k, v in self._modelo().patrones.items()}

    @property
    def curvas(self):
        return {k: [tuple(p) for p in v] for k, v in self._modelo().curvas.items()}

    @property
    def controles(self):
        return [t for _, t in self._modelo().controles]

    @property
    def reglas(self):
        return {k: '\n'.join(v['texto']) for k, v in self._modelo().reglas.items()}

    @property
    def opciones(self):
        return dict(self._modelo().opciones('[OPTIONS]'))

    @property
    def tiempos(self):
        return dict(self._modelo().opciones('[TIMES]'))

    @property
    def unidades(self):
        return unidades.sistema(self._modelo())

    # ---------------------------------------------------------------- cambiar
    def abrir(self, tramo):
        self.estado(tramo, 'OPEN')

    def cerrar(self, tramo):
        self.estado(tramo, 'CLOSED')

    def estado(self, tramo, valor):
        """OPEN, CLOSED, una consigna (válvulas) o velocidad (bombas); '' vuelve a lo del archivo."""
        ident = self._id(tramo)
        self._aplicar({'op': 'estado', 'id': ident, 'valor': str(valor)})
        m = self._modelo()
        v = str(valor).strip()
        if v:
            m.estado[ident] = (None, v.upper() if v.upper() in ('OPEN', 'CLOSED') else v)
        else:
            m.estado.pop(ident, None)

    def cambiar(self, elemento, **campos):
        """red.cambiar('P1', diametro=300, rugosidad=120): varios atributos de una vez."""
        e = self.nudos.get(self._id(elemento)) or self.tramos[self._id(elemento)]
        for k, v in campos.items():
            setattr(e, k, v)

    def etiqueta(self, elemento, texto, clase=None):
        ident = self._id(elemento)
        clase = clase or (elemento.clase if isinstance(elemento, _Elemento) else self._clase_de(ident))
        self._aplicar({'op': 'etiqueta', 'tipo': clase, 'id': ident, 'valor': str(texto or '')})
        if texto:
            self._modelo().tags[(clase, ident)] = str(texto)
        else:
            self._modelo().tags.pop((clase, ident), None)

    def mover(self, nudo, x, y):
        ident = self._id(nudo)
        self._aplicar({'op': 'mover', 'id': ident, 'x': float(x), 'y': float(y)})
        self._modelo().coords[ident] = (float(x), float(y))

    def nudo(self, x, y, cota=None, demanda=0.0, patron='', id=None, etiqueta=''):
        """Nudo nuevo; sin cota, toma la de los nudos más cercanos. Devuelve el nudo."""
        op = {'op': 'nudo', 'x': float(x), 'y': float(y), 'cota': cota, 'dem': float(demanda), 'pat': patron, 'id': id, 'tag': etiqueta}
        return Nudo(self, self._aplicar(op))

    def tanque(self, x, y, cota, nivel_inicial, nivel_min, nivel_max, diametro, id=None, volumen_min=0.0, etiqueta=''):
        op = {'op': 'tanque', 'x': float(x), 'y': float(y), 'cota': float(cota), 'nini': float(nivel_inicial),
              'nmin': float(nivel_min), 'nmax': float(nivel_max), 'diam': float(diametro), 'id': id, 'vmin': float(volumen_min), 'tag': etiqueta}
        return Nudo(self, self._aplicar(op))

    def embalse(self, x, y, carga, id=None, patron='', etiqueta=''):
        op = {'op': 'embalse', 'x': float(x), 'y': float(y), 'cota': float(carga), 'id': id, 'pat': patron, 'tag': etiqueta}
        return Nudo(self, self._aplicar(op))

    def tuberia(self, n1, n2, diametro, rugosidad, longitud=None, id=None, estado='OPEN', etiqueta='', perdida_menor=0.0):
        """Sin longitud, la mide en el mapa. Devuelve la tubería."""
        op = {'op': 'tuberia', 'n1': self._id(n1), 'n2': self._id(n2), 'diam': float(diametro), 'rug': float(rugosidad),
              'lon': None if longitud is None else float(longitud), 'km': float(perdida_menor), 'id': id, 'estado': estado, 'tag': etiqueta}
        return Tramo(self, self._aplicar(op))

    def valvula(self, n1, n2, tipo, diametro, consigna, id=None, etiqueta=''):
        op = {'op': 'valvula', 'n1': self._id(n1), 'n2': self._id(n2), 'vt': str(tipo).upper(), 'diam': float(diametro),
              'consigna': consigna, 'id': id, 'tag': etiqueta}
        return Tramo(self, self._aplicar(op))

    def bomba(self, n1, n2, curva='', potencia=None, id=None, etiqueta=''):
        op = {'op': 'bomba_nueva', 'n1': self._id(n1), 'n2': self._id(n2), 'curva': curva, 'potencia': potencia, 'id': id, 'tag': etiqueta}
        return Tramo(self, self._aplicar(op))

    def _punto(self, tramo, x, y):
        if x is not None and y is not None:
            return float(x), float(y)
        pts = self._ed.trazado(tramo)
        largo = sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))
        falta = largo / 2
        for a, b in zip(pts, pts[1:]):
            s = math.dist(a, b)
            if s >= falta and s > 0:
                f = falta / s
                return a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f
            falta -= s
        return pts[0]

    def partir(self, tramo, x=None, y=None):
        """Parte una tubería (por la mitad si no se da el punto). Devuelve (nudo nuevo, tubería nueva)."""
        ident = self._id(tramo)
        px, py = self._punto(ident, x, y)
        a, b = self._aplicar({'op': 'partir', 'tramo': ident, 'x': px, 'y': py})
        return Nudo(self, a), Tramo(self, b)

    def insertar(self, tramo, clase='valvula', tipo='TCV', diametro=None, consigna=0, curva='', potencia=None, x=None, y=None, id=None):
        """Mete una válvula o bomba en una tubería (en la mitad si no se da el punto). Devuelve el tramo nuevo."""
        ident = self._id(tramo)
        px, py = self._punto(ident, x, y)
        op = {'op': 'insertar', 'tramo': ident, 'x': px, 'y': py, 'clase': clase, 'vt': str(tipo).upper(),
              'diam': diametro, 'consigna': consigna, 'curva': curva, 'potencia': potencia, 'id': id}
        return Tramo(self, self._aplicar(op))

    def unir(self, nudo, destino):
        """Pasa los tramos de `nudo` a `destino` y borra `nudo`."""
        self._aplicar({'op': 'unir', 'nudo': self._id(nudo), 'destino': self._id(destino)})

    def borrar(self, elemento):
        ident = self._id(elemento)
        clase = elemento.clase if isinstance(elemento, _Elemento) else self._clase_de(ident)
        self._aplicar({'op': 'borrar', 'tipo': clase, 'id': ident})

    def multiplicador(self, valor):
        self._aplicar({'op': 'multiplicador', 'valor': float(valor)})

    def poner_opcion(self, seccion, clave, valor):
        """red.poner_opcion('[OPTIONS]', 'TRIALS', 100). Valor '' la quita."""
        s = seccion if seccion.startswith('[') else f'[{seccion.upper()}]'
        self._aplicar({'op': 'opcion', 'seccion': s, 'clave': clave, 'valor': '' if valor is None else str(valor)})

    def poner_patron(self, ident, valores):
        """Crea o reemplaza un patrón. None lo borra (si nadie lo usa)."""
        self._aplicar({'op': 'patron', 'id': str(ident), 'valores': None if valores is None else [float(v) for v in valores]})

    def poner_curva(self, ident, puntos, tipo='PUMP'):
        """puntos = [(x, y), ...]; tipo PUMP, EFFICIENCY, VOLUME o HEADLOSS. None la borra."""
        pts = None if puntos is None else [[float(a), float(b)] for a, b in puntos]
        self._aplicar({'op': 'curva', 'id': str(ident), 'puntos': pts, 'tipo': tipo})

    def poner_controles(self, lineas):
        """Reemplaza todos los controles simples."""
        self._aplicar({'op': 'controles', 'lineas': list(lineas) if not isinstance(lineas, str) else lineas.split('\n')})

    def poner_reglas(self, texto):
        """Reemplaza todas las reglas (texto de [RULES])."""
        self._aplicar({'op': 'reglas', 'texto': texto if isinstance(texto, str) else '\n'.join(texto)})

    # ---------------------------------------------------------------- correr y mostrar
    def correr(self, motor='2.3', calidad=False):
        """Corre la red tal como va (con los cambios del script). Devuelve los resultados."""
        version = str(motor)
        print(f'· Corriendo con el motor {version}…', flush=True)
        t0 = time.perf_counter()
        c = _motor().Corrida(self._ed.texto(), version, False, nombre='script', calidad=bool(calidad))
        c.correr()
        if c.error:
            raise ErrorScript(f'EPANET no pudo leer la red: {c.error["mensaje"]}')
        r = c.resumen or {}
        txt = f'· Lista en {time.perf_counter() - t0:.1f} s: {r.get("sin_converger", 0)} pasos sin converger'
        if r.get('fallo'):
            txt += f'; FALLÓ a las {r["fallo"]["hora"]:.2f} h ({r["fallo"]["mensaje"]})'
        print(txt, flush=True)
        return Resultados(self, c.ids_n, c.ids_l, c.horas, c.res, r)

    @property
    def resultados(self):
        """La última corrida que se hizo en Cauce con el modelo tal como está (None si no hay)."""
        if self._res_cauce is None and self._corrida:
            c = self._corrida
            res = {}
            for v, f in c['vars'].items():
                a = array('f')
                with open(f, 'rb') as fh:
                    a.frombytes(fh.read())
                res[v] = a
            self._res_cauce = Resultados(self, c['ids_n'], c['ids_l'], c['horas'], res, c.get('resumen'))
        return self._res_cauce

    def marcar(self, *cosas):
        """Resalta en el mapa nudos y tramos (IDs, elementos o listas de ellos) cuando termina el script."""
        for c in cosas:
            if isinstance(c, (list, tuple, set)) or (hasattr(c, '__iter__') and not isinstance(c, (str, _Elemento))):
                self.marcar(*c)
            elif isinstance(c, _Elemento):
                self._marcados['nudos' if c.clase == 'nudo' else 'tramos'].append(c.id)
            else:
                ident = str(c)
                m = self._modelo()
                if ident not in m.nudos and ident not in m.tramos:
                    raise ErrorScript(f'No hay ningún nudo ni tramo con ID {ident} para marcar')
                if ident in m.nudos:
                    self._marcados['nudos'].append(ident)
                if ident in m.tramos:
                    self._marcados['tramos'].append(ident)

    def tabla(self, filas, encabezados=None, decimales=2):
        """Imprime una tabla alineada en la consola."""
        filas = [list(f) if isinstance(f, (list, tuple)) else [f] for f in filas]

        def txt(v):
            # sin separador de miles: con coma o punto se confunde con el decimal (la interfaz usa el formato es-CO)
            if isinstance(v, float):
                return f'{v:.{decimales}f}'
            return str(v)
        cuerpo = [[txt(v) for v in f] for f in filas]
        if encabezados:
            cuerpo.insert(0, [str(e) for e in encabezados])
        if not cuerpo:
            print('(tabla vacía)')
            return
        ancho = [max(len(f[j]) if j < len(f) else 0 for f in cuerpo) for j in range(max(len(f) for f in cuerpo))]
        num = [all(isinstance(f[j], (int, float)) for f in filas if j < len(f)) for j in range(len(ancho))]
        for k, f in enumerate(cuerpo):
            print('  '.join((c.rjust(ancho[j]) if num[j] and not (encabezados and k == 0) else c.ljust(ancho[j]))
                            for j, c in enumerate(f)).rstrip())
            if encabezados and k == 0:
                print('  '.join('─' * a for a in ancho))


def _motor():
    # el parámetro `motor` de Red.correr tapa el módulo del mismo nombre
    return motor


# ====================================================================== referencia (la muestra el panel)
REFERENCIA = [
    ('Leer la red', [
        ('red.nudos', 'Todos los nudos, tanques y embalses. red.nudos["J1"], for n in red.nudos, "J1" in red.nudos.', 'for n in red.nudos:\n    print(n.id, n.cota)\n'),
        ('red.tramos', 'Todas las tuberías, bombas y válvulas.', 'for t in red.tramos:\n    print(t.id, t.tipo, t.n1, t.n2)\n'),
        ('red.tuberias() · red.bombas() · red.valvulas()', 'Listas por tipo de tramo.', 'for t in red.tuberias():\n    pass\n'),
        ('red.tanques() · red.embalses()', 'Listas de tanques y embalses.', 'for tq in red.tanques():\n    print(tq.id, tq.nivel_max)\n'),
        ('red.con_etiqueta("Proy_2032")', 'Lo que tiene esa etiqueta; con * al final, las que empiezan así.', 'red.con_etiqueta("Proy_2032")'),
        ('red.buscar(r"^P-20")', 'Nudos y tramos cuyo ID cumple la expresión regular.', 'red.buscar(r"^P-20")'),
        ('red.patrones · red.curvas · red.controles · red.reglas', 'Datos del modelo (diccionarios y listas).', 'red.patrones'),
        ('red.opciones · red.tiempos · red.unidades', '[OPTIONS], [TIMES] y las unidades del modelo.', 'red.unidades'),
    ]),
    ('Atributos', [
        ('nudo', 'id, tipo (nudo, tanque o embalse), x, y, cota, demanda, patron, etiqueta, comentario, tramos, vecinos.', 'n.cota'),
        ('tanque', 'cota, nivel_inicial, nivel_min, nivel_max, diametro, volumen_min, curva_volumen.', 'tq.nivel_max'),
        ('embalse', 'carga, patron.', 'e.carga'),
        ('tubería', 'id, tipo, n1, n2, longitud, diametro, rugosidad, perdida_menor, estado, abierto, largo, etiqueta.', 't.diametro'),
        ('válvula', 'tipo_valvula, diametro, consigna, perdida_menor, estado.', 'v.consigna'),
        ('bomba', 'curva, potencia, velocidad, patron, estado.', 'b.curva'),
        ('Cambiar', 'Asignando: t.diametro = 300, n.demanda *= 1.2, v.consigna = 150, x.etiqueta = "Proy_2032".', 't.diametro = 300\n'),
    ]),
    ('Cambiar la red', [
        ('red.abrir(t) · red.cerrar(t)', 'Estado inicial de un tramo (también t.abrir(), t.cerrar()).', 'red.cerrar("P1")\n'),
        ('red.estado(t, valor)', 'OPEN, CLOSED, una consigna o velocidad; "" vuelve a lo del archivo.', 'red.estado("V1", 120)\n'),
        ('red.cambiar(x, **campos)', 'Varios atributos de una vez.', 'red.cambiar("P1", diametro=300, rugosidad=120)\n'),
        ('red.nudo(x, y, cota=None, demanda=0)', 'Nudo nuevo (sin cota toma la de los vecinos). Devuelve el nudo.', 'n = red.nudo(1000, 2000, cota=2600)\n'),
        ('red.tuberia(n1, n2, diametro, rugosidad)', 'Tubería nueva; sin longitud la mide en el mapa.', 't = red.tuberia("J1", "J2", 300, 120)\n'),
        ('red.valvula(n1, n2, tipo, diametro, consigna)', 'Válvula nueva (PRV, PSV, PBV, FCV, TCV, GPV).', 'red.valvula("J1", "J2", "FCV", 300, 80)\n'),
        ('red.bomba(n1, n2, curva="C1")', 'Bomba nueva con curva o potencia.', 'red.bomba("J1", "J2", curva="C1")\n'),
        ('red.tanque(...) · red.embalse(x, y, carga)', 'Tanque o embalse nuevo.', 'red.embalse(1000, 2000, 2650)\n'),
        ('red.partir(t) · red.insertar(t, "valvula", "TCV")', 'Partir una tubería o meterle una válvula o bomba (en la mitad si no se da x, y).', 'nudo, tramo = red.partir("P1")\n'),
        ('red.unir(nudo, destino) · red.mover(n, x, y) · red.borrar(x)', 'Unir puntas sueltas, mover o borrar.', 'red.unir("J467", "1852")\n'),
        ('red.multiplicador(v) · red.poner_opcion(sec, clave, v)', 'Multiplicador de demandas y opciones.', 'red.multiplicador(1.1)\n'),
        ('red.poner_patron · poner_curva · poner_controles · poner_reglas', 'Crear o reemplazar datos.', 'red.poner_patron("P_NUEVO", [1.0] * 24)\n'),
    ]),
    ('Correr y mostrar', [
        ('r = red.correr(motor="2.3")', 'Corre la red con los cambios del script y devuelve los resultados.', 'r = red.correr()\n'),
        ('red.resultados', 'La última corrida que hiciste en Cauce con el modelo tal como está (None si no hay).', 'r = red.resultados or red.correr()\n'),
        ('r.presion(n) · r.carga · r.demanda · r.nivel(tanque)', 'Lista por hora; con hora=6 da el valor a esa hora.', 'r.presion("J1", hora=6)'),
        ('r.caudal(t) · r.velocidad(t) · r.estado(t)', 'Resultados de tramos.', 'max(r.velocidad("P1"))'),
        ('r.extremos("presion", n=10)', 'Los 10 con el valor más bajo del día: (id, valor, hora). menor=False para los más altos.', 'for i, v, h in r.extremos("presion", 10):\n    print(i, round(v, 1), h)\n'),
        ('r.horas · r.resumen', 'Horas de reporte y el resumen (pasos, sin_converger, balance, avisos).', 'r.resumen["balance"]'),
        ('red.marcar(...)', 'Resalta en el mapa lo que le pases (IDs, elementos o listas).', 'red.marcar(lista)\n'),
        ('red.tabla(filas, encabezados)', 'Imprime una tabla alineada.', 'red.tabla([("J1", 25.3)], ["Nudo", "Presión"])\n'),
        ('print(...)', 'Todo lo que imprimas sale en la consola, mientras corre.', 'print()\n'),
    ]),
]


# ====================================================================== el proceso hijo
class _Consola:
    """stdout y stderr del script: a un archivo, al instante, para que el panel lo vaya mostrando."""

    def __init__(self, ruta):
        self.f = open(ruta, 'a', encoding='utf-8', errors='replace', newline='')     # sin \r\n de Windows

    def write(self, s):
        self.f.write(s)
        self.f.flush()
        return len(s)

    def flush(self):
        self.f.flush()

    def isatty(self):
        return False


def hijo(ruta_entrada):
    with open(ruta_entrada, encoding='utf-8') as fh:
        e = json.load(fh)
    sys.stdout = sys.stderr = _Consola(e['consola'])
    salida = {'ops': [], 'marcados': {'nudos': [], 'tramos': []}, 'error': None, 'linea': None, 'traza': ''}
    t0 = time.perf_counter()
    try:
        with open(e['texto'], encoding='latin-1', newline='') as fh:
            texto = fh.read()
        red = Red(texto, e.get('conv'), e.get('corrida'))
        try:
            codigo = compile(e['codigo'], '<script>', 'exec')
        except SyntaxError as ex:
            salida.update(error=f'Error de sintaxis: {ex.msg}', linea=ex.lineno,
                          traza=f'Línea {ex.lineno}: {(ex.text or "").rstrip()}\n{" " * (len(str(ex.lineno)) + 8 + max(0, (ex.offset or 1) - 1))}^')
            raise _Fin from None
        try:
            exec(codigo, {'red': red, '__name__': '__main__', '__builtins__': __builtins__})
        except SystemExit:
            pass
        except BaseException as ex:      # el error del usuario, contado con su línea
            marcos = [f for f in traceback.extract_tb(ex.__traceback__) if f.filename == '<script>']
            linea = marcos[-1].lineno if marcos else None
            lineas = e['codigo'].split('\n')
            traza = [f'Línea {f.lineno}: {lineas[f.lineno - 1].strip() if 0 < f.lineno <= len(lineas) else ""}' for f in marcos[-4:]]
            nombre = '' if isinstance(ex, ErrorScript) else f'{type(ex).__name__}: '
            salida.update(error=f'{nombre}{ex}', linea=linea, traza='\n'.join(traza))
        salida['ops'] = red._ops
        salida['marcados'] = {k: list(dict.fromkeys(v)) for k, v in red._marcados.items()}
    except _Fin:
        pass
    except Exception as ex:              # un error de Cauce, no del script
        salida.update(error=f'Error interno de Cauce: {type(ex).__name__}: {ex}', traza=traceback.format_exc())
    salida['segundos'] = round(time.perf_counter() - t0, 2)
    sys.stdout.flush()
    with open(e['salida'], 'w', encoding='utf-8') as fh:
        json.dump(salida, fh, ensure_ascii=False, default=str)


class _Fin(Exception):
    pass


# ====================================================================== lado del servidor
def _cola(ruta, maximo=MAX_CONSOLA):
    try:
        with open(ruta, 'rb') as fh:
            fh.seek(0, 2)
            n = fh.tell()
            fh.seek(max(0, n - maximo))
            t = fh.read().decode('utf-8', errors='replace')
        return ('…\n' + t) if n > maximo else t
    except OSError:
        return ''


class Ejecucion:
    """Un script corriendo en su proceso. Sirve de 'obj' de un trabajo: progreso() y cancelar()."""

    def __init__(self, texto, codigo, conv, raiz, corrida=None):
        self.texto, self.codigo, self.conv, self.raiz, self.corrida = texto, codigo, conv, raiz, corrida
        self.proceso = None
        self.cancelada = False
        self.inicio = time.time()
        self.dir = tempfile.mkdtemp(prefix='cauce_script_')
        self.consola = os.path.join(self.dir, 'consola.txt')

    def progreso(self):
        return {'consola': _cola(self.consola, 60_000), 'segundos': round(time.time() - self.inicio, 1)}

    def cancelar(self):
        self.cancelada = True
        if self.proceso and self.proceso.poll() is None:
            self.proceso.kill()

    def _exportar_corrida(self):
        c = self.corrida
        if c is None:
            return None
        vs = {}
        for v in ('presion', 'carga', 'demanda', 'caudal', 'velocidad', 'estado', 'calidad'):
            a = c.res.get(v)
            if a:
                f = os.path.join(self.dir, f'{v}.f32')
                with open(f, 'wb') as fh:
                    fh.write(a.tobytes())
                vs[v] = f
        return {'ids_n': c.ids_n, 'ids_l': c.ids_l, 'horas': c.horas, 'vars': vs, 'resumen': c.resumen}

    def correr(self):
        try:
            ruta_inp = os.path.join(self.dir, 'red.inp')
            with open(ruta_inp, 'w', encoding='latin-1', errors='replace', newline='') as fh:
                fh.write(self.texto)
            open(self.consola, 'w').close()
            entrada = {'texto': ruta_inp, 'codigo': self.codigo, 'conv': self.conv, 'corrida': self._exportar_corrida(),
                       'consola': self.consola, 'salida': os.path.join(self.dir, 'salida.json')}
            ruta_entrada = os.path.join(self.dir, 'entrada.json')
            with open(ruta_entrada, 'w', encoding='utf-8') as fh:
                json.dump(entrada, fh, ensure_ascii=False, default=str)
            rutas = [self.raiz] + ([os.path.join(self.raiz, 'lib')] if os.path.isdir(os.path.join(self.raiz, 'lib')) else [])
            arranque = f'import sys; sys.path[:0] = {rutas!r}; from nucleo import guiones; guiones.hijo(sys.argv[1])'
            errores = os.path.join(self.dir, 'errores.txt')
            with open(errores, 'w', encoding='utf-8') as ferr:
                self.proceso = subprocess.Popen([sys.executable, '-I', '-c', arranque, ruta_entrada], cwd=self.dir,
                                                stdin=subprocess.DEVNULL, stdout=ferr, stderr=ferr,
                                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                self.proceso.wait()
            consola = _cola(self.consola)
            if self.cancelada:
                return {'cancelado': True, 'consola': consola, 'ops': [], 'marcados': {'nudos': [], 'tramos': []},
                        'error': 'Cancelado.', 'segundos': round(time.time() - self.inicio, 1)}
            try:
                with open(entrada['salida'], encoding='utf-8') as fh:
                    r = json.load(fh)
            except (OSError, ValueError):
                with open(errores, encoding='utf-8', errors='replace') as fh:
                    detalle = fh.read()[-4000:]
                r = {'ops': [], 'marcados': {'nudos': [], 'tramos': []},
                     'error': f'El proceso del script terminó sin respuesta (código {self.proceso.returncode}).', 'traza': detalle}
            r['consola'] = consola
            return r
        finally:
            shutil.rmtree(self.dir, ignore_errors=True)


# ====================================================================== biblioteca
_NOMBRE = re.compile(r'[^\w \-áéíóúñÁÉÍÓÚÑüÜ().,]')


def limpiar_nombre(nombre):
    n = _NOMBRE.sub('', str(nombre or '')).strip(' .')
    if n.lower().endswith('.py'):
        n = n[:-3].strip()
    if not n:
        raise ValueError('Ponle un nombre al script.')
    return n[:80]


def _descripcion(ruta):
    try:
        with open(ruta, encoding='utf-8') as fh:
            for linea in fh:
                t = linea.strip()
                if t.startswith('#!'):
                    continue
                if t.startswith('#'):
                    return t.lstrip('#').strip()
                if t:
                    return ''
    except OSError:
        pass
    return ''


def listar(carpeta):
    if not os.path.isdir(carpeta):
        return []
    out = []
    for f in sorted(os.listdir(carpeta), key=str.lower):
        if f.lower().endswith('.py'):
            r = os.path.join(carpeta, f)
            out.append({'nombre': f[:-3], 'descripcion': _descripcion(r),
                        'mod': time.strftime('%Y-%m-%d %H:%M', time.localtime(os.path.getmtime(r)))})
    return out


def ruta_de(carpeta, nombre):
    return os.path.join(carpeta, limpiar_nombre(nombre) + '.py')


def leer(carpeta, nombre):
    with open(ruta_de(carpeta, nombre), encoding='utf-8') as fh:
        return fh.read()


def guardar(carpeta, nombre, codigo, sobrescribir=False):
    os.makedirs(carpeta, exist_ok=True)
    r = ruta_de(carpeta, nombre)
    if os.path.exists(r) and not sobrescribir:
        raise FileExistsError(os.path.basename(r))
    with open(r, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(codigo.replace('\r\n', '\n'))
    return limpiar_nombre(nombre)
