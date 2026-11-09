import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import AdmZip from "adm-zip";

const packageInfo = JSON.parse(await readFile("package.json", "utf8"));
const xpi = resolve("dist", `${packageInfo.name}-${packageInfo.version}.xpi`);
const binary = process.env.ZOTERO_BIN || "/Applications/Zotero.app/Contents/MacOS/zotero";
const harnessID = "zrc-smoke@local.invalid";
const temporary = await mkdtemp(join(tmpdir(), "zrc-smoke-"));
const profile = join(temporary, "profile");
const data = join(temporary, "data");
const resultPath = join(temporary, "result.json");

function fixturePdf() {
  const page = (stream) => {
    const obj = ["BT", "/F1 18 Tf", "72 728 Td", ...stream, "ET", ""].join("\n");
    return `<< /Length ${Buffer.byteLength(obj)} >>\nstream\n${obj}endstream`;
  };
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R /PageLabels << /Nums [0 << /S /r >> 1 << /S /D /St 1 >>] >> >>",
    "<< /Type /Pages /Count 3 /Kids [3 0 R 4 0 R 5 0 R] >>",
    ...[7, 8, 9].map((id) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 6 0 R >> >> /Contents ${id} 0 R >>`),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length 0 >>\nstream\nendstream",
    page(["(1. Methodology) Tj", "/F1 12 Tf", "0 -25 Td",
      "(The gaze encoder uses a 64-dimensional state.) Tj", "0 -19 Td",
      "(The scanpath decoder predicts a fixation distribution.) Tj"]),
    page(["(2. Ablation Studies) Tj", "/F1 12 Tf", "0 -25 Td",
      "(Removing the gaze encoder reduces accuracy to 72 percent.) Tj", "0 -19 Td",
      "(Training uses 20 epochs with a fixed split.) Tj"]),
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = ["0000000000 65535 f "];
  for (const [i, content] of objects.entries()) {
    offsets.push(String(Buffer.byteLength(pdf)).padStart(10, "0") + " 00000 n ");
    pdf += `${i + 1} 0 obj\n${content}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n${offsets.join("\n")}\ntrailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

try {
  await mkdir(join(profile, "extensions"), { recursive: true });
  await mkdir(data);
  const harness = new AdmZip();
  harness.addFile("manifest.json", Buffer.from(JSON.stringify({
    manifest_version: 2, name: "Research Copilot Smoke Harness", version: "1.0",
    applications: { zotero: { id: harnessID, update_url: "https://zrc-smoke.invalid/updates.json", strict_min_version: "10.0.8", strict_max_version: "10.0.*" } },
  })));
  harness.addLocalFile("tests/smoke/zotero-bootstrap.js", "", "bootstrap.js");
  harness.writeZip(join(profile, "extensions", `${harnessID}.xpi`));
  await copyFile(xpi, join(temporary, "plugin.xpi"));
  await writeFile(join(temporary, "fixture.pdf"), fixturePdf());
  await writeFile(join(profile, "user.js"), [
    ["extensions.zotero.useDataDir", true],
    ["extensions.zotero.dataDir", data],
    ["extensions.zotero.firstRun", false],
    ["extensions.zotero.firstRunGuidance", false],
    ["extensions.update.enabled", false],
    ["extensions.zotero.automaticScraperUpdates", false],
    ["extensions.zotero.retractions.enabled", false],
    ["extensions.autoDisableScopes", 0],
    ["extensions.logging.enabled", true],
    ["xpinstall.signatures.required", false],
    ["app.update.enabled", false],
    ["app.update.auto", false],
    ["intl.locale.requested", "en-US"],
  ].map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});\n`).join(""));
  const debugArgs = process.env.ZRC_KEEP_SMOKE === "1" ? ["-ZoteroDebugText"] : [];
  const child = spawn(binary, ["-headless", "-no-remote", "-profile", profile, ...debugArgs], {
    env: { ...process.env, MOZ_HEADLESS: "1", MOZ_CRASHREPORTER_DISABLE: "1" },
  });
  const logFile = process.env.ZRC_KEEP_SMOKE === "1" && createWriteStream(join(temporary, "zotero.log"));
  if (logFile) console.log(`Test profile: ${temporary}`);
  let logs = "";
  for (const pipe of [child.stdout, child.stderr]) {
    pipe.setEncoding("utf8").on("data", (chunk) => { if (logFile) logFile.write(chunk); logs = (logs + chunk).slice(-12_000); });
  }
  const timer = setTimeout(() => child.kill("SIGTERM"), 100_000);
  try {
    await new Promise((complete, fail) => {
      child.once("error", fail);
      child.once("exit", complete);
    });
  } finally {
    clearTimeout(timer);
    if (logFile) logFile.end();
  }
  const result = await readFile(resultPath, "utf8").then(JSON.parse).catch(() => null);
  if (!result?.ok) {
    process.stderr.write(logs);
    const progress = await readFile(join(temporary, "progress.json"), "utf8").catch(() => "[]");
    const stage = await readFile(join(temporary, "stage.txt"), "utf8").catch(() => "startup");
    throw new Error(result ? JSON.stringify(result) : `Zotero stopped at ${stage}. Passed: ${progress}`);
  }
  for (const check of result.checks) console.log(`PASS ${check}`);
} finally {
  if (process.env.ZRC_KEEP_SMOKE !== "1") await rm(temporary, { recursive: true, force: true });
}
