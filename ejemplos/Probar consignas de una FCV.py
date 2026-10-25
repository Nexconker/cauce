# Prueba varias consignas en una válvula FCV, corre cada una y mira el tanque que llena (un barrido, como en Dynamo)
# Cambia los IDs por los de tu modelo. Cada corrida tarda lo que tarde tu modelo con el motor 2.3.
VALVULA = 'V5690'
TANQUE = '3783'
CONSIGNAS = [0, 40, 60, 80, 100]

v = red.tramos[VALVULA]
filas = []
for q in CONSIGNAS:
    v.estado = q                    # la consigna con que arranca (si estaba cerrada, la abre)
    r = red.correr()
    nivel = r.nivel(TANQUE)
    filas.append((q, min(nivel), max(nivel), r.resumen.get('sin_converger', 0)))

print()
red.tabla(filas, ['Consigna', 'Nivel mín', 'Nivel máx', 'Pasos sin converger'])
mejor = max(filas, key=lambda f: (f[1], -f[3]))
v.estado = mejor[0]
print(f'\nQueda la consigna {mejor[0]}, la que deja el tanque más alto. Aplica para dejarla o descarta.')
red.marcar(VALVULA, TANQUE)
