# WhatsApp Business Local AI Transcriber

Vollständig lokale Browser-Erweiterung für **Google Chrome** und **Microsoft Edge** (Windows 10/11) zur automatischen Transkription von WhatsApp-Business-Web-Sprachnachrichten ohne Play-Klick – über WhatsApps interne Medienmodule (`WAWebMsgCollection`, `WAWebDownloadManager`) und ein lokal laufendes **Whisper Small** (`Systran/faster-whisper-small`) Backend.

## Architektur-Überblick

1. **Interne Medienmodul-Erfassung (Methode 3):**
   - `extension/src/injected/whatsapp-internal-media-adapter.ts` (`WhatsAppInternalMediaAdapter`) läuft in der `MAIN` World auf `https://web.whatsapp.com/*`.
   - Greift ausschließlich auf die aktive WhatsApp-Sitzung via `window.require('WAWebMsgCollection')` und `window.require('WAWebDownloadManager')` zu.
   - Verwendet `directPath`, `encFilehash`, `filehash`, `mediaKey`, `mediaKeyTimestamp` und `type` ausschließlich flüchtig im Arbeitsspeicher für den internen Download-/Entschlüsselungsaufruf.
   - Kein Play-Klick, keine Blob-/HTMLMediaElement-Umgehung, keine Status- oder Lesebestätigungsänderung.
2. **Validierte Brücken- und UI-Schicht (`ISOLATED` Content Script):**
   - `MutationObserver` erkennt neue, bereits sichtbare, nachgeladene sowie ein- und ausgehende Sprachnachrichten.
   - `TranscriptionQueue` verarbeitet Nachrichten sequenziell (Concurrency 1) und verhindert doppelte Verarbeitung über `messageId` und SHA-256-Audio-Hash.
   - Blendet das Ergebnis direkt unter der jeweiligen Nachricht als **Transkript**-Block im WhatsApp-Light-/Dark-Design ein (Kopieren, Ein-/Ausblenden, Erneut versuchen, Cache-Wiederherstellung).
3. **Lokaler Whisper-Small-Server (`http://127.0.0.1:8765`):**
   - Python-Dienst (`backend/server.py`, `whisper_engine.py`, `audio_processor.py`) mit `Systran/faster-whisper-small`, Beam Size `5`, Temperature `0`, konservativem VAD-Filter.
   - Automatische GPU-Erkennung (NVIDIA CUDA / FP16) mit automatischem Fallback auf CPU / INT8.
   - Striktes `127.0.0.1`-Binding, Origin-Prüfung und lokales Client-Token (`X-Transcriber-Token`).

## Tests & Verifikation (Simuliert vs. Live)

- **Automatisierte Tests (simuliert / lokal ausführbar):**
  - `npm run test:extension` (Adapter-Initialisierung, verzögertes Modulladen, Modul-Drift-Erkennung, Queue-Deduplizierung, SHA-256-Cache, DOM-Rendering, Update-Checker)
  - `python3 -m unittest discover -s backend/tests -p "test_*.py" -v` (Audio-Magic-Byte-Prüfung, Whisper-Small-Qualitätsparameter, CUDA->CPU-Fallback, Loopback/Origin/Token-Sicherheit)
- **Live-Tests mit echtem WhatsApp Web:**
  - Erfordern eine echte angemeldete WhatsApp-Web-Sitzung unter Windows 10/11 in Chrome oder Edge; werden in dieser Sandbox nicht vorgetäuscht.

## GitHub-Repository verbinden & ersten Release (`v1.0.0`) auslösen

```bash
git init
git add .
git commit -m "Initial release v1.0.0: WhatsApp Business Local AI Transcriber"
git branch -M main
git remote add origin https://github.com/Kompetenz-Nord/TransWA.git
git push -u origin main

# Release-Tag setzen (löst .github/workflows/release.yml aus)
git tag v1.0.0
git push origin v1.0.0
```

Nach erfolgreichem Durchlauf der Qualitätsprüfungen veröffentlicht GitHub Actions automatisch:
- `WhatsApp-Local-AI-Transcriber-Chrome-v1.0.0.zip`
- `WhatsApp-Local-AI-Transcriber-Edge-v1.0.0.zip`
- `WhatsApp-Local-AI-Transcriber-Windows-v1.0.0.zip`
- `SHA256SUMS.txt`
