"""Diferencias entre dos modelos: qué entra, qué sale y qué cambia, listo para pintarlo en el mapa."""
import math


def _estado(m, l):
    return m.estado_inicial(l)


def comparar(a, b):
    """a = referencia, b = el otro. Devuelve un dict con listas de IDs por tipo de cambio."""
    out = {'opciones': [], 'conteos': [], 'nudos_nuevos': [], 'nudos_quitados': [], 'nudos_movidos': [],
           'nudos_cambiados': [], 'tramos_nuevos': [], 'tramos_quitados': [], 'tramos_estado': [],
           'tramos_geometria': [], 'tramos_consigna': [], 'reglas_nuevas': [], 'reglas_quitadas': [],
           'reglas_cambiadas': [], 'controles_nuevos': [], 'controles_quitados': []}
    for s in ('[OPTIONS]', '[TIMES]', '[REPORT]'):
        oa, ob = a.opciones(s), b.opciones(s)
        for k in list(oa) + [k for k in ob if k not in oa]:
            va, vb = oa.get(k, '—'), ob.get(k, '—')
            if va.upper().replace(' ', '') != vb.upper().replace(' ', ''):
                out['opciones'].append({'seccion': s, 'clave': k, 'a': va, 'b': vb})
    secs = list(a.sec) + [s for s in b.sec if s not in a.sec]
    for s in secs:
        na, nb = len(a.sec.get(s, [])), len(b.sec.get(s, []))
        if na != nb:
            out['conteos'].append({'seccion': s, 'a': na, 'b': nb})
    for n, d in b.nudos.items():
        if n not in a.nudos:
            out['nudos_nuevos'].append(n)
            continue
        da = a.nudos[n]
        if n in a.coords and n in b.coords and math.dist(a.coords[n], b.coords[n]) > 0.01:
            out['nudos_movidos'].append({'id': n, 'metros': round(math.dist(a.coords[n], b.coords[n]), 2)})
        cambios = {k: (da.get(k), d.get(k)) for k in ('cota', 'dem', 'pat', 'nini', 'nmin', 'nmax', 'diam')
                   if k in d and da.get(k) != d.get(k)}
        if cambios:
            out['nudos_cambiados'].append({'id': n, 'cambios': {k: [str(x), str(y)] for k, (x, y) in cambios.items()}})
    out['nudos_quitados'] = [n for n in a.nudos if n not in b.nudos]
    for l, d in b.tramos.items():
        if l not in a.tramos:
            out['tramos_nuevos'].append(l)
            continue
        da = a.tramos[l]
        ea, eb = _estado(a, l), _estado(b, l)
        if ea != eb:
            out['tramos_estado'].append({'id': l, 'a': ea, 'b': eb})
        geo = {k: [str(da.get(k)), str(d.get(k))] for k in ('n1', 'n2', 'lon', 'diam', 'rug') if da.get(k) != d.get(k)}
        if geo:
            out['tramos_geometria'].append({'id': l, 'cambios': geo})
        if d['tipo'] == 'valve' and da.get('consigna') != d.get('consigna'):
            out['tramos_consigna'].append({'id': l, 'a': da.get('consigna'), 'b': d.get('consigna')})
        if d['tipo'] == 'pump' and da.get('params') != d.get('params'):
            out['tramos_geometria'].append({'id': l, 'cambios': {'bomba': [str(da.get('params')), str(d.get('params'))]}})
    out['tramos_quitados'] = [l for l in a.tramos if l not in b.tramos]
    for r, v in b.reglas.items():
        if r not in a.reglas:
            out['reglas_nuevas'].append({'nombre': r, 'texto': v['texto']})
        elif [x.upper() for x in a.reglas[r]['texto']] != [x.upper() for x in v['texto']]:
            out['reglas_cambiadas'].append({'nombre': r, 'a': a.reglas[r]['texto'], 'b': v['texto']})
    out['reglas_quitadas'] = [{'nombre': r, 'texto': v['texto']} for r, v in a.reglas.items() if r not in b.reglas]
    ca = {_norm_ctl(t) for _, t in a.controles}
    cb = {_norm_ctl(t) for _, t in b.controles}
    out['controles_nuevos'] = [t for _, t in b.controles if _norm_ctl(t) not in ca]
    out['controles_quitados'] = [t for _, t in a.controles if _norm_ctl(t) not in cb]
    out['resumen'] = {k: len(v) for k, v in out.items() if isinstance(v, list)}
    return out


def _norm_ctl(t):
    # "0:00" y "00:00:00" son la misma hora
    import re
    t = t.upper()
    t = re.sub(r'\b0?(\d{1,2}):(\d\d)(:00)?\b', lambda m: f'{int(m.group(1))}:{m.group(2)}', t)
    return ' '.join(t.split())
