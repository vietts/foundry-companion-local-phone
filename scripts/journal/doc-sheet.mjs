import { isDocPage, mountDocEditor, showSaveState } from "./doc-editor.mjs";
import { warn } from "../constants.mjs";

const { JournalEntrySheet } = foundry.applications.sheets.journal;

/**
 * The journal as a document: editable text pages open straight into an always-on editor that saves
 * by itself. Other page types, and pages the user cannot edit, render as in Foundry's sheet.
 */
export class CompanionJournalSheet extends JournalEntrySheet {
  static DEFAULT_OPTIONS = {
    classes: ["fcp-doc-sheet"],
    actions: {
      fcpAddPage: CompanionJournalSheet.#onAddPage
    }
  };

  /** Mounted editors by page id. */
  #editors = new Map();

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
      }
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
}
