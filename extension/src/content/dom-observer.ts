import type { TranscriptionJob, VoiceDirection } from '../shared/types';

export interface DetectedVoiceElement {
  messageId: string;
  direction: VoiceDirection;
  element: Element;
}

const VOICE_ICON_SELECTORS = [
  '[data-icon="audio-play"]',
  '[data-icon="ptt-play"]',
  '[data-icon="audio-pause"]',
  '[data-icon="ptt-pause"]',
  '[data-testid="ptt-player"]',
  '[data-testid="audio-player"]',
  'span[aria-label*="Sprachnachricht" i]',
  'span[aria-label*="Voice message" i]',
  'button[aria-label*="Sprachnachricht" i]',
  'button[aria-label*="Voice message" i]',
];

export const TRANSCRIPT_CONTAINER_ATTR = 'data-wa-local-ai-transcript';

export function detectVoiceMessageDirection(messageEl: Element, messageId: string): VoiceDirection {
  if (messageEl.classList.contains('message-out') || messageEl.closest('.message-out')) {
    return 'outgoing';
  }
  if (messageEl.classList.contains('message-in') || messageEl.closest('.message-in')) {
    return 'incoming';
  }
  return messageId.startsWith('true_') ? 'outgoing' : 'incoming';
}

export function findVoiceMessagesInRoot(root: ParentNode): DetectedVoiceElement[] {
  const results: DetectedVoiceElement[] = [];
  const seenIds = new Set<string>();

  const candidates = root.querySelectorAll('[data-id]');
  for (const el of Array.from(candidates)) {
    const messageId = el.getAttribute('data-id')?.trim();
    if (!messageId || seenIds.has(messageId)) continue;

    // Must look like a WhatsApp message ID (e.g. false_...@c.us_... or true_...)
    if (!/^(true|false)_/.test(messageId)) continue;

    const hasVoiceMarker = VOICE_ICON_SELECTORS.some((sel) => el.querySelector(sel) !== null);
    if (!hasVoiceMarker) continue;

    seenIds.add(messageId);
    results.push({
      messageId,
      direction: detectVoiceMessageDirection(el, messageId),
      element: el,
    });
  }

  return results;
}

export function isWhatsAppDarkTheme(doc: Document): boolean {
  const body = doc.body;
  const html = doc.documentElement;
  if (body?.classList.contains('dark') || html?.classList.contains('dark')) {
    return true;
  }
  if (
    body?.getAttribute('data-theme') === 'dark' ||
    html?.getAttribute('data-theme') === 'dark'
  ) {
    return true;
  }
  return false;
}

export interface TranscriptUIActions {
  onRetry: (messageId: string) => void;
  onCopy?: (text: string) => void;
}

export function renderTranscriptIntoMessageElement(
  doc: Document,
  messageEl: Element,
  job: TranscriptionJob,
  actions: TranscriptUIActions
): HTMLElement {
  const existing = messageEl.querySelector(`[${TRANSCRIPT_CONTAINER_ATTR}]`) as HTMLElement | null;
  const container = existing ?? doc.createElement('div');
  const isCollapsed = container.getAttribute('data-collapsed') === 'true';

  if (!existing) {
    container.setAttribute(TRANSCRIPT_CONTAINER_ATTR, job.messageId);
    container.className = 'wa-local-ai-transcript-box';
    const anchorTarget =
      messageEl.querySelector('[data-testid="ptt-player"]')?.parentElement ??
      messageEl.querySelector('[data-testid="audio-player"]')?.parentElement ??
      messageEl;
    anchorTarget.appendChild(container);
  }

  container.setAttribute('data-status', job.status);
  container.setAttribute('data-theme', isWhatsAppDarkTheme(doc) ? 'dark' : 'light');

  // Clear safely using DOM APIs (never raw innerHTML with untrusted transcript strings)
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  const header = doc.createElement('div');
  header.className = 'wa-local-ai-header';

  const titleGroup = doc.createElement('div');
  titleGroup.className = 'wa-local-ai-title-group';

  const titleEl = doc.createElement('strong');
  titleEl.className = 'wa-local-ai-title';
  titleEl.textContent = 'Transkript';
  titleGroup.appendChild(titleEl);

  const statusMeta = doc.createElement('span');
  statusMeta.className = 'wa-local-ai-meta';
  statusMeta.textContent = formatStatusMeta(job);
  titleGroup.appendChild(statusMeta);

  header.appendChild(titleGroup);

  const controls = doc.createElement('div');
  controls.className = 'wa-local-ai-controls';

  if (job.transcript && (job.status === 'completed' || job.status === 'cached')) {
    const copyBtn = doc.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'wa-local-ai-btn';
    copyBtn.textContent = 'Kopieren';
    copyBtn.setAttribute('aria-label', 'Transkript kopieren');
    copyBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (actions.onCopy) {
        actions.onCopy(job.transcript ?? '');
      } else if (doc.defaultView?.navigator?.clipboard) {
        void doc.defaultView.navigator.clipboard.writeText(job.transcript ?? '');
      }
      copyBtn.textContent = 'Kopiert';
      setTimeout(() => {
        copyBtn.textContent = 'Kopieren';
      }, 1500);
    });
    controls.appendChild(copyBtn);

    const toggleBtn = doc.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'wa-local-ai-btn';
    toggleBtn.textContent = isCollapsed ? 'Einblenden' : 'Ausblenden';
    toggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
    toggleBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const nextCollapsed = container.getAttribute('data-collapsed') !== 'true';
      container.setAttribute('data-collapsed', String(nextCollapsed));
      renderTranscriptIntoMessageElement(doc, messageEl, job, actions);
    });
    controls.appendChild(toggleBtn);
  }

  if (job.status === 'error') {
    const retryBtn = doc.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'wa-local-ai-btn wa-local-ai-btn-retry';
    retryBtn.textContent = 'Erneut versuchen';
    retryBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      actions.onRetry(job.messageId);
    });
    controls.appendChild(retryBtn);
  }

  header.appendChild(controls);
  container.appendChild(header);

  if (!isCollapsed) {
    const body = doc.createElement('div');
    body.className = 'wa-local-ai-body';

    if (job.status === 'completed' || job.status === 'cached') {
      const p = doc.createElement('p');
      p.className = 'wa-local-ai-text';
      p.textContent = job.transcript || '(Kein gesprochener Text erkannt)';
      body.appendChild(p);
    } else if (job.status === 'error') {
      const errP = doc.createElement('p');
      errP.className = 'wa-local-ai-error';
      errP.textContent = job.errorMessage ?? 'Transkription fehlgeschlagen.';
      body.appendChild(errP);
    } else {
      const progressP = doc.createElement('p');
      progressP.className = 'wa-local-ai-pending';
      progressP.textContent =
        job.status === 'queued'
          ? 'Wartet in lokaler Warteschlange...'
          : job.status === 'fetching_media'
            ? 'Rufe entschlüsseltes Audio über WhatsApp-Modul ab...'
            : 'Transkribiere lokal mit Whisper Small...';
      body.appendChild(progressP);
    }

    container.appendChild(body);
  }

  return container;
}

function formatStatusMeta(job: TranscriptionJob): string {
  const parts: string[] = [];
  if (job.status === 'cached') {
    parts.push('Aus lokalem Cache');
  } else if (job.status === 'completed') {
    parts.push('Lokal (Whisper Small)');
  } else if (job.status === 'transcribing') {
    parts.push('Verarbeitung...');
  } else if (job.status === 'fetching_media') {
    parts.push('Medienabruf...');
  } else if (job.status === 'queued') {
    parts.push('Warteschlange');
  } else if (job.status === 'error') {
    parts.push('Fehler');
  }

  if (job.language) {
    parts.push(job.language.toUpperCase());
  }
  if (job.inferenceDevice) {
    parts.push(job.inferenceDevice);
  }

  return parts.join(' · ');
}
