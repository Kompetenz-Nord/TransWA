$ErrorActionPreference = "Stop"

$AppDataDir = Join-Path $env:LOCALAPPDATA "WhatsAppLocalAITranscriber"
$TokenFile = Join-Path $AppDataDir "auth.token"

if (-not (Test-Path $TokenFile)) {
    Write-Error "Client-Token nicht gefunden unter $TokenFile."
    exit 1
}

$Token = (Get-Content -Path $TokenFile -Raw).Trim()

try {
    $Response = Invoke-RestMethod -Uri "http://127.0.0.1:8765/health" -Method Get -Headers @{
        "X-Transcriber-Token" = $Token
    } -TimeoutSec 3

    Write-Host "[OK] Lokaler Whisper-Server antwortet:" -ForegroundColor Green
    $Response | ConvertTo-Json -Depth 3
} catch {
    Write-Error "Healthcheck fehlgeschlagen: $_"
    exit 1
}
