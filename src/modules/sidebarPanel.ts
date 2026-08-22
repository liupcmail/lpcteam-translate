import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import {
  getEndpoints,
  getEndpointByName,
  getDefaultEndpoint,
} from "./services";
import { normalizeSelectionText, translateText } from "./translate";

const PANE_ID = "lpcteamtranslate-section";
const BODY_ID = "lpcteamtranslate-sidebar-body";

let polling = false;
/** last raw selection seen, for de-duplication */
let lastSelectionText = "";
/** selection waiting to settle (same text across polls) */
let pendingText = "";
let pendingStableCount = 0;
/** accumulated source while concat mode is on */
let concatBuffer = "";
/** what is currently shown / translated */
let currentSource = "";
/** engine chosen in any panel instance */
let currentEngineName = "";
/** concat checkbox state, mirrored from any panel instance */
let concatEnabled = false;

/**
 * Register the translation panel as a right-sidebar section.
 * It is visible in the item pane, including while reading a PDF.
 */
export function registerSidebarPanel() {
  Zotero.ItemPaneManager.registerSection({
    paneID: PANE_ID,
    pluginID: addon.data.config.addonID,
    header: {
      l10nID: `${addon.data.config.addonRef}-sidebar-title`,
      // vector icon: razor-sharp at any display density.
      // Separate files so header and sidenav sizes are independent.
      icon: `chrome://${addon.data.config.addonRef}/content/icons/favicon-vector.svg`,
    },
    sidenav: {
      l10nID: `${addon.data.config.addonRef}-sidebar-title`,
      icon: `chrome://${addon.data.config.addonRef}/content/icons/favicon-vector-sidenav.svg`,
    },
    bodyXHTML: `<html:div
      xmlns:html="http://www.w3.org/1999/xhtml"
      xmlns:xul="http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul"
      id="${BODY_ID}"
      style="display:flex;flex-direction:column;gap:6px;padding:2px 8px 8px 8px;height:780px;overflow:hidden;"
    >
      <html:div style="display:flex;gap:6px;align-items:center;flex:none;">
        <xul:menulist id="lpcteam-sidebar-engine" sizetopopup="none" flex="1" style="font-size:12px;margin:0;">
          <xul:menupopup id="lpcteam-sidebar-engine-popup"></xul:menupopup>
        </xul:menulist>
        <html:label style="display:flex;align-items:center;gap:3px;font-size:12px;flex:none;">
          <html:input type="checkbox" id="lpcteam-sidebar-concat"></html:input>${getString("sidebar-concat")}
        </html:label>
        <html:button id="lpcteam-sidebar-clear" style="font-size:12px;">${getString("sidebar-clear")}</html:button>
      </html:div>
      <html:div id="lpcteam-sidebar-source" style="
        color:#999;font-size:12px;white-space:pre-wrap;height:88px;
        overflow-y:auto;padding:4px 6px;background:rgba(128,128,128,0.08);
        border-radius:4px;flex:none;">${getString("sidebar-placeholder")}</html:div>
      <html:div id="lpcteam-sidebar-result" class="placeholder" style="
        font-size:13px;white-space:pre-wrap;padding:4px 6px;
        border-left:3px solid #38a169;background:rgba(56,161,105,0.06);
        border-radius:2px;flex:1;overflow-y:auto;">${getString("sidebar-result-placeholder")}</html:div>
    </html:div>`,
    onRender: ({ body }: { body: HTMLElement }) => {
      initPanelEvents(body);
      try {
        const section = body.closest("collapsible-section");
        if (!section) {
          return;
        }
        // Detach the section from fluent: Zotero serializes an invalid
        // data-l10n-args="undefined", and the ASYNC localization pass
        // then clears the title after any synchronous write. Without
        // data-l10n-id, fluent ignores the element entirely.
        section.removeAttribute("data-l10n-id");
        section.removeAttribute("data-l10n-args");
        const setTitle = () => {
          const t = section.querySelector(".title");
          if (t) {
            t.textContent = addon.data.config.addonName;
          }
          // also strip any label rendered on the sidenav strip button
          const doc = section.ownerDocument;
          if (!doc) {
            return;
          }
          // once per document: contain-fit wherever our icon renders,
          // so the 64px source always scales down instead of clipping
          if (!doc.getElementById("lpcteamtranslate-icon-style")) {
            const style = doc.createElement("style");
            style.id = "lpcteamtranslate-icon-style";
            style.textContent = `
              [data-pane*="lpcteamtranslate"] {
                background-size: contain !important;
                background-repeat: no-repeat !important;
                background-position: center !important;
              }
              #lpcteam-sidebar-result.placeholder {
                color: #999;
              }`;
            (doc.documentElement || doc).appendChild(style);
          }
          for (const btn of doc.querySelectorAll(
            `.btn[data-pane*="${PANE_ID}"], .btn[data-pane*="lpcteamtranslate"]`,
          )) {
            (btn as HTMLElement).textContent = "";
            btn.removeAttribute("label");
            btn.removeAttribute("aria-label");
            // the sidenav icon is a CSS background image: make sure it
            // never overflows the button box regardless of file size
            (btn as HTMLElement).style.backgroundSize = "contain";
            (btn as HTMLElement).style.backgroundRepeat = "no-repeat";
            (btn as HTMLElement).style.backgroundPosition = "center";
            // light glyph variant for dark themes (sidenav size)
            (btn as HTMLElement).style.setProperty(
              "--custom-sidenav-icon-dark",
              `url('chrome://${addon.data.config.addonRef}/content/icons/favicon-vector-sidenav-dark.svg')`,
            );
          }
        };
        setTitle();
        // re-apply once more after fluent's pass, just in case
        Zotero.Promise.delay(600).then(setTitle);
      } catch {
        // header internals may differ across Zotero versions
      }
    },
  });
}

export function unregisterSidebarPanel() {
  try {
    Zotero.ItemPaneManager.unregisterSection(PANE_ID);
  } catch {
    // section may already be gone
  }
}

/**
 * Find the sidebar body that is actually visible. Zotero renders one
 * section instance per item-pane context (library tab, each reader
 * tab...), so several elements share the same ID and only the one in
 * the active context is on screen. Pick the instance that has real
 * layout inside the window viewport.
 */
/**
 * All currently laid-out panel instances (one per item-pane context).
 * Writes go to every instance so whichever one the user is looking at
 * stays correct.
 */
function findBodies(): HTMLElement[] {
  const bodies: HTMLElement[] = [];
  for (const zWin of Zotero.getMainWindows()) {
    const doc = (zWin as unknown as Window).document;
    if (!doc) {
      continue;
    }
    const instances = Array.from(
      doc.querySelectorAll(`#${BODY_ID}`),
    ) as HTMLElement[];
    for (const el of instances) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 50 || rect.height < 50) {
        continue;
      }
      if ((el as any).checkVisibility?.() === false) {
        continue;
      }
      bodies.push(el);
    }
  }
  return bodies;
}

function findBody(): HTMLElement | undefined {
  return findBodies()[0];
}

function initPanelEvents(body: HTMLElement) {
  if ((body as any)._lpcteamInited) {
    return;
  }
  (body as any)._lpcteamInited = true;
  const doc = body.ownerDocument;
  if (!doc) {
    return;
  }

  // scope lookups to THIS instance: several item-pane contexts share
  // the same IDs, and document-wide getElementById would hit the first
  // instance's controls instead of this one's
  const engine = body.querySelector("#lpcteam-sidebar-engine") as any;
  const enginePopup = body.querySelector("#lpcteam-sidebar-engine-popup");
  if (engine && enginePopup && enginePopup.children.length === 0) {
    for (const ep of getEndpoints()) {
      const item = doc.createXULElement("menuitem");
      item.setAttribute("label", ep.name);
      item.setAttribute("value", ep.name);
      enginePopup.appendChild(item);
    }
    engine.value = currentEngineName || getDefaultEndpoint()?.name || "";
    engine.addEventListener("command", () => {
      currentEngineName = engine.value;
      // engine switched: retranslate what is shown
      retranslate();
    });
  }
  body
    .querySelector("#lpcteam-sidebar-concat")
    ?.addEventListener("change", (e: Event) => {
      concatEnabled = (e.target as HTMLInputElement).checked;
      if (concatEnabled) {
        // entering concat mode: the text currently shown becomes the
        // first part of the concatenation
        concatBuffer = currentSource || concatBuffer;
      } else {
        // leaving concat mode resets the buffer
        concatBuffer = "";
      }
    });
  body
    .querySelector("#lpcteam-sidebar-clear")
    ?.addEventListener("click", () => {
      clearPanel();
    });
}

/**
 * Clear the panel: source and result areas in every instance, plus
 * the accumulated concat buffer and selection memory (so selecting
 * the same text again re-triggers translation).
 */
function clearPanel() {
  currentSource = "";
  concatBuffer = "";
  lastSelectionText = "";
  for (const body of findBodies()) {
    const doc = body.ownerDocument;
    if (!doc) {
      continue;
    }
    const sourceEl = body.querySelector(
      "#lpcteam-sidebar-source",
    ) as HTMLElement | null;
    const resultEl = body.querySelector(
      "#lpcteam-sidebar-result",
    ) as HTMLElement | null;
    if (sourceEl) {
      sourceEl.textContent = getString("sidebar-placeholder");
    }
    if (resultEl) {
      resultEl.textContent = getString("sidebar-result-placeholder");
      resultEl.classList.add("placeholder");
      resultEl.style.setProperty("border-left-color", "#38a169");
    }
  }
}

function retranslate() {
  if (currentSource) {
    runTranslation(currentSource, currentEngineName || undefined);
  }
}

function showSourceOnly(text: string) {
  for (const body of findBodies()) {
    const doc = body.ownerDocument;
    const sourceEl = doc?.getElementById(
      "lpcteam-sidebar-source",
    ) as HTMLElement | null;
    const resultEl = doc?.getElementById(
      "lpcteam-sidebar-result",
    ) as HTMLElement | null;
    if (sourceEl) {
      sourceEl.textContent = text;
    }
    if (resultEl) {
      resultEl.textContent = getString("sidebar-auto-off");
      resultEl.style.borderLeftColor = "#b7791f";
    }
  }
}

/**
 * Watch the active reader tab for text selection changes and
 * auto-translate into the sidebar panel. With concat mode enabled,
 * consecutive selections are joined (useful for paragraphs split
 * across pages) and translated together.
 */
export async function startSelectionWatcher() {
  if (polling) {
    return;
  }
  polling = true;
  while (polling && addon.data.alive) {
    try {
      const tabs = ztoolkit.getGlobal("Zotero_Tabs");
      const reader = Zotero.Reader.getByTabID(tabs.selectedID) as any;
      const internal = reader?._internalReader;
      // Primary source: the live window selection of the reader iframe
      const iframeWin =
        internal?._primaryView?._iframeWindow ||
        internal?._lastView?._iframeWindow;
      let text = "";
      try {
        text = iframeWin?.getSelection?.()?.toString() || "";
      } catch {
        // selection may be mid-change; try next cycle
      }
      // Fallback: the temp annotation attached to the selection popup
      if (!text) {
        text = internal?._lastView?._selectionPopup?.annotation?.text || "";
      }
      text = normalizeSelectionText(text);
      // Wait until the selection has settled (unchanged across two
      // polls, ~1.2s): during a drag, every intermediate state is a
      // different text and must not be translated or concatenated.
      if (text && text === pendingText) {
        pendingStableCount++;
      } else {
        pendingText = text;
        pendingStableCount = 1;
      }
      const settled = text && pendingStableCount >= 2;
      if (settled && text !== lastSelectionText) {
        lastSelectionText = text;
        const concatChecked = isConcatChecked();
        if (concatChecked) {
          concatBuffer = concatBuffer ? `${concatBuffer}\n${text}` : text;
          currentSource = concatBuffer;
        } else {
          concatBuffer = "";
          currentSource = text;
        }
        if (getPref("autoTranslate") !== false) {
          runTranslation(currentSource);
        } else {
          showSourceOnly(currentSource);
        }
      }
    } catch {
      // reader internals changed; keep polling
    }
    await Zotero.Promise.delay(600);
  }
}

export function stopSelectionWatcher() {
  polling = false;
}

function isConcatChecked() {
  return concatEnabled;
}

async function runTranslation(text: string, engineName?: string) {
  const bodies = findBodies();
  if (!bodies.length) {
    return;
  }
  const targets = bodies.map((body) => {
    const doc = body.ownerDocument!;
    return {
      body,
      sourceEl: body.querySelector(
        "#lpcteam-sidebar-source",
      ) as HTMLElement | null,
      resultEl: body.querySelector(
        "#lpcteam-sidebar-result",
      ) as HTMLElement | null,
    };
  });
  for (const t of targets) {
    if (t.sourceEl) {
      t.sourceEl.textContent = text;
    }
    if (t.resultEl) {
      t.resultEl.classList.remove("placeholder");
      t.resultEl.textContent = "…";
      t.resultEl.style.borderLeftColor = "#b7791f";
    }
    // The section sits at the end of the item pane and is often below
    // the fold: when it is not properly visible, scroll it to the top
    // of the pane.
    try {
      const win = t.body.ownerDocument?.defaultView as Window | null;
      if (win) {
        const rect = t.body.getBoundingClientRect();
        if (rect.top < 0 || rect.top > win.innerHeight - 120) {
          t.body.scrollIntoView({ block: "start" });
        }
      }
    } catch {
      // ignore
    }
  }
  const endpoint =
    (engineName && getEndpointByName(engineName)) ||
    (currentEngineName && getEndpointByName(currentEngineName)) ||
    getDefaultEndpoint();
  try {
    await translateText(text, endpoint, (_delta, full) => {
      for (const t of targets) {
        if (t.resultEl) {
          t.resultEl.textContent = full;
        }
      }
    });
    for (const t of targets) {
      t.resultEl?.style.setProperty("border-left-color", "#38a169");
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    for (const t of targets) {
      if (t.resultEl) {
        t.resultEl.style.setProperty("border-left-color", "#c53030");
        t.resultEl.textContent = message;
      }
    }
  }
}
