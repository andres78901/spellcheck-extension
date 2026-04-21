const enabledEl = document.getElementById("enabled");
const languageEl = document.getElementById("language");

function load() {
  chrome.storage.local.get(["fbSpellEnabled", "fbSpellLanguage"], (r) => {
    if (chrome.runtime.lastError) return;
    if (enabledEl) enabledEl.checked = r.fbSpellEnabled !== false;
    if (languageEl) {
      const lang = typeof r.fbSpellLanguage === "string" && r.fbSpellLanguage ? r.fbSpellLanguage : "auto";
      languageEl.value = ["auto", "es", "en-US", "pt-BR", "fr"].includes(lang) ? lang : "auto";
    }
  });
}

function save() {
  chrome.storage.local.set({
    fbSpellEnabled: enabledEl ? enabledEl.checked : true,
    fbSpellLanguage: languageEl ? languageEl.value : "auto",
  });
}

enabledEl?.addEventListener("change", save);
languageEl?.addEventListener("change", save);

load();
