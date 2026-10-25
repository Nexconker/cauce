# Cauce · Nex-Industries

Un EPANET más claro para revisar, correr y comparar modelos de redes de agua (`.inp`), en tu propio PC. Usa el mismo
motor de cálculo de EPANET (2.2 y 2.3) y le suma revisión de errores antes de correr, escenarios como capas sobre el
archivo base (sin copiar `.inp`), quinquenios con obras por año, escenarios de EPANET (`.scn`), informes, vista 3D y
scripts en Python. El `.inp` original nunca se sobrescribe.

## Instalar

1. Descarga la última versión: [Releases](https://github.com/Nexconker/cauce/releases/latest) → *Source code (zip)*.
2. Descomprímela en una carpeta donde se vaya a quedar (por ejemplo, Documentos) y abre **Instalar Cauce.bat**.
   Si falta Python 3.12 o más nuevo, el instalador ofrece ponerlo.
3. Quedan accesos directos «Cauce» en el escritorio y en el menú Inicio.

Las instrucciones completas están en [`LEEME - Instalar.txt`](LEEME%20-%20Instalar.txt) y lo que hace cada parte en
[`LEEME.md`](LEEME.md).

## Actualizaciones

Cauce se actualiza solo: cada vez que se abre mira si hay una versión publicada más nueva y, si la hay, la baja y la
instala antes de arrancar. Tu configuración, tus escenarios y tus scripts (la carpeta `trabajo/`) no se tocan. Sin
internet abre la versión que tengas.

Para publicar una versión (quien mantiene el repositorio):

```
python -I scripts/publicar.py 1.2.0 "Qué cambió"
```

## Licencias de terceros

- EPANET 2.2 y 2.3 (`motor/`): dominio público, de la Agencia de Protección Ambiental de Estados Unidos (US EPA) y
  el proyecto Open Water Analytics.
- three.js r128 (`web/lib/three/`): licencia MIT, incluida en esa carpeta.
- Fuentes Geist (`web/fuentes/`): SIL Open Font License, incluida en esa carpeta.
