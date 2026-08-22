import { getPref } from "../utils/prefs";
import type { EndpointConfig } from "./services";

export class TranslateError extends Error {}

/**
 * Translate `text` with the given engine.
 *
 * When `onDelta` is provided it is called with each incremental chunk
 * of the translation (streaming LLM only); the resolved value is the
 * complete translation.
 */
export async function translateText(
  text: string,
  endpoint: EndpointConfig | undefined,
  onDelta?: (delta: string, full: string) => void,
): Promise<string> {
  if (!endpoint) {
    throw new TranslateError("No endpoint available");
  }
  if (endpoint.type === "bing") {
    return translateBing(text, onDelta);
  }
  if (endpoint.type === "google") {
    return translateGoogle(text, onDelta);
  }
  return translateLLM(text, endpoint, onDelta);
}

/**
 * Free Bing translator (same web endpoint as Translate for Zotero):
 * POST edge.microsoft.com/translate/translatetext with an Edge UA.
 */
async function translateBing(
  text: string,
  onDelta?: (delta: string, full: string) => void,
): Promise<string> {
  const from = getPref("sourceLanguage") || "en";
  const to = getPref("targetLanguage") || "zh-CN";
  const xhr = await Zotero.HTTP.request(
    "POST",
    `https://edge.microsoft.com/translate/translatetext?from=${from}&to=${to}&isEnterpriseClient=false`,
    {
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36 Edg/113.1774.42",
      },
      body: JSON.stringify([text]),
      responseType: "json",
    },
  );
  if (xhr.status !== 200) {
    throw new TranslateError(`Bing HTTP ${xhr.status}`);
  }
  const result = (xhr.response as any)?.[0]?.translations?.[0]?.text || "";
  if (!result) {
    throw new TranslateError("Bing returned an empty translation");
  }
  onDelta?.(result, result);
  return result;
}

/**
 * Free Google translate web endpoint. Auto-detects the source
 * language.
 */
async function translateGoogle(
  text: string,
  onDelta?: (delta: string, full: string) => void,
): Promise<string> {
  const to = getPref("targetLanguage") || "zh-CN";
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto" +
    `&tl=${encodeURIComponent(to)}&dt=t&q=${encodeURIComponent(text)}`;
  const xhr = await Zotero.HTTP.request("GET", url, {
    responseType: "json",
  });
  if (xhr.status !== 200) {
    throw new TranslateError(`Google HTTP ${xhr.status}`);
  }
  const segments = (xhr.response as any)?.[0];
  let result = "";
  if (Array.isArray(segments)) {
    for (const seg of segments) {
      result += seg?.[0] || "";
    }
  }
  if (!result) {
    throw new TranslateError("Google returned an empty translation");
  }
  onDelta?.(result, result);
  return result;
}

async function translateLLM(
  text: string,
  endpoint: EndpointConfig,
  onDelta?: (delta: string, full: string) => void,
): Promise<string> {
  if (!endpoint.apiKey) {
    throw new TranslateError(
      `Endpoint "${endpoint.name}" has no API key. Set it in the plugin preferences.`,
    );
  }

  const langFrom = getPref("sourceLanguage") || "en-US";
  const langTo = getPref("targetLanguage") || "zh-CN";
  const prompt = (getPref("prompt") || "")
    .replaceAll("${langFrom}", langFrom)
    .replaceAll("${langTo}", langTo)
    .replaceAll("${sourceText}", text);
  if (!prompt.trim()) {
    throw new TranslateError("Translation prompt is empty");
  }

  const stream = Boolean(getPref("stream"));
  const requestBody = {
    model: endpoint.model,
    messages: [{ role: "user", content: prompt }],
    temperature: 1,
    stream,
  };

  let result = "";
  let buffer = "";
  let preLength = 0;

  const xhr = await Zotero.HTTP.request("POST", endpoint.url, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${endpoint.apiKey}`,
    },
    body: JSON.stringify(requestBody),
    responseType: "text",
    timeout: 120000,
    requestObserver: (xmlhttp: XMLHttpRequest) => {
      if (!stream) {
        return;
      }
      xmlhttp.onprogress = (e) => {
        // Keep the connection alive for long streams
        if (xmlhttp.timeout) {
          xmlhttp.timeout = 0;
        }
        const response = xmlhttp.response || "";
        const newResponse = response.slice(preLength);
        preLength = response.length;
        // Split SSE frames on "data:"; keep a buffer for partial frames
        const fullResponse = buffer + newResponse;
        const frames = fullResponse.split("data:");
        buffer = frames.pop() || "";
        for (const frame of frames) {
          const line = frame.trim();
          if (!line || line === "[DONE]") {
            continue;
          }
          try {
            const obj = JSON.parse(line);
            // Only the final answer channel; reasoning channels are skipped
            const delta = obj?.choices?.[0]?.delta?.content || "";
            if (delta) {
              result += delta;
              onDelta?.(delta, result);
            }
          } catch {
            // partial JSON in this frame, wait for more data
          }
        }
      };
    },
  });

  if (xhr.status !== 200) {
    throw new TranslateError(
      `${endpoint.name} HTTP ${xhr.status}: ${extractErrorMessage(
        xhr.responseText || "",
      )}`,
    );
  }

  if (stream) {
    // Flush whatever arrived after the last onprogress event
    if (buffer.trim() && buffer.trim() !== "[DONE]") {
      try {
        const obj = JSON.parse(buffer.trim());
        const delta = obj?.choices?.[0]?.delta?.content || "";
        if (delta) {
          result += delta;
          onDelta?.(delta, result);
        }
      } catch {
        // ignore
      }
    }
    return result;
  }

  const obj = JSON.parse(xhr.responseText || "");
  const content = obj?.choices?.[0]?.message?.content || "";
  if (!content) {
    throw new TranslateError(`${endpoint.name} returned an empty translation`);
  }
  onDelta?.(content, content);
  return content;
}

function extractErrorMessage(body: string): string {
  try {
    const obj = JSON.parse(body);
    return (
      obj?.error?.message || obj?.message || body.slice(0, 200) || "(no body)"
    );
  } catch {
    return body.slice(0, 200) || "(no body)";
  }
}
