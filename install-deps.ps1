# LEGT AI bagimlilik kurucu (Windows)
# Kullanim: .\install-deps.ps1 [-Clean]
#   -Clean   node_modules'u her durumda silip sifirdan kur
# node_modules baska bir platformda (WSL/Linux) kurulduysa yerel binding'ler
# (rolldown, electron) eksik kalir; bu betik bunu algilayip yeniden kurar.
param([switch]$Clean)

# 'Stop' kullanilmaz: PS 5.1 yerel komutlarin stderr ciktisini hata sayar
$ErrorActionPreference = 'Continue'
# VS Code terminalleri bunu devralir; ayarliyken Electron duz Node gibi calisir
$env:ELECTRON_RUN_AS_NODE = $null
Set-Location -LiteralPath $PSScriptRoot

function Fail([string]$msg) {
  Write-Host "HATA: $msg" -ForegroundColor Red
  exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail "Node.js bulunamadi. Node 20 veya uzerini kurun: https://nodejs.org`n       ya da: winget install -e --id OpenJS.NodeJS.LTS"
}
$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 20) { Fail "Node $nodeMajor bulundu, en az Node 20 gerekli." }

# Kurulu paketler bu platformda calisiyor mu?
function Test-Deps {
  if (-not (Test-Path 'node_modules')) { return $false }
  node --input-type=module -e "await import('rolldown')" 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Host '>> rolldown yerel binding''i bu platform icin eksik.'
    return $false
  }
  # require('electron') ikiliyi indirmeye calisabilir; path.txt'yi dogrudan oku
  $pathTxt = 'node_modules\electron\path.txt'
  $electron = if (Test-Path $pathTxt) { Join-Path 'node_modules\electron\dist' (Get-Content $pathTxt -Raw).Trim() }
  if (-not $electron -or -not (Test-Path -LiteralPath $electron)) {
    Write-Host '>> Electron ikili dosyasi bu platform icin eksik.'
    return $false
  }
  return $true
}

if (-not $Clean -and (Test-Deps)) {
  Write-Host '>> Bagimliliklar zaten kurulu ve bu platformla uyumlu.'
  exit 0
}

if (Test-Path 'node_modules') {
  Write-Host '>> node_modules siliniyor...'
  if (Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$PSScriptRoot\*" }) {
    Fail 'LEGT AI (Electron) acik; once uygulamayi kapatin.'
  }
  Remove-Item -Recurse -Force 'node_modules' -ErrorAction Stop
}

Write-Host '>> Bagimliliklar kuruluyor...'
if (Test-Path 'package-lock.json') {
  npm ci --no-audit --no-fund
} else {
  npm install --no-audit --no-fund
}
if ($LASTEXITCODE -ne 0) { Fail 'npm kurulumu basarisiz.' }

if (-not (Test-Deps)) {
  Fail "Kurulum sonrasi yerel binding'ler hala eksik. 'npm config get omit' ciktisinda 'optional' olmadigindan emin olun."
}
Write-Host '>> Bagimliliklar hazir.' -ForegroundColor Green
