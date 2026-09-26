const voice = document.getElementById("voice");
const style = document.getElementById("style");
const status = document.getElementById("status");

async function loadSettings() {
  const settings = await browser.storage.local.get({
    voice: "alloy",
    style: "natural"
  });
  voice.value = settings.voice;
  style.value = settings.style;
}

async function saveSettings() {
  await browser.storage.local.set({
    voice: voice.value,
    style: style.value
  });
}

async function getTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function run(action) {
  const tab = await getTab();
  if (!tab?.id) return;

  await saveSettings();

  if (action === "stop") {
    await browser.runtime.sendMessage({ type: "stop-reading", tabId: tab.id });
    status.textContent = "Stopped.";
    return;
  }

  await browser.runtime.sendMessage({
    type: "start-reading",
    tabId: tab.id,
    selectionOnly: action === "selection",
    voice: voice.value,
    style: style.value
  });

  status.textContent = action === "selection" ? "Reading selection…" : "Reading page…";
}

voice.addEventListener("change", saveSettings);
style.addEventListener("change", saveSettings);
document.getElementById("selection").addEventListener("click", () => run("selection"));
document.getElementById("page").addEventListener("click", () => run("page"));
document.getElementById("stop").addEventListener("click", () => run("stop"));

loadSettings();
