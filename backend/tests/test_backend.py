import hashlib
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import audio_processor  # noqa: E402
import server  # noqa: E402
import whisper_engine  # noqa: E402


class AudioProcessorTests(unittest.TestCase):
    def test_detects_ogg_opus_and_wav_and_mp3_and_m4a(self):
        self.assertEqual(audio_processor.detect_audio_format(b"OggS" + b"\x00" * 60), "ogg")
        self.assertEqual(audio_processor.detect_audio_format(b"RIFF\x00\x00\x00\x00WAVE" + b"\x00" * 40), "wav")
        self.assertEqual(audio_processor.detect_audio_format(b"ID3" + b"\x00" * 50), "mp3")
        self.assertEqual(audio_processor.detect_audio_format(b"\x00\x00\x00\x20ftypM4A " + b"\x00" * 40), "m4a")

    def test_rejects_empty_or_corrupt_audio(self):
        with self.assertRaises(ValueError):
            audio_processor.detect_audio_format(b"")
        with self.assertRaises(ValueError):
            audio_processor.detect_audio_format(b"CORRUPT_HEADER_" + b"\x00" * 50)

    def test_sha256_verification(self):
        payload = b"OggS" + b"A" * 64
        digest = hashlib.sha256(payload).hexdigest()
        info = audio_processor.validate_audio_bytes(payload, expected_sha256=digest)
        self.assertEqual(info.detected_format, "ogg")
        self.assertEqual(info.sha256_hex, digest)

        with self.assertRaises(ValueError):
            audio_processor.validate_audio_bytes(payload, expected_sha256="0" * 64)

    def test_cleanup_temp_file_removes_file(self):
        fd, tmp = tempfile.mkstemp()
        os.close(fd)
        self.assertTrue(os.path.exists(tmp))
        audio_processor.cleanup_temp_file(tmp)
        self.assertFalse(os.path.exists(tmp))


class WhisperEngineTests(unittest.TestCase):
    def test_quality_parameters_and_multilingual_long_segments(self):
        recorded_kwargs = {}

        class FakeModel:
            def transcribe(self, path, **kwargs):
                recorded_kwargs.update(kwargs)
                segments = [
                    SimpleNamespace(text="Guten Tag, hier ist die Rückmeldung zu Ihrem Auftrag."),
                    SimpleNamespace(text="Wir liefern die Unterlagen bis Freitag nach."),
                ]
                info = SimpleNamespace(language="de", language_probability=0.98, duration=142.5)
                return segments, info

        engine = whisper_engine.WhisperSmallEngine(
            model_factory=lambda name, dev, comp: FakeModel(),
            hardware_detector=lambda: whisper_engine.HardwareCapabilities(
                cuda_available=True,
                gpu_name="NVIDIA GeForce RTX 4070",
                preferred_device="cuda",
                preferred_compute_type="float16",
            ),
        )

        res = engine.transcribe_file("dummy.wav", language="auto")
        self.assertEqual(res.model, "Systran/faster-whisper-small")
        self.assertEqual(res.device, "cuda")
        self.assertEqual(res.compute_type, "float16")
        self.assertEqual(res.language, "de")
        self.assertIn("Guten Tag", res.transcript)
        self.assertIn("Freitag nach", res.transcript)
        self.assertEqual(recorded_kwargs["beam_size"], 5)
        self.assertEqual(recorded_kwargs["temperature"], 0.0)
        self.assertEqual(recorded_kwargs["vad_filter"], True)
        self.assertEqual(recorded_kwargs["task"], "transcribe")
        self.assertIsNone(recorded_kwargs["language"])

    def test_cuda_failure_falls_back_automatically_to_cpu_int8(self):
        attempts = []

        class FailingCudaModel:
            def transcribe(self, *args, **kwargs):
                raise RuntimeError("CUDA out of memory")

        class WorkingCpuModel:
            def transcribe(self, *args, **kwargs):
                return [SimpleNamespace(text="Hello from local CPU fallback.")], SimpleNamespace(
                    language="en", language_probability=0.95, duration=8.0
                )

        def factory(name, device, compute_type):
            attempts.append((device, compute_type))
            if device == "cuda":
                return FailingCudaModel()
            return WorkingCpuModel()

        engine = whisper_engine.WhisperSmallEngine(
            model_factory=factory,
            hardware_detector=lambda: whisper_engine.HardwareCapabilities(
                cuda_available=True,
                gpu_name="NVIDIA GeForce RTX 4070",
                preferred_device="cuda",
                preferred_compute_type="float16",
            ),
        )

        res = engine.transcribe_file("dummy.wav", language="auto")
        self.assertEqual(attempts, [("cuda", "float16"), ("cpu", "int8")])
        self.assertEqual(res.device, "cpu")
        self.assertEqual(res.compute_type, "int8")
        self.assertEqual(res.language, "en")
        self.assertEqual(res.transcript, "Hello from local CPU fallback.")


class ServerSecurityTests(unittest.TestCase):
    def test_loopback_host_enforcement(self):
        server.assert_loopback_host("127.0.0.1")
        server.assert_loopback_host("localhost")
        with self.assertRaises(ValueError):
            server.assert_loopback_host("0.0.0.0")
        with self.assertRaises(ValueError):
            server.assert_loopback_host("192.168.1.50")

    def test_origin_allows_only_extensions_and_blocks_websites(self):
        self.assertTrue(server.is_allowed_origin("chrome-extension://abcdefghijklmnop"))
        self.assertTrue(server.is_allowed_origin("extension://abcdefghijklmnop"))
        self.assertTrue(server.is_allowed_origin(None))
        self.assertFalse(server.is_allowed_origin("https://evil.example"))
        self.assertFalse(server.is_allowed_origin("http://localhost:3000"))

    def test_client_token_verification(self):
        expected = "local_secret_token_123456"
        self.assertTrue(server.verify_client_token(expected, expected))
        self.assertTrue(server.verify_client_token(f"Bearer {expected}", expected))
        self.assertFalse(server.verify_client_token("wrong", expected))
        self.assertFalse(server.verify_client_token("", expected))


if __name__ == "__main__":
    unittest.main()
