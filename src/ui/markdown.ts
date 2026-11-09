import katex from "katex";
import MarkdownIt from "markdown-it";
import type { Evidence } from "../paper/types.ts";
import type { Language } from "../storage/settings.ts";
import { evidenceLabel } from "./evidence.ts";
import { tr } from "./i18n.ts";

const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false })
  .disable(["link", "image", "autolink", "linkify"]);

export const escapeHTML = (text: string) => markdown.utils.escapeHtml(text);

interface RenderEnv {
  language: Language;
  sources: Map<string, Evidence>;
  noteLink?: (evidence: Evidence) => string | undefined;
}

const LABELS: Record<string, [string, string, string]> = {
  "Paper evidence": ["paper", "Paper evidence", "论文证据"],
  "Visual observation": ["visual", "Visual observation", "视觉观察"],
  "Inference": ["inference", "Inference", "AI 推断"],
  "Evidence unavailable": ["missing", "Evidence unavailable", "证据不足"],
  "Unsupported claim": ["missing", "Unsupported claim", "结论缺少可核验来源"],
  "Unclassified output": ["missing", "Unclassified output", "模型未标注依据"],
};

markdown.inline.ruler.before("emphasis", "zrc_cite", (state, silent) => {
  if (state.src[state.pos] !== "[") return false;
  const match = /^\[\[(E[1-9]\d{0,3})\]\]/u.exec(state.src.slice(state.pos, state.pos + 10));
  if (!match?.[1]) return false;
  if (!silent) state.push("zrc_cite", "", 0).content = match[1];
  state.pos += match[0].length;
  return true;
});

markdown.inline.ruler.before("emphasis", "zrc_label", (state, silent) => {
  const first = state.src[state.pos];
  if (first !== "[" && first !== "*") return false;
  const match = /^(\*\*)?\[([A-Za-z ]{3,30})\]\1/u.exec(state.src.slice(state.pos, state.pos + 38));
  if (!match?.[2] || !Object.hasOwn(LABELS, match[2])) return false;
  if (!silent) state.push("zrc_label", "", 0).content = match[2];
  state.pos += match[0].length;
  return true;
});

markdown.inline.ruler.before("escape", "zrc_math", (state, silent) => {
  const start = state.pos;
  const src = state.src;
  const open = src.startsWith("\\(", start) ? "\\(" : src[start] === "$" && src[start + 1] !== "$" ? "$" : "";
  if (!open || /\s/u.test(src[start + open.length] ?? " ")) return false;
  const close = open === "$" ? "$" : "\\)";
  let end = src.indexOf(close, start + open.length);
  while (end >= 0 && src[end - 1] === "\\") end = src.indexOf(close, end + close.length);
  if (end <= start + open.length || end + close.length > state.posMax) return false;
  const value = src.slice(start + open.length, end);
  if (!value.trim() || value.length > 2_000 || value.includes("\n")
    || (open === "$" && (/\s$/u.test(value) || /\d/u.test(src[end + 1] ?? "")))) return false;
  if (!silent) {
    const token = state.push("zrc_math", "", 0);
    token.content = value;
    token.markup = open;
  }
  state.pos = end + close.length;
  return true;
});

markdown.block.ruler.before("fence", "zrc_math_display", (state, start, end, silent) => {
  const line = (i: number) => state.src.slice((state.bMarks[i] ?? 0) + (state.tShift[i] ?? 0), state.eMarks[i]).trim();
  const first = line(start);
  const open = first.startsWith("$$") ? "$$" : first.startsWith("\\[") ? "\\[" : "";
  if (!open) return false;
  const close = open === "$$" ? "$$" : "\\]";
  let current = first.slice(open.length);
  const parts = [];
  let i = start;
  while (!current.endsWith(close)) {
    parts.push(current);
    if (++i >= end || i - start > 35) return false;
    current = line(i);
  }
  parts.push(current.slice(0, -close.length));
  const text = parts.join("\n").trim();
  if (!text || text.length > 4_000) return false;
  if (silent) return true;
  const token = state.push("zrc_math_display", "", 0);
  token.block = true;
  token.content = text;
  token.markup = open;
  token.map = [start, i + 1];
  state.line = i + 1;
  return true;
});

function math(text: string, open: string, env: RenderEnv, displayMode: boolean) {
  const close = open === "\\(" ? "\\)" : open === "\\[" ? "\\]" : open;
  const literal = `${open}${text}${close}`;
  if (env.noteLink) return displayMode ? `<pre><code>${escapeHTML(literal)}</code></pre>\n` : `<code>${escapeHTML(literal)}</code>`;
  try {
    return katex.renderToString(text, { displayMode, trust: false, throwOnError: true, maxExpand: 300, maxSize: 12, strict: "ignore" });
  } catch {
    return `<code class="zrc-math-fallback">${escapeHTML(literal)}</code>`;
  }
}

markdown.renderer.rules.zrc_math = (tokens, i, _options, data) => math(tokens[i]!.content, tokens[i]!.markup, data as unknown as RenderEnv, false);
markdown.renderer.rules.zrc_math_display = (tokens, i, _options, data) => math(tokens[i]!.content, tokens[i]!.markup, data as unknown as RenderEnv, true);
function renderLabel(label: string, env: RenderEnv): string {
  const [kind, en, zh] = LABELS[label]!;
  const text = escapeHTML(tr(env.language, en, zh));
  return env.noteLink ? `<strong>[${text}]</strong>` : `<strong class="zrc-label zrc-label-${kind}">${text}</strong>`;
}
markdown.renderer.rules.zrc_label = (tokens, i, _options, data) => renderLabel(tokens[i]!.content, data as unknown as RenderEnv);
markdown.renderer.rules.paragraph_open = (tokens, i, options, data, renderer) => {
  const children = tokens[i + 1]?.children ?? [];
  const hasText = children.some((token) => token.type === "text" && /[\p{L}\p{N}]/u.test(token.content));
  const unlabeled = hasText && !children.some(({ type }) => type === "zrc_label");
  const opening = renderer.renderToken(tokens, i, options);
  return unlabeled ? opening + renderLabel("Unclassified output", data as unknown as RenderEnv) + " " : opening;
};
markdown.renderer.rules.zrc_cite = (tokens, i, _options, data) => {
  const env = data as unknown as RenderEnv;
  const id = tokens[i]!.content;
  const evidence = env.sources.get(id);
  if (!evidence) return `<em>[${tr(env.language, "unverified source", "来源未核实")}]</em>`;
  const label = escapeHTML(evidenceLabel(evidence.source, env.language, true));
  if (env.noteLink) {
    const href = env.noteLink(evidence);
    return href ? `<a href="${escapeHTML(href)}">[${label}]</a>` : `[${label}]`;
  }
  return `<span class="zrc-cite-slot">${id}</span>`;
};

export function usedCitations(text: string): Set<string> {
  return new Set(markdown.parse(text, {}).flatMap((token) => token.children ?? [])
    .filter((child) => child.type === "zrc_cite").map((child) => child.content));
}

export function renderMarkdown(
  text: string,
  evidence: Evidence[],
  language: Language,
  noteLink?: RenderEnv["noteLink"],
): string {
  // Raw HTML, links, and images are disabled for all untrusted model content.
  // Custom tokens render only locally resolved citations, escaped text or untrusted KaTeX.
  return markdown.render(text, {
    language, sources: new Map(evidence.map((entry) => [entry.id, entry])), noteLink,
  } satisfies RenderEnv);
}
