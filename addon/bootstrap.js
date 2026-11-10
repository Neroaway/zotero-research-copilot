var copilot;
var chromeHandle;

async function startup({ id, rootURI }) {
  const registrar = Components.classes["@mozilla.org/addons/addon-manager-startup;1"]
    .getService(Components.interfaces.amIAddonManagerStartup);
  chromeHandle = registrar.registerChrome(Services.io.newURI(rootURI + "manifest.json"), [
    ["content", "zrc-copilot", rootURI + "content/"],
  ]);

  const scope = {
    Zotero, ChromeUtils, IOUtils, PathUtils, fetch: (...args) => fetch(...args), TextDecoder, URL, setTimeout, clearTimeout,
    cloneReaderData: (value, window) => Components.utils.cloneInto(value, window),
    unwrapReaderObject: (value) => Components.utils.waiveXrays(value),
  };
  Services.scriptloader.loadSubScript(rootURI + "content/copilot.js", scope);
  copilot = scope.ResearchCopilot.start(id);
  await copilot.ready;
}

async function shutdown() {
  await copilot?.dispose();
  copilot = undefined;
  chromeHandle?.destruct();
  chromeHandle = undefined;
}
