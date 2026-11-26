# WhatsApp Business Local AI Transcriber – Installationsanleitung (Windows 10/11)

Diese Anleitung beschreibt die vollständige, **100 % lokale** Installation ohne Cloud-Dienste, ohne Telemetrie und ohne Administratorrechte.

---

## 1. Systemvoraussetzungen

- **Betriebssystem:** Windows 10 (64-Bit) oder Windows 11
- **Python:** Version 3.10, 3.11 oder 3.12 (über python.org installiert)
- **Browser:** Google Chrome (ab v116) oder Microsoft Edge Chromium
- **Speicherplatz:** mindestens 4 GB frei (für Python-Umgebung & lokales Modell `Systran/faster-whisper-small`)
- **Hardware:** NVIDIA CUDA-GPU (z. B. RTX 4070 mit 12 GB VRAM) wird automatisch mit **CUDA / FP16** genutzt; ohne kompatible GPU erfolgt automatisch der **CPU / INT8**-Fallback.

---

## 2. Lokalen Whisper-Server installieren

1. Laden Sie das Paket `WhatsApp-Local-AI-Transcriber-Windows-vX.Y.Z.zip` aus den offiziellen **GitHub Releases** herunter und entpacken Sie es in einen lokalen Ordner (z. B. `C:\Users\<Name>\Downloads\WA-Local-AI`).
2. Prüfen Sie optional die Integrität über PowerShell:
   ```powershell
   Get-FileHash .\WhatsApp-Local-AI-Transcriber-Windows-v1.0.0.zip -Algorithm SHA256
   ```
   Vergleichen Sie den Hash mit `SHA256SUMS.txt` aus dem GitHub Release.
3. Öffnen Sie ein normales PowerShell-Fenster (keine Administratorrechte nötig) im entpackten Ordner und starten Sie:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\installer\Install.ps1
   ```
4. Das Skript prüft Windows-Version, Speicherplatz, Python, GPU und lädt einmalig das Modell `Systran/faster-whisper-small` lokal herunter.
5. Am Ende wird ein persönliches **Client-Token** angezeigt (gespeichert unter `%LOCALAPPDATA%\WhatsAppLocalAITranscriber\auth.token`). Kopieren Sie dieses Token für Schritt 3/4.

> Nach abgeschlossener Installation funktioniert die gesamte Transkription **vollständig offline** (nur die WhatsApp-Web-Verbindung selbst benötigt Internet).

---

## 3. Erweiterung in Google Chrome installieren (`chrome://extensions`)

Eine reguläre Windows-Chrome-Installation blockiert aus Sicherheitsgründen selbst gehostete `.zip`/`.crx`-Erweiterungen außerhalb des Chrome Web Stores. Die Installation erfolgt daher sauber über den offiziellen Entwicklermodus – **ohne** Browser-Sicherheitsrichtlinien zu deaktivieren:

1. Öffnen Sie in Google Chrome die Adresse `chrome://extensions`.
2. Aktivieren Sie oben rechts den Schalter **Entwicklermodus**.
3. Klicken Sie oben links auf **Entpackte Erweiterung laden**.
4. Wählen Sie den Ordner `%LOCALAPPDATA%\WhatsAppLocalAITranscriber\extensions\chrome` (oder den entpackten Ordner des Pakets `WhatsApp-Local-AI-Transcriber-Chrome-vX.Y.Z.zip`).
5. Klicken Sie in den Erweiterungsdetails auf **Erweiterungsoptionen** und fügen Sie Ihr lokales **Client-Token** ein. Klicken Sie auf **Einstellungen speichern** und **Server-Verbindung testen**.

---

## 4. Erweiterung in Microsoft Edge installieren (`edge://extensions`)

1. Öffnen Sie in Microsoft Edge die Adresse `edge://extensions`.
2. Aktivieren Sie links (bzw. unten links) den Schalter **Entwicklermodus**.
3. Klicken Sie auf **Entpacktes Element laden**.
4. Wählen Sie den Ordner `%LOCALAPPDATA%\WhatsAppLocalAITranscriber\extensions\edge` (oder den entpackten Ordner des Pakets `WhatsApp-Local-AI-Transcriber-Edge-vX.Y.Z.zip`).
5. Öffnen Sie die **Erweiterungsoptionen**, fügen Sie das lokale **Client-Token** ein und testen Sie die Verbindung zu `http://127.0.0.1:8765`.

---

## 5. Hinweis zu Chrome Web Store & Microsoft Edge Add-ons

Für eine Installation ohne Entwicklermodus bei Unternehmens- oder Endanwender-Rollouts können die erzeugten Release-Archive (`WhatsApp-Local-AI-Transcriber-Chrome-vX.Y.Z.zip` und `WhatsApp-Local-AI-Transcriber-Edge-vX.Y.Z.zip`) direkt im **Chrome Web Store Developer Dashboard** bzw. im **Microsoft Partner Center (Edge Add-ons)** eingereicht werden.

---

## 6. Server steuern & deinstallieren

- **Server starten:** `%LOCALAPPDATA%\WhatsAppLocalAITranscriber\backend\start.ps1`
- **Server stoppen:** `%LOCALAPPDATA%\WhatsAppLocalAITranscriber\backend\stop.ps1`
- **Status prüfen:** `%LOCALAPPDATA%\WhatsAppLocalAITranscriber\backend\healthcheck.ps1`
- **Deinstallieren:** `powershell -ExecutionPolicy Bypass -File .\installer\Uninstall.ps1`
