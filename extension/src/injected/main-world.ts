import {
  BRIDGE_CHANNEL,
  isTrustedWhatsAppOrigin,
  validateContentToMainMessage,
  type MainToContentPayload,
} from '../shared/bridge-protocol';
import { WhatsAppInternalMediaAdapter } from './whatsapp-internal-media-adapter';

const adapter = new WhatsAppInternalMediaAdapter({
  maxRetries: 12,
  retryDelayMs: 750,
});

function postToContentScript(payload: MainToContentPayload, transferables: Transferable[] = []): void {
  if (!isTrustedWhatsAppOrigin(window.location.origin)) return;
  window.postMessage(payload, window.location.origin, transferables);
}

window.addEventListener('message', async (event: MessageEvent) => {
  if (event.source !== window) return;
  if (!isTrustedWhatsAppOrigin(event.origin)) return;

  const validated = validateContentToMainMessage(event.data);
  if (!validated) return;

  if (validated.type === 'GET_ADAPTER_DIAGNOSTICS') {
    const report = adapter.getDiagnostics();
    postToContentScript({
      channel: BRIDGE_CHANNEL,
      direction: 'main-to-content',
      requestId: validated.requestId,
      type: 'ADAPTER_DIAGNOSTICS_RESULT',
      report,
    });
    return;
  }

  if (validated.type === 'REINITIALIZE_ADAPTER') {
    const report = await adapter.reinitialize();
    postToContentScript({
      channel: BRIDGE_CHANNEL,
      direction: 'main-to-content',
      requestId: validated.requestId,
      type: 'ADAPTER_DIAGNOSTICS_RESULT',
      report,
    });
    return;
  }

  if (validated.type === 'FETCH_VOICE_AUDIO') {
    try {
      const result = await adapter.fetchAndDecryptVoiceMessage(validated.messageId);
      postToContentScript(
        {
          channel: BRIDGE_CHANNEL,
          direction: 'main-to-content',
          requestId: validated.requestId,
          type: 'VOICE_AUDIO_RESULT',
          ok: true,
          messageId: result.messageId,
          voiceDirection: result.direction,
          mimetype: result.mimetype,
          durationSec: result.durationSec,
          buffer: result.buffer,
          metadata: result.metadata,
        },
        [result.buffer]
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Medienabruf fehlgeschlagen';
      const codeMatch = /^\[([A-Z0-9_]+)\]\s*(.*)$/.exec(msg);
      postToContentScript({
        channel: BRIDGE_CHANNEL,
        direction: 'main-to-content',
        requestId: validated.requestId,
        type: 'VOICE_AUDIO_RESULT',
        ok: false,
        messageId: validated.messageId,
        errorCode: codeMatch?.[1] ?? 'MEDIA_FETCH_ERROR',
        errorMessage: codeMatch?.[2] ?? msg,
      });
    }
  }
});

void adapter.initialize().then((report) => {
  postToContentScript({
    channel: BRIDGE_CHANNEL,
    direction: 'main-to-content',
    requestId: 'init_status_event',
    type: 'ADAPTER_STATUS_EVENT',
    report,
  });
});
