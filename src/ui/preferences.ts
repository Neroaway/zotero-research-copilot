import { FilePickerHelper } from "zotero-plugin-toolkit";
import { testOpenAIConnection, withApiTimeout } from "../ai/connection.ts";
import type { OpenAIProvider } from "../ai/openai.ts";
import { ANALYSIS_BUDGETS } from "../ai/output-budget.ts";
import { reasoningOptions, supportedReasoning } from "../ai/reasoning.ts";
import { CopilotError } from "../errors.ts";
import { DEFAULT_MODEL, resolveLanguage, validKey, validModel } from "../storage/settings.ts";
import type { KeyStatus, LanguageSetting, Settings } from "../storage/settings.ts";
import { validateObsidianPath } from "../zotero/obsidian.ts";
import { button, html } from "./dom.ts";
import { tr } from "./i18n.ts";
import { errorMessage } from "./messages.ts";

const MODEL_PRESETS = [
  DEFAULT_MODEL, "gpt-5.4-nano", "gpt-5.4-mini", "gpt-5.4", "gpt-5.6-terra",
  "gpt-6-luna", "gpt-6.1-terra", "gpt-6.1-sol", "gpt-6-astra",
];

export function mountPreferences(root: Element, settings: Settings, provider: OpenAIProvider, locale: string): void {
  const host = root.querySelector(".zrc-preferences-content");
  if (!host || host.childElementCount) return;
  const doc = root.ownerDocument;
  const currentLanguage = () => resolveLanguage(settings.language, locale);
  const t = (en: string, zh: string) => tr(currentLanguage(), en, zh);
  const model = html(doc, "select", "zrc-model-select");
  const presets = html(doc, "optgroup");
  presets.label = t("Presets", "预设模型");
  const accountModels = html(doc, "optgroup", "zrc-account-models");
  accountModels.label = t("Account models · test before use", "账号模型 · 使用前请测试");
  function modelOption(id: string) {
    const option = html(doc, "option", "", id);
    option.value = id;
    return option;
  }
  presets.append(...MODEL_PRESETS.map(modelOption));
  const customOption = html(doc, "option", "", t("Custom model ID…", "自定义模型 ID…"));
  customOption.value = "";
  model.append(presets, customOption);
  const savedModel = settings.model;
  model.value = MODEL_PRESETS.includes(savedModel) ? savedModel : "";
  const customModel = html(doc, "input", "zrc-custom-model");
  customModel.type = "text";
  customModel.value = model.value ? "" : savedModel;
  customModel.maxLength = 128;
  customModel.spellcheck = false;
  const reasoning = html(doc, "select", "zrc-reasoning-select");
  const analysisBudget = html(doc, "select", "zrc-analysis-budget");
  for (const value of ANALYSIS_BUDGETS) {
    const option = modelOption(value);
    option.textContent = value === "auto" ? t("Automatic by effort", "自动（按推理强度）")
      : value === "api" ? t("API default", "由 API 决定")
        : Number(value).toLocaleString();
    analysisBudget.append(option);
  }
  analysisBudget.value = settings.analysisBudget;
  const vault = html(doc, "input", "zrc-obsidian-path");
  vault.type = "text";
  vault.value = settings.obsidianPath;
  vault.spellcheck = false;
  vault.placeholder = t("Absolute path to the vault folder", "Vault 文件夹的完整路径");
  const key = html(doc, "input");
  key.type = "password";
  key.autocomplete = "off";
  key.spellcheck = false;
  key.maxLength = 512;
  key.placeholder = t("Enter or replace API key", "输入或更换 API Key");
  const language = html(doc, "select");
  for (const [value, name] of [["auto", "Zotero / 自动"], ["en", "English"], ["zh", "简体中文"]]) {
    const option = html(doc, "option", "", name);
    option.value = value ?? "";
    language.append(option);
  }
  language.value = settings.language;
  const remember = html(doc, "input");
  remember.type = "checkbox";
  remember.checked = settings.status() === "encrypted";

  const state = html(doc, "p", "zrc-key-state");
  const status = html(doc, "p", "zrc-settings-status");
  status.setAttribute("role", "status");
  const save = button(doc, t("Save settings", "保存设置"), () => void saveOptions(), "zrc-save-settings");
  const test = button(doc, t("Test API", "测试 API"), () => void testApi(), "zrc-test-api");
  const clear = button(doc, t("Remove key", "移除密钥"), () => void removeKey(), "zrc-clear-key");
  const getModels = button(doc, t("Get account models", "获取账号模型"), () => void fetchModels(), "zrc-list-models");
  const browseVault = button(doc, t("Choose folder…", "选择文件夹…"), () => void chooseVault(), "zrc-browse-vault");
  let busy = false;

  const labels = {
    missing: () => t("API key required", "尚未配置 API Key"),
    session: () => t("Key available for this Zotero session", "密钥在当前 Zotero 会话有效"),
    encrypted: () => t("Encrypted key saved in this profile", "此配置文件中已有加密密钥"),
    locked: () => t("Stored key is unavailable. Replace or remove it.", "已存密钥不可用，请更换或移除。"),
  };

  function refresh(keyStatus: KeyStatus = settings.status()) {
    state.textContent = labels[keyStatus]();
    for (const control of [model, customModel, reasoning, analysisBudget, vault, browseVault, key, language, remember, save, test, getModels]) {
      control.disabled = busy;
    }
    clear.disabled = busy || keyStatus === "missing";
  }

  function setBusy(value: boolean) {
    busy = value;
    refresh();
  }

  function showStatus(text: string, state = "") {
    status.textContent = text;
    status.dataset.state = state;
  }

  function readKey() {
    const enteredKey = key.value.trim();
    if (enteredKey && !validKey(enteredKey)) {
      showStatus(t("Check the API key format.", "请检查 API Key 格式。"), "error");
      return;
    }
    return enteredKey;
  }

  function readInput() {
    const enteredKey = readKey();
    if (enteredKey === undefined) return;
    const modelID = modelIDFromInput();
    if (!validModel(modelID)) {
      showStatus(t("Check the model ID.", "请检查模型 ID。"), "error");
      return;
    }
    return { modelID, enteredKey };
  }

  function modelIDFromInput() {
    return (model.value || customModel.value).trim();
  }

  function refreshReasoning(preferred = reasoning.value) {
    const modelID = modelIDFromInput();
    const fallback = html(doc, "option", "", t("Model default", "模型默认"));
    fallback.value = "";
    reasoning.replaceChildren(fallback, ...reasoningOptions(modelID).map(modelOption));
    reasoning.value = supportedReasoning(modelID, preferred) ?? "";
  }

  async function chooseVault() {
    const win = doc.defaultView;
    if (!win || busy) return;
    setBusy(true);
    try {
      const folder = await new FilePickerHelper(t("Choose Obsidian folder", "选择 Obsidian 文件夹"), "folder", [], undefined, win).open();
      if (folder) {
        vault.value = validateObsidianPath(folder);
        showStatus(t("Folder selected. Save settings to use it.", "已选择目录。保存设置后即可使用。"));
      }
    } catch {
      showStatus(errorMessage(new CopilotError("obsidian-path"), currentLanguage()), "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveOptions() {
    if (busy) return;
    const input = readInput();
    if (!input) return;
    const { modelID, enteredKey } = input;
    setBusy(true);
    try {
      const path = vault.value.trim();
      const resolved = path ? validateObsidianPath(path) : "";
      key.value = "";
      settings.setOptions(modelID, language.value as LanguageSetting, reasoning.value, analysisBudget.value);
      settings.setObsidianPath(resolved);
      vault.value = resolved;
      const result = enteredKey ? await settings.saveKey(enteredKey, remember.checked) : settings.status();
      showStatus(enteredKey && remember.checked && result === "session"
        ? t("OS credential storage is unavailable. The key is active for this session.", "系统凭证存储不可用。密钥在本次会话有效。")
        : t("Settings saved.", "设置已保存。"));
      remember.checked = result === "encrypted";
    } catch (error) {
      if (!(error instanceof CopilotError)) replaceAccountModels([]);
      showStatus(error instanceof CopilotError ? errorMessage(error, currentLanguage())
        : t("Could not save settings.", "保存设置失败。"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function removeKey() {
    if (busy) return;
    setBusy(true);
    key.value = "";
    replaceAccountModels([]);
    try {
      await settings.clearKey();
      remember.checked = false;
      showStatus(t("Key removed.", "密钥已移除。"));
    } catch {
      showStatus(t("Could not remove the key.", "移除密钥失败。"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function runApiAction(
    enteredKey: string,
    progress: string,
    run: (apiKey: string, controller: AbortController) => Promise<string>,
  ) {
    if (busy) return;
    const win = doc.defaultView as (Window & typeof globalThis) | null;
    if (!win) return;
    const controller = new win.AbortController();
    let closing = false;
    const close = () => {
      closing = true;
      controller.abort();
    };
    win.addEventListener("pagehide", close, { once: true });
    setBusy(true);
    showStatus(progress);
    try {
      const apiKey = enteredKey || await settings.getKey().catch(() => {
        throw new CopilotError("locked-key");
      });
      controller.signal.throwIfAborted();
      if (!apiKey) throw new CopilotError("missing-key");
      const message = await run(apiKey, controller);
      if (!closing && root.isConnected) showStatus(message, "success");
    } catch (error) {
      if (!closing && root.isConnected) {
        const detail = error instanceof CopilotError && error.code === "timeout"
          ? t("The request timed out after 30 seconds.", "请求在 30 秒后超时。")
          : errorMessage(error, currentLanguage());
        showStatus(t("OpenAI request failed. ", "OpenAI 请求失败。") + detail, "error");
      }
    } finally {
      if (!closing) {
        win.removeEventListener("pagehide", close);
        if (root.isConnected) setBusy(false);
      }
    }
  }

  function testApi() {
    const input = readInput();
    if (!input) return;
    const { modelID, enteredKey } = input;
    return runApiAction(enteredKey, t(`Testing ${modelID}…`, `正在测试 ${modelID}…`), async (apiKey, controller) => {
      const usage = await testOpenAIConnection(provider, modelID, apiKey, controller);
      const summary = t(`Responses text request succeeded for ${modelID}.`, `${modelID} 的 Responses 文本请求成功。`);
      const tokens = usage ? (usage.inputTokens + usage.outputTokens).toLocaleString() : "";
      return tokens ? `${summary} ${t(`Used ${tokens} tokens.`, `用量 ${tokens} tokens。`)}` : summary;
    });
  }

  function fetchModels() {
    const enteredKey = readKey();
    if (enteredKey === undefined) return;
    return runApiAction(enteredKey, t("Getting account models…", "正在获取账号模型…"), async (apiKey, controller) => {
      const ids = await withApiTimeout(controller, (signal) => provider.listModels(apiKey, signal));
      const models = [...new Set(ids.filter(validModel))].sort();
      const additional = models.filter((id) => !MODEL_PRESETS.includes(id));
      replaceAccountModels(additional);
      return t(
        `Found ${models.length} model IDs. Added ${additional.length} options to the menu.`,
        `已获取 ${models.length} 个模型 ID，下拉菜单新增 ${additional.length} 项。`,
      );
    });
  }

  function replaceAccountModels(ids: string[]) {
    const selected = model.value;
    accountModels.replaceChildren(...ids.map(modelOption));
    if (ids.length) model.insertBefore(accountModels, customOption);
    else accountModels.remove();
    if (selected && !MODEL_PRESETS.includes(selected) && !ids.includes(selected)) {
      customModel.value = selected;
      model.value = "";
    } else {
      model.value = selected;
    }
    customRow.hidden = !!model.value;
    refreshReasoning();
  }

  function row(label: string, input: HTMLElement) {
    const element = html(doc, "label", "zrc-field");
    element.append(html(doc, "span", "", label), input);
    return element;
  }

  const customRow = row(t("Custom model ID", "自定义模型 ID"), customModel);
  customRow.hidden = !!model.value;
  model.addEventListener("change", () => {
    customRow.hidden = !!model.value;
    refreshReasoning();
    showStatus("");
  });
  customModel.addEventListener("input", () => {
    refreshReasoning();
    showStatus("");
  });
  key.addEventListener("input", () => {
    replaceAccountModels([]);
    showStatus("");
  });
  const actions = html(doc, "div", "zrc-settings-actions");
  actions.append(save, test, clear);
  const modelRow = html(doc, "div", "zrc-model-row");
  modelRow.append(row(t("Choose model", "选择模型"), model), getModels);
  const vaultRow = html(doc, "div", "zrc-model-row");
  vaultRow.append(row(t("Obsidian folder", "Obsidian 笔记目录"), vault), browseVault);
  const vaultSettings = html(doc, "div", "zrc-vault-settings");
  vaultSettings.append(vaultRow, html(doc, "p", "zrc-settings-hint", t(
    "Obsidian export sends the paper title, a short answer excerpt and up to 100 candidate folder names to OpenAI for routing.",
    "导出到 Obsidian 时会把论文标题、简短回答片段和最多 100 个候选子目录名交给 OpenAI 分类。",
  )));

  host.append(
    modelRow,
    customRow,
    html(doc, "p", "zrc-settings-hint", t(
      "Open the menu for presets, account models, or a custom ID. Test API checks whether the selected model can answer a text request.",
      "展开下拉菜单选择预设、账号模型或自定义 ID。使用「测试 API」确认选中的模型可以处理文本请求。",
    )),
    row(t("Reasoning effort", "推理强度"), reasoning),
    row(t("Deep analysis output tokens", "深度解构输出 token 上限"), analysisBudget),
    html(doc, "p", "zrc-settings-hint", t(
      "Reasoning and answer text share this budget. Automatic uses 32,000 at max effort. API default lets the API set the limit.",
      "推理和正文共用预算。自动模式在 max 档使用 32,000 个 token。也可把上限交给 API。",
    )),
    row(t("Interface and answer language", "界面与回答语言"), language),
    row("OpenAI API Key", key),
    row(t("Encrypt and remember this new key using the OS credential store", "通过系统凭证存储加密并记住本次输入的密钥"), remember),
    vaultSettings,
    state, actions, status,
    html(doc, "p", "zrc-settings-hint", t(
      "Test API sends a short request at the model's default effort. Save settings to apply your selected effort to paper chat.",
      "测试 API 使用模型默认档发送短文本。保存设置后，论文对话会使用你选择的推理档位。",
    )),
    html(doc, "p", "zrc-settings-hint", t(
      "Send forwards selected PDF excerpts, recent chat and any image you attach to OpenAI. The PDF index and unsaved chat stay in memory.",
      "发送时，选取的 PDF 片段、最近对话和你主动附加的图片会传给 OpenAI。插件索引和未保存的对话保留在内存中。",
    )),
  );
  root.addEventListener("showing", () => refresh());
  refreshReasoning(settings.reasoningEffort);
  refresh();
}
