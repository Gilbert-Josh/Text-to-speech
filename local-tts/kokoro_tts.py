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


def load_pipeline():
    model_dir = os.environ.get("KOKORO_MODEL_DIR")

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
        ).to("cpu").eval()

        return KPipeline(
            lang_code="a",
            repo_id="hexgrad/Kokoro-82M",
            model=model,
        )

    # Development fallback: use the normal Hugging Face cache.
    return KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")


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
