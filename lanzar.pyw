"""Abre Cauce como un programa: sin consola, en su propia ventana.

Si el servidor no está corriendo, lo arranca en segundo plano (con apagado automático: se apaga solo cuando cierras
la ventana y no queda ninguna corrida en curso). Después abre la ventana propia de Cauce (pywebview con WebView2, el
motor de Edge que traen Teams o VS Code): título Cauce, su ícono y su botón en la barra de tareas, sin nada de Edge.
La X de la ventana pasa por la página, que pregunta si hay cambios sin guardar. Si ya hay una ventana de Cauce, la
trae al frente en vez de abrir otra.

Si pywebview o WebView2 no están, abre la app en modo ventana de Edge o Chrome (y si tampoco, en el navegador por
defecto). Es lo que ejecutan los accesos directos del escritorio y del menú Inicio. Con --depurar, la ventana propia
abre con las herramientas de desarrollo.
"""
import ctypes
import json
import os
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser

RAIZ = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, RAIZ)
if os.path.isdir(os.path.join(RAIZ, 'lib')):          # paquetes que instala "Instalar Cauce.bat"
    sys.path.insert(1, os.path.join(RAIZ, 'lib'))
PUERTO = int(os.environ.get('CAUCE_PUERTO', '8790'))
URL = f'http://127.0.0.1:{PUERTO}/'
ICO = os.path.join(RAIZ, 'web', 'marca', 'cauce.ico')
NAVEGADORES = [
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    os.path.expandvars(r'%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe'),
]


def pythonw():
    w = os.path.join(os.path.dirname(sys.executable), 'pythonw.exe')
    return w if os.path.exists(w) else sys.executable


def responde():
    try:
        with urllib.request.urlopen(URL + 'api/estado', timeout=1.5) as r:
            return json.loads(r.read()).get('version') is not None
    except (OSError, ValueError):
        return False


def arrancar_servidor():
    sin_ventana = 0x08000000 if os.name == 'nt' else 0          # CREATE_NO_WINDOW
    subprocess.Popen([pythonw(), '-I', os.path.join(RAIZ, 'cauce.py'), '--sin-navegador', '--auto-apagar', '--sin-actualizar'],
                     cwd=RAIZ, creationflags=sin_ventana, close_fds=True)
    for _ in range(60):
        if responde():
            return True
        time.sleep(0.25)
    return False


# ---------------------------------------------------------------- ventana propia
def ventana_propia(ventana, depurar=False):
    """Abre la ventana nativa y se queda en su bucle hasta que se cierra. False si no se pudo abrir."""
    try:
        import webview
    except ImportError:
        return False
    comando = f'"{pythonw()}" -I "{os.path.abspath(__file__)}"'
    # la identidad del proceso va antes de crear la ventana: así la barra de tareas la junta con los accesos directos
    ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(ctypes.c_wchar_p(ventana.AUMID))
    estado = {'salir': False, 'intentos': []}

    class Api:
        """Lo que la página puede pedirle a la ventana (window.pywebview.api)."""

        def cerrar(self):
            estado['salir'] = True
            threading.Thread(target=w.destroy, daemon=True).start()

    api = Api()
    w = webview.create_window(ventana.TITULO, URL, js_api=api, width=1440, height=900, min_size=(1000, 640),
                              background_color='#0f0b0b', text_select=True)

    def pedir_salida():
        # la página pregunta por los cambios sin guardar y llama a api.cerrar() cuando se puede salir; si no
        # contesta en 3 s (no cargó, el servidor se cayó), se cierra sin más
        r = {}

        def preguntar():
            try:
                r['ok'] = w.evaluate_js('window.cauceSalir ? window.cauceSalir() : false')
            except Exception:
                r['ok'] = False

        t = threading.Thread(target=preguntar, daemon=True)
        t.start()
        t.join(3)
        if not r.get('ok'):
            api.cerrar()

    def al_cerrar():
        if estado['salir']:
            return True
        # tres clics seguidos en la X cierran igual: la salida de emergencia si la página se quedó trabada
        ahora = time.time()
        estado['intentos'] = [x for x in estado['intentos'] if ahora - x < 2.5] + [ahora]
        if len(estado['intentos']) >= 3:
            return True
        threading.Thread(target=pedir_salida, daemon=True).start()
        return False

    def al_mostrar():
        for hwnd in ventana.ventanas(('WindowsForms10',), os.getpid()):
            ventana.identidad(hwnd, ICO, comando)
            ventana.barra_oscura(hwnd)

    w.events.closing += al_cerrar
    w.events.shown += al_mostrar
    try:
        webview.start(gui='edgechromium', icon=ICO, debug=depurar, private_mode=False,
                      storage_path=os.path.join(RAIZ, 'trabajo', 'webview'))
    except Exception:
        return estado['salir']          # si alcanzó a abrir y se cerró bien, no se abre la de respaldo
    return True


# ---------------------------------------------------------------- respaldo: modo app de Edge o Chrome
def abrir_navegador():
    for nav in NAVEGADORES:
        if os.path.exists(nav):
            subprocess.Popen([nav, f'--app={URL}', '--window-size=1440,900'], close_fds=True)
            return True
    webbrowser.open(URL)
    return False


def afinar_navegador(ventana, segundos=15):
    """Identidad e íconos de Cauce en la ventana de Edge. Se repite unos segundos porque Edge vuelve a poner el
    favicon cuando termina de cargar la página."""
    comando = f'"{pythonw()}" -I "{os.path.abspath(__file__)}"'
    listas = set()
    fin = time.time() + segundos
    while time.time() < fin:
        try:
            for hwnd in ventana.ventanas(('Chrome_WidgetWin',)):
                if hwnd not in listas and ventana.identidad(hwnd, ICO, comando):
                    listas.add(hwnd)
                ventana.iconos(hwnd, ICO)
        except OSError:
            return
        time.sleep(0.4)


def main():
    from nucleo import ventana
    abiertas = ventana.ventanas()
    if abiertas and responde():
        ventana.al_frente(abiertas[0])
        return
    if not responde():
        # sin un Cauce abierto: primero se busca una versión nueva (GitHub); si la hay, se abre el lanzador nuevo
        from nucleo import actualizar
        if actualizar.actualizar(RAIZ)['estado'] == 'actualizado':
            subprocess.Popen([pythonw(), '-I', os.path.abspath(__file__), *sys.argv[1:]], cwd=RAIZ, close_fds=True)
            return
    if not responde() and not arrancar_servidor():
        ctypes.windll.user32.MessageBoxW(0, 'No se pudo arrancar el servidor de Cauce. Prueba con "Iniciar Cauce.bat" para ver el error.',
                                         'Cauce', 0x10)
        return
    if ventana_propia(ventana, '--depurar' in sys.argv):
        return
    if abrir_navegador():
        afinar_navegador(ventana)


if __name__ == '__main__':
    main()
