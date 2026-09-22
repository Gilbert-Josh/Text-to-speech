$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $ProjectRoot ".kokoro-venv\Scripts\python.exe"
$RuntimeRoot = Join-Path $ProjectRoot "packaging\runtime"
$WorkerDist = Join-Path $ProjectRoot "packaging\worker-dist"
$WorkerBuild = Join-Path $ProjectRoot "packaging\worker-build"
$EspeakSource = "C:\Program Files\eSpeak NG"
$ModelRoot = Join-Path $RuntimeRoot "model"

if (!(Test-Path $Python)) {
  throw "Kokoro Python environment not found at $Python. Create .kokoro-venv with Python 3.12 first."
}

if (!(Test-Path (Join-Path $EspeakSource "espeak-ng.exe"))) {
  throw "eSpeak NG was not found at $EspeakSource. Install the official Windows MSI first."
}

Write-Host "Preparing packaged Kokoro runtime..." -ForegroundColor Cyan
Remove-Item -Recurse -Force $RuntimeRoot, $WorkerDist, $WorkerBuild -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $RuntimeRoot, $WorkerDist, $WorkerBuild, $ModelRoot | Out-Null

Write-Host "Downloading the Kokoro model and voice files into the installer..." -ForegroundColor Cyan

$DownloadScript = Join-Path $WorkerBuild "download_kokoro_model.py"

@'
from pathlib import Path
from huggingface_hub import hf_hub_download

repo_id = "hexgrad/Kokoro-82M"
model_dir = Path(__import__("os").environ["KOKORO_BUILD_MODEL_DIR"])

model_dir.mkdir(parents=True, exist_ok=True)
(model_dir / "voices").mkdir(parents=True, exist_ok=True)

files = [
    "config.json",
    "kokoro-v1_0.pth",
    "voices/af_bella.pt",
    "voices/af_heart.pt",
    "voices/af_nicole.pt",
    "voices/af_sarah.pt",
    "voices/am_adam.pt",
    "voices/am_michael.pt",
    "voices/am_puck.pt",
    "voices/bf_alice.pt",
    "voices/bf_emma.pt",
    "voices/bf_isabella.pt",
]

for filename in files:
    print(f"Downloading {filename}...")
    hf_hub_download(
        repo_id=repo_id,
        filename=filename,
        local_dir=str(model_dir),
    )

print("Kokoro model download complete.")
'@ | Set-Content -Path $DownloadScript -Encoding UTF8

$env:KOKORO_BUILD_MODEL_DIR = $ModelRoot
& $Python $DownloadScript
if ($LASTEXITCODE -ne 0) { throw "Kokoro model download failed." }

Remove-Item -Force $DownloadScript -ErrorAction SilentlyContinue
Remove-Item Env:KOKORO_BUILD_MODEL_DIR -ErrorAction SilentlyContinue

Write-Host "Installing PyInstaller into the Kokoro build environment..." -ForegroundColor Cyan
& $Python -m pip install --upgrade pyinstaller
if ($LASTEXITCODE -ne 0) { throw "PyInstaller installation failed." }

Write-Host "Building the standalone Kokoro worker..." -ForegroundColor Cyan
$PyInstallerArgs = @(
  "-m", "PyInstaller",
  "--clean",
  "--noconfirm",
  "--onefile",
  "--name", "kokoro_tts",
  "--distpath", $WorkerDist,
  "--workpath", $WorkerBuild,
  "--collect-all", "kokoro",
  "--collect-all", "misaki",
  "--collect-all", "spacy",
  "--collect-all", "en_core_web_sm",
  "--collect-all", "transformers",
  "--collect-all", "huggingface_hub",
  "--collect-all", "language_tags",
  "--collect-all", "csvw",
  "--collect-all", "segments",
  "--collect-all", "soundfile",
  "--collect-all", "torch",
  (Join-Path $ProjectRoot "local-tts\kokoro_tts.py")
)
& $Python @PyInstallerArgs
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed." }

Copy-Item -Force (Join-Path $WorkerDist "kokoro_tts.exe") (Join-Path $RuntimeRoot "kokoro_tts.exe")

$PackagedWorker = Join-Path $RuntimeRoot "kokoro_tts.exe"
if (!(Test-Path $PackagedWorker)) {
  throw "Kokoro worker was not created at $PackagedWorker."
}
if ((Get-Item $PackagedWorker).Length -lt 1000000) {
  throw "Kokoro worker appears invalid or incomplete: $PackagedWorker"
}

Write-Host "Bundling eSpeak NG..." -ForegroundColor Cyan
Copy-Item -Recurse -Force $EspeakSource (Join-Path $RuntimeRoot "espeak-ng")

Write-Host "Building the React + Express application..." -ForegroundColor Cyan
Push-Location $ProjectRoot
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Web application build failed." }

  Write-Host "Building Text-to-Speech-Studio-Setup.exe..." -ForegroundColor Cyan
  npx electron-builder --win nsis
  if ($LASTEXITCODE -ne 0) { throw "Electron installer build failed." }

  $UnpackedWorker = Join-Path $ProjectRoot "release\win-unpacked\resources\kokoro-runtime\kokoro_tts.exe"
  if (!(Test-Path $UnpackedWorker)) {
    throw "Electron packaging did not include the Kokoro worker at $UnpackedWorker."
  }

  Write-Host "Verified packaged Kokoro worker: $UnpackedWorker" -ForegroundColor Green
}
finally {
  Pop-Location
}

Write-Host ""
Write-Host "Build complete." -ForegroundColor Green
Write-Host "Installer: release\Text-to-Speech-Studio-Setup.exe" -ForegroundColor Green
