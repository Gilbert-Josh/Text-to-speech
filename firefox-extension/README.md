# Text to Speech Studio — Firefox Extension

This extension connects Firefox to the local Text to Speech Studio application.

## Features

- Right-click selected text → Read selected text with Text to Speech Studio
- Right-click a page → Read entire page with Text to Speech Studio
- Click the extension toolbar button to read the current page
- Ctrl+Shift+Y reads the current selection
- Uses the local Kokoro TTS engine through http://127.0.0.1:3000
- No cloud TTS service and no API key is required

## Requirements

The Text to Speech Studio desktop application must be running.

## Install for testing

1. Open Firefox.
2. Go to about:debugging#/runtime/this-firefox
3. Click Load Temporary Add-on…
4. Open the project folder and select firefox-extension/manifest.json.
5. Pin Text to Speech Studio to the Firefox toolbar.

Temporary extensions are removed when Firefox is restarted.

## Test

1. Start Text to Speech Studio.
2. Open a normal webpage containing text.
3. Select a sentence.
4. Right-click the selection.
5. Choose Read selected text with Text to Speech Studio.
6. The extension should show a small status message and Kokoro should play the audio.
7. Also test Read entire page with Text to Speech Studio.

## Troubleshooting

If the extension says Text to Speech Studio is not running, start the desktop application first.

You can also test the local health endpoint in Firefox:
http://127.0.0.1:3000/api/health

If a particular site cannot be read, Firefox may restrict extensions on special browser pages such as about: pages.

The extension uses activeTab so it only receives page access after you invoke it.

## Build a ZIP

From the project root:

Compress-Archive -Path .\firefox-extension\* -DestinationPath .\release\Text-to-Speech-Studio-Firefox-Extension.zip -Force
