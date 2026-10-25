"""Sistema de unidades de un modelo, leído de su propio .inp (UNITS, HEADLOSS y PRESSURE en [OPTIONS]).

EPANET trabaja en las unidades del archivo: con caudal en CFS, GPM, MGD, IMGD o AFD todo va en unidades
estadounidenses (pies, pulgadas, psi); con LPS, LPM, MLD, CMH, CMD o CMS, en el sistema métrico (metros,
milímetros y presión en metros de columna de agua). Aquí solo se arman las etiquetas y los valores por defecto:
los cálculos los hace el motor con las unidades del archivo, sin convertir nada.
"""

EEUU = {'CFS', 'GPM', 'MGD', 'IMGD', 'AFD'}
CAUDAL = {'LPS': 'L/s', 'LPM': 'L/min', 'MLD': 'ML/d', 'CMH': 'm³/h', 'CMD': 'm³/d', 'CMS': 'm³/s',
          'CFS': 'ft³/s', 'GPM': 'gpm', 'MGD': 'Mgal/d', 'IMGD': 'Mgal imp/d', 'AFD': 'acre-ft/d'}
PRESION = {'PSI': 'psi', 'KPA': 'kPa', 'METERS': 'm', 'METRES': 'm', 'BAR': 'bar', 'FEET': 'ft'}


def sistema(modelo):
    op = modelo.opciones('[OPTIONS]')
    caudal = (op.get('UNITS') or 'GPM').split()[0].upper()        # GPM es el valor por defecto de EPANET
    us = caudal in EEUU
    hl = (op.get('HEADLOSS') or 'H-W').split()[0].upper()
    pres = PRESION.get((op.get('PRESSURE') or '').split()[0].upper() if op.get('PRESSURE') else '', 'psi' if us else 'm')
    if hl.startswith('D'):
        rug = '10⁻³ ft' if us else 'mm'
    elif hl.startswith('C'):
        rug = 'n de Manning'
    else:
        rug = 'C de Hazen-Williams'
    largo = 'ft' if us else 'm'
    return {
        'us': us, 'codigo_caudal': caudal, 'headloss': hl,
        'caudal': CAUDAL.get(caudal, caudal), 'longitud': largo, 'cota': largo, 'nivel': largo, 'carga': largo,
        'diametro': 'in' if us else 'mm', 'diametro_tanque': largo, 'presion': pres,
        'velocidad': 'ft/s' if us else 'm/s', 'volumen': 'ft³' if us else 'm³', 'potencia': 'hp' if us else 'kW',
        'rugosidad': rug,
        'a_metros': 0.3048 if us else 1.0,      # para tolerancias y la escala del mapa
        # valores por defecto razonables para elementos nuevos
        'nuevo': {
            'diametro': 12 if us else 300,
            'rugosidad': (0.5 if us else 0.1) if hl.startswith('D') else (0.012 if hl.startswith('C') else 130),
            'nivel_ini': 6 if us else 2, 'nivel_min': 1.5 if us else 0.5, 'nivel_max': 13 if us else 4,
            'diam_tanque': 65 if us else 20,
        },
    }


def clases_por_defecto(sis):
    """Cortes de las clases de presión y velocidad del mapa, en las unidades del modelo."""
    p = sis['presion']
    pres = {'m': [15, 30, 50, 80], 'ft': [50, 100, 165, 260], 'psi': [20, 40, 60, 100], 'kPa': [150, 300, 500, 800],
            'bar': [1.5, 3, 5, 8]}.get(p, [15, 30, 50, 80])
    vel = [1, 3, 6] if sis['us'] else [0.3, 1, 2]
    return pres, vel
