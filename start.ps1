$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Write-Step($msg, $color = "Cyan") {
  Write-Host ""
  Write-Host " $msg" -ForegroundColor $color
}

Write-Step "Complex Plane - starting..."

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host " ERROR: npm not found. Install Node.js from https://nodejs.org/" -ForegroundColor Red
  Read-Host "Press Enter to exit"
  exit 1
}

$viteCmd = Join-Path $PSScriptRoot "node_modules\.bin\vite.cmd"
if (-not (Test-Path $viteCmd)) {
  Write-Step "Installing dependencies..." "Yellow"
  npm install
}

function Test-ViteReady {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:5173" -UseBasicParsing -TimeoutSec 3
    return $r.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Start-ProdMode {
  Write-Step "Dev server unavailable. Building production bundle..." "Yellow"
  npm run build
  if ($LASTEXITCODE -ne 0) {
    Write-Host " ERROR: build failed." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
  }
  Write-Step "Launching Electron (production mode)..." "Green"
  $env:COMPLEX_PLANE_DEV = "0"
  npx electron .
  exit $LASTEXITCODE
}

# Kill stale vite on 5173 from previous run
$conn = Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue
if ($conn) {
  Write-Step "Port 5173 is busy. Stopping old process..." "Yellow"
  $conn | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
}

Write-Step "Starting Vite dev server..." "Green"
$viteScript = Join-Path $PSScriptRoot "scripts\run-vite.bat"
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "`"$viteScript`"" -WorkingDirectory $PSScriptRoot -WindowStyle Minimized

Write-Step "Waiting for Vite (up to 90 sec)..." "Gray"
$ready = $false
for ($i = 0; $i -lt 45; $i++) {
  if (Test-ViteReady) {
    $ready = $true
    break
  }
  Start-Sleep -Seconds 2
  Write-Host "." -NoNewline -ForegroundColor DarkGray
}
Write-Host ""

if (-not $ready) {
  Write-Host " ERROR: Vite did not start." -ForegroundColor Red
  $log = Join-Path $PSScriptRoot "vite.log"
  if (Test-Path $log) {
    Write-Host ""
    Write-Host " --- vite.log (last 30 lines) ---" -ForegroundColor Yellow
    Get-Content $log -Tail 30
    Write-Host " -------------------------------" -ForegroundColor Yellow
  }
  $ans = Read-Host "Build production version instead? [Y/n]"
  if ($ans -eq "" -or $ans -eq "y" -or $ans -eq "Y") {
    Start-ProdMode
  }
  Read-Host "Press Enter to exit"
  exit 1
}

Write-Step "Launching Electron..." "Green"
$env:COMPLEX_PLANE_DEV = "1"
npx electron .
exit $LASTEXITCODE