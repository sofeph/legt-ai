@echo off
rem LEGT AI baslatici (Windows)
rem Kullanim: start.bat [dev^|build^|preview^|test^|typecheck^|dist] [--yes]   (varsayilan: dev)
rem   --yes   Ollama kurulumu ve model indirme sorularini otomatik onayla
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
rem VS Code terminalleri bunu devralir; ayarliyken Electron duz Node gibi calisir
set "ELECTRON_RUN_AS_NODE="

cd /d "%~dp0"

set "CMD=dev"
set "ASSUME_YES=%LEGT_YES%"
if "%ASSUME_YES%"=="" set "ASSUME_YES=0"
:parse
if "%~1"=="" goto parsed
if /i "%~1"=="--yes" (set "ASSUME_YES=1") else if /i "%~1"=="-y" (set "ASSUME_YES=1") else set "CMD=%~1"
shift
goto parse
:parsed

set "OLLAMA_URL=http://localhost:11434"
set "RECOMMENDED_MODEL=qwen2.5-coder:7b"

where node >nul 2>&1
if errorlevel 1 (
  echo HATA: Node.js bulunamadi. Node 20 veya uzerini kurun: https://nodejs.org
  echo        ya da: winget install -e --id OpenJS.NodeJS.LTS
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -p "process.versions.node.split('.')[0]"') do set "NODE_MAJOR=%%v"
if %NODE_MAJOR% LSS 20 (
  echo HATA: Node %NODE_MAJOR% bulundu, en az Node 20 gerekli.
  pause
  exit /b 1
)

rem Eksik ya da baska platformda (WSL) kurulmus node_modules'u onarir
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-deps.ps1"
if errorlevel 1 (
  echo HATA: Bagimlilik kurulumu basarisiz.
  pause
  exit /b 1
)

where php >nul 2>&1
if errorlevel 1 echo Not: 'php' bulunamadi; PHP dosyalari php -l yerine basit kontrolle dogrulanacak.

if /i "%CMD%"=="dev" call :ensure_ollama
if /i "%CMD%"=="preview" call :ensure_ollama

if /i "%CMD%"=="dev" goto run
if /i "%CMD%"=="build" goto run
if /i "%CMD%"=="preview" goto run
if /i "%CMD%"=="test" goto run
if /i "%CMD%"=="typecheck" goto run
if /i "%CMD%"=="dist" goto run
echo Bilinmeyen komut: %CMD%
echo Kullanim: start.bat [dev^|build^|preview^|test^|typecheck^|dist] [--yes]
exit /b 1

:run
call npm run %CMD%
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" pause
exit /b %RC%

rem ---------------------------------------------------------------
:ask
rem call :ask "Soru"  -> errorlevel 0 = evet
if "%ASSUME_YES%"=="1" exit /b 0
set "REPLY="
set /p "REPLY=%~1 [E/h] "
if "%REPLY%"=="" exit /b 0
if /i "%REPLY:~0,1%"=="e" exit /b 0
if /i "%REPLY:~0,1%"=="y" exit /b 0
exit /b 1

:ollama_up
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 '%OLLAMA_URL%/api/tags' | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
exit /b %ERRORLEVEL%

:find_ollama
set "OLLAMA_EXE="
for /f "delims=" %%p in ('where ollama 2^>nul') do if not defined OLLAMA_EXE set "OLLAMA_EXE=%%p"
if not defined OLLAMA_EXE if exist "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" set "OLLAMA_EXE=%LOCALAPPDATA%\Programs\Ollama\ollama.exe"
exit /b 0

:ensure_ollama
call :find_ollama
if defined OLLAMA_EXE goto ollama_installed
echo ^>^> Ollama bulunamadi.
call :ask "Ollama simdi kurulsun mu? (resmi yukleyici, ollama.com)"
if errorlevel 1 (
  echo Not: Ollama kurulmadi. LM Studio / llama.cpp gibi baska bir yerel sunucuyu Ayarlar'dan baglayabilirsiniz.
  exit /b 0
)
where winget >nul 2>&1
if not errorlevel 1 (
  winget install -e --id Ollama.Ollama --accept-source-agreements --accept-package-agreements
) else (
  echo ^>^> winget yok, yukleyici indiriliyor...
  powershell -NoProfile -Command "$ErrorActionPreference='Stop'; $f=Join-Path $env:TEMP 'OllamaSetup.exe'; Invoke-WebRequest -UseBasicParsing 'https://ollama.com/download/OllamaSetup.exe' -OutFile $f; Start-Process -FilePath $f -ArgumentList '/SILENT' -Wait"
)
call :find_ollama
if not defined OLLAMA_EXE (
  echo Uyari: Ollama kurulumu dogrulanamadi. https://ollama.com/download adresinden elle kurun.
  exit /b 0
)

:ollama_installed
call :ollama_up
if not errorlevel 1 goto ollama_model
echo ^>^> Ollama servisi baslatiliyor...
start "" /b "%OLLAMA_EXE%" serve >nul 2>&1
for /l %%i in (1,1,15) do (
  call :ollama_up
  if not errorlevel 1 goto ollama_model
  timeout /t 1 /nobreak >nul
)
echo Uyari: Ollama baslatilamadi.
exit /b 0

:ollama_model
"%OLLAMA_EXE%" list 2>nul | findstr /i "coder" >nul
if not errorlevel 1 exit /b 0
echo ^>^> Kod odakli bir model bulunamadi (7B+ onerilir).
call :ask "Onerilen model indirilsin mi? (%RECOMMENDED_MODEL%, ~4.7 GB)"
if errorlevel 1 exit /b 0
"%OLLAMA_EXE%" pull %RECOMMENDED_MODEL%
exit /b 0
