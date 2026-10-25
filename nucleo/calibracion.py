"""Calibración: mediciones de campo contra lo que calcula el modelo, como el informe de calibración de EPANET.

Las mediciones entran desde el formato de EPANET (.dat: "ID  hora  valor", con el ID vacío para seguir con el mismo
punto), desde un CSV o desde una hoja de Excel, en formato largo (una fila por medición: ID, hora, valor) o ancho
(una columna por punto, con los IDs en la fila de encabezado y la hora en una columna). Cada serie es una variable
(presión, nivel, carga, caudal, velocidad, demanda o calidad) en un punto del modelo, con sus horas desde el
inicio de la simulación. comparar() interpola la corrida en esas horas y da, por punto y en total, el error medio,
el error cuadrático medio (RMS) y la correlación entre los promedios medidos y simulados.
"""
import csv
import datetime as dt
import hashlib
import json
import math
import os
import re

# variable -> (resultado de la corrida, clase del elemento)
VARIABLES = {'presion': ('presion', 'nudo'), 'nivel': ('presion', 'nudo'), 'carga': ('carga', 'nudo'),
             'demanda': ('demanda', 'nudo'), 'calidad': ('calidad', 'nudo'), 'caudal': ('caudal', 'tramo'),
             'velocidad': ('velocidad', 'tramo'), 'calidad_t': ('calidad_t', 'tramo')}


# ------------------------------------------------------------------ horas
def horas(v, dia0=None):
    """Una hora de medición a horas desde el inicio: 7:30, 07:30:00, 7.5, 7,5, una hora o fecha de Excel."""
    if v is None or v == '':
        return None
    if isinstance(v, dt.datetime):
        base = dia0 or v.replace(hour=0, minute=0, second=0, microsecond=0)
        return (v - base).total_seconds() / 3600
    if isinstance(v, dt.time):
        return v.hour + v.minute / 60 + v.second / 3600
    if isinstance(v, dt.timedelta):
        return v.total_seconds() / 3600
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().lower().replace('a. m.', 'am').replace('p. m.', 'pm').replace('a.m.', 'am').replace('p.m.', 'pm')
    m = re.search(r'(\d{1,3}):(\d{2})(?::(\d{2}))?\s*(am|pm)?', s)
    if m:
        h = int(m.group(1)) + int(m.group(2)) / 60 + int(m.group(3) or 0) / 3600
        if m.group(4) == 'pm' and int(m.group(1)) < 12:
            h += 12
        if m.group(4) == 'am' and int(m.group(1)) == 12:
            h -= 12
        return h
    try:
        return float(s.replace(',', '.'))
    except ValueError:
        return None


def numero(v):
    if v is None or v == '':
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).strip().replace(',', '.'))
    except ValueError:
        return None


def _id(v):
    if v is None:
        return ''
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


# ------------------------------------------------------------------ lectura
def _filas(ruta, hoja=None, maximo=200000):
    ext = os.path.splitext(ruta)[1].lower()
    if ext in ('.xlsx', '.xlsm'):
        import openpyxl
        wb = openpyxl.load_workbook(ruta, data_only=True, read_only=True)
        ws = wb[hoja] if hoja else wb.worksheets[0]
        filas = []
        for r in ws.iter_rows(values_only=True):
            filas.append(list(r))
            if len(filas) >= maximo:
                break
        hojas = [w.title for w in wb.worksheets]
        wb.close()
        return filas, hojas
    with open(ruta, encoding='utf-8-sig', errors='replace') as fh:
        texto = fh.read()
    try:
        dialecto = csv.Sniffer().sniff(texto[:4000], delimiters=';,\t')
        filas = [r for r in csv.reader(texto.splitlines(), dialecto)]
    except csv.Error:
        filas = [l.split() for l in texto.splitlines()]
    return filas[:maximo], []


def leer_dat(ruta):
    """Formato de calibración de EPANET: ID hora valor; un ID vacío sigue con el anterior; ';' son comentarios."""
    series, actual = {}, None
    with open(ruta, encoding='latin-1', errors='replace') as fh:
        for linea in fh:
            datos = linea.split(';', 1)[0]
            if not datos.strip():
                continue
            f = datos.split()
            if datos[:1].isspace() and len(f) == 2:
                ident, h, v = actual, f[0], f[1]
            elif len(f) >= 3:
                ident, h, v = f[0], f[1], f[2]
            else:
                continue
            hh, vv = horas(h), numero(v)
            if ident and hh is not None and vv is not None:
                actual = ident
                series.setdefault(ident, []).append([hh, vv])
    return series


def vista(ruta, hoja=None, filas=15):
    """Lo necesario para que la interfaz pregunte cómo leer el archivo."""
    ext = os.path.splitext(ruta)[1].lower()
    if ext in ('.dat', '.txt'):
        s = leer_dat(ruta)
        if s:
            return {'tipo': 'dat', 'puntos': len(s), 'mediciones': sum(len(v) for v in s.values()), 'ids': list(s)[:30]}
    tabla, hojas = _filas(ruta, hoja, maximo=5000)
    return {'tipo': 'tabla', 'hojas': hojas, 'hoja': hoja or (hojas[0] if hojas else ''), 'filas': len(tabla),
            'muestra': [['' if v is None else str(v)[:30] for v in r[:20]] for r in tabla[:filas]]}


def importar_tabla(ruta, hoja, formato, fila, col_id=1, col_hora=2, col_valor=3, col_desde=2):
    """Series {id: [[horas, valor], ...]} de una tabla. Columnas desde 1 (A = 1); fila = la primera con datos.
    En formato ancho, los IDs salen de la fila anterior a la primera con datos."""
    tabla, _ = _filas(ruta, hoja)
    series, malas = {}, 0
    datos = tabla[fila - 1:]
    # si las horas son fechas de Excel, se cuentan desde la medianoche del primer día
    dia0 = None
    c_h = (col_hora if formato == 'largo' else col_hora) - 1
    for r in datos:
        if len(r) > c_h and isinstance(r[c_h], dt.datetime):
            dia0 = r[c_h].replace(hour=0, minute=0, second=0, microsecond=0)
            break
    if formato == 'largo':
        for r in datos:
            r = list(r) + [None] * 30
            ident, hh, v = _id(r[col_id - 1]), horas(r[col_hora - 1], dia0), numero(r[col_valor - 1])
            if not ident:
                continue
            if hh is None or v is None:
                malas += 1
                continue
            series.setdefault(ident, []).append([hh, v])
    else:
        enc = list(tabla[fila - 2]) if fila >= 2 else []
        ids = {c: _id(enc[c]) for c in range(col_desde - 1, len(enc)) if _id(enc[c])}
        for r in datos:
            r = list(r) + [None] * 30
            hh = horas(r[col_hora - 1], dia0)
            if hh is None:
                continue
            for c, ident in ids.items():
                v = numero(r[c] if c < len(r) else None)
                if v is not None:
                    series.setdefault(ident, []).append([hh, v])
    for v in series.values():
        v.sort()
    return series, malas


# ------------------------------------------------------------------ guardado (por modelo, en trabajo/calibracion)
def archivo(carpeta, ruta_modelo):
    clave = hashlib.sha1(os.path.normcase(os.path.abspath(ruta_modelo)).encode('utf-8')).hexdigest()[:16]
    return os.path.join(carpeta, f'{clave}.json')


def cargar(carpeta, ruta_modelo):
    p = archivo(carpeta, ruta_modelo)
    if not os.path.isfile(p):
        return []
    with open(p, encoding='utf-8') as fh:
        return json.load(fh).get('series', [])


def guardar(carpeta, ruta_modelo, series):
    os.makedirs(carpeta, exist_ok=True)
    with open(archivo(carpeta, ruta_modelo), 'w', encoding='utf-8') as fh:
        json.dump({'modelo': ruta_modelo, 'series': series}, fh, ensure_ascii=False)


def agregar(series, variable, nuevas, origen=''):
    """Junta series nuevas con las que había (mismo punto y variable: se reemplazan)."""
    quedan = [s for s in series if not (s['variable'] == variable and s['id'] in nuevas)]
    return quedan + [{'variable': variable, 'id': i, 'puntos': p, 'origen': origen} for i, p in nuevas.items()]


def resumen(series):
    por = {}
    for s in series:
        r = por.setdefault(s['variable'], {'variable': s['variable'], 'puntos': 0, 'mediciones': 0, 'desde': None, 'hasta': None, 'origenes': set()})
        r['puntos'] += 1
        r['mediciones'] += len(s['puntos'])
        hs = [p[0] for p in s['puntos']]
        if hs:
            r['desde'] = min(hs) if r['desde'] is None else min(r['desde'], min(hs))
            r['hasta'] = max(hs) if r['hasta'] is None else max(r['hasta'], max(hs))
        if s.get('origen'):
            r['origenes'].add(s['origen'])
    return [dict(r, origenes=sorted(r['origenes'])) for r in por.values()]


# ------------------------------------------------------------------ comparación
def _interp(horas_r, vals, h):
    if not horas_r or h < horas_r[0] - 1e-9 or h > horas_r[-1] + 1e-9:
        return None
    for j in range(1, len(horas_r)):
        if h <= horas_r[j] + 1e-9:
            a, b = horas_r[j - 1], horas_r[j]
            va, vb = vals[j - 1], vals[j]
            if not (math.isfinite(va) and math.isfinite(vb)):
                return None
            return va if b - a < 1e-9 else va + (vb - va) * (h - a) / (b - a)
    return vals[0] if math.isfinite(vals[0]) else None


def _corr(xs, ys):
    n = len(xs)
    if n < 3:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    sy = math.sqrt(sum((y - my) ** 2 for y in ys))
    return sxy / (sx * sy) if sx and sy else None


def comparar(series, corrida, variable):
    """Por punto: mediciones, promedio medido y simulado, error medio (simulado - medido) y RMS; y los totales."""
    res_var, clase = VARIABLES[variable]
    if not corrida.res.get(res_var):
        return {'variable': variable, 'error': 'La corrida no tiene esa variable (la calidad se calcula solo si el modelo la tiene).'}
    ids = corrida.ids_n if clase == 'nudo' else corrida.ids_l
    pos = {i: k for k, i in enumerate(ids)}
    n, T = len(ids), len(corrida.horas)
    a = corrida.res[res_var]
    puntos, faltan, todos_m, todos_s = [], [], [], []
    for s in series:
        if s['variable'] != variable:
            continue
        k = pos.get(s['id'])
        if k is None:
            faltan.append(s['id'])
            continue
        vals = [a[h * n + k] for h in range(T)]
        if variable in ('caudal', 'velocidad'):
            vals = [abs(v) for v in vals]          # el sentido del medidor no siempre coincide con el del tramo
        obs = []
        for hh, vm in s['puntos']:
            if variable in ('caudal', 'velocidad'):
                vm = abs(vm)
            vs = _interp(corrida.horas, vals, hh)
            if vs is not None:
                obs.append([hh, vm, vs])
        if not obs:
            puntos.append({'id': s['id'], 'n': 0, 'fuera': len(s['puntos'])})
            continue
        err = [o[2] - o[1] for o in obs]
        mm, ms = sum(o[1] for o in obs) / len(obs), sum(o[2] for o in obs) / len(obs)
        puntos.append({'id': s['id'], 'n': len(obs), 'fuera': len(s['puntos']) - len(obs), 'medido': mm, 'simulado': ms,
                       'error_medio': sum(err) / len(err), 'error_abs': sum(abs(e) for e in err) / len(err),
                       'rms': math.sqrt(sum(e * e for e in err) / len(err)), 'obs': obs,
                       'simulado_serie': [v if math.isfinite(v) else None for v in vals]})
        todos_m += [o[1] for o in obs]
        todos_s += [o[2] for o in obs]
    con = [p for p in puntos if p['n']]
    err = [s - m for m, s in zip(todos_m, todos_s)]
    total = {'puntos': len(con), 'mediciones': len(err),
             'error_medio': sum(err) / len(err) if err else None,
             'error_abs': sum(abs(e) for e in err) / len(err) if err else None,
             'rms': math.sqrt(sum(e * e for e in err) / len(err)) if err else None,
             'correlacion_promedios': _corr([p['medido'] for p in con], [p['simulado'] for p in con]),
             'correlacion_mediciones': _corr(todos_m, todos_s)}
    con.sort(key=lambda p: -abs(p['error_medio']))
    return {'variable': variable, 'clase': clase, 'horas': corrida.horas, 'total': total,
            'puntos': con + [p for p in puntos if not p['n']], 'no_encontrados': faltan}
