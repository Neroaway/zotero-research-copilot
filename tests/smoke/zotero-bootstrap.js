const PLUGIN = "research-copilot@zotero-skills.local";
const PREFS = "zrc-research-copilot-prefs";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

async function waitFor(test, label) {
  for (let attempt = 0; attempt < 220; attempt++) {
    const result = test();
    if (result) return result;
    await delay(100);
  }
  throw new Error(label);
}

function startup({ id }) {
  void smoke(id);
}

async function smoke(id) {
  const root = PathUtils.parent(PathUtils.profileDir);
  const checks = [];
  let result;
  const stage = (name) => IOUtils.writeUTF8(PathUtils.join(root, "stage.txt"), name);
  const record = async (check) => {
    checks.push(check);
    await IOUtils.writeJSON(PathUtils.join(root, "progress.json"), checks);
  };
  try {
    const win = await waitFor(() => Zotero.getMainWindow()?.document.readyState === "complete" && Zotero.getMainWindow(), "Zotero main window");
    await Zotero.uiReadyPromise;
    const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
    const install = await AddonManager.getInstallForFile(Zotero.File.pathToFile(PathUtils.join(root, "plugin.xpi")));
    await install.install();
    const addon = await AddonManager.getAddonByID(PLUGIN);
    assert(addon?.isActive, "XPI was not active");
    await waitFor(() => Zotero.PreferencePanes.pluginPanes.some((pane) => pane.id === PREFS), "XPI preference registration");
    await record(`Zotero ${Zotero.version} installed and bootstrapped the release XPI`);

    await stage("Create fixture");
    const parent = new Zotero.Item("journalArticle");
    parent.setField("title", "A Gaze and Scanpath Fixture");
    await parent.saveTx({ skipSelect: true });
    const attachment = await Zotero.Attachments.importFromFile({
      file: PathUtils.join(root, "fixture.pdf"), parentItemID: parent.id, contentType: "application/pdf",
      saveOptions: { skipSelect: true },
    });
    const before = await IOUtils.read(await attachment.getFilePathAsync());


    async function openReader(openInWindow = false) {
      await stage("Open PDF reader");
      const reader = await Zotero.Reader.open(attachment.id, { pageIndex: 1 }, { openInWindow });
      await stage("Wait for PDF reader toolbar");
      const control = await waitFor(() => reader?._iframeWindow?.document.querySelector(".zrc-toolbar"), "PDF reader toolbar");
      await stage("Click the PDF reader AI button");
      control.click();
      const panel = await waitFor(() => reader._iframe.ownerDocument.querySelector(".zrc-panel:not([hidden])"), "PDF reader sidebar");
      const bounds = panel.getBoundingClientRect();
      const browser = reader._iframe.getBoundingClientRect();
      assert(bounds.width >= 250 && bounds.height > 250 && bounds.left >= browser.right - 2, "Side panel has invalid geometry");
      assert(panel.textContent.includes(parent.getDisplayTitle()), "Current paper title not shown");
      return { reader, panel };
    }

    const first = await openReader();
    await stage("Wait for missing-key error");
    first.panel.querySelector(".zrc-editor").value = "How does the gaze encoder work?";
    first.panel.querySelector(".zrc-send").click();
    await waitFor(() => first.panel.querySelector(".zrc-turn-interrupted")?.textContent.includes("API key"), "Missing-key state");
    await stage("Open the real Settings window");
    const settingsWindow = Zotero.Utilities.Internal.openPreferences(PREFS);
    await waitFor(() => settingsWindow.document.querySelector("#zrc-preferences input[type=password]"), "Mounted settings controls");
    settingsWindow.close();
    await record("Release sidebar right of the PDF, paper title, settings, and missing-key state");

    const rootURI = addon.getResourceURI().spec;
    await addon.disable();
    await waitFor(() => !first.panel.isConnected, "Release teardown");
    await win.Zotero_Tabs.close(first.reader.tabID);

    // Exercise the exact shipped bundle with a test-only fetch injected by this separate plugin.
    // No API credential or PDF is sent to the network.
    const aom = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(Ci.amIAddonManagerStartup);
    const chrome = aom.registerChrome(Services.io.newURI(rootURI + "manifest.json"), [["content", "zrc-copilot", rootURI + "content/"]]);
    const requests = [];
    const probes = [];
    const routes = [];
    let returnInvalidFolder = false;
    let catalogReads = 0;
    let isHeld = false;
    let stopped = false;
    let limitNextAnalysis = false;
    let finishLimitedAnalysis;
    const sectionNames = [
      "Research Problem", "Motivation", "Core Contributions", "Methodology", "Mathematical Formulation",
      "Experimental Design", "Ablation Studies", "Limitations", "Reproduction Guide", "Open Questions",
    ];
    const key = "local-fixture-token-only";
    const deniedKey = "local-fixture-token-rejected";
    const customID = "ft:gpt-5-mini:fixture:review";
    const accountID = "ft:gpt-5-mini:fixture:catalog";
    const modelPref = "extensions.zotero.researchCopilot.model";
    const mock = async (url, options) => {
      if (url === "https://api.openai.com/v1/models") {
        assert(options.method === "GET" && options.body === undefined, "Model discovery sent paper content");
        catalogReads++;
        if (options.headers.Authorization === "Bearer " + deniedKey) return { ok: false, status: 403 };
        assert(options.headers.Authorization === "Bearer " + key, "Model discovery used the wrong key");
        return { ok: true, json: async () => ({ data: [
          { id: "gpt-5-mini" }, { id: accountID }, { id: accountID }, { id: "bad id" },
        ] }) };
      }
      assert(url === "https://api.openai.com/v1/responses", "Wrong Responses endpoint");
      const payload = JSON.parse(options.body);
      const content = payload.input[0].content;
      let text;
      let limited = false;
      if (content[0].text === "Zotero Research Copilot API connection test.") {
        assert(content.length === 1 && payload.store === false && payload.stream === true && payload.max_output_tokens === 256,
          "API test sent data beyond its fixed text probe");
        probes.push(payload.model);
        if (options.headers.Authorization === "Bearer " + deniedKey) return { ok: false, status: 401 };
        assert(options.headers.Authorization === "Bearer " + key, "Test did not use the expected API key");
        if (payload.model === customID) return { ok: false, status: 404 };
        text = "OK";
      } else {
        assert(options.headers.Authorization === "Bearer " + key, "Missing bearer authentication");
        const input = JSON.parse(content[0].text);
        if (input.task === "obsidian-folder") {
          routes.push(input);
          const vision = input.folders.find(({ name }) => name === "Vision");
          text = returnInvalidFolder ? "../outside" : vision?.id ?? "F0";
        } else {
          requests.push({ payload, input });
          limited = limitNextAnalysis && input.task === "analysis";
          const item = input.evidence.find((entry) => entry.type === "pdf_text" && entry.text.includes("64-dimensional"));
          const ref = item?.id ?? "E1";
          const ablation = input.evidence.find((entry) => entry.type === "pdf_text" && entry.text.includes("72 percent"));
          text = input.task === "analysis"
            ? [
              ...sectionNames.map((name, i) => `## ${i + 1}. ${name}\n\n- **[Paper evidence]** The **gaze encoder** uses a 64-dimensional state. [[${ref}]]`),
              "### Research Improvements",
              `- **[Research proposal]** Test the encoder ablation on held-out subjects with the same decoder and accuracy metric. A vanishing accuracy gap would weaken the mechanism claim. [[${ablation?.id ?? ref}]]`,
            ].join("\n\n---\n\n")
            : `**[Paper evidence]** The **gaze encoder** uses a 64-dimensional state. [[${ref}]]  \nThe decoder predicts a fixation. [[${ref}]]\n\n---\n\n**[Inference]** The state can be written as $x_{t}$.\n\n**[Paper evidence]** Unsupported number. [[E999]]`;
          if (input.question === "Formatting fallback fixture") text = "Fallback fixture \u0001 remains readable.";
        }
      }
      const bytes = new win.TextEncoder();
      const sse = (event) => bytes.encode("data: " + JSON.stringify(event) + "\r\n\r\n");
      const body = new win.ReadableStream({
        async start(controller) {
          if (limited) {
            finishLimitedAnalysis = () => {
              controller.enqueue(sse({
                type: "response.incomplete",
                response: {
                  incomplete_details: { reason: "max_output_tokens" },
                  usage: {
                    input_tokens: 4726, output_tokens: payload.max_output_tokens,
                    output_tokens_details: { reasoning_tokens: payload.max_output_tokens },
                  },
                },
              }));
              controller.close();
            };
            return;
          }
          controller.enqueue(sse({ type: "response.output_text.delta", delta: text.slice(0, 44) }));
          if (isHeld) {
            options.signal.addEventListener("abort", () => {
              stopped = true;
              controller.error(options.signal.reason);
            }, { once: true });
            return;
          }
          await delay(350);
          controller.enqueue(sse({ type: "response.output_text.delta", delta: text.slice(44) }));
          controller.enqueue(sse({ type: "response.completed", response: { usage: { input_tokens: 130, output_tokens: 80 } } }));
          controller.close();
        },
      });
      return { ok: true, headers: { get: () => "text/event-stream" }, body };
    };
    const scope = {
      Zotero, ChromeUtils, IOUtils, PathUtils, fetch: mock, TextDecoder, setTimeout, clearTimeout,
      cloneReaderData: (value, window) => Components.utils.cloneInto(value, window),
      unwrapReaderObject: (value) => Components.utils.waiveXrays(value),
    };
    Services.scriptloader.loadSubScript(rootURI + "content/copilot.js", scope);
    const runtime = scope.ResearchCopilot.start(id);
    await runtime.ready;
    Zotero.Prefs.set(modelPref, customID, true);
    const prefs = Zotero.Utilities.Internal.openPreferences(PREFS);
    const field = await waitFor(() => prefs.document.querySelector("#zrc-preferences input[type=password]"), "Test settings mounted");
    const model = prefs.document.querySelector(".zrc-model-select");
    const custom = prefs.document.querySelector(".zrc-custom-model");
    const getModels = prefs.document.querySelector(".zrc-list-models");
    const testAPI = prefs.document.querySelector(".zrc-test-api");
    const save = prefs.document.querySelector(".zrc-save-settings");
    const status = prefs.document.querySelector(".zrc-settings-status");
    const vaultInput = prefs.document.querySelector(".zrc-obsidian-path");
    const vaultPath = PathUtils.join(root, "vault");
    const selectModel = (id) => {
      model.value = id;
      model.dispatchEvent(new prefs.Event("change"));
    };
    assert(model.value === "" && custom.value === customID && !custom.parentElement.hidden, "Previously saved custom model was lost");
    assert(model.querySelectorAll("optgroup option").length === 9 && catalogReads === 0, "Presets missing or catalog was fetched on open");
    selectModel("gpt-6-luna");
    assert(custom.parentElement.hidden, "Custom ID is visible when a preset is selected");
    testAPI.click();
    await waitFor(() => status.dataset.state === "error" && status.textContent.includes("API key"), "Missing key error in settings");
    assert(probes.length === 0, "An API test ran without credentials");

    field.value = deniedKey;
    getModels.click();
    await waitFor(() => status.dataset.state === "error" && status.textContent.includes("403"), "Account model listing permission error");
    assert(model.value === "gpt-6-luna" && model.querySelectorAll("optgroup option").length === 9, "Catalog error changed presets or selection");
    testAPI.click();
    await waitFor(() => status.dataset.state === "error" && status.textContent.includes("401"), "Rejected key error");
    field.value = key;
    testAPI.click();
    await waitFor(() => status.dataset.state === "success" && status.textContent.includes("gpt-6-luna"), "Preset model API test");
    assert(probes.at(-1) === "gpt-6-luna" && field.value === key && Zotero.Prefs.get(modelPref, true) === customID,
      "Testing changed the saved model or the pending key");
    assert(prefs.document.querySelector(".zrc-key-state").textContent.includes("required"), "The test saved a session key");
    selectModel("");
    testAPI.click();
    await waitFor(() => status.dataset.state === "error" && status.textContent.includes("404"), "Unavailable custom model error");
    assert(probes.at(-1) === customID, "Custom model was not tested");
    await record("Model dropdown preserves custom IDs and tests pasted credentials without saving settings");

    selectModel("gpt-6-luna");
    getModels.click();
    await waitFor(() => status.dataset.state === "success" && model.querySelector(".zrc-account-models"), "Account model options were added");
    assert(model.querySelectorAll(".zrc-account-models option").length === 1 && model.value === "gpt-6-luna",
      "Catalog failed to deduplicate IDs, exclude invalid IDs, or preserve the selection");
    selectModel(accountID);
    testAPI.click();
    await waitFor(() => status.dataset.state === "success" && status.textContent.includes(accountID), "Account model API test");
    assert(Zotero.Prefs.get(modelPref, true) === customID && requests.length === 0, "Discovery or testing saved a model or started paper chat");
    field.dispatchEvent(new prefs.Event("input"));
    assert(!model.querySelector(".zrc-account-models") && model.value === "" && custom.value === accountID,
      "Editing the key left stale account models or dropped the selected ID");
    await record("Account model discovery checks permissions and adds choices without saving or sending paper data");

    selectModel("gpt-5-mini");
    field.value = key;
    vaultInput.value = "relative-folder";
    save.click();
    await waitFor(() => status.dataset.state === "error" && status.textContent.includes("absolute path"), "Invalid Vault path was rejected");
    assert(field.value === key, "Invalid Vault path cleared a pending API key");
    vaultInput.value = vaultPath;
    save.click();
    await waitFor(() => prefs.document.querySelector(".zrc-key-state")?.textContent.includes("this Zotero session"), "Session key configured");
    assert(!field.value && !Zotero.Prefs.get("extensions.zotero.researchCopilot.encryptedOpenAIKey", true), "Session key was persisted or left in the input");
    testAPI.click();
    await waitFor(() => status.dataset.state === "success" && status.textContent.includes("gpt-5-mini"), "Test saved session key");
    assert(probes.at(-1) === "gpt-5-mini" && Zotero.Prefs.get(modelPref, true) === "gpt-5-mini", "Saved configuration was not used");
    prefs.close();
    await record("API test reuses the saved session key without writing a credential to preferences");

    const { reader, panel } = await openReader();
    const changeModel = panel.querySelector(".zrc-model-button");
    assert(changeModel.textContent.includes("gpt-5-mini"), "Sidebar did not display the current model");
    changeModel.click();
    const modelPrefs = await waitFor(() => {
      const prefWindow = Services.wm.getMostRecentWindow("zotero:pref");
      return prefWindow?.document.querySelector(".zrc-model-select") && prefWindow;
    }, "Sidebar model button opened Zotero settings");
    const nextModel = "gpt-6.1-sol";
    const sidebarSelect = modelPrefs.document.querySelector(".zrc-model-select");
    sidebarSelect.value = nextModel;
    sidebarSelect.dispatchEvent(new modelPrefs.Event("change"));
    const reasoning = modelPrefs.document.querySelector(".zrc-reasoning-select");
    assert(Array.from(reasoning.options, ({ value }) => value).join(",") === ",low,medium,high,xhigh,max",
      "GPT-6.1 Sol reasoning menu includes unsupported or missing levels");
    reasoning.value = "max";
    modelPrefs.document.querySelector(".zrc-save-settings").click();
    await waitFor(() => changeModel.textContent.includes(nextModel), "Sidebar label updated immediately after saving a new model");
    modelPrefs.close();
    const ask = (text) => {
      panel.querySelector(".zrc-editor").value = text;
      panel.querySelector(".zrc-send").click();
    };
    const existingNote = new Zotero.Item("note");
    existingNote.libraryID = parent.libraryID;
    existingNote.parentID = parent.id;
    existingNote.setNote("<p>Original fixture note.</p>");
    await existingNote.saveTx({ skipSelect: true });
    const originalNote = existingNote.getNote();
    const createdNotes = () => parent.getNotes().filter((id) => id !== existingNote.id);
    const noteCount = () => createdNotes().length;
    ask("How does the gaze encoder work?");
    await waitFor(() => panel.querySelector(".zrc-stream-text")?.textContent.includes("gaze"), "Visible streamed delta");
    await waitFor(() => panel.querySelector(".zrc-answer-body .katex"), "KaTeX formula rendering");
    const completedAnswer = panel.querySelector(".zrc-turn");
    assert(completedAnswer.querySelector(".zrc-answer-body br") && completedAnswer.querySelector(".zrc-answer-body hr"),
      "Markdown hard breaks or horizontal rules did not render");
    assert(completedAnswer.querySelector(".zrc-turn-status").hidden && completedAnswer.querySelector(".zrc-save"),
      "Completed response remained in the generating state or could not be saved");
    const firstRequest = requests[0];
    assert(firstRequest.payload.model === nextModel, "Paper request did not use the model saved from the sidebar shortcut");
    assert(firstRequest.payload.reasoning?.effort === "max", "Paper request did not use the selected reasoning effort");
    assert(firstRequest.input.evidence.some((entry) => entry.page === 2 && entry.text?.includes("64-dimensional")), "Real PDF text on physical page 2 missing");
    assert(!firstRequest.input.evidence.some((entry) => entry.page === 1 && entry.text), "Leading blank PDF page shifted evidence");
    assert(firstRequest.payload.store === false && firstRequest.payload.stream === true, "Incorrect Responses flags");
    assert(panel.querySelector(".zrc-answer-body .zrc-label-paper") && panel.querySelector(".zrc-answer-body .zrc-label-missing"), "Evidence labels failed");
    assert(panel.querySelector(".zrc-answer-meta").textContent.includes("130"), "Usage not displayed");
    const view = reader._internalReader._primaryView;
    await reader.navigate({ pageIndex: 2 });
    await waitFor(() => view._iframeWindow.PDFViewerApplication.pdfViewer.currentPageNumber === 3, "Move to page 3");
    const citation = panel.querySelector(".zrc-inline-cite");
    assert(citation, "Citation button missing");
    citation.click();
    await waitFor(() => view._iframeWindow.PDFViewerApplication.pdfViewer.currentPageNumber === 2, "Citation jumped to physical page 2");
    panel.querySelector(".zrc-turn .zrc-save").click();
    await waitFor(() => noteCount() === 1, "Child note persisted");
    const note = Zotero.Items.get(createdNotes()[0]);
    assert(note.getNote().includes(`/items/${attachment.key}?page=2`) && note.getNote().includes("64-dimensional"), "Note lost its citation or evidence");
    assert(note.relatedItems.includes(attachment.key), "Zotero note is not related to the PDF attachment");
    await record("Native PDF text and physical page evidence, SSE display, LaTeX, usage, live jump and linked Zotero note");

    completedAnswer.querySelector(".zrc-save-obsidian").click();
    await waitFor(() => panel.querySelector(".zrc-panel-status").textContent.includes("Saved to Obsidian"), "Q&A was exported to the routed Obsidian folder");
    const vaultBase = PathUtils.join(vaultPath, "Vision", "A Gaze and Scanpath Fixture - Q&A");
    const savedMarkdown = await IOUtils.readUTF8(vaultBase + " (2).md");
    assert(await IOUtils.readUTF8(vaultBase + ".md") === "Existing vault note.", "Export replaced an existing Obsidian note");
    assert(savedMarkdown.includes("reasoning_effort: \"max\"") && savedMarkdown.includes("zotero://open-pdf/") && savedMarkdown.includes("?page=2"),
      "Obsidian Markdown lost reasoning metadata or source links");
    assert(routes[0].folders.map(({ name }) => name).join(",") === "Systems,Vision", "Routing exposed a hidden, symlinked, or unrelated folder");
    assert(Object.keys(routes[0]).sort().join(",") === "excerpt,folders,task,title" &&
      !JSON.stringify(routes[0]).includes(vaultPath) && !JSON.stringify(routes[0]).includes("Existing vault note."),
    "Routing included filesystem paths or vault file contents");
    await record("Obsidian export uses the model-selected directory, preserves local links and avoids overwrites");

    isHeld = true;
    ask("Does it help ablation?");
    await waitFor(() => requests.length === 2 && !panel.querySelector(".zrc-stop").hidden, "Second request streamed");
    assert(requests[1].input.recent_conversation.length === 1, "Missing multi-turn context");
    panel.querySelector(".zrc-stop").click();
    await waitFor(() => stopped && !panel.querySelector(".zrc-composer-actions button:nth-child(2)").hidden, "Stop and retry");
    isHeld = false;
    panel.querySelector(".zrc-composer-actions button:nth-child(2)").click();
    await waitFor(() => requests.length === 3 && panel.querySelectorAll(".zrc-turn .zrc-save").length === 2, "Retry completion");
    await record("Multi-turn context, cancel, and explicit retry");

    const readerDoc = reader._iframeWindow.document;
    view._onSetSelectionPopup(Components.utils.cloneInto({
      rect: [80, 120, 245, 136],
      annotation: { type: "highlight", text: "The gaze encoder uses a 64-dimensional state.", pageLabel: "1", position: { pageIndex: 1 } },
    }, reader._iframeWindow));
    const explain = await waitFor(() => readerDoc.querySelector(".zrc-selection-control"), "AI action in native selection popup");
    explain.click();
    await waitFor(() => requests.length === 4 && panel.querySelectorAll(".zrc-turn .zrc-save").length === 3, "Selection answer");
    assert(requests[3].input.task === "selection" && requests[3].input.evidence[0].page === 2, "Selection provenance lost");
    view._onSetSelectionPopup();
    await record("Selection hook and surrounding PDF evidence");

    const capture = panel.querySelector(".zrc-image-actions input[type=number]");
    capture.value = "3";
    panel.querySelector(".zrc-image-actions button").click();
    await waitFor(() => {
      const status = panel.querySelector(".zrc-panel-status").textContent;
      if (status && !status.includes("Preparing")) throw new Error(status);
      return !panel.querySelector(".zrc-image-preview").hidden;
    }, "Native PDF page rasterization");
    ask("Explain the figure on the page.");
    await waitFor(() => requests.length === 5 && panel.querySelectorAll(".zrc-turn .zrc-save").length === 4, "Visual request");
    assert(requests[4].payload.input[0].content[1].image_url.startsWith("data:image/png;base64,"), "Image not sent");
    assert(requests[4].input.evidence[0].type === "pdf_page_image" && requests[4].input.evidence[0].page === 3, "Page image provenance lost");
    await record("Explicit page capture and multimodal request payload");

    const raster = win.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
    raster.width = raster.height = 24;
    const ctx = raster.getContext("2d");
    ctx.fillStyle = "#265bac";
    ctx.fillRect(0, 0, 24, 24);
    const blob = await new Promise((resolve) => raster.toBlob(resolve, "image/png"));
    const files = new win.DataTransfer();
    files.items.add(new win.File([blob], "fixture.png", { type: "image/png" }));
    const upload = panel.querySelector(".zrc-upload");
    upload.files = files.files;
    upload.dispatchEvent(new win.Event("change"));
    await waitFor(() => !panel.querySelector(".zrc-image-preview").hidden, "User image attachment");
    ask("Explain the local screenshot.");
    await waitFor(() => requests.length === 6 && panel.querySelectorAll(".zrc-turn .zrc-save").length === 5, "User image request");
    assert(requests[5].input.evidence[0].type === "user_supplied_image" && !("page" in requests[5].input.evidence[0]), "User image was assigned a PDF page");
    assert(requests[5].payload.input[0].content[1].image_url.startsWith("data:image/jpeg;base64,"), "User image was not re-encoded");
    await record("Local image fallback is re-encoded and carries no assumed PDF page");

    panel.querySelector(".zrc-analyze").click();
    await waitFor(() => panel.querySelector(".zrc-map-tab.zrc-map-ready"), "Mind map generated");
    const analysis = requests.at(-1);
    assert(analysis.input.analysis_coverage.excerpt_pages.join(",") === "2,3", "Analysis lost excerpt coverage");
    assert(analysis.payload.instructions.includes("Research Improvements"), "Research proposal instructions missing");
    assert(analysis.payload.max_output_tokens === 32_000, "Max analysis did not receive the automatic output budget");
    panel.querySelector(".zrc-map-tab").click();
    assert(panel.querySelectorAll(".zrc-branch").length === 10, "Wrong number of map branches");
    assert(panel.querySelector(".zrc-branch .zrc-inline-cite"), "Map lost evidence reference");
    assert(panel.querySelector(".zrc-map-leaf hr"), "Markdown horizontal rules broke the mind map");
    assert(panel.querySelector(".zrc-map .zrc-label-inference")?.textContent.includes("Research proposal"), "Map lost the proposal label");
    panel.querySelector(".zrc-map .zrc-save").click();
    await waitFor(() => noteCount() === 2, "Map note persisted");
    assert(createdNotes().map((itemID) => Zotero.Items.get(itemID).getNote()).some((html) =>
      html.includes("Research Improvements") && html.includes("Excerpts from 2/2 indexed text pages") && html.includes("?page=3")),
    "Map note lost the proposal, coverage, or citation");
    await record("Ten-section analysis, coverage and cited research proposal saved in the mind map note");
    returnInvalidFolder = true;
    panel.querySelector(".zrc-map .zrc-save-obsidian").click();
    await waitFor(() => panel.querySelector(".zrc-panel-status").textContent.includes("default Obsidian folder"),
      "Out-of-scope model path fell back to the default directory");
    const mapMarkdown = await IOUtils.readUTF8(PathUtils.join(vaultPath, "Research Copilot", "A Gaze and Scanpath Fixture - Mind Map.md"));
    assert(mapMarkdown.includes("## Open Questions") && (await IOUtils.getChildren(PathUtils.join(root, "outside"))).length === 0,
      "Fallback lost the mind-map outline or wrote outside the Vault");
    await record("Obsidian mind-map export rejects model paths outside the allowlist");
    if (Services.env.get("ZRC_KEEP_SMOKE") === "1") {
      try {
        await snapshot(panel, PathUtils.join(root, "mind-map.png"));
        panel.querySelector(".zrc-tabs button").click();
        await snapshot(panel, PathUtils.join(root, "chat.png"));
        win.browsingContext.prefersColorSchemeOverride = "dark";
        await snapshot(panel, PathUtils.join(root, "chat-dark.png"));
      } catch { /* optional visual QA */ }
      finally { win.browsingContext.prefersColorSchemeOverride = "none"; }
    }
    panel.querySelector(".zrc-tabs button").click();
    const saved = await Zotero.Annotations.saveFromJSON(attachment, {
      key: "GZ234567", type: "highlight", text: "The gaze encoder uses a 64-dimensional state.",
      position: { pageIndex: 1, rects: [[72, 698, 334, 716]] }, color: "#ffd400",
      comment: "Private fixture comment", pageLabel: "1", sortIndex: "00001|000020|00000",
    });
    await waitFor(() => reader.annotationItemIDs.includes(saved.id), "Zotero loaded the saved annotation");
    let explainSaved;
    Zotero.Reader._dispatchEvent({
      type: "createAnnotationContextMenu", reader, doc: readerDoc, params: { ids: [saved.key] },
      append: (item) => { explainSaved = item; },
    });
    assert(explainSaved, "Saved annotation action missing");
    explainSaved.onCommand();
    await waitFor(() => requests.length === 8 && panel.querySelectorAll(".zrc-turn .zrc-save").length === 7, "Saved annotation explanation");
    const latest = panel.querySelector(".zrc-chat").lastElementChild;
    latest.querySelector(".zrc-inline-cite").click();
    await waitFor(() => reader._internalReader._state.selectedAnnotationIDs.includes(saved.key), "Jump to exact saved annotation");
    assert(!JSON.stringify(requests[7].input).includes("Private fixture comment"), "Annotation comment was sent");
    latest.querySelector(".zrc-save").click();
    await waitFor(() => noteCount() === 3 && panel.querySelector(".zrc-panel-status").textContent.includes("Saved a new Zotero note"),
      "Annotation note persisted");
    const newNotes = await Zotero.Items.getAsync(createdNotes());
    assert(newNotes.some((note) => note.isNote() && note.getNote().includes("annotation=" + saved.key)), "Note lost its annotation link");
    assert(existingNote.getNote() === originalNote, "An existing note was modified");
    await record("Saved annotation jump and link, unrelated annotation comment excluded, existing note preserved");

    ask("Formatting fallback fixture");
    const fallback = await waitFor(() => {
      const last = panel.querySelector(".zrc-chat").lastElementChild;
      return last.querySelector(".zrc-turn-status")?.textContent.includes("Displaying plain text") && last;
    }, "Invalid markup falls back to plain text");
    assert(fallback.querySelector(".zrc-stream-text").textContent.includes("remains readable") &&
      fallback.querySelector(".zrc-save") && !panel.querySelector(".zrc-send").disabled,
    "Formatting failure lost the answer, hid save, or blocked the next question");
    await record("A formatting exception preserves completed text and leaves the sidebar usable");

    changeModel.click();
    const budgetPrefs = await waitFor(() => {
      const prefWindow = Services.wm.getMostRecentWindow("zotero:pref");
      return prefWindow?.document.querySelector(".zrc-analysis-budget") && prefWindow;
    }, "Deep analysis budget settings opened");
    budgetPrefs.document.querySelector(".zrc-analysis-budget").value = "64000";
    budgetPrefs.document.querySelector(".zrc-save-settings").click();
    await waitFor(() => Zotero.Prefs.get("extensions.zotero.researchCopilot.analysisBudget", true) === "64000",
      "Explicit output budget saved");
    budgetPrefs.close();
    limitNextAnalysis = true;
    panel.querySelector(".zrc-analyze").click();
    const limitedTurn = await waitFor(() => {
      const last = panel.querySelector(".zrc-chat").lastElementChild;
      return finishLimitedAnalysis && last.querySelector(".zrc-turn-status")?.textContent.includes("Waiting for the first answer text") && last;
    }, "Waiting state distinguishes reasoning from streamed answer text");
    assert(requests.at(-1).payload.max_output_tokens === 64_000, "Saved output budget did not reach the analysis request");
    finishLimitedAnalysis();
    await waitFor(() => limitedTurn.querySelector(".zrc-turn-status").textContent.includes("output token budget") &&
      !panel.querySelector(".zrc-send").disabled, "Output exhaustion ends generation with a specific explanation");
    assert(limitedTurn.querySelector(".zrc-answer-meta").textContent.includes(`of which reasoning ${(64_000).toLocaleString()}`),
      "Reasoning-only token usage was not displayed");
    await record("Deep analysis applies its output budget and explains reasoning-only exhaustion");

    const after = await IOUtils.read(await attachment.getFilePathAsync());
    assert(before.length === after.length && before.every((byte, index) => byte === after[index]), "PDF bytes changed");
    await win.Zotero_Tabs.close(reader.tabID);
    const standalone = await openReader(true);
    standalone.reader._window.close();
    await record("PDF bytes preserved, tab closed, and standalone reader sidebar opened");
    runtime.dispose();
    chrome.destruct();
    result = { ok: true, checks };
  } catch (error) {
    result = { ok: false, checks, error: String(error), stack: error?.stack };
  }
  await IOUtils.writeJSON(PathUtils.join(root, "result.json"), result);
  Services.startup.quit(Ci.nsIAppStartup.eForceQuit);
}

async function snapshot(panel, path) {
  const doc = panel.ownerDocument;
  const win = doc.defaultView;
  await new Promise((resolve) => win.requestAnimationFrame(resolve));
  const rect = panel.getBoundingClientRect();
  const bitmap = await win.browsingContext.currentWindowGlobal.drawSnapshot(rect, 1, "#f3f6fa", true);
  const canvas = doc.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  await IOUtils.write(path, new Uint8Array(await blob.arrayBuffer()));
}
