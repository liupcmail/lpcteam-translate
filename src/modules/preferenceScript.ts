import { getPref, setPref } from "../utils/prefs";
import { getEndpoints, setEndpoints, type EndpointConfig } from "./services";

export async function registerPrefsScripts(win: Window) {
  bindSimpleInputs(win);
  bindCheckbox(win);
  renderEndpointRows(win);
}

function bindCheckbox(win: Window) {
  const el = win.document.getElementById(
    `zotero-prefpane-${addon.data.config.addonRef}-auto-translate`,
  ) as XUL.Checkbox;
  if (!el) {
    return;
  }
  el.checked = getPref("autoTranslate") !== false;
  el.addEventListener("command", () => {
    setPref("autoTranslate", el.checked);
  });
}

function bindSimpleInputs(win: Window) {
  const doc = win.document;
  bindInput(
    win,
    `${prefix()}-source-language`,
    () => getPref("sourceLanguage"),
    (v) => setPref("sourceLanguage", v),
  );
  bindInput(
    win,
    `${prefix()}-target-language`,
    () => getPref("targetLanguage"),
    (v) => setPref("targetLanguage", v),
  );
  bindInput(
    win,
    `${prefix()}-prompt`,
    () => getPref("prompt") || "",
    (v) => setPref("prompt", v),
  );
}

function bindInput(
  win: Window,
  id: string,
  get: () => string,
  set: (value: string) => void,
) {
  const el = win.document.getElementById(id) as HTMLInputElement;
  if (!el) {
    return;
  }
  el.value = get();
  el.addEventListener("change", () => set(el.value));
}

/**
 * Render one row (name / url / model / key + delete) per endpoint,
 * plus an "add endpoint" button. Every change is saved to the pref
 * immediately.
 */
function renderEndpointRows(win: Window) {
  const doc = win.document;
  const container = doc.getElementById(`${prefix()}-endpoint-rows`);
  const addButton = doc.getElementById(`${prefix()}-endpoint-add`);
  if (!container || !addButton) {
    return;
  }
  container.innerHTML = "";

  const endpoints = getEndpoints();
  endpoints.forEach((ep, index) => {
    const row = doc.createElement("div");
    row.className = "endpoint-row";

    const fields: Array<{
      key: keyof EndpointConfig;
      label: string;
      type: string;
    }> = [
      { key: "name", label: "Name", type: "text" },
      { key: "url", label: "URL (…/chat/completions)", type: "text" },
      { key: "model", label: "Model", type: "text" },
      { key: "apiKey", label: "API Key", type: "password" },
    ];
    for (const field of fields) {
      const wrap = doc.createElement("label");
      wrap.className = "endpoint-field";
      const caption = doc.createElement("span");
      caption.textContent = field.label;
      const input = doc.createElement("input");
      input.type = field.type;
      input.value = ep[field.key] || "";
      input.addEventListener("change", () => {
        const current = getEndpoints();
        current[index][field.key] = input.value;
        setEndpoints(current);
      });
      wrap.append(caption, input);
      row.appendChild(wrap);
    }
    const del = doc.createElement("button");
    del.textContent = "✕";
    del.className = "endpoint-delete";
    del.addEventListener("command", () => {
      const current = getEndpoints();
      current.splice(index, 1);
      setEndpoints(current);
      renderEndpointRows(win);
    });
    row.appendChild(del);
    container.appendChild(row);
  });

  addButton.addEventListener("click", () => {
    const current = getEndpoints();
    current.push({
      name: `Endpoint ${current.length + 1}`,
      url: "",
      model: "",
      apiKey: "",
    });
    setEndpoints(current);
    renderEndpointRows(win);
  });
}

function prefix() {
  return `zotero-prefpane-${addon.data.config.addonRef}`;
}
