import { getString } from "../utils/locale";
import { addEntryAndTranslate, openTranslateWindow } from "./translateWindow";

export function registerItemMenus() {
  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: "lpcteamtranslate-item-title",
    label: getString("menu-item-title"),
    commandListener: () => {
      translateSelectedItems("title");
    },
  });
  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: "lpcteamtranslate-item-abstract",
    label: getString("menu-item-abstract"),
    commandListener: () => {
      translateSelectedItems("abstractNote");
    },
  });
}

/**
 * Translate the given field of every selected regular item, one by
 * one (sequential to be gentle on API rate limits), into the result
 * window.
 */
async function translateSelectedItems(field: "title" | "abstractNote") {
  const items = Zotero.getActiveZoteroPane()
    .getSelectedItems()
    .filter((item) => item.isRegularItem());
  const sources = items
    .map((item) => (item.getField(field) as string) || "")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!sources.length) {
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({
        text: getString("progress-no-items"),
        type: "fail",
        progress: 100,
      })
      .show();
    return;
  }
  const win = await openTranslateWindow();
  for (const source of sources) {
    if (win.closed) {
      break;
    }
    await addEntryAndTranslate(win, source);
  }
}
