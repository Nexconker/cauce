"""El motor de cálculo de EPANET (la misma DLL que usa el programa) llamado desde Python con ctypes.

Hay dos versiones en Cauce/motor: epanet2_22.dll (2.2, la del programa EPANET de escritorio más usado) y
epanet2_23.dll (2.3.5, más rápida y estable). correr() hace la simulación hidráulica paso a paso y guarda:
resultados en cada hora de reporte (presión, carga y demanda de nudos; caudal, velocidad y estado de tramos),
cuántos pasos hubo y cuántos no convergieron, los avisos de EPANET, el balance producción/consumo, qué se queda
oscilando (con el reporte de estados de EPANET), la energía de cada bomba y, si falla, en qué nudo y qué quedó
aislado. Si el modelo tiene calidad del agua (QUALITY distinto de NONE), después corre la calidad sobre la
hidráulica guardada y agrega la calidad de nudos y tramos en las mismas horas.
"""
import ctypes as C
import math
import os
import re
import tempfile
import threading
import time
from array import array
from collections import Counter

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DLLS = {'2.2': os.path.join(RAIZ, 'motor', 'epanet2_22.dll'), '2.3': os.path.join(RAIZ, 'motor', 'epanet2_23.dll')}
_CARGADAS = {}
_LOCK = threading.Lock()

AVISOS = {1: 'El sistema no se equilibra (no converge)', 2: 'Hidráulica inestable', 3: 'Hay nudos desconectados',
          4: 'Bombas que no dan la carga pedida', 5: 'Válvulas que no dan la presión o el caudal pedidos',
          6: 'Presiones negativas'}
UNIDADES = {0: 'CFS', 1: 'GPM', 2: 'MGD', 3: 'IMGD', 4: 'AFD', 5: 'LPS', 6: 'LPM', 7: 'MLD', 8: 'CMH', 9: 'CMD', 10: 'CMS'}
A_M3S = {'LPS': 1e-3, 'LPM': 1e-3 / 60, 'MLD': 1e3 / 86400, 'CMH': 1 / 3600, 'CMD': 1 / 86400, 'CMS': 1.0,
         'CFS': 0.0283168, 'GPM': 6.309e-5, 'MGD': 0.0438126, 'IMGD': 0.0526168, 'AFD': 0.0142764}
TIPO_TRAMO = {0: 'CV', 1: 'PIPE', 2: 'PUMP', 3: 'PRV', 4: 'PSV', 5: 'PBV', 6: 'FCV', 7: 'TCV', 8: 'GPV', 9: 'PCV'}
# propiedades del toolkit
N_DEMANDA, N_CARGA, N_PRESION, N_CALIDAD = 9, 10, 11, 12
L_CAUDAL, L_VELOCIDAD, L_ESTADO, L_CONSIGNA, L_ENERGIA, L_CALIDAD, L_EFIC, L_PRECIO, L_PATRON_PRECIO = 8, 9, 11, 12, 13, 14, 17, 21, 22
# EN_gettimeparam: 3 es el paso de los patrones y 4 su inicio; 5 y 6 son el paso y el inicio de los resultados
T_DURACION, T_PASO_H, T_PASO_PAT, T_INICIO_PAT, T_PASO_REP, T_INICIO_REP = 0, 1, 3, 4, 5, 6
QUALITY = {0: 'NONE', 1: 'CHEMICAL', 2: 'AGE', 3: 'TRACE'}


def dll(version):
    with _LOCK:
        if version not in _CARGADAS:
            _CARGADAS[version] = C.WinDLL(DLLS[version])
        return _CARGADAS[version]


class Proyecto:
    """Un proyecto del toolkit (EN_createproject): cada corrida tiene el suyo, así pueden ir en paralelo."""

    def __init__(self, version):
        self.version = version
        self.d = dll(version)
        self.ph = C.c_void_p()
        self.ok(self.d.EN_createproject(C.byref(self.ph)))
        self.en_bloque = hasattr(self.d, 'EN_getlinkvalues')

    def msg(self, code):
        b = C.create_string_buffer(256)
        self.d.EN_geterror(code, b, 255)
        return b.value.decode('latin-1')

    def ok(self, code, que=''):
        if code > 100:
            raise ErrorMotor(code, f'{que}: {self.msg(code)}' if que else self.msg(code))
        return code

    def i(self, fn, *a):
        v = C.c_int()
        self.ok(getattr(self.d, fn)(self.ph, *a, C.byref(v)), fn)
        return v.value

    def f(self, fn, *a):
        v = C.c_double()
        self.ok(getattr(self.d, fn)(self.ph, *a, C.byref(v)), fn)
        return v.value

    def l(self, fn, *a):
        v = C.c_long()
        self.ok(getattr(self.d, fn)(self.ph, *a, C.byref(v)), fn)
        return v.value

    def ident(self, fn, k):
        b = C.create_string_buffer(64)
        self.ok(getattr(self.d, fn)(self.ph, k, b), fn)
        return b.value.decode('latin-1')

    def valores(self, que, prop, n, buf):
        if self.en_bloque:
            self.ok(getattr(self.d, f'EN_get{que}values')(self.ph, prop, buf))
            return buf
        fn, v = getattr(self.d, f'EN_get{que}value'), C.c_double()
        for k in range(n):
            fn(self.ph, k + 1, prop, C.byref(v))
            buf[k] = v.value
        return buf

    def cerrar(self):
        try:
            self.d.EN_close(self.ph)
        finally:
            self.d.EN_deleteproject(self.ph)


class ErrorMotor(Exception):
    def __init__(self, code, texto):
        super().__init__(texto)
        self.code = code


def version_dll(version):
    v = C.c_int()
    dll(version).EN_getversion(C.byref(v))
    return f'{v.value // 10000}.{v.value // 100 % 100}.{v.value % 100}'


def _escribir_temporal(texto, nl='\n'):
    tmp = tempfile.mkdtemp(prefix='cauce_')
    ruta = os.path.join(tmp, 'modelo.inp')
    with open(ruta, 'w', encoding='latin-1', errors='replace', newline='') as fh:
        fh.write(texto)
    return tmp, ruta


def validar(texto, version='2.2'):
    """Abre el texto con el motor y devuelve (ok, errores con el texto del reporte de EPANET)."""
    tmp, ruta = _escribir_temporal(texto)
    rpt = os.path.join(tmp, 'r.rpt')
    p = Proyecto(version)
    cod = p.d.EN_open(p.ph, ruta.encode('mbcs'), rpt.encode('mbcs'), b'')
    p.d.EN_close(p.ph); p.d.EN_deleteproject(p.ph)
    errores = []
    if cod > 100:
        txt = open(rpt, encoding='latin-1', errors='replace').read() if os.path.exists(rpt) else ''
        errores = [l.strip() for l in txt.splitlines() if 'Error' in l or 'error' in l][:60] or [p.msg(cod)]
    return cod <= 100, errores


class Corrida:
    """Estado y resultados de una simulación. progreso() y cancelar() se pueden llamar desde otro hilo."""

    def __init__(self, texto, version='2.3', analizar_estados=True, nombre='', calidad=True):
        self.texto = texto
        self.version = version
        self.analizar_estados = analizar_estados
        self.con_calidad = calidad
        self.nombre = nombre
        self.cancelada = False
        self.reporte = ''
        self.fase = 'esperando'
        self.t_sim = 0
        self.duracion = 1
        self.resumen = None
        self.error = None
        self.res = {}          # variable -> array('f') de T × N
        self.horas = []
        self.ids_n, self.ids_l = [], []

    def progreso(self):
        return {'fase': self.fase, 'hora': self.t_sim / 3600, 'duracion': self.duracion / 3600,
                'pct': min(100.0, 100.0 * self.t_sim / max(1, self.duracion))}

    def cancelar(self):
        self.cancelada = True

    # ------------------------------------------------------------------
    def correr(self):
        self.fase = 'abriendo'
        tmp, ruta = _escribir_temporal(self.texto)
        rpt = os.path.join(tmp, 'r.rpt')
        p = Proyecto(self.version)
        t0 = time.perf_counter()
        cod = p.d.EN_open(p.ph, ruta.encode('mbcs'), rpt.encode('mbcs'), b'')
        if cod > 100:
            p.d.EN_close(p.ph); p.d.EN_deleteproject(p.ph)
            txt = open(rpt, encoding='latin-1', errors='replace').read() if os.path.exists(rpt) else ''
            self.error = {'codigo': cod, 'mensaje': f'EPANET no pudo leer el archivo: {p.msg(cod)}',
                          'reporte': [l.strip() for l in txt.splitlines() if l.strip()][:80]}
            self.fase = 'error'
            return
        nN, nL = p.i('EN_getcount', 0), p.i('EN_getcount', 2)
        self.ids_n = [p.ident('EN_getnodeid', k) for k in range(1, nN + 1)]
        self.ids_l = [p.ident('EN_getlinkid', k) for k in range(1, nL + 1)]
        tipoN = [p.i('EN_getnodetype', k) for k in range(1, nN + 1)]
        tipoL = [p.i('EN_getlinktype', k) for k in range(1, nL + 1)]
        n12 = []
        a, b = C.c_int(), C.c_int()
        for k in range(1, nL + 1):
            p.d.EN_getlinknodes(p.ph, k, C.byref(a), C.byref(b))
            n12.append((a.value - 1, b.value - 1))
        unid = UNIDADES.get(p.i('EN_getflowunits'), '?')
        k_m3s = 1.0          # el balance va en las unidades de caudal del modelo, como todo lo demás
        trials = p.f('EN_getoption', 0)
        dur = p.l('EN_gettimeparam', T_DURACION)
        hstep = p.l('EN_gettimeparam', T_PASO_H)
        rstep = p.l('EN_gettimeparam', T_PASO_REP) or 3600
        rstart = p.l('EN_gettimeparam', T_INICIO_REP)
        self.duracion = max(dur, 1)
        # calidad del agua: qué se calcula y en qué unidades
        q_tipo, q_nudo = C.c_int(), C.c_int()
        nom, uni = C.create_string_buffer(64), C.create_string_buffer(64)
        if p.d.EN_getqualinfo(p.ph, C.byref(q_tipo), nom, uni, C.byref(q_nudo)) > 100:
            q_tipo.value = 0
        calidad = self.con_calidad and q_tipo.value > 0
        self.calidad = {'tipo': QUALITY.get(q_tipo.value, 'NONE'), 'nombre': nom.value.decode('latin-1'),
                        'unidades': {2: 'h', 3: '%'}.get(q_tipo.value, uni.value.decode('latin-1')),
                        'nudo': p.ident('EN_getnodeid', q_nudo.value) if q_tipo.value == 3 and q_nudo.value > 0 else '',
                        'calculada': calidad}
        # energía de las bombas: potencia en cada paso por la duración del paso
        bombas = [k for k in range(nL) if tipoL[k] == 2]
        precio_g = p.f('EN_getoption', 9)            # EN_GLOBALPRICE
        patron_g = int(p.f('EN_getoption', 10))       # EN_GLOBALPATTERN
        pat_paso = p.l('EN_gettimeparam', T_PASO_PAT) or 3600
        pat_inicio = p.l('EN_gettimeparam', T_INICIO_PAT)
        cargo_pot = p.f('EN_getoption', 11)           # EN_DEMANDCHARGE
        precio_b = {k: p.f('EN_getlinkvalue', k + 1, L_PRECIO) for k in bombas}
        patron_b = {k: int(p.f('EN_getlinkvalue', k + 1, L_PATRON_PRECIO)) for k in bombas}

        def multiplicador(pat, t):
            if pat <= 0:
                return 1.0
            largo = p.i('EN_getpatternlen', pat)
            return p.f('EN_getpatternvalue', pat, int((t + pat_inicio) // pat_paso) % max(1, largo) + 1)
        en = {k: {'kwh': 0.0, 'on_s': 0.0, 'max': 0.0, 'vol': 0.0, 'efic_kwh': 0.0, 'costo': 0.0} for k in bombas}
        if self.analizar_estados:
            p.d.EN_setstatusreport(p.ph, 2)
        resv = [k for k in range(nN) if tipoN[k] == 1]
        tanq = [k for k in range(nN) if tipoN[k] == 2]
        junc = [k for k in range(nN) if tipoN[k] == 0]
        vig = [k for k in range(nL) if tipoL[k] != 1]
        tmin = {k: p.f('EN_getnodevalue', k + 1, 20) for k in tanq}   # EN_MINLEVEL
        tmax = {k: p.f('EN_getnodevalue', k + 1, 21) for k in tanq}   # EN_MAXLEVEL
        bufN = (C.c_double * nN)()
        bufL = (C.c_double * nL)()
        for v in ('presion', 'carga', 'demanda'):
            self.res[v] = array('f')
        for v in ('caudal', 'velocidad', 'estado'):
            self.res[v] = array('f')

        p.ok(p.d.EN_openH(p.ph), 'EN_openH')
        p.ok(p.d.EN_initH(p.ph, 1 if calidad else 0), 'EN_initH')      # 1 = guardar la hidráulica para la calidad
        self.fase = 'calculando'
        t, paso = C.c_long(0), C.c_long(1)
        pasos = intermedios = sin_conv = 0
        iters, avisos, primer = [], Counter(), {}
        cambios, antes = Counter(), None
        pasos_hora = Counter()
        prod, cons, alm = [], [], []          # en las horas de reporte, para las gráficas
        # el balance se promedia en cada cambio de patrón (y de reporte): con patrones de 30 min y reporte de 1 h,
        # muestrear solo cada hora deja por fuera la mitad de los periodos del patrón
        paso_bal = max(300, math.gcd(rstep, pat_paso))
        prod_b, cons_b, alm_b = [], [], []
        en_lim = Counter()
        fallo = None
        t_ini = time.perf_counter()
        while True:
            r = p.d.EN_runH(p.ph, C.byref(t))
            self.t_sim = t.value
            if r > 100:
                fallo = {'codigo': r, 'hora': t.value / 3600, 'mensaje': p.msg(r)}
                fallo['islas'] = self._islas(p, nN, nL, tipoN, tipoL, n12, bufL)
                break
            it = p.f('EN_getstatistic', 0)
            iters.append(it)
            if it >= trials:
                sin_conv += 1
            if r:
                avisos[r] += 1
                primer.setdefault(r, t.value)
            pasos += 1
            pasos_hora[int(t.value // 3600)] += 1
            if t.value % hstep:
                intermedios += 1
            if p.en_bloque:
                p.valores('link', L_ESTADO, nL, bufL)
                est = [bufL[k] for k in vig]
            else:
                est = [p.f('EN_getlinkvalue', k + 1, L_ESTADO) for k in vig]
            if antes is not None:
                for j, (x, y) in enumerate(zip(antes, est)):
                    if x != y:
                        cambios[vig[j]] += 1
            antes = est
            pot = {k: (p.f('EN_getlinkvalue', k + 1, L_ENERGIA), p.f('EN_getlinkvalue', k + 1, L_CAUDAL),
                       p.f('EN_getlinkvalue', k + 1, L_EFIC)) for k in bombas}
            t_paso = t.value
            if t.value >= rstart and (t.value - rstart) % rstep == 0:
                self.horas.append(t.value / 3600)
                p.valores('node', N_PRESION, nN, bufN); self.res['presion'].extend(bufN)
                p.valores('node', N_CARGA, nN, bufN); self.res['carga'].extend(bufN)
                p.valores('node', N_DEMANDA, nN, bufN); self.res['demanda'].extend(bufN)
                prod.append(-sum(bufN[k] for k in resv) - sum(bufN[k] for k in junc if bufN[k] < 0))
                cons.append(sum(bufN[k] for k in junc if bufN[k] > 0))
                alm.append(sum(bufN[k] for k in tanq))
                if t.value % paso_bal == 0:
                    prod_b.append(prod[-1]); cons_b.append(cons[-1]); alm_b.append(alm[-1])
                p.valores('link', L_CAUDAL, nL, bufL); self.res['caudal'].extend(bufL)
                p.valores('link', L_VELOCIDAD, nL, bufL); self.res['velocidad'].extend(bufL)
                p.valores('link', L_ESTADO, nL, bufL); self.res['estado'].extend(bufL)
                pres = self.res['presion']
                base = len(pres) - nN
                for k in tanq:
                    nivel = pres[base + k]
                    if nivel <= tmin[k] + 0.02:
                        en_lim[(k, 'vacío')] += 1
                    elif nivel >= tmax[k] - 0.02:
                        en_lim[(k, 'lleno')] += 1
            elif t.value % paso_bal == 0:
                p.valores('node', N_DEMANDA, nN, bufN)
                prod_b.append(-sum(bufN[k] for k in resv) - sum(bufN[k] for k in junc if bufN[k] < 0))
                cons_b.append(sum(bufN[k] for k in junc if bufN[k] > 0))
                alm_b.append(sum(bufN[k] for k in tanq))
            p.ok(p.d.EN_nextH(p.ph, C.byref(paso)), 'EN_nextH')
            for k, (kw, q, ef) in pot.items():
                if q > 1e-9 and kw > 0:
                    e = en[k]
                    horas_p = paso.value / 3600
                    e['kwh'] += kw * horas_p
                    e['on_s'] += paso.value
                    e['max'] = max(e['max'], kw)
                    e['vol'] += q * paso.value
                    e['efic_kwh'] += ef * kw * horas_p
                    pr = precio_b[k] or precio_g
                    pt = patron_b[k] or patron_g
                    e['costo'] += kw * horas_p * pr * multiplicador(pt, t_paso)
            if paso.value <= 0 or self.cancelada:
                break
        t_calc = time.perf_counter() - t_ini
        p.d.EN_closeH(p.ph)
        t_q = 0.0
        if calidad and not fallo and not self.cancelada:
            t_q = self._calidad(p, nN, nL, rstart, rstep, bufN, bufL)
        p.d.EN_close(p.ph)
        p.d.EN_deleteproject(p.ph)
        txt = open(rpt, encoding='latin-1', errors='replace').read() if os.path.exists(rpt) else ''
        self.reporte = txt          # el reporte de EPANET entero, para leerlo en el lector de reportes

        T = len(self.horas)
        iters_s = sorted(iters)
        balance = None
        if prod:
            pb, cb, ab = (prod_b, cons_b, alm_b) if prod_b else (prod, cons, alm)
            pm, cm = sum(pb) / len(pb) * k_m3s, sum(cb) / len(cb) * k_m3s
            balance = {'produccion': pm, 'consumo': cm, 'diferencia_pct': 100 * (pm - cm) / cm if cm else None,
                       'almacenamiento': sum(ab) / len(ab) * k_m3s, 'muestras': len(pb), 'paso_muestras_h': paso_bal / 3600,
                       'serie_prod': [x * k_m3s for x in prod], 'serie_cons': [x * k_m3s for x in cons]}
        osc_rpt = _oscilaciones(txt) if self.analizar_estados else []
        # presiones mínimas en nudos de consumo (junctions con demanda) a lo largo del día
        pres_min = []
        if T:
            pres = self.res['presion']
            dem = self.res['demanda']
            minimo = {}
            for k in junc:
                vals = [pres[h * nN + k] for h in range(T)]
                if any(dem[h * nN + k] > 0 for h in range(T)):
                    minimo[k] = min(vals)
            pres_min = sorted(minimo.items(), key=lambda kv: kv[1])[:25]
        self.resumen = {
            'version': version_dll(self.version), 'motor': self.version, 'segundos': round(t_calc, 2),
            'abrir_s': round(time.perf_counter() - t0 - t_calc, 2), 'nudos': nN, 'tramos': nL, 'unidades': unid,
            'duracion_h': dur / 3600, 'paso_h': hstep / 3600, 'horas': self.horas, 'cancelada': self.cancelada,
            'pasos': pasos, 'intermedios': intermedios, 'sin_converger': sin_conv, 'trials': trials,
            'iter_mediana': iters_s[len(iters_s) // 2] if iters_s else 0, 'iter_max': iters_s[-1] if iters_s else 0,
            'pasos_por_hora': [pasos_hora.get(h, 0) for h in range(int(dur // 3600) + 1)],
            'avisos': [{'codigo': c, 'texto': AVISOS.get(c, str(c)), 'pasos': n, 'primera_h': primer[c] / 3600}
                       for c, n in avisos.most_common()],
            'oscilan': [{'id': self.ids_l[k], 'tipo': TIPO_TRAMO.get(tipoL[k], '?'), 'cambios': n}
                        for k, n in cambios.most_common(15)],
            'oscilan_reporte': osc_rpt,
            'tanques_limite': [{'id': self.ids_n[k], 'estado': e, 'horas': n} for (k, e), n in en_lim.most_common(20)],
            'presion_minima': [{'id': self.ids_n[k], 'presion': round(v, 2)} for k, v in pres_min],
            'balance': balance, 'fallo': fallo,
            'avisos_reporte': _avisos_reporte(txt),
            'calidad': dict(self.calidad, segundos=round(t_q, 2), variables=[v for v in ('calidad', 'calidad_t') if self.res.get(v)]),
            'energia': self._energia(en, dur, unid, cargo_pot),
        }
        if fallo:
            fallo['reporte'] = [l.strip() for l in txt.splitlines() if 'ill-conditioned' in l][:5]
            fallo['ultimos'] = [l.strip() for l in txt.splitlines() if re.match(r'\s*\d+:\d\d:\d\d: ', l)
                                and 'is closed' not in l and 'ill-conditioned' not in l][-30:]
        self.fase = 'fallo' if fallo else ('cancelada' if self.cancelada else 'lista')

    def _energia(self, en, dur, unid, cargo_pot):
        # Como el informe de energía de EPANET: uso, eficiencia media, kWh por volumen bombeado, kW medio y pico
        us = unid in ('CFS', 'GPM', 'MGD', 'IMGD', 'AFD')
        a_vol = A_M3S.get(unid, 1.0) * (264.172e-6 if us else 1.0)       # caudal × s -> m³ o Mgal
        out = []
        for k, e in en.items():
            vol = e['vol'] * a_vol
            ef = e['efic_kwh'] / e['kwh'] if e['kwh'] else 0
            out.append({'id': self.ids_l[k], 'kwh': e['kwh'], 'horas_on': e['on_s'] / 3600,
                        'uso_pct': 100 * e['on_s'] / max(1, dur), 'kw_max': e['max'],
                        'kw_medio': e['kwh'] / (e['on_s'] / 3600) if e['on_s'] else 0,
                        'eficiencia': ef * 100 if ef <= 1.5 else ef, 'volumen': vol,
                        'kwh_por_vol': e['kwh'] / vol if vol else 0, 'costo': e['costo']})
        return {'bombas': out, 'unidad_volumen': 'Mgal' if us else 'm³',
                'cargo_potencia': cargo_pot * max([e['max'] for e in en.values()] or [0]),
                'kwh': sum(b['kwh'] for b in out), 'costo': sum(b['costo'] for b in out)}

    def _calidad(self, p, nN, nL, rstart, rstep, bufN, bufL):
        # La calidad sobre la hidráulica guardada, con los resultados en las mismas horas de reporte
        self.fase = 'calidad'
        t0 = time.perf_counter()
        self.res['calidad'], self.res['calidad_t'] = array('f'), array('f')
        horas = []
        try:
            p.ok(p.d.EN_openQ(p.ph), 'EN_openQ')
            p.ok(p.d.EN_initQ(p.ph, 0), 'EN_initQ')
            t, paso = C.c_long(0), C.c_long(1)
            while True:
                p.ok(p.d.EN_runQ(p.ph, C.byref(t)), 'EN_runQ')
                self.t_sim = t.value
                if t.value >= rstart and (t.value - rstart) % rstep == 0 and len(horas) < len(self.horas):
                    horas.append(t.value)
                    p.valores('node', N_CALIDAD, nN, bufN); self.res['calidad'].extend(bufN)
                    p.valores('link', L_CALIDAD, nL, bufL); self.res['calidad_t'].extend(bufL)
                p.ok(p.d.EN_nextQ(p.ph, C.byref(paso)), 'EN_nextQ')
                if paso.value <= 0 or self.cancelada:
                    break
            p.d.EN_closeQ(p.ph)
        except ErrorMotor as ex:
            self.calidad['error'] = str(ex)
        # mismas horas que la hidráulica: si faltan, se completan con NaN
        faltan = len(self.horas) - len(horas)
        if faltan > 0:
            self.res['calidad'].extend([float('nan')] * (faltan * nN))
            self.res['calidad_t'].extend([float('nan')] * (faltan * nL))
        return time.perf_counter() - t0

    def _islas(self, p, nN, nL, tipoN, tipoL, n12, bufL):
        p.valores('link', L_ESTADO, nL, bufL)
        ady = [[] for _ in range(nN)]
        for k, (a, b) in enumerate(n12):
            if bufL[k] > 0:
                ady[a].append((b, k)); ady[b].append((a, k))
        visto = [False] * nN
        islas = []
        for s in range(nN):
            if visto[s]:
                continue
            pila, comp, tr = [s], [], set()
            visto[s] = True
            while pila:
                x = pila.pop(); comp.append(x)
                for y, k in ady[x]:
                    tr.add(k)
                    if not visto[y]:
                        visto[y] = True; pila.append(y)
            if tr and not any(tipoN[x] != 0 for x in comp):
                islas.append({'nudos': [self.ids_n[x] for x in comp], 'tramos': [self.ids_l[k] for k in tr]})
        islas.sort(key=lambda i: -len(i['nudos']))
        return islas[:15]

    def serie(self, var, k, n):
        a = self.res.get(var)
        if not a:
            return []
        T = len(self.horas)
        return [a[h * n + k] for h in range(T)]


def _oscilaciones(txt):
    c, ej = Counter(), {}
    for l in txt.splitlines():
        m = re.match(r'\s*\d+:\d\d:\d\d: (.*)', l)
        if not m:
            continue
        msg = m.group(1)
        if msg.startswith(('Balanc', 'System', 'Hydraulic')):
            continue
        mm = re.match(r'(Tank|Reservoir|Pump|Pipe|CV|PRV|PSV|PBV|FCV|TCV|GPV|PCV|Valve|Junction) (\S+)', msg)
        if not mm:
            continue
        clave = (mm.group(1), mm.group(2))
        c[clave] += 1
        ej.setdefault(clave, msg)
    return [{'clase': k[0], 'id': k[1], 'mensajes': n, 'ejemplo': ej[k]} for k, n in c.most_common(15)]


def _avisos_reporte(txt):
    c = Counter(re.sub(r' at [\d:]+ hrs\.?', '', l.strip()) for l in txt.splitlines() if l.strip().startswith('WARNING'))
    return [{'texto': a, 'veces': n} for a, n in c.most_common(12)]


def caudales_medios(texto, version='2.3'):
    """Corrida estática (duración 0) con todos los patrones de demanda en 1: lo que pide la red en promedio.

    Devuelve por nudo la demanda, por tramo caudal/estado/consigna y por tanque su entrada neta."""
    tmp, ruta = _escribir_temporal(texto)
    p = Proyecto(version)
    p.ok(p.d.EN_open(p.ph, ruta.encode('mbcs'), os.path.join(tmp, 'r.rpt').encode('mbcs'), b''), 'EN_open')
    try:
        nN, nL = p.i('EN_getcount', 0), p.i('EN_getcount', 2)
        unid = UNIDADES.get(p.i('EN_getflowunits'), '?')
        # los patrones que usan las demandas de los nudos pasan a ser 1 en todos los periodos
        pats = set()
        for k in range(1, nN + 1):
            if p.i('EN_getnodetype', k) != 0:
                continue
            nd = C.c_int()
            if p.d.EN_getnumdemands(p.ph, k, C.byref(nd)) > 100:
                continue
            for j in range(1, nd.value + 1):
                pi = C.c_int()
                if p.d.EN_getdemandpattern(p.ph, k, j, C.byref(pi)) <= 100 and pi.value > 0:
                    pats.add(pi.value)
        uno = (C.c_double * 1)(1.0)
        for pi in pats:
            p.d.EN_setpattern(p.ph, pi, uno, 1)
        p.d.EN_settimeparam(p.ph, 0, C.c_long(0))     # duración 0: una sola solución
        p.ok(p.d.EN_openH(p.ph)); p.ok(p.d.EN_initH(p.ph, 0))
        t = C.c_long(0)
        r = p.d.EN_runH(p.ph, C.byref(t))
        if r > 100:
            raise ErrorMotor(r, p.msg(r))
        nudos = {}
        for k in range(1, nN + 1):
            nudos[p.ident('EN_getnodeid', k)] = {'tipo': p.i('EN_getnodetype', k),
                                                 'demanda': p.f('EN_getnodevalue', k, N_DEMANDA),
                                                 'carga': p.f('EN_getnodevalue', k, N_CARGA),
                                                 'presion': p.f('EN_getnodevalue', k, N_PRESION)}
        tramos = {}
        a, b = C.c_int(), C.c_int()
        for k in range(1, nL + 1):
            p.d.EN_getlinknodes(p.ph, k, C.byref(a), C.byref(b))
            tramos[p.ident('EN_getlinkid', k)] = {
                'tipo': TIPO_TRAMO.get(p.i('EN_getlinktype', k)), 'n1': p.ident('EN_getnodeid', a.value),
                'n2': p.ident('EN_getnodeid', b.value), 'caudal': p.f('EN_getlinkvalue', k, L_CAUDAL),
                'estado': p.f('EN_getlinkvalue', k, L_ESTADO), 'consigna': p.f('EN_getlinkvalue', k, L_CONSIGNA)}
        p.d.EN_closeH(p.ph)
        return {'unidades': unid, 'nudos': nudos, 'tramos': tramos, 'aviso': r if r else 0}
    finally:
        p.cerrar()
