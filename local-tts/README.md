# Local eSpeak NG prerequisite

Kokoro uses eSpeak NG for phonemization on Windows.

For Windows, install the official eSpeak NG MSI from the upstream release page:

https://github.com/espeak-ng/espeak-ng/releases

The current upstream 1.52.0 release provides the Windows installer:

https://github.com/espeak-ng/espeak-ng/releases/download/1.52.0/espeak-ng.msi

After installation, open a new terminal and verify:

```powershell
where.exe espeak-ng
```

Then test Kokoro again:

```powershell
python local-tts\kokoro_tts.py alloy natural
```

Note: the MSI is a Windows system prerequisite, so it should be installed on the machine rather than committed into this repository.
