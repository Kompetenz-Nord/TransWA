$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$VenvPython = Join-Path $ScriptDir ".venv\Scripts\python.exe"
$AppDataDir = Join-Path $env:LOCALAPPDATA "WhatsAppLocalAITranscriber"
$PidFile = Join-Path $AppDataDir "server.pid"
$LogOut = Join-Path $AppDataDir "server.out.log"
$LogErr = Join-Path $AppDataDir "server.err.log"

if (-not (Test-Path $VenvPython)) {
    Write-Error "Virtuelle Umgebung nicht gefunden. Bitte zuerst backend\install.ps1 ausführen."
    exit 1
}

if (-not (Test-Path $AppDataDir)) {
    New-Item -ItemType Directory -Path $AppDataDir -Force | Out-Null
}

if (Test-Path $PidFile) {
    $ExistingPid = Get-Content -Path $PidFile -ErrorAction SilentlyContinue
    if ($ExistingPid -and (Get-Process -Id $ExistingPid -ErrorAction SilentlyContinue)) {
        Write-Host "[INFO] Lokaler Whisper-Server läuft bereits (PID $ExistingPid)." -ForegroundColor Yellow
        exit 0
    }
}

$env:WA_TRANSCRIBER_HOST = "127.0.0.1"
$env:WA_TRANSCRIBER_PORT = "8765"

$Proc = Start-Process -FilePath $VenvPython `
    -ArgumentList "`"$(Join-Path $ScriptDir 'server.py')`"" `
    -WorkingDirectory $ScriptDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $LogOut `
    -RedirectStandardError $LogErr `
    -PassThru

Set-Content -Path $PidFile -Value $Proc.Id -NoNewline -Encoding UTF8
Write-Host "[OK] Lokaler Whisper-Server gestartet auf http://127.0.0.1:8765 (PID $($Proc.Id))." -ForegroundColor Green
