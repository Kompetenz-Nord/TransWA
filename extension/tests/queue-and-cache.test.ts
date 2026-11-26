import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalTranscriptCache, MemoryStorageAdapter } from '../src/shared/cache';
import { TranscriptionQueue, type AudioFetcher, type WhisperTranscriber } from '../src/shared/queue';
import { WHISPER_MODEL_ID } from '../src/shared/types';

function makeAudioBuffer(seed: number): ArrayBuffer {
  const arr = new Uint8Array(48);
  arr[0] = 0x4f;
  arr[1] = 0x67;
  arr[2] = 0x67;
  arr[3] = 0x53;
  arr[4] = seed & 0xff;
  return arr.buffer;
}

test('TranscriptionQueue processes multiple concurrent voice messages sequentially and deduplicates', async () => {
  const cache = new LocalTranscriptCache(new MemoryStorageAdapter());
  let activeInFlight = 0;
  let maxObservedConcurrency = 0;
  let transcribeCalls = 0;

  const fetcher: AudioFetcher = {
    async fetchVoiceAudio(messageId) {
      const seed = messageId.endsWith('1') ? 1 : messageId.endsWith('2') ? 2 : 3;
      const buf = makeAudioBuffer(seed);
      return {
        messageId,
        direction: messageId.startsWith('true_') ? 'outgoing' : 'incoming',
        mimetype: 'audio/ogg; codecs=opus',
        durationSec: 12,
        byteLength: buf.byteLength,
        buffer: buf,
        metadata: {
          messageId,
          direction: messageId.startsWith('true_') ? 'outgoing' : 'incoming',
          type: 'ptt',
          mimetype: 'audio/ogg',
          durationSec: 12,
          hasDirectPath: true,
          hasEncFilehash: true,
          hasFilehash: true,
          hasMediaKey: true,
          mediaKeyTimestamp: 1730000000,
        },
      };
    },
  };

  const transcriber: WhisperTranscriber = {
    async transcribe({ messageId }) {
      activeInFlight++;
      maxObservedConcurrency = Math.max(maxObservedConcurrency, activeInFlight);
      transcribeCalls++;
      await new Promise((r) => setTimeout(r, 10));
      activeInFlight--;
      return {
        transcript: `Hallo von ${messageId}`,
        language: 'de',
        inferenceDevice: 'cuda/float16',
        modelVersion: WHISPER_MODEL_ID,
      };
    },
  };

  const queue = new TranscriptionQueue({ cache, fetcher, transcriber, concurrency: 1 });

  await Promise.all([
    queue.enqueue('false_chat_MSG_1', 'incoming'),
    queue.enqueue('true_chat_MSG_2', 'outgoing'),
    queue.enqueue('false_chat_MSG_1', 'incoming'), // Duplicate enqueue!
  ]);

  // Wait for sequential queue completion
  await new Promise((r) => setTimeout(r, 80));

  assert.equal(maxObservedConcurrency, 1);
  assert.equal(transcribeCalls, 2);
  assert.equal(queue.getJob('false_chat_MSG_1')?.status, 'completed');
  assert.equal(queue.getJob('true_chat_MSG_2')?.status, 'completed');
  assert.equal(await cache.count(), 2);
});

test('TranscriptionQueue restores from SHA-256 audio hash cache without calling Whisper again', async () => {
  const storage = new MemoryStorageAdapter();
  const cache = new LocalTranscriptCache(storage);
  const sharedAudio = makeAudioBuffer(99);
  let transcribeCalls = 0;

  const fetcher: AudioFetcher = {
    async fetchVoiceAudio(messageId) {
      return {
        messageId,
        direction: 'incoming',
        mimetype: 'audio/ogg',
        durationSec: 9,
        byteLength: sharedAudio.byteLength,
        buffer: sharedAudio.slice(0),
        metadata: {
          messageId,
          direction: 'incoming',
          type: 'ptt',
          mimetype: 'audio/ogg',
          durationSec: 9,
          hasDirectPath: true,
          hasEncFilehash: true,
          hasFilehash: true,
          hasMediaKey: true,
          mediaKeyTimestamp: null,
        },
      };
    },
  };

  const transcriber: WhisperTranscriber = {
    async transcribe() {
      transcribeCalls++;
      return {
        transcript: 'Termin ist morgen um neun Uhr.',
        language: 'de',
        inferenceDevice: 'cpu/int8',
      };
    },
  };

  const queue = new TranscriptionQueue({ cache, fetcher, transcriber });
  await queue.enqueue('false_chat_A', 'incoming');
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(transcribeCalls, 1);

  // Second message with identical audio bytes (e.g., forwarded voice message)
  await queue.enqueue('false_chat_B', 'incoming');
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(transcribeCalls, 1);
  assert.equal(queue.getJob('false_chat_B')?.status, 'cached');
  assert.equal(queue.getJob('false_chat_B')?.transcript, 'Termin ist morgen um neun Uhr.');
});

test('TranscriptionQueue handles errors and supports manual retry, and cache clears completely', async () => {
  const cache = new LocalTranscriptCache(new MemoryStorageAdapter());
  let shouldFail = true;

  const fetcher: AudioFetcher = {
    async fetchVoiceAudio(messageId) {
      if (shouldFail) throw new Error('Temporärer Audio-Fehler');
      const buf = makeAudioBuffer(7);
      return {
        messageId,
        direction: 'incoming',
        mimetype: 'audio/ogg',
        durationSec: 5,
        byteLength: buf.byteLength,
        buffer: buf,
        metadata: {
          messageId,
          direction: 'incoming',
          type: 'ptt',
          mimetype: 'audio/ogg',
          durationSec: 5,
          hasDirectPath: true,
          hasEncFilehash: true,
          hasFilehash: true,
          hasMediaKey: true,
          mediaKeyTimestamp: null,
        },
      };
    },
  };

  const transcriber: WhisperTranscriber = {
    async transcribe() {
      return { transcript: 'Erfolgreicher zweiter Versuch.', language: 'de' };
    },
  };

  const queue = new TranscriptionQueue({ cache, fetcher, transcriber });
  await queue.enqueue('false_chat_ERR', 'incoming');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(queue.getJob('false_chat_ERR')?.status, 'error');

  shouldFail = false;
  await queue.enqueue('false_chat_ERR', 'incoming', true);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(queue.getJob('false_chat_ERR')?.status, 'completed');
  assert.equal(await cache.count(), 1);

  await cache.clearAll();
  assert.equal(await cache.count(), 0);
});
