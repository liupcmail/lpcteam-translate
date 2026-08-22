pref("sourceLanguage", "en-US");
pref("targetLanguage", "zh-CN");
pref("stream", true);
pref("autoTranslate", true);
pref("autoTargetLanguage", true);
pref(
  "prompt",
  "You are a professional academic translator. Translate the following text from ${langFrom} to ${langTo}. Keep technical terminology accurate and preserve the original paragraph structure. Output ONLY the translation, without any explanations or the original text.\n\n${sourceText}",
);
// Endpoints are OpenAI-compatible chat completion services.
// The url must be the FULL path ending with /chat/completions.
pref(
  "endpoints",
  '[{"name":"DeepSeek","url":"https://api.deepseek.com/chat/completions","model":"deepseek-chat","apiKey":""},{"name":"Zhipu GLM","url":"https://open.bigmodel.cn/api/paas/v4/chat/completions","model":"glm-4-flash-250414","apiKey":""},{"name":"Kimi","url":"https://api.moonshot.cn/v1/chat/completions","model":"kimi-k2.6","apiKey":""}]',
);
