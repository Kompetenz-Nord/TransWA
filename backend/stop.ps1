$ErrorActionPreference = "SilentlyContinue"

$AppDataDir = Join-Path $env:LOCALAPPDATA "WhatsAppLocalAITranscriber"
$PidFile = Join-Path $AppDataDir "server.pid"

if (Test-Path $PidFile) {
    $ServerPid = Get-Content -Path $PidFile -Raw
    if ($ServerPid) {
        $Proc = Get-Process -Id ([int]$ServerPid.Trim()) -ErrorAction SilentlyContinue
        if ($Proc) {
            Stop-Process -Id $Proc.Id -Force
            Write-Host "[OK] Lokaler Whisper-Server (PID $($Proc.Id)) gestoppt." -ForegroundColor Green
        } else {
            Write-Host "[INFO] Prozess PID $ServerPid läuft nicht mehr."
        }
    }
    Remove-Item -Path $PidFile -Force -ErrorAction SilentlyContinue
} else {
    Write-Host "[INFO] Keine aktive Server-PID gefunden."
}
