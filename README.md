# Zotero Research Copilot

面向计算机视觉论文的 Zotero PDF 阅读插件。打开 PDF 后，从阅读器工具栏的 **AI** 进入右侧栏。可以针对当前论文追问、精读选区和公式，或一次生成十节深度分析及可展开的思维导图。分析、问答记录和导图大纲可分别保存为新的 Zotero 笔记。

## 安装与配置

1. 使用 **Zotero 10.0.8 或更新的 10.0.x**。运行验证使用 macOS 上的 Zotero 10.0.8。
2. 从 [GitHub Releases](https://github.com/Neroaway/zotero-research-copilot/releases/latest) 下载发布版 `.xpi`，或使用下文构建的安装包。在 Zotero 打开 **工具 → 插件**，从齿轮菜单选择 **Install Plugin From File…**，选取该文件。安装前已打开的 PDF 需要关闭后重开。
3. 打开 PDF，点击工具栏 **AI**，再点侧栏 **设置**。也可以直接在 Zotero 的设置窗口打开 **Zotero Research Copilot**。
4. 输入你自己的 OpenAI API Key，再从 **OpenAI 模型** 下拉菜单选择模型，默认 `gpt-5-mini`。也可选择 **自定义模型 ID** 输入其他支持 Responses API 的模型。界面与回答语言可自动跟随 Zotero，或选择 English、简体中文。重新打开 PDF 会应用新的侧栏语言。［[OpenAI 模型目录](https://developers.openai.com/api/docs/models)］
5. 点击 **测试 API**，用当前选中的模型发送一次固定短文本请求。优先使用刚输入的密钥，输入框为空时使用已配置的密钥。成功时显示模型和 API 返回的 token 用量。失败时会提示密钥、项目权限、模型、配额、限流或网络问题。项目权限以实际测试结果为准。
6. 点击 **保存设置** 将配置应用到后续论文对话。默认使用会话密钥，退出 Zotero 后需重新输入。若希望保留，输入密钥时勾选系统凭证加密选项。系统存储不可用时，设置页会显示会话回退。点 **移除密钥** 可清除会话密钥与加密副本。

从 Releases 下载新版 XPI 后，沿用同样的步骤手动更新。

## 读论文

| 操作 | 用法 |
| --- | --- |
| 论文对话 | 询问网络结构、张量维度、loss、数据集、指标、基线或消融。用 **发送** 或 **⌘/Ctrl + Enter** 提交。流式生成时可停止，失败或停止后可重试。 |
| 选区精读 | 在 PDF 中选择文本，点击选区弹窗里的 **AI 解释**。也可在已有文本批注的菜单中选择 **AI 解释批注**。模型收到选区及匹配的周边片段。 |
| 公式与代码 | Markdown 支持标题、列表、表格与代码块。公式支持 `$…$`、`$$…$$`、`\(…\)`、`\[…\]`，通过随插件分发的 KaTeX 资源渲染。 |
| 图和表 | 展开 **添加图表或页面**。输入从 1 开始的 PDF **物理页码**并附加页面，或主动附加 PNG、JPEG、WebP 截图。预览出现后，随下一次问答或深度解构发送。 |
| 深度解构 | 参考 DeepPaperNote 的证据优先设计。十个主题覆盖任务与数据、贡献、机制流程、公式、关键结果、消融、局限、复现和开放问题。沿原文顺序读取选中的正文证据，并显示实际提交的文本页覆盖。 |
| 论文改进建议 | 在 Open Questions 查看最多三条待验证建议。每条包含论文依据、要验证的缺口、实验改动或对照、评价指标及会削弱假设的结果。缺少 PDF 引用的建议会单独标记。 |
| 思维导图 | 深度解构后切换到 **思维导图**。点开十个分支查看观点、公式和引用，点 **保存导图为笔记** 可保存带引用的层级大纲。导图复用同一次分析。 |
| 引用与笔记 | 点回答里的页码跳到 PDF，在 **核对原文证据** 展开对应提取片段。点 **保存为笔记** 新建关联笔记。无父条目的 PDF 会新建独立笔记并关联该附件。 |

引用以 PDF 物理页码为主，原始页标可用时一并显示。普通证据标记为页级定位，有已保存批注时会尝试定位到批注。插件只连接到本次请求里的证据 ID，并显示本地提取的原文。是否足以支持模型结论，可以在展开的原文中核对。论文证据、视觉观察、推断和证据缺口用文字标签区分。界面参考 macOS 的分段控件、系统字体、清晰的键盘焦点及浅深色配色。［[Apple macOS 设计指南](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos) · [分段控件](https://developer.apple.com/design/human-interface-guidelines/segmented-controls) · [颜色](https://developer.apple.com/design/human-interface-guidelines/color)］

## 数据与凭证

- PDF 首选 Zotero 原生 Structured Document Text（SDT），回退到 Zotero PDF worker 或阅读器的逐页文本。插件在内存构建索引。Zotero 可以按自身机制维护 SDT 缓存。
- 每次只检索当前附件。问答最多选取约 8,000 字符的原文，深度解构最多约 22,000 字符。请求包含论文标题、问题、所选片段、有限的已完成历史，以及你主动附加的图像。显示 API 返回的输入和输出 token。
- 深度解构优先选公式、图表标题、关键结果和相邻段落，并保留页码与提取块类型。只有摘要、标题或图片时，可使用针对选区或页面的问答。深度解构需要可提取的正文证据。
- API 请求直连 `https://api.openai.com/v1/responses`，使用 HTTPS 和 `store: false`。OpenAI 对 API 请求的保留行为取决于账户数据控制设置。［[OpenAI API 数据控制](https://developers.openai.com/api/docs/guides/your-data)］
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

`npm run check` 顺序执行 TypeScript 类型检查、ESLint、Node 测试及 XPI 打包。可单独执行 `npm run build`。当前构建产物为 `dist/zotero-research-copilot-0.3.0.xpi`。

`npm run test:zotero` 默认启动本机 macOS 的 Zotero，可通过 `ZOTERO_BIN` 指定可执行文件。它建立临时 profile 和空白文献库，安装正式 XPI 后使用合成 PDF 测试。OpenAI 响应由隔离测试插件注入，测试结束清除临时库。`ZRC_KEEP_SMOKE=1` 可保留测试现场以排查问题。

本机构建与验证通过 TypeScript、ESLint、16 项 Node 测试、XPI 压缩包检查和 12 项 Zotero 隔离场景。集成测试覆盖模型选择、API 测试、PDF 文本与图像、页码和批注跳转，以及带证据覆盖和改进建议的导图笔记。测试确认已有笔记与 PDF 字节保持一致。

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
