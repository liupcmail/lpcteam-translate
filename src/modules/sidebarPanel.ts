import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import {
  getEndpoints,
  getEndpointByName,
  getDefaultEndpoint,
} from "./services";
import { translateText } from "./translate";

const PANE_ID = "lpcteamtranslate-section";

let panelElement: HTMLElement | undefined;
let lastTranslatedText = "";
let polling = false;

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
      id="lpcteamtranslate-sidebar-body"
      style="display:flex;flex-direction:column;gap:6px;padding:4px 8px 8px 8px;"
    >
      <html:div id="lpcteam-sidebar-source" style="
        color:#666;font-size:12px;white-space:pre-wrap;max-height:90px;
        overflow-y:auto;padding:4px 6px;background:rgba(128,128,128,0.08);
        border-radius:4px;">${getString("sidebar-hint")}</html:div>
      <html:div id="lpcteam-sidebar-result" style="
        font-size:13px;white-space:pre-wrap;min-height:40px;padding:4px 6px;
        border-left:3px solid #38a169;background:rgba(56,161,105,0.06);
        border-radius:2px;"></html:div>
      <html:div style="display:flex;gap:6px;align-items:center;">
        <html:select id="lpcteam-sidebar-engine" style="flex:1;font-size:12px;"></html:select>
        <html:button id="lpcteam-sidebar-copy" style="font-size:12px;">${getString("sidebar-copy")}</html:button>
        <html:button id="lpcteam-sidebar-retranslate" style="font-size:12px;">${getString("sidebar-retranslate")}</html:button>
      </html:div>
    </html:div>`,
    onRender: ({ body }: { body: HTMLElement }) => {
      panelElement = body;
      initPanelEvents();
    },
    onDestroy: () => {
      panelElement = undefined;
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

function initPanelEvents() {
  if (!panelElement?.ownerDocument) {
    return;
  }
  const doc = panelElement.ownerDocument;
  const engine = doc.getElementById(
    "lpcteam-sidebar-engine",
  ) as HTMLSelectElement;
  if (engine && engine.options.length === 0) {
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
      // engine changed: retranslate what is shown
      retranslate();
    });
  }
  doc.getElementById("lpcteam-sidebar-copy")?.addEventListener("click", () => {
    const text =
      doc.getElementById("lpcteam-sidebar-result")?.textContent || "";
    Zotero.Utilities.Internal.copyTextToClipboard(text);
  });
  doc
    .getElementById("lpcteam-sidebar-retranslate")
    ?.addEventListener("click", () => {
      retranslate();
    });
}

function retranslate() {
  if (lastTranslatedText) {
    const doc = panelElement?.ownerDocument;
    const engine = doc?.getElementById(
      "lpcteam-sidebar-engine",
    ) as HTMLSelectElement;
    runTranslation(lastTranslatedText, engine?.value);
  }
}

function showSourceOnly(text: string) {
  const doc = panelElement?.ownerDocument;
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
 * auto-translate into the sidebar panel.
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
      if (
        text &&
        text !== lastTranslatedText &&
        getPref("autoTranslate") !== false
      ) {
        lastTranslatedText = text;
        runTranslation(text);
      } else if (text && text !== lastTranslatedText) {
        // auto-translate off: still remember and show the source
        lastTranslatedText = text;
        showSourceOnly(text);
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

async function runTranslation(text: string, engineName?: string) {
  const doc = panelElement?.ownerDocument;
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
