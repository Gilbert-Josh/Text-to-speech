const HEALTH_URLS = [
  "http://127.0.0.1:3000/api/health",
  "http://localhost:3000/api/health"
];
const MAX_CHARS = 3800;
let activeJob = 0;
let workingApiUrl = null;
let activeTabId = null;

browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: "tts-selection",
    title: "Read selected text with Text to Speech Studio",
    contexts: ["selection"]
  });
  browser.contextMenus.create({
    id: "tts-page",
    title: "Read entire page with Text to Speech Studio",
    contexts: ["page"]
  });
});

browser.runtime.onMessage.addListener(async (message) => {
  if (message?.type === "start-reading" && message.tabId) {
    const text = await getPageText(message.tabId, !!message.selectionOnly);
    if (text) {
      startReading(message.tabId, text, {
        voice: message.voice || "alloy",
        style: message.style || "natural"
      });
    }
    return;
  }

  if (message?.type === "stop-reading") {
    activeJob++;
    if (message.tabId) {
      try {
        await browser.tabs.sendMessage(message.tabId, { type: "stop-audio" });
      } catch {}
    }
  }
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  await ensureContentScript(tab.id);
  if (info.menuItemId === "tts-selection") {
    const text = (info.selectionText || "").trim();
    if (text) {
      const settings = await browser.storage.local.get({ voice: "alloy", style: "natural" });
      await startReading(tab.id, text, settings);
    }
  } else if (info.menuItemId === "tts-page") {
    const text = await getPageText(tab.id, false);
    if (text) {
      const settings = await browser.storage.local.get({ voice: "alloy", style: "natural" });
      await startReading(tab.id, text, settings);
    }
  }
});

browser.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "read-selection" || !tab?.id) return;
  await ensureContentScript(tab.id);
  const text = await getPageText(tab.id, true);
  if (text) {
    const settings = await browser.storage.local.get({ voice: "alloy", style: "natural" });
    await startReading(tab.id, text, settings);
  }
});

async function ensureContentScript(tabId) {
  try {
    await browser.tabs.sendMessage(tabId, { type: "ping" });
    return true;
  } catch {}

  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
    return true;
  } catch (error) {
    console.error("Could not inject Text to Speech Studio content script:", error);
    return false;
  }
}

async function getPageText(tabId, selectionOnly) {
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      func: (onlySelection) => {
        const selected = window.getSelection()?.toString().trim();
        if (onlySelection) return selected || "";
        if (selected) return selected;
        const root = document.querySelector("article, main, [role='main']") || document.body;
        return root?.innerText?.trim() || "";
      },
      args: [selectionOnly]
    });
    return results?.[0]?.result?.trim() || "";
  } catch (error) {
    console.error("Could not read page:", error);
    await sendStatus(tabId, "Firefox did not allow this page to be read.");
    return "";
  }
}

function splitText(text) {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= MAX_CHARS) return [clean];

  const sentences = clean.match(/[^.!?\n]+[.!?\n]+/g) || [clean];
  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    const part = sentence.trim();
    if (!part) continue;
    if (!current) current = part;
    else if ((current + " " + part).length <= MAX_CHARS) current += " " + part;
    else {
      chunks.push(current);
      current = part;
    }
  }

  if (current) chunks.push(current);

  const finalChunks = [];
  for (const chunk of chunks.length ? chunks : [clean]) {
    for (let i = 0; i < chunk.length; i += MAX_CHARS) {
      finalChunks.push(chunk.slice(i, i + MAX_CHARS));
    }
  }
  return finalChunks;
}

async function findStudioApi() {
  for (const healthUrl of HEALTH_URLS) {
    try {
      const response = await fetch(healthUrl, { method: "GET", cache: "no-store" });
      if (response.ok) {
        workingApiUrl = healthUrl.replace("/api/health", "/api/tts");
        return workingApiUrl;
      }
    } catch {}
  }

  workingApiUrl = null;
  throw new Error(
    "Firefox cannot connect to Text to Speech Studio on localhost:3000. " +
    "Make sure the desktop app is running and reload the extension."
  );
}

async function startReading(tabId, text, settings) {
  const jobId = ++activeJob;
  activeTabId = tabId;
  await ensureContentScript(tabId);

  const chunks = splitText(text);
  await sendStatus(
    tabId,
    "Preparing " + chunks.length + " audio segment" +
    (chunks.length === 1 ? "" : "s") + "…"
  );

  let apiUrl;
  try {
    apiUrl = await findStudioApi();
  } catch (error) {
    await sendStatus(tabId, error.message || "Could not connect to Text to Speech Studio.");
    return;
  }

  await sendStatus(tabId, "Reading…");

  for (let i = 0; i < chunks.length; i++) {
    if (jobId !== activeJob) return;

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: chunks[i],
          voice: settings.voice || "alloy",
          speakingStyle: settings.style || "natural"
        })
      });

      const data = await response.json();
      if (!response.ok || data.error || !data.audioBase64) {
        throw new Error(
          data.error ||
          "Text to Speech Studio returned HTTP " + response.status + " without audio."
        );
      }

      if (jobId !== activeJob) return;

      await browser.tabs.sendMessage(tabId, {
        type: "play-audio",
        audioBase64: data.audioBase64,
        mimeType: data.mimeType || "audio/wav",
        position: i + 1,
        total: chunks.length,
        highlightText: chunks[i]
      });

      await waitForPlayback(tabId, jobId);
    } catch (error) {
      console.error("TTS extension error:", error);
      await sendStatus(tabId, error?.message || "Could not generate speech.");
      return;
    }
  }

  if (jobId === activeJob) {
    await sendStatus(tabId, "Finished.");
    activeTabId = null;
  }
}

function waitForPlayback(tabId, jobId) {
  return new Promise((resolve) => {
    const listener = (message, sender) => {
      if (sender.tab?.id !== tabId) return;
      if (
        message?.type === "audio-finished" ||
        message?.type === "audio-stopped" ||
        message?.type === "audio-skipped"
      ) {
        browser.runtime.onMessage.removeListener(listener);
        resolve();
      }
    };

    browser.runtime.onMessage.addListener(listener);

    const check = setInterval(() => {
      if (jobId !== activeJob) {
        clearInterval(check);
        browser.runtime.onMessage.removeListener(listener);
        resolve();
      }
    }, 250);
  });
}

async function sendStatus(tabId, message) {
  try {
    if (!await ensureContentScript(tabId)) return;
    await browser.tabs.sendMessage(tabId, { type: "status", message });
  } catch {}
}
