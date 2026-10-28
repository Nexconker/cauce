"""Actualización automática desde GitHub (repositorio público Nexconker/cauce).

Al abrir Cauce (lanzar.pyw, o cauce.py desde "Iniciar Cauce.bat") se mira la versión publicada en el archivo VERSION
de la rama main. Si es más nueva que la instalada, se baja el zip de esa versión (etiqueta vX.Y.Z), se comprueba que
sea Cauce y que diga la misma versión, y se copia encima de la carpeta sin tocar trabajo/ (configuración, escenarios y
scripts de cada persona) ni lib/ (los paquetes que instaló "Instalar Cauce.bat"). Los archivos que la versión nueva ya
no trae se borran, si los puso una actualización anterior (trabajo/instalado.json lleva la lista).

Sin internet, con GitHub caído o con cualquier error, Cauce abre como estaba: actualizar nunca impide abrir.
No corre en una copia de desarrollo (una carpeta con .git): ahí manda git. Se apaga con la variable de entorno
CAUCE_SIN_ACTUALIZAR=1 o con "actualizar": false en trabajo/config.json.
"""
import io
import json
import os
import re
import shutil
import tempfile
import time
import urllib.request
import zipfile

REPO = 'Nexconker/cauce'
URL_VERSION = f'https://raw.githubusercontent.com/{REPO}/main/VERSION'
URL_ZIP = f'https://codeload.github.com/{REPO}/zip/refs/tags/v{{v}}'
PROTEGIDO = {'trabajo', 'lib', '.git', '__pycache__'}      # carpetas de primer nivel que nunca se tocan
RE_VERSION = re.compile(r'^\d+(\.\d+){1,3}$')


def tupla(v):
    return tuple(int(x) for x in v.split('.'))


def version_local(raiz):
    try:
        with open(os.path.join(raiz, 'VERSION'), encoding='utf-8') as fh:
            v = fh.read().strip()
        return v if RE_VERSION.match(v) else '0'
    except OSError:
        return '0'


def _leer(url, timeout):
    pedido = urllib.request.Request(url, headers={'User-Agent': 'Cauce', 'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(pedido, timeout=timeout) as r:
        return r.read()


def version_remota(timeout=4):
    v = _leer(URL_VERSION, timeout).decode('utf-8').strip()
    if not RE_VERSION.match(v):
        raise ValueError(f'VERSION publicada inválida: {v[:40]!r}')
    return v


def apagada(raiz):
    if os.environ.get('CAUCE_SIN_ACTUALIZAR'):
        return True
    try:
        with open(os.path.join(raiz, 'trabajo', 'config.json'), encoding='utf-8') as fh:
            return json.load(fh).get('actualizar') is False
    except (OSError, ValueError):
        return False


def _archivos(carpeta):
    """Rutas relativas (con /) de todos los archivos, sin las carpetas protegidas."""
    out = []
    for base, dirs, files in os.walk(carpeta):
        rel = os.path.relpath(base, carpeta)
        if rel == '.':
            dirs[:] = [d for d in dirs if d not in PROTEGIDO]
        dirs[:] = [d for d in dirs if d != '__pycache__']
        for f in files:
            out.append(os.path.normpath(os.path.join(rel, f)).replace('\\', '/'))
    return sorted(out)


def instalar_zip(raiz, datos, version):
    """Copia el zip de una versión encima de raiz. Devuelve (copiados, borrados)."""
    with zipfile.ZipFile(io.BytesIO(datos)) as z:
        nombres = z.namelist()
        tope = nombres[0].split('/')[0] + '/'            # GitHub mete todo en "cauce-1.2.0/"
        if f'{tope}cauce.py' not in nombres or f'{tope}VERSION' not in nombres:
            raise ValueError('El zip descargado no es Cauce.')
        if z.read(f'{tope}VERSION').decode('utf-8').strip() != version:
            raise ValueError('El zip descargado no corresponde a la versión publicada.')
        tmp = tempfile.mkdtemp(prefix='cauce-act-')
        try:
            z.extractall(tmp)
            nueva = os.path.join(tmp, tope.rstrip('/'))
            lista = _archivos(nueva)
            copiados = 0
            for rel in lista:
                if rel.split('/')[0] in PROTEGIDO:
                    continue
                origen = os.path.join(nueva, *rel.split('/'))
                destino = os.path.join(raiz, *rel.split('/'))
                # lo que no cambió no se toca (así una DLL del motor cargada por otro proceso no estorba)
                if os.path.isfile(destino) and _igual(origen, destino):
                    continue
                os.makedirs(os.path.dirname(destino), exist_ok=True)
                provisional = destino + '.nuevo'
                shutil.copy2(origen, provisional)
                os.replace(provisional, destino)
                copiados += 1
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    registro = os.path.join(raiz, 'trabajo', 'instalado.json')
    borrados = []
    try:
        with open(registro, encoding='utf-8') as fh:
            antes = json.load(fh).get('archivos', [])
    except (OSError, ValueError):
        antes = []
    for rel in sorted(set(antes) - set(lista)):
        if rel.split('/')[0] in PROTEGIDO:
            continue
        try:
            os.remove(os.path.join(raiz, *rel.split('/')))
            borrados.append(rel)
        except OSError:
            pass
    os.makedirs(os.path.dirname(registro), exist_ok=True)
    with open(registro, 'w', encoding='utf-8') as fh:
        json.dump({'version': version, 'archivos': lista}, fh, ensure_ascii=False, indent=1)
    return copiados, borrados


def _igual(a, b):
    if os.path.getsize(a) != os.path.getsize(b):
        return False
    with open(a, 'rb') as fa, open(b, 'rb') as fb:
        return fa.read() == fb.read()


def actualizar(raiz, timeout=6):
    """{'estado': 'al_dia'|'actualizado'|'omitido'|'error', 'local', 'remota', 'motivo'}. Nunca lanza.
    El resultado queda en trabajo/ultimo_intento.json para que Ajustes muestre por qué no se actualizó."""
    r = _actualizar(raiz, timeout)
    if r['estado'] != 'omitido':
        try:
            os.makedirs(os.path.join(raiz, 'trabajo'), exist_ok=True)
            with open(os.path.join(raiz, 'trabajo', 'ultimo_intento.json'), 'w', encoding='utf-8') as fh:
                json.dump(dict(r, cuando=time.strftime('%Y-%m-%d %H:%M')), fh, ensure_ascii=False)
        except OSError:
            pass
    return r


def ultimo_intento(raiz):
    try:
        with open(os.path.join(raiz, 'trabajo', 'ultimo_intento.json'), encoding='utf-8') as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def _actualizar(raiz, timeout):
    local = version_local(raiz)
    if os.path.isdir(os.path.join(raiz, '.git')):
        return {'estado': 'omitido', 'local': local, 'motivo': 'copia de desarrollo (git)'}
    if apagada(raiz):
        return {'estado': 'omitido', 'local': local, 'motivo': 'actualización apagada'}
    try:
        remota = version_remota(timeout)
        if tupla(remota) <= tupla(local):
            return {'estado': 'al_dia', 'local': local, 'remota': remota}
        datos = _leer(URL_ZIP.format(v=remota), 60)
        copiados, borrados = instalar_zip(raiz, datos, remota)
        aviso = os.path.join(raiz, 'trabajo', 'actualizacion.json')
        with open(aviso, 'w', encoding='utf-8') as fh:
            json.dump({'de': local, 'a': remota, 'cuando': time.strftime('%Y-%m-%d %H:%M'), 'archivos': copiados,
                       'borrados': borrados}, fh, ensure_ascii=False)
        return {'estado': 'actualizado', 'local': local, 'remota': remota}
    except Exception as ex:                                  # sin internet, GitHub caído, zip raro...: abre como estaba
        return {'estado': 'error', 'local': local, 'motivo': f'{type(ex).__name__}: {ex}'[:300]}


def aviso_pendiente(raiz):
    """Lo que dejó la última actualización, una sola vez (para el aviso de la interfaz)."""
    ruta = os.path.join(raiz, 'trabajo', 'actualizacion.json')
    try:
        with open(ruta, encoding='utf-8') as fh:
            d = json.load(fh)
        os.remove(ruta)
        return d
    except (OSError, ValueError):
        return None
