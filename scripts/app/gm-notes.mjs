import { SETTINGS, warn } from "../constants.mjs";
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

  /** Bumped only when a mount is actually launched: an in-flight remount checks it to tell whether a
   *  later mount has superseded it. Must not be bumped by app renders that never reach that point (a
   *  chat message re-rendering "nav" must not make an in-flight mount think it was superseded). */
  #renderToken = 0;

  /**
   * Serializes editor handoffs across overlapping remounts of the notes tab. Every #mount that finds
   * a previous editor chains its wait-for-pending-then-dispose onto this promise; every #mount call -
   * whether or not it captured a previous editor itself - awaits it before reading page content, so a
   * second remount arriving while the first is still tearing down never mounts from stale text.
   */
  #handoff = Promise.resolve();

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
    // Bumped only now that a mount is actually launched: a render that never reaches this point (e.g.
    // a chat message re-rendering just "nav") must not make an in-flight mount think it was superseded.
    const token = ++this.#renderToken;
    // Launched, not awaited: a re-render arriving while this is in flight must not break _onRender.
    this.#mount(token, tab, holder, page).catch(err => {
      warn("failed to mount the note editor", err);
      ui.notifications.error(String(err.message ?? err));
    });
  }

  /**
   * Mount a fresh editor for `page`. If an editor is already mounted (a remount of the same tab, e.g.
   * from a remote change), its wait-for-pending-then-dispose is chained onto `#handoff`; every call -
   * whether or not it captured a previous editor itself - awaits that same chain before reading
   * `page.text.content`, so an overlapping remount can never mount from stale text (ruling 1: only
   * after the previous editor's flush has actually landed). `token` guards against a newer onRender
   * superseding this one while the await is in flight - the holder it targets may by then be detached,
   * and a later mount already owns `this.editor`.
   */
  async #mount(token, tab, holder, page) {
    const previous = this.editor;
    if (previous) {
      this.editor = null;
      // Captured now, not after the await below: by the time it resolves, this.pageId may already
      // belong to the editor that superseded `previous`.
      const previousName = this.entry?.pages.get(this.pageId)?.name ?? "";
      // Always warn and dispose, even if superseded below: `previous` is being replaced either way,
      // and leaving it undisposed would keep its updateJournalEntryPage hook and autosave alive.
      this.#handoff = this.#handoff.then(async () => {
        const ok = await previous.pending;
        if (ok === false) ui.notifications.warn(game.i18n.format("FCP.Doc.SaveFailed", { name: previousName }));
        previous.dispose();
      }).catch(err => {
        // A failed handoff must not block every later mount: they all await this chain.
        warn("failed to hand off the note editor", err);
        previous.dispose();
      });
    }
    // Every mount - even one that captured no previous editor itself, because an earlier mount already
    // cleared this.editor - waits for the same chain, so it never reads page content before whatever
    // editor was actually showing has been flushed and disposed.
    await this.#handoff;

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
      // This editor may have been disposed (or replaced) while it was still opening.
      if (this.editor !== ctl) return;
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

  /** The companion is closing: save, then drop the editor so its hook and timer do not outlive it. */
  async dispose() {
    await this.#leaveEditor();
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
    if (!this.entryId) {
      // The list shows entries and folders only: a page changing elsewhere never affects it.
      if (doc.documentName === "JournalEntryPage") return;
      // Typing in the search field must not be interrupted by an unrelated create/update/delete
      // elsewhere and lose the keyboard; the list catches up on whatever render happens next.
      if (this.app.element?.querySelector("input[name=noteQuery]") === document.activeElement) return;
      return this.app.markDirty("notes");
    }
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
