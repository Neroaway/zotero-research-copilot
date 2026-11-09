import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { build } from "esbuild";

const output = "dist";
const addon = join(output, "addon");
const content = join(addon, "content");
const katex = "node_modules/katex";
const { version, name } = JSON.parse(await readFile("package.json", "utf8"));
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp("addon", addon, { recursive: true });
const manifest = JSON.parse(await readFile(join(addon, "manifest.json"), "utf8"));
manifest.version = version;
await writeFile(join(addon, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "iife",
  globalName: "ResearchCopilot",
  platform: "browser",
  target: "firefox140",
  legalComments: "eof",
  outfile: join(content, "copilot.js"),
  logLevel: "info",
});

// Ship local font assets so formula rendering never uses a CDN.
const css = await readFile(join(katex, "dist/katex.min.css"), "utf8");
await writeFile(join(content, "katex.min.css"),
  css.replace(/,url\(fonts\/[^)]+\.(?:woff|ttf)\) format\("[^"]+"\)/g, ""));
await mkdir(join(content, "fonts"), { recursive: true });
for (const file of await readdir(join(katex, "dist/fonts"))) {
  if (file.endsWith(".woff2")) {
    await cp(join(katex, "dist/fonts", file), join(content, "fonts", file));
  }
}
for (const library of ["katex", "markdown-it", "zotero-plugin-toolkit"]) {
  await cp(join("node_modules", library, "LICENSE"), join(content, `${library}-LICENSE.txt`));
}

const zip = new AdmZip();
zip.addLocalFolder(addon);
const xpi = join(output, `${name}-${version}.xpi`);
zip.writeZip(xpi);
console.log(xpi);
