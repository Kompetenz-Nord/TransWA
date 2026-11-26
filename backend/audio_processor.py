"""Lokale Audio-Validierung, Formaterkennung und Dekodierung für WhatsApp-Sprachnachrichten."""

from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from typing import Optional

MAX_AUDIO_BYTES = 50 * 1024 * 1024  # 50 MB
MIN_AUDIO_BYTES = 32


@dataclass(frozen=True)
class ValidatedAudioInfo:
    detected_format: str
    sha256_hex: str
    byte_length: int
    needs_transcode: bool


def detect_audio_format(data: bytes) -> str:
    """Erkennt das Audioformat anhand von Magic-Bytes."""
    if len(data) < MIN_AUDIO_BYTES:
        raise ValueError("Audiodaten sind leer oder zu kurz.")
    if len(data) > MAX_AUDIO_BYTES:
        raise ValueError("Audiodatei überschreitet das 50-MB-Limit.")

    if data.startswith(b"OggS"):
        return "ogg"
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return "wav"
    if data.startswith(b"ID3") or (len(data) >= 2 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0):
        return "mp3"
    if len(data) >= 12 and data[4:8] == b"ftyp":
        return "m4a"
    if data.startswith(b"\x1a\x45\xdf\xa3"):
        return "webm"
    if data.startswith(b"fLaC"):
        return "flac"

    raise ValueError("Nicht unterstütztes oder beschädigtes Audioformat.")


def validate_audio_bytes(data: bytes, expected_sha256: Optional[str] = None) -> ValidatedAudioInfo:
    """Prüft Integrität, Format und optional den SHA-256-Hash."""
    fmt = detect_audio_format(data)
    digest = hashlib.sha256(data).hexdigest()

    if expected_sha256:
        normalized_expected = expected_sha256.strip().lower()
        if len(normalized_expected) != 64 or normalized_expected != digest:
            raise ValueError("SHA-256-Prüfsumme der Audiodatei stimmt nicht überein.")

    return ValidatedAudioInfo(
        detected_format=fmt,
        sha256_hex=digest,
        byte_length=len(data),
        needs_transcode=(fmt != "wav"),
    )


def decode_to_temp_wav(audio_bytes: bytes, source_format: str) -> str:
    """
    Schreibt dekodierte 16-kHz-Mono-WAV-Daten in eine temporäre Datei.
    Der Aufrufer muss diese Datei nach Verwendung via cleanup_temp_file() löschen.
    """
    fd_in, input_path = tempfile.mkstemp(prefix="wa_in_", suffix=f".{source_format}")
    fd_out, output_path = tempfile.mkstemp(prefix="wa_wav_", suffix=".wav")
    os.close(fd_in)
    os.close(fd_out)

    try:
        with open(input_path, "wb") as f:
            f.write(audio_bytes)

        if source_format == "wav":
            with open(output_path, "wb") as f_out:
                f_out.write(audio_bytes)
            return output_path

        # Primärer Dekodierpfad: PyAV (wird mit faster-whisper installiert, kein externes Binary nötig)
        try:
            import av  # type: ignore
            import wave

            with av.open(input_path) as container:
                audio_stream = next((s for s in container.streams if s.type == "audio"), None)
                if audio_stream is None:
                    raise ValueError("Kein Audiostream in der Datei gefunden.")

                resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
                with wave.open(output_path, "wb") as wav_file:
                    wav_file.setnchannels(1)
                    wav_file.setsampwidth(2)
                    wav_file.setframerate(16000)

                    for frame in container.decode(audio_stream):
                        resampled_frames = resampler.resample(frame)
                        if not isinstance(resampled_frames, list):
                            resampled_frames = [resampled_frames]
                        for rf in resampled_frames:
                            wav_file.writeframes(rf.to_ndarray().tobytes())
            return output_path
        except ImportError:
            pass

        # Sekundärer Dekodierpfad: lokales ffmpeg
        ffmpeg_bin = shutil.which("ffmpeg")
        if not ffmpeg_bin:
            raise RuntimeError(
                "Weder PyAV noch ffmpeg ist verfügbar, um OGG/Opus lokal zu dekodieren."
            )

        proc = subprocess.run(
            [
                ffmpeg_bin,
                "-y",
                "-v",
                "error",
                "-i",
                input_path,
                "-ac",
                "1",
                "-ar",
                "16000",
                "-f",
                "wav",
                output_path,
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            raise ValueError(f"Audio-Dekodierung fehlgeschlagen: {proc.stderr.strip()}")
        return output_path
    except Exception:
        cleanup_temp_file(output_path)
        raise
    finally:
        cleanup_temp_file(input_path)


def cleanup_temp_file(path: Optional[str]) -> None:
    """Löscht temporäre Audiodateien sicher."""
    if not path:
        return
    try:
        if os.path.exists(path):
            os.remove(path)
    except OSError:
        pass
