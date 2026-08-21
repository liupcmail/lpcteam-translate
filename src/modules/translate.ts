import { getPref } from "../utils/prefs";
import type { EndpointConfig } from "./services";

export class TranslateError extends Error {}

/**
 * Translate `text` with an OpenAI-compatible endpoint.
 *
 * When `onDelta` is provided it is called with each incremental chunk
 * of the translation (streaming mode only); the resolved value is the
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
