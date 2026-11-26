# Datenschutz (PRIVACY.md)

## Vollständig lokale Verarbeitung
WhatsApp Business Local AI Transcriber verarbeitet sämtliche Audiodaten ausschließlich auf Ihrem lokalen Computer:

- **Keine Cloud-APIs:** Es gibt keine Anbindung an OpenAI, Google Speech, Azure oder andere externe Transkriptionsdienste – auch nicht als optionaler Fallback.
- **Keine Telemetrie & kein Tracking:** Es werden keinerlei Nutzungsdaten, Fehlerberichte oder Analysedaten versendet.
- **Kein Audio-Export:** Entschlüsselte OGG/Opus-Audiodaten werden flüchtig an `http://127.0.0.1:8765` übergeben und nach Abschluss der Transkription sofort aus Arbeitsspeicher und temporären Dateien gelöscht.
- **Minimaler lokaler Cache:** In `chrome.storage.local` werden ausschließlich `messageId`, SHA-256-Audio-Hash, Transkript, erkannte Sprache, Modellversion (`Systran/faster-whisper-small`) und Zeitstempel abgelegt. Telefonnummern, Kontakte oder Medienschlüssel werden nicht gespeichert.
- **Vollständige Löschbarkeit:** Alle gespeicherten Transkripte lassen sich in den Erweiterungsoptionen mit einem Klick vollständig löschen.
- **Passive Update-Prüfung:** Die optionale Versionsprüfung fragt lediglich das neueste Release-Tag auf GitHub ab und führt niemals fremden JavaScript-Code aus. Sie kann jederzeit deaktiviert werden.
