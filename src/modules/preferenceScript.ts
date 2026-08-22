import { getPref, setPref } from "../utils/prefs";
import {
  getCustomEndpoints,
  getDefaultEndpoint,
  getEndpoints,
  setEndpoints,
  type EndpointConfig,
} from "./services";
import { translateText } from "./translate";

export async function registerPrefsScripts(win: Window) {
  bindSimpleInputs(win);
  bindCheckbox(win);
  bindCheckbox2(win);
  bindDefaultEngine(win);
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
 * Test one endpoint with a sample text and report the result inline
 * in the row's status label.
 */
async function testEndpoint(
  endpoint: EndpointConfig,
  statusEl: HTMLElement,
  idleText: string,
) {
  statusEl.textContent = "…";
  statusEl.style.color = "#b7791f";
  try {
    await translateText("Hello, world!", endpoint);
    statusEl.textContent = "恭喜你，测试通过。";
    statusEl.style.color = "#38a169";
  } catch (e) {
    ztoolkit.log("endpoint test failed", e);
    statusEl.textContent = "无法连通，请重新配置！";
    statusEl.style.color = "#c53030";
  }
  // restore the idle status text after a while
  Zotero.Promise.delay(8000).then(() => {
    statusEl.textContent = idleText;
    statusEl.style.color = "";
  });
}

/**
 * Populate and bind the default-engine dropdown with every available
 * engine (built-in free ones plus configured LLM endpoints).
 */
function bindDefaultEngine(win: Window) {
  const selector = win.document.getElementById(
    `${prefix()}-default-engine`,
  ) as any;
  const popup = win.document.getElementById(`${prefix()}-default-engine-popup`);
  if (!selector || !popup) {
    return;
  }
  popup.innerHTML = "";
  const saved = (getPref("defaultEngine") as string) || "";
  let hasSaved = false;
  for (const ep of getEndpoints()) {
    const item = win.document.createXULElement("menuitem");
    item.setAttribute("label", ep.name);
    item.setAttribute("value", ep.name);
    popup.appendChild(item);
    if (ep.name === saved) {
      hasSaved = true;
    }
  }
  // fall back to the effective default when nothing valid is saved
  selector.value = hasSaved ? saved : getDefaultEndpoint()?.name || "";
  selector.addEventListener("command", () => {
    setPref("defaultEngine", selector.value);
  });
}

function bindSimpleInputs(win: Window) {
  bindInput(
    win,
    `${prefix()}-source-language`,
    () => getPref("sourceLanguage") as string,
    (v) => setPref("sourceLanguage", v),
  );
  bindInput(
    win,
    `${prefix()}-target-language`,
    () => getPref("targetLanguage") as string,
    (v) => setPref("targetLanguage", v),
  );
  bindInput(
    win,
    `${prefix()}-prompt`,
    () => (getPref("prompt") as string) || "",
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
 * Collapsible endpoint list: each endpoint renders as one summary row
 * (status dot, name, config state, Test / Edit buttons); Edit expands
 * the four input fields below it.
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
    // ---- summary row ----
    const row = doc.createElement("div");
    row.className = "endpoint-summary";

    const dot = doc.createElement("span");
    dot.className = ep.apiKey ? "dot ok" : "dot warn";

    const nameEl = doc.createElement("span");
    nameEl.className = "endpoint-name";
    nameEl.textContent = ep.name;

    const statusEl = doc.createElement("span");
    statusEl.className = "endpoint-status";
    statusEl.textContent = ep.apiKey ? "已配置 ✓" : "缺密钥 ⚠";
    if (!ep.apiKey) {
      statusEl.style.color = "#b7791f";
    }

    const testBtn = doc.createElement("button");
    testBtn.textContent = "连通测试";

    const editBtn = doc.createElement("button");
    editBtn.textContent = "编辑";

    const spacer = doc.createElement("span");
    spacer.style.flex = "1";
    row.append(dot, nameEl, statusEl, spacer, testBtn, editBtn);
    container.appendChild(row);

    // ---- collapsible detail ----
    const detail = doc.createElement("div");
    detail.className = "endpoint-detail";
    detail.style.display = "none";

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
    const inputs: HTMLInputElement[] = [];
    for (const field of fields) {
      const wrap = doc.createElement("label");
      wrap.className = "endpoint-field";
      const caption = doc.createElement("span");
      caption.textContent = field.label;
      const input = doc.createElement("input");
      input.type = field.type;
      input.value = ep[field.key] || "";
      inputs.push(input);
      input.addEventListener("change", () => {
        const current = getCustomEndpoints();
        current[index][field.key] = input.value;
        setEndpoints(current);
        // keep the summary in sync
        dot.className =
          input.value && field.key === "apiKey" ? "dot ok" : dot.className;
        if (field.key === "name") {
          nameEl.textContent = input.value || "Unnamed";
        }
        if (field.key === "apiKey") {
          statusEl.textContent = input.value ? "已配置 ✓" : "缺密钥 ⚠";
          statusEl.style.color = input.value ? "" : "#b7791f";
          dot.className = input.value ? "dot ok" : "dot warn";
        }
      });
      wrap.append(caption, input);
      detail.appendChild(wrap);
    }

    const del = doc.createElement("button");
    del.textContent = "✕ 删除此端点";
    del.className = "endpoint-delete";
    del.addEventListener("click", () => {
      const current = getCustomEndpoints();
      current.splice(index, 1);
      setEndpoints(current);
      renderEndpointRows(win);
    });
    detail.appendChild(del);
    container.appendChild(detail);

    // ---- wiring ----
    editBtn.addEventListener("click", () => {
      const open = detail.style.display !== "none";
      detail.style.display = open ? "none" : "";
      editBtn.textContent = open ? "编辑" : "收起";
    });
    testBtn.addEventListener("click", () => {
      // test with the CURRENT input values, saved or not
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
        values[3] ? "已配置 ✓" : "缺密钥 ⚠",
      );
    });
  });

  (addButton as HTMLElement).addEventListener("click", () => {
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
