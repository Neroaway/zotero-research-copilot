<div align="center">

<img src="./addon/content/icon.svg" width="64" height="64" alt="">

# Zotero Research Copilot

[English](./README.md) · **简体中文**

在 Zotero PDF 侧栏提问、核对原文证据，并把论文分析整理成研究笔记。

[![最新版本](https://img.shields.io/github/v/release/Neroaway/zotero-research-copilot?label=Release&color=245b87)][latest-release]
[![支持 Zotero 10.0.8 及更新的 10.0.x](https://img.shields.io/badge/Zotero-10.0.8%2B%20%2810.0.x%29-cc2936)](https://www.zotero.org/download/)

**[⬇️ 下载最新 XPI][latest-release]** · [反馈问题][issues]

</div>

## ✨ 主要功能

- **带出处的论文问答**。围绕当前 PDF 追问，点击引用回到原文页面或批注。
- **公式与图表精读**。解释选区、推导和张量流向，支持附加 PDF 页面或本地截图。
- **深度解构与思维导图**。按十个主题梳理论文方法、实验设计、局限和可检验的研究问题。
- **研究笔记导出**。将回答、分析或导图保存到 Zotero 或 Obsidian，并保留论文链接。

## 🚀 快速上手

需要 **Zotero 10.0.8 或更新的 10.0.x**。已在 macOS Zotero 10.0.8 上验证。

1. 从 [最新 Release][latest-release] 的 **Assets** 下载 `.xpi`。在 Zotero 中打开 **工具 → 插件**，从齿轮菜单选 **从文件安装插件**（**Install Plugin From File…**）。升级也使用这个入口。
2. 打开文献条目下的 **PDF 附件**，点阅读器工具栏的 **AI**。如果安装时已打开该 PDF，关闭后重开。
3. 在侧栏点 **设置** 或 **切换模型**。选 **AI 服务商** 和模型，填写该服务商的 **API Key**，点 **测试 API**，然后点 **保存设置**。
4. 回到 PDF，在侧栏提问或点 **深度解构论文**。可在 **界面与回答语言** 选择 English、简体中文或跟随 Zotero。保存后重开 PDF，应用新的侧栏语言。

## 🔌 服务商与模型

| 服务商 | 接口 | 预设示例与官方文档 |
| --- | --- | --- |
| OpenAI | Responses | `gpt-5-mini`、`gpt-6.1-sol`。 [模型目录](https://developers.openai.com/api/docs/models) |
| DeepSeek | Responses | `deepseek-flash` 支持图像，`deepseek-v4-pro` 为文本模型。 [Responses 指南](https://api-docs.deepseek.com/guides/responses_api/) · [模型列表](https://api-docs.deepseek.com/api/list-models/) |
| Claude | Anthropic Messages | `claude-sonnet-5-5`、`claude-opus-5-5`、`claude-haiku-5-5`。 [模型概览](https://platform.claude.com/docs/en/models/overview) · [流式消息](https://platform.claude.com/docs/en/build-with-claude/streaming) |
| Xiaomi MiMo | Chat Completions | `mimo-v2.6-flash`、`mimo-v2.6-pro`。 [接口参考](https://mimo.mi.com/docs/zh-CN/api/chat/openai-api-post) · [图像输入](https://mimo.mi.com/docs/en-US/quick-start/usage-guide/multimodal-understanding/image-understanding) |
| Grok | xAI Responses | `grok-4.7`、`grok-4.3`。 [Responses 参考](https://docs.x.ai/developers/rest-api-reference/inference/responses) · [Grok 4.7](https://docs.x.ai/developers/models/grok-4.7) |
| OpenAI 兼容服务 | Chat Completions | 填写支持流式 `/chat/completions` 的接口根地址和服务商密钥。 |

在 **选择模型** 中可选预设、点 **获取账号模型**，或填写 **自定义模型 ID**。请为论文问答选择支持流式文本的模型，读图则需要图像输入能力。**测试 API** 只发送一条固定短文本，显示成功、用量或错误。测试与模型发现优先用刚输入的密钥，留空时使用该服务商或 Base URL 下保存的密钥。

兼容模式的 Base URL 可填 `https://openrouter.ai/api/v1`，或本机 Ollama 的 `http://localhost:11434/v1`。Ollama 示例的 API Key 可填 `ollama`。远程地址须使用 HTTPS。模型目录接口不可用时，直接填写服务提供的模型 ID。图像能力和 token 用量字段取决于实际模型与网关。 [OpenRouter 文档](https://openrouter.ai/docs/api_reference/overview) · [Ollama 兼容文档](https://docs.ollama.com/api/openai-compatibility)

推理菜单随服务商和模型变化。Codex 的「Max」对应推理强度，OpenAI 的 `gpt-6.1-sol` 支持 `max`，Grok 4.7 的最高档是 `xhigh`，Claude Sonnet 5.5 支持 `max`。其他模型可用 **模型默认**。 [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) · [Claude effort](https://platform.claude.com/docs/en/build-with-claude/effort) · [Grok 4.7](https://docs.x.ai/developers/models/grok-4.7)

深度解构可选自动、16,000、32,000、64,000 或由 API 决定。自动模式在 `max` 档使用 32,000，在 `medium` 档或未手动设推理强度时使用 12,000。Claude 要求显式上限，Grok 的上限只约束可见正文。显示用量以 API 返回为准。 [OpenAI 推理 token](https://developers.openai.com/api/docs/guides/reasoning) · [Claude Messages](https://platform.claude.com/docs/en/api/messages) · [Grok 推理配置](https://docs.x.ai/developers/model-capabilities/text/best-practices)

**回答最长等待** 适用于论文问答、选区精读和深度解构，默认 **不限制等待**，插件不会因经过固定时长主动停止回答。也可选 4、10、20、30、60 分钟，或自动模式（问答/选区 4 分钟，解构 `max`/`xhigh` 30 分钟、其他档位 10 分钟）。此设置与 token 预算独立，服务商或网络代理仍可能超时。运行期间显示已用时间和本次上限；超时、阅读器关闭、插件卸载和手动停止分别记录原因，旧版记录缺少原因时会如实标明。

升级时沿用已有 OpenAI 设置。各服务商分别保存模型、推理档位、预算和密钥，自定义服务按 Base URL 分开。

## 📖 读论文

### 先问一个具体问题

在 **论文对话** 中输入问题，例如「这篇论文最关键的消融是哪一项？列出对照、指标、结果和出处。」点 **发送** 或按 **⌘/Ctrl + Enter**。可以继续追问，生成时可 **停止**，失败或停止后可 **重试**。完成的回答会显示 API 返回的 token 用量。

每篇 PDF 自动在本机保存最近 30 轮对话。关闭论文标签页或重启插件后，再打开可恢复回答、证据引用、用量和思维导图，并继续追问。**清空对话** 会同时删除该附件的本地记录。关闭时尚未完成的回答会显示为已停止，不会自动重发。

### 精读公式、批注和图表

- 选中 PDF 的文字或公式，点弹窗里的 **AI 解释**。已有高亮或下划线也可从批注菜单选择 **AI 解释批注**。选区及周边匹配片段会进入请求。公式用 KaTeX 渲染，回答支持 Markdown 表格与代码块。
- 读方法图或实验表时，展开 **添加图表或页面**，输入 PDF 文件中从 1 开始的物理页码，再点 **附加页面**。也可以选择本地 PNG、JPEG 或 WebP。看到预览后提问，例如「解释图中的模块顺序和张量流向」。附图会随下一次问答或深度解构发送。

### 深度解构、核对证据和查看导图

1. 点 **深度解构论文**。分析参考 DeepPaperNote 的精读方法，沿着任务定义、机制流程、实验对照和结论边界展开。关键结果要有基线、指标、数值和出处，在 **Open Questions** 查看带出处和可检验对照的改进建议。首段正文返回前，侧栏显示 **等待首段正文**、已用时间和本次最长等待。可在设置中调整等待时间，也可随时停止。
2. 在回答中点页码跳到 PDF，或展开 **核对原文证据** 看实际提取的片段。页级引用会标出物理页码，有原页标时一并显示。引用来自已有批注时，可尝试跳到批注位置。文字标签会区分论文证据、视觉观察、推断和证据缺口。
3. 切到 **思维导图**，按分析章节展开分支和引用。

界面参考 macOS 的分段控件、系统字体、键盘焦点及浅深色配色。［[Apple macOS 设计指南](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos)］

## 📝 保存到 Zotero 或 Obsidian

在回答和深度分析中点 **保存为笔记**，或在思维导图中点 **保存导图为笔记**。每次保存会新建关联笔记，独立 PDF 的笔记关联到该附件。

公式保存为 Zotero 原生的行内或独立公式，可在笔记中渲染和编辑；论文证据、视觉观察、推断、证据缺口的颜色、重点文字高亮和引用链接一并保留。需要新版格式时，可将已完成的回答重新保存为新笔记，已有笔记不会被覆盖。

### 导出到 Obsidian

1. 打开插件 **设置**，在 **Obsidian 笔记目录** 点 **选择文件夹**，选本地 Vault 根目录或 Vault 内专门存放论文的文件夹，然后点 **保存设置**。也可以输入完整的本地路径。［[Obsidian Vault 说明](https://obsidian.md/help/vault)］
2. 在已完成的回答、深度解构或思维导图中点击 **保存到 Obsidian**。模型根据论文标题和回答片段，从该目录下的候选一级子文件夹中选一个。没有匹配项或分类请求失败时可落到 `Research Copilot/`。分类超时会提示重试。
3. 状态栏显示保存的相对路径。导出的 `.md` 保留公式、代码和 Zotero 页链接，同名笔记会编号另存。思维导图保存为 Markdown 大纲。

## ❓ 常见问题

| 现象 | 处理 |
| --- | --- |
| 侧栏只显示一个模型名 | 这是当前模型。点 **切换模型**，先选 **AI 服务商**，再展开 **选择模型**。有需要时点 **获取账号模型** 或选择 **自定义模型 ID**。 |
| 打开文献后找不到 AI | 确认插件已启用，并打开 **PDF 附件** 的阅读器。关掉安装前已打开的标签页后重开。 |
| 回答输出后一直显示「正在生成」 | 升级到 v0.4.1 或更新版本并重新打开 PDF。新版修复了回答完成时分隔线与换行触发的 Markdown 渲染错误。 |
| 深度解构显示「已达输出 token 上限」 | 部分模型把推理计入输出上限，可能在正文出现前就用完预算。可调高 **深度解构输出 token 上限**，或在模型支持时降低推理强度后重试。 |
| Max 等待约 10 分钟后结束且没有正文 | v0.6.1 的深度解构有固定 10 分钟等待上限。v0.6.2 起所有回答默认不设本地时限，可在 **回答最长等待** 自行设限。旧版仅显示「已停止」且没有中断原因的记录，无法据此确定具体触发路径。 |
| 测试或获取模型报 401、403、404 | 401 检查 API Key。403 检查项目或密钥对相应接口的权限。404 核对模型 ID 与项目访问权限，使用兼容服务时也检查 Base URL。 |
| 报 429 或超时 | 查看提示区分请求限流和配额不足。超时可检查网络或代理后重试。 |
| 扫描件提示正文证据不足 | 使用可搜索的 PDF 或先做 OCR。也可附加指定页面来提问图像。 |

## 🔒 数据与凭证

- PDF 首选 Zotero 原生 Structured Document Text（SDT），回退到 Zotero PDF worker 或阅读器的逐页文本。插件在内存构建索引。Zotero 可以按自身机制维护 SDT 缓存。
- 每次只检索当前附件。问答最多选取约 8,000 字符的原文，深度解构最多约 64,000 字符。请求包含论文标题、问题、原文证据、同一服务商与接口地址下有限的已完成历史，以及你主动附加的图像。显示 API 返回的输入、输出及推理 token 用量。
- 在片段和字符预算内，深度解构按原文顺序送入全部可索引正文。超出预算时优先覆盖方法、公式、图表标题、关键结果和相邻段落，并保留页码与提取块类型。只有摘要、标题或图片时，可使用针对选区或页面的问答。
- 插件直连所选服务商或自定义端点。Responses 请求设置 `store: false`，供应商的日志保留与数据使用由各自政策和账号设置决定。 [OpenAI API 数据控制](https://developers.openai.com/api/docs/guides/your-data) · [DeepSeek Responses 指南](https://api-docs.deepseek.com/guides/responses_api/) · [xAI Responses 参考](https://docs.x.ai/developers/rest-api-reference/inference/responses)
- **获取账号模型** 读取服务商模型目录。**测试 API** 使用固定短文本。两项操作都独立于论文请求。
- **保存到 Obsidian** 时，插件使用当前服务商分类，只发送论文标题、最多 1,200 个字符的回答片段和最多 100 个候选一级子目录名。目录完整路径与 Vault 内文件保留在本机，隐藏目录和符号链接不会参与分类。
- API Key 只用于认证各自的接口请求。默认保存在会话内存中，勾选记住密钥后，插件使用 Zotero OSKeyStore 加密。系统存储不可用时会提示使用会话模式。**移除密钥** 清除所选连接的会话密钥和加密副本。插件不记录密钥、请求正文或远端错误正文。
- 最近 30 轮聊天记录及其证据片段按文献库和 PDF 附件分别保存在 Zotero 数据目录的 `research-copilot/conversations/`，重开自动恢复；清空对话会删除对应记录。此目录只在本机使用，不通过 Zotero 笔记同步。API Key、附图内容与未发送的输入不写入聊天记录；PDF 索引在阅读器关闭或插件卸载后释放。Zotero 笔记遵循该文献库的同步设置。

## 🛠️ 构建与测试

需要 Node.js **22.13+** 和 npm。Zotero 类型包的上游依赖由锁文件固定，首次安装需能访问 npm 和 GitHub。

```sh
git clone https://github.com/Neroaway/zotero-research-copilot.git
cd zotero-research-copilot
npm ci --ignore-scripts
npm run check
npm run test:zotero
```

`npm run check` 顺序执行 TypeScript 类型检查、ESLint、Node 测试及 XPI 打包。可单独执行 `npm run build`。安装包生成在 `dist/zotero-research-copilot-<version>.xpi`。

`npm run test:zotero` 默认启动本机 macOS 的 Zotero，可通过 `ZOTERO_BIN` 指定可执行文件。它建立临时 profile 和空白文献库，安装正式 XPI 后使用合成 PDF 测试。API 响应由隔离测试插件注入，测试结束清除临时库。`ZRC_KEEP_SMOKE=1` 可保留测试现场以排查问题。

v0.6.2 通过 TypeScript、ESLint、43 项 Node 测试和 25 项 macOS Zotero 10.0.8 隔离场景。验证覆盖三类回答默认不设本地超时、可配置等待、实时耗时、明确的超时与阅读器中断原因，以及关闭标签页及重载插件后的对话恢复、继续追问、引用、导图和导出。Zotero 原生笔记公式和颜色经编辑器保存、关闭重开后保留。长时等待使用模拟时钟，API 响应由测试替身提供；没有重复发起真实付费 Max 请求。

### 工程结构

```text
addon/                Zotero manifest、bootstrap、设置页面和 CSS
src/
  ai/                 Provider 注册、Responses、Claude Messages、Chat Completions、SSE
  paper/              页和文本块、索引、检索预算与来源
  research/           会话控制、论文分析提示、证据标签、导图节点
  storage/            本地偏好、系统凭证、会话密钥
  ui/                 聊天、导图、设置、Markdown、KaTeX、附图
  zotero/             Reader 事件、侧栏挂载、PDF 适配、笔记
scripts/              构建 XPI、隔离 Zotero 测试
tests/                单元测试及隔离应用测试插件
dist/                 构建产物
```

插件采用 zotero-plugin-template 的 manifest、bootstrap 和 TypeScript 打包结构，并使用 zotero-plugin-toolkit 构建 DOM 控件。Provider、PaperLoader、索引及研究提示模块是后续接入多论文比较、向量检索、研究评审、Idea Agent 与研究画像的入口。［[插件模板](https://github.com/windingwind/zotero-plugin-template) · [Toolkit](https://github.com/windingwind/zotero-plugin-toolkit)］

## 🧩 已知限制

- 侧栏通过官方 Reader 事件进入，在 10.0.8 已核对的阅读器宿主布局旁挂载。SDT、页面渲染和宿主挂载涉及 Zotero 内部适配，版本变化可能影响这些路径。遇到图像渲染不可用时，可主动附加截图。［[Zotero 扩展文档](https://www.zotero.org/support/dev/zotero_7_for_developers#custom_reader_event_handlers) · [10.0.8 Reader 源码](https://github.com/zotero/zotero/blob/10.0.8/chrome/content/zotero/xpcom/reader.js) · [10.0.8 SDT 源码](https://github.com/zotero/zotero/blob/10.0.8/chrome/content/zotero/xpcom/sdt.js)］
- 索引有 300 页和约 200 万字符上限。扫描件需要已有文字层才能提供文本证据。复杂公式、双栏或表格的提取顺序可能有误，精读时可用页面图像。模型遗漏的分析章节会在导图中标记。
- 截图上传最多 6 MB、4,800 万像素，插件会重编码以去除文件元数据。用户截图显示为页码未核实。图像请求需要配置支持视觉输入的模型。［[Responses 流式文档](https://developers.openai.com/api/docs/guides/streaming-responses) · [OpenAI 图像输入](https://developers.openai.com/api/docs/guides/images-vision)］
- 各服务商的真实账号调用、系统凭证写入及跨重启恢复**未实测**。请求协议与密钥回退有模拟测试。Windows、Linux 及其他 Zotero 版本**未实测**。

[latest-release]: https://github.com/Neroaway/zotero-research-copilot/releases/latest
[issues]: https://github.com/Neroaway/zotero-research-copilot/issues/new
