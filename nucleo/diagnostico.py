"""Revisión de un modelo antes de correrlo: lo que hace fallar a EPANET o lo vuelve lento, explicado en español.

revisar(modelo) devuelve una lista de hallazgos: código, gravedad (error, aviso, info), título, qué pasa,
cómo arreglarlo y los elementos involucrados (para marcarlos en el mapa). Las distancias y cotas van en las unidades
del modelo (metros o pies, según UNITS).
"""
import math
import re
from collections import defaultdict, deque

from . import convenciones, unidades

GRAV = {'error': 0, 'aviso': 1, 'info': 2}


def H(codigo, gravedad, titulo, que_pasa, como, elementos=None, detalle=None, arreglos=None):
    return {'codigo': codigo, 'gravedad': gravedad, 'titulo': titulo, 'que_pasa': que_pasa, 'como': como,
            'elementos': elementos or [], 'detalle': detalle or [], 'arreglos': arreglos or []}


def _arreglo_union(m, n, tol, L='m'):
    """Cómo unir la punta n a la red: al nudo más cercano dentro de tol (si hay) o a la tubería más cercana."""
    p = m.coords.get(n)
    if not p:
        return None
    vec = {x for x, _ in m.adyacencia(False).get(n, [])}
    mejor_n = None
    for q, pq in m.coords.items():
        if q == n or q in vec or abs(pq[0] - p[0]) > tol or abs(pq[1] - p[1]) > tol:
            continue
        dd = math.hypot(pq[0] - p[0], pq[1] - p[1])
        if dd <= tol and (mejor_n is None or dd < mejor_n[0]):
            mejor_n = (dd, q)
    if mejor_n:
        return {'nudo': n, 'destino': mejor_n[1], 'metros': round(mejor_n[0], 3),
                'texto': f'Unir {n} con el nudo {mejor_n[1]} ({mejor_n[0]:.2f} {L})'}
    mejor_t = None
    for l, d in m.tramos.items():
        if d['tipo'] != 'pipe' or n in (d['n1'], d['n2']):
            continue
        pts = m.trazado(l)
        if not pts or min(x for x, _ in pts) - tol > p[0] or max(x for x, _ in pts) + tol < p[0] \
                or min(y for _, y in pts) - tol > p[1] or max(y for _, y in pts) + tol < p[1]:
            continue
        for a, b in zip(pts, pts[1:]):
            dd = _dist_seg(p, a, b)
            if dd <= tol and (mejor_t is None or dd < mejor_t[0]):
                mejor_t = (dd, l)
    if mejor_t:
        return {'nudo': n, 'tramo': mejor_t[1], 'x': p[0], 'y': p[1], 'metros': round(mejor_t[0], 3),
                'texto': f'Partir {mejor_t[1]} y unir {n} ahí ({mejor_t[0]:.2f} {L})'}
    return None


def _componentes(nudos, ady):
    visto, comps = set(), []
    for n in nudos:
        if n in visto:
            continue
        pila, comp = [n], []
        visto.add(n)
        while pila:
            x = pila.pop(); comp.append(x)
            for y, _ in ady.get(x, []):
                if y not in visto:
                    visto.add(y); pila.append(y)
        comps.append(comp)
    return comps


def _dist_seg(p, a, b):
    ax, ay = a; bx, by = b; px, py = p
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    u = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
    return math.hypot(px - ax - u * dx, py - ay - u * dy)


def grupo_de(m, lid, conv=None):
    return convenciones.proyecto(lid, convenciones.normalizar(conv)) or (m.tag('tramo', lid) or '')


def revisar(m, tol_punta=None, conv=None):
    sis = unidades.sistema(m)
    L = sis['longitud']
    fm = 1.0 / sis['a_metros']              # metros -> unidades de longitud del modelo
    tol_punta = tol_punta if tol_punta is not None else round(0.5 * fm, 2)
    out = []
    fuentes = {n for n, d in m.nudos.items() if d['tipo'] != 'junction'}
    texto_ctl = ' '.join(t for _, t in m.controles) + ' ' + ' '.join(' '.join(r['texto']) for r in m.reglas.values())
    palabras_ctl = set(re.findall(r'[^\s]+', texto_ctl))

    # ---------------------------------------------------------------- errores de datos
    if m.duplicados:
        out.append(H('E01', 'error', 'IDs repetidos',
                     'Dos elementos del mismo tipo tienen el mismo ID. EPANET no abre el archivo (error 215).',
                     'Cambia el ID de uno de los dos.',
                     [{'clase': c, 'id': i} for c, i in m.duplicados]))
    malos = [(l, d) for l, d in m.tramos.items() if d['n1'] not in m.nudos or d['n2'] not in m.nudos]
    if malos:
        out.append(H('E02', 'error', 'Tramos que apuntan a nudos que no existen',
                     'El tramo nombra un nudo inicial o final que no está definido. EPANET no abre el archivo (error 203).',
                     'Crea el nudo o reconecta el tramo a uno que exista.',
                     [{'clase': 'tramo', 'id': l} for l, _ in malos],
                     [f'{l}: {d["n1"]} -> {d["n2"]}' for l, d in malos[:30]]))
    iguales = [l for l, d in m.tramos.items() if d['n1'] == d['n2']]
    if iguales:
        out.append(H('E03', 'error', 'Tramos que empiezan y terminan en el mismo nudo',
                     'EPANET no acepta un tramo con los dos extremos iguales (error 222).',
                     'Reconecta un extremo al nudo correcto o borra el tramo.',
                     [{'clase': 'tramo', 'id': l} for l in iguales]))
    usados = defaultdict(int)
    for d in m.tramos.values():
        usados[d['n1']] += 1; usados[d['n2']] += 1
    huerf = [n for n in m.nudos if usados[n] == 0]
    if huerf:
        out.append(H('E04', 'error', 'Nudos sin ningún tramo',
                     'Un nudo que no toca ningún tramo deja el sistema sin solución (EPANET 2.2: error 233).',
                     'Conéctalo a la red o bórralo.', [{'clase': 'nudo', 'id': n} for n in huerf]))

    ady_todo = m.adyacencia(False)
    comps = _componentes(list(m.nudos), ady_todo)
    islas = [c for c in comps if not fuentes.intersection(c) and len(c) > 1]
    if islas:
        det, elems, arr = [], [], []
        enred = set().union(*[set(c) for c in comps if fuentes.intersection(c)]) if comps else set()
        tramos_red = [l for l, d in m.tramos.items() if d['n1'] in enred and d['n2'] in enred]
        for c in sorted(islas, key=len, reverse=True)[:15]:
            cerca = _mas_cercano(m, c, enred, tramos_red)
            tr = [l for l, d in m.tramos.items() if d['n1'] in c or d['n2'] in c]
            det.append(f'{len(c)} nudos ({", ".join(c[:6])}{"..." if len(c) > 6 else ""})'
                       + (f'. Lo más cercano a la red: {cerca[1]} está a {cerca[0]:.2f} {L} de {cerca[2]}' if cerca else ''))
            elems += [{'clase': 'nudo', 'id': n} for n in c] + [{'clase': 'tramo', 'id': l} for l in tr]
            if cerca and cerca[0] <= 2.0 * fm:
                a = _arreglo_union(m, cerca[1], max(0.5 * fm, cerca[0] * 2 + 0.05), L)
                if a:
                    arr.append(a)
        out.append(H('E05', 'error', 'Partes de la red que no llegan a ningún tanque ni embalse',
                     'Un grupo de nudos unido entre sí pero sin camino a una carga fija deja la matriz sin solución: '
                     'EPANET falla con el error 110 ("System ill-conditioned at node ..."). Suele pasar cuando una '
                     'tubería nueva se dibuja hasta "casi" un nudo existente, sin unirse a él.',
                     'Conecta el grupo a la red: reconecta el tramo al nudo existente o parte la tubería donde debe empalmar.',
                     elems, det, arr))
    faltan_pat = sorted({p for d in m.nudos.values() for p in [d.get('pat', '')] if p and p not in m.patrones}
                        | {p for v in m.demandas.values() for _, p in v if p and p not in m.patrones}
                        | {d['params'].get('PATTERN') for d in m.tramos.values() if d['tipo'] == 'pump'
                           and d['params'].get('PATTERN') and d['params'].get('PATTERN') not in m.patrones})
    if faltan_pat:
        out.append(H('E06', 'error', 'Patrones que no existen',
                     'Un nudo o bomba usa un patrón que no está en [PATTERNS]. EPANET no abre el archivo (error 205).',
                     'Crea el patrón o corrige el nombre.', [], faltan_pat[:40]))
    faltan_cur = sorted({d['params']['HEAD'] for d in m.tramos.values() if d['tipo'] == 'pump' and 'HEAD' in d['params']
                         and d['params']['HEAD'] not in m.curvas}
                        | {d['curva'] for d in m.nudos.values() if d['tipo'] == 'tank' and d.get('curva') and d['curva'] not in m.curvas}
                        | {d['consigna'] for d in m.tramos.values() if d['tipo'] == 'valve' and d['vt'] == 'GPV' and d['consigna'] not in m.curvas})
    if faltan_cur:
        out.append(H('E07', 'error', 'Curvas que no existen',
                     'Una bomba, tanque o válvula GPV usa una curva que no está en [CURVES] (error 206).',
                     'Crea la curva o corrige el nombre.', [], faltan_cur[:40]))
    ids = set(m.nudos) | set(m.tramos)
    refs_malas = []
    for i, t in m.controles:
        f = t.split()
        if len(f) > 1 and f[0].upper() == 'LINK' and f[1] not in m.tramos:
            refs_malas.append(f'Control: {t}')
        mm = re.search(r'\bNODE\s+(\S+)', t, re.I)
        if mm and mm.group(1) not in m.nudos:
            refs_malas.append(f'Control: {t}')
    for nombre, r in m.reglas.items():
        for x in r['texto'][1:]:
            mm = re.search(r'\b(LINK|PIPE|PUMP|VALVE|NODE|JUNCTION|TANK|RESERVOIR)\s+(\S+)', x, re.I)
            if mm and mm.group(2) not in ids:
                refs_malas.append(f'Regla {nombre}: {x}')
    if refs_malas:
        out.append(H('E08', 'error', 'Controles o reglas que nombran elementos que no existen',
                     'EPANET no abre el archivo si un control o regla habla de un elemento que no está (error 203/204).',
                     'Borra o corrige esas líneas.', [], refs_malas[:40]))
    pumps_sin = [l for l, d in m.tramos.items() if d['tipo'] == 'pump' and 'HEAD' not in d['params'] and 'POWER' not in d['params']]
    if pumps_sin:
        out.append(H('E09', 'error', 'Bombas sin curva ni potencia',
                     'Una bomba necesita una curva de carga o una potencia (error 226).', 'Asígnale su curva.',
                     [{'clase': 'tramo', 'id': l} for l in pumps_sin]))
    valv_tanque = [l for l, d in m.tramos.items() if d['tipo'] == 'valve' and d['vt'] in ('PRV', 'PSV', 'FCV')
                   and (d['n1'] in fuentes or d['n2'] in fuentes)]
    if valv_tanque:
        out.append(H('E10', 'error', 'Válvulas de control pegadas a un tanque o embalse',
                     'EPANET no acepta una PRV, PSV o FCV conectada directo a un tanque o embalse (error 219).',
                     'Pon un tramo corto de tubería entre la válvula y el tanque.',
                     [{'clase': 'tramo', 'id': l} for l in valv_tanque]))
    niveles = [n for n, d in m.nudos.items() if d['tipo'] == 'tank' and not d.get('curva')
               and not (d['nmin'] <= d['nini'] <= d['nmax'])]
    if niveles:
        out.append(H('E11', 'error', 'Tanques con el nivel inicial fuera de su rango',
                     'El nivel inicial tiene que estar entre el mínimo y el máximo (error 225).',
                     'Corrige el nivel inicial.', [{'clase': 'nudo', 'id': n} for n in niveles],
                     [f'{n}: inicial {m.nudos[n]["nini"]}, rango {m.nudos[n]["nmin"]}-{m.nudos[n]["nmax"]}' for n in niveles[:20]]))
    cortos = [l for l, d in m.tramos.items() if d['tipo'] == 'pipe' and (d['lon'] <= 0 or d['diam'] <= 0 or d['rug'] <= 0)]
    if cortos:
        out.append(H('E12', 'error', 'Tuberías con longitud, diámetro o rugosidad en cero o negativos',
                     'EPANET no acepta esos valores (error 211).', 'Corrige el valor.',
                     [{'clase': 'tramo', 'id': l} for l in cortos]))

    # ---------------------------------------------------------------- avisos de comportamiento
    ady_abierto = m.adyacencia(True)
    comps_ab = _componentes(list(m.nudos), ady_abierto)
    cerradas = []
    for c in comps_ab:
        if fuentes.intersection(c) or len(c) < 2:
            continue
        tr = {l for n in c for _, l in ady_abierto[n]}
        if not tr:
            continue
        grupos = sorted({grupo_de(m, l) for l in tr} - {''})
        cerradas.append((c, tr, grupos))
    if cerradas:
        det, elems = [], []
        for c, tr, g in sorted(cerradas, key=lambda x: -len(x[0]))[:25]:
            det.append(f'{len(c)} nudos ({", ".join(c[:5])}{"..." if len(c) > 5 else ""})' + (f' · {", ".join(g[:4])}' if g else ''))
            elems += [{'clase': 'nudo', 'id': n} for n in c] + [{'clase': 'tramo', 'id': l} for l in tr]
        out.append(H('A01', 'aviso', f'{len(cerradas)} grupos cerrados por todos lados (sin ninguna entrada)',
                     'Son partes de la red unidas por tramos abiertos pero aisladas por cierres. EPANET calcula cargas '
                     'arbitrarias ahí (presiones negativas falsas) y, cuando una regla cambia algo, la matriz se vuelve '
                     'singular: error 110 a mitad de la corrida.',
                     'Deja abierta una sola entrada de cada grupo (un tramo hacia la red, sin salida al otro lado). '
                     'Si el grupo no tiene demanda, no circula agua y el modelo queda estable.', elems, det))
    tanques = [n for n, d in m.nudos.items() if d['tipo'] == 'tank']
    pares = _tanques_unidos(m, tanques, ady_abierto, dif_min=2.0 * fm)
    if pares:
        det, elems = [], []
        for a, b, camino in pares[:20]:
            da, db = m.nudos[a], m.nudos[b]
            det.append(f'{a} {da["com"]} (fondo {da["cota"]:g} {L}) <-> {b} {db["com"]} (fondo {db["cota"]:g} {L}) por {", ".join(camino[:5])}'
                       + ('...' if len(camino) > 5 else ''))
            elems += [{'clase': 'nudo', 'id': a}, {'clase': 'nudo', 'id': b}] + [{'clase': 'tramo', 'id': l} for l in camino]
        out.append(H('A02', 'aviso', 'Tanques unidos por una conducción sin válvula ni regla',
                     'Dos tanques comunicados por tuberías libres se pasan el agua de uno a otro: cuando uno se llena, '
                     'EPANET cierra y abre el tramo cada pocos segundos. La corrida da miles de pasos intermedios y '
                     'muchos no convergen: es la causa más común de una corrida que tarda minutos en vez de segundos.',
                     'Pon una válvula con control por nivel en la entrada del tanque que se llena (que cierre con el tanque '
                     'alto y abra con el tanque bajo) o deja la conducción cerrada si el proyecto no va en esa configuración.',
                     elems, det))
    sin_ctl = [l for l, d in m.tramos.items() if d['tipo'] == 'pump' and l not in palabras_ctl and not m.cerrado_al_inicio(l)]
    if sin_ctl:
        out.append(H('A03', 'aviso', 'Bombas prendidas sin control ni regla',
                     'La bomba arranca prendida y nunca se apaga: bombea las 24 horas, aunque el tanque al que llega esté lleno.',
                     'Agrega reglas de arranque y parada por nivel del tanque que llena, o ciérrala si no va.',
                     [{'clase': 'tramo', 'id': l} for l in sin_ctl]))
    power = [l for l, d in m.tramos.items() if d['tipo'] == 'pump' and 'POWER' in d['params'] and not m.cerrado_al_inicio(l)]
    if power:
        out.append(H('A04', 'aviso', 'Bombas de potencia constante abiertas',
                     'Una bomba definida solo por potencia (POWER) da una carga infinita cuando el caudal tiende a cero; '
                     'con el tanque de llegada lleno o la succión cerrada, la matriz se vuelve inestable.',
                     'Usa la curva de la bomba real (HEAD curva).', [{'clase': 'tramo', 'id': l} for l in power]))
    cero = [n for n, d in m.nudos.items() if d['tipo'] == 'junction' and abs(d['cota']) < 1]
    raros = []
    for n, d in m.nudos.items():
        if d['tipo'] != 'junction' or abs(d['cota']) < 1:
            continue
        v = sorted(m.nudos[x]['cota'] for x, _ in ady_todo.get(n, []) if x in m.nudos and m.nudos[x]['tipo'] == 'junction'
                   and abs(m.nudos[x]['cota']) > 1)
        if v and abs(d['cota'] - v[len(v) // 2]) > 150 * fm:
            raros.append(n)
    if cero or raros:
        out.append(H('A05', 'aviso', 'Nudos con cota 0 o muy distinta a la de sus vecinos',
                     'La cota no cambia el cálculo de caudales con demanda fija, pero las presiones de esos nudos salen '
                     'absurdas: con cota 0, la presión es igual a toda la carga hidráulica.',
                     'Pon la cota del terreno (Cauce propone una a partir de los nudos vecinos al editar).',
                     [{'clase': 'nudo', 'id': n} for n in cero + raros],
                     [f'{len(cero)} con cota 0' + (f': {", ".join(cero[:12])}' if cero else ''),
                      f'{len(raros)} muy distintas de sus vecinos' + (f': {", ".join(raros[:12])}' if raros else '')]))
    puntas = _puntas(m, ady_todo, tol_punta)
    if puntas:
        out.append(H('A06', 'aviso', f'Puntas sueltas a menos de {tol_punta:g} {L} de otro elemento',
                     'Un nudo que termina un tramo y queda casi encima de otro nudo o tubería sin estar unido: '
                     'casi siempre es una conexión que se quiso hacer y no quedó.',
                     'Si era una conexión, reconecta el tramo o parte la tubería en ese punto.',
                     [{'clase': 'nudo', 'id': n} for n, _, _ in puntas],
                     [f'{n} a {dd:.2f} {L} de {que}' for n, dd, que in puntas[:30]],
                     [a for a in (_arreglo_union(m, n, tol_punta, L) for n, _, _ in puntas[:30]) if a]))
    serie = _valvulas_serie(m)
    if serie:
        out.append(H('A07', 'aviso', 'Válvulas de control que comparten nudo',
                     'Dos PRV, PSV o FCV seguidas sin nada entre ellas se pelean por el mismo nudo; EPANET puede dar '
                     'error 220 o no converger.', 'Revisa si sobran o separa con un tramo de tubería.',
                     [{'clase': 'tramo', 'id': l} for par in serie for l in par],
                     [f'{a} y {b}' for a, b in serie[:20]]))
    nombres = [f[1] for f in m.filas('[RULES]') if f[0].upper() == 'RULE' and len(f) > 1]
    rep = sorted({x for x in nombres if nombres.count(x) > 1})
    if rep:
        out.append(H('A08', 'aviso', 'Reglas con el nombre repetido',
                     'Dos reglas con el mismo nombre confunden la revisión y una puede quedar tapando a la otra.',
                     'Renombra una de las dos.', [], rep))
    mezcla = _quinquenios_mezclados(m, conv)
    if mezcla:
        prendidos, apagados = mezcla
        out.append(H('A09', 'aviso', 'Obras de un quinquenio posterior prendidas con otras anteriores apagadas',
                     'Un proyecto de un año posterior tiene todos sus tramos abiertos mientras otro de un año anterior '
                     'está apagado: el modelo no corresponde a ningún quinquenio, y la obra posterior puede llevar '
                     'cientos de L/s que en ese año todavía no existen.',
                     'Si es a propósito, ignóralo. Para un quinquenio limpio usa Escenario › Armar quinquenio: prende '
                     'todo lo de ese año para atrás y apaga lo de después.',
                     [{'clase': 'tramo', 'id': l} for _, _, ls in prendidos for l in ls],
                     [f'{g} ({a}) prendido: {len(ls)} tramos abiertos' for g, a, ls in prendidos[:15]]
                     + ['Apagados de antes: ' + ', '.join(f'{g} ({a})' for g, a in apagados[:12])]))
    escala = _escala_coords(m)
    cortas = _bombas_que_no_levantan(m, ady_abierto)
    if cortas:
        out.append(H('A10', 'aviso', 'Bombas que no alcanzan a subir el agua al tanque',
                     'La carga de la bomba a caudal cero (lo máximo que da según su curva) es menor que el desnivel entre '
                     'el tanque de succión lleno y el de llegada vacío: la bomba nunca entrega agua y EPANET avisa que no '
                     'da la carga.',
                     'Revisa la curva (o la velocidad) de la bomba, o a qué tanques llega.',
                     [{'clase': 'tramo', 'id': l} for l, *_ in cortas],
                     [f'{l}: da {h0:.1f} {L} a caudal 0; de {a} lleno a {b} vacío hay {lift:.1f} {L}' for l, h0, a, b, lift in cortas[:20]]))
    fuera, vacio = _umbrales_tanques(m)
    if fuera or vacio:
        out.append(H('A11', 'aviso', 'Reglas de nivel que no caben en el tanque o lo dejan casi vacío',
                     'Un control o regla compara el nivel del tanque con un valor fuera de su rango (nunca se cumple, o '
                     'siempre), o todos sus umbrales están en el 30 % de abajo: el tanque trabaja casi vacío y cualquier '
                     'pico lo seca (por ejemplo, 1 y 2,2 m en un tanque de 11 m).',
                     'Pon los umbrales dentro del rango, con margen arriba y abajo.',
                     [{'clase': 'nudo', 'id': t} for t, *_ in fuera + vacio],
                     [f'{t} {com}: rango {lo:g}-{hi:g} {L}, umbrales {", ".join(f"{v:g}" for v in vs)} (fuera de rango)' for t, com, lo, hi, vs in fuera[:15]]
                     + [f'{t} {com}: rango {lo:g}-{hi:g} {L}, umbrales {", ".join(f"{v:g}" for v in vs)} (casi vacío)' for t, com, lo, hi, vs in vacio[:15]]))
    if escala:
        k = fm / escala                 # metros -> unidades de las coordenadas
        lejos = _bombas_lejanas(m, 5000.0 * k)
        if lejos:
            out.append(H('A12', 'aviso', 'Reglas que prenden o apagan una bomba lejos de su tanque',
                         'La regla mira el nivel de un tanque pero manda una bomba a más de 5 km de él: casi siempre es el '
                         'ID de otra estación (un ID recortado o copiado, como PU235 en vez de PU235_VER).',
                         'Corrige el ID de la bomba en la regla.',
                         [{'clase': 'tramo', 'id': p} for _, p, _, _ in lejos],
                         [f'Regla {r}: {p} está a {dd / k / 1000:.1f} km de {t}' for r, p, t, dd in lejos[:20]]))
        dup = _duplicadas(m, k)
        # una copia sobrante tiene el mismo diámetro; una conducción en paralelo a propósito
        # suele ser una tubería nueva de otro diámetro junto a la vieja
        iguales = [x for x in dup if abs(m.tramos[x[0]]['diam'] - m.tramos[x[1]]['diam']) <= 0.01 * max(m.tramos[x[0]]['diam'], 1e-9)]
        distintos = [x for x in dup if x not in iguales]
        linea = lambda a, b, lg: f'{a} y {b}: {lg * escala:.0f} {L} juntas · diámetros {m.tramos[a]["diam"]:g} y {m.tramos[b]["diam"]:g}'  # noqa: E731
        if iguales:
            out.append(H('A13', 'aviso', 'Tuberías abiertas dibujadas una encima de otra',
                         'Dos tuberías abiertas del mismo diámetro por el mismo recorrido (o entre los mismos nudos con el '
                         'mismo largo) suman su capacidad: si una sobra, el modelo lleva más agua de la real por ahí. Así '
                         'quedan los empalmes que parte un script sin borrar el tramo viejo.',
                         'Si es a propósito, ignóralo; si no, cierra o borra la que sobra.',
                         [{'clase': 'tramo', 'id': l} for a, b, _ in iguales for l in (a, b)],
                         [linea(*x) for x in iguales[:25]]
                         + ([f'Además {len(distintos)} pares de diámetro distinto (suelen ser conducciones en paralelo): '
                             + ', '.join(f'{a}/{b}' for a, b, _ in distintos[:8]) + ('…' if len(distintos) > 8 else '')] if distintos else [])))
        elif distintos:
            out.append(H('I05', 'info', 'Tuberías en paralelo por el mismo recorrido',
                         'Pares de tuberías abiertas de distinto diámetro dibujadas juntas: casi siempre una conducción '
                         'nueva junto a la vieja, a propósito.', 'Revisa que las dos deban ir abiertas.',
                         [{'clase': 'tramo', 'id': l} for a, b, _ in distintos for l in (a, b)], [linea(*x) for x in distintos[:25]]))

    # ---------------------------------------------------------------- información
    op = m.opciones('[OPTIONS]')
    defecto = {'ACCURACY': '0.001', 'TRIALS': '200', 'UNBALANCED': 'STOP', 'VISCOSITY': '1', 'CHECKFREQ': '2',
               'MAXCHECK': '10', 'DAMPLIMIT': '0'}
    faltan = [k for k in defecto if k not in op]
    if faltan:
        out.append(H('I01', 'info', 'Opciones que no están en el archivo',
                     f'EPANET usa sus valores por defecto: {", ".join(f"{k} {defecto[k]}" for k in faltan)}. '
                     'Suele pasar cuando otro programa guarda el .inp.',
                     'Si tu equipo trabaja con otros valores, ponlos en Datos > Opciones.', [],
                     faltan))
    q = op.get('QUALITY', 'NONE').upper()
    if q and not q.startswith('NONE'):
        out.append(H('I02', 'info', f'La calidad del agua está activa ({op.get("QUALITY")})',
                     'Además de la hidráulica, EPANET calcula la calidad en cada paso: la corrida tarda más.',
                     'Para escenarios solo hidráulicos, pon QUALITY NONE en una copia.', []))
    c24 = [t for _, t in m.controles if re.search(r'CLOCKTIME\s+24:00', t, re.I)]
    if c24:
        out.append(H('I03', 'info', 'Controles a las 24:00',
                     'Un control "AT CLOCKTIME 24:00" equivale a la medianoche siguiente: en una corrida de 24 h no '
                     'llega a ejecutarse. Algunos programas los borran al guardar.', 'Si importa, ponlo a las 0:00.', [], c24))
    sin_xy = [n for n in m.nudos if n not in m.coords]
    if sin_xy:
        out.append(H('I04', 'info', 'Nudos sin coordenadas', 'No se dibujan en el mapa; el cálculo no cambia.',
                     'Agrega sus coordenadas.', [], sin_xy[:30]))
    sin_uso = _patrones_sin_uso(m)
    if sin_uso:
        out.append(H('I06', 'info', f'{len(sin_uso)} patrones que nadie usa',
                     'Están en [PATTERNS] pero ningún nudo, embalse, bomba ni opción los nombra: no cambian el cálculo. '
                     'Si alguno debía ir en unos nudos (por ejemplo, uno nuevo de demanda), falta asignarlo.',
                     'Asígnalo en la ficha de los nudos (o con una edición en grupo), o bórralo en Datos › Patrones.',
                     [], sin_uso[:60]))
    out.sort(key=lambda h: (GRAV[h['gravedad']], h['codigo']))
    return out


def _mas_cercano(m, comp, enred, tramos_red):
    mejor = None
    for n in comp:
        p = m.coords.get(n)
        if not p:
            continue
        for l in tramos_red:
            pts = m.trazado(l)
            bx = (min(x for x, _ in pts), max(x for x, _ in pts), min(y for _, y in pts), max(y for _, y in pts))
            if p[0] < bx[0] - 50 or p[0] > bx[1] + 50 or p[1] < bx[2] - 50 or p[1] > bx[3] + 50:
                continue
            for a, b in zip(pts, pts[1:]):
                dd = _dist_seg(p, a, b)
                if mejor is None or dd < mejor[0]:
                    mejor = (dd, n, f'la tubería {l}')
        for q in enred:
            pq = m.coords.get(q)
            if pq and abs(pq[0] - p[0]) < 50 and abs(pq[1] - p[1]) < 50:
                dd = math.hypot(p[0] - pq[0], p[1] - pq[1])
                if mejor is None or dd < mejor[0]:
                    mejor = (dd, n, f'el nudo {q}')
    return mejor


def _tanques_unidos(m, tanques, ady, max_saltos=25, dif_min=2.0):
    """Pares de tanques unidos por tuberías abiertas cuyo recorrido no tiene demanda ni válvulas ni bombas."""
    pares, vistos = [], set()
    ts = set(tanques)
    for t0 in tanques:
        prev = {t0: None}
        q = deque([(t0, 0)])
        while q:
            x, k = q.popleft()
            if k >= max_saltos:
                continue
            for y, l in ady.get(x, []):
                if y in prev:
                    continue
                d = m.tramos[l]
                if d['tipo'] != 'pipe' or d.get('vt') == 'CV':
                    continue
                if y in ts:
                    clave = tuple(sorted((t0, y)))
                    if clave not in vistos:
                        a, b = m.nudos[t0], m.nudos[y]
                        # fondos casi a la misma altura: compartimientos de un mismo tanque, no una conducción
                        if abs(a['cota'] - b['cota']) >= dif_min:
                            camino = [l]
                            z = x
                            while prev[z] is not None:
                                z, lz = prev[z]
                                camino.append(lz)
                            pares.append((t0, y, camino[::-1]))
                        vistos.add(clave)
                    continue
                dy = m.nudos.get(y, {})
                if dy.get('tipo') != 'junction' or abs(dy.get('dem', 0)) > 1e-9 or y in m.demandas:
                    continue
                prev[y] = (x, l)
                q.append((y, k + 1))
    return pares


def _puntas(m, ady, tol):
    cel = 25.0
    celdas = defaultdict(list)
    for n, p in m.coords.items():
        celdas[(int(p[0] // cel), int(p[1] // cel))].append(n)
    segs = defaultdict(list)
    for l in m.tramos:
        pts = m.trazado(l)
        for a, b in zip(pts, pts[1:]):
            for cx in range(int(min(a[0], b[0]) // cel), int(max(a[0], b[0]) // cel) + 1):
                for cy in range(int(min(a[1], b[1]) // cel), int(max(a[1], b[1]) // cel) + 1):
                    segs[(cx, cy)].append((l, a, b))
    out = []
    for n in m.nudos:
        if len(ady.get(n, [])) != 1 or n not in m.coords:
            continue
        p = m.coords[n]
        vecino = ady[n][0][0]
        cx, cy = int(p[0] // cel), int(p[1] // cel)
        cerca = []
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                for q in celdas.get((cx + i, cy + j), []):
                    if q != n and q != vecino:
                        dd = math.hypot(p[0] - m.coords[q][0], p[1] - m.coords[q][1])
                        if dd < tol:
                            cerca.append((dd, f'el nudo {q}'))
                for l, a, b in segs.get((cx + i, cy + j), []):
                    d = m.tramos[l]
                    if n in (d['n1'], d['n2']) or vecino in (d['n1'], d['n2']):
                        continue
                    dd = _dist_seg(p, a, b)
                    if dd < tol:
                        cerca.append((dd, f'la tubería {l}'))
        if cerca:
            dd, que = min(cerca)
            out.append((n, dd, que))
    return sorted(out, key=lambda x: x[1])


def _quinquenios_mezclados(m, conv):
    """([(grupo, año, tramos)] prendidos, [(grupo, año)] apagados de antes) o None. Grupo = proyecto según el ID
    (regla de Ajustes) o, sin regla, la etiqueta de horizonte. Prendido = ningún tramo cerrado; apagado = la mitad o
    más cerrados (el resto puede ser la entrada que se deja abierta)."""
    conv = convenciones.normalizar(conv)
    grupos = defaultdict(list)
    for l in m.tramos:
        if conv.get('proyecto'):
            # con regla de proyectos, lo que no la cumple (válvulas metidas en tuberías existentes...) no es un grupo
            g = convenciones.proyecto(l, conv)
        else:
            t = m.tag('tramo', l)
            g = t if convenciones.horizonte(t, conv) else None
        if g:
            grupos[g].append(l)
    prendidos, apagados = [], []
    for g, ls in grupos.items():
        anios = [a for a in (convenciones.horizonte(m.tag('tramo', l), conv) for l in ls) if a]
        if not anios:
            continue
        a = max(set(anios), key=anios.count)
        c = sum(1 for l in ls if m.cerrado_al_inicio(l))
        if c == 0:
            prendidos.append((g, a, ls))
        elif c * 2 >= len(ls):
            apagados.append((g, a))
    if not apagados:
        return None
    primero = min(a for _, a in apagados)
    mal = sorted([p for p in prendidos if p[1] > primero], key=lambda p: (p[1], p[0]))
    if not mal:
        return None
    return mal, sorted([x for x in apagados if x[1] < mal[-1][1]], key=lambda x: (x[1], x[0]))


def _escala_coords(m):
    """Longitud de las tuberías / distancia entre sus nudos en el mapa (mediana de las rectas). ~1 cuando las
    coordenadas van en las mismas unidades que las longitudes; None si no (planos sin escala, Net1...)."""
    r = []
    for l, d in m.tramos.items():
        if d['tipo'] != 'pipe' or d['lon'] <= 0 or m.vertices.get(l):
            continue
        a, b = m.coords.get(d['n1']), m.coords.get(d['n2'])
        if a and b:
            dd = math.hypot(a[0] - b[0], a[1] - b[1])
            if dd > 0:
                r.append(d['lon'] / dd)
        if len(r) >= 3000:
            break
    if len(r) < 10:
        return None
    r.sort()
    e = r[len(r) // 2]
    return e if 0.5 <= e <= 2.0 else None


def _carga_a_caudal_cero(m, l):
    """Lo máximo que da la bomba según su curva (con la velocidad del archivo), o None si no tiene curva."""
    d = m.tramos[l]
    pts = m.curvas.get(d['params'].get('HEAD', ''))
    if not pts:
        return None
    if len(pts) == 1:
        h0 = 4.0 / 3.0 * pts[0][1]                        # como EPANET con la curva de un punto
    elif pts[0][0] <= 0:
        h0 = pts[0][1]
    else:
        (q1, h1), (q2, h2) = pts[0], pts[1]
        h0 = h1 + (h1 - h2) * q1 / (q2 - q1) if q2 != q1 else h1
    try:
        v = float(d['params'].get('SPEED', 1) or 1)
    except ValueError:
        v = 1.0
    return max(h0, max(h for _, h in pts)) * v * v


def _fuente_cercana(m, n0, ady, sin):
    """Tanque o embalse más cercano (en saltos) desde n0 por tramos abiertos, sin pasar por bombas."""
    vis, q = {n0}, deque([(n0, 0)])
    while q:
        x, k = q.popleft()
        if m.nudos.get(x, {}).get('tipo') in ('tank', 'reservoir'):
            return x
        if k > 60:
            continue
        for y, l in ady.get(x, []):
            if y not in vis and l != sin and m.tramos[l]['tipo'] != 'pump':
                vis.add(y); q.append((y, k + 1))
    return None


def _bombas_que_no_levantan(m, ady):
    def carga(n, lleno):
        d = m.nudos[n]
        return d['cota'] if d['tipo'] == 'reservoir' else d['cota'] + (d['nmax'] if lleno else d['nmin'])
    out = []
    for l, d in m.tramos.items():
        if d['tipo'] != 'pump':
            continue
        h0 = _carga_a_caudal_cero(m, l)
        if h0 is None:
            continue
        a, b = _fuente_cercana(m, d['n1'], ady, l), _fuente_cercana(m, d['n2'], ady, l)
        if a and b and a != b:
            lift = carga(b, False) - carga(a, True)
            if lift > h0:
                out.append((l, h0, a, b, lift))
    return out


_RE_NIVEL = re.compile(r'\bTANK\s+(\S+)\s+LEVEL\s*(?:<=|>=|<|>|=|BELOW|ABOVE)\s*([-\d.]+)', re.I)
_RE_CTL_NIVEL = re.compile(r'\bNODE\s+(\S+)\s+(?:BELOW|ABOVE)\s+([-\d.]+)', re.I)


def _umbrales_tanques(m):
    vals = defaultdict(list)
    lineas = [t for _, t in m.controles] + [x for r in m.reglas.values() for x in r['texto']]
    for t in lineas:
        for rx in (_RE_NIVEL, _RE_CTL_NIVEL):
            for tq, v in rx.findall(t):
                if m.nudos.get(tq, {}).get('tipo') == 'tank' and not m.nudos[tq].get('curva'):
                    try:
                        vals[tq].append(float(v))
                    except ValueError:
                        pass
    fuera, vacio = [], []
    for tq, vs in vals.items():
        d = m.nudos[tq]
        lo, hi = d['nmin'], d['nmax']
        vs = sorted(set(vs))
        if any(v < lo - 1e-6 or v > hi + 1e-6 for v in vs):
            fuera.append((tq, d['com'], lo, hi, vs))
        elif hi - lo > 0 and vs[-1] <= lo + 0.3 * (hi - lo):
            vacio.append((tq, d['com'], lo, hi, vs))
    return fuera, vacio


def _bombas_lejanas(m, umbral):
    """[(regla, bomba, tanque, distancia en coordenadas)] de reglas por nivel que mandan una bomba lejos del tanque."""
    out = []
    for nombre, r in m.reglas.items():
        tanques = [t for x in r['texto'] for t, _ in _RE_NIVEL.findall(x) if t in m.coords]
        if not tanques:
            continue
        for x in r['texto']:
            for p in re.findall(r'\bPUMP\s+(\S+)', x, re.I):
                d = m.tramos.get(p)
                if not d or d['n1'] not in m.coords:
                    continue
                dd, t = min((math.dist(m.coords[d['n1']], m.coords[t]), t) for t in tanques)
                if dd > umbral and (nombre, p) not in {(a, b) for a, b, _, _ in out}:
                    out.append((nombre, p, t, dd))
    return out


def _duplicadas(m, k):
    """Pares de tuberías abiertas con el 80 % o más del recorrido a menos de 1 m (y al menos 15 m así), o entre los
    mismos nudos con el largo parecido. k = metros -> unidades de las coordenadas. Devuelve (a, b, largo junto)."""
    tol, paso, minimo, cel = 1.0 * k, 4.0 * k, 15.0 * k, 10.0 * k
    geo = {l: m.trazado(l) for l, d in m.tramos.items()
           if d['tipo'] == 'pipe' and not m.cerrado_al_inicio(l) and len(m.trazado(l)) >= 2}
    celda = defaultdict(set)
    for l, pts in geo.items():
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            for gx in range(int(min(x0, x1) // cel), int(max(x0, x1) // cel) + 1):
                for gy in range(int(min(y0, y1) // cel), int(max(y0, y1) // cel) + 1):
                    celda[(gx, gy)].add(l)
    pares = {}
    for l, pts in geo.items():
        largo = sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))
        if largo < minimo:
            continue
        ms = []
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            n = max(1, int(math.hypot(x1 - x0, y1 - y0) // paso))
            ms += [(x0 + (x1 - x0) * j / n, y0 + (y1 - y0) * j / n) for j in range(n)]
        ms.append(pts[-1])
        cuenta = defaultdict(int)
        for p in ms:
            for o in celda.get((int(p[0] // cel), int(p[1] // cel)), ()):
                if o != l and any(_dist_seg(p, a, b) < tol for a, b in zip(geo[o], geo[o][1:])):
                    cuenta[o] += 1
        for o, c in cuenta.items():
            f = c / len(ms)
            if f >= 0.8 and f * largo >= minimo:
                pares.setdefault(frozenset((l, o)), (l, o, f * largo))
    mismos = defaultdict(list)
    for l in geo:
        d = m.tramos[l]
        mismos[frozenset((d['n1'], d['n2']))].append(l)
    for ls in mismos.values():
        for i in range(len(ls)):
            for j in range(i + 1, len(ls)):
                a, b = m.tramos[ls[i]], m.tramos[ls[j]]
                if abs(a['lon'] - b['lon']) <= 0.1 * max(a['lon'], b['lon'], 1e-9):
                    lg = sum(math.dist(p, q) for p, q in zip(geo[ls[i]], geo[ls[i]][1:]))
                    pares.setdefault(frozenset((ls[i], ls[j])), (ls[i], ls[j], lg))
    return sorted(pares.values(), key=lambda x: -x[2])


def _patrones_sin_uso(m):
    usados = {d.get('pat') for d in m.nudos.values()} | {p for v in m.demandas.values() for _, p in v}
    usados |= {d['params'].get('PATTERN') for d in m.tramos.values() if d['tipo'] == 'pump'}
    usados |= {v for (_, k), v in m.energia_bomba.items() if k == 'PATTERN'}
    for s in ('[ENERGY]', '[SOURCES]', '[OPTIONS]'):
        usados |= {x for f in m.filas(s) for x in f}
    return [p for p in m.patrones if p not in usados]


def _valvulas_serie(m):
    por_nudo = defaultdict(list)
    for l, d in m.tramos.items():
        if d['tipo'] == 'valve' and d['vt'] in ('PRV', 'PSV', 'FCV'):
            por_nudo[d['n1']].append(l); por_nudo[d['n2']].append(l)
    pares = set()
    for n, ls in por_nudo.items():
        if len(ls) > 1:
            for i in range(len(ls)):
                for j in range(i + 1, len(ls)):
                    pares.add(tuple(sorted((ls[i], ls[j]))))
    return sorted(pares)
