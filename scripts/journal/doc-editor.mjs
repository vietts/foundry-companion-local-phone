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

// One id per module load (not per editor): marks this device's own saves. Foundry's collaborative
// ProseMirror session is per user, not per device, so the same GM's laptop and phone never see each
// other's live steps - only the resulting save. The updateJournalEntryPage hook below uses this id
// to tell its own saves apart from ones made elsewhere.
const CLIENT_ID = foundry.utils.randomID();

/**
 * Mount an always-on, collaborative ProseMirror editor for a text page, saved automatically.
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
    collaborate: true,
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

  // Any change of the document (typing, formatting, steps from other clients) schedules a save.
  editor.addEventListener("plugins", event => {
    event.plugins.fcpAutosave = new ProseMirror.state.Plugin({
      view: () => ({
        update: (view, prev) => {
          if (!view.state.doc.eq(prev.doc)) autosave.touch();
        }
      })
    });
  });

  // A save of this page from elsewhere - typically the same GM's other device, since Foundry's
  // collaborative session doesn't cover that case (see CLIENT_ID above). Refresh only when there
  // is nothing local to lose; otherwise keep the local text and let the next save win.
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
    if (disposed) return;
    ctl.pending = autosave.flush(editor.value);
  });

  container.append(editor);
  return ctl;
}
