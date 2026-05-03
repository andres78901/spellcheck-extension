const enabledEl = document.getElementById("enabled");
const languageEl = document.getElementById("language");
const popupThemeEl = document.getElementById("popupTheme");
const popupCloseEl = document.getElementById("popupClose");

const THEME_VALUES = ["system", "light", "dark"];

function applyPopupTheme(theme) {
  const t = THEME_VALUES.includes(theme) ? theme : "system";
  document.documentElement.setAttribute("data-theme", t);
}

function load() {
  chrome.storage.local.get(["fbSpellEnabled", "fbSpellLanguage", "fbSpellPopupTheme"], (r) => {
    if (chrome.runtime.lastError) return;
    if (enabledEl) enabledEl.checked = r.fbSpellEnabled !== false;
    if (languageEl) {
      const lang = typeof r.fbSpellLanguage === "string" && r.fbSpellLanguage ? r.fbSpellLanguage : "auto";
      languageEl.value = ["auto", "es", "en-US", "pt-BR", "fr"].includes(lang) ? lang : "auto";
    }
    if (popupThemeEl) {
      const th =
        typeof r.fbSpellPopupTheme === "string" && r.fbSpellPopupTheme ? r.fbSpellPopupTheme : "system";
      popupThemeEl.value = THEME_VALUES.includes(th) ? th : "system";
      applyPopupTheme(popupThemeEl.value);
    }
  });
}

function save() {
  chrome.storage.local.set({
    fbSpellEnabled: enabledEl ? enabledEl.checked : true,
    fbSpellLanguage: languageEl ? languageEl.value : "auto",
    fbSpellPopupTheme: popupThemeEl ? popupThemeEl.value : "system",
  });
}

enabledEl?.addEventListener("change", save);
languageEl?.addEventListener("change", save);
popupThemeEl?.addEventListener("change", () => {
  applyPopupTheme(popupThemeEl.value);
  save();
});

popupCloseEl?.addEventListener("click", () => {
  window.close();
});

load();
