# Local Kokoro TTS

The app uses Kokoro-82M for local speech synthesis.

## Windows development prerequisite

Kokoro uses eSpeak NG for phonemization. Install the official Windows MSI:

https://github.com/espeak-ng/espeak-ng/releases/download/1.52.0/espeak-ng.msi

The application worker automatically adds the standard installation directory to PATH.

## Test the worker

From the project root, activate the dedicated Python 3.12 environment and pipe text into the worker:

```powershell
"Hello, this is a local Kokoro test." | .\.kokoro-venv\Scripts\python.exe local-tts\kokoro_tts.py alloy natural
```

The worker prints the generated WAV path to stdout.

## Build the Windows installer

The repository includes a PowerShell build script that packages:

- React + Express application
- Electron desktop shell
- standalone Kokoro worker
- Kokoro model and voice files
- eSpeak NG

Run from the project root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-windows-installer.ps1
```

The installer is created at:

`release\Text-to-Speech-Studio-Setup.exe`

The build machine needs the development prerequisites installed first. End users do not need Python, Node.js, Kokoro, or eSpeak NG installed separately.
