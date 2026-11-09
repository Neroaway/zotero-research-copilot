import { CopilotError } from "../errors.ts";

const MAX_EVENT_CHARS = 2_000_000;

export async function* eventData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const stream = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fields: string[] = [];
  let fieldChars = 0;
  try {
    for (;;) {
      const { done, value } = await stream.read();
      buffer += decoder.decode(value, { stream: !done });
      // CR, LF, and CRLF delimit lines. Keep a trailing CR until the next chunk
      // so the LF in a split CRLF is not interpreted as an empty line.
      const lines = buffer.split(/\r\n|\r(?!$)|\n/u);
      buffer = lines.pop() ?? "";
      if (done) {
        if (buffer) lines.push(buffer.replace(/\r$/u, ""));
        lines.push("");
        buffer = "";
      }
      if (buffer.length > MAX_EVENT_CHARS) throw new CopilotError("stream");
      for (const line of lines) {
        if (line === "") {
          if (fields.length) yield fields.join("\n");
          fields = [];
          fieldChars = 0;
        } else if (line.startsWith("data:") || line === "data") {
          const data = line.slice(5).replace(/^ /u, "");
          fieldChars += data.length + 1;
          if (fieldChars > MAX_EVENT_CHARS) throw new CopilotError("stream");
          fields.push(data);
        }
      }
      if (done) return;
    }
  } finally {
    void stream.cancel().catch(() => {});
    stream.releaseLock();
  }
}
