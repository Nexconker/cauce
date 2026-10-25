# Nivel mínimo y máximo de cada tanque en el día frente a sus límites; marca los que tocan fondo o rebosan
MARGEN = 0.05         # qué tan cerca del límite cuenta como tocarlo (en unidades de nivel)

r = red.resultados or red.correr()
filas = []
for tq in red.tanques():
    nivel = r.nivel(tq)
    bajo, alto = min(nivel), max(nivel)
    if bajo <= tq.nivel_min + MARGEN:
        estado = 'se vacía'
    elif alto >= tq.nivel_max - MARGEN:
        estado = 'se llena'
    else:
        estado = ''
    filas.append((tq.id, tq.comentario[:24], bajo, alto, tq.nivel_max, estado))

red.tabla(filas, ['Tanque', 'Nombre', 'Nivel mín', 'Nivel máx', 'Límite', ''])
problemas = [f[0] for f in filas if f[5]]
print(f'\n{len(problemas)} de {len(filas)} tanques tocan un límite.')
red.marcar(problemas)
