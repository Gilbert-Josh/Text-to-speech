import contextlib
import json
import os
import sys
import tempfile
from pathlib import Path

# eSpeak NG is installed in the standard Windows location by the official MSI.
# Add it to this worker's PATH so the app does not depend on the terminal's PATH.
if sys.platform == "win32":
    espeak_path = os.environ.get("KOKORO_ESPEAK_PATH", r"C:\Program Files\eSpeak NG")
    if os.path.isdir(espeak_path):
        os.environ["PATH"] = espeak_path + os.pathsep + os.environ.get("PATH", "")


import numpy as np
import soundfile as sf
from kokoro import KPipeline
from kokoro.model import KModel

VOICE_MAP = {
    "alloy": "af_heart",
    "ash": "am_adam",
    "ballad": "bf_emma",
    "coral": "af_bella",
    "echo": "am_michael",
    "fable": "bf_isabella",
    "nova": "af_nicole",
    "onyx": "am_puck",
    "sage": "bf_alice",
    "shimmer": "af_sarah",
}

STYLE_PREFIXES = {
    "natural": "",
    "cheerfully": "Speak cheerfully with warm enthusiasm: ",
    "energetic": "Speak with high energy and enthusiasm: ",
    "storyteller": "Narrate dramatically like an audiobook storyteller: ",
    "authoritative": "Deliver with a confident, authoritative tone: ",
    "calm": "Speak calmly and gently: ",
    "whisper": "Speak softly and intimately: ",
    "news-anchor": "Read in a clear broadcast-news style: ",
}


def select_device():
    """Select the fastest stable PyTorch device available on this machine."""
    import time
    import torch

    requested = os.environ.get("KOKORO_DEVICE", "auto").strip().lower()
    if requested == "cpu":
        return torch.device("cpu"), "cpu", "forced CPU"

    cuda_available = bool(torch.cuda.is_available())
    if requested == "cuda" and not cuda_available:
        print("CUDA was requested but PyTorch reports no CUDA device; falling back to CPU.", file=sys.stderr, flush=True)
        return torch.device("cpu"), "cpu", "CUDA unavailable"

    if not cuda_available:
        return torch.device("cpu"), "cpu", "CUDA unavailable"

    try:
        # Small warm benchmark: compare the actual PyTorch compute backends before
        # loading the much larger Kokoro model. This avoids assuming every user's
        # GPU is faster than their CPU.
        size = 768
        cpu_a = torch.randn((size, size), device="cpu")
        cpu_b = torch.randn((size, size), device="cpu")
        start = time.perf_counter()
        for _ in range(3):
            torch.mm(cpu_a, cpu_b)
        cpu_seconds = time.perf_counter() - start

        gpu_a = torch.randn((size, size), device="cuda")
        gpu_b = torch.randn((size, size), device="cuda")
        torch.cuda.synchronize()
        start = time.perf_counter()
        for _ in range(3):
            torch.mm(gpu_a, gpu_b)
        torch.cuda.synchronize()
        gpu_seconds = time.perf_counter() - start

        del cpu_a, cpu_b, gpu_a, gpu_b
        torch.cuda.empty_cache()

        # Keep a modest margin so a noisy micro-benchmark does not switch to GPU
        # for a negligible difference.
        if gpu_seconds < cpu_seconds * 0.90:
            gpu_name = torch.cuda.get_device_name(0)
            return torch.device("cuda"), "cuda", f"{gpu_name}; benchmark GPU {gpu_seconds:.3f}s vs CPU {cpu_seconds:.3f}s"

        return torch.device("cpu"), "cpu", f"benchmark CPU {cpu_seconds:.3f}s vs GPU {gpu_seconds:.3f}s"
    except Exception as error:
        print(f"GPU detection/benchmark failed: {error}", file=sys.stderr, flush=True)
        return torch.device("cpu"), "cpu", "GPU benchmark failed"


def load_pipeline():
    model_dir = os.environ.get("KOKORO_MODEL_DIR")
    device, device_name, reason = select_device()
    print(f"Kokoro device: {device_name} ({reason})", file=sys.stderr, flush=True)

    if model_dir:
        model_root = Path(model_dir)
        config_path = model_root / "config.json"
        weights_path = model_root / "kokoro-v1_0.pth"

        if not config_path.is_file():
            raise FileNotFoundError(f"Kokoro config not found: {config_path}")
        if not weights_path.is_file():
            raise FileNotFoundError(f"Kokoro model weights not found: {weights_path}")

        model = KModel(
            repo_id="hexgrad/Kokoro-82M",
            config=str(config_path),
            model=str(weights_path),
        ).to(device).eval()

        return KPipeline(
            lang_code="a",
            repo_id="hexgrad/Kokoro-82M",
            model=model,
        )

    # Development fallback: use the normal Hugging Face cache.
    model = KModel(repo_id="hexgrad/Kokoro-82M").to(device).eval()
    return KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M", model=model)


def synthesize(pipeline, text, voice, style):
    voice_id = VOICE_MAP.get(str(voice).lower(), "af_heart")
    prefix = STYLE_PREFIXES.get(str(style), "")
    input_text = f"{prefix}{str(text).strip()}"

    if not input_text.strip():
        raise ValueError("No text supplied.")

    model_dir = os.environ.get("KOKORO_MODEL_DIR")
    voice_path = None

    if model_dir:
        voice_path = Path(model_dir) / "voices" / f"{voice_id}.pt"
        if not voice_path.is_file():
            raise FileNotFoundError(f"Kokoro voice file not found: {voice_path}")

    audio_parts = []

    # Keep stdout machine-readable. Kokoro/dependency warnings go to stderr.
    with contextlib.redirect_stdout(sys.stderr):
        generator = (
            pipeline(input_text, voice=str(voice_path))
            if voice_path
            else pipeline(input_text, voice=voice_id)
        )

        for _, _, audio in generator:
            audio_parts.append(audio)

    if not audio_parts:
        raise RuntimeError("Kokoro returned no audio.")

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        output = Path(tmp.name)

    try:
        audio = np.concatenate(audio_parts)
        sf.write(output, audio, 24000, subtype="PCM_16")
        return str(output)
    except Exception:
        output.unlink(missing_ok=True)
        raise


def run_persistent_worker():
    # Load the model ONCE and keep it resident for all subsequent requests.
    with contextlib.redirect_stdout(sys.stderr):
        pipeline = load_pipeline()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
            output_path = synthesize(
                pipeline,
                request.get("text", ""),
                request.get("voice", "alloy"),
                request.get("style", "natural"),
            )
            response = {"ok": True, "path": output_path}
        except Exception as error:
            print(f"Kokoro persistent worker error: {error}", file=sys.stderr, flush=True)
            response = {"ok": False, "error": str(error)}

        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()


def run_single_request():
    voice = sys.argv[1] if len(sys.argv) > 1 else "alloy"
    style = sys.argv[2] if len(sys.argv) > 2 else "natural"
    text = sys.stdin.read()

    with contextlib.redirect_stdout(sys.stderr):
        pipeline = load_pipeline()

    output_path = synthesize(pipeline, text, voice, style)
    sys.stdout.write(output_path)
    sys.stdout.flush()


if os.environ.get("KOKORO_PERSISTENT") == "1":
    run_persistent_worker()
else:
    run_single_request()
