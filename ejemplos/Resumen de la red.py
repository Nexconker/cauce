# Cuántos elementos hay de cada tipo y cuánta tubería hay por rango de diámetro
from collections import Counter

u = red.unidades
tipos = Counter(n.tipo for n in red.nudos) + Counter(t.tipo for t in red.tramos)
red.tabla(sorted(tipos.items()), ['Tipo', 'Cuántos'])

print()
rangos = [(0, 300), (300, 600), (600, 1000), (1000, 1e9)] if not u['us'] else [(0, 12), (12, 24), (24, 40), (40, 1e9)]
largo = Counter()
for t in red.tuberias():
    for a, b in rangos:
        if a <= t.diametro < b:
            largo[(a, b)] += t.longitud
filas = [(f'{a:g} a {b:g}' if b < 1e9 else f'{a:g} o más', largo[(a, b)]) for a, b in rangos]
red.tabla(filas, [f'Diámetro ({u["diametro"]})', f'Longitud ({u["longitud"]})'], decimales=0)

cerradas = [t for t in red.tramos if not t.abierto]
print(f'\n{len(cerradas)} tramos empiezan cerrados.')
