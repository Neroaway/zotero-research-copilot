import { OpenAIProvider } from "./ai/openai.ts";
import { Settings } from "./storage/settings.ts";
import type { KeyStore } from "./storage/settings.ts";
import { mountPreferences } from "./ui/preferences.ts";
import { connectReader } from "./zotero/integration.ts";

const PREFS_ID = "zrc-research-copilot-prefs";
const CONTENT = "chrome://zrc-copilot/content/";

export function start(pluginID: string) {
  const app = Zotero as typeof Zotero & {
    OSKeyStore?: KeyStore;
    ResearchCopilot?: { mountPreferences(root: Element): void };
  };
  const settings = new Settings(app.Prefs, app.OSKeyStore);
  const provider = new OpenAIProvider(fetch);
  app.ResearchCopilot = {
    mountPreferences: (root) => mountPreferences(root, settings, provider, app.locale),
  };
  const openPreferences = () => Zotero.Utilities.Internal.openPreferences(PREFS_ID);
  const disconnect = connectReader(pluginID, settings, provider, openPreferences);
  const ready = Zotero.PreferencePanes.register({
    pluginID, id: PREFS_ID, src: CONTENT + "preferences.xhtml", stylesheets: [CONTENT + "copilot.css"],
  });
  return {
    ready,
    dispose() {
      disconnect();
      settings.dispose();
      delete app.ResearchCopilot;
    },
  };
}
