import { ChromeStorageAdapter, LocalTranscriptCache } from '../shared/cache';
import {
  DEFAULT_EXTENSION_SETTINGS,
  WHISPER_MODEL_ID,
  type AdapterDiagnosticReport,
  type BackendHealthStatus,
  type ExtensionSettings,
  type GitHubReleaseCheckResult,
} from '../shared/types';
import { checkGitHubReleaseUpdate } from '../shared/update-checker';

const SETTINGS_KEY = 'wa_local_ai_settings_v1';
const DIAGNOSTICS_KEY = 'wa_local_ai_last_diagnostics_v1';
const UPDATE_CHECK_KEY = 'wa_local_ai_last_update_check_v1';

const cache = new LocalTranscriptCache(new ChromeStorageAdapter());

export function assertStrictLoopbackServerUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Ungültige lokale Server-URL.');
  }
  if (parsed.protocol !== 'http:') {
    throw new Error('Lokaler Whisper-Server muss über http://127.0.0.1 angesprochen werden.');
  }
  if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
    throw new Error(
      `Sicherheitsblockade: Externe Server (${parsed.hostname}) sind strikt verboten. Nur 127.0.0.1 zulässig.`
    );
  }
  return parsed.origin;
}

async function loadSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const raw = stored[SETTINGS_KEY] as Partial<ExtensionSettings> | undefined;
  return {
    ...DEFAULT_EXTENSION_SETTINGS,
    ...(raw ?? {}),
  };
}

async function saveSettings(next: ExtensionSettings): Promise<ExtensionSettings> {
  const safeOrigin = assertStrictLoopbackServerUrl(next.serverUrl);
  const sanitized: ExtensionSettings = {
    ...DEFAULT_EXTENSION_SETTINGS,
    ...next,
    serverUrl: safeOrigin,
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: sanitized });
  return sanitized;
}

async function fetchBackendHealth(settings: ExtensionSettings): Promise<BackendHealthStatus> {
  try {
    const baseUrl = assertStrictLoopbackServerUrl(settings.serverUrl);
    const headers: Record<string, string> = {};
    if (settings.authToken) {
      headers['X-Transcriber-Token'] = settings.authToken;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.status === 401 || res.status === 403) {
      return {
        reachable: true,
        status: 'unauthorized',
        model: WHISPER_MODEL_ID,
        device: 'unknown',
        computeType: 'unknown',
        cudaAvailable: false,
        gpuName: null,
        version: null,
        error: 'Client-Authentifizierung fehlgeschlagen (Token prüfen).',
      };
    }

    if (!res.ok) {
      return {
        reachable: true,
        status: 'degraded',
        model: WHISPER_MODEL_ID,
        device: 'unknown',
        computeType: 'unknown',
        cudaAvailable: false,
        gpuName: null,
        version: null,
        error: `HTTP ${res.status}`,
      };
    }

    const data = (await res.json()) as {
      status?: string;
      model?: string;
      device?: string;
      compute_type?: string;
      cuda_available?: boolean;
      gpu_name?: string | null;
      version?: string | null;
    };

    return {
      reachable: true,
      status: data.status === 'ok' ? 'ok' : 'degraded',
      model: data.model ?? WHISPER_MODEL_ID,
      device: data.device ?? 'cpu',
      computeType: data.compute_type ?? 'int8',
      cudaAvailable: Boolean(data.cuda_available),
      gpuName: data.gpu_name ?? null,
      version: data.version ?? null,
      error: null,
    };
  } catch (err) {
    return {
      reachable: false,
      status: 'offline',
      model: WHISPER_MODEL_ID,
      device: 'offline',
      computeType: 'offline',
      cudaAvailable: false,
      gpuName: null,
      version: null,
      error:
        err instanceof Error
          ? `Lokaler Whisper-Server (127.0.0.1:8765) nicht erreichbar: ${err.message}`
          : 'Lokaler Whisper-Server offline.',
    };
  }
}

async function transcribeWithLocalWhisper(payload: {
  messageId: string;
  audioHash: string;
  mimetype: string;
  audioBase64: string;
}): Promise<{
  ok: boolean;
  transcript?: string;
  language?: string;
  inferenceDevice?: string;
  modelVersion?: string;
  error?: string;
}> {
  const settings = await loadSettings();
  const baseUrl = assertStrictLoopbackServerUrl(settings.serverUrl);

  if (!settings.authToken.trim()) {
    return {
      ok: false,
      error:
        'Lokales Server-Token fehlt. Bitte Token aus dem Windows-Setup in den Erweiterungs-Optionen hinterlegen.',
    };
  }

  // Decode base64 back into binary Blob for multipart upload to 127.0.0.1:8765
  const rawBinary = atob(payload.audioBase64);
  const bytes = new Uint8Array(rawBinary.length);
  for (let i = 0; i < rawBinary.length; i++) {
    bytes[i] = rawBinary.charCodeAt(i);
  }

  const formData = new FormData();
  const blob = new Blob([bytes], { type: payload.mimetype || 'audio/ogg' });
  formData.append('audio', blob, 'voice_message.ogg');
  formData.append('audio_sha256', payload.audioHash);
  formData.append('language', settings.language);

  const response = await fetch(`${baseUrl}/transcribe`, {
    method: 'POST',
    headers: {
      'X-Transcriber-Token': settings.authToken.trim(),
    },
    body: formData,
  });

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      error: 'Zugriff vom lokalen Whisper-Server verweigert (Token oder Origin ungültig).',
    };
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    return {
      ok: false,
      error: `Whisper-Server Fehler (${response.status}): ${errText || 'Unbekannt'}`,
    };
  }

  const result = (await response.json()) as {
    transcript: string;
    language: string;
    device: string;
    compute_type: string;
    model: string;
  };

  return {
    ok: true,
    transcript: result.transcript,
    language: result.language,
    inferenceDevice: `${result.device}/${result.compute_type}`,
    modelVersion: result.model || WHISPER_MODEL_ID,
  };
}

chrome.runtime.onInstalled.addListener(() => {
  void loadSettings().then((settings) => saveSettings(settings));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const msg = message as { type?: string; [key: string]: unknown };

  if (msg.type === 'GET_SETTINGS') {
    void loadSettings().then((settings) => sendResponse({ settings }));
    return true;
  }

  if (msg.type === 'SAVE_SETTINGS') {
    void saveSettings(msg.settings as ExtensionSettings)
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((err: Error) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === 'TRANSCRIBE_AUDIO') {
    void transcribeWithLocalWhisper(
      msg.payload as {
        messageId: string;
        audioHash: string;
        mimetype: string;
        audioBase64: string;
      }
    )
      .then((res) => sendResponse(res))
      .catch((err: Error) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === 'CHECK_HEALTH') {
    void loadSettings()
      .then((settings) => fetchBackendHealth(settings))
      .then((health) => sendResponse({ health }));
    return true;
  }

  if (msg.type === 'UPDATE_ADAPTER_DIAGNOSTICS') {
    const report = msg.report as AdapterDiagnosticReport;
    void chrome.storage.local.set({ [DIAGNOSTICS_KEY]: report });
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'GET_STATUS_SUMMARY') {
    void (async () => {
      const settings = await loadSettings();
      const [health, cacheCount, storedState] = await Promise.all([
        fetchBackendHealth(settings),
        cache.count(),
        chrome.storage.local.get([DIAGNOSTICS_KEY, UPDATE_CHECK_KEY]),
      ]);

      let updateResult = storedState[UPDATE_CHECK_KEY] as GitHubReleaseCheckResult | undefined;
      if (settings.enableGitHubUpdateCheck && !updateResult) {
        const manifestVersion = chrome.runtime.getManifest().version;
        updateResult = await checkGitHubReleaseUpdate({
          currentVersion: manifestVersion,
          githubRepo: settings.githubRepo,
        });
        await chrome.storage.local.set({ [UPDATE_CHECK_KEY]: updateResult });
      }

      sendResponse({
        settings,
        health,
        cacheCount,
        diagnostics: (storedState[DIAGNOSTICS_KEY] as AdapterDiagnosticReport | undefined) ?? null,
        updateCheck: updateResult ?? null,
      });
    })();
    return true;
  }

  if (msg.type === 'CHECK_GITHUB_UPDATE') {
    void (async () => {
      const settings = await loadSettings();
      const manifestVersion = chrome.runtime.getManifest().version;
      const updateResult = await checkGitHubReleaseUpdate({
        currentVersion: manifestVersion,
        githubRepo: settings.githubRepo,
      });
      await chrome.storage.local.set({ [UPDATE_CHECK_KEY]: updateResult });
      sendResponse({ updateCheck: updateResult });
    })();
    return true;
  }

  if (msg.type === 'CLEAR_CACHE') {
    void cache.clearAll().then(() => sendResponse({ ok: true }));
    return true;
  }

  return false;
});
