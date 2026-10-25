# Multiplica la demanda base de los nudos que tienen una etiqueta (una zona, un sector) por un factor
ZONA = '13101'        # la etiqueta de [TAGS]; con * al final toma todas las que empiezan así
FACTOR = 1.15

nudos = [x for x in red.con_etiqueta(ZONA) if x.clase == 'nudo' and x.tipo == 'nudo']
if not nudos:
    raise Exception(f'No hay nudos con la etiqueta {ZONA}: cámbiala arriba.')

antes = sum(n.demanda for n in nudos)
for n in nudos:
    n.demanda = n.demanda * FACTOR

print(f'{len(nudos)} nudos de {ZONA}: demanda base {antes:.2f} -> {antes * FACTOR:.2f} {red.unidades["caudal"]}')
red.marcar(nudos)
