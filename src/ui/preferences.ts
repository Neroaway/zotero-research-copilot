import { FilePickerHelper } from "zotero-plugin-toolkit";
import { testConnection, withApiTimeout } from "../ai/connection.ts";
import { ANALYSIS_BUDGETS } from "../ai/output-budget.ts";
import type { ModelProvider, ProviderFactory } from "../ai/provider.ts";
import { PROVIDERS, providerConnection, providerID } from "../ai/providers.ts";
import type { ProviderConnection } from "../ai/providers.ts";
import { reasoningOptions, supportedReasoning } from "../ai/reasoning.ts";
import { CopilotError } from "../errors.ts";
import { RESPONSE_TIMEOUTS } from "../research/timeouts.ts";
import { resolveLanguage, validKey, validModel } from "../storage/settings.ts";
import type { KeyStatus, LanguageSetting, Settings } from "../storage/settings.ts";
import { validateObsidianPath } from "../zotero/obsidian.ts";
import { button, html } from "./dom.ts";
import { tr } from "./i18n.ts";
import { errorMessage } from "./messages.ts";

export function mountPreferences(root: Element, settings: Settings, createProvider: ProviderFactory, locale: string): void {
  const host = root.querySelector(".zrc-preferences-content");
  if (!host || host.childElementCount) return;
  const doc = root.ownerDocument;
  const currentLanguage = () => resolveLanguage(settings.language, locale);
  const t = (en: string, zh: string) => tr(currentLanguage(), en, zh);
  const provider = html(doc, "select", "zrc-provider-select");
  for (const [id, definition] of Object.entries(PROVIDERS)) {
    const option = modelOption(id);
    option.textContent = id === "compatible" ? t(definition.name, "OpenAI 兼容服务") : definition.name;
    provider.append(option);
  }
  provider.value = settings.providerID;
  const selectedProvider = () => providerID(provider.value);
  const presetIDs = (): readonly string[] => PROVIDERS[selectedProvider()].models;
  const baseURL = html(doc, "input", "zrc-base-url");
  baseURL.type = "url";
  baseURL.maxLength = 512;
  baseURL.spellcheck = false;
  baseURL.placeholder = "https://api.example.com/v1";
  baseURL.value = settings.compatibleBaseURL;
  const draftConnection = () => providerConnection(selectedProvider(), baseURL.value);
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
  const customOption = html(doc, "option", "", t("Custom model ID…", "自定义模型 ID…"));
  customOption.value = "";
  model.append(presets, customOption);
  const customModel = html(doc, "input", "zrc-custom-model");
  customModel.type = "text";
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
  const responseTimeout = html(doc, "select", "zrc-response-timeout");
  for (const value of RESPONSE_TIMEOUTS) {
    const option = modelOption(value);
    option.textContent = value === "none" ? t("No local time limit", "不限制等待")
      : value === "auto" ? t("Automatic by task and effort", "自动（按任务和推理强度）")
      : t(`${value} minutes`, `${value} 分钟`);
    responseTimeout.append(option);
  }
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

  const state = html(doc, "p", "zrc-key-state");
  const status = html(doc, "p", "zrc-settings-status");
  status.setAttribute("role", "status");
  const save = button(doc, t("Save settings", "保存设置"), () => void saveOptions(), "zrc-save-settings");
  const test = button(doc, t("Test API", "测试 API"), () => void testApi(), "zrc-test-api");
  const clear = button(doc, t("Remove key", "移除密钥"), () => void removeKey(), "zrc-clear-key");
  const getModels = button(doc, t("Get account models", "获取账号模型"), () => void fetchModels(), "zrc-list-models");
  const browseVault = button(doc, t("Choose folder…", "选择文件夹…"), () => void chooseVault(), "zrc-browse-vault");
  let shownBaseURL: string | undefined;
  let busy = false;

  const labels = {
    missing: () => t("API key required", "尚未配置 API Key"),
    session: () => t("Key available for this Zotero session", "密钥在当前 Zotero 会话有效"),
    encrypted: () => t("Encrypted key saved in this profile", "此配置文件中已有加密密钥"),
    locked: () => t("Stored key is unavailable. Replace or remove it.", "已存密钥不可用，请更换或移除。"),
  };

  function refresh() {
    const connection = draftConnection();
    const keyStatus: KeyStatus = connection ? settings.status(connection) : "missing";
    state.textContent = connection ? labels[keyStatus]() : t("Enter a valid Base URL first.", "请先填写有效的 Base URL。");
    for (const control of [provider, baseURL, model, customModel, reasoning, analysisBudget, responseTimeout, vault, browseVault, key, language, remember, save, test, getModels]) {
      control.disabled = busy;
    }
    key.disabled = remember.disabled = busy || !connection;
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
    const connection = readConnection();
    if (!connection) return;
    const enteredKey = readKey();
    if (enteredKey === undefined) return;
    const modelID = modelIDFromInput();
    if (!validModel(modelID)) {
      showStatus(t("Check the model ID.", "请检查模型 ID。"), "error");
      return;
    }
    return { connection, modelID, enteredKey };
  }

  function readConnection() {
    const connection = draftConnection();
    if (!connection) showStatus(errorMessage(new CopilotError("api-url"), currentLanguage()), "error");
    return connection;
  }

  function modelIDFromInput() {
    return (model.value || customModel.value).trim();
  }

  function refreshReasoning(preferred = reasoning.value) {
    const modelID = modelIDFromInput();
    const id = selectedProvider();
    const fallback = html(doc, "option", "", t("Model default", "模型默认"));
    fallback.value = "";
    reasoning.replaceChildren(fallback, ...reasoningOptions(modelID, id).map(modelOption));
    reasoning.value = supportedReasoning(modelID, preferred, id) ?? "";
  }

  function refreshProvider() {
    const connection = draftConnection();
    const id = selectedProvider();
    shownBaseURL = connection?.baseURL;
    baseURLRow.hidden = id !== "compatible";
    key.value = "";
    remember.checked = !!connection && settings.status(connection) === "encrypted";
    const savedModel = connection ? settings.modelFor(connection) : "";
    presets.replaceChildren(...presetIDs().map(modelOption));
    if (presets.childElementCount) model.prepend(presets);
    else presets.remove();
    accountModels.remove();
    model.value = presetIDs().includes(savedModel) ? savedModel : "";
    customModel.value = model.value ? "" : savedModel;
    customRow.hidden = !!model.value;
    refreshReasoning(connection ? settings.reasoningFor(connection) ?? "" : "");
    const apiDefault = analysisBudget.querySelector<HTMLOptionElement>('option[value="api"]');
    if (apiDefault) apiDefault.disabled = id === "claude";
    analysisBudget.value = connection ? settings.analysisBudgetFor(connection) : "auto";
    responseTimeout.value = connection ? settings.responseTimeoutFor(connection) : "none";
    budgetHint.textContent = id === "claude"
      ? t("Claude requires an output token limit. It counts both thinking and answer text.", "Claude 需要设置输出 token 上限，思考和正文共用该预算。")
      : id === "grok"
        ? t("Grok's output limit applies to visible text. Reasoning usage can be billed separately from that limit.", "Grok 的输出上限约束可见正文，推理用量可超出该上限并单独计费。")
        : t("Automatic uses 32,000 at max effort. API default leaves the limit to the service.", "自动模式在 max 档使用 32,000 个 token。也可把上限交给服务商。");
    refresh();
    showStatus("");
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
    const { connection, modelID, enteredKey } = input;
    setBusy(true);
    try {
      const path = vault.value.trim();
      const resolved = path ? validateObsidianPath(path) : "";
      const result = enteredKey ? await settings.saveKey(enteredKey, remember.checked, connection) : settings.status(connection);
      key.value = "";
      settings.setOptions(modelID, language.value as LanguageSetting, reasoning.value, analysisBudget.value, connection);
      settings.setResponseTimeout(responseTimeout.value, connection);
      settings.setObsidianPath(resolved);
      vault.value = resolved;
      if (connection.id === "compatible") baseURL.value = connection.baseURL;
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
    const connection = readConnection();
    if (!connection) return;
    setBusy(true);
    key.value = "";
    replaceAccountModels([]);
    try {
      await settings.clearKey(connection);
      remember.checked = false;
      showStatus(t("Key removed.", "密钥已移除。"));
    } catch {
      showStatus(t("Could not remove the key.", "移除密钥失败。"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function runApiAction(
    connection: ProviderConnection,
    enteredKey: string,
    progress: string,
    run: (adapter: ModelProvider, apiKey: string, controller: AbortController) => Promise<string>,
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
      const apiKey = enteredKey || await settings.getKey(connection).catch(() => {
        throw new CopilotError("locked-key");
      });
      controller.signal.throwIfAborted();
      if (!apiKey) throw new CopilotError("missing-key");
      const message = await run(createProvider(connection), apiKey, controller);
      if (!closing && root.isConnected) showStatus(message, "success");
    } catch (error) {
      if (!closing && root.isConnected) {
        const detail = error instanceof CopilotError && error.code === "timeout"
          ? t("The request timed out after 30 seconds.", "请求在 30 秒后超时。")
          : errorMessage(error, currentLanguage());
        const name = PROVIDERS[connection.id].name;
        showStatus(t(`${name} request failed. `, `${name} 请求失败。`) + detail, "error");
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
    const { connection, modelID, enteredKey } = input;
    return runApiAction(connection, enteredKey, t(`Testing ${modelID}…`, `正在测试 ${modelID}…`), async (adapter, apiKey, controller) => {
      const usage = await testConnection(adapter, modelID, apiKey, controller, connection.id);
      const summary = t(`Text request succeeded for ${modelID}.`, `${modelID} 的文本请求成功。`);
      const tokens = usage ? (usage.inputTokens + usage.outputTokens).toLocaleString() : "";
      return tokens ? `${summary} ${t(`Used ${tokens} tokens.`, `用量 ${tokens} tokens。`)}` : summary;
    });
  }

  function fetchModels() {
    const connection = readConnection();
    if (!connection) return;
    const enteredKey = readKey();
    if (enteredKey === undefined) return;
    return runApiAction(connection, enteredKey, t("Getting account models…", "正在获取账号模型…"), async (adapter, apiKey, controller) => {
      const ids = await withApiTimeout(controller, (signal) => adapter.listModels(apiKey, signal));
      const models = [...new Set(ids.filter(validModel))].sort();
      const additional = models.filter((id) => !presetIDs().includes(id));
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
    if (selected && !presetIDs().includes(selected) && !ids.includes(selected)) {
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
  const baseURLRow = row(t("Compatible API Base URL", "兼容接口 Base URL"), baseURL);
  const budgetHint = html(doc, "p", "zrc-settings-hint");
  provider.addEventListener("change", refreshProvider);
  baseURL.addEventListener("input", () => {
    if (draftConnection()?.baseURL !== shownBaseURL) refreshProvider();
    else showStatus("");
  });
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
    "Obsidian export sends the paper title, a short answer excerpt and up to 100 candidate folder names to the selected provider for routing.",
    "导出到 Obsidian 时会把论文标题、简短回答片段和最多 100 个候选子目录名交给当前服务商分类。",
  )));

  host.append(
    row(t("AI provider", "AI 服务商"), provider),
    baseURLRow,
    modelRow,
    customRow,
    html(doc, "p", "zrc-settings-hint", t(
      "Open the menu for presets, account models, or a custom ID. Test API checks whether the selected model can answer a text request.",
      "展开下拉菜单选择预设、账号模型或自定义 ID。使用「测试 API」确认选中的模型可以处理文本请求。",
    )),
    row(t("Reasoning effort", "推理强度"), reasoning),
    row(t("Deep analysis output tokens", "深度解构输出 token 上限"), analysisBudget),
    budgetHint,
    row(t("Answer maximum wait", "回答最长等待"), responseTimeout),
    html(doc, "p", "zrc-settings-hint", t(
      "Applies to questions, selections and deep analysis. Default: no local timeout. Automatic: questions/selections 4 min; analysis max/xhigh 30 min, others 10 min. Service or network timeouts can still occur.",
      "适用于论文问答、选区精读和深度解构。默认不设本地超时；自动模式下问答/选区 4 分钟，解构 max/xhigh 30 分钟、其他档位 10 分钟。服务商或网络仍可能超时。",
    )),
    row(t("Interface and answer language", "界面与回答语言"), language),
    row(t("API key for the selected provider", "所选服务商的 API Key"), key),
    row(t("Encrypt and remember this new key using the OS credential store", "通过系统凭证存储加密并记住本次输入的密钥"), remember),
    vaultSettings,
    state, actions, status,
    html(doc, "p", "zrc-settings-hint", t(
      "Test API sends a short text request. Save settings to apply the provider, model and effort to paper chat.",
      "测试 API 只发送一条短文本。保存设置后，论文对话会使用所选服务商、模型和推理档位。",
    )),
    html(doc, "p", "zrc-settings-hint", t(
      "Send shares selected PDF excerpts, recent chat for this endpoint and any image you attach with the selected provider. Chat history is saved locally per PDF; Clear chat deletes it. Keys and image data are excluded from history files.",
      "发送时会把选取的 PDF 片段、该接口的最近对话和你主动附加的图片传给所选服务商。对话按论文保存在本机，清空对话会删除记录。密钥和图片数据不写入聊天记录。",
    )),
  );
  root.addEventListener("showing", () => refresh());
  refreshProvider();
}
