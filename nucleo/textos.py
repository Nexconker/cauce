"""Explicaciones en español para la interfaz: qué es cada parámetro, cada opción y cada resultado.

Las unidades van como marcadores ({caudal}, {presion}, {longitud}, {diametro}, {cota}, {velocidad}, {volumen},
{potencia}, {rugosidad}, {diametro_tanque}) que la interfaz llena con el sistema de unidades del modelo abierto.
"""

PARAMETROS = {
    'junction': {
        'cota': ('Cota', '{cota}', 'Altura del terreno en el nudo. La presión es la carga menos la cota: con una cota mala, '
                 'la presión sale mal aunque los caudales estén bien.'),
        'dem': ('Demanda base', '{caudal}', 'Consumo medio que sale de la red en este nudo. Se multiplica en cada hora por '
                'su patrón y por el multiplicador global de demanda.'),
        'pat': ('Patrón de demanda', '', 'Curva con multiplicadores que reparten la demanda base a lo largo del día. Sin '
                'patrón, se usa el patrón por defecto de [OPTIONS] o 1.'),
    },
    'reservoir': {
        'cota': ('Carga total', '{carga}', 'Nivel de agua fijo (embalse, planta, conexión a otra red). Es una fuente '
                 'infinita: da el caudal que la red le pida.'),
        'pat': ('Patrón de carga', '', 'Si tiene patrón, el nivel del embalse cambia con la hora.'),
    },
    'tank': {
        'cota': ('Cota de fondo', '{cota}', 'Altura del fondo del tanque. El nivel del agua se mide desde aquí.'),
        'nini': ('Nivel inicial', '{nivel}', 'Nivel con el que arranca la simulación. Tiene que estar entre el mínimo y el máximo.'),
        'nmin': ('Nivel mínimo', '{nivel}', 'Por debajo de este nivel EPANET cierra las salidas: el tanque "se vacía".'),
        'nmax': ('Nivel máximo', '{nivel}', 'Al llegar aquí EPANET cierra las entradas: el tanque "se llena". Si las '
                 'entradas no tienen control, se abren y cierran cada pocos segundos y la corrida se vuelve lenta.'),
        'diam': ('Diámetro', '{diametro_tanque}', 'Diámetro equivalente de un tanque cilíndrico (área = volumen por unidad de altura).'),
        'vmin': ('Volumen mínimo', '{volumen}', 'Volumen bajo el nivel mínimo (solo cuenta para la calidad del agua).'),
        'curva': ('Curva de volumen', '', 'Para tanques que no son cilíndricos: volumen según el nivel.'),
    },
    'pipe': {
        'lon': ('Longitud', '{longitud}', 'Longitud real de la tubería (no la del dibujo).'),
        'diam': ('Diámetro', '{diametro}', 'Diámetro interno.'),
        'rug': ('Rugosidad', '{rugosidad}', 'Con Darcy-Weisbach (D-W) es la rugosidad absoluta; con Hazen-Williams (H-W), '
                'el coeficiente C; con Chezy-Manning (C-M), la n de Manning. La fórmula está en HEADLOSS.'),
        'km': ('Pérdida menor', '', 'Coeficiente de pérdidas localizadas (codos, accesorios).'),
        'estado': ('Estado inicial', '', 'OPEN, CLOSED o CV (antirretorno: solo deja pasar el agua en el sentido del tramo).'),
    },
    'pump': {
        'curva': ('Curva de carga', '', 'Relación caudal-carga de la bomba. Es lo correcto para una bomba real.'),
        'potencia': ('Potencia', '{potencia}', 'Bomba de potencia constante: da una carga infinita con caudal cero. Sirve '
                     'para tanteos, no para escenarios: puede dejar el sistema inestable.'),
        'velocidad': ('Velocidad relativa', '', '1 = velocidad nominal. Una regla puede cambiarla (SETTING).'),
        'estado': ('Estado inicial', '', 'OPEN (prendida) o CLOSED (apagada) al empezar. Las reglas la cambian después.'),
    },
    'valve': {
        'vt': ('Tipo', '', 'PRV reduce presión, PSV sostiene presión aguas arriba, PBV quiebra presión, FCV limita el '
               'caudal, TCV estrangula (consigna = coeficiente de pérdida), GPV sigue una curva.'),
        'diam': ('Diámetro', '{diametro}', 'Diámetro de la válvula.'),
        'consigna': ('Consigna', '', 'PRV, PSV y PBV: presión en {presion}. FCV: caudal en {caudal}. TCV: coeficiente de '
                     'pérdida. GPV: nombre de la curva.'),
        'km': ('Pérdida menor', '', 'Pérdida cuando está totalmente abierta.'),
        'estado': ('Estado inicial', '', 'Sin nada en [STATUS] la válvula trabaja con su consigna (ACTIVE). OPEN la deja '
                   'totalmente abierta, CLOSED cerrada, y un número cambia la consigna.'),
    },
}

TIPOS = {'junction': 'Nudo', 'reservoir': 'Embalse', 'tank': 'Tanque', 'pipe': 'Tubería', 'pump': 'Bomba',
         'valve': 'Válvula', 'CV': 'Tubería con antirretorno', 'PRV': 'Válvula reductora (PRV)',
         'PSV': 'Válvula sostenedora (PSV)', 'PBV': 'Válvula de quiebre (PBV)', 'FCV': 'Válvula de control de caudal (FCV)',
         'TCV': 'Válvula de estrangulamiento (TCV)', 'GPV': 'Válvula de propósito general (GPV)'}

OPCIONES = {
    'UNITS': 'Unidades de caudal, y con ellas todo el sistema: con LPS, LPM, MLD, CMH o CMD se trabaja en metros, '
             'milímetros y presión en metros de agua; con GPM, CFS, MGD, IMGD o AFD, en pies, pulgadas y psi.',
    'HEADLOSS': 'Fórmula de pérdidas: D-W (Darcy-Weisbach), H-W (Hazen-Williams) o C-M (Chezy-Manning).',
    'PRESSURE': 'Unidades de presión de los resultados (PSI, KPA o METERS).',
    'TRIALS': 'Máximo de iteraciones para resolver cada paso. Si se llega al máximo, el paso "no converge".',
    'ACCURACY': 'Cuánto puede cambiar el caudal entre iteraciones para dar el paso por resuelto. Más pequeño = más '
                'preciso y más lento. Para reportes finales se suele pedir más precisión (por ejemplo, 0.0001).',
    'UNBALANCED': 'Qué hacer si un paso no converge: STOP para, CONTINUE sigue, CONTINUE n hace n iteraciones más '
                  'con los estados fijos.',
    'CHECKFREQ': 'Cada cuántas iteraciones se revisan los estados de bombas, válvulas y antirretornos.',
    'MAXCHECK': 'Hasta qué iteración se revisan esos estados.',
    'DAMPLIMIT': 'Desde qué precisión se amortiguan los cambios de válvulas (0 = nunca). Ayuda a converger.',
    'PATTERN': 'Patrón por defecto para los nudos sin patrón.',
    'DEMAND MULTIPLIER': 'Multiplica todas las demandas. 1.2 = 20 % más de consumo en toda la red.',
    'DEMAND MODEL': 'DDA: la demanda se entrega siempre. PDA: la demanda depende de la presión disponible.',
    'QUALITY': 'Calidad del agua: NONE (solo hidráulica), CHEMICAL (cloro, por ejemplo), AGE (edad) o TRACE. '
               'Si no se necesita, NONE hace la corrida más rápida.',
    'VISCOSITY': 'Viscosidad relativa al agua a 20 °C.', 'SPECIFIC GRAVITY': 'Densidad relativa al agua a 4 °C.',
    'EMITTER EXPONENT': 'Exponente de los emisores (fugas, aspersores).',
    'TOLERANCE': 'Tolerancia de la calidad del agua.', 'DIFFUSIVITY': 'Difusividad molecular relativa al cloro.',
    'DURATION': 'Duración de la simulación (hh:mm). 0 = una sola solución estática.',
    'HYDRAULIC TIMESTEP': 'Paso normal de cálculo. EPANET lo acorta cuando un tanque se llena, un control actúa o '
                          'cambia un patrón: esos son los pasos intermedios.',
    'QUALITY TIMESTEP': 'Paso de la calidad del agua (0 = un décimo del hidráulico).',
    'PATTERN TIMESTEP': 'Cada cuánto cambia el multiplicador de los patrones.',
    'PATTERN START': 'En qué punto del patrón empieza la simulación.',
    'REPORT TIMESTEP': 'Cada cuánto se guardan resultados.', 'REPORT START': 'Desde cuándo se guardan resultados.',
    'RULE TIMESTEP': 'Cada cuánto se revisan las reglas (por defecto, un décimo del paso hidráulico).',
    'START CLOCKTIME': 'Hora del día a la que empieza la simulación.',
    'STATISTIC': 'Resumen estadístico del reporte (NONE, AVERAGED, MINIMUM, MAXIMUM, RANGE).',
    'HEADERROR': 'Además de la precisión, el error de carga máximo permitido en cualquier tramo para dar el paso por '
                 'resuelto (0 = no se usa).',
    'FLOWCHANGE': 'Además de la precisión, el cambio de caudal máximo permitido entre iteraciones (0 = no se usa).',
    'MINIMUM PRESSURE': 'Con PDA: por debajo de esta presión el nudo no entrega nada.',
    'REQUIRED PRESSURE': 'Con PDA: desde esta presión el nudo entrega toda su demanda.',
    'PRESSURE EXPONENT': 'Con PDA: cómo crece la entrega entre la presión mínima y la requerida (0.5 por defecto).',
    'ORDER BULK': 'Orden de la reacción en el agua (1 = primer orden, como el cloro).',
    'ORDER WALL': 'Orden de la reacción en la pared de la tubería: 0 o 1.',
    'ORDER TANK': 'Orden de la reacción dentro de los tanques.',
    'GLOBAL BULK': 'Coeficiente de reacción en el agua para todas las tuberías (1/día). Negativo = el químico decae.',
    'GLOBAL WALL': 'Coeficiente de reacción en la pared para todas las tuberías. Negativo = decae.',
    'LIMITING POTENTIAL': 'Concentración a la que tiende la reacción (0 = sin límite).',
    'ROUGHNESS CORRELATION': 'Si no es 0, el coeficiente de pared de cada tubería sale de su rugosidad con este factor.',
    'GLOBAL EFFICIENCY': 'Eficiencia (%) de las bombas que no tienen curva de eficiencia.',
    'GLOBAL PRICE': 'Precio de la energía por kWh para el informe de energía.',
    'GLOBAL PATTERN': 'Patrón que multiplica el precio de la energía a lo largo del día.',
    'DEMAND CHARGE': 'Cargo por cada kW de la potencia máxima del periodo.',
}

RESULTADOS = {
    'presion': ('Presión', '{presion}', 'Carga menos cota: la altura de agua que marcaría un manómetro en el nudo. En un '
                'tanque es el nivel del agua.'),
    'carga': ('Carga hidráulica', '{carga}', 'Cota de la línea piezométrica: cota + presión.'),
    'demanda': ('Demanda', '{caudal}', 'Caudal que sale (positivo) o entra (negativo) en el nudo. En un tanque, lo que '
                'entra menos lo que sale; en un embalse, negativo = lo que entrega.'),
    'caudal': ('Caudal', '{caudal}', 'Positivo en el sentido del tramo (de nudo inicial a final), negativo al revés.'),
    'velocidad': ('Velocidad', '{velocidad}', 'Velocidad media del agua. Velocidades altas (del orden de 2 m/s o 6 ft/s) '
                  'suelen indicar una tubería al límite.'),
    'estado': ('Estado', '', 'Abierto o cerrado en ese momento (las reglas y los tanques lo cambian).'),
}

AVISOS = {
    1: 'En algún paso EPANET no logró equilibrar caudales y cargas dentro de la precisión pedida. El resultado de '
       'ese paso no es confiable. Suele venir de elementos que oscilan o de consignas imposibles.',
    2: 'La solución salta entre estados (por ejemplo, una válvula que abre y cierra en cada iteración).',
    3: 'Hay nudos sin camino a un tanque o embalse en ese momento: EPANET les pone una carga arbitraria.',
    4: 'Una bomba no puede dar la carga que le pide la red (caudal fuera de su curva): EPANET la cierra.',
    5: 'Una válvula no puede dar la presión o el caudal de su consigna (por ejemplo, una FCV sin suficiente carga '
       'aguas arriba): queda totalmente abierta.',
    6: 'Hay presiones negativas: falta carga en esa zona o hay nudos aislados con cargas arbitrarias.',
}

GLOSARIO = [
    ('Paso hidráulico', 'Cada momento en que EPANET resuelve la red. El paso normal (por ejemplo, 1 h) se acorta '
     'cuando un tanque se llena o vacía, actúa un control o cambia un patrón: esos son pasos intermedios. Miles de '
     'pasos intermedios = algo está oscilando.'),
    ('Convergencia', 'EPANET resuelve cada paso por aproximaciones sucesivas. Converge cuando los caudales casi no '
     'cambian entre iteraciones (ACCURACY). Si llega a TRIALS sin lograrlo, el paso no converge.'),
    ('Balance producción/consumo', 'Promedio de lo que entregan los embalses (producción) frente a lo que consumen '
     'los nudos (consumo). La diferencia va a los tanques. La meta (por defecto ±2 %) se cambia en Ajustes.'),
    ('Isla', 'Grupo de nudos sin camino a un tanque o embalse. Si está unido por tramos abiertos, la matriz queda sin '
     'solución (error 110).'),
    ('Entrada abierta', 'A un proyecto apagado se le deja un solo tramo abierto hacia la red, sin salida al otro lado: '
     'no circula agua, pero el grupo deja de ser una isla y EPANET no falla.'),
    ('Consigna', 'Valor que una válvula intenta mantener: caudal en una FCV, presión en una PRV o PSV.'),
    ('Control y regla', 'Un control simple ([CONTROLS]) cambia un tramo a una hora o con un nivel. Una regla '
     '([RULES]) admite varias condiciones (IF ... AND ... THEN ...). Las dos cambian estados durante la corrida.'),
    ('Estado inicial', 'Cómo arranca cada tramo: columna de estado en [PIPES] más lo que diga [STATUS].'),
    ('Antirretorno (CV)', 'Tubería que solo deja pasar agua en un sentido; si el agua quiere devolverse, se cierra.'),
    ('Carga y presión', 'La carga es la cota de la línea piezométrica; la presión es la carga menos la cota del nudo.'),
    ('Horizonte', 'Año en que entra un proyecto. Cauce lo lee de las etiquetas ([TAGS]) con la regla de Ajustes '
     '(por defecto, cualquier año suelto de cuatro cifras) y permite prender o apagar todo lo de un mismo horizonte.'),
    ('Unidades', 'Cauce usa las del propio .inp (UNITS y HEADLOSS): metros, milímetros y presión en metros de agua '
     'con caudal en LPS, LPM, MLD, CMH o CMD; pies, pulgadas y psi con GPM, CFS, MGD, IMGD o AFD.'),
    ('Motor 2.2 y 2.3', 'Dos versiones del motor de EPANET. El programa EPANET de escritorio más usado es el 2.2; la '
     '2.3 es más rápida y converge mejor. Para comparar tiempos con quien usa el programa de escritorio, usar la 2.2.'),
    ('Escenario', 'Capa de cambios sobre un modelo base (proyectos, estados, consignas, demandas, ediciones). Se '
     'guarda aparte y el .inp se arma al exportar, sin tocar el archivo original.'),
]


def todo():
    return {'parametros': PARAMETROS, 'tipos': TIPOS, 'opciones': OPCIONES, 'resultados': RESULTADOS,
            'avisos': AVISOS, 'glosario': GLOSARIO}
