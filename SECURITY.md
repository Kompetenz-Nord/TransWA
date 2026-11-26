# Sicherheitsarchitektur (SECURITY.md)

## 1. Striktes Loopback-Binding
Der lokale Python-Server (`backend/server.py`) akzeptiert ausschließlich Bindungen an `127.0.0.1` (`localhost`) auf Port `8765`. Öffentliche Schnittstellen wie `0.0.0.0` werden beim Start programmatisch verweigert.

## 2. Origin- und Client-Authentifizierung
- **Origin-Prüfung:** Der Server blockiert reguläre Webseiten (`http://*`, `https://*`) mit `403 Forbidden` und erlaubt ausschließlich `chrome-extension://*`, `extension://*` sowie direkte Extension-Service-Worker-Anfragen.
- **Client-Token:** Jeder `/health`- und `/transcribe`-Aufruf erfordert das lokal bei der Installation erzeugte 32-Byte-Token im Header `X-Transcriber-Token` (oder `Authorization: Bearer`), geprüft mit konstantzeitlichem `hmac.compare_digest`.

## 3. Weltentrennung (MAIN vs. ISOLATED)
- Das `MAIN`-World-Skript (`extension/src/injected/main-world.ts`) hat ausschließlich Zugriff auf die internen WhatsApp-Web-Module (`WAWebMsgCollection`, `WAWebDownloadManager`), erhält jedoch **keine** persistenten Chrome-Storage-Daten und **kein** lokales Server-Token.
- Die Kommunikation zwischen `MAIN` World und `ISOLATED` Content Script erfolgt über `window.postMessage` mit strikter Schema-, Origin- (`https://web.whatsapp.com`) und Byte-Limit-Validierung (max. 50 MB).

## 4. Flüchtige Medienschlüssel
`mediaKey`, `encFilehash`, `filehash` und `directPath` werden ausschließlich flüchtig im Arbeitsspeicher des `WhatsAppInternalMediaAdapter` an WhatsApps eigene Entschlüsselungsfunktion übergeben, niemals protokolliert, niemals gespeichert und niemals übertragen.
