"""Ayuda para las consignas de las FCV que llenan tanques.

Se corre el modelo en estático con todos los patrones de demanda en 1, para ver en promedio cuánto le pide la red a
cada tanque. Si un tanque pierde agua (sale más de lo que entra), las FCV que lo llenan deben subir al menos esa
diferencia, un poco más (margen); si gana mucha, pueden bajar. Es un punto de partida para afinar con la corrida
de 24 h y el balance producción/consumo, no un resultado final.
"""
from collections import deque

from . import inp, motor, unidades


def valvulas_a_tanque(m, max_saltos=80):
    """FCV -> tanque que llena: el primero que se encuentra aguas abajo por tuberías y TCV."""
    ady = m.adyacencia(False)
    destino = {}
    for v, d in m.tramos.items():
        if d['tipo'] != 'valve' or d['vt'] != 'FCV':
            continue
        q = deque([(d['n2'], 0)])
        visto = {d['n1'], d['n2']}
        hallado = None
        while q and not hallado:
            x, k = q.popleft()
            if m.nudos.get(x, {}).get('tipo') == 'tank':
                hallado = x
                break
            if k >= max_saltos or m.nudos.get(x, {}).get('tipo') == 'reservoir':
                continue
            for y, l in ady.get(x, []):
                dl = m.tramos[l]
                if y in visto or l == v:
                    continue
                if dl['tipo'] == 'pump' or (dl['tipo'] == 'valve' and dl['vt'] in ('FCV', 'PRV', 'PSV')):
                    continue
                visto.add(y)
                q.append((y, k + 1))
        if hallado:
            destino[v] = hallado
    return destino


def analizar(texto, version='2.3', margen=0.05):
    m = inp.Modelo(texto)
    r = motor.caudales_medios(texto, version)
    k = 1.0                                   # en las unidades de caudal del propio modelo
    nodos, tramos = r['nudos'], r['tramos']
    dest = valvulas_a_tanque(m)
    por_tanque = {}
    for v, t in dest.items():
        por_tanque.setdefault(t, []).append(v)
    filas, sin_valv = [], []
    for t, d in m.nudos.items():
        if d['tipo'] != 'tank' or t not in nodos:
            continue
        entra = sale = 0.0
        for l, dl in m.tramos.items():
            if l not in tramos or t not in (dl['n1'], dl['n2']):
                continue
            q = tramos[l]['caudal'] * k
            if dl['n2'] == t:
                entra += max(q, 0); sale += max(-q, 0)
            else:
                sale += max(q, 0); entra += max(-q, 0)
        neto = nodos[t]['demanda'] * k
        fila = {'tanque': t, 'nombre': d['com'], 'entra': round(entra, 2), 'sale': round(sale, 2), 'neto': round(neto, 2)}
        vs = por_tanque.get(t, [])
        if not vs:
            if abs(neto) > 1:
                sin_valv.append(fila)
            continue
        abiertas = [v for v in vs if tramos.get(v, {}).get('estado', 0) > 0 or m.estado_inicial(v) not in ('CLOSED',)]
        base = [max(0.0, inp.num(m.tramos[v]['consigna'])) for v in vs]
        total = sum(b for v, b in zip(vs, base) if v in abiertas)
        props = []
        for v, b in zip(vs, base):
            cerrada = v not in abiertas or m.estado_inicial(v) == 'CLOSED'
            share = (b / total) if total > 0 else (1 / max(1, len(abiertas)))
            if cerrada:
                nueva = None
            elif neto < 0:
                nueva = b + (-neto) * (1 + margen) * share
            elif neto > 0.02 * max(entra, 1):
                nueva = max(0.0, b - neto * share)
            else:
                nueva = b
            props.append({'valvula': v, 'nombre': m.tramos[v]['com'], 'consigna': round(b, 2),
                          'caudal': round(tramos.get(v, {}).get('caudal', 0) * k, 2),
                          'cerrada': cerrada, 'propuesta': None if nueva is None else round(nueva, 2)})
        fila['valvulas'] = props
        fila['estado'] = 'pierde' if neto < -1 else ('gana' if neto > 1 else 'equilibrado')
        filas.append(fila)
    prod = -sum(n['demanda'] for n in nodos.values() if n['tipo'] == 1) * k
    cons = sum(n['demanda'] for n in nodos.values() if n['tipo'] == 0 and n['demanda'] > 0) * k
    filas.sort(key=lambda f: f['neto'])
    return {'unidades': unidades.sistema(m)['caudal'], 'margen': margen, 'produccion': round(prod, 1), 'consumo': round(cons, 1),
            'diferencia_pct': round(100 * (prod - cons) / cons, 2) if cons else None,
            'tanques': filas, 'sin_valvula': sorted(sin_valv, key=lambda f: f['neto'])}
