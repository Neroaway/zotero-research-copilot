import { testOpenAIConnection } from "../ai/connection.ts";
import type { AIProvider } from "../ai/provider.ts";
import { CopilotError } from "../errors.ts";
import { DEFAULT_MODEL, resolveLanguage, validKey, validModel } from "../storage/settings.ts";
import type { KeyStatus, LanguageSetting, Settings } from "../storage/settings.ts";
import { button, html } from "./dom.ts";
import { tr } from "./i18n.ts";
import { errorMessage } from "./messages.ts";

const MODEL_PRESETS = [
  DEFAULT_MODEL, "gpt-5.4-mini", "gpt-6-luna", "gpt-6.1-terra", "gpt-6.1-sol", "gpt-6-astra",
];

export function mountPreferences(root: Element, settings: Settings, provider: AIProvider, locale: string): void {
  const host = root.querySelector(".zrc-preferences-content");
  if (!host || host.childElementCount) return;
  const doc = root.ownerDocument;
  const currentLanguage = () => resolveLanguage(settings.language, locale);
  const t = (en: string, zh: string) => tr(currentLanguage(), en, zh);
  const model = html(doc, "select", "zrc-model-select");
  for (const id of MODEL_PRESETS) {
    const option = html(doc, "option", "", id);
    option.value = id;
    model.append(option);
  }
  const customOption = html(doc, "option", "", t("Custom model ID…", "自定义模型 ID…"));
  customOption.value = "";
  model.append(customOption);
  const savedModel = settings.model;
  model.value = MODEL_PRESETS.includes(savedModel) ? savedModel : "";
  const customModel = html(doc, "input", "zrc-custom-model");
  customModel.type = "text";
  customModel.value = model.value ? "" : savedModel;
  customModel.maxLength = 128;
  customModel.spellcheck = false;
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
  let busy = false;

  const labels = {
    missing: () => t("API key required", "尚未配置 API Key"),
    session: () => t("Key available for this Zotero session", "密钥在当前 Zotero 会话有效"),
    encrypted: () => t("Encrypted key saved in this profile", "此配置文件中已有加密密钥"),
    locked: () => t("Stored key is unavailable. Replace or remove it.", "已存密钥不可用，请更换或移除。"),
  };

  function refresh(keyStatus: KeyStatus = settings.status()) {
    state.textContent = labels[keyStatus]();
    for (const control of [model, customModel, key, language, remember, save, test]) control.disabled = busy;
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

  function readInput() {
    const modelID = (model.value || customModel.value).trim();
    const enteredKey = key.value.trim();
    if (!validModel(modelID) || (enteredKey && !validKey(enteredKey))) {
      showStatus(t("Check the model ID and API key format.", "请检查模型 ID 和 API Key 格式。"), "error");
      return;
    }
    return { modelID, enteredKey };
  }

  async function saveOptions() {
    if (busy) return;
    const input = readInput();
    if (!input) return;
    const { modelID, enteredKey } = input;
    setBusy(true);
    key.value = "";
    try {
      settings.setOptions(modelID, language.value as LanguageSetting);
      const result = enteredKey ? await settings.saveKey(enteredKey, remember.checked) : settings.status();
      showStatus(enteredKey && remember.checked && result === "session"
        ? t("OS credential storage is unavailable. The key is active for this session.", "系统凭证存储不可用。密钥在本次会话有效。")
        : t("Settings saved.", "设置已保存。"));
      remember.checked = result === "encrypted";
    } catch {
      showStatus(t("Could not save settings.", "保存设置失败。"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function removeKey() {
    if (busy) return;
    setBusy(true);
    key.value = "";
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

  async function testApi() {
    if (busy) return;
    const input = readInput();
    const win = doc.defaultView as (Window & typeof globalThis) | null;
    if (!input || !win) return;
    const { modelID, enteredKey } = input;
    const controller = new win.AbortController();
    const close = () => controller.abort();
    win.addEventListener("pagehide", close, { once: true });
    setBusy(true);
    showStatus(t(`Testing ${modelID}…`, `正在测试 ${modelID}…`));
    try {
      const apiKey = enteredKey || await settings.getKey().catch(() => {
        throw new CopilotError("locked-key");
      });
      if (!apiKey) throw new CopilotError("missing-key");
      const usage = await testOpenAIConnection(provider, modelID, apiKey, controller);
      const summary = t(`Responses text request succeeded for ${modelID}.`, `${modelID} 的 Responses 文本请求成功。`);
      const tokens = usage ? (usage.inputTokens + usage.outputTokens).toLocaleString() : "";
      showStatus(tokens ? `${summary} ${t(`Used ${tokens} tokens.`, `用量 ${tokens} tokens。`)}` : summary, "success");
    } catch (error) {
      if (!win.closed && root.isConnected) {
        const detail = error instanceof CopilotError && error.code === "timeout"
          ? t("The request timed out after 30 seconds.", "请求在 30 秒后超时。")
          : errorMessage(error, currentLanguage());
        showStatus(t("API test failed. ", "API 测试失败。") + detail, "error");
      }
    } finally {
      win.removeEventListener("pagehide", close);
      if (!win.closed && root.isConnected) setBusy(false);
    }
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
    showStatus("");
  });
  for (const input of [customModel, key]) input.addEventListener("input", () => showStatus(""));
  const actions = html(doc, "div", "zrc-settings-actions");
  actions.append(save, test, clear);

  host.append(
    row(t("OpenAI model", "OpenAI 模型"), model),
    customRow,
    row(t("Interface and answer language", "界面与回答语言"), language),
    row("OpenAI API Key", key),
    row(t("Encrypt and remember this new key using the OS credential store", "通过系统凭证存储加密并记住本次输入的密钥"), remember),
    state, actions, status,
    html(doc, "p", "zrc-settings-hint", t(
      "Test API sends one short text request with the current model and key. Save settings to apply them to paper chat.",
      "测试 API 会用当前模型与密钥发送一次短文本请求。点保存设置后，配置才会应用到论文对话。",
    )),
    html(doc, "p", "zrc-settings-hint", t(
      "Send forwards selected PDF excerpts, recent chat and any image you attach to OpenAI. The PDF index and unsaved chat stay in memory.",
      "发送时，选取的 PDF 片段、最近对话和你主动附加的图片会传给 OpenAI。插件索引和未保存的对话保留在内存中。",
    )),
  );
  root.addEventListener("showing", () => refresh());
  refresh();
}
