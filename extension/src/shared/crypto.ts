const SENSITIVE_KEY_PATTERN =
  /^(mediakey|encfilehash|filehash|token|authtoken|authorization|secret|cookie|session|phone|jid|remotejid|participant|directpath)$/i;

export async function sha256Hex(input: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);
  const view = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < view.length; i++) {
    hex += view[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export function sanitizeDiagnosticValue(value: unknown, depth = 0): unknown {
  if (depth > 4) {
    return '[TRUNCATED]';
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    if (/^\+?\d{8,15}@(c\.us|s\.whatsapp\.net|lid)$/i.test(value)) {
      return '[REDACTED_JID]';
    }
    return value.length > 512 ? `${value.slice(0, 512)}…` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeDiagnosticValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = sanitizeDiagnosticValue(val, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

export function extractSafeMessageId(rawId: string): string {
  // WhatsApp DOM data-id format: "<true|false>_<jid>_<stanzaId>"
  // Keep direction prefix + stanza hash/id, avoid exposing full phone numbers in diagnostic views.
  const trimmed = rawId.trim();
  if (!trimmed) return '';
  return trimmed;
}
