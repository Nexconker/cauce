"""Arma el acceso directo "Cauce" en trabajo/accesos/ para el escritorio y el menú Inicio.

Apunta a `pythonw -I lanzar.pyw`, con el ícono de Cauce y su AppUserModelID: así la ventana abierta y el acceso
anclado en la barra de tareas son el mismo botón, con el ícono nítido.

Lo copia a su sitio "Instalar accesos.bat": el Python del administrador de instalaciones de Windows corre como paquete
y lo que escribe en %APPDATA% (donde está el menú Inicio) va a una copia virtual que solo ve él, también desde los
procesos que lance. Por eso el .lnk se hace aquí y lo copia el .bat, que no corre dentro del paquete.
"""
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
from nucleo import ventana  # noqa: E402


def main():
    pythonw = os.path.join(os.path.dirname(sys.executable), 'pythonw.exe')
    ico = os.path.join(RAIZ, 'web', 'marca', 'cauce.ico')
    lnk = os.path.join(RAIZ, 'trabajo', 'accesos', 'Cauce.lnk')
    ventana.acceso_directo(lnk, pythonw, f'-I "{os.path.join(RAIZ, "lanzar.pyw")}"', RAIZ, ico,
                           'Cauce · Nex-Industries: revisar, correr y comparar modelos de EPANET')
    print('listo:', lnk)


if __name__ == '__main__':
    main()
