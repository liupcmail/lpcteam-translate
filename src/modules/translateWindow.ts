import { getEndpoints, getDefaultEndpoint } from "./services";
import { translateText } from "./translate";

interface WindowEntry {
  source: string;
  sourceEl: HTMLElement;
  resultEl: HTMLElement;
}

/**
 * The translate result window: two side-by-side panes with a draggable
 * splitter (original left, translation right), engine selector on top.
 * One shared instance keeps engine selection and position.
 */
let activeWindow: Window | undefined;

export function openTranslateWindow(): Promise<Window> {
  if (activeWindow && !activeWindow.closed) {
    activeWindow.focus();
    return Promise.resolve(activeWindow);
  }
  const win = Zotero.getMainWindow().openDialog(
    `chrome://${addon.data.config.addonRef}/content/translateWindow.xhtml`,
    "lpcteamtranslate-translate-window",
    "chrome,dialog=yes,centerscreen,resizable=yes",
  ) as unknown as Window;
  return new Promise((resolve) => {
    win.addEventListener(
      "load",
      () => {
        initWindowUI(win);
        resolve(win);
      },
      { once: true },
    );
    activeWindow = win;
  });
}

function initWindowUI(win: Window) {
  const doc = win.document;
  (win as any)._lpcteamEntries = [] as WindowEntry[];

  const selector = doc.getElementById("engine-selector") as any;
  const popup = doc.getElementById("engine-popup")!;
  for (const ep of getEndpoints()) {
    const item = doc.createXULElement("menuitem");
    item.setAttribute("label", ep.name);
    item.setAttribute("value", ep.name);
    popup.appendChild(item);
  }
  const defaultEp = getDefaultEndpoint();
  if (defaultEp) {
    selector.value = defaultEp.name;
  }
  selector.addEventListener("command", () => {
    // Engine switched: retranslate everything currently shown
    const entries: WindowEntry[] = (win as any)._lpcteamEntries || [];
    const name = selector.value;
    for (const entry of entries) {
      translateEntry(win, entry, name);
    }
  });

  doc.getElementById("close-btn")!.addEventListener("command", () => {
    win.close();
  });
  doc.getElementById("copy-btn")!.addEventListener("command", () => {
    const entries: WindowEntry[] = (win as any)._lpcteamEntries || [];
    const text = entries
      .map((e) => e.resultEl.textContent || "")
      .filter(Boolean)
      .join("\n\n");
    Zotero.Utilities.Internal.copyTextToClipboard(text);
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({ text: "Copied", progress: 100 })
      .show();
  });

  initSplitter(win);
}

/**
 * Drag the vertical splitter to resize the two panes.
 */
function initSplitter(win: Window) {
  const doc = win.document;
  const splitter = doc.getElementById("splitter")!;
  const sourcePane = doc.getElementById("source-pane") as HTMLElement;
  const panes = doc.getElementById("panes") as HTMLElement;
  splitter.addEventListener("mousedown", (e: MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sourcePane.getBoundingClientRect().width;
    const total = panes.getBoundingClientRect().width;
    const onMove = (ev: MouseEvent) => {
      const pct = ((startWidth + ev.clientX - startX) / total) * 100;
      const clamped = Math.min(80, Math.max(15, pct));
      sourcePane.style.flexBasis = `${clamped}%`;
    };
    const onUp = () => {
      doc.removeEventListener("mousemove", onMove);
      doc.removeEventListener("mouseup", onUp);
    };
    doc.addEventListener("mousemove", onMove);
    doc.addEventListener("mouseup", onUp);
  });
}

/**
 * Append one source text to the window and translate it with the
 * currently selected engine (or `engineName` when given).
 */
export async function addEntryAndTranslate(
  win: Window,
  source: string,
  engineName?: string,
) {
  const doc = win.document;
  const entries: WindowEntry[] = (win as any)._lpcteamEntries || [];

  const sourceBlock = doc.createElement("div");
  sourceBlock.className = "entry";
  const sourceEl = doc.createElement("div");
  sourceEl.className = "source";
  sourceEl.textContent = source;
  sourceBlock.appendChild(sourceEl);
  doc.getElementById("source-pane")!.appendChild(sourceBlock);

  const resultBlock = doc.createElement("div");
  resultBlock.className = "entry";
  const resultEl = doc.createElement("div");
  resultEl.className = "result pending";
  resultEl.textContent = "…";
  resultBlock.appendChild(resultEl);
  doc.getElementById("result-pane")!.appendChild(resultBlock);

  const entry: WindowEntry = { source, sourceEl, resultEl };
  entries.push(entry);
  (win as any)._lpcteamEntries = entries;

  const name =
    engineName ||
    (doc.getElementById("engine-selector") as any)?.value ||
    getDefaultEndpoint()?.name;
  await translateEntry(win, entry, name);
}

async function translateEntry(
  win: Window,
  entry: WindowEntry,
  engineName?: string,
) {
  const resultEl = entry.resultEl;
  if (win.closed) {
    return;
  }
  const endpoint =
    (engineName && getEndpoints().find((ep) => ep.name === engineName)) ||
    getDefaultEndpoint();
  resultEl.className = "result pending";
  resultEl.textContent = "…";
  try {
    await translateText(entry.source, endpoint, (_delta, full) => {
      if (win.closed) {
        return;
      }
      resultEl.textContent = full;
    });
    resultEl.textContent = resultEl.textContent || "";
    resultEl.className = "result";
  } catch (e) {
    resultEl.className = "result error";
    resultEl.textContent = String(e instanceof Error ? e.message : e);
  }
}
