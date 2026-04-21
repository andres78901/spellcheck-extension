/**
 * Service worker: llamadas a LanguageTool (evita CORS y mantiene la API fuera del content script).
 */

const LT_CHECK_URL = "https://api.languagetool.org/v2/check";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "SPELLCHECK_CHECK") {
    return undefined;
  }

  const { text, language } = message.payload ?? {};
  if (typeof text !== "string") {
    sendResponse({ ok: false, error: "Texto inválido." });
    return false;
  }

  const lang = typeof language === "string" && language.length > 0 ? language : "es";

  (async () => {
    try {
      const body = new URLSearchParams();
      body.set("text", text);
      body.set("language", lang);

      const res = await fetch(LT_CHECK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body,
      });

      if (!res.ok) {
        sendResponse({
          ok: false,
          error: `LanguageTool respondió ${res.status}.`,
        });
        return;
      }

      const data = await res.json();
      sendResponse({ ok: true, data });
    } catch (e) {
      console.error("[fb-spell] background fetch", e);
      sendResponse({
        ok: false,
        error: "No se pudo contactar LanguageTool.",
      });
    }
  })();

  return true;
});
