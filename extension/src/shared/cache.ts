import type { CachedTranscriptRecord } from './types';

export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export class MemoryStorageAdapter implements StorageAdapter {
  private readonly store = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.store.delete(key);
  }
}

export class ChromeStorageAdapter implements StorageAdapter {
  async getItem(key: string): Promise<string | null> {
    const result = await chrome.storage.local.get(key);
    const val = result[key];
    return typeof val === 'string' ? val : null;
  }

  async setItem(key: string, value: string): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  }

  async removeItem(key: string): Promise<void> {
    await chrome.storage.local.remove(key);
  }
}

interface CacheStorePayload {
  version: 1;
  byMessageId: Record<string, CachedTranscriptRecord>;
  byAudioHash: Record<string, string>; // audioHash -> messageId
}

const CACHE_STORAGE_KEY = 'wa_local_ai_transcript_cache_v1';
const MAX_CACHED_RECORDS = 2000;

export class LocalTranscriptCache {
  private readonly storage: StorageAdapter;
  private loaded = false;
  private data: CacheStorePayload = {
    version: 1,
    byMessageId: {},
    byAudioHash: {},
  };

  constructor(storage: StorageAdapter) {
    this.storage = storage;
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await this.storage.getItem(CACHE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<CacheStorePayload>;
        if (parsed && parsed.version === 1 && parsed.byMessageId && parsed.byAudioHash) {
          this.data = {
            version: 1,
            byMessageId: parsed.byMessageId,
            byAudioHash: parsed.byAudioHash,
          };
        }
      }
    } catch {
      this.data = { version: 1, byMessageId: {}, byAudioHash: {} };
    }
    this.loaded = true;
  }

  async getByMessageId(messageId: string): Promise<CachedTranscriptRecord | null> {
    await this.ensureLoaded();
    return this.data.byMessageId[messageId] ?? null;
  }

  async getByAudioHash(audioHash: string): Promise<CachedTranscriptRecord | null> {
    await this.ensureLoaded();
    const mappedId = this.data.byAudioHash[audioHash];
    if (!mappedId) return null;
    return this.data.byMessageId[mappedId] ?? null;
  }

  async put(record: CachedTranscriptRecord): Promise<void> {
    await this.ensureLoaded();
    // Strictly store only non-PII fields required for message/audio correlation
    const cleanRecord: CachedTranscriptRecord = {
      messageId: record.messageId,
      audioHash: record.audioHash,
      transcript: record.transcript,
      language: record.language,
      status: record.status,
      modelVersion: record.modelVersion,
      processedAt: record.processedAt,
      durationSec: record.durationSec,
      inferenceDevice: record.inferenceDevice,
    };

    this.data.byMessageId[cleanRecord.messageId] = cleanRecord;
    if (cleanRecord.audioHash) {
      this.data.byAudioHash[cleanRecord.audioHash] = cleanRecord.messageId;
    }

    this.evictOldestIfNeeded();
    await this.persist();
  }

  async deleteByMessageId(messageId: string): Promise<void> {
    await this.ensureLoaded();
    const existing = this.data.byMessageId[messageId];
    if (existing?.audioHash && this.data.byAudioHash[existing.audioHash] === messageId) {
      delete this.data.byAudioHash[existing.audioHash];
    }
    delete this.data.byMessageId[messageId];
    await this.persist();
  }

  async clearAll(): Promise<void> {
    this.data = { version: 1, byMessageId: {}, byAudioHash: {} };
    this.loaded = true;
    await this.storage.removeItem(CACHE_STORAGE_KEY);
  }

  async count(): Promise<number> {
    await this.ensureLoaded();
    return Object.keys(this.data.byMessageId).length;
  }

  async listAll(): Promise<CachedTranscriptRecord[]> {
    await this.ensureLoaded();
    return Object.values(this.data.byMessageId).sort((a, b) =>
      b.processedAt.localeCompare(a.processedAt)
    );
  }

  private evictOldestIfNeeded(): void {
    const entries = Object.entries(this.data.byMessageId);
    if (entries.length <= MAX_CACHED_RECORDS) return;
    entries.sort((a, b) => a[1].processedAt.localeCompare(b[1].processedAt));
    const toRemove = entries.length - MAX_CACHED_RECORDS;
    for (let i = 0; i < toRemove; i++) {
      const [msgId, rec] = entries[i];
      delete this.data.byMessageId[msgId];
      if (rec.audioHash && this.data.byAudioHash[rec.audioHash] === msgId) {
        delete this.data.byAudioHash[rec.audioHash];
      }
    }
  }

  private async persist(): Promise<void> {
    await this.storage.setItem(CACHE_STORAGE_KEY, JSON.stringify(this.data));
  }
}
