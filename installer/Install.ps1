<#
.SYNOPSIS
    Installiert WhatsApp Business Local AI Transcriber vollständig lokal unter Windows 10/11
    ohne Administratorrechte und ohne Änderung von Browser-Sicherheitsrichtlinien.
#>
param(
    [switch]$SkipModelDownload,
    [switch]$PreserveConfig = $true
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$BackendDir = Join-Path $RootDir "backend"
$TargetBase = Join-Path $env:LOCALAPPDATA "WhatsAppLocalAITranscriber"
$TargetBackend = Join-Path $TargetBase "backend"
$TargetExtensions = Join-Path $TargetBase "extensions"
$ChecksumFile = Join-Path $RootDir "checksums\SHA256SUMS.txt"
if (-not (Test-Path $ChecksumFile)) {
    $ChecksumFile = Join-Path $RootDir "installer\checksums\SHA256SUMS.txt"
}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " WhatsApp Business Local AI Transcriber - Windows Setup" -ForegroundColor Cyan
Write-Host "============================================================`n" -ForegroundColor Cyan

# 1. Windows-Version prüfen
$OsVer = [System.Environment]::OSVersion.Version
if ($OsVer.Major -lt 10) {
    Write-Error "Windows 10 oder Windows 11 erforderlich (gefunden: $($OsVer.ToString()))."
    exit 1
}
Write-Host "[1/6] Windows-Version OK ($($OsVer.ToString()))" -ForegroundColor Green

# 2. Speicherplatz prüfen (mind. 4 GB frei auf System-/AppData-Laufwerk)
$DriveLetter = $env:LOCALAPPDATA.Substring(0, 1)
$DriveInfo = Get-PSDrive -Name $DriveLetter
$FreeGB = [math]::Round($DriveInfo.Free / 1GB, 2)
if ($FreeGB -lt 4.0) {
    Write-Error "Mindestens 4 GB freier Speicherplatz auf ${DriveLetter}: erforderlich (verfügbar: $FreeGB GB)."
    exit 1
}
Write-Host "[2/6] Freier Speicherplatz OK ($FreeGB GB auf ${DriveLetter}:)" -ForegroundColor Green

# 3. Python-Umgebung prüfen
$PythonFound = $false
foreach ($cmd in @("python", "py")) {
    try {
        $verOut = & $cmd --version 2>$null
        if ($LASTEXITCODE -eq 0 -and $verOut -match "Python 3\.(1[0-9]|[2-9][0-9])") {
            Write-Host "[3/6] Python-Umgebung OK ($verOut)" -ForegroundColor Green
            $PythonFound = $true
            break
        }
    } catch {}
}
if (-not $PythonFound) {
    Write-Error "Python 3.10 oder neuer erforderlich. Es werden keine Drittprogramme automatisch nachinstalliert. Bitte Python manuell installieren."
    exit 1
}

# 4. GPU-Verfügbarkeit prüfen (z. B. NVIDIA RTX 4070)
$NvidiaSmi = Get-Command "nvidia-smi" -ErrorAction SilentlyContinue
if ($NvidiaSmi) {
    $GpuName = (& nvidia-smi --query-gpu=name --format=csv,noheader 2>$null | Select-Object -First 1)
    Write-Host "[4/6] GPU erkannt: $GpuName (bevorzugt CUDA/FP16)" -ForegroundColor Green
} else {
    Write-Host "[4/6] Keine NVIDIA CUDA-GPU erkannt -> CPU/INT8 Fallback aktiv" -ForegroundColor Yellow
}

# 5. Vorhandene Installation erkennen & Konfiguration erhalten
$IsUpgrade = Test-Path $TargetBase
if ($IsUpgrade) {
    Write-Host "[5/6] Bestehende Installation erkannt unter $TargetBase" -ForegroundColor Cyan
    $ExistingStop = Join-Path $TargetBackend "stop.ps1"
    if (Test-Path $ExistingStop) {
        & $ExistingStop
    }
} else {
    New-Item -ItemType Directory -Path $TargetBase -Force | Out-Null
    Write-Host "[5/6] Neue Benutzerinstallation unter $TargetBase" -ForegroundColor Green
}

# Integritätsprüfung vorhandener Checksums (falls im Release-Paket vorhanden)
if (Test-Path $ChecksumFile) {
    Write-Host "Prüfe SHA-256-Prüfsummen der mitgelieferten Pakete..."
    $Lines = Get-Content -Path $ChecksumFile
    foreach ($Line in $Lines) {
        if ($Line -match "^([0-9a-fA-F]{64})\s+\*?(.+)$") {
            $ExpectedHash = $Matches[1].ToLower()
            $RelFile = $Matches[2].Trim()
            $CandidatePath = Join-Path $RootDir $RelFile
            if (Test-Path $CandidatePath) {
                $ActualHash = (Get-FileHash -Path $CandidatePath -Algorithm SHA256).Hash.ToLower()
                if ($ActualHash -ne $ExpectedHash) {
                    Write-Error "SHA-256-Prüfung fehlgeschlagen für $RelFile!"
                    exit 1
                }
                Write-Host "  [SHA-256 OK] $RelFile" -ForegroundColor Green
            }
        }
    }
}

# Backend-Dateien kopieren (ohne bestehende .venv zu löschen, um Upgrades schnell zu halten)
if (-not (Test-Path $TargetBackend)) {
    New-Item -ItemType Directory -Path $TargetBackend -Force | Out-Null
}
Get-ChildItem -Path $BackendDir -Exclude ".venv", "__pycache__", "tests" | Copy-Item -Destination $TargetBackend -Recurse -Force

# Entpackte Chrome- und Edge-Erweiterungsordner bereitstellen (falls im Komplettpaket)
if (-not (Test-Path $TargetExtensions)) {
    New-Item -ItemType Directory -Path $TargetExtensions -Force | Out-Null
}
foreach ($BrowserDir in @("chrome", "edge")) {
    $SrcExt = Join-Path $RootDir "extensions\$BrowserDir"
    if (-not (Test-Path $SrcExt)) {
        $SrcExt = Join-Path $RootDir "dist-extension\$BrowserDir"
    }
    if (Test-Path $SrcExt) {
        Copy-Item -Path $SrcExt -Destination $TargetExtensions -Recurse -Force
    }
}

# 6. Backend-Abhängigkeiten & Modell einrichten
Write-Host "[6/6] Richte lokalen Whisper-Small-Dienst ein..." -ForegroundColor Cyan
$BackendInstaller = Join-Path $TargetBackend "install.ps1"
& $BackendInstaller

Write-Host "`nStarte lokalen Whisper-Server..." -ForegroundColor Cyan
& (Join-Path $TargetBackend "start.ps1")
Start-Sleep -Seconds 2
& (Join-Path $TargetBackend "healthcheck.ps1")

Write-Host "`n============================================================" -ForegroundColor Green
Write-Host " Installation erfolgreich abgeschlossen!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host "Erweiterungsordner für Chrome (chrome://extensions):"
Write-Host "  $(Join-Path $TargetExtensions 'chrome')" -ForegroundColor White
Write-Host "Erweiterungsordner für Edge (edge://extensions):"
Write-Host "  $(Join-Path $TargetExtensions 'edge')" -ForegroundColor White
Write-Host "`nHinweis: Bitte kopieren Sie das oben angezeigte Client-Token in die Erweiterungs-Optionen." -ForegroundColor Yellow
