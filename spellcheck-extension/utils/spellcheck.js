/**
 * Utilidades compartidas: debounce, caché de respuestas y normalización de LanguageTool.
 * Expone `window.__fbSpellUtils` para uso desde content.js (sin bundler).
 */

(function initFbSpellUtils() {
  /**
   * @template {(...args: any[]) => void} T
   * @param {T} fn
   * @param {number} waitMs
   * @returns {T}
   */
  function debounce(fn, waitMs) {
    let t = 0;
    return /** @type {T} */ (
      function debounced(...args) {
        window.clearTimeout(t);
        t = window.setTimeout(() => fn.apply(this, args), waitMs);
      }
    );
  }

  /**
   * @param {string} text
   * @param {string} language
   */
  function cacheKey(text, language) {
    return `${language}\u0000${text}`;
  }

  /**
   * @param {any} match
   * @returns {{ offset: number, length: number, message: string, replacements: string[], ruleId?: string }}
   */
  function normalizeMatch(match) {
    const replacements = Array.isArray(match?.replacements)
      ? match.replacements.map((r) => String(r?.value ?? "")).filter(Boolean)
      : [];
    return {
      offset: Number(match?.offset) || 0,
      length: Number(match?.length) || 0,
      message: String(match?.message ?? ""),
      replacements,
      ruleId: match?.rule?.id ? String(match.rule.id) : undefined,
    };
  }

  /**
   * @param {any} data respuesta JSON de /v2/check
   */
  function normalizeResponse(data) {
    const matches = Array.isArray(data?.matches) ? data.matches.map(normalizeMatch) : [];
    const detected =
      data?.language && typeof data.language === "object"
        ? {
            name: data.language.name != null ? String(data.language.name) : undefined,
            code: data.language.code != null ? String(data.language.code) : undefined,
          }
        : undefined;
    return { matches, detected };
  }

  window.__fbSpellUtils = {
    debounce,
    cacheKey,
    normalizeResponse,
    DEBOUNCE_MS: 400,
  };
})();
