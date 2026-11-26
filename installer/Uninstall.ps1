param(
    [switch]$KeepConfig
)

$ErrorActionPreference = "Stop"

$TargetBase = Join-Path $env:LOCALAPPDATA "WhatsAppLocalAITranscriber"
$TargetBackend = Join-Path $TargetBase "backend"

Write-Host "=== WhatsApp Business Local AI Transcriber - Deinstallation ===" -ForegroundColor Cyan

if (Test-Path (Join-Path $TargetBackend "stop.ps1")) {
    & (Join-Path $TargetBackend "stop.ps1")
}

if ($KeepConfig) {
    foreach ($Sub in @("backend\.venv", "extensions")) {
        $PathToRemove = Join-Path $TargetBase $Sub
        if (Test-Path $PathToRemove) {
            Remove-Item -Path $PathToRemove -Recurse -Force
        }
    }
    Write-Host "[OK] Programmdateien entfernt. auth.token unter $TargetBase wurde beibehalten." -ForegroundColor Green
} else {
    if (Test-Path $TargetBase) {
        Remove-Item -Path $TargetBase -Recurse -Force
        Write-Host "[OK] Vollständig entfernt: $TargetBase" -ForegroundColor Green
    } else {
        Write-Host "[INFO] Keine Installation unter $TargetBase gefunden."
    }
}

Write-Host "Hinweis: Entfernen Sie die Browser-Erweiterung zusätzlich unter chrome://extensions bzw. edge://extensions." -ForegroundColor Yellow
