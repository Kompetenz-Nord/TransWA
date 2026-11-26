import {
  BRIDGE_CHANNEL,
  isTrustedWhatsAppOrigin,
  validateMainToContentMessage,
  type ContentToMainPayload,
} from '../shared/bridge-protocol';
import { ChromeStorageAdapter, LocalTranscriptCache } from '../shared/cache';
import { TranscriptionQueue, type AudioFetcher, type WhisperTranscriber } from '../shared/queue';
import type {
  AdapterDiagnosticReport,
  DecryptedAudioResult,
  ExtensionSettings,
  TranscriptionJob,
} from '../shared/types';
import { DEFAULT_EXTENSION_SETTINGS } from '../shared/types';
import { findVoiceMessagesInRoot, renderTranscriptIntoMessageElement } from './dom-observer';

const pendingBridgeRequests = new Map<
  string,
  {
    resolve: (val: unknown) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

const messageElementRegistry = new Map<string, Element>();
let latestAdapterDiagnostics: AdapterDiagnosticReport | null = null;
let currentSettings: ExtensionSettings = { ...DEFAULT_EXTENSION_SETTINGS };

function createRequestId(): string {
  const rand = globalThis.crypto.getRandomValues(new Uint8Array(12));
  return Array.from(rand, (b) => b.toString(16).padStart(2, '0')).join('');
}

function sendBridgeRequest<T>(
  payloadBuilder: (requestId: string) => ContentToMainPayload,
  timeoutMs = 25000
): Promise<T> {
  if (!isTrustedWhatsAppOrigin(window.location.origin)) {
    return Promise.reject(new Error('Nicht vertrauenswürdiger Ursprung für WhatsApp-Brücke.'));
  }

  const requestId = createRequestId();
  const payload = payloadBuilder(requestId);

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingBridgeRequests.delete(requestId);
      reject(new Error('Zeitüberschreitung bei Kommunikation mit dem WhatsApp-Medienmodul.'));
    }, timeoutMs);

    pendingBridgeRequests.set(requestId, {
      resolve: resolve as (val: unknown) => void,
      reject,
      timer,
    });

    window.postMessage(payload, window.location.origin);
  });
}

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return;
  if (!isTrustedWhatsAppOrigin(event.origin)) return;

  const validated = validateMainToContentMessage(event.data);
  if (!validated) return;

  if (validated.type === 'ADAPTER_STATUS_EVENT') {
    latestAdapterDiagnostics = validated.report;
    void chrome.runtime.sendMessage({
      type: 'UPDATE_ADAPTER_DIAGNOSTICS',
      report: validated.report,
    });
    return;
  }

  const pending = pendingBridgeRequests.get(validated.requestId);
  if (!pending) return;

  clearTimeout(pending.timer);
  pendingBridgeRequests.delete(validated.requestId);

  if (validated.type === 'ADAPTER_DIAGNOSTICS_RESULT') {
    latestAdapterDiagnostics = validated.report;
    pending.resolve(validated.report);
    return;
  }

  if (validated.type === 'VOICE_AUDIO_RESULT') {
    if (validated.ok) {
      const result: DecryptedAudioResult = {
        messageId: validated.messageId,
        direction: validated.voiceDirection,
        mimetype: validated.mimetype,
        durationSec: validated.durationSec,
        byteLength: validated.buffer.byteLength,
        buffer: validated.buffer,
        metadata: validated.metadata,
      };
      pending.resolve(result);
    } else {
      pending.reject(new Error(`[${validated.errorCode}] ${validated.errorMessage}`));
    }
  }
});

const bridgeAudioFetcher: AudioFetcher = {
  fetchVoiceAudio(messageId: string): Promise<DecryptedAudioResult> {
    return sendBridgeRequest<DecryptedAudioResult>((requestId) => ({
      channel: BRIDGE_CHANNEL,
      direction: 'content-to-main',
      requestId,
      type: 'FETCH_VOICE_AUDIO',
      messageId,
    }));
  },
};

const serviceWorkerTranscriber: WhisperTranscriber = {
  async transcribe(params) {
    // Convert ArrayBuffer to base64 chunked for safe Chrome runtime messaging
    const bytes = new Uint8Array(params.audioBuffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    const base64Audio = btoa(binary);

    const response = (await chrome.runtime.sendMessage({
      type: 'TRANSCRIBE_AUDIO',
      payload: {
        messageId: params.messageId,
        audioHash: params.audioHash,
        mimetype: params.mimetype,
        audioBase64: base64Audio,
      },
    })) as
      | {
          ok: true;
          transcript: string;
          language: string;
          inferenceDevice?: string;
          modelVersion?: string;
        }
      | { ok: false; error: string };

    if (!response || !response.ok) {
      throw new Error(response?.error ?? 'Lokaler Whisper-Server nicht erreichbar.');
    }

    return {
      transcript: response.transcript,
      language: response.language,
      inferenceDevice: response.inferenceDevice,
      modelVersion: response.modelVersion,
    };
  },
};

const cache = new LocalTranscriptCache(new ChromeStorageAdapter());
const queue = new TranscriptionQueue({
  cache,
  fetcher: bridgeAudioFetcher,
  transcriber: serviceWorkerTranscriber,
  concurrency: 1,
});

function syncJobToDOM(job: TranscriptionJob): void {
  const el = messageElementRegistry.get(job.messageId);
  if (!el || !el.isConnected) return;

  renderTranscriptIntoMessageElement(document, el, job, {
    onRetry: (id) => {
      void queue.enqueue(id, job.direction, true);
    },
  });
}

queue.subscribe(syncJobToDOM);

async function scanRootForVoiceMessages(root: ParentNode): Promise<void> {
  const detected = findVoiceMessagesInRoot(root);
  for (const item of detected) {
    messageElementRegistry.set(item.messageId, item.element);
    const existingJob = queue.getJob(item.messageId);
    if (existingJob) {
      syncJobToDOM(existingJob);
      continue;
    }

    if (currentSettings.autoTranscribe) {
      await queue.enqueue(item.messageId, item.direction, false);
    } else {
      const cached = await cache.getByMessageId(item.messageId);
      if (cached) {
        await queue.enqueue(item.messageId, item.direction, false);
      }
    }
  }
}

let scanTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleScan(): void {
  if (scanTimer) return;
  scanTimer = setTimeout(() => {
    scanTimer = null;
    const mainEl = document.querySelector('#main') ?? document.body;
    if (mainEl) {
      void scanRootForVoiceMessages(mainEl);
    }
  }, 180);
}

async function bootstrapContentScript(): Promise<void> {
  try {
    const res = (await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' })) as {
      settings?: ExtensionSettings;
    };
    if (res?.settings) {
      currentSettings = res.settings;
    }
  } catch {
    // Keep defaults if service worker is waking up
  }

  const observer = new MutationObserver((mutations) => {
    let shouldScan = false;
    for (const m of mutations) {
      if (m.addedNodes.length > 0) {
        shouldScan = true;
        break;
      }
    }
    if (shouldScan) {
      scheduleScan();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  scheduleScan();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const msg = message as { type?: string };
  if (msg?.type === 'PING_CONTENT_DIAGNOSTICS') {
    void sendBridgeRequest<AdapterDiagnosticReport>((requestId) => ({
      channel: BRIDGE_CHANNEL,
      direction: 'content-to-main',
      requestId,
      type: 'GET_ADAPTER_DIAGNOSTICS',
    }))
      .then((report) => {
        sendResponse({ ok: true, report, queue: queue.getStats() });
      })
      .catch((err: Error) => {
        sendResponse({
          ok: false,
          report: latestAdapterDiagnostics,
          error: err.message,
          queue: queue.getStats(),
        });
      });
    return true;
  }

  if (msg?.type === 'CACHE_CLEARED') {
    queue.clearTrackedJobs();
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void bootstrapContentScript());
} else {
  void bootstrapContentScript();
}
