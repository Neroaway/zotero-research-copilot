/** Keep fenced code and display math together inside their parent idea. */
export function branchNodes(markdown: string): string[] {
  const nodes: string[] = [];
  let buffer: string[] = [];
  let fence = "";
  let math = "";
  const flush = () => {
    const node = buffer.join("\n").trim();
    if (node) nodes.push(node.replace(/^[-+*]\s+/u, ""));
    buffer = [];
  };
  for (const line of markdown.split(/\r?\n/u)) {
    const edge = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1];
    if (edge && (!fence || edge[0] === fence[0] && edge.length >= fence.length)) {
      fence = fence ? "" : edge;
      buffer.push(line);
      continue;
    }
    const trim = line.trim();
    if (!fence && math && trim.endsWith(math)) {
      math = "";
      buffer.push(line);
      continue;
    }
    if (!fence && !math && trim.startsWith("\\[") && !trim.endsWith("\\]")) math = "\\]";
    if (!fence && !math && trim.startsWith("$$") && (trim.length === 2 || !trim.slice(2).endsWith("$$"))) math = "$$";
    if (!fence && !math && (!trim || /^[-+*]\s/u.test(line))) flush();
    if (trim || fence || math) buffer.push(line);
  }
  flush();
  return nodes;
}
