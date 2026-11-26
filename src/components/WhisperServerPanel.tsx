import { Cpu, HardDrive, Lock, Shield } from 'lucide-react';

export function WhisperServerPanel() {
  return (
    <section className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-2">
        <h2 className="text-base font-semibold text-slate-900">
          Lokaler Whisper-Small-Server (127.0.0.1:8765)
        </h2>
        <p className="text-sm text-slate-600 max-w-3xl">
          Die gesamte Spracherkennung läuft über einen lokalen Python-Dienst mit{' '}
          <span className="font-mono text-slate-900">Systran/faster-whisper-small</span> und CTranslate2.
          Keine Cloud-API, keine Telemetrie und strikte Abschottung gegen fremde lokale Webseiten.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <Cpu className="w-4 h-4 text-emerald-700" />
            <span>Modell &amp; Engine</span>
          </div>
          <div className="font-mono text-sm font-semibold text-slate-900">
            faster-whisper-small
          </div>
          <p className="text-xs text-slate-600">
            Qualität vor Geschwindigkeit: Beam Size 5, Temperature 0, Originalsprache beibehalten.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <HardDrive className="w-4 h-4 text-emerald-700" />
            <span>RTX 4070 &amp; Fallback</span>
          </div>
          <div className="font-mono text-sm font-semibold text-slate-900">
            CUDA FP16 → CPU INT8
          </div>
          <p className="text-xs text-slate-600">
            Automatische CUDA-Erkennung (12 GB VRAM) mit nahtlosem Fallback auf CPU/INT8 bei Fehler.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <Lock className="w-4 h-4 text-emerald-700" />
            <span>Netzwerk &amp; Auth</span>
          </div>
          <div className="font-mono text-sm font-semibold text-slate-900">
            127.0.0.1:8765
          </div>
          <p className="text-xs text-slate-600">
            Origin-Prüfung (nur Browser-Erweiterungen) plus 32-Byte-Token via X-Transcriber-Token.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <Shield className="w-4 h-4 text-emerald-700" />
            <span>Audio-Hygiene</span>
          </div>
          <div className="font-mono text-sm font-semibold text-slate-900">
            PyAV + SHA-256
          </div>
          <p className="text-xs text-slate-600">
            Validiert OGG/Opus-Magic-Bytes, dekodiert zu 16-kHz-Mono-WAV und löscht Temp-Puffer sofort.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">
            Qualitätskonfiguration (backend/whisper_engine.py)
          </h3>
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 font-medium">Parameter</th>
                <th className="py-2 font-medium">Wert</th>
                <th className="py-2 font-medium">Wirkung</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              <tr>
                <td className="py-2 font-mono">model</td>
                <td className="py-2 font-mono">Systran/faster-whisper-small</td>
                <td className="py-2">Hohe deutsche Erkennungsgenauigkeit</td>
              </tr>
              <tr>
                <td className="py-2 font-mono">beam_size</td>
                <td className="py-2 font-mono tabular-nums">5</td>
                <td className="py-2">Präzise Dekodierung auch bei Fachbegriffen</td>
              </tr>
              <tr>
                <td className="py-2 font-mono">temperature</td>
                <td className="py-2 font-mono tabular-nums">0.0</td>
                <td className="py-2">Deterministische, texttreue Transkription</td>
              </tr>
              <tr>
                <td className="py-2 font-mono">vad_filter</td>
                <td className="py-2 font-mono">true (speech_pad 350 ms)</td>
                <td className="py-2">Schützt Wortanfänge &amp; leise Satzenden</td>
              </tr>
              <tr>
                <td className="py-2 font-mono">task</td>
                <td className="py-2 font-mono">transcribe</td>
                <td className="py-2">Originalsprache beibehalten (keine Übersetzung)</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">
            PowerShell-Lebenszyklus (ohne Administratorrechte)
          </h3>
          <pre className="p-4 rounded-lg bg-slate-900 text-slate-100 text-xs leading-relaxed overflow-x-auto">
{`# 1. Lokale Python-Umgebung & Whisper Small Modell einrichten
powershell -ExecutionPolicy Bypass -File .\\backend\\install.ps1

# 2. Server auf 127.0.0.1:8765 starten
powershell -ExecutionPolicy Bypass -File .\\backend\\start.ps1

# 3. Gesundheit & GPU/CPU-Status prüfen
powershell -ExecutionPolicy Bypass -File .\\backend\\healthcheck.ps1

# 4. Server sauber beenden
powershell -ExecutionPolicy Bypass -File .\\backend\\stop.ps1`}
          </pre>
        </div>
      </div>
    </section>
  );
}
