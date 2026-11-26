import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Copy,
  Check,
  Eye,
  EyeOff,
  RotateCcw,
  Trash2,
  Mic,
  Send,
  Layers,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import {
  WhatsAppInternalMediaAdapter,
  type WARuntimeProvider,
} from '../../extension/src/injected/whatsapp-internal-media-adapter';
import { LocalTranscriptCache, MemoryStorageAdapter } from '../../extension/src/shared/cache';
import { TranscriptionQueue, type AudioFetcher, type WhisperTranscriber } from '../../extension/src/shared/queue';
import {
  WHISPER_MODEL_ID,
  type AdapterDiagnosticReport,
  type TranscriptionJob,
  type VoiceDirection,
} from '../../extension/src/shared/types';

type RuntimeScenario =
  | 'nominal'
  | 'delayed'
  | 'module_drift'
  | 'corrupt_audio'
  | 'gpu_fallback';

interface SimulatedChatVoiceMessage {
  messageId: string;
  direction: VoiceDirection;
  senderLabel: string;
  timestamp: string;
  durationSec: number;
  languageHint: 'de' | 'en' | 'fr';
  sampleTranscript: string;
  seedByte: number;
}

const INITIAL_MESSAGES: SimulatedChatVoiceMessage[] = [
  {
    messageId: 'false_491701112233@c.us_3EB0IN01',
    direction: 'incoming',
    senderLabel: 'Kunde · Einkauf',
    timestamp: '09:14',
    durationSec: 19,
    languageHint: 'de',
    sampleTranscript:
      'Guten Morgen, könnten Sie uns bitte das aktualisierte Angebot für die zwanzig Lizenzen bis heute Nachmittag als PDF schicken?',
    seedByte: 11,
  },
  {
    messageId: 'true_491701112233@c.us_3EB0OUT02',
    direction: 'outgoing',
    senderLabel: 'Sie (WhatsApp Business)',
    timestamp: '09:16',
    durationSec: 12,
    languageHint: 'de',
    sampleTranscript:
      'Sehr gerne, ich stelle die Unterlagen direkt zusammen und sende sie Ihnen spätestens bis fünfzehn Uhr zu.',
    seedByte: 22,
  },
];

function buildOggBuffer(seed: number): ArrayBuffer {
  const bytes = new Uint8Array(96);
  bytes[0] = 0x4f;
  bytes[1] = 0x67;
  bytes[2] = 0x67;
  bytes[3] = 0x53;
  bytes[4] = seed & 0xff;
  for (let i = 5; i < bytes.length; i++) {
    bytes[i] = ((i + seed) * 31) & 0xff;
  }
  return bytes.buffer;
}

export function WhatsAppSimulatorPanel() {
  const [scenario, setScenario] = useState<RuntimeScenario>('nominal');
  const [waDark, setWaDark] = useState(false);
  const [messages, setMessages] = useState<SimulatedChatVoiceMessage[]>(INITIAL_MESSAGES);
  const [jobs, setJobs] = useState<Record<string, TranscriptionJob>>({});
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<AdapterDiagnosticReport | null>(null);
  const [cacheCount, setCacheCount] = useState(0);

  const storageRef = useRef(new MemoryStorageAdapter());
  const cacheRef = useRef(new LocalTranscriptCache(storageRef.current));
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const scenarioRef = useRef(scenario);
  scenarioRef.current = scenario;

  const adapter = useMemo(() => {
    let delayedAttempts = 0;

    const runtime: WARuntimeProvider = {
      getWhatsAppVersion: () => '2.3000.1018500000',
      requireModule: (moduleName: string) => {
        const activeScenario = scenarioRef.current;
        if (activeScenario === 'module_drift') {
          if (moduleName === 'WAWebMsgCollection') return { get: () => undefined };
          if (moduleName === 'WAWebDownloadManager') {
            return { renamedInternalDownload: () => null };
          }
          return null;
        }
        if (activeScenario === 'delayed') {
          delayedAttempts++;
          if (delayedAttempts <= 4) {
            return null;
          }
        }
        if (moduleName === 'WAWebMsgCollection') {
          return {
            MsgCollection: {
              get: (id: string) => {
                const found = messagesRef.current.find((m) => m.messageId === id);
                if (!found) return undefined;
                return {
                  id: found.messageId,
                  type: 'ptt',
                  mimetype: 'audio/ogg; codecs=opus',
                  duration: found.durationSec,
                  isFromMe: found.direction === 'outgoing',
                  directPath: `/v/t62.7117-24/${found.seedByte}.enc`,
                  encFilehash: `enc_${found.seedByte}`,
                  filehash: `file_${found.seedByte}`,
                  mediaKey: `EPHEMERAL_KEY_${found.seedByte}_NEVER_EXPOSED`,
                  mediaKeyTimestamp: 1732500000,
                };
              },
            },
          };
        }
        if (moduleName === 'WAWebDownloadManager') {
          return {
            downloadManager: {
              downloadAndMaybeDecrypt: async (params: Record<string, unknown>) => {
                if (scenarioRef.current === 'corrupt_audio') {
                  return new ArrayBuffer(0);
                }
                const pathStr = String(params.directPath ?? '');
                const match = /\/(\d+)\.enc/.exec(pathStr);
                const seed = match ? Number.parseInt(match[1], 10) : 1;
                return buildOggBuffer(seed);
              },
            },
          };
        }
        return null;
      },
    };

    return new WhatsAppInternalMediaAdapter({
      maxRetries: 4,
      retryDelayMs: 60,
      runtimeProvider: runtime,
    });
  }, []);

  const queue = useMemo(() => {
    const fetcher: AudioFetcher = {
      fetchVoiceAudio: (messageId) => adapter.fetchAndDecryptVoiceMessage(messageId),
    };

    const transcriber: WhisperTranscriber = {
      transcribe: async ({ messageId }) => {
        await new Promise((r) => setTimeout(r, 260));
        const found = messagesRef.current.find((m) => m.messageId === messageId);
        const device = scenarioRef.current === 'gpu_fallback' ? 'cpu/int8' : 'cuda/float16';
        return {
          transcript:
            found?.sampleTranscript ??
            'Testnachricht erfolgreich über lokales Whisper-Small-Modell transkribiert.',
          language: found?.languageHint ?? 'de',
          inferenceDevice: device,
          modelVersion: WHISPER_MODEL_ID,
        };
      },
    };

    return new TranscriptionQueue({
      cache: cacheRef.current,
      fetcher,
      transcriber,
      concurrency: 1,
    });
  }, [adapter]);

  useEffect(() => {
    const unsub = queue.subscribe((job) => {
      setJobs((prev) => ({ ...prev, [job.messageId]: job }));
      void cacheRef.current.count().then(setCacheCount);
      setDiagnostics(adapter.getDiagnostics());
    });
    return unsub;
  }, [queue, adapter]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const report = await adapter.reinitialize();
      if (!active) return;
      setDiagnostics(report);
      const forceUncachedTest =
        scenario === 'module_drift' ||
        scenario === 'corrupt_audio' ||
        scenario === 'gpu_fallback';
      if (forceUncachedTest) {
        await cacheRef.current.clearAll();
        setCacheCount(0);
      }
      for (const m of messagesRef.current) {
        await queue.enqueue(m.messageId, m.direction, forceUncachedTest);
      }
    })();
    return () => {
      active = false;
    };
  }, [scenario, adapter, queue]);

  const handleAddVoiceMessage = (
    direction: VoiceDirection,
    languageHint: 'de' | 'en' | 'fr',
    text: string,
    durationSec: number
  ) => {
    const nextSeed = messages.length * 7 + 33;
    const prefix = direction === 'outgoing' ? 'true' : 'false';
    const messageId = `${prefix}_491709998877@c.us_3EB0SIM${Date.now()}_${nextSeed}`;
    const newMsg: SimulatedChatVoiceMessage = {
      messageId,
      direction,
      senderLabel: direction === 'outgoing' ? 'Sie (WhatsApp Business)' : 'Kunde · Support',
      timestamp: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
      durationSec,
      languageHint,
      sampleTranscript: text,
      seedByte: nextSeed,
    };

    setMessages((prev) => [...prev, newMsg]);
    messagesRef.current = [...messagesRef.current, newMsg];
    void queue.enqueue(newMsg.messageId, newMsg.direction, false);
  };

  const handleQueueBatch = () => {
    const batch: Array<{
      dir: VoiceDirection;
      lang: 'de' | 'en' | 'fr';
      text: string;
      dur: number;
    }> = [
      {
        dir: 'incoming',
        lang: 'de',
        dur: 24,
        text: 'Hallo, wir bräuchten für den Standort München drei zusätzliche Arbeitsplätze ab nächstem Montag.',
      },
      {
        dir: 'incoming',
        lang: 'en',
        dur: 16,
        text: 'Hi team, please confirm whether the invoice reference 2026-441 has been approved.',
      },
      {
        dir: 'outgoing',
        lang: 'de',
        dur: 14,
        text: 'Alles klar, ich habe die Freigabe gerade geprüft und leite Ihnen die Bestätigung weiter.',
      },
    ];

    batch.forEach((item, idx) => {
      const nextSeed = 80 + messagesRef.current.length + idx;
      const prefix = item.dir === 'outgoing' ? 'true' : 'false';
      const msg: SimulatedChatVoiceMessage = {
        messageId: `${prefix}_491709998877@c.us_BATCH_${Date.now()}_${idx}`,
        direction: item.dir,
        senderLabel: item.dir === 'outgoing' ? 'Sie (WhatsApp Business)' : 'Kunde · Projekt',
        timestamp: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
        durationSec: item.dur,
        languageHint: item.lang,
        sampleTranscript: item.text,
        seedByte: nextSeed,
      };
      messagesRef.current = [...messagesRef.current, msg];
      setMessages((prev) => [...prev, msg]);
      void queue.enqueue(msg.messageId, msg.direction, false);
    });
  };

  const handleRetry = (messageId: string, direction: VoiceDirection) => {
    void queue.enqueue(messageId, direction, true);
  };

  const handleClearCache = async () => {
    await cacheRef.current.clearAll();
    queue.clearTrackedJobs();
    setJobs({});
    setCacheCount(0);
    for (const m of messagesRef.current) {
      void queue.enqueue(m.messageId, m.direction, false);
    }
  };

  const handleCopy = (messageId: string, text: string) => {
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(text);
    }
    setCopiedId(messageId);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <section className="space-y-6">
      {/* Control Strip */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-slate-900">
            WhatsAppInternalMediaAdapter &amp; Inline-Transkription (Sandbox)
          </h2>
          <p className="text-sm text-slate-600">
            Führt den echten TypeScript-Adapter, die sequenzielle Warteschlange und den SHA-256-Cache direkt im Browser aus.
          </p>
        </div>

        <div className="flex flex-wrap xl:flex-nowrap items-center gap-2.5 shrink-0">
          <label htmlFor="runtime-scenario" className="text-xs font-medium text-slate-600 whitespace-nowrap">
            Laufzeitszenario:
          </label>
          <select
            id="runtime-scenario"
            value={scenario}
            onChange={(e) => {
              queue.clearTrackedJobs();
              setJobs({});
              setScenario(e.target.value as RuntimeScenario);
            }}
            className="w-full sm:w-auto max-w-full px-3 py-2 text-xs font-medium bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
          >
            <option value="nominal">Nominal (WAWebMsgCollection + DownloadManager)</option>
            <option value="delayed">Verzögertes Modulladen (Retry-Test)</option>
            <option value="module_drift">Geänderte Modulsignatur (Drift-Test)</option>
            <option value="corrupt_audio">Fehlerhafte Audioquelle (Leerer Puffer)</option>
            <option value="gpu_fallback">GPU-Ausfall → CPU/INT8-Fallback</option>
          </select>

          <button
            type="button"
            onClick={() => setWaDark((v) => !v)}
            className="px-3 py-2 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            WhatsApp-Design: {waDark ? 'Dunkel' : 'Hell'}
          </button>
        </div>
      </div>

      {/* Main 2-column Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Authentic WhatsApp Business Chat Preview */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                WhatsApp Business Web Chat-Vorschau
              </h3>
              <p className="text-xs text-slate-500">
                Automatische Erfassung ohne Play-Klick · Eingangs- &amp; Ausgangsnachrichten
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  handleAddVoiceMessage(
                    'incoming',
                    'de',
                    'Können Sie die Rechnung bitte noch auf unsere neue USt-IdNr. umschreiben?',
                    15
                  )
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Mic className="w-3.5 h-3.5" />
                Eingehend (DE)
              </button>
              <button
                type="button"
                onClick={() =>
                  handleAddVoiceMessage(
                    'outgoing',
                    'de',
                    'Verstanden, ich passe die Rechnungsadresse an und schicke das Dokument gleich raus.',
                    11
                  )
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                Ausgehend (DE)
              </button>
              <button
                type="button"
                onClick={handleQueueBatch}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Layers className="w-3.5 h-3.5" />
                3 Audios einreihen
              </button>
            </div>
          </div>

          <div
            data-testid="whatsapp-chat-surface"
            className={`p-5 space-y-4 transition-colors min-h-[420px] ${
              waDark ? 'bg-[#0b141a] text-[#e9edef]' : 'bg-[#efeae2] text-[#111b21]'
            }`}
          >
            {messages.map((msg) => {
              const job = jobs[msg.messageId];
              const isOutgoing = msg.direction === 'outgoing';
              const isCollapsed = Boolean(collapsedMap[msg.messageId]);

              const bubbleClass = isOutgoing
                ? waDark
                  ? 'bg-[#005c4b] text-[#e9edef] ml-auto'
                  : 'bg-[#d9fdd3] text-[#111b21] ml-auto'
                : waDark
                  ? 'bg-[#202c33] text-[#e9edef] mr-auto'
                  : 'bg-white text-[#111b21] mr-auto';

              return (
                <article
                  key={msg.messageId}
                  data-id={msg.messageId}
                  className={`max-w-[88%] rounded-xl px-3.5 py-2.5 shadow-xs ${bubbleClass}`}
                >
                  <div className="flex items-center justify-between gap-4 text-[11px] opacity-75 mb-1.5">
                    <span className="font-medium">{msg.senderLabel}</span>
                    <span className="tabular-nums">{msg.timestamp}</span>
                  </div>

                  {/* Simulated native WhatsApp PTT Audio Player (never clicked!) */}
                  <div className="flex items-center gap-3 py-1">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                        waDark ? 'bg-white/10' : 'bg-slate-900/10'
                      }`}
                      aria-hidden="true"
                    >
                      <Mic className="w-4 h-4" />
                    </div>
                    <div className="flex-1 flex items-center gap-1 h-5" aria-hidden="true">
                      {[35, 65, 90, 50, 75, 100, 60, 40, 80, 55, 70, 45, 65, 85, 50, 35].map(
                        (h, i) => (
                          <span
                            key={i}
                            className={`w-1 rounded-full ${
                              waDark ? 'bg-slate-300/60' : 'bg-slate-600/50'
                            }`}
                            style={{ height: `${h}%` }}
                          />
                        )
                      )}
                    </div>
                    <span className="text-xs font-mono tabular-nums opacity-80">
                      0:{String(msg.durationSec).padStart(2, '0')}
                    </span>
                  </div>

                  {/* Inline Transcript Container directly below message */}
                  <div
                    className={`mt-2.5 rounded-lg p-2.5 border text-[13px] leading-relaxed ${
                      waDark
                        ? 'bg-[#111b21]/70 border-white/10 text-[#e9edef]'
                        : 'bg-white/75 border-slate-900/10 text-[#111b21]'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <strong className={waDark ? 'text-[#00a884] text-xs' : 'text-[#008069] text-xs'}>
                          Transkript
                        </strong>
                        <span className={waDark ? 'text-[#8696a0] text-[11px]' : 'text-[#667781] text-[11px]'}>
                          {!job
                            ? 'Initialisiere...'
                            : job.status === 'cached'
                              ? `Aus lokalem Cache · ${(job.language ?? '').toUpperCase()} · ${job.inferenceDevice ?? 'cuda/float16'}`
                              : job.status === 'completed'
                                ? `Lokal (Whisper Small) · ${(job.language ?? '').toUpperCase()} · ${job.inferenceDevice ?? 'cuda/float16'}`
                                : job.status === 'error'
                                  ? 'Fehler'
                                  : job.status === 'fetching_media'
                                    ? 'Medienabruf...'
                                    : job.status === 'transcribing'
                                      ? 'Transkribiere lokal...'
                                      : 'Warteschlange'}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {job && (job.status === 'completed' || job.status === 'cached') && job.transcript && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleCopy(msg.messageId, job.transcript ?? '')}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border ${
                                waDark
                                  ? 'border-[#00a884]/40 text-[#00a884] hover:bg-[#00a884]/10'
                                  : 'border-[#008069]/30 text-[#008069] hover:bg-[#008069]/10'
                              }`}
                            >
                              {copiedId === msg.messageId ? (
                                <Check className="w-3 h-3" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                              {copiedId === msg.messageId ? 'Kopiert' : 'Kopieren'}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setCollapsedMap((prev) => ({
                                  ...prev,
                                  [msg.messageId]: !prev[msg.messageId],
                                }))
                              }
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border ${
                                waDark
                                  ? 'border-[#00a884]/40 text-[#00a884] hover:bg-[#00a884]/10'
                                  : 'border-[#008069]/30 text-[#008069] hover:bg-[#008069]/10'
                              }`}
                            >
                              {isCollapsed ? (
                                <Eye className="w-3 h-3" />
                              ) : (
                                <EyeOff className="w-3 h-3" />
                              )}
                              {isCollapsed ? 'Einblenden' : 'Ausblenden'}
                            </button>
                          </>
                        )}

                        {job?.status === 'error' && (
                          <button
                            type="button"
                            onClick={() => handleRetry(msg.messageId, msg.direction)}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border ${
                              waDark
                                ? 'border-red-400/50 text-red-200 hover:bg-red-900/30'
                                : 'border-red-600/40 text-red-700 hover:bg-red-50'
                            }`}
                          >
                            <RotateCcw className="w-3 h-3" />
                            Erneut versuchen
                          </button>
                        )}
                      </div>
                    </div>

                    {!isCollapsed && (
                      <div className="mt-1.5">
                        {job?.status === 'completed' || job?.status === 'cached' ? (
                          <p className="m-0">{job.transcript}</p>
                        ) : job?.status === 'error' ? (
                          <p className={`m-0 text-xs ${waDark ? 'text-red-200' : 'text-red-700'}`}>
                            {job.errorMessage}
                          </p>
                        ) : (
                          <p className="m-0 text-xs opacity-75">
                            {job?.status === 'fetching_media'
                              ? 'Rufe OGG/Opus über WAWebDownloadManager ab (kein Play-Klick)...'
                              : job?.status === 'transcribing'
                                ? 'Whisper Small (Beam 5, Temp 0, VAD) verarbeitet lokal...'
                                : 'In sequenzieller Warteschlange...'}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        {/* Right: Sanitized Adapter Diagnostics & Cache Inspector */}
        <div className="lg:col-span-5 space-y-5">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Adapter-Status &amp; Modulprüfung
              </h3>
              <button
                type="button"
                onClick={handleClearCache}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-red-700 bg-white border border-red-200 hover:bg-red-50 rounded-lg transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Cache leeren ({cacheCount})
              </button>
            </div>

            {diagnostics?.status === 'READY' ? (
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs">
                <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-emerald-700" />
                <div>
                  <strong className="font-semibold">Interne Medienmodule bereit</strong>
                  <p className="mt-0.5 text-emerald-800">
                    WAWebMsgCollection &amp; WAWebDownloadManager verifiziert ({diagnostics.initAttempts} Versuch(e)).
                    Medienschlüssel bleiben flüchtig.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
                <div>
                  <strong className="font-semibold">
                    {diagnostics?.lastErrorCode ?? 'Adapter-Prüfung'}
                  </strong>
                  <p className="mt-0.5 text-amber-800">
                    {diagnostics?.lastErrorMessage ?? 'Prüfe interne WhatsApp-Module...'}
                  </p>
                </div>
              </div>
            )}

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs border-t border-slate-100 pt-3">
              <div>
                <dt className="text-slate-500">WhatsApp Web Build</dt>
                <dd className="font-mono font-medium text-slate-900 tabular-nums">
                  {diagnostics?.whatsappVersion ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Adapter-Status</dt>
                <dd className="font-mono font-medium text-slate-900">
                  {diagnostics?.status ?? 'UNINITIALIZED'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">WAWebMsgCollection</dt>
                <dd className="font-medium text-slate-900">
                  {diagnostics?.msgGetSignatureOk ? 'Signatur OK' : 'Fehlt / Drift'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">WAWebDownloadManager</dt>
                <dd className="font-medium text-slate-900">
                  {diagnostics?.downloadSignatureOk ? 'Signatur OK' : 'Fehlt / Drift'}
                </dd>
              </div>
            </dl>

            <div className="space-y-1.5">
              <div className="text-xs font-medium text-slate-700">
                Bereinigtes Diagnoseprotokoll (ohne mediaKey / JIDs)
              </div>
              <pre className="p-3 rounded-lg bg-slate-900 text-slate-100 text-[11px] leading-relaxed whitespace-pre-wrap break-words max-h-60 overflow-y-auto">
                {JSON.stringify(diagnostics, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
