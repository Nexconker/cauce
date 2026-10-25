"""La ventana de Cauce en Windows: identidad en la barra de tareas, íconos y accesos directos (por ctypes).

La ventana propia (pywebview, en lanzar.pyw) y la de respaldo en modo app de Edge llevan la identidad de Cauce
(AppUserModelID) con su .ico, que trae todos los tamaños. Con la misma identidad en los accesos directos, la ventana
abierta y el acceso anclado son el mismo botón, y anclar la ventana ancla el lanzador de Cauce, no Python ni Edge.
En la de Edge además hay que cambiarle los íconos: Edge pone el favicon a 16 px y Windows lo estira a 32 (borroso).
"""
import ctypes
import os
from ctypes import wintypes

AUMID = 'NexIndustries.Cauce'
TITULO = 'Cauce'                 # el título de la ventana propia y el <title> de la página (Edge lo usa en --app)
CLASES = ('Chrome_WidgetWin', 'WindowsForms10')      # ventana de Edge en modo app / ventana propia (pywebview)

VT_LPWSTR = 31
WM_SETICON, ICON_SMALL, ICON_BIG = 0x0080, 0, 1
IMAGE_ICON, LR_LOADFROMFILE = 1, 0x0010
STGM_READWRITE = 0x00000002
CLSCTX_INPROC_SERVER = 0x1


class GUID(ctypes.Structure):
    _fields_ = [('a', ctypes.c_ulong), ('b', ctypes.c_ushort), ('c', ctypes.c_ushort), ('d', ctypes.c_ubyte * 8)]


class PROPERTYKEY(ctypes.Structure):
    _fields_ = [('fmtid', GUID), ('pid', ctypes.c_ulong)]


class PROPVARIANT(ctypes.Structure):
    # vt + 3 reservados y la unión de 16 bytes (en 64 bits); solo se usa VT_LPWSTR
    _fields_ = [('vt', ctypes.c_ushort), ('r1', ctypes.c_ushort), ('r2', ctypes.c_ushort), ('r3', ctypes.c_ushort),
                ('p', ctypes.c_void_p), ('p2', ctypes.c_void_p)]


def _guid(texto):
    g = GUID()
    ctypes.windll.ole32.CLSIDFromString(ctypes.c_wchar_p(texto), ctypes.byref(g))
    return g


IID_IPropertyStore = '{886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99}'
IID_IPersistFile = '{0000010B-0000-0000-C000-000000000046}'
IID_IShellLinkW = '{000214F9-0000-0000-C000-000000000046}'
CLSID_ShellLink = '{00021401-0000-0000-C000-000000000046}'
_FMT_AUMID = '{9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3}'
PKEY = {'comando': 2, 'icono': 3, 'nombre': 4, 'id': 5}     # System.AppUserModel.RelaunchCommand, ...Icon, ...Name, .ID


def _metodo(obj, indice, *argtypes, res=ctypes.HRESULT):
    """Método `indice` de la tabla virtual de un objeto COM."""
    tabla = ctypes.cast(obj, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
    return ctypes.WINFUNCTYPE(res, ctypes.c_void_p, *argtypes)(tabla[indice])


def _soltar(obj):
    if obj:
        _metodo(obj, 2, res=ctypes.c_ulong)(obj)


def _consultar(obj, iid):
    out = ctypes.c_void_p()
    _metodo(obj, 0, ctypes.POINTER(GUID), ctypes.POINTER(ctypes.c_void_p))(obj, ctypes.byref(_guid(iid)), ctypes.byref(out))
    return out


def _poner(store, valores):
    """valores: {'id' | 'comando' | 'icono' | 'nombre': texto} en un IPropertyStore, y Commit."""
    poner = _metodo(store, 6, ctypes.POINTER(PROPERTYKEY), ctypes.POINTER(PROPVARIANT))
    vivos = []
    for clave, texto in valores.items():
        buf = ctypes.create_unicode_buffer(texto)
        vivos.append(buf)
        pv = PROPVARIANT(vt=VT_LPWSTR, p=ctypes.cast(buf, ctypes.c_void_p).value)
        poner(store, ctypes.byref(PROPERTYKEY(_guid(_FMT_AUMID), PKEY[clave])), ctypes.byref(pv))
    _metodo(store, 7)(store)


def _valores(ico, comando):
    return {'id': AUMID, 'icono': f'{ico},0', 'nombre': TITULO, **({'comando': comando} if comando else {})}


# ---------------------------------------------------------------- ventanas
def ventanas(clases=CLASES, pid=None):
    """Ventanas visibles cuyo título es exactamente el de Cauce, de las clases dadas (y de ese proceso, si se dice)."""
    u = ctypes.windll.user32
    out = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def cada(hwnd, _):
        if u.IsWindowVisible(hwnd):
            t = ctypes.create_unicode_buffer(128)
            c = ctypes.create_unicode_buffer(64)
            u.GetWindowTextW(hwnd, t, 128)
            u.GetClassNameW(hwnd, c, 64)
            if t.value == TITULO and c.value.startswith(clases):
                p = wintypes.DWORD()
                u.GetWindowThreadProcessId(hwnd, ctypes.byref(p))
                if pid is None or p.value == pid:
                    out.append(hwnd)
        return True

    u.EnumWindows(cada, 0)
    return out


def al_frente(hwnd):
    """Trae una ventana al frente (la restaura si estaba minimizada)."""
    u = ctypes.windll.user32
    if u.IsIconic(hwnd):
        u.ShowWindow(hwnd, 9)                                        # SW_RESTORE
    u.SetForegroundWindow(hwnd)


def barra_oscura(hwnd):
    """Barra de título oscura (Windows 10 20H1 en adelante), como el resto de Cauce."""
    v = ctypes.c_int(1)
    ctypes.windll.dwmapi.DwmSetWindowAttribute(wintypes.HWND(hwnd), 20, ctypes.byref(v), ctypes.sizeof(v))   # DWMWA_USE_IMMERSIVE_DARK_MODE


def identidad(hwnd, ico, comando=''):
    """AppUserModelID de Cauce, con su ícono y el comando para relanzarlo si se ancla la ventana."""
    ctypes.windll.ole32.CoInitialize(None)
    store = ctypes.c_void_p()
    hr = ctypes.windll.shell32.SHGetPropertyStoreForWindow(wintypes.HWND(hwnd), ctypes.byref(_guid(IID_IPropertyStore)), ctypes.byref(store))
    if hr != 0 or not store:
        return False
    try:
        _poner(store, _valores(ico, comando))
        return True
    finally:
        _soltar(store)


_ICONOS = {}


def iconos(hwnd, ico):
    """Íconos de la ventana desde el .ico, cada uno en el tamaño exacto que pide Windows (sin estirar)."""
    u = ctypes.windll.user32
    u.LoadImageW.restype = wintypes.HANDLE
    u.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    for tipo, metrica in ((ICON_BIG, 11), (ICON_SMALL, 49)):         # SM_CXICON, SM_CXSMICON
        lado = u.GetSystemMetrics(metrica)
        h = _ICONOS.get(lado)
        if not h:
            h = _ICONOS[lado] = u.LoadImageW(None, ico, IMAGE_ICON, lado, lado, LR_LOADFROMFILE)
        if h:
            u.SendMessageW(hwnd, WM_SETICON, tipo, h)


# ---------------------------------------------------------------- accesos directos
def acceso_directo(lnk, destino, argumentos, carpeta, ico, descripcion=''):
    """Crea o actualiza un .lnk con el ícono de Cauce y su AppUserModelID."""
    ole32 = ctypes.windll.ole32
    ole32.CoInitialize(None)
    link = ctypes.c_void_p()
    hr = ole32.CoCreateInstance(ctypes.byref(_guid(CLSID_ShellLink)), None, CLSCTX_INPROC_SERVER,
                                ctypes.byref(_guid(IID_IShellLinkW)), ctypes.byref(link))
    if hr != 0:
        raise OSError(f'CoCreateInstance(ShellLink) = {hr:#x}')
    archivo = store = None
    try:
        w = ctypes.c_wchar_p
        _metodo(link, 20, w)(link, destino)                    # SetPath
        _metodo(link, 11, w)(link, argumentos)                 # SetArguments
        _metodo(link, 9, w)(link, carpeta)                     # SetWorkingDirectory
        _metodo(link, 7, w)(link, descripcion)                 # SetDescription
        _metodo(link, 17, w, ctypes.c_int)(link, ico, 0)       # SetIconLocation
        store = _consultar(link, IID_IPropertyStore)
        _poner(store, _valores(ico, ''))
        archivo = _consultar(link, IID_IPersistFile)
        os.makedirs(os.path.dirname(lnk), exist_ok=True)
        hr = _metodo(archivo, 6, w, wintypes.BOOL)(archivo, lnk, True)    # Save
        if hr != 0:
            raise OSError(f'No se pudo guardar {lnk} ({hr:#x})')
    finally:
        _soltar(store)
        _soltar(archivo)
        _soltar(link)
