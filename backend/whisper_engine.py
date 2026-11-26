"""Lokale Whisper-Small-Inferenz-Engine (faster-whisper / CTranslate2) mit GPU->CPU Fallback."""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from typing import Any, Callable, Optional

MODEL_NAME = "Systran/faster-whisper-small"

logger = logging.getLogger("wa_local_ai.whisper")


@dataclass(frozen=True)
class HardwareCapabilities:
    cuda_available: bool
    gpu_name: Optional[str]
    preferred_device: str
    preferred_compute_type: str


@dataclass(frozen=True)
class TranscriptionResult:
    transcript: str
    language: str
    language_probability: float
    duration: float
    device: str
    compute_type: str
    model: str


def detect_hardware_capabilities() -> HardwareCapabilities:
    """Erkennt lokal verfügbare NVIDIA-CUDA-GPU (z. B. RTX 4070) oder fällt auf CPU/INT8 zurück."""
    try:
        import ctranslate2  # type: ignore

        cuda_count = ctranslate2.get_cuda_device_count()
        if cuda_count > 0:
            gpu_name: Optional[str] = "NVIDIA CUDA GPU"
            try:
                import subprocess

                res = subprocess.run(
                    ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
                    capture_output=True,
                    text=True,
                    timeout=2,
                    check=False,
                )
                if res.returncode == 0 and res.stdout.strip():
                    gpu_name = res.stdout.strip().splitlines()[0].strip()
            except Exception:
                pass
            return HardwareCapabilities(
                cuda_available=True,
                gpu_name=gpu_name,
                preferred_device="cuda",
                preferred_compute_type="float16",
            )
    except Exception:
        pass

    return HardwareCapabilities(
        cuda_available=False,
        gpu_name=None,
        preferred_device="cpu",
        preferred_compute_type="int8",
    )


class WhisperSmallEngine:
    """
    Kapselt Systran/faster-whisper-small mit hoher Erkennungsqualität für Deutsch
    und automatischem GPU->CPU Fallback bei Treiber- oder VRAM-Fehlern.
    """

    def __init__(
        self,
        model_name: str = MODEL_NAME,
        model_factory: Optional[Callable[[str, str, str], Any]] = None,
        hardware_detector: Callable[[], HardwareCapabilities] = detect_hardware_capabilities,
    ) -> None:
        self.model_name = model_name
        self._model_factory = model_factory or self._default_model_factory
        self._hardware_detector = hardware_detector
        self._lock = threading.Lock()
        self._model: Any = None
        self._active_device = "uninitialized"
        self._active_compute_type = "uninitialized"
        self._capabilities: Optional[HardwareCapabilities] = None

    @staticmethod
    def _default_model_factory(model_name: str, device: str, compute_type: str) -> Any:
        from faster_whisper import WhisperModel  # type: ignore

        return WhisperModel(model_name, device=device, compute_type=compute_type)

    def ensure_loaded(self) -> None:
        with self._lock:
            if self._model is not None:
                return
            caps = self._hardware_detector()
            self._capabilities = caps

            if caps.cuda_available:
                try:
                    self._model = self._model_factory(
                        self.model_name, "cuda", "float16"
                    )
                    self._active_device = "cuda"
                    self._active_compute_type = "float16"
                    logger.info("Whisper Small auf CUDA/FP16 geladen (%s).", caps.gpu_name)
                    return
                except Exception as exc:
                    logger.warning(
                        "CUDA/FP16-Initialisierung fehlgeschlagen (%s). Wechsle auf CPU/INT8.",
                        exc,
                    )

            self._model = self._model_factory(self.model_name, "cpu", "int8")
            self._active_device = "cpu"
            self._active_compute_type = "int8"
            logger.info("Whisper Small auf CPU/INT8 geladen.")

    def _fallback_to_cpu(self) -> None:
        with self._lock:
            self._model = self._model_factory(self.model_name, "cpu", "int8")
            self._active_device = "cpu"
            self._active_compute_type = "int8"

    def status(self) -> dict[str, Any]:
        caps = self._capabilities or self._hardware_detector()
        return {
            "model": self.model_name,
            "loaded": self._model is not None,
            "device": self._active_device if self._model is not None else caps.preferred_device,
            "compute_type": (
                self._active_compute_type
                if self._model is not None
                else caps.preferred_compute_type
            ),
            "cuda_available": caps.cuda_available,
            "gpu_name": caps.gpu_name,
        }

    def transcribe_file(self, wav_path: str, language: Optional[str] = None) -> TranscriptionResult:
        self.ensure_loaded()
        lang_arg = None if (not language or language == "auto") else language

        def _run() -> TranscriptionResult:
            # Qualitätskonfiguration gemäß Spezifikation:
            # Beam Size 5, Temperature 0, konservativer VAD-Filter ohne Abschneiden von Silben.
            segments, info = self._model.transcribe(
                wav_path,
                language=lang_arg,
                task="transcribe",
                beam_size=5,
                temperature=0.0,
                vad_filter=True,
                vad_parameters={
                    "min_speech_duration_ms": 150,
                    "min_silence_duration_ms": 700,
                    "speech_pad_ms": 350,
                },
                condition_on_previous_text=True,
            )
            text_parts = [seg.text.strip() for seg in segments if getattr(seg, "text", "").strip()]
            transcript = " ".join(text_parts).strip()
            return TranscriptionResult(
                transcript=transcript,
                language=getattr(info, "language", lang_arg or "de"),
                language_probability=float(getattr(info, "language_probability", 1.0)),
                duration=float(getattr(info, "duration", 0.0)),
                device=self._active_device,
                compute_type=self._active_compute_type,
                model=self.model_name,
            )

        try:
            with self._lock:
                return _run()
        except Exception as exc:
            if self._active_device == "cuda":
                logger.warning(
                    "CUDA-Inferenzfehler (%s). Automatischer Fallback auf CPU/INT8.", exc
                )
                self._fallback_to_cpu()
                with self._lock:
                    return _run()
            raise
