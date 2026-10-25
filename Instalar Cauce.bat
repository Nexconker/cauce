@echo off
setlocal
title Instalar Cauce
cd /d "%~dp0"
echo.
echo   Cauce - Nex-Industries
echo   ----------------------
echo.

rem ---- 1) Python 3.12 o mas nuevo (el lanzador py o python en el PATH)
set "PY="
where py >nul 2>nul
if errorlevel 1 goto probar_python
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)" >nul 2>nul
if not errorlevel 1 set "PY=py -3"
if defined PY goto python_ok
:probar_python
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)" >nul 2>nul
if not errorlevel 1 set "PY=python"
if defined PY goto python_ok

echo   Cauce necesita Python 3.12 o mas nuevo y no lo encontre en este PC.
echo.
where winget >nul 2>nul
if errorlevel 1 goto sin_winget
choice /c SN /m "  Instalo Python 3.13 ahora con winget de Microsoft"
if errorlevel 2 goto sin_winget
winget install -e --id Python.Python.3.13 --scope user --accept-package-agreements --accept-source-agreements
echo.
echo   Python quedo instalado. Cierra esta ventana y vuelve a abrir "Instalar Cauce.bat".
echo.
pause
exit /b 0

:sin_winget
echo   Instala Python desde https://www.python.org/downloads/ marcando "Add python.exe to PATH"
echo   y despues vuelve a abrir "Instalar Cauce.bat".
echo.
pause
exit /b 1

:python_ok
for /f "delims=" %%v in ('%PY% -c "import sys; print(sys.version.split()[0])"') do set "PYV=%%v"
echo   Python %PYV% encontrado.
echo.

rem ---- 2) lo que Cauce necesita, en la carpeta lib (no toca el resto de Python)
echo   Instalando lo que Cauce necesita: openpyxl para Excel y pywebview para su ventana...
%PY% -m pip install --disable-pip-version-check --upgrade --target "%~dp0lib" openpyxl pywebview
if errorlevel 1 goto pip_mal
echo.

rem ---- 3) accesos directos en el escritorio y en el menu Inicio
echo   Creando los accesos directos...
%PY% -I scripts\accesos.py
if errorlevel 1 goto accesos_mal
for /f "usebackq delims=" %%d in (`powershell -NoProfile -Command "[Environment]::GetFolderPath([Environment+SpecialFolder]::Desktop)"`) do copy /y "trabajo\accesos\Cauce.lnk" "%%d\Cauce.lnk" >nul
copy /y "trabajo\accesos\Cauce.lnk" "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Cauce.lnk" >nul
echo.
echo   Listo. Quedo el acceso directo "Cauce" en el escritorio y en el menu Inicio.
echo   No muevas esta carpeta: los accesos directos apuntan aqui.
echo.
choice /c SN /m "  Abrir Cauce ahora"
if errorlevel 2 exit /b 0
start "" "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Cauce.lnk"
exit /b 0

:pip_mal
echo.
echo   No se pudo instalar. Revisa la conexion a internet y vuelve a intentarlo.
echo.
pause
exit /b 1

:accesos_mal
echo.
echo   No se pudieron crear los accesos directos. Cauce igual se puede abrir con "Iniciar Cauce.bat".
echo.
pause
exit /b 1
