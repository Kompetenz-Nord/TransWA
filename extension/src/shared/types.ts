export type VoiceDirection = 'incoming' | 'outgoing';

export type TranscriptionStatus =
  | 'queued'
  | 'fetching_media'
  | 'transcribing'
  | 'completed'
  | 'cached'
  | 'error';

export type AdapterStatusCode =
  | 'UNINITIALIZED'
  | 'INITIALIZING'
  | 'READY'
  | 'MODULES_DELAYED'
  | 'MODULES_MISSING'
  | 'SIGNATURE_MISMATCH'
  | 'ERROR';

export interface MediaMetadataSnapshot {
  messageId: string;
  direction: VoiceDirection;
  type: 'ptt' | 'audio' | string;
  mimetype: string;
  durationSec: number | null;
  hasDirectPath: boolean;
  hasEncFilehash: boolean;
  hasFilehash: boolean;
  hasMediaKey: boolean;
  mediaKeyTimestamp: number | null;
}

export interface AdapterDiagnosticReport {
  status: AdapterStatusCode;
  whatsappVersion: string | null;
  msgCollectionFound: boolean;
  downloadManagerFound: boolean;
  msgGetSignatureOk: boolean;
  downloadSignatureOk: boolean;
  initAttempts: number;
  maxRetries: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  checkedAt: string;
}

export interface DecryptedAudioResult {
  messageId: string;
  direction: VoiceDirection;
  mimetype: string;
  durationSec: number | null;
  byteLength: number;
  buffer: ArrayBuffer;
  metadata: MediaMetadataSnapshot;
}

export interface CachedTranscriptRecord {
  messageId: string;
  audioHash: string;
  transcript: string;
  language: string;
  status: 'completed' | 'error';
  modelVersion: string;
  processedAt: string;
  durationSec: number | null;
  inferenceDevice?: string;
}

export interface TranscriptionJob {
  messageId: string;
  direction: VoiceDirection;
  status: TranscriptionStatus;
  transcript: string | null;
  language: string | null;
  audioHash: string | null;
  modelVersion: string;
  errorMessage: string | null;
  fromCache: boolean;
  updatedAt: string;
  inferenceDevice?: string;
}

export interface ExtensionSettings {
  serverUrl: string;
  authToken: string;
  language: 'auto' | 'de' | 'en' | 'fr' | 'es' | 'it' | 'tr' | 'pl';
  autoTranscribe: boolean;
  showTranscriptExpandedByDefault: boolean;
  enableGitHubUpdateCheck: boolean;
  githubRepo: string;
}

export interface BackendHealthStatus {
  reachable: boolean;
  status: 'ok' | 'degraded' | 'offline' | 'unauthorized';
  model: string;
  device: string;
  computeType: string;
  cudaAvailable: boolean;
  gpuName: string | null;
  version: string | null;
  error: string | null;
}

export interface GitHubReleaseCheckResult {
  checkedAt: string;
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  error: string | null;
}

export const DEFAULT_EXTENSION_SETTINGS: ExtensionSettings = {
  serverUrl: 'http://127.0.0.1:8765',
  authToken: '',
  language: 'auto',
  autoTranscribe: true,
  showTranscriptExpandedByDefault: true,
  enableGitHubUpdateCheck: true,
  githubRepo: 'Kompetenz-Nord/TransWA',
};

export const WHISPER_MODEL_ID = 'Systran/faster-whisper-small';
