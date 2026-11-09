# Zotero Research Copilot

面向计算机视觉论文的 Zotero PDF 阅读插件。在阅读器右侧栏提问、精读公式和图表、核对论文证据，也可生成深度分析和思维导图并保存为 Zotero 笔记。

[下载最新安装包](https://github.com/Neroaway/zotero-research-copilot/releases/latest)

## 安装或升级

1. 使用 **Zotero 10.0.8 或更新的 10.0.x**。本项目在 macOS Zotero 10.0.8 上运行验证。
2. 下载 Release 中的 `.xpi` 附件，或使用下文构建的安装包。在 Zotero 中打开 **工具 → 插件**，从齿轮菜单选 **Install Plugin From File…**，选择该文件。安装新版沿用同样的步骤。
3. 打开文献条目下的 **PDF 附件**，点阅读器工具栏的 **AI**。安装前已经打开的 PDF，请关闭后重开。

## 配置和切换模型

1. 在 AI 侧栏点 **切换模型** 或 **设置**，也可从 Zotero 设置中打开 **Zotero Research Copilot**。
2. 输入自己的 OpenAI API Key。点 **选择模型** 展开下拉菜单，默认是 `gpt-5-mini`，也有 GPT-5.4、GPT-5.6 Terra 和 GPT-6 系列等预设。其他模型可通过 **自定义模型 ID** 输入。［[OpenAI 模型目录](https://developers.openai.com/api/docs/models)］
3. 想查看密钥对应的更多模型时，点 **获取账号模型**。返回的 ID 会加入下拉菜单的「账号模型」分组。权限和输入能力随模型而异，选中后用 **测试 API** 确认文本请求。需要读图时，请选支持图像输入的模型。［[OpenAI 模型列表接口](https://developers.openai.com/api/reference/resources/models/methods/list) · [图像输入](https://developers.openai.com/api/docs/guides/images-vision)］
4. 点 **测试 API** 会发送一条固定短文本，显示成功、token 用量或具体错误。获取模型与测试都优先使用刚输入的密钥，输入框为空时使用已配置的密钥。
5. 点 **保存设置** 应用模型和密钥。侧栏会即时显示新模型，下一次请求使用它。可以选择 English、简体中文或跟随 Zotero，重新打开 PDF 会应用新的侧栏语言。

密钥默认在当前 Zotero 会话有效。想跨重启保留时，输入密钥并勾选系统凭证加密后保存。系统存储不可用时会提示使用会话模式。**移除密钥** 会清除会话密钥及加密副本。

## 读论文

### 先问一个具体问题

在 **论文对话** 中输入问题，例如「这篇论文最关键的消融是哪一项？列出对照、指标、结果和出处。」点 **发送** 或按 **⌘/Ctrl + Enter**。可以继续追问，生成时可 **停止**，失败或停止后可 **重试**。完成的回答会显示 API 返回的 token 用量。

### 精读公式、批注和图表

- 选中 PDF 的文字或公式，点弹窗里的 **AI 解释**。已有高亮或下划线也可从批注菜单选择 **AI 解释批注**。选区及周边匹配片段会进入请求。公式用 KaTeX 渲染，回答支持 Markdown 表格与代码块。
- 读方法图或实验表时，展开 **添加图表或页面**，输入 PDF 文件中从 1 开始的物理页码，再点 **附加页面**。也可以选择本地 PNG、JPEG 或 WebP。看到预览后提问，例如「解释图中的模块顺序和张量流向」。附图会随下一次问答或深度解构发送。

### 深度解构、核对证据和保存

1. 点 **深度解构论文**。分析参考 DeepPaperNote 的证据优先设计，按十个主题梳理任务、机制、公式、实验、消融、局限和复现。在 **Open Questions** 查看带出处和可检验对照的待验证改进建议。
2. 在回答中点页码跳到 PDF，或展开 **核对原文证据** 看实际提取的片段。页级引用会标出物理页码，有原页标时一并显示。引用来自已有批注时，可尝试跳到批注位置。文字标签会区分论文证据、视觉观察、推断和证据缺口。
3. 切到 **思维导图** 展开分支，点 **保存导图为笔记** 将大纲与引用保存到 Zotero。回答和深度分析也可分别点 **保存为笔记**。每次保存新建关联条目，独立 PDF 则关联到该附件。

界面参考 macOS 的分段控件、系统字体、键盘焦点及浅深色配色。［[Apple macOS 设计指南](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos)］

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 侧栏只显示一个模型名 | 这是当前模型。安装最新版后，点 **切换模型**，再展开 **选择模型**。有需要时点 **获取账号模型** 或选择 **自定义模型 ID**。 |
| 打开文献后找不到 AI | 确认插件已启用，并打开 **PDF 附件** 的阅读器。关掉安装前已打开的标签页后重开。 |
| 测试或获取模型报 401、403、404 | 401 检查 API Key。403 检查项目或密钥对相应接口的权限。404 核对模型 ID 与项目访问权限。 |
| 报 429 或超时 | 查看提示区分请求限流和配额不足。超时可检查网络或代理后重试。 |
| 扫描件提示正文证据不足 | 使用可搜索的 PDF 或先做 OCR。也可附加指定页面来提问图像。 |

## 数据与凭证

- PDF 首选 Zotero 原生 Structured Document Text（SDT），回退到 Zotero PDF worker 或阅读器的逐页文本。插件在内存构建索引。Zotero 可以按自身机制维护 SDT 缓存。
- 每次只检索当前附件。问答最多选取约 8,000 字符的原文，深度解构最多约 22,000 字符。请求包含论文标题、问题、所选片段、有限的已完成历史，以及你主动附加的图像。显示 API 返回的输入和输出 token。
- 深度解构优先选公式、图表标题、关键结果和相邻段落，并保留页码与提取块类型。只有摘要、标题或图片时，可使用针对选区或页面的问答。深度解构需要可提取的正文证据。
- API 请求直连 `https://api.openai.com/v1/responses`，使用 HTTPS 和 `store: false`。OpenAI 对 API 请求的保留行为取决于账户数据控制设置。［[OpenAI API 数据控制](https://developers.openai.com/api/docs/guides/your-data)］
- **获取账号模型** 使用 `GET /v1/models` 读取模型 ID。**测试 API** 使用固定短文本，两项操作都独立于论文请求。
- OpenAI API Key 只用于认证请求。会话密钥留在内存。持久化选项调用 Zotero 的 OSKeyStore，配置文件只保存加密值。插件不记录密钥、请求正文或远端错误正文。
- 聊天记录和插件索引在对应阅读器关闭或卸载后释放。保存的笔记遵循 Zotero 自身的同步设置。每次保存创建新条目，原始 PDF 和已有笔记不被编辑。

## 构建与测试

需要 Node.js **22.13+** 和 npm。Zotero 类型包的上游依赖由锁文件固定，首次安装需能访问 npm 和 GitHub。

```sh
git clone https://github.com/Neroaway/zotero-research-copilot.git
cd zotero-research-copilot
npm ci --ignore-scripts
npm run check
npm run test:zotero
```

`npm run check` 顺序执行 TypeScript 类型检查、ESLint、Node 测试及 XPI 打包。可单独执行 `npm run build`。当前构建产物为 `dist/zotero-research-copilot-0.4.0.xpi`。

`npm run test:zotero` 默认启动本机 macOS 的 Zotero，可通过 `ZOTERO_BIN` 指定可执行文件。它建立临时 profile 和空白文献库，安装正式 XPI 后使用合成 PDF 测试。OpenAI 响应由隔离测试插件注入，测试结束清除临时库。`ZRC_KEEP_SMOKE=1` 可保留测试现场以排查问题。

本机构建与验证通过 TypeScript、ESLint、17 项 Node 测试、XPI 压缩包检查和 13 项 Zotero 隔离场景。集成测试覆盖从侧栏切换模型、账号模型获取、API 测试、PDF 文本与图像、引用跳转，以及导图和笔记保存。测试确认已有笔记与 PDF 字节保持一致。

## 工程结构

```text
addon/                Zotero manifest、bootstrap、设置页面和 CSS
src/
  ai/                 Provider 接口、OpenAI Responses、SSE 解析
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

## 已知限制

- 侧栏通过官方 Reader 事件进入，在 10.0.8 已核对的阅读器宿主布局旁挂载。SDT、页面渲染和宿主挂载涉及 Zotero 内部适配，版本变化可能影响这些路径。遇到图像渲染不可用时，可主动附加截图。［[Zotero 扩展文档](https://www.zotero.org/support/dev/zotero_7_for_developers#custom_reader_event_handlers) · [10.0.8 Reader 源码](https://github.com/zotero/zotero/blob/10.0.8/chrome/content/zotero/xpcom/reader.js) · [10.0.8 SDT 源码](https://github.com/zotero/zotero/blob/10.0.8/chrome/content/zotero/xpcom/sdt.js)］
- 索引有 300 页和约 200 万字符上限。扫描件需要已有文字层才能提供文本证据。复杂公式、双栏或表格的提取顺序可能有误，精读时可用页面图像。模型遗漏的分析章节会在导图中标记。
- 截图上传最多 6 MB、4,800 万像素，插件会重编码以去除文件元数据。用户截图显示为页码未核实。图像请求需要配置支持视觉输入的模型。［[Responses 流式文档](https://developers.openai.com/api/docs/guides/streaming-responses) · [OpenAI 图像输入](https://developers.openai.com/api/docs/guides/images-vision)］
- 真实 OpenAI 账户调用、系统凭证写入及跨重启恢复**未实测**。请求协议与密钥回退有模拟测试。Windows、Linux 及其他 Zotero 版本**未实测**。
