/**
 * Content script Facebook + Instagram: corrección alineada con LanguageTool (innerText).
 * Marcas flotantes (overlay) usan Rangos solo para dibujar; el reemplazo usa replaceWordSafely (substring + innerText + eventos).
 */
(function () {
  const utils = window.__fbSpellUtils;
  if (!utils) {
    console.error("[fb-spell] Falta utils/spellcheck.js");
    return;
  }

  const SEL_EDITABLE = '[contenteditable="true"]';
  const OVERLAY_MARK = "fb-spell-overlay-mark";
  const LOG = "[spell-ext]";
  const POPUP_THEME_VALUES = ["system", "light", "dark"];

  /** @type {"facebook" | "instagram" | "unknown" | null} */
  let cachedPlatform = null;

  /** Evita adjuntar listeners dos veces al mismo nodo (complementa dataset). */
  const weakAttachRegistered = new WeakSet();

  /** Evita runCheck concurrente sobre el mismo editor (re-renders / eventos duplicados). */
  const weakCheckInFlight = new WeakSet();

  /**
   * Hostname → plataforma. Modular para handlers por sitio.
   * @returns {"facebook" | "instagram" | "unknown"}
   */
  function detectPlatform() {
    if (cachedPlatform != null) return cachedPlatform;
    try {
      const host = (location.hostname || "").toLowerCase();
      if (host === "instagram.com" || host === "www.instagram.com" || host.endsWith(".instagram.com")) {
        cachedPlatform = "instagram";
        return cachedPlatform;
      }
      if (
        host === "facebook.com" ||
        host === "www.facebook.com" ||
        host === "m.facebook.com" ||
        host.endsWith(".facebook.com") ||
        host === "fb.com" ||
        host.endsWith(".fb.com")
      ) {
        cachedPlatform = "facebook";
        return cachedPlatform;
      }
      cachedPlatform = "unknown";
      return cachedPlatform;
    } catch {
      cachedPlatform = "unknown";
      return cachedPlatform;
    }
  }

  /**
   * @param {Element | null} el
   */
  function isHiddenByAriaOrStyle(el) {
    let n = el;
    for (let i = 0; i < 40 && n; i++) {
      if (n instanceof HTMLElement) {
        if (n.getAttribute("aria-hidden") === "true") return true;
        try {
          const st = getComputedStyle(n);
          if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") return true;
        } catch {
          /* ignore */
        }
      }
      n = n.parentElement;
    }
    return false;
  }

  /**
   * Facebook: cualquier composer contentEditable razonablemente visible.
   * @param {HTMLElement} el
   */
  function isValidFacebookInput(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (!el.isConnected) return false;
    if (el.isContentEditable !== true) return false;
    if (isHiddenByAriaOrStyle(el)) return false;
    let inner;
    try {
      inner = el.innerText;
    } catch {
      return false;
    }
    if (inner == null) return false;
    if (el.offsetParent !== null) return true;
    try {
      const st = getComputedStyle(el);
      const pos = st.position;
      if ((pos === "fixed" || pos === "sticky") && st.display !== "none") {
        const r = el.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  /**
   * Instagram: solo compositores reales (DM / comentarios).
   * Nota: muchos compositores van en `position:fixed` → `offsetParent === null`; se admite rect+estilo.
   * @param {HTMLElement} el
   */
  function isInstagramComposerContext(el) {
    if (!(el instanceof HTMLElement)) return false;
    const path = (location.pathname || "").toLowerCase();
    const selfLab = (el.getAttribute("aria-label") || "").toLowerCase();
    if (selfLab.includes("search") || selfLab.includes("buscar")) return false;

    let n = el;
    for (let d = 0; d < 30 && n; d++) {
      const tid = (n.getAttribute && n.getAttribute("data-testid")) || "";
      if (/comment|composer|reply|message|thread|direct|inbox|editable|caption/i.test(tid)) return true;
      n = n.parentElement;
    }

    if (path.includes("/direct/")) {
      return el.getAttribute("role") === "textbox" || !!el.closest('div[role="presentation"]');
    }

    if (el.closest("article")) return true;

    const modal = el.closest('[aria-modal="true"]');
    if (modal) return true;

    return false;
  }

  /**
   * Condiciones estrictas para Instagram (evita contentEditable “falso” de overlays).
   * @param {HTMLElement} el
   */
  function isValidInstagramInput(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (!el.isConnected) return false;
    if (el.isContentEditable !== true) return false;

    const visibleTraditional = el.offsetParent !== null;
    let visibleFixed = false;
    try {
      const st = getComputedStyle(el);
      if ((st.position === "fixed" || st.position === "sticky") && st.display !== "none" && st.visibility !== "hidden") {
        const r = el.getBoundingClientRect();
        visibleFixed = r.width > 1 && r.height > 1;
      }
    } catch {
      visibleFixed = false;
    }
    if (!visibleTraditional && !visibleFixed) return false;

    if (isHiddenByAriaOrStyle(el)) return false;

    let inner;
    try {
      inner = el.innerText;
    } catch {
      return false;
    }
    if (inner == null || inner === undefined) return false;

    const hasText = String(inner).trim().length > 0;
    const ae = document.activeElement;
    const focused =
      ae === el || (ae instanceof Node && el.contains(ae));
    if (!focused && !hasText) return false;

    if (!isInstagramComposerContext(el)) return false;

    return true;
  }

  /**
   * Recorre `scope` y devuelve editables válidos según plataforma.
   * Incluye el propio nodo si es contentEditable (MutationObserver a veces inserta solo el composer).
   * @param {ParentNode | HTMLElement} scope
   * @returns {HTMLElement[]}
   */
  function getEditableElements(scope) {
    const platform = detectPlatform();
    /** @type {HTMLElement[]} */
    const out = [];

    const maybePush = (/** @type {HTMLElement} */ el) => {
      if (platform === "instagram") {
        if (isValidInstagramInput(el)) out.push(el);
      } else if (platform === "facebook") {
        if (isValidFacebookInput(el)) out.push(el);
      } else if (isValidFacebookInput(el)) {
        out.push(el);
      }
    };

    if (scope instanceof HTMLElement && scope.matches?.(SEL_EDITABLE)) {
      maybePush(scope);
    }

    const root = scope instanceof HTMLElement ? scope : document;
    root.querySelectorAll(SEL_EDITABLE).forEach((node) => {
      if (node instanceof HTMLElement) maybePush(node);
    });
    return out;
  }

  /**
   * Entrada unificada tras input/focus: registra editor y agenda chequeo.
   * @param {HTMLElement} element
   */
  function handleInput(element) {
    if (!(element instanceof HTMLElement)) return;
    const platform = detectPlatform();
    console.info(LOG, "handleInput", { platform, tag: element.tagName, hasRootId: !!element.dataset.fbSpellRootId });
    scheduleCheck(element);
  }

  /**
   * Sube desde el target del evento hasta el ancestro contentEditable (Instagram/Lexical anida nodos).
   * @param {EventTarget | null} start
   * @returns {HTMLElement | null}
   */
  function findContentEditableRootFromEventTarget(start) {
    let n = start instanceof Node ? start : null;
    while (n) {
      if (n instanceof HTMLElement && n.isContentEditable) return n;
      n = n.parentElement;
    }
    return null;
  }

  /** @type {{ enabled: boolean, language: string }} */
  let prefs = { enabled: true, language: "auto" };

  /** @type {Map<HTMLElement, () => void>} */
  const debouncers = new Map();

  /** @type {Map<string, { matches: any[], detected?: any }>} */
  const resultCache = new Map();
  const CACHE_MAX = 80;

  /**
   * @typedef {{
   *   snapshotText: string,
   *   matches: Array<{
   *     offset: number,
   *     length: number,
   *     message: string,
   *     replacements: string[],
   *     ruleId?: string,
   *     originalSlice: string,
   *     matchIndex: number,
   *   }>,
   *   rootId: string,
   * }} EditorSpellState
   */

  /** @type {WeakMap<HTMLElement, EditorSpellState>} */
  const spellStateByRoot = new WeakMap();

  /** @type {HTMLElement | null} */
  let tooltipEl = null;

  /** @type {WeakMap<HTMLElement, boolean>} */
  const composingByRoot = new WeakMap();

  /**
   * Alinea el tema del tooltip con la opción "Apariencia" del popup (`fbSpellPopupTheme`).
   * @param {string} [theme]
   */
  function applyPagePopupTheme(theme) {
    const t =
      typeof theme === "string" && POPUP_THEME_VALUES.includes(theme) ? theme : "system";
    document.documentElement.setAttribute("data-fb-spell-theme", t);
  }

  applyPagePopupTheme("system");

  function loadPrefs() {
    chrome.storage.local.get(["fbSpellEnabled", "fbSpellLanguage", "fbSpellPopupTheme"], (r) => {
      if (chrome.runtime.lastError) return;
      prefs.enabled = r.fbSpellEnabled !== false;
      prefs.language = typeof r.fbSpellLanguage === "string" && r.fbSpellLanguage ? r.fbSpellLanguage : "auto";
      const th = typeof r.fbSpellPopupTheme === "string" ? r.fbSpellPopupTheme : "system";
      applyPagePopupTheme(th);
    });
  }

  function pruneCache() {
    while (resultCache.size > CACHE_MAX) {
      const first = resultCache.keys().next().value;
      if (first == null) break;
      resultCache.delete(first);
    }
  }

  function ensureRootId(root) {
    if (!root.dataset.fbSpellRootId) {
      root.dataset.fbSpellRootId = `r_${Math.random().toString(36).slice(2, 11)}`;
    }
    return root.dataset.fbSpellRootId;
  }

  function removeLegacySpansInside(root) {
    root.querySelectorAll("span.fb-spell-error").forEach((span) => {
      const parent = span.parentNode;
      if (!parent) return;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
    });
  }

  function clearOverlayMarksForRoot(root) {
    const id = root.dataset.fbSpellRootId;
    if (!id) return;
    document.querySelectorAll(`.${OVERLAY_MARK}[data-fb-spell-root-id="${CSS.escape(id)}"]`).forEach((n) => n.remove());
  }

  function clearEveryOverlay() {
    document.querySelectorAll(`.${OVERLAY_MARK}`).forEach((n) => n.remove());
  }

  function hideTooltip() {
    if (tooltipEl) {
      tooltipEl.remove();
      tooltipEl = null;
    }
  }

  function ensureTooltip() {
    if (tooltipEl) return tooltipEl;
    const el = document.createElement("div");
    el.className = "fb-spell-tooltip";
    el.setAttribute("role", "dialog");
    document.documentElement.appendChild(el);
    tooltipEl = el;
    return el;
  }

  /**
   * @param {DOMRectReadOnly} rect
   * @param {any} match
   */
  function showTooltipNearRect(rect, match) {
    const tip = ensureTooltip();
    const reps = Array.isArray(match?.replacements) ? match.replacements.slice(0, 8) : [];

    tip.innerHTML = "";
    const title = document.createElement("div");
    title.className = "fb-spell-tooltip-title";
    title.textContent = match?.message ? String(match.message) : "Sugerencias";
    tip.appendChild(title);

    const actions = document.createElement("div");
    actions.className = "fb-spell-tooltip-actions";

    if (reps.length === 0) {
      const none = document.createElement("span");
      none.className = "fb-spell-tooltip-title";
      none.textContent = "Sin sugerencias automáticas.";
      actions.appendChild(none);
    } else {
      reps.forEach((word) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "fb-spell-suggestion";
        b.textContent = word;
        actions.appendChild(b);
      });
    }

    tip.appendChild(actions);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "fb-spell-tooltip-close";
    close.textContent = "Cerrar";
    close.addEventListener("click", (e) => {
      e.preventDefault();
      hideTooltip();
    });
    tip.appendChild(close);

    const pad = 8;
    requestAnimationFrame(() => {
      const top = Math.min(window.innerHeight - tip.offsetHeight - pad, rect.bottom + 6);
      const left = Math.min(window.innerWidth - tip.offsetWidth - pad, rect.left);
      tip.style.top = `${Math.max(pad, top)}px`;
      tip.style.left = `${Math.max(pad, left)}px`;
    });
  }

  /**
   * Lectura no destructiva: solo TreeWalker sobre nodos de texto existentes.
   * @param {HTMLElement} root
   */
  function collectTextNodes(root) {
    /** @type {Text[]} */
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let n = walker.nextNode();
    while (n) {
      out.push(/** @type {Text} */ (n));
      n = walker.nextNode();
    }
    return out;
  }

  /**
   * Debe coincidir con lo enviado a LanguageTool y con `replaceWordSafely` (offsets en ese string).
   * innerText ≈ texto visible del composer; así evitas desajuste offset vs TreeWalker.
   *
   * @param {HTMLElement} root
   */
  function getPlainText(root) {
    if (!(root instanceof HTMLElement)) return "";
    try {
      const t = root.innerText;
      return typeof t === "string" ? t : "";
    } catch {
      return "";
    }
  }

  /**
   * Compara fragmentos como los ve el usuario (NBSP / CRLF).
   * @param {string} a
   * @param {string} b
   */
  function normalizeEditorSlice(a) {
    return (a ?? "").replace(/\u00a0/g, " ").replace(/\r\n/g, "\n");
  }

  /**
   * @param {string} a
   * @param {string} b
   */
  function textSlicesComparable(a, b) {
    return normalizeEditorSlice(a) === normalizeEditorSlice(b);
  }

  /**
   * Concatenación de nodos Text (orden documento). Suele diferir de innerText en saltos de bloque.
   * @param {HTMLElement} root
   */
  function getWalkerPlainText(root) {
    return collectTextNodes(root)
      .map((n) => n.nodeValue ?? "")
      .join("");
  }

  /**
   * @param {HTMLElement} el
   */
  function focusContentEditable(el) {
    try {
      el.focus({ preventScroll: true });
    } catch {
      try {
        el.focus();
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * @param {HTMLElement} el
   * @param {string} replacement
   * @param {{ phase: "beforeDom" | "afterDom" }} opts
   */
  function dispatchReactFriendlyInputBurstPhased(el, replacement, opts) {
    const phase = opts.phase;
    const tryDispatch = (factory) => {
      try {
        const ev = factory();
        el.dispatchEvent(ev);
        return ev.type || "ok";
      } catch {
        return null;
      }
    };

    const dispatched = [];
    if (phase === "beforeDom") {
      let x = tryDispatch(() => new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertReplacementText", data: replacement }));
      if (x) dispatched.push(`beforeinput:replacement:${x}`);
      x = tryDispatch(() => new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: replacement }));
      if (x) dispatched.push(`beforeinput:insertText:${x}`);
      return dispatched;
    }

    let x = tryDispatch(() => new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertReplacementText", data: replacement }));
    if (x) dispatched.push(`beforeinput:replacement:${x}`);
    x = tryDispatch(() => new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertReplacementText", data: replacement }));
    if (x) dispatched.push(`input:replacement:${x}`);
    x = tryDispatch(() => new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: replacement }));
    if (x) dispatched.push(`input:insertText:${x}`);
    x = tryDispatch(() => new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertFromPaste", data: replacement }));
    if (x) dispatched.push(`input:paste:${x}`);
    x = tryDispatch(() => new Event("input", { bubbles: true }));
    if (x) dispatched.push(`input:generic`);
    try {
      el.dispatchEvent(new Event("change", { bubbles: true }));
      dispatched.push("change");
    } catch {
      /* ignore */
    }
    try {
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: replacement.slice(-1) || "Unidentified",
        })
      );
      dispatched.push("keydown");
    } catch {
      /* ignore */
    }
    try {
      el.dispatchEvent(
        new KeyboardEvent("keyup", {
          bubbles: true,
          cancelable: true,
          key: replacement.slice(-1) || "Unidentified",
        })
      );
      dispatched.push("keyup");
    } catch {
      /* ignore */
    }
    try {
      el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: replacement }));
      dispatched.push("compositionend");
    } catch {
      /* ignore */
    }
    return dispatched;
  }

  /**
   * @param {HTMLElement} el
   * @param {string} expectedPlain
   * @returns {Promise<{ ok: boolean, after?: string }>}
   */
  function verifyPlainAfterPaint(el, expectedPlain) {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          queueMicrotask(() => {
            const after = getPlainText(el);
            resolve({ ok: after === expectedPlain, after });
          });
        });
      });
    });
  }

  /**
   * Último recurso: sustituir todo el texto visible como haría el usuario (selección + insertText).
   * @param {HTMLElement} el
   * @param {string} newPlain
   */
  function tryReplaceEntireComposerPlain(el, newPlain) {
    const sel = window.getSelection();
    if (!sel) return { ok: false, reason: "no_selection" };
    focusContentEditable(el);
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      let inserted = false;
      try {
        inserted = document.execCommand("insertText", false, newPlain);
      } catch {
        inserted = false;
      }
      return { ok: inserted, reason: inserted ? undefined : "execCommand_insertText_full_false" };
    } catch (e) {
      return { ok: false, reason: String(e) };
    }
  }

  /**
   * Qué número de aparición (0-based) de `needle` corresponde a la que empieza en `off` (debe coincidir el slice).
   * @param {string} full
   * @param {string} needle
   * @param {number} off
   */
  function occurrenceIndexAtOffset(full, needle, off) {
    if (!needle || off < 0 || off + needle.length > full.length) return -1;
    if (full.slice(off, off + needle.length) !== needle) return -1;
    let occ = 0;
    let pos = 0;
    while (pos < full.length) {
      const idx = full.indexOf(needle, pos);
      if (idx === -1) return -1;
      if (idx === off) return occ;
      occ++;
      pos = idx + needle.length;
    }
    return -1;
  }

  /**
   * Offset de la n-ésima aparición de needle (no solapadas).
   * @param {string} haystack
   * @param {string} needle
   * @param {number} occ
   */
  function nthOccurrenceOffset(haystack, needle, occ) {
    let pos = 0;
    for (let i = 0; i <= occ; i++) {
      const idx = haystack.indexOf(needle, pos);
      if (idx === -1) return -1;
      if (i === occ) return idx;
      pos = idx + needle.length;
    }
    return -1;
  }

  /**
   * Coloca el caret en un índice de caracteres sobre la concatenación de nodos Text (tras actualizar innerText).
   *
   * @param {HTMLElement} root
   * @param {number} globalOffset
   */
  function setCaretAtGlobalOffset(root, globalOffset) {
    const sel = window.getSelection();
    if (!sel) return false;
    const nodes = collectTextNodes(root);
    let pos = 0;
    const target = Math.max(0, globalOffset);
    for (const tn of nodes) {
      const len = (tn.nodeValue ?? "").length;
      if (target <= pos + len) {
        const local = Math.min(Math.max(0, target - pos), len);
        try {
          const range = document.createRange();
          range.setStart(tn, local);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          return true;
        } catch {
          return false;
        }
      }
      pos += len;
    }
    const last = nodes[nodes.length - 1];
    if (last) {
      try {
        const range = document.createRange();
        range.setStart(last, (last.nodeValue ?? "").length);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return true;
      } catch {
        /* ignore */
      }
    }
    return false;
  }

  /**
   * @param {string} text
   * @param {any[]} matches
   */
  function validateMatches(text, matches) {
    const len = text.length;
    const out = [];
    for (const m of matches) {
      const offset = Number(m?.offset);
      const length = Number(m?.length);
      if (!Number.isFinite(offset) || !Number.isFinite(length)) continue;
      if (length <= 0) continue;
      if (offset < 0 || offset > len) continue;
      if (offset + length > len) continue;
      out.push(m);
    }
    return out;
  }

  /**
   * Ancla cada match al texto usado por LanguageTool (misma fuente que el Range).
   * `matchIndex` + `originalSlice` permiten reemplazar solo UNA ocurrencia aunque la palabra se repita.
   *
   * @param {string} text
   * @param {any[]} matches
   */
  function prepareMatchesForUi(text, matches) {
    const valid = validateMatches(text, matches);
    return valid.map((m, matchIndex) => ({
      ...m,
      originalSlice: text.slice(m.offset, m.offset + m.length),
      matchIndex,
    }));
  }

  /**
   * @param {HTMLElement} root
   * @param {number} offset
   * @param {number} length
   * @returns {Range | null}
   */
  function createRangeForOffset(root, offset, length) {
    const nodes = collectTextNodes(root);
    let pos = 0;
    /** @type {Text | null} */
    let startNode = null;
    let startOff = 0;
    /** @type {Text | null} */
    let endNode = null;
    let endOff = 0;

    for (const tn of nodes) {
      const nodeLen = (tn.nodeValue ?? "").length;
      if (startNode == null && pos + nodeLen > offset) {
        startNode = tn;
        startOff = Math.max(0, offset - pos);
      }
      if (startNode != null && pos + nodeLen >= offset + length) {
        endNode = tn;
        endOff = Math.max(0, offset + length - pos);
        break;
      }
      pos += nodeLen;
    }

    if (!startNode || !endNode) return null;

    const range = document.createRange();
    const snLen = (startNode.nodeValue ?? "").length;
    const enLen = (endNode.nodeValue ?? "").length;
    range.setStart(startNode, Math.min(Math.max(0, startOff), snLen));
    range.setEnd(endNode, Math.min(Math.max(0, endOff), enLen));
    if (range.collapsed) return null;
    return range;
  }

  /**
   * Decide offset efectivo: primario por LanguageTool, o fallback por primera aparición de `expectedWord`.
   *
   * @param {string} fullText
   * @param {number} offset
   * @param {number} length
   * @param {string} expectedWord
   * @returns {{ ok: boolean, newText?: string, caretPos?: number, strategy?: string, effOffset?: number, effLen?: number, extracted?: string, reason?: string }}
   */
  function computeReplacementPlan(fullText, offset, length, expectedWord, replacement) {
    const o = Number(offset);
    const L = Number(length);
    const boundsOk =
      Number.isFinite(o) &&
      Number.isFinite(L) &&
      L > 0 &&
      o >= 0 &&
      o + L <= fullText.length;

    const sliceAtOffset = boundsOk ? fullText.slice(o, o + L) : "";
    const expect = typeof expectedWord === "string" ? expectedWord : "";

    if (boundsOk && (expect.length === 0 || sliceAtOffset === expect)) {
      const newText = fullText.slice(0, o) + replacement + fullText.slice(o + L);
      return {
        ok: true,
        newText,
        caretPos: o + replacement.length,
        strategy: expect.length === 0 ? "primary_no_expected" : "primary_offset",
        effOffset: o,
        effLen: L,
        extracted: sliceAtOffset,
      };
    }

    console.warn(LOG, "replaceWordSafely: aviso — primario no coincide o índices fuera de rango; se intenta fallback.", {
      boundsOk,
      offset: o,
      length: L,
      textLen: fullText.length,
      sliceAtOffset,
      expectedWord: expect,
    });

    if (expect.length > 0) {
      const idx = fullText.indexOf(expect);
      if (idx !== -1) {
        const newText = fullText.slice(0, idx) + replacement + fullText.slice(idx + expect.length);
        return {
          ok: true,
          newText,
          caretPos: idx + replacement.length,
          strategy: "fallback_first_indexOf",
          effOffset: idx,
          effLen: expect.length,
          extracted: expect,
        };
      }
      console.warn(LOG, "replaceWordSafely: fallback no encontró la palabra esperada en innerText.", {
        expectedWord: expect,
      });
      return { ok: false, reason: "fallback_no_match", strategy: "fallback_failed" };
    }

    if (boundsOk) {
      const newText = fullText.slice(0, o) + replacement + fullText.slice(o + L);
      return {
        ok: true,
        newText,
        caretPos: o + replacement.length,
        strategy: "primary_slice_only",
        effOffset: o,
        effLen: L,
        extracted: sliceAtOffset,
      };
    }

    return { ok: false, reason: "nothing_applicable", strategy: "none" };
  }

  /**
   * Selecciona el rango [off, off+len) y ejecuta insertText (camino “usuario real” que Lexical/React suelen aceptar).
   *
   * @param {HTMLElement} el
   * @param {number} off
   * @param {number} len
   * @param {string} replacement
   * @param {string} fullBeforeSlice
   */
  function execInsertTextAtRange(el, off, len, replacement, fullBeforeSlice) {
    const range = createRangeForOffset(el, off, len);
    if (!range || range.collapsed) return { ok: false, reason: "no_range" };
    const domSlice = range.toString();
    if (!textSlicesComparable(domSlice, fullBeforeSlice)) {
      return { ok: false, reason: "range_slice_mismatch", domSlice, fullBeforeSlice };
    }
    const sel = window.getSelection();
    if (!sel) return { ok: false, reason: "no_selection" };
    focusContentEditable(el);
    sel.removeAllRanges();
    sel.addRange(range);
    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, replacement);
    } catch {
      inserted = false;
    }
    return { ok: inserted, reason: inserted ? undefined : "execCommand_false" };
  }

  /**
   * Intenta insertText en offsets innerText; si el DOM (TreeWalker) no coincide, reintenta mapeando a texto concatenado.
   *
   * @param {HTMLElement} el
   * @param {number} effOffset
   * @param {number} effLen
   * @param {string} replacement
   * @param {string} fullBeforeSlice
   * @param {string} fullInnerBefore
   */
  function tryReplaceViaExecCommandInsertText(el, effOffset, effLen, replacement, fullBeforeSlice, fullInnerBefore) {
    let r = execInsertTextAtRange(el, effOffset, effLen, replacement, fullBeforeSlice);
    if (r.ok) return { ...r, via: "inner_offsets" };

    const walker = getWalkerPlainText(el);
    const occ = occurrenceIndexAtOffset(fullInnerBefore, fullBeforeSlice, effOffset);
    if (occ >= 0 && fullBeforeSlice.length > 0) {
      const wOff = nthOccurrenceOffset(walker, fullBeforeSlice, occ);
      if (wOff >= 0) {
        r = execInsertTextAtRange(el, wOff, effLen, replacement, fullBeforeSlice);
        if (r.ok) return { ...r, via: "walker_mapped" };
      }
    }

    return r;
  }

  /**
   * Borra la selección y escribe replacement (otra ruta nativa que dispara beforeinput/input).
   *
   * @param {HTMLElement} el
   * @param {number} effOffset
   * @param {number} effLen
   * @param {string} replacement
   * @param {string} fullBeforeSlice
   * @param {string} fullInnerBefore
   */
  function tryReplaceViaExecCommandDeleteInsert(el, effOffset, effLen, replacement, fullBeforeSlice, fullInnerBefore) {
    const tryOnce = (off, len) => {
      const range = createRangeForOffset(el, off, len);
      if (!range || range.collapsed) return { ok: false, reason: "no_range" };
      const domSlice = range.toString();
      if (!textSlicesComparable(domSlice, fullBeforeSlice)) return { ok: false, reason: "range_slice_mismatch" };
      const sel = window.getSelection();
      if (!sel) return { ok: false, reason: "no_selection" };
      focusContentEditable(el);
      sel.removeAllRanges();
      sel.addRange(range);
      let deleted = false;
      let inserted = false;
      try {
        deleted = document.execCommand("delete", false);
      } catch {
        deleted = false;
      }
      try {
        inserted = document.execCommand("insertText", false, replacement);
      } catch {
        inserted = false;
      }
      // `delete` a veces devuelve false aunque haya borrado; el criterio real lo aplica el caller con innerText.
      return { ok: inserted, reason: inserted ? undefined : "insert_after_delete_failed", deleteDispatched: deleted };
    };

    let r = tryOnce(effOffset, effLen);
    if (r.ok) return { ...r, via: "inner_offsets" };
    const walker = getWalkerPlainText(el);
    const occ = occurrenceIndexAtOffset(fullInnerBefore, fullBeforeSlice, effOffset);
    if (occ >= 0 && fullBeforeSlice.length > 0) {
      const wOff = nthOccurrenceOffset(walker, fullBeforeSlice, occ);
      if (wOff >= 0) {
        r = tryOnce(wOff, effLen);
        if (r.ok) return { ...r, via: "walker_mapped" };
      }
    }
    return r;
  }

  /**
   * Borra todo el contenido editable y escribe carácter a carácter (último recurso si React revierte innerText).
   * @param {HTMLElement} el
   * @param {string} text
   */
  function tryReplaceByCharTyping(el, text) {
    const sel = window.getSelection();
    if (!sel) return { ok: false, reason: "no_selection" };
    if (text.length > 6000) return { ok: false, reason: "text_too_long_for_char_typing" };
    focusContentEditable(el);
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      try {
        document.execCommand("delete", false);
      } catch {
        /* ignore */
      }
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        let ok = false;
        try {
          ok = document.execCommand("insertText", false, ch);
        } catch {
          ok = false;
        }
        if (!ok) return { ok: false, reason: `char_insert_failed_at_${i}` };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: String(e) };
    }
  }

  /**
   * Reemplazo por innerText: primario offset+length; si no coincide, fallback primera aparición de `expectedWord`.
   * Actualización UI: execCommand (insertText / delete+insert), innerText + ráfaga beforeinput/input, composición completa, tipeo por carácter.
   *
   * @param {HTMLElement} contentEditable
   * @param {number} offset
   * @param {number} length
   * @param {string} replacement
   * @param {{ fullTextSnapshot?: string, expectedWord?: string, matchIndex?: number }} [meta]
   * @returns {Promise<{ ok: boolean, reason?: string, strategy?: string, uiPath?: string, uiMatches?: boolean, uiActuallyUpdated?: boolean }>}
   */
  function replaceWordSafely(contentEditable, offset, length, replacement, meta) {
    meta = meta ?? {};
    const fullTextSnapshot = meta.fullTextSnapshot ?? "";
    const expectedWord = meta.expectedWord ?? "";
    const matchIndex = meta.matchIndex;

    return new Promise((resolve) => {
      const fullBeforeSync = getPlainText(contentEditable);

      console.info(LOG, "replaceWordSafely (pre-rAF)", {
        platform: detectPlatform(),
        matchIndex,
        offset,
        length,
        expectedWord,
        replacementWord: replacement,
        fullTextBefore: fullBeforeSync,
        fullLen: fullBeforeSync.length,
        snapshotLen: fullTextSnapshot.length,
        snapshotEqualsCurrent: fullBeforeSync === fullTextSnapshot,
        sliceAtOffset: fullBeforeSync.slice(offset, offset + length),
      });

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            if (!contentEditable.isConnected) {
              console.warn(LOG, "replaceWordSafely: nodo desconectado.");
              resolve({ ok: false, reason: "detached", strategy: "none", uiPath: "none" });
              return;
            }

            const fullBefore = getPlainText(contentEditable);

            console.info(LOG, "replaceWordSafely (in rAF, click-time innerText)", {
              matchIndex,
              offset,
              length,
              fullTextBefore: fullBefore,
              fullLen: fullBefore.length,
              sliceAtOffset: fullBefore.slice(offset, offset + length),
              expectedWord,
            });

            const plan = computeReplacementPlan(fullBefore, offset, length, expectedWord, replacement);

            if (!plan.ok || !plan.newText) {
              console.warn(LOG, "replaceWordSafely: no se pudo construir reemplazo.", {
                reason: plan.reason,
                strategy: plan.strategy,
              });
              resolve({ ok: false, reason: plan.reason ?? "plan_failed", strategy: plan.strategy, uiPath: "none" });
              return;
            }

            const newText = plan.newText;
            const effOffset = /** @type {number} */ (plan.effOffset);
            const effLen = /** @type {number} */ (plan.effLen);
            const caretPos = plan.caretPos ?? 0;
            const sliceForDom = fullBefore.slice(effOffset, effOffset + effLen);

            console.info(LOG, "replaceWordSafely: plan", {
              strategy: plan.strategy,
              effOffset,
              effLen,
              extracted: plan.extracted,
              replacementWord: replacement,
              expectedNewTextLen: newText.length,
            });

            focusContentEditable(contentEditable);

            /** @type {string[]} */
            const eventsFinal = [];
            let uiPath = "none";
            let after = getPlainText(contentEditable);

            const execResult = tryReplaceViaExecCommandInsertText(
              contentEditable,
              effOffset,
              effLen,
              replacement,
              sliceForDom,
              fullBefore
            );
            after = getPlainText(contentEditable);

            if (execResult.ok && after === newText) {
              uiPath = `execCommand_insertText_${execResult.via ?? "default"}`;
              console.info(LOG, "replaceWordSafely: UI via execCommand (insertText)", {
                afterLen: after.length,
                via: execResult.via,
              });
            } else {
              if (!execResult.ok) {
                console.warn(LOG, "replaceWordSafely: insertText falló; se prueba delete+insertText.", execResult);
              } else {
                console.warn(LOG, "replaceWordSafely: insertText ejecutó pero innerText ≠ esperado; se prueba delete+insert.", {
                  afterLen: after.length,
                  expectedLen: newText.length,
                });
              }

              focusContentEditable(contentEditable);
              const delIns = tryReplaceViaExecCommandDeleteInsert(
                contentEditable,
                effOffset,
                effLen,
                replacement,
                sliceForDom,
                fullBefore
              );
              after = getPlainText(contentEditable);

              if (delIns.ok && after === newText) {
                uiPath = `execCommand_delete_insert_${delIns.via ?? "default"}`;
                console.info(LOG, "replaceWordSafely: UI via delete + insertText", { via: delIns.via, afterLen: after.length });
              } else {
                console.warn(LOG, "replaceWordSafely: delete+insert no dejó el texto esperado; innerText + ráfaga de eventos.", {
                  delIns,
                  afterLen: after.length,
                });

                focusContentEditable(contentEditable);
                const preEv = dispatchReactFriendlyInputBurstPhased(contentEditable, replacement, { phase: "beforeDom" });
                eventsFinal.push(...preEv.map((e) => `pre:${e}`));

                // Instagram re-render: re-leemos innerText justo antes de mutar; el plan ya validó offset/slice.
                const beforeAssign = getPlainText(contentEditable);
                contentEditable.innerText = newText;
                // InputEvent (insertReplacementText) en fase afterDom notifica al framework (ver dispatchReactFriendlyInputBurstPhased).
                after = getPlainText(contentEditable);
                console.info(LOG, "replaceWordSafely: post-innerText (antes de ráfaga input)", {
                  innerTextMatchesExpected: after === newText,
                  afterLen: after.length,
                  snippetAfter: after.slice(Math.max(0, effOffset - 8), effOffset + replacement.length + 8),
                });

                const postEv = dispatchReactFriendlyInputBurstPhased(contentEditable, replacement, { phase: "afterDom" });
                eventsFinal.push(...postEv);

                uiPath = after === newText ? "innerText_phased_events" : "innerText_phased_mismatch";

                if (after !== newText) {
                  console.warn(LOG, "replaceWordSafely: innerText no coincidió tras asignar; segundo intento + eventos.", {
                    afterLen: after.length,
                    beforeAssignLen: beforeAssign.length,
                  });
                  focusContentEditable(contentEditable);
                  contentEditable.innerText = newText;
                  eventsFinal.push(
                    ...dispatchReactFriendlyInputBurstPhased(contentEditable, replacement, { phase: "afterDom" }).map((e) => `retry:${e}`)
                  );
                  after = getPlainText(contentEditable);
                  uiPath = after === newText ? "innerText_retry_events" : uiPath;
                }
              }
            }

            if (after !== newText) {
              console.warn(LOG, "replaceWordSafely: aún sin coincidencia; insertText de mensaje completo.", {
                afterLen: after.length,
                expectedLen: newText.length,
              });
              focusContentEditable(contentEditable);
              const fullIns = tryReplaceEntireComposerPlain(contentEditable, newText);
              eventsFinal.push(`full_insert:${fullIns.ok ? "ok" : String(fullIns.reason)}`);
              after = getPlainText(contentEditable);
              if (after === newText) uiPath = "full_composer_insertText";
            }

            console.info(LOG, "replaceWordSafely: eventos tras mutación", { events: eventsFinal, uiPath });

            focusContentEditable(contentEditable);
            requestAnimationFrame(() => {
              setCaretAtGlobalOffset(contentEditable, caretPos);
              focusContentEditable(contentEditable);
            });

            void verifyPlainAfterPaint(contentEditable, newText).then((verified) => {
              let fullAfter = getPlainText(contentEditable);
              let uiActuallyUpdated = verified.ok;

              if (!verified.ok) {
                console.error(LOG, "replaceWordSafely: la UI no conservó el texto tras pintar (posible revert de React).", {
                  expectedLen: newText.length,
                  afterPaintLen: (verified.after ?? "").length,
                  afterPaintSample: (verified.after ?? "").slice(0, 120),
                });
                focusContentEditable(contentEditable);
                const typed = tryReplaceByCharTyping(contentEditable, newText);
                eventsFinal.push(`char_typing:${typed.ok ? "ok" : String(typed.reason)}`);
                fullAfter = getPlainText(contentEditable);
                uiActuallyUpdated = fullAfter === newText;
                if (!uiActuallyUpdated) {
                  console.error(LOG, "replaceWordSafely: FALLÓ tras todos los fallbacks; el editor no aceptó el cambio.", {
                    fullAfterLen: fullAfter.length,
                    fullAfterSample: fullAfter.slice(0, 160),
                  });
                }
              }

              const uiMatchesSync = fullAfter === newText;

              console.info(LOG, "replaceWordSafely RESULT", {
                matchIndex,
                strategy: plan.strategy,
                uiPath,
                uiMatchesSync,
                uiActuallyUpdated,
                verifiedAfterPaint: verified.ok,
                fullTextAfter: fullAfter,
                expectedText: newText,
                eventsDispatched: eventsFinal,
              });

              resolve({
                ok: uiActuallyUpdated,
                strategy: plan.strategy,
                uiPath,
                uiMatches: uiMatchesSync,
                uiActuallyUpdated,
                reason: uiActuallyUpdated ? undefined : "ui_rejected_after_fallbacks",
              });
            });
          } catch (err) {
            console.error(LOG, "replaceWordSafely exception", err);
            resolve({ ok: false, reason: "exception", strategy: "none", uiPath: "none" });
          }
        });
      });
    });
  }

  /**
   * @param {HTMLElement} root
   * @param {EditorSpellState["matches"][number]} match
   */
  function bindSuggestionClickHandlers(root, match) {
    const tip = tooltipEl;
    if (!tip) return;

    tip.querySelectorAll("button.fb-spell-suggestion").forEach((btn) => {
      const onClick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation();

        const state = spellStateByRoot.get(root);
        const snapshotText = state?.snapshotText ?? "";
        if (!state || snapshotText.length === 0) {
          hideTooltip();
          return;
        }

        const word = (btn.textContent ?? "").trim();

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            void replaceWordSafely(root, match.offset, match.length, word, {
              fullTextSnapshot: snapshotText,
              expectedWord: match.originalSlice,
              matchIndex: match.matchIndex,
            }).then((res) => {
              console.info(LOG, "Reemplazo aplicado", {
                platform: detectPlatform(),
                ok: res.ok,
                strategy: res.strategy,
                uiPath: res.uiPath,
                reason: res.reason,
              });
              hideTooltip();
              spellStateByRoot.delete(root);
              clearOverlayMarksForRoot(root);
              if (res.ok) {
                scheduleCheck(root);
              }
            });
          });
        });
      };
      btn.addEventListener("click", onClick, { capture: true });
    });
  }

  /**
   * @param {HTMLElement} root
   * @param {any[]} matches
   * @param {string} snapshotText
   */
  function renderOverlayMarks(root, matches, snapshotText) {
    clearOverlayMarksForRoot(root);
    const rootId = ensureRootId(root);

    matches.forEach((m, index) => {
      const range = createRangeForOffset(root, m.offset, m.length);
      if (!range) {
        return;
      }
      const rect = range.getBoundingClientRect();
      if (rect.width < 1 && rect.height < 1) {
        return;
      }

      const mark = document.createElement("div");
      mark.className = OVERLAY_MARK;
      mark.dataset.fbSpellRootId = rootId;
      mark.dataset.fbSpellMatchIndex = String(index);
      mark.setAttribute("role", "button");
      mark.setAttribute("aria-label", "Error ortográfico");
      mark.style.left = `${rect.left}px`;
      mark.style.top = `${rect.top}px`;
      mark.style.width = `${rect.width}px`;
      mark.style.height = `${rect.height}px`;

      document.documentElement.appendChild(mark);
    });
  }

  /**
   * @param {HTMLElement} root
   */
  function repositionOverlaysIfFresh(root) {
    const state = spellStateByRoot.get(root);
    if (!state) return;
    const now = getPlainText(root);
    if (now !== state.snapshotText) {
      clearOverlayMarksForRoot(root);
      spellStateByRoot.delete(root);
      return;
    }
    clearOverlayMarksForRoot(root);
    state.matches.forEach((m, index) => {
      const range = createRangeForOffset(root, m.offset, m.length);
      if (!range) return;
      const rect = range.getBoundingClientRect();
      if (rect.width < 1 && rect.height < 1) return;
      const mark = document.createElement("div");
      mark.className = OVERLAY_MARK;
      mark.dataset.fbSpellRootId = state.rootId;
      mark.dataset.fbSpellMatchIndex = String(index);
      mark.setAttribute("role", "button");
      mark.style.left = `${rect.left}px`;
      mark.style.top = `${rect.top}px`;
      mark.style.width = `${rect.width}px`;
      mark.style.height = `${rect.height}px`;
      document.documentElement.appendChild(mark);
    });
  }

  document.addEventListener(
    "click",
    (e) => {
      const t = /** @type {HTMLElement} */ (e.target);
      if (tooltipEl && tooltipEl.contains(t)) return;
      if (t.closest?.(".fb-spell-tooltip")) return;

      const mark = t.closest?.(`.${OVERLAY_MARK}`);
      if (mark instanceof HTMLElement) {
        const rootId = mark.dataset.fbSpellRootId;
        const idx = Number(mark.dataset.fbSpellMatchIndex);
        const root = document.querySelector(`[data-fb-spell-root-id="${CSS.escape(rootId || "")}"]`);
        if (!(root instanceof HTMLElement)) {
          hideTooltip();
          return;
        }
        const state = spellStateByRoot.get(root);
        const match = state && Number.isFinite(idx) ? state.matches[idx] : null;
        if (!match) {
          hideTooltip();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        const rect = mark.getBoundingClientRect();

        hideTooltip();
        showTooltipNearRect(rect, match);
        bindSuggestionClickHandlers(root, match);
        return;
      }

      hideTooltip();
    },
    true
  );

  /**
   * @param {HTMLElement} root
   */
  async function runCheck(root) {
    if (!prefs.enabled) return;
    if (!root.isConnected) return;
    if (composingByRoot.get(root)) {
      return;
    }
    if (weakCheckInFlight.has(root)) {
      console.info(LOG, "runCheck omitido (ya en vuelo)", { platform: detectPlatform() });
      return;
    }
    weakCheckInFlight.add(root);
    try {
      removeLegacySpansInside(root);
      clearOverlayMarksForRoot(root);

      const text = getPlainText(root);
      console.info(LOG, "Texto extraído (innerText)", {
        platform: detectPlatform(),
        len: text.length,
        sample: text.slice(0, 80),
      });

      if (!text.trim()) {
        spellStateByRoot.delete(root);
        return;
      }

      const key = utils.cacheKey(text, prefs.language);
      let normalized;

      if (resultCache.has(key)) {
        const cached = resultCache.get(key);
        normalized = cached ?? { matches: [], detected: undefined };
      } else {
        /** @type {any} */
        const resp = await chrome.runtime.sendMessage({
          type: "SPELLCHECK_CHECK",
          payload: { text, language: prefs.language },
        });

        if (!resp?.ok) {
          console.warn(LOG, "Error API:", resp?.error ?? resp);
          spellStateByRoot.delete(root);
          return;
        }

        normalized = utils.normalizeResponse(resp.data);
        resultCache.set(key, normalized);
        pruneCache();
      }

      const valid = prepareMatchesForUi(text, normalized.matches);

      if (valid.length === 0) {
        spellStateByRoot.delete(root);
        return;
      }

      const rootId = ensureRootId(root);
      spellStateByRoot.set(root, { snapshotText: text, matches: valid, rootId });
      renderOverlayMarks(root, valid, text);

      console.info(LOG, "Errores encontrados (LanguageTool)", {
        platform: detectPlatform(),
        count: valid.length,
        matches: valid,
      });
    } catch (err) {
      console.error(LOG, "runCheck excepción", err);
      spellStateByRoot.delete(root);
    } finally {
      weakCheckInFlight.delete(root);
    }
  }

  /**
   * @param {HTMLElement} root
   */
  function scheduleCheck(root) {
    if (!prefs.enabled) return;
    if (!debouncers.has(root)) {
      debouncers.set(
        root,
        utils.debounce(() => {
          runCheck(root).catch((e) => console.error(LOG, "runCheck", e));
        }, utils.DEBOUNCE_MS)
      );
    }
    debouncers.get(root)?.();
  }

  /**
   * @param {HTMLElement} el
   */
  function attachRoot(el) {
    if (!(el instanceof HTMLElement)) return;
    if (el.dataset.fbSpellAttached === "1" || weakAttachRegistered.has(el)) return;

    const platform = detectPlatform();
    if (platform === "instagram") {
      if (!isValidInstagramInput(el)) return;
    } else if (platform === "facebook") {
      if (!isValidFacebookInput(el)) return;
    } else if (!isValidFacebookInput(el)) {
      return;
    }

    el.dataset.fbSpellAttached = "1";
    weakAttachRegistered.add(el);

    console.info(LOG, "Input detectado (listeners adjuntos)", {
      platform,
      tag: el.tagName,
      path: (location.pathname || "").slice(0, 64),
    });

    composingByRoot.set(el, false);

    el.addEventListener(
      "compositionstart",
      () => {
        composingByRoot.set(el, true);
      },
      true
    );
    el.addEventListener(
      "compositionend",
      () => {
        composingByRoot.set(el, false);
        handleInput(el);
      },
      true
    );

    el.addEventListener(
      "input",
      () => {
        if (composingByRoot.get(el)) return;
        clearOverlayMarksForRoot(el);
        spellStateByRoot.delete(el);
        handleInput(el);
      },
      true
    );
  }

  function scanAndAttach(node) {
    const scope = node instanceof HTMLElement ? node : document;
    getEditableElements(scope).forEach((el) => attachRoot(el));
  }

  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      m.addedNodes.forEach((n) => {
        if (n instanceof HTMLElement) {
          getEditableElements(n).forEach((el) => attachRoot(el));
        }
      });
    }
  });

  /**
   * Instagram re-monta nodos; priorizamos el árbol contentEditable desde el target de focusin.
   * @param {FocusEvent} e
   */
  function onDocumentFocusCapture(e) {
    const t = findContentEditableRootFromEventTarget(e.target);
    if (!t) return;
    const platform = detectPlatform();
    if (platform === "instagram") {
      if (isValidInstagramInput(t)) {
        attachRoot(t);
        handleInput(t);
      }
    } else if (platform === "facebook") {
      if (isValidFacebookInput(t)) {
        attachRoot(t);
        handleInput(t);
      }
    }
  }

  /**
   * Refuerzo ante IME / frameworks: el nodo activo puede no ser el target del evento.
   */
  function onDocumentInputCapture() {
    const ae = document.activeElement;
    if (!(ae instanceof HTMLElement) || ae.isContentEditable !== true) return;
    const platform = detectPlatform();
    if (platform === "instagram") {
      if (isValidInstagramInput(ae)) {
        attachRoot(ae);
        handleInput(ae);
      }
    } else if (platform === "facebook") {
      if (isValidFacebookInput(ae)) {
        attachRoot(ae);
        handleInput(ae);
      }
    }
  }

  function onScrollOrResize() {
    document.querySelectorAll(SEL_EDITABLE).forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      if (!el.dataset.fbSpellRootId) return;
      requestAnimationFrame(() => repositionOverlaysIfFresh(el));
    });
  }

  window.addEventListener("scroll", onScrollOrResize, true);
  window.addEventListener("resize", onScrollOrResize);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if ("fbSpellEnabled" in changes) {
      prefs.enabled = changes.fbSpellEnabled?.newValue !== false;
      if (!prefs.enabled) {
        clearEveryOverlay();
        document.querySelectorAll(SEL_EDITABLE).forEach((el) => {
          if (el instanceof HTMLElement) {
            removeLegacySpansInside(el);
            spellStateByRoot.delete(el);
          }
        });
        hideTooltip();
      }
    }
    if ("fbSpellLanguage" in changes) {
      const v = changes.fbSpellLanguage?.newValue;
      prefs.language = typeof v === "string" && v ? v : "auto";
      resultCache.clear();
      clearEveryOverlay();
      document.querySelectorAll(SEL_EDITABLE).forEach((el) => {
        if (el instanceof HTMLElement) spellStateByRoot.delete(el);
      });
    }
    if ("fbSpellPopupTheme" in changes) {
      const v = changes.fbSpellPopupTheme?.newValue;
      applyPagePopupTheme(typeof v === "string" ? v : "system");
    }
  });

  loadPrefs();
  console.info(LOG, "Plataforma detectada", { platform: detectPlatform(), host: location.hostname });
  scanAndAttach(document);
  mo.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("focusin", onDocumentFocusCapture, true);
  document.addEventListener("input", onDocumentInputCapture, true);

  console.info(LOG, "Activo: overlay + LanguageTool (innerText + replaceWordSafely; Instagram + Facebook).");
})();
