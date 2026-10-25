# Tuberías que pasan de una velocidad límite en algún momento del día, marcadas en el mapa
LIMITE = 2.0          # en las unidades de velocidad del modelo (m/s o ft/s)

r = red.resultados or red.correr()
altas = []
for t in red.tuberias():
    v = max(abs(x) for x in r.velocidad(t))
    if v > LIMITE:
        altas.append((t.id, t.diametro, v))
altas.sort(key=lambda a: -a[2])

print(f'{len(altas)} tuberías pasan de {LIMITE} {red.unidades["velocidad"]}. Las 30 más rápidas:\n')
red.tabla(altas[:30], ['Tubería', f'Diámetro ({red.unidades["diametro"]})', 'Velocidad máxima'])
red.marcar(a[0] for a in altas)
