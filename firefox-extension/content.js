if (!globalThis.__ttsStudioContentLoaded) {
  globalThis.__ttsStudioContentLoaded = true;

  let audioQueue = [];
  let playing = false;
  let currentAudio = null;
  let statusTimer = null;
  let paused = false;

  function ensureUi() {
    let panel = document.getElementById("tts-studio-firefox-controls");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "tts-studio-firefox-controls";
      Object.assign(panel.style, {
        position: "fixed", right: "20px", bottom: "20px", zIndex: "2147483647",
        display: "flex", alignItems: "center", gap: "6px", padding: "8px 10px",
        borderRadius: "12px", background: "#0f172a", color: "#fff",
        font: "13px/1.2 system-ui, sans-serif",
        boxShadow: "0 8px 30px rgba(0,0,0,.35)",
        border: "1px solid rgba(255,255,255,.14)"
      });

      const peanut = document.createElement("span");
      peanut.id = "tts-studio-peanut";
      peanut.textContent = "🥜";
      peanut.title = "Text to Speech Studio";
      peanut.style.fontSize = "24px";
      panel.appendChild(peanut);

      const label = document.createElement("span");
      label.id = "tts-studio-progress";
      label.textContent = "Ready";
      label.style.margin = "0 4px";
      panel.appendChild(label);

      const pause = document.createElement("button");
      pause.id = "tts-studio-pause";
      pause.textContent = "Pause";
      styleButton(pause);
      pause.addEventListener("click", togglePause);
      panel.appendChild(pause);

      const skip = document.createElement("button");
      skip.textContent = "Skip";
      styleButton(skip);
      skip.addEventListener("click", skipCurrent);
      panel.appendChild(skip);

      const stop = document.createElement("button");
      stop.textContent = "Stop";
      styleButton(stop);
      stop.addEventListener("click", stopReading);
      panel.appendChild(stop);

      document.documentElement.appendChild(panel);
    }
    return panel;
  }

  function styleButton(button) {
    Object.assign(button.style, {
      border: "1px solid #475569", borderRadius: "7px", padding: "5px 8px",
      background: "#1e293b", color: "#fff", cursor: "pointer",
      font: "12px system-ui, sans-serif"
    });
  }

  function updateProgress(text) {
    const panel = ensureUi();
    const label = panel.querySelector("#tts-studio-progress");
    if (label) label.textContent = text;
  }

  function showStatus(message) {
    ensureUi();
    updateProgress(message);
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      if (!playing && !audioQueue.length) {
        document.getElementById("tts-studio-firefox-controls")?.remove();
      }
    }, 5000);
  }

  function base64ToBlob(base64, mimeType) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType });
  }

  function clearFollowAlong() {
    window.getSelection()?.removeAllRanges();
    document.getElementById("tts-studio-floating-peanut")?.remove();
  }

  function followAlong(text) {
    clearFollowAlong();
    const searchText = text.replace(/\s+/g, " ").trim();
    if (!searchText) return;

    let found = false;
    try {
      found = window.find(searchText, false, false, true, false, false, false);
    } catch {}

    if (!found) {
      try {
        found = window.find(searchText.slice(0, Math.min(searchText.length, 500)), false, false, true, false, false, false);
      } catch {}
    }

    if (!found) return;

    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const rect = range?.getBoundingClientRect();

    const peanut = document.createElement("div");
    peanut.id = "tts-studio-floating-peanut";
    peanut.textContent = "🥜";
    peanut.title = "Text to Speech Studio is reading here";
    Object.assign(peanut.style, {
      position: "fixed",
      left: Math.max(4, (rect?.right || 20) + 6) + "px",
      top: Math.max(4, (rect?.top || 20) - 4) + "px",
      zIndex: "2147483647",
      fontSize: "22px",
      pointerEvents: "none",
      filter: "drop-shadow(0 2px 3px rgba(0,0,0,.35))"
    });
    document.documentElement.appendChild(peanut);

    if (rect && (rect.top < 0 || rect.bottom > window.innerHeight)) {
      window.scrollTo({
        top: window.scrollY + rect.top - window.innerHeight * 0.3,
        behavior: "smooth"
      });
    }
  }

  function togglePause() {
    if (!currentAudio) return;

    if (paused) {
      currentAudio.play().catch(() => {});
      paused = false;
      document.getElementById("tts-studio-pause").textContent = "Pause";
      updateProgress("Reading…");
    } else {
      currentAudio.pause();
      paused = true;
      document.getElementById("tts-studio-pause").textContent = "Resume";
      updateProgress("Paused");
    }
  }

  function skipCurrent() {
    if (!currentAudio) return;
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio.dispatchEvent(new Event("tts-skip"));
  }

  function stopReading() {
    audioQueue = [];
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio.dispatchEvent(new Event("tts-stop"));
    } else {
      browser.runtime.sendMessage({ type: "audio-stopped" });
    }
    playing = false;
    paused = false;
    clearFollowAlong();
    document.getElementById("tts-studio-firefox-controls")?.remove();
  }

  async function playNext() {
    if (playing || audioQueue.length === 0) return;

    playing = true;
    paused = false;
    const item = audioQueue.shift();

    try {
      const blob = base64ToBlob(item.audioBase64, item.mimeType);
      const url = URL.createObjectURL(blob);
      currentAudio = new Audio(url);

      ensureUi();
      document.getElementById("tts-studio-pause").textContent = "Pause";
      updateProgress("Reading " + item.position + "/" + item.total + "…");
      followAlong(item.highlightText || "");

      await currentAudio.play();

      const result = await new Promise((resolve) => {
        currentAudio.addEventListener("ended", () => resolve("finished"), { once: true });
        currentAudio.addEventListener("error", () => resolve("error"), { once: true });
        currentAudio.addEventListener("tts-skip", () => resolve("skipped"), { once: true });
        currentAudio.addEventListener("tts-stop", () => resolve("stopped"), { once: true });
      });

      URL.revokeObjectURL(url);

      if (result === "skipped") {
        browser.runtime.sendMessage({ type: "audio-skipped" });
      } else if (result === "stopped") {
        browser.runtime.sendMessage({ type: "audio-stopped" });
      }
    } catch (error) {
      console.error("Audio playback failed:", error);
      showStatus("Firefox could not play the generated audio.");
    } finally {
      currentAudio = null;
      playing = false;
      paused = false;
      clearFollowAlong();

      if (audioQueue.length) {
        playNext();
      } else {
        browser.runtime.sendMessage({ type: "audio-finished" });
        updateProgress("Finished.");
        setTimeout(() => {
          if (!playing && !audioQueue.length) {
            document.getElementById("tts-studio-firefox-controls")?.remove();
          }
        }, 1500);
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
        currentAudio.dispatchEvent(new Event("tts-stop"));
      } else {
        browser.runtime.sendMessage({ type: "audio-stopped" });
      }
      playing = false;
      paused = false;
      clearFollowAlong();
      document.getElementById("tts-studio-firefox-controls")?.remove();
    }
  });
}
