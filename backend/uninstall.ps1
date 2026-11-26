$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$StopScript = Join-Path $ScriptDir "stop.ps1"
if (Test-Path $StopScript) {
    & $StopScript
}

$VenvDir = Join-Path $ScriptDir ".venv"
if (Test-Path $VenvDir) {
    Remove-Item -Path $VenvDir -Recurse -Force
    Write-Host "[OK] Virtuelle Python-Umgebung (.venv) entfernt." -ForegroundColor Green
}

$AppDataDir = Join-Path $env:LOCALAPPDATA "WhatsAppLocalAITranscriber"
if (Test-Path $AppDataDir) {
    Remove-Item -Path $AppDataDir -Recurse -Force
    Write-Host "[OK] Lokale Server-Konfiguration und Token entfernt ($AppDataDir)." -ForegroundColor Green
}
