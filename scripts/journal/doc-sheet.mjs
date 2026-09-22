import { isDocPage, mountDocEditor, showSaveState } from "./doc-editor.mjs";
import { MODULE_ID, warn } from "../constants.mjs";

/**
 * Register the document sheet as the default JournalEntry sheet, built over the system's own journal
 * sheet (e.g. dnd5e's JournalEntrySheet5e) so its styling and navigation stay. Called at "ready":
 * sheets registered during init and setup only land in CONFIG.JournalEntry.sheetClasses once Foundry
 * initializes them, right before ready, and a registration made after that takes effect at once.
 */
export function registerDocSheet() {
  const base = systemJournalSheet();
  foundry.applications.apps.DocumentSheetConfig.registerSheet(JournalEntry, MODULE_ID, DocSheetMixin(base), {
    makeDefault: true,
    label: "FCP.Doc.SheetLabel"
  });
  return base;
}

/**
 * The journal sheet the system registered, or Foundry's own. Only a sheet built on Foundry's
 * JournalEntrySheet can be extended: the overrides below rely on its page rendering.
 */
function systemJournalSheet() {
  const core = foundry.applications.sheets.journal.JournalEntrySheet;
  const scope = `${game.system.id}.`;
  const sheets = Object.values(CONFIG.JournalEntry.sheetClasses?.[CONST.BASE_DOCUMENT_TYPE] ?? {})
    .filter(s => s.id.startsWith(scope) && s.canBeDefault && foundry.utils.isSubclass(s.cls, core));
  return (sheets.find(s => s.default) ?? sheets[0])?.cls ?? core;
}

/**
 * The journal as a document: editable text pages open straight into an always-on editor that saves
 * by itself. Other page types, and pages the user cannot edit, render as in the base sheet.
 * @param {typeof foundry.applications.sheets.journal.JournalEntrySheet} Base
 */
export const DocSheetMixin = Base => class CompanionJournalSheet extends Base {
  static DEFAULT_OPTIONS = {
    classes: ["fcp-doc-sheet"],
    actions: {
      fcpAddPage: CompanionJournalSheet.#onAddPage
    }
  };

  /** Mounted editors by page id. */
  #editors = new Map();

  /**
   * A page was saved on another client (see registerRemoteRefresh in doc-editor.mjs). A page with a
   * live editor here refreshes itself; a page shown read-only re-renders alone, so that the editors
   * of the other pages are not interrupted.
   * @param {string} pageId
   */
  fcpOnRemoteSave(pageId) {
    if (this.#editors.has(pageId) || !this.rendered || !this.parts[pageId]) return;
    this.render({ parts: [pageId] });
  }

  /** @override */
  async _renderPageView(element, sheet) {
    const page = sheet.document;
    if (!this._pages[page.id]?.editable || !isDocPage(page)) return super._renderPageView(element, sheet);
    const previous = this.#editors.get(page.id);
    if (previous) {
      previous.dispose();
      // This render may have just replaced (and so disconnected) the old page part: its editor's
      // disconnect "save" flushed asynchronously. Wait for it, or page.text.content below is still
      // the pre-flush text and the new editor would remount from stale content.
      const ok = await previous.pending;
      if (ok === false) {
        ui.notifications.warn(game.i18n.format("FCP.Doc.SaveFailed", { name: page.name }));
      }
    }
    element.classList.add("fcp-doc");

    // The page-title heading, when shown, is the TOC's expected first entry (see #toc): it lives
    // outside the editor's own content, so it is tracked separately here.
    let titleHeading = null;
    if (page.title.show) {
      const header = document.createElement("header");
      header.className = "journal-page-header";
      titleHeading = document.createElement(`h${page.title.level}`);
      titleHeading.textContent = page.name;
      header.append(titleHeading);
      element.append(header);
    }
    const state = document.createElement("div");
    state.className = "fcp-save-state";
    showSaveState(state, "saved");
    element.append(state);

    const ctl = mountDocEditor(element, page, {
      onState: s => {
        showSaveState(state, s);
        // Headings may have changed: keep the sidebar index, and the anchor lookups (goToPage,
        // _onRender) that read sheet.toc, in step.
        if (s === "saved") {
          const toc = this.#toc(ctl, titleHeading);
          sheet.toc = toc;
          this._renderHeadings(element, toc).catch(err => warn("failed to refresh the heading index", err));
        }
      },
      // A save from another client of the same page with nothing local to lose: re-render just
      // this page part. The new editor mounts from the now-current page.text.content, and since it
      // starts equal to that text, nothing is dirty and nothing saves back - no loop.
      onRemoteChange: () => this.render({ parts: [page.id] })
    });
    this.#editors.set(page.id, ctl);
    await ctl.ready;
    sheet.toc = this.#toc(ctl, titleHeading);
  }

  /**
   * Build the page's table of contents. Foundry's `_renderHeadings` drops the TOC's first entry
   * when the page title is shown, expecting it to be the title heading, so it is included here.
   * @param {ReturnType<typeof mountDocEditor>} ctl
   * @param {HTMLElement|null} titleHeading
   */
  #toc(ctl, titleHeading) {
    const content = ctl.content();
    if (!content) return {};
    return JournalEntryPage.implementation.buildTOC(titleHeading ? [titleHeading, content] : content);
  }

  /** @override */
  async _renderPageViews(context, options) {
    await super._renderPageViews(context, options);
    for (const [id, ctl] of this.#editors) {
      // Editors whose page part was replaced or removed already saved on disconnect.
      if (!ctl.editor.isConnected) {
        ctl.dispose();
        this.#editors.delete(id);
        const name = this.entry.pages.get(id)?.name ?? "";
        ctl.pending?.then(ok => ok === false && ui.notifications.warn(game.i18n.format("FCP.Doc.SaveFailed", { name })));
        continue;
      }
      // Always editing: no pencil.
      this.parts[id]?.querySelector(":scope > .edit-container")?.remove();
    }
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const content = this.element.querySelector(".journal-entry-content");
    if (!this.isEditable || !content || content.querySelector(".fcp-add-page")) return;
    content.insertAdjacentHTML("beforeend", `<button type="button" class="fcp-add-page" data-action="fcpAddPage">
      <i class="fa-solid fa-plus"></i> ${game.i18n.localize("FCP.Doc.AddPage")}</button>`);
  }

  /** @override */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    // The page editors sit inside this form but save their own page, not the entry.
    delete data.text;
    return data;
  }

  /** @override */
  async _preClose(options) {
    await super._preClose(options);
    for (const [id, ctl] of this.#editors) {
      const ok = await ctl.flush();
      if (!ok) ui.notifications.warn(game.i18n.format("FCP.Doc.SaveFailed", { name: this.entry.pages.get(id)?.name ?? "" }));
      ctl.dispose();
    }
    this.#editors.clear();
  }

  /** "+ Page": an empty text page at the end, opened with the cursor in it. */
  static async #onAddPage() {
    const sort = (Object.values(this._pages).at(-1)?.sort ?? 0) + CONST.SORT_INTEGER_DENSITY;
    const [page] = await this.entry.createEmbeddedDocuments("JournalEntryPage", [{
      type: "text",
      name: game.i18n.localize("FCP.Doc.NewPage"),
      sort,
      text: { content: "" }
    }]);
    if (!page) return;
    await this.render({ pageId: page.id });
    const ctl = this.#editors.get(page.id);
    await ctl?.ready;
    ctl?.editor.focus();
  }
};
