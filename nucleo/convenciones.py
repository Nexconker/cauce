"""Convenciones de cada organización para leer y editar sus modelos: se cambian en Ajustes.

- horizonte: expresión regular sobre las etiquetas ([TAGS]) de los tramos; el primer grupo es el año en que entra
  el proyecto. Por defecto, cualquier año suelto de cuatro cifras (Proy_2032, Fase2030, 2027...).
- proyecto: expresión regular sobre el ID del tramo; el primer grupo es el nombre del proyecto (por ejemplo PN-16 en
  PN-16-0002). Vacía = no se agrupa por ID, solo por etiquetas.
- sufijos de los nudos que se crean al meter una válvula o bomba en una tubería, y prefijos de los IDs nuevos.
- clases de presión y velocidad del mapa (vacías = según las unidades del modelo) y meta del balance.
"""
import re

GENERICO = {
    'nombre': 'Genérico',
    'horizonte': r'(?<!\d)((?:19|20)\d{2})(?!\d)',
    'proyecto': '',
    'sufijos_valvula': ['_Up', '_Dw'],
    'sufijos_bomba': ['_Suc', '_Dis'],
    'prefijos': {'nudo': 'J', 'tuberia': 'P', 'valvula': 'V', 'bomba': 'PU', 'tanque': 'T', 'embalse': 'R'},
    'clases_presion': [],
    'clases_velocidad': [],
    'clases_unidad': '',       # unidad de presión en que se escribieron las clases (m, psi, kPa...)
    'meta_balance': 2.0,
}
PRESETS = {
    'generico': GENERICO,
    'proyectos_pn': dict(GENERICO, nombre='Proyectos PN-xx con horizonte Proy_AAAA', horizonte=r'^Proy_(\d{4})$', proyecto=r'^(PN-\d+)',
                 clases_presion=[15, 30, 50, 80], clases_unidad='m'),
}


def normalizar(c):
    """Completa lo que falte con el genérico y descarta expresiones que no compilan."""
    out = dict(GENERICO)
    out.update({k: v for k, v in (c or {}).items() if k in GENERICO})
    out['prefijos'] = dict(GENERICO['prefijos'], **((c or {}).get('prefijos') or {}))
    for k in ('horizonte', 'proyecto'):
        try:
            re.compile(out[k] or '')
        except re.error:
            out[k] = GENERICO[k]
    for k in ('sufijos_valvula', 'sufijos_bomba'):
        v = out[k]
        if not (isinstance(v, (list, tuple)) and len(v) == 2 and all(isinstance(x, str) and x for x in v) and v[0] != v[1]):
            out[k] = GENERICO[k]
    for k in ('clases_presion', 'clases_velocidad'):
        try:
            out[k] = sorted(float(x) for x in (out[k] or []))
        except (TypeError, ValueError):
            out[k] = []
    try:
        out['meta_balance'] = float(out['meta_balance'])
    except (TypeError, ValueError):
        out['meta_balance'] = 2.0
    return out


def horizonte(tag, conv):
    """Año del horizonte según la etiqueta, o None."""
    if not tag or not conv.get('horizonte'):
        return None
    m = re.search(conv['horizonte'], tag)
    if not m:
        return None
    g = m.group(1) if m.groups() else m.group(0)
    return int(g) if g.isdigit() else None


def proyecto(lid, conv):
    """Nombre del proyecto según el ID del tramo, o None."""
    if not conv.get('proyecto'):
        return None
    m = re.search(conv['proyecto'], lid)
    if not m:
        return None
    return m.group(1) if m.groups() else m.group(0)
