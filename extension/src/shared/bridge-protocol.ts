import type { AdapterDiagnosticReport, MediaMetadataSnapshot, VoiceDirection } from './types';

export const BRIDGE_CHANNEL = 'wa-local-ai-transcriber-v1';
export const MAX_BRIDGE_AUDIO_BYTES = 50 * 1024 * 1024; // 50 MB hard cap
export const MAX_BRIDGE_MESSAGE_ID_LEN = 256;

export type BridgeDirection = 'content-to-main' | 'main-to-content';

export type ContentToMainPayload =
  | {
      channel: typeof BRIDGE_CHANNEL;
      direction: 'content-to-main';
      requestId: string;
      type: 'FETCH_VOICE_AUDIO';
      messageId: string;
    }
  | {
      channel: typeof BRIDGE_CHANNEL;
      direction: 'content-to-main';
      requestId: string;
      type: 'GET_ADAPTER_DIAGNOSTICS';
    }
  | {
      channel: typeof BRIDGE_CHANNEL;
      direction: 'content-to-main';
      requestId: string;
      type: 'REINITIALIZE_ADAPTER';
    };

export type MainToContentPayload =
  | {
      channel: typeof BRIDGE_CHANNEL;
      direction: 'main-to-content';
      requestId: string;
      type: 'VOICE_AUDIO_RESULT';
      ok: true;
      messageId: string;
      voiceDirection: VoiceDirection;
      mimetype: string;
      durationSec: number | null;
      buffer: ArrayBuffer;
      metadata: MediaMetadataSnapshot;
    }
  | {
      channel: typeof BRIDGE_CHANNEL;
      direction: 'main-to-content';
      requestId: string;
      type: 'VOICE_AUDIO_RESULT';
      ok: false;
      messageId: string;
      errorCode: string;
      errorMessage: string;
    }
  | {
      channel: typeof BRIDGE_CHANNEL;
      direction: 'main-to-content';
      requestId: string;
      type: 'ADAPTER_DIAGNOSTICS_RESULT';
      report: AdapterDiagnosticReport;
    }
  | {
      channel: typeof BRIDGE_CHANNEL;
      direction: 'main-to-content';
      requestId: string;
      type: 'ADAPTER_STATUS_EVENT';
      report: AdapterDiagnosticReport;
    };

export function isValidRequestId(val: unknown): val is string {
  return typeof val === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(val);
}

export function isValidMessageId(val: unknown): val is string {
  return (
    typeof val === 'string' &&
    val.length > 0 &&
    val.length <= MAX_BRIDGE_MESSAGE_ID_LEN &&
    !/[\r\n\0]/.test(val)
  );
}

export function validateContentToMainMessage(data: unknown): ContentToMainPayload | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  if (obj.channel !== BRIDGE_CHANNEL || obj.direction !== 'content-to-main') return null;
  if (!isValidRequestId(obj.requestId)) return null;

  if (obj.type === 'FETCH_VOICE_AUDIO') {
    if (!isValidMessageId(obj.messageId)) return null;
    return {
      channel: BRIDGE_CHANNEL,
      direction: 'content-to-main',
      requestId: obj.requestId,
      type: 'FETCH_VOICE_AUDIO',
      messageId: obj.messageId,
    };
  }

  if (obj.type === 'GET_ADAPTER_DIAGNOSTICS' || obj.type === 'REINITIALIZE_ADAPTER') {
    return {
      channel: BRIDGE_CHANNEL,
      direction: 'content-to-main',
      requestId: obj.requestId,
      type: obj.type,
    };
  }

  return null;
}

export function validateMainToContentMessage(data: unknown): MainToContentPayload | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  if (obj.channel !== BRIDGE_CHANNEL || obj.direction !== 'main-to-content') return null;
  if (!isValidRequestId(obj.requestId)) return null;

  if (obj.type === 'VOICE_AUDIO_RESULT') {
    if (!isValidMessageId(obj.messageId)) return null;
    if (obj.ok === true) {
      if (!(obj.buffer instanceof ArrayBuffer)) return null;
      if (obj.buffer.byteLength === 0 || obj.buffer.byteLength > MAX_BRIDGE_AUDIO_BYTES) {
        return null;
      }
      if (typeof obj.mimetype !== 'string' || obj.mimetype.length > 120) return null;
      if (obj.voiceDirection !== 'incoming' && obj.voiceDirection !== 'outgoing') return null;
      if (!obj.metadata || typeof obj.metadata !== 'object') return null;
      return data as MainToContentPayload;
    }
    if (obj.ok === false) {
      if (typeof obj.errorCode !== 'string' || typeof obj.errorMessage !== 'string') return null;
      return {
        channel: BRIDGE_CHANNEL,
        direction: 'main-to-content',
        requestId: obj.requestId,
        type: 'VOICE_AUDIO_RESULT',
        ok: false,
        messageId: obj.messageId,
        errorCode: obj.errorCode.slice(0, 80),
        errorMessage: obj.errorMessage.slice(0, 300),
      };
    }
    return null;
  }

  if (obj.type === 'ADAPTER_DIAGNOSTICS_RESULT' || obj.type === 'ADAPTER_STATUS_EVENT') {
    if (!obj.report || typeof obj.report !== 'object') return null;
    return data as MainToContentPayload;
  }

  return null;
}

export function isTrustedWhatsAppOrigin(origin: string): boolean {
  return origin === 'https://web.whatsapp.com';
}
