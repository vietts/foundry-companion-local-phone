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
 */
export function mountDocEditor(container, page, { onState } = {}) {
  const initial = page.text.content ?? "";
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
    onState
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

  // Ctrl+S, the menu's save button and removal from the DOM all call save(). Save the page now,
  // and stop the element from firing "change", which would submit the journal sheet's form.
  editor.addEventListener("save", event => {
    event.preventDefault();
    autosave.flush(editor.value);
  });

  const opened = new Promise(resolve => editor.addEventListener("open", () => resolve(editor), { once: true }));
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), 3000));
  container.append(editor);

  return {
    editor,
    ready: Promise.race([opened, timeout]),
    content: () => editor.querySelector(".editor-content"),
    flush: value => autosave.flush(value),
    dispose: () => autosave.dispose()
  };
}
