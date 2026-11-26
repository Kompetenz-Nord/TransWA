import type {
  AdapterDiagnosticReport,
  BackendHealthStatus,
  GitHubReleaseCheckResult,
} from '../shared/types';

interface StatusSummaryResponse {
  health: BackendHealthStatus;
  cacheCount: number;
  diagnostics: AdapterDiagnosticReport | null;
  updateCheck: GitHubReleaseCheckResult | null;
}

function setStatusClass(el: HTMLElement, state: 'ok' | 'warn' | 'err'): void {
  el.classList.remove('ok', 'warn', 'err');
  el.classList.add(state);
}

async function refreshPopup(): Promise<void> {
  const manifest = chrome.runtime.getManifest();
  const versionEl = document.getElementById('version-label');
  if (versionEl) versionEl.textContent = `v${manifest.version}`;

  const serverEl = document.getElementById('server-status');
  const engineEl = document.getElementById('engine-status');
  const adapterEl = document.getElementById('adapter-status');
  const cacheEl = document.getElementById('cache-count');
  const updateBanner = document.getElementById('update-banner');
  const updateText = document.getElementById('update-text');
  const updateLink = document.getElementById('update-link') as HTMLAnchorElement | null;

  const summary = (await chrome.runtime.sendMessage({
    type: 'GET_STATUS_SUMMARY',
  })) as StatusSummaryResponse;

  if (serverEl) {
    if (summary.health.status === 'ok') {
      serverEl.textContent = 'Verbunden (Lokal)';
      setStatusClass(serverEl, 'ok');
    } else if (summary.health.status === 'unauthorized') {
      serverEl.textContent = 'Token erforderlich';
      setStatusClass(serverEl, 'warn');
    } else {
      serverEl.textContent = 'Offline';
      setStatusClass(serverEl, 'err');
    }
  }

  if (engineEl) {
    engineEl.textContent = summary.health.reachable
      ? `Whisper Small (${summary.health.device}/${summary.health.computeType})`
      : '—';
  }

  if (adapterEl) {
    if (!summary.diagnostics) {
      adapterEl.textContent = 'WhatsApp Web öffnen';
      setStatusClass(adapterEl, 'warn');
    } else if (summary.diagnostics.status === 'READY') {
      adapterEl.textContent = 'Bereit (Interne Module)';
      setStatusClass(adapterEl, 'ok');
    } else {
      adapterEl.textContent = summary.diagnostics.lastErrorCode ?? summary.diagnostics.status;
      setStatusClass(adapterEl, 'err');
    }
  }

  if (cacheEl) {
    cacheEl.textContent = `${summary.cacheCount} Transkripte`;
  }

  if (updateBanner && updateText && updateLink && summary.updateCheck?.updateAvailable) {
    updateBanner.classList.remove('hidden');
    updateText.textContent = `Version v${summary.updateCheck.latestVersion} verfügbar`;
    if (summary.updateCheck.releaseUrl) {
      updateLink.href = summary.updateCheck.releaseUrl;
    }
  }
}

document.getElementById('refresh-btn')?.addEventListener('click', () => {
  void refreshPopup();
});

document.getElementById('options-btn')?.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});

void refreshPopup();
