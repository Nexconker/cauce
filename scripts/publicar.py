"""Publica una versión nueva de Cauce en GitHub (Nexconker/cauce): los Cauce instalados la bajan solos al abrirse.

    python -I scripts/publicar.py 1.2.0 "Qué cambió, en una línea"

Escribe VERSION, hace el commit "Cauce 1.2.0: ..." con todo lo que haya cambiado (lo de .gitignore nunca sube:
trabajo/, lib/, las notas internas), crea la etiqueta v1.2.0 y sube main y la etiqueta en un solo envío (los Cauce
instalados leen VERSION en main y bajan el zip de la etiqueta, así que las dos tienen que llegar juntas). Si está la
herramienta gh, crea además el release con la nota.
"""
import os
import re
import shutil
import subprocess
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
from nucleo import actualizar  # noqa: E402


def git(*args, salida=False):
    r = subprocess.run(['git', *args], cwd=RAIZ, capture_output=True, text=True, encoding='utf-8')
    if r.returncode != 0:
        sys.exit(f'git {" ".join(args)} falló:\n{r.stderr.strip()}')
    return r.stdout.strip() if salida else None


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    nueva, nota = sys.argv[1].strip().lstrip('v'), ' '.join(sys.argv[2].split())
    if not actualizar.RE_VERSION.match(nueva):
        sys.exit(f'Versión inválida: {nueva} (usa 1.2.0)')
    actual = actualizar.version_local(RAIZ)
    if actualizar.tupla(nueva) <= actualizar.tupla(actual):
        sys.exit(f'La versión nueva ({nueva}) tiene que ser mayor que la actual ({actual}).')
    if not os.path.isdir(os.path.join(RAIZ, '.git')):
        sys.exit('Esta carpeta no es el repositorio de Cauce.')
    if git('rev-parse', '--abbrev-ref', 'HEAD', salida=True) != 'main':
        sys.exit('Publica desde la rama main.')
    if re.search(rf'^v{re.escape(nueva)}$', git('tag', '--list', salida=True), re.M):
        sys.exit(f'Ya existe la etiqueta v{nueva}.')
    with open(os.path.join(RAIZ, 'VERSION'), 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(nueva + '\n')
    git('add', '-A')
    git('commit', '-m', f'Cauce {nueva}: {nota}')
    git('tag', '-a', f'v{nueva}', '-m', f'Cauce {nueva}: {nota}')
    git('push', '--atomic', 'origin', 'main', f'refs/tags/v{nueva}')
    print(f'Publicada la versión {nueva}. Cada Cauce instalado la baja la próxima vez que se abra.')
    if shutil.which('gh'):
        r = subprocess.run(['gh', 'release', 'create', f'v{nueva}', '--title', f'Cauce {nueva}', '--notes', nota],
                           cwd=RAIZ, capture_output=True, text=True, encoding='utf-8')
        print(r.stdout.strip() or r.stderr.strip())


if __name__ == '__main__':
    main()
