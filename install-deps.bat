@echo off
rem LEGT AI bagimlilik kurucu (Windows) - install-deps.ps1'i calistirir
rem Kullanim: install-deps.bat [--clean]
rem   --clean   node_modules'u her durumda silip sifirdan kur
setlocal
chcp 65001 >nul

set "PS_ARGS="
if /i "%~1"=="--clean" set "PS_ARGS=-Clean"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-deps.ps1" %PS_ARGS%
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" pause
exit /b %RC%
