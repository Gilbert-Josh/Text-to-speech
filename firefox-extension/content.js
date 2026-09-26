if (!globalThis.__ttsStudioContentLoaded) {
  globalThis.__ttsStudioContentLoaded = true;

  let audioQueue = [];
  let playing = false;
  let currentAudio = null;
  let statusTimer = null;

  function ensureStatus() {
    let box = document.getElementById("tts-studio-firefox-status");
    if (!box) {
      box = document.createElement("div");
      box.id = "tts-studio-firefox-status";
      Object.assign(box.style, {
        position: "fixed",
        right: "20px",
        bottom: "20px",
        zIndex: "2147483647",
        maxWidth: "360px",
        padding: "10px 14px",
        borderRadius: "10px",
        background: "#0f172a",
        color: "#fff",
        font: "14px/1.4 system-ui, sans-serif",
        boxShadow: "0 8px 30px rgba(0,0,0,.35)",
        border: "1px solid rgba(255,255,255,.12)"
      });
      document.documentElement.appendChild(box);
    }
    return box;
  }

  function showStatus(message) {
    const box = ensureStatus();
    box.textContent = message;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => box.remove(), 3500);
  }

  function base64ToBlob(base64, mimeType) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType });
  }

  async function playNext() {
    if (playing || audioQueue.length === 0) return;
    playing = true;
    const item = audioQueue.shift();

    try {
      const blob = base64ToBlob(item.audioBase64, item.mimeType);
      const url = URL.createObjectURL(blob);
      currentAudio = new Audio(url);
      showStatus("Reading " + item.position + "/" + item.total + "…");
      await currentAudio.play();

      await new Promise((resolve) => {
        currentAudio.addEventListener("ended", resolve, { once: true });
        currentAudio.addEventListener("error", resolve, { once: true });
      });

      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Audio playback failed:", error);
      showStatus("Firefox could not play the generated audio.");
    } finally {
      currentAudio = null;
      playing = false;

      if (audioQueue.length) {
        playNext();
      } else {
        browser.runtime.sendMessage({ type: "audio-finished" });
        showStatus("Finished.");
      }
    }
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message?.type === "ping") return Promise.resolve(true);

    if (message?.type === "play-audio") {
      audioQueue.push(message);
      playNext();
      return;
    }

    if (message?.type === "status") {
      showStatus(message.message);
      return;
    }

    if (message?.type === "stop-audio") {
      audioQueue = [];
      if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        currentAudio = null;
      }
      playing = false;
      browser.runtime.sendMessage({ type: "audio-stopped" });
      showStatus("Stopped.");
    }
  });
}
