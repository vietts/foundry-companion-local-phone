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

/**
 * Mount an always-on, collaborative ProseMirror editor for a text page, saved automatically.
 * @param {HTMLElement} container
 * @param {JournalEntryPage} page
 * @param {{onState?: (state: string, error?: unknown) => void}} [options]
 * @returns {{editor: HTMLElement, ready: Promise<HTMLElement|null>, pending: Promise<boolean>|null,
 *   content: () => HTMLElement|null, flush: (value?: string) => Promise<boolean>, dispose: () => void}}
 */
export function mountDocEditor(container, page, { onState } = {}) {
  const initial = page.text.content ?? "";
  // Once disposed (the controller already flushed and tore down, e.g. from _preClose) the
  // disconnect "save" event below and any state it triggers must be inert.
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
    save: value => page.update({ "text.content": value }, { render: false }),
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
