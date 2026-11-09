import { Settings, resolveLanguage, validKey, validModel } from "../storage/settings.ts";
import type { KeyStatus, LanguageSetting } from "../storage/settings.ts";
import { button, html } from "./dom.ts";
import { tr } from "./i18n.ts";

export function mountPreferences(root: Element, settings: Settings, locale: string): void {
  const host = root.querySelector(".zrc-preferences-content");
  if (!host || host.childElementCount) return;
  const doc = root.ownerDocument;
  const t = (en: string, zh: string) => tr(resolveLanguage(settings.language, locale), en, zh);
  const model = html(doc, "input");
  model.type = "text";
  model.value = settings.model;
  model.maxLength = 128;
  model.placeholder = "gpt-5-mini";
  model.spellcheck = false;
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
  const save = button(doc, t("Save settings", "保存设置"), () => void saveOptions());
  const clear = button(doc, t("Remove key", "移除密钥"), () => void removeKey());

  const labels = {
    missing: () => t("API key required", "尚未配置 API Key"),
    session: () => t("Key available for this Zotero session", "密钥在当前 Zotero 会话有效"),
    encrypted: () => t("Encrypted key saved in this profile", "此配置文件中已有加密密钥"),
    locked: () => t("Stored key is unavailable. Replace or remove it.", "已存密钥不可用，请更换或移除。"),
  };

  function refresh(keyStatus: KeyStatus = settings.status()) {
    state.textContent = labels[keyStatus]();
    clear.disabled = keyStatus === "missing";
  }

  async function saveOptions() {
    const value = key.value.trim();
    if (!validModel(model.value.trim()) || (value && !validKey(value))) {
      status.textContent = t("Check the model ID and API key format.", "请检查模型 ID 和 API Key 格式。");
      return;
    }
    save.disabled = clear.disabled = true;
    key.value = "";
    try {
      settings.setOptions(model.value.trim(), language.value as LanguageSetting);
      const result = value ? await settings.saveKey(value, remember.checked) : settings.status();
      status.textContent = value && remember.checked && result === "session"
        ? t("OS credential storage is unavailable. The key is active for this session.", "系统凭证存储不可用。密钥在本次会话有效。")
        : t("Settings saved.", "设置已保存。");
      remember.checked = result === "encrypted";
    } catch {
      status.textContent = t("Could not save settings.", "保存设置失败。");
    } finally {
      save.disabled = false;
      refresh();
    }
  }

  async function removeKey() {
    save.disabled = clear.disabled = true;
    key.value = "";
    try {
      await settings.clearKey();
      remember.checked = false;
      status.textContent = t("Key removed.", "密钥已移除。");
    } catch {
      status.textContent = t("Could not remove the key.", "移除密钥失败。");
    } finally {
      save.disabled = false;
      refresh();
    }
  }

  function row(label: string, input: HTMLElement) {
    const element = html(doc, "label", "zrc-field");
    element.append(html(doc, "span", "", label), input);
    return element;
  }

  host.append(
    row(t("OpenAI model ID", "OpenAI 模型 ID"), model),
    row(t("Interface and answer language", "界面与回答语言"), language),
    row("OpenAI API Key", key),
    row(t("Encrypt and remember this new key using the OS credential store", "通过系统凭证存储加密并记住本次输入的密钥"), remember),
    state, save, clear, status,
    html(doc, "p", "zrc-settings-hint", t(
      "Send forwards selected PDF excerpts, recent chat and any image you attach to OpenAI. The PDF index and unsaved chat stay in memory.",
      "发送时，选取的 PDF 片段、最近对话和你主动附加的图片会传给 OpenAI。插件索引和未保存的对话保留在内存中。",
    )),
  );
  root.addEventListener("showing", () => refresh());
  refresh();
}
