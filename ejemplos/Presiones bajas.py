# Los 15 nudos con la presión más baja del día, marcados en el mapa
# Usa la última corrida que hiciste en Cauce con el modelo tal como está; si no hay, corre el modelo (motor 2.3).
CUANTOS = 15

r = red.resultados or red.correr()
nudos = [n.id for n in red.nudos if n.tipo == 'nudo']        # sin tanques ni embalses
peores = r.extremos('presion', n=CUANTOS, ids=nudos)
red.tabla(peores, ['Nudo', f'Presión mínima ({red.unidades["presion"]})', 'Hora'])
red.marcar(i for i, valor, hora in peores)
