import contextlib
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

voice = sys.argv[1] if len(sys.argv) > 1 else "alloy"
style = sys.argv[2] if len(sys.argv) > 2 else "natural"
text = sys.stdin.read()

if not text.strip():
    raise SystemExit("No text supplied.")

voice_id = VOICE_MAP.get(voice.lower(), "af_heart")
prefix = STYLE_PREFIXES.get(style, "")
input_text = f"{prefix}{text.strip()}"

# Keep stdout machine-readable: the Node server expects only the WAV path there.
# Kokoro/dependency warnings are redirected to stderr so they cannot corrupt it.
model_dir = os.environ.get("KOKORO_MODEL_DIR")
if model_dir:
    model_root = Path(model_dir)
else:
    model_root = Path(__file__).resolve().parent / "model"

config_path = model_root / "config.json"
weights_path = model_root / "kokoro-v1_0.pth"
voice_path = model_root / "voices" / f"{voice_id}.pt"

if not config_path.is_file():
    raise FileNotFoundError(f"Kokoro config not found: {config_path}")
if not weights_path.is_file():
    raise FileNotFoundError(f"Kokoro model weights not found: {weights_path}")
if not voice_path.is_file():
    raise FileNotFoundError(f"Kokoro voice file not found: {voice_path}")

audio_parts = []
with contextlib.redirect_stdout(sys.stderr):
    model = KModel(
        repo_id="hexgrad/Kokoro-82M",
        config=str(config_path),
        model=str(weights_path),
    ).to("cpu").eval()
    pipeline = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M", model=model)
    for _, _, audio in pipeline(input_text, voice=str(voice_path)):
        audio_parts.append(audio)

if not audio_parts:
    raise RuntimeError("Kokoro returned no audio.")

with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
    output = Path(tmp.name)

try:
    audio = np.concatenate(audio_parts)
    sf.write(output, audio, 24000, subtype="PCM_16")
    sys.stdout.write(str(output))
    sys.stdout.flush()
except Exception:
    output.unlink(missing_ok=True)
    raise
