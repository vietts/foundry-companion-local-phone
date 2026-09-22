import { createAutosave } from "./autosave.mjs";

/** Pages the document editor handles: text pages stored as HTML, Foundry's default format. */
export function isDocPage(page) {
  return page?.type === "text" && page.text?.format === CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML;
}

/** Show a save state ("dirty", "saving", "saved", "error") in an indicator element. */
export function showSaveState(el, state) {
  if (!el) return;
  el.dataset.state = state;
  el.textContent = game.i18n.localize(`FCP.Doc.State.${state}`);
}

// One id per module load (not per editor): marks this device's own saves. The editor is not
// collaborative (Foundry's sessions are per user, so they would not sync the same GM's laptop and
// phone anyway): other clients learn about a change only from the resulting save, and the
// updateJournalEntryPage hooks below use this id to tell this device's saves from the others.
const CLIENT_ID = foundry.utils.randomID();

/**
 * Mount an always-on ProseMirror editor for a text page, saved automatically.
 * @param {HTMLElement} container
 * @param {JournalEntryPage} page
 * @param {{onState?: (state: string, error?: unknown) => void,
 *   onRemoteChange?: (page: JournalEntryPage) => void}} [options]
 * @returns {{editor: HTMLElement, ready: Promise<HTMLElement|null>, pending: Promise<boolean>|null,
 *   content: () => HTMLElement|null, flush: (value?: string) => Promise<boolean>, dispose: () => void}}
 */
export function mountDocEditor(container, page, { onState, onRemoteChange } = {}) {
  const initial = page.text.content ?? "";
  // Once disposed (the controller already flushed and tore down, e.g. from _preClose) the
  // disconnect "save" event, the remote-change hook below, and any state they trigger must be inert.
  let disposed = false;
  const editor = foundry.applications.elements.HTMLProseMirrorElement.create({
    name: "text.content",
    value: initial,
    toggled: false,
    collaborate: false,
    // Not for collaboration: pasted or dropped images are uploaded for this document.
    documentUUID: page.uuid
  });
  const autosave = createAutosave({
    initial,
    read: () => editor.value,
    // render: false, or every save would re-render the sheet and destroy the editor mid-sentence.
    // fcpClient marks this device's own save, see CLIENT_ID above.
    save: value => page.update({ "text.content": value }, { render: false, fcpClient: CLIENT_ID }),
    onState: (state, error) => { if (!disposed) onState?.(state, error); }
  });

  // Any change of the document (typing, formatting) schedules a save.
  editor.addEventListener("plugins", event => {
    event.plugins.fcpAutosave = new ProseMirror.state.Plugin({
      view: () => ({
        update: (view, prev) => {
          if (!view.state.doc.eq(prev.doc)) autosave.touch();
        }
      })
    });
  });

  // A save of this page from another client (a co-GM, or the same GM's other device). Refresh only
  // when there is nothing local to lose; otherwise keep the local text and let the next save win.
  const remoteChangeHook = Hooks.on("updateJournalEntryPage", (updated, changed, options) => {
    if (disposed || (updated.id !== page.id) || (options.fcpClient === CLIENT_ID)) return;
    if (foundry.utils.getProperty(changed, "text.content") === undefined) return;
    if (autosave.hasChanges()) return;
    onRemoteChange?.(updated);
  });

  const opened = new Promise(resolve => editor.addEventListener("open", () => resolve(editor), { once: true }));
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), 3000));

  const ctl = {
    editor,
    ready: Promise.race([opened, timeout]),
    // The in-flight flush from the last "save" event, if any: a remount (see doc-sheet.mjs) awaits
    // it so it reads the page's saved content, not text from before that flush completed.
    pending: null,
    content: () => editor.querySelector(".editor-content"),
    flush: value => autosave.flush(value),
    dispose: () => {
      disposed = true;
      Hooks.off("updateJournalEntryPage", remoteChangeHook);
      autosave.dispose();
    }
  };

  // Ctrl+S, the menu's save button and removal from the DOM all call save(). Save the page now,
  // and stop the element from firing "change", which would submit the journal sheet's form.
  editor.addEventListener("save", event => {
    event.preventDefault();
    // Cancelling save() also skips the element's own _setValue, and a reconnected element rebuilds
    // from _value: the multi-page sheet re-appends every page on any render, so without this the
    // other pages' editors would come back with their text from mount time. _setValue, not the value
    // setter, which would fire "change" and submit the sheet's form.
    editor._setValue(editor.value);
    if (disposed) return;
    // Nothing typed: save nothing. ProseMirror's HTML can differ from the stored HTML without any
    // edit (normalization), so saving it anyway would rewrite a note just by opening it.
    if (!autosave.hasChanges()) {
      ctl.pending = Promise.resolve(true);
      return;
    }
    ctl.pending = autosave.flush(editor.value);
  });

  container.append(editor);
  return ctl;
}

/**
 * Saves made by the editors above pass `render: false`, which reaches every client, so views of the
 * page without a live editor (a player's shared page, read-only sheets, page sheets) would no longer
 * refresh. Re-render them on saves from other clients, as Foundry would have. The document sheet
 * decides for itself (`fcpOnRemoteSave` in doc-sheet.mjs): a page it holds a live editor for is
 * refreshed by onRemoteChange above, and a full render would interrupt writing on its other pages.
 * Registered once, at init.
 */
export function registerRemoteRefresh() {
  Hooks.on("updateJournalEntryPage", (page, changed, options) => {
    if (!options.fcpClient || (options.fcpClient === CLIENT_ID)) return;
    const context = { renderContext: "updateJournalEntryPage", renderData: changed };
    const apps = [...Object.values(page.apps), ...Object.values(page.parent?.apps ?? {})];
    for (const app of new Set(apps)) {
      if (app.fcpOnRemoteSave) app.fcpOnRemoteSave(page.id);
      else app.render(false, foundry.utils.deepClone(context));
    }
  });
}
