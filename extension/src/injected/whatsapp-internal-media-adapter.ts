import { sanitizeDiagnosticValue } from '../shared/crypto';
import type {
  AdapterDiagnosticReport,
  AdapterStatusCode,
  DecryptedAudioResult,
  MediaMetadataSnapshot,
  VoiceDirection,
} from '../shared/types';

/**
 * Minimal structural interfaces representing the internal WhatsApp Web runtime modules.
 * These are intentionally decoupled from WhatsApp's private build so signature changes
 * only require updating this adapter.
 */
export interface WAInternalMessageModel {
  id?: string | { _serialized?: string; id?: string; fromMe?: boolean };
  type?: string;
  mimetype?: string;
  duration?: number;
  directPath?: string;
  encFilehash?: string;
  filehash?: string;
  mediaKey?: string;
  mediaKeyTimestamp?: number;
  deprecatedMms3Url?: string;
  isFromMe?: boolean;
  fromMe?: boolean;
  mediaObject?: {
    directPath?: string;
    encFilehash?: string;
    filehash?: string;
    mediaKey?: string;
    mediaKeyTimestamp?: number;
    type?: string;
    mimetype?: string;
  };
  mediaData?: {
    directPath?: string;
    encFilehash?: string;
    filehash?: string;
    mediaKey?: string;
    mediaKeyTimestamp?: number;
    type?: string;
    mimetype?: string;
  };
}

export interface WAWebMsgCollectionLike {
  get?(id: string): WAInternalMessageModel | undefined;
  getModelsArray?(): WAInternalMessageModel[];
}

export interface WAWebDownloadManagerLike {
  downloadAndMaybeDecrypt?(params: Record<string, unknown>): Promise<unknown>;
  downloadMedia?(params: Record<string, unknown>): Promise<unknown>;
}

export interface WARuntimeProvider {
  requireModule(moduleName: string): unknown;
  getWhatsAppVersion?(): string | null;
}

export interface AdapterOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  runtimeProvider?: WARuntimeProvider;
}

const DEFAULT_MAX_RETRIES = 12;
const DEFAULT_RETRY_DELAY_MS = 750;

export function createBrowserWARuntimeProvider(): WARuntimeProvider {
  return {
    requireModule(moduleName: string): unknown {
      const win = globalThis as unknown as {
        require?: (name: string) => unknown;
      };
      if (typeof win.require !== 'function') {
        return null;
      }
      try {
        return win.require(moduleName);
      } catch {
        return null;
      }
    },
    getWhatsAppVersion(): string | null {
      const win = globalThis as unknown as {
        Debug?: { VERSION?: string };
        require?: (name: string) => { VERSION?: string; default?: { VERSION?: string } };
      };
      if (win.Debug?.VERSION) return String(win.Debug.VERSION);
      try {
        const verMod = win.require?.('WAWebBuildConstants');
        const v = verMod?.VERSION ?? verMod?.default?.VERSION;
        return typeof v === 'string' ? v : null;
      } catch {
        return null;
      }
    },
  };
}

function unwrapModule<T>(mod: unknown): T | null {
  if (!mod || typeof mod !== 'object') return null;
  const record = mod as Record<string, unknown>;
  if (record.default && typeof record.default === 'object') {
    return record.default as T;
  }
  return mod as T;
}

function resolveDownloadManager(mod: unknown): WAWebDownloadManagerLike | null {
  if (!mod || typeof mod !== 'object') return null;
  const record = mod as Record<string, unknown>;
  const candidates = [record.downloadManager, record.default, record];
  for (const cand of candidates) {
    if (
      cand &&
      typeof cand === 'object' &&
      (typeof (cand as WAWebDownloadManagerLike).downloadAndMaybeDecrypt === 'function' ||
        typeof (cand as WAWebDownloadManagerLike).downloadMedia === 'function')
    ) {
      return cand as WAWebDownloadManagerLike;
    }
  }
  return null;
}

function resolveMsgCollection(mod: unknown): WAWebMsgCollectionLike | null {
  if (!mod || typeof mod !== 'object') return null;
  const record = mod as Record<string, unknown>;
  const candidates = [record.MsgCollection, record.default, record];
  for (const cand of candidates) {
    if (cand && typeof cand === 'object' && typeof (cand as WAWebMsgCollectionLike).get === 'function') {
      return cand as WAWebMsgCollectionLike;
    }
  }
  return null;
}

export class WhatsAppInternalMediaAdapter {
  private readonly runtime: WARuntimeProvider;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  private msgCollection: WAWebMsgCollectionLike | null = null;
  private downloadManager: WAWebDownloadManagerLike | null = null;
  private status: AdapterStatusCode = 'UNINITIALIZED';
  private initAttempts = 0;
  private lastErrorCode: string | null = null;
  private lastErrorMessage: string | null = null;
  private initPromise: Promise<AdapterDiagnosticReport> | null = null;

  constructor(options: AdapterOptions = {}) {
    this.runtime = options.runtimeProvider ?? createBrowserWARuntimeProvider();
    this.maxRetries = Math.max(1, options.maxRetries ?? DEFAULT_MAX_RETRIES);
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
  }

  /**
   * Initializes the internal WhatsApp Web modules (`WAWebMsgCollection` and `WAWebDownloadManager`)
   * with bounded retries to accommodate delayed lazy-loading without enumerating arbitrary modules.
   */
  async initialize(): Promise<AdapterDiagnosticReport> {
    if (this.status === 'READY' && this.msgCollection && this.downloadManager) {
      return this.getDiagnostics();
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.runBoundedInit().finally(() => {
      this.initPromise = null;
    });
    return this.initPromise;
  }

  async reinitialize(): Promise<AdapterDiagnosticReport> {
    this.msgCollection = null;
    this.downloadManager = null;
    this.status = 'UNINITIALIZED';
    this.initAttempts = 0;
    this.lastErrorCode = null;
    this.lastErrorMessage = null;
    return this.initialize();
  }

  private async runBoundedInit(): Promise<AdapterDiagnosticReport> {
    this.status = 'INITIALIZING';

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      this.initAttempts = attempt;
      const probe = this.probeInternalModules();
      if (probe.ok) {
        this.status = 'READY';
        this.lastErrorCode = null;
        this.lastErrorMessage = null;
        return this.getDiagnostics();
      }

      this.status = attempt < this.maxRetries ? 'MODULES_DELAYED' : probe.failureStatus;
      this.lastErrorCode = probe.errorCode;
      this.lastErrorMessage = probe.errorMessage;

      if (attempt < this.maxRetries && this.retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
      }
    }

    return this.getDiagnostics();
  }

  private probeInternalModules():
    | { ok: true }
    | { ok: false; failureStatus: AdapterStatusCode; errorCode: string; errorMessage: string } {
    const rawMsgMod = this.runtime.requireModule('WAWebMsgCollection');
    const rawDlMod = this.runtime.requireModule('WAWebDownloadManager');

    const msgCollection = resolveMsgCollection(rawMsgMod);
    const downloadManager = resolveDownloadManager(rawDlMod);

    if (!rawMsgMod && !rawDlMod) {
      return {
        ok: false,
        failureStatus: 'MODULES_MISSING',
        errorCode: 'WA_MODULES_NOT_FOUND',
        errorMessage:
          'WAWebMsgCollection und WAWebDownloadManager wurden nicht gefunden (WhatsApp Web möglicherweise noch nicht geladen oder Modulnamen geändert).',
      };
    }

    if (!rawMsgMod) {
      return {
        ok: false,
        failureStatus: 'MODULES_MISSING',
        errorCode: 'WA_MSG_COLLECTION_MISSING',
        errorMessage: 'Internes Modul WAWebMsgCollection nicht verfügbar.',
      };
    }

    if (!rawDlMod) {
      return {
        ok: false,
        failureStatus: 'MODULES_MISSING',
        errorCode: 'WA_DOWNLOAD_MANAGER_MISSING',
        errorMessage: 'Internes Modul WAWebDownloadManager nicht verfügbar.',
      };
    }

    if (!msgCollection || typeof msgCollection.get !== 'function') {
      return {
        ok: false,
        failureStatus: 'SIGNATURE_MISMATCH',
        errorCode: 'WA_MSG_COLLECTION_SIGNATURE_MISMATCH',
        errorMessage: 'WAWebMsgCollection bietet keine kompatible .get(id)-Signatur.',
      };
    }

    if (
      !downloadManager ||
      (typeof downloadManager.downloadAndMaybeDecrypt !== 'function' &&
        typeof downloadManager.downloadMedia !== 'function')
    ) {
      return {
        ok: false,
        failureStatus: 'SIGNATURE_MISMATCH',
        errorCode: 'WA_DOWNLOAD_MANAGER_SIGNATURE_MISMATCH',
        errorMessage:
          'WAWebDownloadManager bietet weder downloadAndMaybeDecrypt noch downloadMedia.',
      };
    }

    this.msgCollection = msgCollection;
    this.downloadManager = downloadManager;
    return { ok: true };
  }

  getDiagnostics(): AdapterDiagnosticReport {
    const msgGetOk = Boolean(this.msgCollection && typeof this.msgCollection.get === 'function');
    const dlSigOk = Boolean(
      this.downloadManager &&
        (typeof this.downloadManager.downloadAndMaybeDecrypt === 'function' ||
          typeof this.downloadManager.downloadMedia === 'function')
    );

    const rawReport: AdapterDiagnosticReport = {
      status: this.status,
      whatsappVersion: this.runtime.getWhatsAppVersion?.() ?? null,
      msgCollectionFound: Boolean(this.msgCollection),
      downloadManagerFound: Boolean(this.downloadManager),
      msgGetSignatureOk: msgGetOk,
      downloadSignatureOk: dlSigOk,
      initAttempts: this.initAttempts,
      maxRetries: this.maxRetries,
      lastErrorCode: this.lastErrorCode,
      lastErrorMessage: this.lastErrorMessage,
      checkedAt: new Date().toISOString(),
    };

    return sanitizeDiagnosticValue(rawReport) as AdapterDiagnosticReport;
  }

  /**
   * Retrieves and decrypts a WhatsApp voice message purely via the active session's
   * internal media modules without triggering HTML audio playback or modifying read state.
   */
  async fetchAndDecryptVoiceMessage(messageId: string): Promise<DecryptedAudioResult> {
    if (this.status !== 'READY' || !this.msgCollection || !this.downloadManager) {
      const diag = await this.initialize();
      if (diag.status !== 'READY' || !this.msgCollection || !this.downloadManager) {
        throw new Error(
          `[${diag.lastErrorCode ?? 'ADAPTER_NOT_READY'}] ${diag.lastErrorMessage ?? 'WhatsApp-Medienmodule nicht bereit.'}`
        );
      }
    }

    const msg = this.lookupMessage(messageId);
    if (!msg) {
      throw new Error(
        `[MSG_NOT_FOUND] Nachricht "${messageId}" wurde in WAWebMsgCollection nicht gefunden.`
      );
    }

    const mediaParams = this.extractMediaParams(messageId, msg);
    if (!mediaParams.type || (mediaParams.type !== 'ptt' && mediaParams.type !== 'audio')) {
      throw new Error(
        `[NOT_AUDIO_MESSAGE] Nachricht "${messageId}" hat Typ "${mediaParams.type ?? 'unbekannt'}".`
      );
    }

    if (!mediaParams.directPath || !mediaParams.mediaKey || !mediaParams.encFilehash || !mediaParams.filehash) {
      throw new Error(
        `[INCOMPLETE_MEDIA_METADATA] Erforderliche Mediendaten (directPath/mediaKey/hashes) fehlen für "${messageId}".`
      );
    }

    // Ephemeral download & decryption call — mediaKey never leaves this transient scope.
    const rawBuffer = await this.invokeInternalDownload(mediaParams);
    const arrayBuffer = await this.normalizeToArrayBuffer(rawBuffer);

    if (arrayBuffer.byteLength === 0) {
      throw new Error(`[EMPTY_AUDIO_BUFFER] Entschlüsselter Audiopuffer für "${messageId}" ist leer.`);
    }

    const metadata: MediaMetadataSnapshot = {
      messageId,
      direction: mediaParams.direction,
      type: mediaParams.type,
      mimetype: mediaParams.mimetype,
      durationSec: mediaParams.durationSec,
      hasDirectPath: true,
      hasEncFilehash: true,
      hasFilehash: true,
      hasMediaKey: true,
      mediaKeyTimestamp: mediaParams.mediaKeyTimestamp,
    };

    return {
      messageId,
      direction: mediaParams.direction,
      mimetype: mediaParams.mimetype,
      durationSec: mediaParams.durationSec,
      byteLength: arrayBuffer.byteLength,
      buffer: arrayBuffer,
      metadata,
    };
  }

  private lookupMessage(messageId: string): WAInternalMessageModel | undefined {
    if (!this.msgCollection) return undefined;
    const direct = this.msgCollection.get?.(messageId);
    if (direct) return direct;

    // Fallback: match serialized ID or stanza suffix when WhatsApp switches JID representation (e.g. LID)
    if (typeof this.msgCollection.getModelsArray === 'function') {
      const models = this.msgCollection.getModelsArray();
      const targetSuffix = messageId.split('_').pop();
      return models.find((m) => {
        const serialized =
          typeof m.id === 'string' ? m.id : m.id?._serialized ?? m.id?.id ?? '';
        return serialized === messageId || (targetSuffix && serialized.endsWith(`_${targetSuffix}`));
      });
    }
    return undefined;
  }

  private extractMediaParams(messageId: string, msg: WAInternalMessageModel): {
    directPath: string;
    encFilehash: string;
    filehash: string;
    mediaKey: string;
    mediaKeyTimestamp: number | null;
    type: string;
    mimetype: string;
    durationSec: number | null;
    direction: VoiceDirection;
  } {
    const mediaSource = msg.mediaObject ?? msg.mediaData ?? msg;
    const directPath = mediaSource.directPath ?? msg.directPath ?? '';
    const encFilehash = mediaSource.encFilehash ?? msg.encFilehash ?? '';
    const filehash = mediaSource.filehash ?? msg.filehash ?? '';
    const mediaKey = mediaSource.mediaKey ?? msg.mediaKey ?? '';
    const mediaKeyTimestamp =
      typeof (mediaSource.mediaKeyTimestamp ?? msg.mediaKeyTimestamp) === 'number'
        ? (mediaSource.mediaKeyTimestamp ?? msg.mediaKeyTimestamp ?? null)
        : null;

    const type = String(msg.type ?? mediaSource.type ?? 'ptt');
    const mimetype = String(msg.mimetype ?? mediaSource.mimetype ?? 'audio/ogg; codecs=opus');
    const durationSec = typeof msg.duration === 'number' ? msg.duration : null;

    const isFromMe =
      typeof msg.isFromMe === 'boolean'
        ? msg.isFromMe
        : typeof msg.fromMe === 'boolean'
          ? msg.fromMe
          : typeof msg.id === 'object' && typeof msg.id?.fromMe === 'boolean'
            ? msg.id.fromMe
            : messageId.startsWith('true_');

    return {
      directPath,
      encFilehash,
      filehash,
      mediaKey,
      mediaKeyTimestamp,
      type,
      mimetype,
      durationSec,
      direction: isFromMe ? 'outgoing' : 'incoming',
    };
  }

  private async invokeInternalDownload(params: {
    directPath: string;
    encFilehash: string;
    filehash: string;
    mediaKey: string;
    mediaKeyTimestamp: number | null;
    type: string;
    mimetype: string;
  }): Promise<unknown> {
    if (!this.downloadManager) {
      throw new Error('[ADAPTER_NOT_READY] WAWebDownloadManager fehlt.');
    }

    const requestPayload: Record<string, unknown> = {
      directPath: params.directPath,
      encFilehash: params.encFilehash,
      filehash: params.filehash,
      mediaKey: params.mediaKey,
      mediaKeyTimestamp: params.mediaKeyTimestamp ?? Math.floor(Date.now() / 1000),
      type: params.type,
      signal: undefined,
      userDownloadAttemptCount: 0,
      isUserInitiated: false,
    };

    if (typeof this.downloadManager.downloadAndMaybeDecrypt === 'function') {
      return this.downloadManager.downloadAndMaybeDecrypt(requestPayload);
    }
    if (typeof this.downloadManager.downloadMedia === 'function') {
      return this.downloadManager.downloadMedia(requestPayload);
    }

    throw new Error('[WA_DOWNLOAD_MANAGER_SIGNATURE_MISMATCH] Keine kompatible Download-Methode gefunden.');
  }

  private async normalizeToArrayBuffer(raw: unknown): Promise<ArrayBuffer> {
    if (raw instanceof ArrayBuffer) {
      return raw;
    }
    if (ArrayBuffer.isView(raw)) {
      const view = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
      const copy = new Uint8Array(view.byteLength);
      copy.set(view);
      return copy.buffer;
    }
    if (typeof Blob !== 'undefined' && raw instanceof Blob) {
      return raw.arrayBuffer();
    }
    if (raw && typeof raw === 'object' && 'buffer' in raw) {
      const nested = (raw as { buffer: unknown }).buffer;
      if (nested instanceof ArrayBuffer) return nested;
    }
    throw new Error('[UNSUPPORTED_MEDIA_RETURN] Unerwartetes Rückgabeformat beim Medienabruf.');
  }
}

export function unwrapModuleForTest<T>(mod: unknown): T | null {
  return unwrapModule<T>(mod);
}
