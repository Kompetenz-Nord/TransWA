import { sha256Hex } from './crypto';
import type { LocalTranscriptCache } from './cache';
import {
  WHISPER_MODEL_ID,
  type DecryptedAudioResult,
  type TranscriptionJob,
  type VoiceDirection,
} from './types';

export interface AudioFetcher {
  fetchVoiceAudio(messageId: string): Promise<DecryptedAudioResult>;
}

export interface WhisperTranscriber {
  transcribe(params: {
    audioBuffer: ArrayBuffer;
    mimetype: string;
    audioHash: string;
    messageId: string;
  }): Promise<{
    transcript: string;
    language: string;
    inferenceDevice?: string;
    modelVersion?: string;
  }>;
}

export type JobListener = (job: TranscriptionJob) => void;

export class TranscriptionQueue {
  private readonly cache: LocalTranscriptCache;
  private readonly fetcher: AudioFetcher;
  private readonly transcriber: WhisperTranscriber;
  private readonly concurrency: number;

  private readonly pendingIds: string[] = [];
  private readonly activeIds = new Set<string>();
  private readonly processedOrQueuedIds = new Set<string>();
  private readonly jobs = new Map<string, TranscriptionJob>();
  private readonly listeners = new Set<JobListener>();

  constructor(options: {
    cache: LocalTranscriptCache;
    fetcher: AudioFetcher;
    transcriber: WhisperTranscriber;
    concurrency?: number;
  }) {
    this.cache = options.cache;
    this.fetcher = options.fetcher;
    this.transcriber = options.transcriber;
    this.concurrency = Math.max(1, options.concurrency ?? 1);
  }

  subscribe(listener: JobListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getJob(messageId: string): TranscriptionJob | undefined {
    return this.jobs.get(messageId);
  }

  getStats(): { queued: number; active: number; totalTracked: number } {
    return {
      queued: this.pendingIds.length,
      active: this.activeIds.size,
      totalTracked: this.jobs.size,
    };
  }

  async enqueue(messageId: string, direction: VoiceDirection, forceRetry = false): Promise<TranscriptionJob> {
    if (!forceRetry && this.processedOrQueuedIds.has(messageId)) {
      const existing = this.jobs.get(messageId);
      if (existing) return existing;
    }

    if (!forceRetry) {
      const cached = await this.cache.getByMessageId(messageId);
      if (cached && cached.status === 'completed') {
        const job: TranscriptionJob = {
          messageId,
          direction,
          status: 'cached',
          transcript: cached.transcript,
          language: cached.language,
          audioHash: cached.audioHash,
          modelVersion: cached.modelVersion,
          errorMessage: null,
          fromCache: true,
          updatedAt: cached.processedAt,
          inferenceDevice: cached.inferenceDevice,
        };
        this.processedOrQueuedIds.add(messageId);
        this.jobs.set(messageId, job);
        this.emit(job);
        return job;
      }
    }

    this.processedOrQueuedIds.add(messageId);
    const queuedJob: TranscriptionJob = {
      messageId,
      direction,
      status: 'queued',
      transcript: null,
      language: null,
      audioHash: null,
      modelVersion: WHISPER_MODEL_ID,
      errorMessage: null,
      fromCache: false,
      updatedAt: new Date().toISOString(),
    };

    this.jobs.set(messageId, queuedJob);
    this.emit(queuedJob);

    if (!this.pendingIds.includes(messageId) && !this.activeIds.has(messageId)) {
      this.pendingIds.push(messageId);
    }

    void this.pump();
    return queuedJob;
  }

  private async pump(): Promise<void> {
    while (this.activeIds.size < this.concurrency && this.pendingIds.length > 0) {
      const nextId = this.pendingIds.shift();
      if (!nextId) break;
      this.activeIds.add(nextId);
      void this.processJob(nextId).finally(() => {
        this.activeIds.delete(nextId);
        void this.pump();
      });
    }
  }

  private async processJob(messageId: string): Promise<void> {
    const existing = this.jobs.get(messageId);
    if (!existing) return;

    try {
      this.updateJob(messageId, { status: 'fetching_media', errorMessage: null });

      const audio = await this.fetcher.fetchVoiceAudio(messageId);
      const audioHash = await sha256Hex(audio.buffer);

      // Deduplicate identical audio content across forwarded/duplicated messages
      const cachedByHash = await this.cache.getByAudioHash(audioHash);
      if (cachedByHash && cachedByHash.status === 'completed') {
        await this.cache.put({
          ...cachedByHash,
          messageId,
          processedAt: new Date().toISOString(),
        });
        this.updateJob(messageId, {
          status: 'cached',
          transcript: cachedByHash.transcript,
          language: cachedByHash.language,
          audioHash,
          modelVersion: cachedByHash.modelVersion,
          fromCache: true,
          inferenceDevice: cachedByHash.inferenceDevice,
        });
        return;
      }

      this.updateJob(messageId, {
        status: 'transcribing',
        audioHash,
        direction: audio.direction,
      });

      const result = await this.transcriber.transcribe({
        audioBuffer: audio.buffer,
        mimetype: audio.mimetype,
        audioHash,
        messageId,
      });

      const now = new Date().toISOString();
      const modelVersion = result.modelVersion ?? WHISPER_MODEL_ID;

      await this.cache.put({
        messageId,
        audioHash,
        transcript: result.transcript,
        language: result.language,
        status: 'completed',
        modelVersion,
        processedAt: now,
        durationSec: audio.durationSec,
        inferenceDevice: result.inferenceDevice,
      });

      this.updateJob(messageId, {
        status: 'completed',
        transcript: result.transcript,
        language: result.language,
        audioHash,
        modelVersion,
        errorMessage: null,
        fromCache: false,
        updatedAt: now,
        inferenceDevice: result.inferenceDevice,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unbekannter Transkriptionsfehler';
      this.updateJob(messageId, {
        status: 'error',
        errorMessage: msg,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  private updateJob(messageId: string, patch: Partial<TranscriptionJob>): void {
    const current = this.jobs.get(messageId);
    if (!current) return;
    const next: TranscriptionJob = {
      ...current,
      ...patch,
      updatedAt: patch.updatedAt ?? new Date().toISOString(),
    };
    this.jobs.set(messageId, next);
    this.emit(next);
  }

  private emit(job: TranscriptionJob): void {
    for (const listener of this.listeners) {
      try {
        listener(job);
      } catch {
        // Isolate subscriber errors
      }
    }
  }

  clearTrackedJobs(): void {
    this.pendingIds.length = 0;
    this.processedOrQueuedIds.clear();
    this.jobs.clear();
  }
}
