@echo off
rem Build ShinagawaCinema2026_DROP_Dashboard.html from the data in the raw folder.
chcp 65001 >nul
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (set "PY=py -3") else (set "PY=python")
%PY% -X utf8 scripts\build_dashboard.py
echo.
pause
