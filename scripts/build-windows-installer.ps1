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
$downloadCode = @'
from huggingface_hub import snapshot_download
import os
snapshot_download(
    repo_id="hexgrad/Kokoro-82M",
    local_dir=os.environ["KOKORO_BUILD_MODEL_DIR"],
    local_dir_use_symlinks=False,
    allow_patterns=[
        "config.json",
        "kokoro-v1_0.pth",
        "voices/*.pt",
    ],
)
'@
$env:KOKORO_BUILD_MODEL_DIR = $ModelRoot
& $Python -c $downloadCode
if ($LASTEXITCODE -ne 0) { throw "Kokoro model download failed." }

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
  "--collect-all", "soundfile",
  "--collect-all", "torch",
  (Join-Path $ProjectRoot "local-tts\kokoro_tts.py")
)
& $Python @PyInstallerArgs
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed." }

Copy-Item -Force (Join-Path $WorkerDist "kokoro_tts.exe") (Join-Path $RuntimeRoot "kokoro_tts.exe")

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
}
finally {
  Pop-Location
}

Write-Host ""
Write-Host "Build complete." -ForegroundColor Green
Write-Host "Installer: release\Text-to-Speech-Studio-Setup.exe" -ForegroundColor Green
