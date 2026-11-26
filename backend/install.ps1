$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$VenvDir = Join-Path $ScriptDir ".venv"
$AppDataDir = Join-Path $env:LOCALAPPDATA "WhatsAppLocalAITranscriber"
$TokenFile = Join-Path $AppDataDir "auth.token"

Write-Host "=== WhatsApp Business Local AI Transcriber - Backend Setup ===" -ForegroundColor Cyan

# 1. Python finden (ohne Administratorrechte)
$PythonCmd = $null
foreach ($candidate in @("python", "py -3.12", "py -3.11", "py -3.10")) {
    try {
        $parts = $candidate -split " "
        $ver = & $parts[0] ($parts[1..($parts.Length-1)] + "--version") 2>$null
        if ($LASTEXITCODE -eq 0 -and $ver -match "Python 3\.(1[0-9]|[2-9][0-9])") {
            $PythonCmd = $candidate
            Write-Host "[OK] Python gefunden: $ver ($candidate)" -ForegroundColor Green
            break
        }
    } catch {}
}

if (-not $PythonCmd) {
    Write-Error "Python 3.10+ wurde nicht gefunden. Bitte installieren Sie Python (z. B. python.org) für Ihren Benutzer."
    exit 1
}

# 2. Bestehende Konfiguration & Token erhalten
if (-not (Test-Path $AppDataDir)) {
    New-Item -ItemType Directory -Path $AppDataDir -Force | Out-Null
}

if (Test-Path $TokenFile) {
    Write-Host "[OK] Vorhandenes lokales Client-Token wird beibehalten: $TokenFile" -ForegroundColor Green
} else {
    $Bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($Bytes)
    $Token = [Convert]::ToBase64String($Bytes).Replace("+", "-").Replace("/", "_").TrimEnd("=")
    Set-Content -Path $TokenFile -Value $Token -NoNewline -Encoding UTF8
    Write-Host "[OK] Neues lokales Client-Token erzeugt: $TokenFile" -ForegroundColor Green
}

# 3. Virtuelle Umgebung erstellen oder aktualisieren
if (-not (Test-Path $VenvDir)) {
    Write-Host "Erstelle isolierte Python-Umgebung (.venv)..."
    $parts = $PythonCmd -split " "
    & $parts[0] ($parts[1..($parts.Length-1)] + @("-m", "venv", $VenvDir))
}

$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
$VenvPip = Join-Path $VenvDir "Scripts\pip.exe"

Write-Host "Aktualisiere pip und installiere lokale Abhängigkeiten..."
& $VenvPython -m pip install --upgrade pip --quiet
& $VenvPip install -r (Join-Path $ScriptDir "requirements.lock")

# 4. CUDA-Verfügbarkeit prüfen (NVIDIA RTX 4070 etc.)
$NvidiaSmi = Get-Command "nvidia-smi" -ErrorAction SilentlyContinue
if ($NvidiaSmi) {
    Write-Host "[INFO] NVIDIA GPU erkannt. Prüfe CTranslate2 CUDA-Unterstützung..." -ForegroundColor Cyan
    & $VenvPython -c "import ctranslate2; print('CUDA devices:', ctranslate2.get_cuda_device_count())"
} else {
    Write-Host "[INFO] Keine NVIDIA GPU erkannt. Server nutzt CPU/INT8-Modus." -ForegroundColor Yellow
}

# 5. Whisper Small Modell einmalig lokal herunterladen
Write-Host "Lade Whisper Small Modell (Systran/faster-whisper-small) für Offline-Betrieb vorab..."
& $VenvPython -c "from faster_whisper import WhisperModel; WhisperModel('Systran/faster-whisper-small', device='cpu', compute_type='int8'); print('Modell bereit.')"

Write-Host "`n[FERTIG] Lokaler Whisper-Server ist eingerichtet." -ForegroundColor Green
Write-Host "Client-Token (in Chrome/Edge-Erweiterungsoptionen eintragen):" -ForegroundColor Yellow
Write-Host (Get-Content -Path $TokenFile -Raw) -ForegroundColor White
