import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import {
  getEndpoints,
  getEndpointByName,
  getDefaultEndpoint,
} from "./services";
import { translateText } from "./translate";

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
      icon: `chrome://${addon.data.config.addonRef}/content/icons/favicon.png`,
    },
    sidenav: {
      l10nID: `${addon.data.config.addonRef}-sidebar-title`,
      icon: `chrome://${addon.data.config.addonRef}/content/icons/favicon.png`,
    },
    bodyXHTML: `<html:div
      xmlns:html="http://www.w3.org/1999/xhtml"
      id="${BODY_ID}"
      style="display:flex;flex-direction:column;gap:6px;padding:2px 8px 8px 8px;height:780px;overflow:hidden;"
    >
      <html:div style="display:flex;gap:6px;align-items:center;flex:none;">
        <html:select id="lpcteam-sidebar-engine" style="flex:1;font-size:12px;"></html:select>
        <html:label style="display:flex;align-items:center;gap:3px;font-size:12px;flex:none;">
          <html:input type="checkbox" id="lpcteam-sidebar-concat"></html:input>${getString("sidebar-concat")}
        </html:label>
        <html:button id="lpcteam-sidebar-copy" style="font-size:12px;">${getString("sidebar-copy")}</html:button>
      </html:div>
      <html:div id="lpcteam-sidebar-source" style="
        color:#666;font-size:12px;white-space:pre-wrap;max-height:70px;min-height:22px;
        overflow-y:auto;padding:4px 6px;background:rgba(128,128,128,0.08);
        border-radius:4px;flex:none;">${getString("sidebar-hint")}</html:div>
      <html:div id="lpcteam-sidebar-result" style="
        font-size:13px;white-space:pre-wrap;padding:4px 6px;
        border-left:3px solid #38a169;background:rgba(56,161,105,0.06);
        border-radius:2px;flex:1;overflow-y:auto;"></html:div>
    </html:div>`,
    onRender: ({ body }: { body: HTMLElement }) => {
      initPanelEvents(body);
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
 * Find the sidebar body that currently lives in a Zotero window.
 * Sections are re-created when tabs/documents change, so the element
 * must be resolved at use time instead of being cached.
 */
function findBody(): HTMLElement | undefined {
  for (const win of Zotero.getMainWindows()) {
    const el = (win as unknown as Window).document?.getElementById(BODY_ID);
    if (el) {
      return el as HTMLElement;
    }
  }
  return undefined;
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

  const engine = doc.getElementById(
    "lpcteam-sidebar-engine",
  ) as HTMLSelectElement;
  if (engine) {
    for (const ep of getEndpoints()) {
      const opt = doc.createElement("option");
      opt.value = ep.name;
      opt.textContent = ep.name;
      engine.appendChild(opt);
    }
    const def = getDefaultEndpoint();
    if (def && engine.options.length) {
      engine.value = def.name;
    }
    engine.addEventListener("change", () => {
      // engine switched: retranslate what is shown
      retranslate();
    });
  }
  doc
    .getElementById("lpcteam-sidebar-concat")
    ?.addEventListener("change", (e: Event) => {
      if ((e.target as HTMLInputElement).checked) {
        // entering concat mode: the text currently shown becomes the
        // first part of the concatenation
        concatBuffer = currentSource || concatBuffer;
      } else {
        // leaving concat mode resets the buffer
        concatBuffer = "";
      }
    });
  doc.getElementById("lpcteam-sidebar-copy")?.addEventListener("click", () => {
    const text =
      doc.getElementById("lpcteam-sidebar-result")?.textContent || "";
    Zotero.Utilities.Internal.copyTextToClipboard(text);
  });
}

function retranslate() {
  if (currentSource) {
    const doc = findBody()?.ownerDocument;
    const engine = doc?.getElementById(
      "lpcteam-sidebar-engine",
    ) as HTMLSelectElement;
    runTranslation(currentSource, engine?.value);
  }
}

function showSourceOnly(text: string) {
  const doc = findBody()?.ownerDocument;
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
      text = text.trim();
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
  const doc = findBody()?.ownerDocument;
  const box = doc?.getElementById(
    "lpcteam-sidebar-concat",
  ) as HTMLInputElement | null;
  return !!box?.checked;
}

async function runTranslation(text: string, engineName?: string) {
  const doc = findBody()?.ownerDocument;
  const sourceEl = doc?.getElementById(
    "lpcteam-sidebar-source",
  ) as HTMLElement | null;
  const resultEl = doc?.getElementById(
    "lpcteam-sidebar-result",
  ) as HTMLElement | null;
  if (!doc || !sourceEl || !resultEl) {
    return;
  }
  sourceEl.textContent = text;
  resultEl.textContent = "…";
  resultEl.style.borderLeftColor = "#b7791f";
  const engine = doc.getElementById(
    "lpcteam-sidebar-engine",
  ) as HTMLSelectElement;
  const endpoint =
    (engineName && getEndpointByName(engineName)) ||
    (engine && getEndpointByName(engine.value)) ||
    getDefaultEndpoint();
  try {
    await translateText(text, endpoint, (_delta, full) => {
      resultEl.textContent = full;
    });
    resultEl.style.borderLeftColor = "#38a169";
  } catch (e) {
    resultEl.style.borderLeftColor = "#c53030";
    resultEl.textContent = e instanceof Error ? e.message : String(e);
  }
}
