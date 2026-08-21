import { initLocale } from "./utils/locale";
import { registerPrefs } from "./modules/prefsPane";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { registerReaderMenu } from "./modules/reader";
import { registerItemMenus } from "./modules/items";
import {
  registerSidebarPanel,
  startSelectionWatcher,
  stopSelectionWatcher,
  unregisterSidebarPanel,
} from "./modules/sidebarPanel";
import { createZToolkit } from "./utils/ztoolkit";

const STARTUP_LOG = "/tmp/lpcteam-startup-error.log";

async function logStartupError(step: string, e: unknown) {
  const line = `[${new Date().toISOString()}] ${step}: ${e instanceof Error ? `${e.message}\n${e.stack}` : String(e)}\n`;
  try {
    await Zotero.File.putContentsAsync(STARTUP_LOG, line);
    ztoolkit.log(line);
  } catch {
    // last resort
    console.error(line);
  }
}

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  try {
    initLocale();
  } catch (e) {
    await logStartupError("initLocale", e);
  }

  try {
    registerPrefs();
  } catch (e) {
    await logStartupError("registerPrefs", e);
  }

  try {
    registerSidebarPanel();
  } catch (e) {
    await logStartupError("registerSidebarPanel", e);
  }

  startSelectionWatcher();

  for (const win of Zotero.getMainWindows()) {
    try {
      await onMainWindowLoad(win);
    } catch (e) {
      await logStartupError("onMainWindowLoad", e);
    }
  }

  // Mark initialized as true to confirm plugin loading status
  // outside of the plugin (e.g. scaffold testing process)
  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  // Create ztoolkit for every window
  addon.data.ztoolkit = createZToolkit();

  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );

  try {
    registerReaderMenu();
  } catch (e) {
    await logStartupError("registerReaderMenu", e);
  }
  try {
    registerItemMenus();
  } catch (e) {
    await logStartupError("registerItemMenus", e);
  }
}

async function onMainWindowUnload(win: Window): Promise<void> {
  void win;
  ztoolkit.unregisterAll();
}

function onShutdown(): void {
  stopSelectionWatcher();
  unregisterSidebarPanel();
  ztoolkit.unregisterAll();
  // Remove addon object
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      registerPrefsScripts(data.window);
      break;
    default:
      return;
  }
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify: undefined,
  onPrefsEvent,
  onShortcuts: undefined,
  onDialogEvents: undefined,
};
