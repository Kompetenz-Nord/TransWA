# Security Summary

**Reviewed Files**: 26
**Issues Resolved**: 6

### Issues Resolved
| Area | File | Line | What Was Happening | Impact | Status | How It Was Fixed |
|---|---|---|---|---|---|---|
| Path & Encoding Handling | `vite.config.ts` | 34 | `decodeURIComponent` on `/downloads/*` URLs was unguarded against malformed percent-encoding, and path containment relied only on substring checks. | Medium | Fixed | Wrapped `decodeURIComponent` in `try/catch` (returning `400 Bad request`) and added `path.resolve(downloadsDir, cleanRel).startsWith(downloadsDir + path.sep)` (`403 Forbidden`). |
| Unbounded Upload Buffering | `backend/server.py` | 105 | `/transcribe` buffered the entire uploaded audio stream via `await audio.read()` into memory before checking the 50 MB limit. | High | Fixed | Added `read_bounded_upload()` to stream in 1 MB chunks and abort with `HTTP 413` as soon as cumulative bytes exceed `MAX_AUDIO_BYTES`. |
| DNS Rebinding Exposure | `backend/server.py` | 66 | Local HTTP middleware checked the `Origin` header but did not validate the `Host` header against loopback addresses. | Medium | Fixed | Added `is_allowed_host()` middleware validation rejecting non-loopback `Host` headers (`127.0.0.1`, `localhost`, `[::1]`) with `HTTP 403`. |
| Language Parameter Validation | `backend/server.py` | 77 | The optional `language` form field was passed into the transcription engine without format validation. | Low | Fixed | Added `normalize_language()` enforcing `'auto'` or strict 2–3 lowercase letter ISO-639 codes (`^[a-z]{2,3}$`), returning `HTTP 400` otherwise. |
| Async Enqueue Race Condition | `extension/src/shared/queue.ts` | 74 | Concurrent `enqueue()` calls for the same `messageId` could both pass the initial check while awaiting `cache.getByMessageId()`, causing duplicate Whisper jobs. | Medium | Fixed | Added a synchronous `enqueuingPromises` deduplication map before any `await`, alongside defensive Base64/sender checks in `extension/src/background/service-worker.ts` (lines 165–232). |
| Large Audio Base64 Conversion | `extension/src/content/content-script.ts` | 131 | Chunk size `0x8000` (32,768 args) in `String.fromCharCode(...chunk)` came close to V8 call-stack argument limits on some Chromium builds. | Low | Fixed | Reduced chunk size to `0x2000` (8,192 bytes per slice) for reliable encoding of larger voice messages. |

### Safeguards Verified
| Area | File | How It's Protected |
|---|---|---|
| Loopback-Only Inference Server | `backend/server.py` | Server startup enforces `assert_loopback_host()` (`127.0.0.1` / `localhost` only), rejects non-extension `Origin` headers, and authenticates `/health` and `/transcribe` using `hmac.compare_digest()` against a per-user `auth.token`. |
| Ephemeral Key Policy | `extension/src/injected/whatsapp-internal-media-adapter.ts` | Decryption `mediaKey` values are normalized ephemerally for immediate in-session WhatsApp media download/decryption and are never written to `chrome.storage` or included in diagnostics. |
| Cross-World Bridge Validation | `extension/src/shared/bridge-protocol.ts` | `MAIN` ↔ `ISOLATED` world `window.postMessage` traffic validates `event.source === window`, `event.origin === window.location.origin`, and namespace markers, rejecting malformed or oversized payloads. |
| Magic-Byte & Integrity Verification | `backend/audio_processor.py` | Uploaded bytes are verified against expected SHA-256 checksums and magic headers (`OggS`, RIFF/WAVE, FLAC, MP3, MP4/M4A, WebM) before spawning FFmpeg (`shell=False`) with isolated temp-file cleanup. |
| Safe UI & Bundle Integrity | `src/` & `scripts/package-release.mjs` | React renders transcripts and status text without raw HTML injection; release ZIP archives include deterministic SHA-256 manifests (`SHA256SUMS.txt`). |

## PoC Verification

### 1. Path & Encoding Guard in Dev Download Middleware
#### Summary
| Field | Value |
|---|---|
| Issue Type | Malformed URL Decoding & Path Boundary Enforcement |
| Impact | Medium |
| Affected File | `vite.config.ts:33-50` |
| Test Scenario | Requests to `/downloads/%E0%A4%A` and `/downloads/..%2Fpackage.json` |

#### How It Was Fixed
`decodeURIComponent` is now wrapped in a `try/catch` block returning `400 Bad request`, and normalized filenames are checked with both segment validation and `path.resolve(downloadsDir, cleanRel).startsWith(downloadsDir + path.sep)` before opening a file stream.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Malformed request `/downloads/%E0%A4%A` reaches `/downloads` middleware at `vite.config.ts:34` | `decodeURIComponent` throws `URIError` |
| 2 | `catch` block executes at `vite.config.ts:35-38` | Responds `400 Bad request` without crashing Vite dev server |
| 3 | Traversal attempt `/downloads/..%2Fpackage.json` is decoded to `../package.json` and hits `vite.config.ts:40-49` | Blocked by `..` / `/` check (`404`) and `path.resolve(...).startsWith(downloadsDir + path.sep)` (`403`) |

#### Conclusion
**Fix Verified** — Malformed percent-encodings and parent-directory traversal paths cannot crash the middleware or read files outside `public/downloads`.

---

### 2. Bounded Streaming Upload & Host/Language Validation on Local Whisper Server
#### Summary
| Field | Value |
|---|---|
| Issue Type | Unbounded Memory Upload & DNS Rebinding / Unvalidated Form Input |
| Impact | High |
| Affected File | `backend/server.py:66-119`, `backend/server.py:154-217` |
| Test Scenario | `Host: evil.attacker:8765`, `language: "../../etc/passwd"`, and a 51 MB streaming upload to `POST /transcribe` |

#### How It Was Fixed
Added `is_allowed_host()` inside `guard_origin_and_loopback`, `normalize_language()` before decoding audio, and `read_bounded_upload()` reading in 1 MB chunks up to `MAX_AUDIO_BYTES` (50 MB).

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Request with `Host: evil.attacker:8765` hits `guard_origin_and_loopback` at `backend/server.py:154-159` | Rejected with `HTTP 403` before reaching route handlers |
| 2 | Valid loopback request with `language="../../etc/passwd"` reaches `normalize_language()` at `backend/server.py:77-86, 198` | Raises `ValueError` caught as `HTTP 400` |
| 3 | Authenticated upload exceeding 50 MB enters `read_bounded_upload()` at `backend/server.py:105-118` | Raises `OverflowError` on the chunk crossing 50 MB and returns `HTTP 413` |

#### Conclusion
**Fix Verified** — Verified by automated unit tests (`test_host_header_blocks_dns_rebinding`, `test_language_validation_blocks_injection_or_invalid_codes`, `test_bounded_upload_rejects_oversized_streams` in `backend/tests/test_backend.py`).

---

### 3. Concurrent Enqueue Deduplication & Extension Boundary Checks
#### Summary
| Field | Value |
|---|---|
| Issue Type | Async Race Condition & Extension Message Validation |
| Impact | Medium |
| Affected File | `extension/src/shared/queue.ts:74-91`, `extension/src/background/service-worker.ts:165-173, 229-232` |
| Test Scenario | Two simultaneous `queue.enqueue('msg-race-1', 'incoming')` calls while `cache.getByMessageId` awaits I/O |

#### How It Was Fixed
Added synchronous `enqueuingPromises` tracking prior to awaiting storage lookups in `TranscriptionQueue.enqueue()`, paired with `sender?.id !== chrome.runtime.id` filtering and `atob()` error handling in `service-worker.ts`.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | First `enqueue('msg-race-1', 'incoming')` stores the pending promise synchronously in `enqueuingPromises` (`extension/src/shared/queue.ts:84-89`) | In-flight promise registered before any `await` |
| 2 | Concurrent second `enqueue('msg-race-1', 'incoming')` finds `inFlight` at `extension/src/shared/queue.ts:80-81` | Returns the identical promise immediately without queueing a duplicate job |
| 3 | External or malformed runtime messages reach `service-worker.ts:230` or `service-worker.ts:170` | Ignored if `sender.id` does not match the extension, or safely rejected if Base64 decoding fails |

#### Conclusion
**Fix Verified** — Verified by unit test `'TranscriptionQueue deduplicates concurrent enqueue calls during slow async cache lookup'` in `extension/tests/queue-and-cache.test.ts`.
