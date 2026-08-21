import { getPref, setPref } from "../utils/prefs";

/**
 * Configuration of one OpenAI-compatible chat completion endpoint.
 * `url` must be the full request path ending with /chat/completions.
 */
export interface EndpointConfig {
  name: string;
  url: string;
  model: string;
  apiKey: string;
}

/**
 * Parse endpoints from the pref. Returns [] when the pref is
 * missing or malformed, so callers can always iterate safely.
 */
export function getEndpoints(): EndpointConfig[] {
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
      }));
  } catch (e) {
    ztoolkit.log("Failed to parse endpoints pref", e);
    return [];
  }
}

export function setEndpoints(endpoints: EndpointConfig[]) {
  setPref("endpoints", JSON.stringify(endpoints));
}

export function getEndpointByName(name: string): EndpointConfig | undefined {
  return getEndpoints().find((ep) => ep.name === name);
}

/**
 * The endpoint used by default: the first one with an API key,
 * falling back to the first one at all.
 */
export function getDefaultEndpoint(): EndpointConfig | undefined {
  const endpoints = getEndpoints();
  return endpoints.find((ep) => ep.apiKey) || endpoints[0];
}
