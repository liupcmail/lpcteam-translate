# lpcteam-translate

A minimal Zotero translation plugin powered by your own LLM API endpoints.

在 Zotero 里用你自己的大模型接口做翻译——划词即译，右侧边栏直接显示结果。

## Features / 功能

- **Select-to-translate in the PDF/EPUB reader / 阅读器划词翻译**：选中文字后，右侧边栏的"翻译"面板自动开始翻译（流式输出）
- **Translate item titles & abstracts / 条目标题与摘要翻译**：选中若干条文献，右键即可批量翻译
- **Bring your own endpoints / 自带接口**：任意 OpenAI 兼容的 `/chat/completions` 端点都可以配置（DeepSeek、智谱 GLM、Kimi、OpenAI、自建网关……），密钥只存在你本机
- **Switch engines on the fly / 引擎热切换**：面板里切换端点，当前内容立即用新引擎重译
- Auto-translate can be turned off in preferences / 可在设置中关闭"选中即译"

## Install / 安装

Download `lpcteam-translate.xpi` from [Releases](https://github.com/lpcteam/lpcteam-translate/releases), then in Zotero: `Tools → Plugins → gear icon → Install Plugin From File…`

从 [Releases](https://github.com/lpcteam/lpcteam-translate/releases) 下载 `.xpi`，在 Zotero 中 `工具 → 插件 → 齿轮 → 从文件安装插件…`。

## Quick start / 快速开始

1. Zotero `Settings → lpcteam-translate`，在任意端点行填入 API Key（端点 URL 与模型已预置 DeepSeek / 智谱 GLM / Kimi，可自行增删改）
2. 打开一篇文献，在阅读器里选中一段文字
3. 看右侧边栏的"翻译"面板——译文会流式打出

## Configure / 配置

| Pref                     | 说明                                                              |
| ------------------------ | ----------------------------------------------------------------- |
| Endpoints                | 名称 / URL（需含完整 `/chat/completions` 路径）/ 模型 / API Key   |
| Source / Target language | 默认 `en-US` → `zh-CN`                                            |
| Prompt                   | 翻译提示词，支持 `${langFrom}` `${langTo}` `${sourceText}` 占位符 |
| Auto-translate           | 选中文字后是否自动翻译                                            |

## Build from source / 从源码构建

```bash
npm install
npm run build   # 产出 .scaffold/build/lpcteam-translate.xpi
npm start       # 开发模式：启动带热重载的 Zotero
```

Requires Node LTS. `.env` 需按 `.env.example` 配置本机 Zotero 路径。

## License

AGPL-3.0-or-later. Built on [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template) and [zotero-plugin-toolkit](https://github.com/windingwind/zotero-plugin-toolkit) by windingwind.
