export interface ReleaseAssetInfo {
  fileName: string;
  sha256: string;
  bytes: number;
  url: string;
}

export interface ReleaseManifest {
  version: string;
  generatedAt: string;
  assets: ReleaseAssetInfo[];
}

export interface TestMatrixEntry {
  id: string;
  category: string;
  title: string;
  mode: 'Automatisiert (Unit / Simulation)' | 'Manuell (Live WhatsApp Web)';
  target: string;
  status: 'Verifiziert' | 'Live-Prüfung erforderlich';
  notes: string;
}

export const TEST_MATRIX_ENTRIES: TestMatrixEntry[] = [
  {
    id: 'adapter-init',
    category: 'WhatsApp-Integration',
    title: 'Modulinitialisierung (WAWebMsgCollection & WAWebDownloadManager)',
    mode: 'Automatisiert (Unit / Simulation)',
    target: 'extension/tests/adapter.test.ts',
    status: 'Verifiziert',
    notes: 'Prüft sichere Auflösung über Adapter ohne unkontrollierte Modul-Enumeration.',
  },
  {
    id: 'delayed-load',
    category: 'WhatsApp-Integration',
    title: 'Verzögertes Modulladen mit begrenzten Wiederholungen',
    mode: 'Automatisiert (Unit / Simulation)',
    target: 'extension/tests/adapter.test.ts',
    status: 'Verifiziert',
    notes: 'Bounded Retries greifen sauber bis zur Bereitstellung der Laufzeitmodule.',
  },
  {
    id: 'module-drift',
    category: 'Fehlererkennung',
    title: 'Geänderte interne Modulnamen / Signatur-Drift',
    mode: 'Automatisiert (Unit / Simulation)',
    target: 'extension/tests/adapter.test.ts',
    status: 'Verifiziert',
    notes: 'Erkennt SIGNATURE_MISMATCH ohne Absturz und ohne automatischen Play-Klick.',
  },
  {
    id: 'incoming-outgoing',
    category: 'Audio-Erfassung',
    title: 'Empfangene & gesendete Sprachnachrichten ohne Play-Klick',
    mode: 'Automatisiert (Unit / Simulation)',
    target: 'extension/tests/adapter.test.ts',
    status: 'Verifiziert',
    notes: 'Erfasst directPath, encFilehash, filehash, mediaKey (flüchtig) mit isUserInitiated=false.',
  },
  {
    id: 'bridge-security',
    category: 'Browser-Sicherheit',
    title: 'MAIN- zu ISOLATED-World Bridge-Validierung & Key-Sanitizing',
    mode: 'Automatisiert (Unit / Simulation)',
    target: 'extension/tests/adapter.test.ts',
    status: 'Verifiziert',
    notes: 'Blockiert fremde Origins, Puffer > 50 MB und maskiert mediaKey/JIDs in Diagnosen.',
  },
  {
    id: 'queue-dedupe',
    category: 'Warteschlange & Cache',
    title: 'Mehrere gleichzeitige Audios, sequenzielle Abarbeitung & Deduplizierung',
    mode: 'Automatisiert (Unit / Simulation)',
    target: 'extension/tests/queue-and-cache.test.ts',
    status: 'Verifiziert',
    notes: 'Concurrency 1, SHA-256-Deduplizierung, Cache-Wiederherstellung & vollständiges Löschen.',
  },
  {
    id: 'audio-decode',
    category: 'Backend-Verarbeitung',
    title: 'OGG/Opus Magic-Byte-Validierung, SHA-256 & Temp-Puffer-Bereinigung',
    mode: 'Automatisiert (Unit / Simulation)',
    target: 'backend/tests/test_backend.py',
    status: 'Verifiziert',
    notes: 'Erkennt OGG, WAV, MP3, M4A; lehnt beschädigte oder manipulierte Streams ab.',
  },
  {
    id: 'whisper-quality',
    category: 'KI-Modell',
    title: 'Whisper Small Qualitätsparameter (Beam 5, Temp 0, VAD-Filter) & GPU->CPU Fallback',
    mode: 'Automatisiert (Unit / Simulation)',
    target: 'backend/tests/test_backend.py',
    status: 'Verifiziert',
    notes: 'Wechselt bei CUDA-Fehler nahtlos auf cpu/int8 ohne Abbruch der Transkription.',
  },
  {
    id: 'server-security',
    category: 'Lokaler Server',
    title: '127.0.0.1-Loopback-Zwang, Origin-Prüfung & Client-Token-Schutz',
    mode: 'Automatisiert (Unit / Simulation)',
    target: 'backend/tests/test_backend.py',
    status: 'Verifiziert',
    notes: 'Verweigert 0.0.0.0-Bindung, blockiert Webseiten-Origins mit 403.',
  },
  {
    id: 'live-whatsapp',
    category: 'Live-Abnahme',
    title: 'Echte WhatsApp-Business-Web-Sitzung unter Windows 10/11 (Chrome & Edge)',
    mode: 'Manuell (Live WhatsApp Web)',
    target: 'installer/README_DE.md',
    status: 'Live-Prüfung erforderlich',
    notes: 'Erfordert aktive WhatsApp-Web-Anmeldung und lokalen Python/RTX-4070-Dienst auf dem Ziel-PC.',
  },
];
