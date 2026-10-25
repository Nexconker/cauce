@echo off
rem Abre Cauce con consola visible (para ver errores). Lo normal es el acceso directo "Cauce" (lanzar.pyw).
cd /d "%~dp0"
set "PY=python"
where py >nul 2>nul && set "PY=py -3"
%PY% -I cauce.py
if errorlevel 1 pause
