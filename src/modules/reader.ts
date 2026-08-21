import { getString } from "../utils/locale";
import { addEntryAndTranslate, openTranslateWindow } from "./translateWindow";

export function registerReaderMenu() {
  ztoolkit.Menu.register("menuTools", {
    tag: "menuitem",
    id: "lpcteamtranslate-reader-translate",
    label: getString("menu-reader-translate"),
    commandListener: () => translateReaderSelection(),
  });
}

/**
 * Take the current text selection of the active reader tab and
 * translate it in the result window.
 */
async function translateReaderSelection() {
  const ZoteroTabs = ztoolkit.getGlobal("Zotero_Tabs");
  const reader = Zotero.Reader.getByTabID(ZoteroTabs.selectedID);
  // Same internal API used by Translate for Zotero (verified on Zotero 10):
  // the selection popup holds a temp annotation with the selected text.
  const text =
    (reader as any)?._internalReader?._lastView?._selectionPopup?.annotation
      ?.text ?? "";
  if (!text.trim()) {
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({
        text: getString("progress-no-selection"),
        type: "fail",
        progress: 100,
      })
      .show();
    return;
  }
  const win = await openTranslateWindow();
  await addEntryAndTranslate(win, text.trim());
}
