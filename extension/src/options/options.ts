import type {
  AdapterDiagnosticReport,
  BackendHealthStatus,
  ExtensionSettings,
  GitHubReleaseCheckResult,
} from '../shared/types';

const form = document.getElementById('settings-form') as HTMLFormElement;
const serverUrlInput = document.getElementById('server-url') as HTMLInputElement;
const authTokenInput = document.getElementById('auth-token') as HTMLInputElement;
const languageSelect = document.getElementById('language') as HTMLSelectElement;
const autoTranscribeCheckbox = document.getElementById('auto-transcribe') as HTMLInputElement;
const updateCheckCheckbox = document.getElementById('update-check') as HTMLInputElement;
const saveFeedback = document.getElementById('save-feedback') as HTMLElement;
const cacheFeedback = document.getElementById('cache-feedback') as HTMLElement;
const updateFeedback = document.getElementById('update-feedback') as HTMLElement;
const diagPre = document.getElementById('diagnostics-output') as HTMLElement;

async function loadState(): Promise<void> {
  const summary = (await chrome.runtime.sendMessage({ type: 'GET_STATUS_SUMMARY' })) as {
    settings: ExtensionSettings;
    health: BackendHealthStatus;
    cacheCount: number;
    diagnostics: AdapterDiagnosticReport | null;
  };

  serverUrlInput.value = summary.settings.serverUrl;
  authTokenInput.value = summary.settings.authToken;
  languageSelect.value = summary.settings.language;
  autoTranscribeCheckbox.checked = summary.settings.autoTranscribe;
  updateCheckCheckbox.checked = summary.settings.enableGitHubUpdateCheck;

  diagPre.textContent = JSON.stringify(
    {
      backendHealth: summary.health,
      cachedTranscripts: summary.cacheCount,
      adapterDiagnostics: summary.diagnostics ?? {
        status: 'NO_WHATSAPP_TAB_REPORTED_YET',
        note: 'Bitte WhatsApp Web öffnen, damit das interne Medienmodul geprüft wird.',
      },
    },
    null,
    2
  );
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  saveFeedback.textContent = 'Speichere...';

  const currentRes = (await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' })) as {
    settings: ExtensionSettings;
  };

  const nextSettings: ExtensionSettings = {
    ...currentRes.settings,
    serverUrl: serverUrlInput.value.trim(),
    authToken: authTokenInput.value.trim(),
    language: languageSelect.value as ExtensionSettings['language'],
    autoTranscribe: autoTranscribeCheckbox.checked,
    enableGitHubUpdateCheck: updateCheckCheckbox.checked,
  };

  const result = (await chrome.runtime.sendMessage({
    type: 'SAVE_SETTINGS',
    settings: nextSettings,
  })) as { ok: boolean; error?: string };

  saveFeedback.textContent = result.ok
    ? 'Einstellungen lokal gespeichert.'
    : `Fehler: ${result.error ?? 'Ungültige Eingabe'}`;
});

document.getElementById('check-health-btn')?.addEventListener('click', async () => {
  saveFeedback.textContent = 'Prüfe 127.0.0.1:8765...';
  const res = (await chrome.runtime.sendMessage({ type: 'CHECK_HEALTH' })) as {
    health: BackendHealthStatus;
  };
  saveFeedback.textContent =
    res.health.status === 'ok'
      ? `Verbunden: ${res.health.model} (${res.health.device}/${res.health.computeType})`
      : `Status: ${res.health.error ?? res.health.status}`;
  await loadState();
});

document.getElementById('clear-cache-btn')?.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' });
  cacheFeedback.textContent = 'Alle lokalen Transkripte wurden vollständig gelöscht.';
  await loadState();
});

document.getElementById('refresh-diag-btn')?.addEventListener('click', () => {
  void loadState();
});

document.getElementById('check-update-btn')?.addEventListener('click', async () => {
  updateFeedback.textContent = 'Prüfe GitHub Releases...';
  const res = (await chrome.runtime.sendMessage({ type: 'CHECK_GITHUB_UPDATE' })) as {
    updateCheck: GitHubReleaseCheckResult;
  };
  if (res.updateCheck.error) {
    updateFeedback.textContent = `Hinweis: ${res.updateCheck.error}`;
  } else if (res.updateCheck.updateAvailable) {
    updateFeedback.textContent = `Neue Version v${res.updateCheck.latestVersion} auf GitHub verfügbar!`;
  } else {
    updateFeedback.textContent = `Aktuell (v${res.updateCheck.currentVersion}).`;
  }
});

void loadState();
