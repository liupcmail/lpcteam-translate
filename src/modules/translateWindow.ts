import { getEndpoints, getDefaultEndpoint } from "./services";
import { translateText } from "./translate";

interface WindowEntry {
  source: string;
  element: HTMLElement;
}

/**
 * The translate result window. One shared instance: reusing it keeps
 * the engine selection and window position across translations.
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
  (win as any)._lpcteamEntries = [];

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
      .map((e) => e.element.querySelector(".result")?.textContent || "")
      .filter(Boolean)
      .join("\n\n");
    Zotero.Utilities.Internal.copyTextToClipboard(text);
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({ text: "Copied", progress: 100 })
      .show();
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

  const entry = doc.createElement("div");
  entry.className = "entry";
  const sourceEl = doc.createElement("div");
  sourceEl.className = "source";
  sourceEl.textContent = source;
  const resultEl = doc.createElement("div");
  resultEl.className = "result pending";
  resultEl.textContent = "…";
  entry.append(sourceEl, resultEl);
  doc.getElementById("entries")!.appendChild(entry);

  const windowEntry = { source, element: entry };
  entries.push(windowEntry);
  (win as any)._lpcteamEntries = entries;

  const name =
    engineName ||
    (doc.getElementById("engine-selector") as any)?.value ||
    getDefaultEndpoint()?.name;
  await translateEntry(win, windowEntry, name);
}

async function translateEntry(
  win: Window,
  entry: WindowEntry,
  engineName?: string,
) {
  const resultEl = entry.element.querySelector(".result") as HTMLElement;
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
