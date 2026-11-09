import { CopilotError } from "../errors.ts";
import type { VisualInput } from "../paper/types.ts";
import { html } from "./dom.ts";

const MAX_FILE = 6 * 1024 * 1024;

function mimeFor(bytes: Uint8Array): string | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => bytes[i] === byte)) return "image/png";
  if ([0x52, 0x49, 0x46, 0x46].every((byte, i) => bytes[i] === byte)
    && [0x57, 0x45, 0x42, 0x50].every((byte, i) => bytes[i + 8] === byte)) return "image/webp";
}

/** Decode a user-selected raster and drop file metadata by re-encoding it. */
export async function prepareUpload(file: File, doc: Document): Promise<VisualInput> {
  if (!file.size || file.size > MAX_FILE) throw new CopilotError("image-size");
  const type = mimeFor(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  if (!type) throw new CopilotError("image-format");
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  if (!win) throw new CopilotError("image-format");
  const url = win.URL.createObjectURL(file.slice(0, file.size, type));
  const image = html(doc, "img");
  const canvas = html(doc, "canvas");
  try {
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error();
    if (image.naturalWidth * image.naturalHeight > 48_000_000) throw new CopilotError("image-size");
    const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error();
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataURL = canvas.toDataURL("image/jpeg", 0.9);
    if (!dataURL.startsWith("data:image/jpeg;base64,")) throw new Error();
    return { kind: "upload", dataURL };
  } catch (error) {
    if (error instanceof CopilotError) throw error;
    throw new CopilotError("image-format");
  } finally {
    win.URL.revokeObjectURL(url);
    canvas.width = canvas.height = 0;
  }
}
