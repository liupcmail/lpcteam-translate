import { getPref, setPref } from "../utils/prefs";
import { getString } from "../utils/locale";
import {
  getCustomEndpoints,
  setEndpoints,
  type EndpointConfig,
} from "./services";
import { translateText } from "./translate";

export async function registerPrefsScripts(win: Window) {
  bindSimpleInputs(win);
  bindCheckbox(win);
  bindCheckbox2(win);
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

function bindCheckbox2(win: Window) {
  const el = win.document.getElementById(
    `zotero-prefpane-${addon.data.config.addonRef}-auto-target`,
  ) as XUL.Checkbox;
  if (!el) {
    return;
  }
  el.checked = getPref("autoTargetLanguage") !== false;
  el.addEventListener("command", () => {
    setPref("autoTargetLanguage", el.checked);
  });
}

/**
 * Test one endpoint with a sample text and report the result inline.
 */
async function testEndpoint(
  endpoint: EndpointConfig,
  statusEl: HTMLElement,
) {
  statusEl.textContent = "…";
  statusEl.style.color = "#b7791f";
  try {
    const result = await translateText("Hello, world!", endpoint);
    statusEl.textContent = `✓ ${result.slice(0, 40)}`;
    statusEl.style.color = "#38a169";
  } catch (e) {
    statusEl.textContent = `✗ ${e instanceof Error ? e.message : String(e)}`.slice(0, 80);
    statusEl.style.color = "#c53030";
  }
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

  const endpoints = getCustomEndpoints();
  endpoints.forEach((ep, index) => {
    const row = doc.createElement("div");
    row.className = "endpoint-row";

    const fields: Array<{
      key: "name" | "url" | "model" | "apiKey";
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
        const current = getCustomEndpoints();
        current[index][field.key] = input.value;
        setEndpoints(current);
      });
      wrap.append(caption, input);
      row.appendChild(wrap);
    }
    const test = doc.createElement("button");
    test.textContent = getString("pref-endpoint-test" as never);
    test.addEventListener("command", () => {
      // Read the CURRENT input values so unsaved edits are tested too
      const inputs = Array.from(row.querySelectorAll("input")) as HTMLInputElement[];
      const values = inputs.map((i) => i.value);
      testEndpoint(
        {
          name: values[0] || "Unnamed",
          url: values[1],
          model: values[2],
          apiKey: values[3],
          type: "llm",
        },
        statusEl,
      );
    });
    row.appendChild(test);
    const statusEl = doc.createElement("span");
    statusEl.className = "endpoint-status";
    statusEl.style.fontSize = "12px";
    row.appendChild(statusEl);

    const del = doc.createElement("button");
    del.textContent = "✕";
    del.className = "endpoint-delete";
    del.addEventListener("command", () => {
      const current = getCustomEndpoints();
      current.splice(index, 1);
      setEndpoints(current);
      renderEndpointRows(win);
    });
    row.appendChild(del);
    container.appendChild(row);
  });

  addButton.addEventListener("click", () => {
    const current = getCustomEndpoints();
    current.push({
      name: `Endpoint ${current.length + 1}`,
      url: "",
      model: "",
      apiKey: "",
      type: "llm",
    });
    setEndpoints(current);
    renderEndpointRows(win);
  });
}

function prefix() {
  return `zotero-prefpane-${addon.data.config.addonRef}`;
}
