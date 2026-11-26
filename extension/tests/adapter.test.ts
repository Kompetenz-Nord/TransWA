import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WhatsAppInternalMediaAdapter,
  type WARuntimeProvider,
} from '../src/injected/whatsapp-internal-media-adapter';
import {
  BRIDGE_CHANNEL,
  MAX_BRIDGE_AUDIO_BYTES,
  isTrustedWhatsAppOrigin,
  validateContentToMainMessage,
  validateMainToContentMessage,
} from '../src/shared/bridge-protocol';
import { sanitizeDiagnosticValue } from '../src/shared/crypto';

function createSampleOggBuffer(): Uint8Array {
  const bytes = new Uint8Array(64);
  // Magic header "OggS"
  bytes[0] = 0x4f;
  bytes[1] = 0x67;
  bytes[2] = 0x67;
  bytes[3] = 0x53;
  for (let i = 4; i < bytes.length; i++) {
    bytes[i] = (i * 17) & 0xff;
  }
  return bytes;
}

test('WhatsAppInternalMediaAdapter initializes and fetches incoming & outgoing PTT without Play', async () => {
  const oggBytes = createSampleOggBuffer();
  const captured: { params: Record<string, unknown> | null } = { params: null };

  const runtime: WARuntimeProvider = {
    getWhatsAppVersion: () => '2.3000.1018500000',
    requireModule: (name: string) => {
      if (name === 'WAWebMsgCollection') {
        return {
          MsgCollection: {
            get: (id: string) => {
              if (id === 'false_491701234567@c.us_MSG_IN_1') {
                return {
                  id,
                  type: 'ptt',
                  mimetype: 'audio/ogg; codecs=opus',
                  duration: 14,
                  isFromMe: false,
                  directPath: '/v/t62.7117-24/incoming.enc',
                  encFilehash: 'encHashIn',
                  filehash: 'fileHashIn',
                  mediaKey: 'SECRET_MEDIA_KEY_IN',
                  mediaKeyTimestamp: 1730000000,
                };
              }
              if (id === 'true_491701234567@c.us_MSG_OUT_2') {
                return {
                  id,
                  type: 'ptt',
                  mimetype: 'audio/ogg; codecs=opus',
                  duration: 28,
                  isFromMe: true,
                  mediaObject: {
                    directPath: '/v/t62.7117-24/outgoing.enc',
                    encFilehash: 'encHashOut',
                    filehash: 'fileHashOut',
                    mediaKey: 'SECRET_MEDIA_KEY_OUT',
                    mediaKeyTimestamp: 1730000123,
                  },
                };
              }
              return undefined;
            },
          },
        };
      }
      if (name === 'WAWebDownloadManager') {
        return {
          downloadManager: {
            downloadAndMaybeDecrypt: async (params: Record<string, unknown>) => {
              captured.params = params;
              return oggBytes.buffer.slice(0);
            },
          },
        };
      }
      return null;
    },
  };

  const adapter = new WhatsAppInternalMediaAdapter({
    maxRetries: 3,
    retryDelayMs: 1,
    runtimeProvider: runtime,
  });

  const diag = await adapter.initialize();
  assert.equal(diag.status, 'READY');
  assert.equal(diag.msgCollectionFound, true);
  assert.equal(diag.downloadManagerFound, true);
  assert.equal(diag.whatsappVersion, '2.3000.1018500000');

  const incoming = await adapter.fetchAndDecryptVoiceMessage('false_491701234567@c.us_MSG_IN_1');
  assert.equal(incoming.direction, 'incoming');
  assert.equal(incoming.byteLength, 64);
  assert.equal(incoming.metadata.hasMediaKey, true);
  assert.equal(captured.params?.isUserInitiated, false);

  const outgoing = await adapter.fetchAndDecryptVoiceMessage('true_491701234567@c.us_MSG_OUT_2');
  assert.equal(outgoing.direction, 'outgoing');
  assert.equal(outgoing.durationSec, 28);
  assert.equal(outgoing.byteLength, 64);

  // Verify diagnostics never leak media keys
  const serializedDiag = JSON.stringify(diag);
  assert.equal(serializedDiag.includes('SECRET_MEDIA_KEY'), false);
});

test('WhatsAppInternalMediaAdapter handles delayed module loading with bounded retries', async () => {
  let calls = 0;
  const runtime: WARuntimeProvider = {
    requireModule: (name: string) => {
      calls++;
      // Succeed only after 2 failed cycles
      if (calls <= 4) return null;
      if (name === 'WAWebMsgCollection') {
        return { get: () => undefined };
      }
      if (name === 'WAWebDownloadManager') {
        return { downloadAndMaybeDecrypt: async () => new ArrayBuffer(16) };
      }
      return null;
    },
  };

  const adapter = new WhatsAppInternalMediaAdapter({
    maxRetries: 5,
    retryDelayMs: 1,
    runtimeProvider: runtime,
  });

  const diag = await adapter.initialize();
  assert.equal(diag.status, 'READY');
  assert.equal(diag.initAttempts, 3);
});

test('WhatsAppInternalMediaAdapter detects renamed or broken internal module signatures cleanly', async () => {
  const renamedRuntime: WARuntimeProvider = {
    requireModule: (name: string) => {
      if (name === 'WAWebMsgCollection') return { incompatibleMethod: () => null };
      if (name === 'WAWebDownloadManager') return { downloadAndMaybeDecrypt: async () => new ArrayBuffer(8) };
      return null;
    },
  };

  const adapter = new WhatsAppInternalMediaAdapter({
    maxRetries: 2,
    retryDelayMs: 1,
    runtimeProvider: renamedRuntime,
  });

  const diag = await adapter.initialize();
  assert.equal(diag.status, 'SIGNATURE_MISMATCH');
  assert.equal(diag.lastErrorCode, 'WA_MSG_COLLECTION_SIGNATURE_MISMATCH');

  await assert.rejects(
    () => adapter.fetchAndDecryptVoiceMessage('false_123@c.us_ABC'),
    /WA_MSG_COLLECTION_SIGNATURE_MISMATCH/
  );
});

test('Diagnostic sanitizer strips mediaKey, tokens, and JIDs', () => {
  const sanitized = sanitizeDiagnosticValue({
    mediaKey: 'abc123secret',
    encFilehash: 'hashSecret',
    authToken: 'tokenSecret',
    sender: '491701234567@c.us',
    status: 'READY',
  }) as Record<string, unknown>;

  assert.equal(sanitized.mediaKey, '[REDACTED]');
  assert.equal(sanitized.encFilehash, '[REDACTED]');
  assert.equal(sanitized.authToken, '[REDACTED]');
  assert.equal(sanitized.sender, '[REDACTED_JID]');
  assert.equal(sanitized.status, 'READY');
});

test('Bridge protocol validates messages and rejects untrusted origins or oversized buffers', () => {
  assert.equal(isTrustedWhatsAppOrigin('https://web.whatsapp.com'), true);
  assert.equal(isTrustedWhatsAppOrigin('https://evil.example'), false);

  const validReq = validateContentToMainMessage({
    channel: BRIDGE_CHANNEL,
    direction: 'content-to-main',
    requestId: 'req_12345678',
    type: 'FETCH_VOICE_AUDIO',
    messageId: 'false_49170@c.us_ABC123',
  });
  assert.ok(validReq);

  const forgedReq = validateContentToMainMessage({
    channel: 'wrong-channel',
    direction: 'content-to-main',
    requestId: 'req_12345678',
    type: 'FETCH_VOICE_AUDIO',
    messageId: 'false_49170@c.us_ABC123',
  });
  assert.equal(forgedReq, null);

  const emptyBufferRes = validateMainToContentMessage({
    channel: BRIDGE_CHANNEL,
    direction: 'main-to-content',
    requestId: 'req_12345678',
    type: 'VOICE_AUDIO_RESULT',
    ok: true,
    messageId: 'false_49170@c.us_ABC123',
    voiceDirection: 'incoming',
    mimetype: 'audio/ogg',
    durationSec: 5,
    buffer: new ArrayBuffer(0),
    metadata: {},
  });
  assert.equal(emptyBufferRes, null);

  const hugeFake = {
    channel: BRIDGE_CHANNEL,
    direction: 'main-to-content',
    requestId: 'req_12345678',
    type: 'VOICE_AUDIO_RESULT',
    ok: true,
    messageId: 'false_49170@c.us_ABC123',
    voiceDirection: 'incoming',
    mimetype: 'audio/ogg',
    durationSec: 5,
    buffer: { byteLength: MAX_BRIDGE_AUDIO_BYTES + 1 },
    metadata: {},
  };
  assert.equal(validateMainToContentMessage(hugeFake), null);
});
