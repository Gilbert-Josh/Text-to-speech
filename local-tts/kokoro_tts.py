import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro import KPipeline

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

pipeline = KPipeline(lang_code="a")

audio_parts = []
for _, _, audio in pipeline(input_text, voice=voice_id):
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
