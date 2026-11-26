"""Lokaler HTTP-Transkriptionsdienst (ausschließlich 127.0.0.1:8765) für WhatsApp Local AI Transcriber."""

from __future__ import annotations

import hmac
import os
import re
import secrets
from pathlib import Path
from typing import Optional

from audio_processor import (
    MAX_AUDIO_BYTES,
    cleanup_temp_file,
    decode_to_temp_wav,
    validate_audio_bytes,
)
from whisper_engine import MODEL_NAME, WhisperSmallEngine

SERVER_VERSION = "1.0.0"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
ALLOWED_LANGUAGE_RE = re.compile(r"^[a-z]{2,3}$")


def get_default_token_path() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "WhatsAppLocalAITranscriber" / "auth.token"
    return Path.home() / ".config" / "whatsapp-local-ai-transcriber" / "auth.token"


def load_or_create_auth_token(token_path: Optional[Path] = None) -> str:
    env_token = os.environ.get("WA_TRANSCRIBER_TOKEN", "").strip()
    if env_token:
        return env_token

    path = token_path or get_default_token_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        existing = path.read_text(encoding="utf-8").strip()
        if existing:
            return existing

    token = secrets.token_urlsafe(32)
    path.write_text(token, encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return token


def is_allowed_origin(origin: Optional[str]) -> bool:
    """
    Erlaubt ausschließlich Browser-Extension-Origins (Chrome/Edge) oder direkte
    Service-Worker-Requests ohne Origin-Header (abgesichert über Client-Token).
    Webseiten (http://, https://) werden konsequent blockiert.
    """
    if origin is None or origin == "":
        return True
    lower = origin.lower().strip()
    return lower.startswith("chrome-extension://") or lower.startswith("extension://")


def is_allowed_host(host_header: Optional[str]) -> bool:
    """Schützt gegen DNS-Rebinding, indem ausschließlich Loopback-Hostnamen akzeptiert werden."""
    if not host_header:
        return True
    cleaned = host_header.strip().lower()
    if cleaned.startswith("[::1]"):
        return cleaned == "[::1]" or cleaned.startswith("[::1]:")
    hostname = cleaned.split(":", 1)[0]
    return hostname in ("127.0.0.1", "localhost")


def normalize_language(language: Optional[str]) -> str:
    """Validiert das Sprachfeld gegen 'auto' oder einen ISO-639-Code (2-3 Kleinbuchstaben)."""
    if not language:
        return "auto"
    cleaned = language.strip().lower()
    if cleaned == "auto":
        return "auto"
    if not ALLOWED_LANGUAGE_RE.match(cleaned):
        raise ValueError("Ungültiger Sprachparameter.")
    return cleaned


def verify_client_token(provided_token: Optional[str], expected_token: str) -> bool:
    if not provided_token or not expected_token:
        return False
    clean = provided_token.strip()
    if clean.lower().startswith("bearer "):
        clean = clean[7:].strip()
    return hmac.compare_digest(clean.encode("utf-8"), expected_token.encode("utf-8"))


def assert_loopback_host(host: str) -> None:
    if host not in ("127.0.0.1", "localhost"):
        raise ValueError(
            f"Sicherheitsverstoß: Bindung an '{host}' verboten. Ausschließlich 127.0.0.1 zulässig."
        )


async def read_bounded_upload(upload_file, max_bytes: int = MAX_AUDIO_BYTES) -> bytes:
    """Liest hochgeladene Audiodaten in begrenzten Blöcken, um RAM-Erschöpfung zu verhindern."""
    chunks: list[bytes] = []
    total = 0
    chunk_size = 1024 * 1024  # 1 MB
    while True:
        chunk = await upload_file.read(chunk_size)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise OverflowError("Audiodatei überschreitet das 50-MB-Limit.")
        chunks.append(chunk)
    return b"".join(chunks)


def create_app(
    engine: Optional[WhisperSmallEngine] = None,
    auth_token: Optional[str] = None,
):
    from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse

    expected_token = auth_token or load_or_create_auth_token()
    whisper = engine or WhisperSmallEngine(model_name=MODEL_NAME)

    app = FastAPI(
        title="WhatsApp Business Local AI Transcriber Server",
        version=SERVER_VERSION,
        docs_url=None,
        redoc_url=None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^(chrome-extension|extension)://.*$",
        allow_methods=["GET", "POST"],
        allow_headers=["X-Transcriber-Token", "Authorization", "Content-Type"],
    )

    @app.middleware("http")
    async def guard_origin_and_loopback(request: Request, call_next):
        origin = request.headers.get("origin")
        if not is_allowed_origin(origin):
            return JSONResponse(
                status_code=403,
                content={"detail": "Origin nicht autorisiert."},
            )
        host_header = request.headers.get("host")
        if not is_allowed_host(host_header):
            return JSONResponse(
                status_code=403,
                content={"detail": "Host-Header nicht autorisiert."},
            )
        return await call_next(request)

    @app.get("/health")
    def health(
        x_transcriber_token: Optional[str] = Header(default=None),
        authorization: Optional[str] = Header(default=None),
    ):
        provided = x_transcriber_token or authorization
        if not verify_client_token(provided, expected_token):
            raise HTTPException(status_code=401, detail="Ungültiges Client-Token.")

        st = whisper.status()
        return {
            "status": "ok",
            "version": SERVER_VERSION,
            "model": st["model"],
            "loaded": st["loaded"],
            "device": st["device"],
            "compute_type": st["compute_type"],
            "cuda_available": st["cuda_available"],
            "gpu_name": st["gpu_name"],
        }

    @app.post("/transcribe")
    async def transcribe(
        audio: UploadFile = File(...),
        audio_sha256: Optional[str] = Form(default=None),
        language: Optional[str] = Form(default="auto"),
        x_transcriber_token: Optional[str] = Header(default=None),
        authorization: Optional[str] = Header(default=None),
    ):
        provided = x_transcriber_token or authorization
        if not verify_client_token(provided, expected_token):
            raise HTTPException(status_code=401, detail="Ungültiges Client-Token.")

        raw_bytes: Optional[bytes] = None
        wav_path: Optional[str] = None
        try:
            clean_language = normalize_language(language)
            raw_bytes = await read_bounded_upload(audio, MAX_AUDIO_BYTES)
            info = validate_audio_bytes(raw_bytes, expected_sha256=audio_sha256)
            wav_path = decode_to_temp_wav(raw_bytes, info.detected_format)
            result = whisper.transcribe_file(wav_path, language=clean_language)
            return {
                "transcript": result.transcript,
                "language": result.language,
                "language_probability": result.language_probability,
                "duration": result.duration,
                "audio_sha256": info.sha256_hex,
                "format": info.detected_format,
                "device": result.device,
                "compute_type": result.compute_type,
                "model": result.model,
            }
        except OverflowError as exc:
            raise HTTPException(status_code=413, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        finally:
            cleanup_temp_file(wav_path)
            raw_bytes = None

    return app


def main() -> None:
    import uvicorn  # type: ignore

    host = os.environ.get("WA_TRANSCRIBER_HOST", DEFAULT_HOST)
    port = int(os.environ.get("WA_TRANSCRIBER_PORT", str(DEFAULT_PORT)))
    assert_loopback_host(host)

    token = load_or_create_auth_token()
    app = create_app(auth_token=token)
    print(f"[WA Local AI] Server startet ausschließlich auf http://{host}:{port}")
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
