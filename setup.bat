@echo off
rem First time only: install Python packages for the dashboard build.
chcp 65001 >nul
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (set "PY=py -3") else (set "PY=python")
%PY% -m pip install -r requirements.txt
echo.
pause
