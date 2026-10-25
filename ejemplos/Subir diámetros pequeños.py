# Pone un diámetro mínimo a las tuberías más delgadas: un ejemplo de cambio en bloque
MINIMO = 100          # en las unidades de diámetro del modelo (mm o in)

cambiadas = []
for t in red.tuberias():
    if t.diametro < MINIMO:
        t.diametro = MINIMO
        cambiadas.append(t)

print(f'{len(cambiadas)} tuberías pasan a {MINIMO} {red.unidades["diametro"]}.')
print('Dale Aplicar para dejarlas así, o Descartar.')
