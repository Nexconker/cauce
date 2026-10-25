@echo off
rem Crea los accesos directos "Cauce" del escritorio y del menu Inicio, con el icono y la identidad de Cauce.
rem El .lnk lo arma Python (scripts\accesos.py) y lo copia este .bat: ver la nota en ese script.
cd /d "%~dp0"
python -I scripts\accesos.py || (pause & exit /b 1)
for /f "usebackq delims=" %%d in (`powershell -NoProfile -Command "[Environment]::GetFolderPath([Environment+SpecialFolder]::Desktop)"`) do copy /y "trabajo\accesos\Cauce.lnk" "%%d\Cauce.lnk" >nul
copy /y "trabajo\accesos\Cauce.lnk" "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Cauce.lnk" >nul
echo Accesos directos listos en el escritorio y en el menu Inicio.
