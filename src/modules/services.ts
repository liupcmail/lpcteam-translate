import { getPref, setPref } from "../utils/prefs";

export type EngineType = "llm" | "bing" | "google";

/**
 * A translation engine. LLM engines are OpenAI-compatible chat
 * completion endpoints configured by the user; Bing and Google are
 * free built-in engines that need no key.
 */
export interface EndpointConfig {
  name: string;
  /** Full request path ending with /chat/completions (LLM only) */
  url: string;
  model: string;
  apiKey: string;
  type: EngineType;
  /** true for the built-in free engines */
  builtin?: boolean;
}

const BUILTIN_ENDPOINTS: EndpointConfig[] = [
  {
    name: "必应 Bing",
    url: "",
    model: "",
    apiKey: "",
    type: "bing",
    builtin: true,
  },
  {
    name: "谷歌 Google",
    url: "",
    model: "",
    apiKey: "",
    type: "google",
    builtin: true,
  },
];

/**
 * Parse user-configured LLM endpoints from the pref. Returns [] when
 * the pref is missing or malformed, so callers can always iterate
 * safely.
 */
export function getCustomEndpoints(): EndpointConfig[] {
  try {
    const raw = getPref("endpoints");
    if (typeof raw !== "string" || raw.length === 0) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((ep) => ep && typeof ep === "object")
      .map((ep) => ({
        name: String(ep.name || "Unnamed"),
        url: String(ep.url || ""),
        model: String(ep.model || ""),
        apiKey: String(ep.apiKey || ""),
        type: "llm" as EngineType,
      }));
  } catch (e) {
    ztoolkit.log("Failed to parse endpoints pref", e);
    return [];
  }
}

/**
 * All available engines: user LLM endpoints first, then the built-in
 * free engines.
 */
export function getEndpoints(): EndpointConfig[] {
  return [...BUILTIN_ENDPOINTS, ...getCustomEndpoints()];
}

export function setEndpoints(endpoints: EndpointConfig[]) {
  setPref(
    "endpoints",
    JSON.stringify(
      endpoints.map(({ name, url, model, apiKey }) => ({
        name,
        url,
        model,
        apiKey,
      })),
    ),
  );
}

export function getEndpointByName(name: string): EndpointConfig | undefined {
  return getEndpoints().find((ep) => ep.name === name);
}

/**
 * The engine used by default: the first LLM endpoint with an API key;
 * falls back to the free Bing engine when none is configured.
 */
export function getDefaultEndpoint(): EndpointConfig | undefined {
  const endpoints = getEndpoints();
  const saved = getPref("defaultEngine") as string;
  if (saved) {
    const match = endpoints.find((ep) => ep.name === saved);
    if (match) {
      return match;
    }
  }
  // no (valid) preference: first keyed LLM endpoint, else free Bing
  const custom = getCustomEndpoints();
  return custom.find((ep) => ep.apiKey) || BUILTIN_ENDPOINTS[0];
}
