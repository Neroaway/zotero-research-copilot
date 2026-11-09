import { CopilotError } from "../errors.ts";
import type { ErrorCode } from "../errors.ts";
import type { Language } from "../storage/settings.ts";
import { tr } from "./i18n.ts";

const MESSAGES: Record<ErrorCode, [string, string]> = {
  "missing-key": ["Add your OpenAI API key in Settings, then retry.", "请在设置中输入 OpenAI API Key，再重试。"],
  "locked-key": ["The saved key could not be read. Unlock the OS credential store or enter the key again.", "读取已存密钥失败。请解锁系统凭证存储，或重新输入密钥。"],
  "input-limit": ["Use a question of at most 3,000 characters.", "问题最多可输入 3,000 个字符。"],
  "empty-input": ["Enter a question first.", "请先输入问题。"],
  "no-text": ["No citable text was extracted. Select text in the PDF or attach a page image. Scans may need OCR.", "未提取到可引用文本。请尝试选区或附加页面图像。扫描件可能需要 OCR。"],
  "insufficient-analysis-text": ["Deep analysis needs excerpts from the PDF body. Use a text-searchable PDF, run OCR, or ask about a specific page.", "深度解构需要 PDF 正文证据。请换用可检索的 PDF、先做 OCR，或针对指定页面提问。"],
  "file-unavailable": ["Zotero could not read the current PDF. Check that the attachment has downloaded.", "Zotero 无法读取当前 PDF。请确认附件已下载。"],
  "file-changed": ["The PDF changed. Reopen it and run this request again.", "PDF 已发生变更。请重新打开后再发起请求。"],
  "reader-layout": ["This reader layout could not mount the sidebar.", "此阅读器布局无法挂载侧栏。"],
  "invalid-page": ["Enter a physical PDF page number within this document.", "请输入本文档范围内的 PDF 物理页码。"],
  "capture-unavailable": ["Page rendering is unavailable here. Attach a local screenshot instead.", "当前无法渲染 PDF 页面。可以手动附加本地截图。"],
  "image-format": ["Choose a valid PNG, JPEG, or WebP image.", "请选择有效的 PNG、JPEG 或 WebP 图像。"],
  "image-size": ["Choose an image up to 6 MB and 48 megapixels.", "请选择不超过 6 MB、4,800 万像素的图像。"],
  "not-editable": ["This library is read-only. Zotero cannot create a note here.", "当前文献库为只读，Zotero 无法在此新建笔记。"],
  "note-failed": ["Zotero could not save the note.", "Zotero 未能保存笔记。"],
  "navigation-failed": ["Zotero could not jump to this reference.", "Zotero 未能跳转到这条引用。"],
  "network": ["Could not reach the OpenAI API. Check the network and proxy settings.", "无法连接 OpenAI API。请检查网络和代理设置。"],
  "timeout": ["The request timed out. Try again or narrow the question.", "请求超时。请重试或缩小问题范围。"],
  "auth": ["OpenAI rejected the API key. Check or replace it in Settings.", "OpenAI 拒绝了 API Key。请在设置中检查或更换密钥。"],
  "permission": ["The OpenAI project may lack permission for this model.", "当前 OpenAI 项目可能无权使用此模型。"],
  "rate-limit": ["OpenAI rate limited this request. Wait briefly, then retry.", "OpenAI 限制了本次请求频率。请稍后重试。"],
  "quota": ["The OpenAI project has insufficient quota or billing credit.", "OpenAI 项目的额度或余额不足。"],
  "bad-request": ["OpenAI rejected the request. Check the model ID and support for Responses or image input.", "OpenAI 拒绝了请求。请检查模型 ID，以及模型是否支持 Responses API 或图像输入。"],
  "server": ["OpenAI returned a server error. Retry in a moment.", "OpenAI 返回了服务端错误。请稍后重试。"],
  "stream": ["The response stream ended unexpectedly. Retry to regenerate.", "响应流异常中断。请重试以重新生成。"],
  "incomplete": ["OpenAI returned an incomplete response. Try a narrower request or another model.", "OpenAI 返回了未完成的回答。可以缩小问题范围或切换模型。"],
  "refusal": ["The model declined this request.", "模型拒绝了本次请求。"],
  "empty-response": ["The model returned no readable answer.", "模型未返回可读回答。"],
};

export function errorMessage(error: unknown, language: Language): string {
  const code = error instanceof CopilotError ? error.code : "stream";
  const [en, zh] = MESSAGES[code];
  const status = error instanceof CopilotError && error.status ? ` (HTTP ${error.status})` : "";
  return tr(language, en, zh) + status;
}
