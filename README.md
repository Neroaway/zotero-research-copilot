<div align="center">

<img src="./addon/content/icon.svg" width="64" height="64" alt="">

# Zotero Research Copilot

**English** · [简体中文](./README.zh-CN.md)

An AI sidebar for asking about Zotero PDFs, checking the source passages, and turning paper analyses into research notes.

[![Latest release](https://img.shields.io/github/v/release/Neroaway/zotero-research-copilot?label=Release&color=245b87)][latest-release]
[![Requires Zotero 10.0.8 or later in the 10.0 series](https://img.shields.io/badge/Zotero-10.0.8%2B%20%2810.0.x%29-cc2936)](https://www.zotero.org/download/)

**[⬇️ Download the latest XPI][latest-release]** · [Report an issue][issues]

</div>

## ✨ Features

- **Answers linked to the paper.** Ask follow-up questions about the current PDF and jump from a citation to the source page or annotation.
- **Equation and figure walkthroughs.** Explain a selection, work through a derivation, or attach a PDF page or local screenshot to discuss a figure.
- **Deep analysis and mind maps.** Explore a paper's methods, experiments, limitations, and testable research questions across ten sections.
- **Research notes with citations.** Save an answer, analysis, or mind map to Zotero or Obsidian with links back to the paper.

## 🚀 Quick start

Requires **Zotero 10.0.8 or later in the 10.0 series**. The plugin was tested on Zotero 10.0.8 for macOS.

1. Download the `.xpi` under **Assets** on the [latest release][latest-release]. In Zotero, open **Tools → Plugins**, click the gear icon, and select **Install Plugin From File…**. Use the same steps to upgrade.
2. Open a **PDF attachment** and click **AI** in the reader toolbar. If the PDF was already open during installation, close and reopen it.
3. In the sidebar, click **Settings** or **Change model**. Select an **AI provider** and model, enter that provider's API key, click **Test API**, then **Save settings**.
4. Ask a question in the sidebar or click **Deep analysis**. Under **Interface and answer language**, choose English, Simplified Chinese, or the Zotero default. Save and reopen the PDF to apply the sidebar language.

## 🔌 Models and providers

| Provider | API | Example models and docs |
| --- | --- | --- |
| OpenAI | Responses | `gpt-5-mini`, `gpt-6.1-sol`. [Model catalog](https://developers.openai.com/api/docs/models) |
| DeepSeek | Responses | `deepseek-flash` accepts images. `deepseek-v4-pro` accepts text. [Responses guide](https://api-docs.deepseek.com/guides/responses_api/) · [Model catalog](https://api-docs.deepseek.com/api/list-models/) |
| Claude | Anthropic Messages | `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-haiku-5-5`. [Model overview](https://platform.claude.com/docs/en/models/overview) · [Streaming](https://platform.claude.com/docs/en/build-with-claude/streaming) |
| Xiaomi MiMo | Chat Completions | `mimo-v2.6-flash`, `mimo-v2.6-pro`. [API reference](https://mimo.mi.com/docs/en-US/api/chat/openai-api-post) · [Image input](https://mimo.mi.com/docs/en-US/quick-start/usage-guide/multimodal-understanding/image-understanding) |
| Grok | xAI Responses | `grok-4.7`, `grok-4.3`. [Responses reference](https://docs.x.ai/developers/rest-api-reference/inference/responses) · [Grok 4.7](https://docs.x.ai/developers/models/grok-4.7) |
| OpenAI-compatible | Chat Completions | Enter the base URL and key for a service that supports streaming `/chat/completions`. |

Under **Choose model**, select a preset, click **Get account models**, or enter a **Custom model ID**. Use a streaming text model for paper chat and an image-capable model for figures. **Test API** sends a short, fixed prompt and shows the result and any reported token usage. Both the test and model discovery use the key you entered or the saved key for that provider and base URL.

For compatible services, use a base URL such as `https://openrouter.ai/api/v1` for OpenRouter or `http://localhost:11434/v1` for local Ollama. For Ollama, you can enter `ollama` in the API key field. Remote endpoints require HTTPS. Enter a model ID manually if the endpoint has no model catalog. Image input and usage reporting depend on the model and gateway. [OpenRouter docs](https://openrouter.ai/docs/api_reference/overview) · [Ollama compatibility docs](https://docs.ollama.com/api/openai-compatibility)

**Reasoning effort** shows the levels documented for the selected model. Codex's **Max** is a reasoning setting. The OpenAI API exposes `max` for `gpt-6.1-sol`, Claude Sonnet 5.5 supports `max`, and Grok 4.7 goes up to `xhigh`. Other models can use **Model default**. [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) · [Claude effort](https://platform.claude.com/docs/en/build-with-claude/effort) · [Grok 4.7](https://docs.x.ai/developers/models/grok-4.7)

**Deep analysis output tokens** offers automatic, 16,000, 32,000, 64,000, and API default. The automatic budget uses 32,000 tokens at `max` and 12,000 at `medium` or when you leave effort on the model default. Claude requires an explicit limit. Grok applies the limit to visible answer text. Usage figures come from the API. [OpenAI reasoning tokens](https://developers.openai.com/api/docs/guides/reasoning) · [Claude Messages](https://platform.claude.com/docs/en/api/messages) · [Grok reasoning configuration](https://docs.x.ai/developers/model-capabilities/text/best-practices)

**Answer maximum wait** applies to questions, selections, and deep analysis. The default is **No local time limit**: the plugin will not stop an answer just because a fixed duration elapsed. Alternatively choose 4, 10, 20, 30, or 60 minutes, or automatic (questions/selections: 4 minutes; analysis at `max`/`xhigh`: 30 minutes; other efforts: 10 minutes). This is separate from output tokens; service or network timeouts can still occur. Running tasks show elapsed time and the actual limit. Timeouts, manual stops, reader teardown, and plugin shutdown have distinct causes; older records without a cause are identified as such.

Upgrades reuse existing OpenAI settings. Each provider stores its own model, effort, budget, and key. Compatible endpoints use separate settings for each base URL.

## 📖 Read a paper

### Ask about the current PDF

In **Chat**, try “Which ablation best supports the method? List the comparison, metric, result, and source.” Click **Send** or press **⌘/Ctrl + Enter**. Follow up in the same conversation, click **Stop** to cancel generation, or **Retry** after a stop or failure. Completed answers show token counts when the API supplies them.

Each PDF automatically keeps its latest 30 turns on this device. Reopening its tab or restarting the plugin restores answers, evidence, usage, and the mind map, so you can continue the conversation. **Clear chat** also deletes that attachment's saved history. An answer still generating when the reader closes returns as stopped and is never resent automatically.

### Explain a selection, equation, or figure

- Select text or an equation in the PDF and click **AI Explain**. For an existing highlight or underline, select **AI Explain annotation** from its context menu. The request includes the selection and matching nearby passages. Answers support Markdown tables, code blocks, and KaTeX math.
- Expand **Add a figure or page**, enter the physical PDF page number starting at 1, and click **Attach page**. You can also attach a local PNG, JPEG, or WebP. Once you see the preview, ask about a figure or table. The attachment goes with the next question or deep analysis.

### Analyze the paper and inspect its evidence

1. Click **Deep analysis**. The DeepPaperNote-inspired analysis covers the research problem, method, experiments, and the limits of the findings. Under **Open Questions**, look for proposed improvements with source links and tests that could distinguish competing explanations. The sidebar shows **Waiting for the first answer text**, elapsed time and the waiting limit until visible text arrives. Adjust the maximum wait in Settings or stop the task at any time.
2. Click a citation to open the PDF location, or expand **Inspect evidence** to see the extracted passages. Page citations show the physical page and the PDF's own page label when available. A citation to a saved annotation can jump to that annotation. Labels distinguish paper evidence, visual observations, inference, and gaps in evidence.
3. Open **Mind map** to browse the analysis by section and expand branches to see their evidence.

The sidebar uses segmented controls, system fonts, keyboard focus states, and light and dark colors inspired by macOS. [Apple macOS design guide](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos)

## 📝 Save to Zotero or Obsidian

Click **Save as note** on an answer or analysis, or **Save map as note** on the mind map. Each save creates a new note linked to the item or standalone PDF attachment.

Equations use Zotero's native inline and display math nodes for rendering and editing. Notes also preserve the colors for evidence labels, highlighted emphasis, and citation links. Export a restored answer again to create an updated note; existing notes are preserved.

### Export to Obsidian

1. In **Settings**, click **Choose folder…** next to **Obsidian folder** and select your local vault or a folder for papers within it. You can also enter its absolute path. Click **Save settings**. [Obsidian vault documentation](https://obsidian.md/help/vault)
2. Click **Save to Obsidian** on a completed answer, analysis, or mind map. The model uses the paper title and a short answer excerpt to pick an existing subfolder directly inside the configured folder. If it finds no match or returns a recoverable error, the export uses `Research Copilot/`. If classification times out, retry the export.
3. The sidebar displays the relative path. Markdown exports preserve equations, code blocks, and Zotero page links. Mind maps export as outlines. Exports with the same title receive a numbered filename.

## ❓ Troubleshooting

| What you see | What to check |
| --- | --- |
| The sidebar shows one model name | It displays the active model. Click **Change model**, select a provider, then open **Choose model**. |
| The reader has no AI button | Check that the plugin is enabled and open a PDF attachment. Reopen tabs that were already open during installation. |
| The sidebar stays on “Generating” after the answer appears | Upgrade to v0.4.1 or later and reopen the PDF. That release fixed a Markdown rendering error triggered by dividers and line breaks at completion. |
| Deep analysis reaches the output token limit | Some models count reasoning tokens toward the limit and can exhaust it before showing an answer. Increase **Deep analysis output tokens** or lower **Reasoning effort** if the model supports it. |
| Max ends after about ten minutes without visible text | v0.6.1 imposed a fixed ten-minute analysis deadline. Starting with v0.6.2, all answers default to no local time limit, with optional limits in **Answer maximum wait**. Older records marked only as stopped do not establish the exact interruption cause. |
| API test or model discovery returns 401, 403, or 404 | For 401, check the key. For 403, check the key or project's permissions. For 404, check the model ID and access, or the base URL for a compatible service. |
| The request returns 429 or times out | Check the message for a rate limit or exhausted quota. For timeouts, check network or proxy connectivity before retrying. |
| A scanned PDF has too little text for analysis | Use a searchable PDF or run OCR. You can also attach a page and ask a visual question. |

## 🔒 Data and credentials

- The plugin indexes the current attachment in memory. It prefers Zotero Structured Document Text (SDT), then uses the Zotero PDF worker or page text from the reader. Zotero manages its own SDT cache.
- Paper chat retrieves up to about 8,000 characters of excerpts. Deep analysis can use up to about 64,000. Within that budget it sends the indexed body in source order. For longer papers it prioritizes methods, equations, captions, key results, and nearby paragraphs. The request also includes the title, question, a limited history for the same provider and endpoint, and any image you attach.
- The plugin connects directly to the selected provider or custom endpoint. Responses requests set `store: false`. Provider policies and account settings govern server-side logging and retention. [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data) · [DeepSeek Responses guide](https://api-docs.deepseek.com/guides/responses_api/) · [xAI Responses reference](https://docs.x.ai/developers/rest-api-reference/inference/responses)
- Model discovery fetches the provider's catalog. The API test sends a fixed prompt. Both operations run separately from paper requests.
- Obsidian folder classification sends the current provider the paper title, up to 1,200 characters of the answer, and up to 100 eligible direct subfolder names. The full vault path and its files stay on your device. The folder list excludes hidden directories and symlinks.
- Keys authenticate requests to their corresponding endpoints and are kept in memory by default. If you opt to remember a key, Zotero OSKeyStore encrypts it before saving. If OS storage is unavailable, the plugin uses the session key and displays a notice. **Remove key** clears the session and encrypted copies for the selected connection. The plugin keeps credentials, request bodies, and raw remote errors out of its logs.
- The latest 30 turns and their evidence excerpts are stored per library and PDF attachment in `research-copilot/conversations/` inside the Zotero data directory. History restores locally and is deleted by **Clear chat**; it does not sync through Zotero notes. History files exclude API keys, attached image data, and unsent input. Closing the reader or unloading the plugin releases the PDF index. Saved Zotero notes follow the library's sync settings.

## 🛠️ Build and test

Requires **Node.js 22.13+** and npm. The first install needs access to npm and GitHub for dependencies pinned in the lockfile.

```sh
git clone https://github.com/Neroaway/zotero-research-copilot.git
cd zotero-research-copilot
npm ci --ignore-scripts
npm run check
npm run test:zotero
```

`npm run check` runs TypeScript, ESLint, Node tests, and the XPI build. Run `npm run build` to package the plugin on its own. The installer is written to `dist/zotero-research-copilot-<version>.xpi`.

`npm run test:zotero` launches macOS Zotero by default. Set `ZOTERO_BIN` to use a different executable. The test runner installs the release XPI in a temporary profile and uses a synthetic PDF and simulated API responses. Set `ZRC_KEEP_SMOKE=1` to keep the test profile for debugging.

v0.6.2 passed TypeScript, ESLint, 43 Node tests, and 25 isolated scenarios on Zotero 10.0.8 for macOS. Checks cover all answer types defaulting to no local timeout, configurable waiting limits, elapsed time, distinct timeout and reader interruption causes, and restored chat, follow-ups, citations, mind maps and exports after closing the reader or reloading the plugin. Native note math and colors survive an editor save and reopen. Long waits use a simulated clock and API responses use test doubles; no paid live Max request was repeated.

### Project layout

```text
addon/                Zotero manifest, bootstrap, settings page, and CSS
src/
  ai/                 Provider registry, Responses, Claude Messages, Chat Completions, SSE
  paper/              Page text, indexing, retrieval budgets, and evidence
  research/           Session control, paper analysis prompts, evidence labels, and map nodes
  storage/            Local preferences, OS credential storage, and session keys
  ui/                 Sidebar, mind map, settings, Markdown, KaTeX, and image input
  zotero/             Reader events, sidebar mounting, PDF access, and notes
scripts/              XPI packaging and isolated Zotero tests
tests/                Node tests and the Zotero test add-on
dist/                 Build output
```

The plugin follows zotero-plugin-template's manifest, bootstrap, and TypeScript build layout and uses zotero-plugin-toolkit for DOM controls. The provider, paper loader, index, and research prompt modules provide extension points for cross-paper comparison, retrieval, research review, idea development, and user research profiles. [Plugin template](https://github.com/windingwind/zotero-plugin-template) · [Toolkit](https://github.com/windingwind/zotero-plugin-toolkit)

## 🧩 Known limits

- The sidebar uses Zotero's Reader events and mounts alongside the reader layout verified in 10.0.8. The plugin adapts to internal Zotero interfaces for SDT, page rendering, and sidebar placement. If page rendering is unavailable, attach a local screenshot. [Zotero extension docs](https://www.zotero.org/support/dev/zotero_7_for_developers#custom_reader_event_handlers) · [Reader source](https://github.com/zotero/zotero/blob/10.0.8/chrome/content/zotero/xpcom/reader.js) · [SDT source](https://github.com/zotero/zotero/blob/10.0.8/chrome/content/zotero/xpcom/sdt.js)
- The index is limited to 300 pages and about two million characters. Scans need a text layer for citable excerpts. Complex equations, columns, and tables may extract out of order. Page images can help with close reading. The mind map flags sections missing from the model's analysis.
- Image uploads are limited to 6 MB and 48 megapixels. The plugin re-encodes uploads to strip file metadata. A local screenshot is shown with its PDF page unverified. Image requests require a vision-capable model. [Responses streaming](https://developers.openai.com/api/docs/guides/streaming-responses) · [OpenAI image input](https://developers.openai.com/api/docs/guides/images-vision)
- Live provider accounts, OS credential writes and recovery across restarts, Windows, Linux, and other Zotero versions remain untested. Protocol handling and the session-key fallback were tested with simulated responses and credentials.

[latest-release]: https://github.com/Neroaway/zotero-research-copilot/releases/latest
[issues]: https://github.com/Neroaway/zotero-research-copilot/issues/new
