import { SETTINGS } from "../constants.mjs";
import { getSetting, setSetting } from "../settings.mjs";
import { buildTree, matchesQuery, normalize, pushRecent, quickNoteName } from "./notes-data.mjs";
import { isDocPage, mountDocEditor, showSaveState } from "../journal/doc-editor.mjs";

/** The GM's Notes tab in the companion: browse the journal, open an entry, write in it. */
export class GmNotes {
  constructor(app) {
    this.app = app;
    this.entryId = null;
    this.pageId = null;
    this.openFolders = new Set();
    this.query = "";
    this.editor = null;
    this.focusNext = false;
  }

  /** Bumped on every onRender call: an in-flight remount checks it to tell whether it was superseded. */
  #renderToken = 0;

  get entry() {
    return this.entryId ? game.journal.get(this.entryId) ?? null : null;
  }

  /* -------------------------------------------- */
  /*  Context                                      */
  /* -------------------------------------------- */

  async prepare() {
    const entry = this.entry;
    if (!entry) {
      this.entryId = null;
      return this.#prepareList();
    }
    const pages = entry.pages.contents
      .filter(p => p.testUserPermission(game.user, "OBSERVER"))
      .sort((a, b) => a.sort - b.sort);
    const page = pages.find(p => p.id === this.pageId) ?? pages[0] ?? null;
    this.pageId = page?.id ?? null;
    return {
      entry: { id: entry.id, name: entry.name },
      pages: pages.map(p => ({ id: p.id, name: p.name, active: p.id === page?.id })),
      multiple: pages.length > 1,
      page: page ? await this.#preparePage(page) : null
    };
  }

  #prepareList() {
    const entries = game.journal.contents
      .filter(e => e.visible)
      .map(e => ({ id: e.id, name: e.name, folderId: e.folder?.id ?? null, sort: e.sort }));
    const folders = game.folders.contents
      .filter(f => f.type === "JournalEntry")
      .map(f => ({ id: f.id, name: f.name, parentId: f.folder?.id ?? null, sort: f.sort }));
    const recent = getSetting(SETTINGS.RECENT_NOTES)
      .map(id => game.journal.get(id))
      .filter(e => e?.visible)
      .map(e => ({ id: e.id, name: e.name }));
    return {
      query: this.query,
      recent,
      rows: buildTree(folders, entries, this.openFolders),
      all: entries.map(e => ({ id: e.id, name: e.name, search: normalize(e.name) })).sort((a, b) => a.name.localeCompare(b.name)),
      empty: !entries.length
    };
  }

  async #preparePage(page) {
    if (isDocPage(page) && page.canUserModify(game.user, "update")) return { id: page.id, editable: true };
    let html;
    if (page.type === "text") {
      html = await foundry.applications.ux.TextEditor.implementation.enrichHTML(page.text.content ?? "", { relativeTo: page, secrets: true });
    } else if (page.type === "image" && page.src) {
      html = `<img src="${Handlebars.escapeExpression(page.src)}" alt="">`;
    } else {
      html = `<p class="fcp-empty">${game.i18n.localize("FCP.Notes.Unsupported")}</p>`;
    }
    return { id: page.id, editable: false, html };
  }

  /* -------------------------------------------- */
  /*  Rendering                                    */
  /* -------------------------------------------- */

  onRender(root) {
    const token = ++this.#renderToken;
    const tab = root.querySelector(".fcp-tab[data-tab=notes]");
    if (!tab) return;

    const search = tab.querySelector("input[name=noteQuery]");
    if (search && !search.dataset.bound) {
      search.dataset.bound = "1";
      search.addEventListener("input", () => {
        this.query = search.value;
        this.applyFilter(tab);
      });
    }
    this.applyFilter(tab);

    const holder = tab.querySelector(".fcp-note-editor");
    if (!holder || holder.dataset.mounted) return;
    const page = this.entry?.pages.get(holder.dataset.pageId);
    if (!page) return;
    holder.dataset.mounted = "1";
    // Launched, not awaited: a re-render arriving while this is in flight must not break _onRender.
    this.#mount(token, tab, holder, page);
  }

  /**
   * Mount a fresh editor for `page`, first waiting out the previous editor's disconnect-triggered
   * save (its `pending`), same as CompanionJournalSheet#_renderPageView. `token` guards against a
   * newer onRender superseding this one while the await is in flight - the holder it targets may by
   * then be detached, and this.editor may already belong to a later mount.
   */
  async #mount(token, tab, holder, page) {
    const previous = this.editor;
    if (previous) {
      this.editor = null;
      const ok = await previous.pending;
      // Always warn and dispose, even if superseded below: `previous` is being replaced either way,
      // and leaving it undisposed would keep its updateJournalEntryPage hook and autosave alive.
      if (ok === false) {
        ui.notifications.warn(game.i18n.format("FCP.Doc.SaveFailed", { name: this.entry?.pages.get(this.pageId)?.name ?? "" }));
      }
      previous.dispose();
    }
    // A newer onRender landed while the above was in flight: this holder is now stale, leave the
    // mounting to that later call.
    if (token !== this.#renderToken || !holder.isConnected) return;

    const state = tab.querySelector(".fcp-save-state");
    const ctl = mountDocEditor(holder, page, {
      onState: s => {
        showSaveState(state, s);
        if (s === "saved") this.#fillToc(tab, ctl);
      },
      onRemoteChange: () => this.app.markDirty("notes")
    });
    this.editor = ctl;
    ctl.ready.then(() => {
      this.#fillToc(tab, ctl);
      if (this.focusNext) {
        this.focusNext = false;
        ctl.editor.focus();
      }
    });
  }

  /** Search runs in place, so typing never re-renders the tab and never drops the keyboard. */
  applyFilter(tab) {
    const results = tab.querySelector(".fcp-note-results");
    const browse = tab.querySelector(".fcp-note-browse");
    if (!results || !browse) return;
    const query = this.query.trim();
    results.hidden = !query;
    browse.hidden = !!query;
    let shown = 0;
    for (const li of results.querySelectorAll("li[data-name]")) {
      li.hidden = !matchesQuery(li.dataset.name, query);
      if (!li.hidden) shown++;
    }
    const none = results.querySelector(".fcp-note-none");
    if (none) none.hidden = !!shown;
  }

  /** Index of the page's headings; tapping one scrolls to it. Rebuilt from the live editor. */
  #fillToc(tab, ctl) {
    const toc = tab.querySelector(".fcp-note-toc");
    const list = toc?.querySelector(".fcp-note-toc-list");
    const content = ctl.content();
    if (!list || !content) return;
    const headings = Array.from(content.querySelectorAll("h1, h2, h3"));
    toc.hidden = !headings.length;
    list.replaceChildren(...headings.map((heading, i) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.action = "noteHeading";
      button.dataset.index = String(i);
      button.className = `fcp-toc-${heading.tagName.toLowerCase()}`;
      button.textContent = heading.textContent;
      return button;
    }));
  }

  scrollToHeading(index) {
    const heading = this.editor?.content()?.querySelectorAll("h1, h2, h3")[index];
    heading?.scrollIntoView({ behavior: "smooth", block: "start" });
    this.app.element?.querySelector(".fcp-note-toc")?.removeAttribute("open");
  }

  /* -------------------------------------------- */
  /*  Actions                                      */
  /* -------------------------------------------- */

  async flush() {
    return this.editor ? this.editor.flush() : true;
  }

  /** Save and drop the current editor before the view changes. */
  async #leaveEditor() {
    const ctl = this.editor;
    this.editor = null;
    if (!ctl) return;
    const ok = await ctl.flush();
    ctl.dispose();
    if (!ok) ui.notifications.warn(game.i18n.format("FCP.Doc.SaveFailed", { name: this.entry?.pages.get(this.pageId)?.name ?? "" }));
  }

  async open(entryId) {
    await this.#leaveEditor();
    this.entryId = entryId;
    this.pageId = null;
    await setSetting(SETTINGS.RECENT_NOTES, pushRecent(getSetting(SETTINGS.RECENT_NOTES), entryId));
    this.app.markDirty("notes");
  }

  async close() {
    await this.#leaveEditor();
    this.entryId = null;
    this.pageId = null;
    this.app.markDirty("notes");
  }

  async showPage(pageId) {
    await this.#leaveEditor();
    this.pageId = pageId;
    this.app.markDirty("notes");
  }

  toggleFolder(folderId) {
    if (this.openFolders.has(folderId)) this.openFolders.delete(folderId);
    else this.openFolders.add(folderId);
    this.app.markDirty("notes");
  }

  /** "+ Appunto": a new entry in the inbox folder, named after the date and time, open for writing. */
  async quickNote() {
    const folderName = game.i18n.localize("FCP.Notes.InboxFolder");
    let folder = game.folders.find(f => f.type === "JournalEntry" && f.name === folderName && !f.folder);
    folder ??= await Folder.implementation.create({ type: "JournalEntry", name: folderName });
    const name = quickNoteName(new Date(), game.i18n.lang);
    const entry = await JournalEntry.implementation.create({
      name,
      folder: folder.id,
      pages: [{ type: "text", name, text: { content: "" } }]
    });
    this.openFolders.add(folder.id);
    this.focusNext = true;
    await this.open(entry.id);
  }

  /**
   * An entry, page or journal folder was created, updated or deleted somewhere. Page updates are not
   * routed here: the editor syncs the text itself, and a re-render would interrupt the writing.
   */
  onDocumentChange(doc, { deleted = false } = {}) {
    if (doc.documentName === "Folder" && doc.type !== "JournalEntry") return;
    if (!this.entryId) return this.app.markDirty("notes");
    const entry = doc.documentName === "JournalEntryPage" ? doc.parent : doc;
    if (entry?.id !== this.entryId) return;
    if (deleted && doc.documentName === "JournalEntry") {
      this.editor?.dispose();
      this.editor = null;
      this.entryId = null;
    }
    this.app.markDirty("notes");
  }
}
