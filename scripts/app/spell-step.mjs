/**
 * Class spells, Baldur's Gate 3 style (dnd5e 2024).
 *
 * The 2024 classes in dnd5e have no "choose spells" step in their advancement, so after a level up a caster is left
 * with the whole compendium and no idea how many spells they get. This window shows one class's own list, grouped by
 * level up to the highest slot the character can cast, with counters that come from the class itself: cantrips known
 * (scale value) and prepared spells (the class's preparation max). Tapping a spell learns or prepares it; nothing
 * changes on the actor until "Confirm".
 *
 * Wizards keep a spellbook: a spell is first copied into the book, then prepared from it (tap cycles new → book →
 * prepared). Everyone else prepares straight from the class list. Always-prepared spells (subclass, feats) are shown
 * but locked and do not count, as on the sheet.
 *
 * It opens by itself when a level up of a caster class ends (any client: phone or desktop), from the companion's
 * spellbook, and from the desktop character sheet's header menu.
 */
import { MODULE_ID, log } from "../constants.mjs";

const t = key => game.i18n.localize(key);
const f = (key, data) => game.i18n.format(key, data);
const escape = s => foundry.utils.escapeHTML(String(s ?? ""));
const fold = s => String(s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/* ---------------- Rules data ---------------- */

/**
 * Third casters (2024) cast from another class's list and have no list of their own.
 * Their cantrips are a scale value only on some versions of the class data: these are the book's numbers.
 */
const THIRD_CASTERS = {
  "eldritch-knight": { list: "wizard", cantrips: { 3: 2, 10: 3 } },
  // The 2024 Player's Handbook calls it "trickster"; the long form covers compendiums that spell it out.
  trickster: { list: "wizard", cantrips: { 3: 2, 10: 3 } },
  "arcane-trickster": { list: "wizard", cantrips: { 3: 2, 10: 3 } }
};

/** Highest spell level a class reaches on its own (2024 tables), for multiclass characters. */
const OWN_MAX_LEVEL = {
  full: level => Math.min(9, Math.ceil(level / 2)),
  half: level => Math.min(5, Math.ceil(level / 4)),
  artificer: level => Math.min(5, Math.ceil(level / 4)),
  third: level => byLevel({ 3: 1, 7: 2, 13: 3, 19: 4 }, level) ?? 0
};

/** A class casts when it or its subclass has a spellcasting progression. */
export function isCaster(cls) {
  return [cls, cls?.subclass].some(i => i && (i.system.spellcasting?.progression ?? "none") !== "none");
}

/**
 * Spellcasting classes of an actor, each with the list it draws from and its counters.
 * The class's own list comes first: a subclass list (domain, oath, patron) is a bonus list of always-prepared spells,
 * not the one to choose from.
 */
export function spellSources(actor) {
  const lists = globalThis.dnd5e?.registry?.spellLists;
  if (!lists || actor?.type !== "character") return [];
  const out = [];
  const multiclass = Object.values(actor.classes ?? {}).filter(isCaster).length > 1;
  for (const cls of Object.values(actor.classes ?? {})) {
    const sub = cls.subclass;
    const caster = [sub, cls].find(i => i && (i.system.spellcasting?.progression ?? "none") !== "none");
    if (!caster) continue;
    const third = THIRD_CASTERS[sub?.identifier];
    const found = lists.forType("class", cls.identifier) ?? (third && lists.forType("class", third.list));
    if (!found) continue;
    const pact = caster.system.spellcasting?.type === "pact";
    // The slot table is the whole character's: a Wizard 1 / Cleric 5 has 3rd-level slots but learns 1st-level wizard spells.
    let maxLevel = maxSpellLevel(actor, pact);
    const own = OWN_MAX_LEVEL[caster.system.spellcasting?.progression];
    if (multiclass && !pact && own) maxLevel = Math.min(maxLevel, own(cls.system.levels));
    out.push({
      cls, sub, caster, list: found, pact,
      book: cls.identifier === "wizard",
      // Spells are tied to their class by sourceItem; third casters' spells may point at the subclass.
      tags: new Set([`class:${cls.identifier}`, sub && `subclass:${sub.identifier}`].filter(Boolean)),
      cantrips: cantripsKnown(actor, cls, sub) ?? byLevel(third?.cantrips, cls.system.levels),
      prepared: caster.system.spellcasting?.preparation?.max ?? null,
      maxLevel
    });
  }
  return out;
}

/** "Cantrips known" is a scale value; its identifier is not always set, so look for it by name in both scales. */
function cantripsKnown(actor, cls, sub) {
  for (const id of [sub?.identifier, cls.identifier]) {
    const scale = id && actor.system.scale?.[id];
    if (!scale) continue;
    const key = Object.keys(scale).find(k => /cantrip|trucchett/i.test(k));
    const value = key && Number(scale[key]?.value ?? scale[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

/** Value of a { level: value } table at a class level, as a scale value reads (last step at or below it). */
function byLevel(table, level) {
  if (!table) return null;
  const steps = Object.keys(table).map(Number).filter(l => l <= level);
  return steps.length ? table[Math.max(...steps)] : null;
}

/** Highest spell level the actor can cast right now from this kind of slots (pact or leveled). */
function maxSpellLevel(actor, pact) {
  const spells = actor.system.spells ?? {};
  if (pact) return spells.pact?.max ? (spells.pact.level ?? 1) : 0;
  for (let lvl = 9; lvl >= 1; lvl--) if (spells[`spell${lvl}`]?.max) return lvl;
  return 0;
}

/** 2024 wizard: six level 1 spells in the book at level 1, two more each level. */
const bookSize = level => 4 + 2 * level;

/** Same spell, whether it came from the Italian or the English compendium: the identifier is shared. */
const spellKey = doc => doc.system?.identifier || fold(doc.name);

/* ---------------- Window ---------------- */

let current = null;

/** Open the class spells window for one class of the actor (the first caster class when omitted). */
export async function openSpellStep(actor, classId) {
  if (!hasAllSources(actor, classId)) ui.notifications.info(t("FCP.Spells.Waiting"));
  const sources = await waitForSources(actor, classId);
  const source = sources.find(s => s.cls.id === classId) ?? (classId ? null : sources[0]);
  if (!source) {
    ui.notifications.info(t("FCP.Spells.NoCaster"));
    return null;
  }
  current?.close();
  current = new SpellStep(actor, source);
  return current.open();
}

/** Classes already waited for in vain (homebrew without a list): do not poll again on every sheet render. */
const missing = new Set();

/** Whether the lists of the wanted class (or of every casting class) are already there. */
function hasAllSources(actor, classId = null) {
  const found = new Set(spellSources(actor).map(s => s.cls.id));
  const wanted = classId ? [classId] : Object.values(actor?.classes ?? {}).filter(isCaster).map(c => c.id);
  return wanted.every(id => found.has(id) || missing.has(`${actor.id}.${id}`));
}

/**
 * dnd5e fills the spell list registry after "ready", page by page, and on this world it never reports itself ready
 * (`dnd5e.registry.ready` stays pending), so wait for the lists themselves: a few seconds at most after a page load.
 * A multiclass caster waits for every class's list (or the one asked for), not just the first that shows up.
 */
async function waitForSources(actor, classId = null) {
  for (let i = 0; !hasAllSources(actor, classId) && i < 40; i++) {
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const sources = spellSources(actor);
  const found = new Set(sources.map(s => s.cls.id));
  for (const cls of Object.values(actor?.classes ?? {})) {
    if (isCaster(cls) && !found.has(cls.id)) missing.add(`${actor.id}.${cls.id}`);
  }
  return sources;
}

class SpellStep {
  constructor(actor, source) {
    this.actor = actor;
    this.source = source;
    this.root = null;
    this.rows = [];
    this.query = "";
  }

  /* ----- Data ----- */

  async load() {
    const { list, maxLevel } = this.source;
    // Level and school are not in the list's index: read them from each pack's index.
    const byPack = new Map();
    for (const e of list.indexes) {
      if (!byPack.has(e.pack)) byPack.set(e.pack, []);
      byPack.get(e.pack).push(e);
    }
    const entries = [];
    for (const [packId, list] of byPack) {
      const pack = game.packs.get(packId);
      if (!pack) continue;
      const index = await pack.getIndex({ fields: ["system.level", "system.school", "system.identifier"] });
      for (const e of list) {
        const full = index.get(e._id);
        if (full) entries.push({ ...full, uuid: e.uuid });
      }
    }

    const owned = new Map();
    for (const item of this.actor.items) {
      if (item.type !== "spell" || !this.source.tags.has(item.system.sourceItem)) continue;
      owned.set(spellKey(item), item);
    }

    const seen = new Set();
    this.rows = [];
    for (const e of entries) {
      const key = spellKey(e);
      const level = e.system?.level ?? 0;
      if (seen.has(key)) continue;
      const item = owned.get(key);
      // Spells above the castable level stay hidden, unless the character already has them.
      if (level > maxLevel && !item) continue;
      seen.add(key);
      this.rows.push(this.#row(e.uuid, e.name, e.img, level, e.system?.school, item, e.system?.identifier));
    }
    // Class spells on the sheet that are not on the list (another book, a homebrew): shown, never touched.
    for (const [key, item] of owned) {
      if (seen.has(key)) continue;
      this.rows.push({ ...this.#row(item.uuid, item.name, item.img, item.system.level ?? 0, item.system.school, item, item.system.identifier), locked: true });
    }
    this.rows.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name, game.i18n.lang));
  }

  #row(uuid, name, img, level, school, item, identifier) {
    const prepared = item?.system.prepared ?? 0;
    // Always prepared first: a cantrip granted by the subclass is locked and does not count, like a leveled spell.
    const state = !item ? "none" : prepared === 2 ? "always" : level === 0 ? "known" : prepared ? "prepared" : "book";
    // The search also knows the English name, from the identifier ("faerie-fire" finds Luminescenza).
    const search = fold(`${name} ${String(identifier ?? "").replaceAll("-", " ")}`);
    return { uuid, name, img, level, school, item, search, from: state, state, locked: state === "always" };
  }

  /* ----- Counters ----- */

  counts() {
    const rows = this.rows;
    const cantrips = rows.filter(r => r.level === 0 && r.state === "known").length;
    const prepared = rows.filter(r => r.level > 0 && r.state === "prepared").length;
    const book = rows.filter(r => r.level > 0 && ["book", "prepared"].includes(r.state)).length;
    return { cantrips, prepared, book };
  }

  limits() {
    const { cantrips, prepared, book, cls } = this.source;
    return { cantrips, prepared, book: book ? bookSize(cls.system.levels) : null };
  }

  /** Which way a tap moves a spell, or a reason it cannot. */
  next(row) {
    if (row.locked) return null;
    const c = this.counts();
    const l = this.limits();
    if (row.level === 0) {
      if (row.state === "known") return { state: "none" };
      if (l.cantrips != null && c.cantrips >= l.cantrips) return { warn: f("FCP.Spells.FullCantrips", { max: l.cantrips }) };
      return { state: "known" };
    }
    const fullPrepared = l.prepared != null && c.prepared >= l.prepared;
    if (!this.source.book) {
      // Unpreparing keeps a spell that was on the sheet (prepared 0, as the sheet does); a new one just goes away.
      if (row.state === "prepared") return { state: row.from === "none" ? "none" : "book" };
      if (fullPrepared) return { warn: f("FCP.Spells.FullPrepared", { max: l.prepared }) };
      return { state: "prepared" };
    }
    // Wizard: new → book → prepared → (back to the book, or out if it was copied just now).
    if (row.state === "none") return { state: "book" };
    if (row.state === "book") {
      if (fullPrepared) return row.from === "none" ? { state: "none" } : { warn: f("FCP.Spells.FullPrepared", { max: l.prepared }) };
      return { state: "prepared" };
    }
    return { state: row.from === "none" ? "none" : "book" };
  }

  changes() {
    return this.rows.filter(r => r.state !== r.from);
  }

  /* ----- Render ----- */

  async open() {
    const root = this.root = document.createElement("section");
    root.id = "fcp-picker";
    root.className = "fcp-ss";
    root.innerHTML = `<p class="fcp-picker-loading">${escape(t("FCP.Picker.Loading"))}</p>`;
    document.body.append(root);
    try {
      await this.load();
    } catch (err) {
      console.error(`${MODULE_ID} | class spells failed to load`, err);
      if (this.root) ui.notifications.error(t("FCP.Spells.LoadError"));
      this.close();
      return null;
    }
    // Closed while loading (a second tap opened another one): nothing to draw.
    if (!this.root) return null;
    this.render();
    return this;
  }

  close() {
    this.root?.remove();
    this.root = null;
    if (current === this) current = null;
  }

  render() {
    const { cls, sub } = this.source;
    const clsName = sub && this.source.caster === sub ? `${cls.name} · ${sub.name}` : cls.name;
    this.root.innerHTML = `
      <header class="fcp-pk-head">
        <div class="fcp-pk-title">
          <span class="fcp-pk-kicker">${escape(f("FCP.Spells.Kicker", { cls: clsName, n: cls.system.levels }))}</span>
          <h2>${escape(this.actor.name)}</h2>
        </div>
        <div class="fcp-ss-counters"></div>
        <p class="fcp-ss-help">${escape(t(this.source.book ? "FCP.Spells.HelpBook" : "FCP.Spells.Help"))}</p>
        <input type="search" class="fcp-pk-search" placeholder="${escape(t("FCP.Picker.Search"))}" autocomplete="off">
      </header>
      <div class="fcp-pk-list"></div>
      <footer class="fcp-pk-foot">
        <span class="fcp-pk-count"></span>
        <button type="button" data-cancel>${escape(t("FCP.Picker.Cancel"))}</button>
        <button type="button" class="fcp-primary" data-confirm>${escape(t("FCP.Picker.Confirm"))}</button>
      </footer>`;
    this.renderList();
    this.renderCounters();

    const root = this.root;
    root.querySelector(".fcp-pk-search").addEventListener("input", event => {
      this.query = event.target.value;
      this.renderList();
    });
    root.querySelector("[data-cancel]").addEventListener("click", () => this.close());
    root.querySelector("[data-confirm]").addEventListener("click", () => this.apply());
    root.querySelector(".fcp-pk-list").addEventListener("click", event => this.#onClick(event));
  }

  renderCounters() {
    const c = this.counts();
    const l = this.limits();
    const chip = (label, n, max, soft) => {
      const over = max != null && n > max;
      const left = max != null && n < max;
      const cls = over ? (soft ? "warn" : "over") : left ? "open" : "full";
      return `<span class="fcp-ss-chip ${cls}"><b>${n}${max != null ? `/${max}` : ""}</b> ${escape(label)}</span>`;
    };
    const chips = [];
    if (l.cantrips != null || c.cantrips) chips.push(chip(t("FCP.Spells.Cantrips"), c.cantrips, l.cantrips));
    if (l.book != null) chips.push(chip(t("FCP.Spells.Book"), c.book, l.book, true));
    if (l.prepared != null || c.prepared) chips.push(chip(t("FCP.Spells.Prepared"), c.prepared, l.prepared));
    this.root.querySelector(".fcp-ss-counters").innerHTML = chips.join("");

    // Footer: what is still to choose, as in BG3 ("2 spells left to learn").
    const todo = [];
    if (l.cantrips != null && c.cantrips < l.cantrips) todo.push(f("FCP.Spells.LeftCantrips", { n: l.cantrips - c.cantrips }));
    if (l.book != null && c.book < l.book) todo.push(f("FCP.Spells.LeftBook", { n: l.book - c.book }));
    if (l.prepared != null && c.prepared < l.prepared) todo.push(f("FCP.Spells.LeftPrepared", { n: l.prepared - c.prepared }));
    const n = this.changes().length;
    const text = todo.length ? todo.join(" · ") : t("FCP.Spells.AllChosen");
    this.root.querySelector(".fcp-pk-count").textContent = n ? `${text} — ${f("FCP.Spells.Changes", { n })}` : text;
    this.root.querySelector("[data-confirm]").disabled = !n
      || (l.cantrips != null && c.cantrips > l.cantrips) || (l.prepared != null && c.prepared > l.prepared);
  }

  /**
   * Two blocks, as BG3 keeps known spells apart from the list: the character's spells first (what they had plus
   * what they just picked, and what they are about to drop, crossed out), then everything still to choose.
   */
  renderList() {
    const q = fold(this.query);
    const rows = q ? this.rows.filter(r => r.search.includes(q)) : this.rows;
    const mine = rows.filter(r => this.isMine(r));
    const rest = rows.filter(r => !this.isMine(r));
    const byLevel = list => {
      const groups = new Map();
      for (const r of list) {
        if (!groups.has(r.level)) groups.set(r.level, []);
        groups.get(r.level).push(r);
      }
      return [...groups].map(([lvl, g]) =>
        `<h4 class="fcp-pk-group">${escape(CONFIG.DND5E.spellLevels?.[lvl] ?? lvl)}</h4><ul>${g.map(r => this.rowHtml(r)).join("")}</ul>`
      ).join("");
    };
    const section = (key, list, empty) => `<section class="fcp-ss-section fcp-ss-${key}">
      <h3 class="fcp-ss-title">${escape(t(`FCP.Spells.Section.${key}`))}</h3>
      ${list.length ? byLevel(list) : `<p class="fcp-pk-empty">${escape(t(empty))}</p>`}
    </section>`;
    const el = this.root.querySelector(".fcp-pk-list");
    const scroll = el.scrollTop;
    el.innerHTML = section("Mine", mine, "FCP.Spells.NoneMine") + section("Choose", rest, "FCP.Picker.Empty");
    el.scrollTop = scroll;
  }

  isMine(r) {
    return r.from !== "none" || r.state !== "none";
  }

  rowHtml(r) {
    const school = CONFIG.DND5E.spellSchools?.[r.school]?.label;
    const changed = r.state !== r.from;
    return `<li class="fcp-pk-row fcp-ss-row is-${r.state}${changed ? " changed" : ""}${r.locked ? " locked" : ""}" data-uuid="${escape(r.uuid)}">
      <button type="button" class="fcp-pk-choose" data-pick ${r.locked ? "disabled" : ""}>
        <img src="${escape(r.img)}" alt="">
        <span class="fcp-pk-text">
          <span class="fcp-pk-name">${escape(r.name)}</span>
          ${school ? `<span class="fcp-pk-sub">${escape(school)}</span>` : ""}
        </span>
        <span class="fcp-ss-state">${escape(this.stateLabel(r))}</span>
      </button>
      <button type="button" class="fcp-pk-info" data-info aria-label="${escape(t("FCP.Picker.Details"))}">i</button>
      <div class="fcp-pk-desc" hidden></div>
    </li>`;
  }

  stateLabel(r) {
    const isNew = r.from === "none" && r.state !== "none";
    switch (r.state) {
      case "known": return t(isNew ? "FCP.Spells.State.NewKnown" : "FCP.Spells.State.Known");
      case "always": return t("FCP.Spells.State.Always");
      case "prepared": return t(isNew ? "FCP.Spells.State.NewPrepared" : "FCP.Spells.State.Prepared");
      case "book": return t(this.source.book ? (isNew ? "FCP.Spells.State.NewBook" : "FCP.Spells.State.Book") : "FCP.Spells.State.Unprepared");
      default: return r.from !== "none" ? t("FCP.Spells.State.Forget") : "";
    }
  }

  async #onClick(event) {
    const li = event.target.closest("[data-uuid]");
    if (!li) return;
    const row = this.rows.find(r => r.uuid === li.dataset.uuid);
    if (!row) return;
    if (event.target.closest("[data-info]")) return toggleDescription(li, row.item?.uuid ?? row.uuid);
    if (!event.target.closest("[data-pick]")) return;
    const step = this.next(row);
    if (!step) return;
    if (step.warn) return ui.notifications.warn(step.warn);
    const moved = this.isMine(row) !== this.isMine({ ...row, state: step.state });
    row.state = step.state;
    // A spell picked or dropped changes block: redraw the list. Otherwise only the touched row changes,
    // so an open description stays open.
    if (moved) {
      this.renderList();
      this.renderCounters();
      return;
    }
    // Only the touched row changes: re-rendering the whole list would jump the scroll.
    const desc = li.querySelector(".fcp-pk-desc");
    const tmp = document.createElement("template");
    tmp.innerHTML = this.rowHtml(row).trim();
    const fresh = tmp.content.firstElementChild;
    fresh.querySelector(".fcp-pk-desc").replaceWith(desc);
    li.replaceWith(fresh);
    this.renderCounters();
  }

  /* ----- Apply ----- */

  /**
   * Turn the choices into document changes, all at once: new spells created as the sheet would (tied to the class,
   * prepared or not), prepared switched in place, forgotten cantrips and spells removed.
   */
  async apply() {
    const button = this.root.querySelector("[data-confirm]");
    button.disabled = true;
    const update = [];
    const remove = [];
    const added = [];
    const method = this.source.pact ? "pact" : "spell";
    for (const r of this.changes()) {
      if (r.state === "none") {
        if (r.item) remove.push(r.item.id);
        continue;
      }
      const prepared = r.state === "prepared" ? 1 : 0;
      if (r.item) update.push({ _id: r.item.id, "system.prepared": prepared });
      else added.push({ r, prepared });
    }
    try {
      const docs = await Promise.all(added.map(({ r }) => fromUuid(r.uuid)));
      const create = [];
      added.forEach(({ r, prepared }, i) => {
        if (!docs[i]) return;
        const item = game.items.fromCompendium(docs[i]);
        // dnd5e 6: method and prepared drive the "prepared" counter; sourceItem ties the spell to its class.
        if (r.level > 0) {
          item.system.method = method;
          item.system.prepared = prepared;
        }
        item.system.sourceItem = `class:${this.source.cls.identifier}`;
        create.push(item);
      });
      // New spells first, removals last: if a step fails the character may have one spell too many, never one too few.
      if (create.length) await this.actor.createEmbeddedDocuments("Item", create);
      if (update.length) await this.actor.updateEmbeddedDocuments("Item", update);
      if (remove.length) await this.actor.deleteEmbeddedDocuments("Item", remove);
    } catch (err) {
      console.error(`${MODULE_ID} | class spells failed to apply`, err);
      ui.notifications.error(t("FCP.Spells.ApplyError"));
      // Part of it may have gone through: show the sheet as it is now, so a retry starts from the truth.
      if (this.root) {
        await this.load().catch(() => null);
        if (this.root) this.render();
      }
      return;
    }
    ui.notifications.info(f("FCP.Spells.Done", { name: this.actor.name }));
    this.close();
  }
}

async function toggleDescription(li, uuid) {
  const box = li.querySelector(".fcp-pk-desc");
  if (!box.hidden) { box.hidden = true; return; }
  box.hidden = false;
  if (box.dataset.loaded) return;
  box.textContent = t("FCP.Picker.Loading");
  const doc = await fromUuid(uuid);
  const TE = foundry.applications.ux.TextEditor.implementation;
  box.innerHTML = doc ? await TE.enrichHTML(doc.system?.description?.value ?? "", { relativeTo: doc }) : "";
  box.dataset.loaded = "1";
}

/* ---------------- Entry points ---------------- */

let installed = false;

/**
 * Opens by itself at the end of a level up of a caster class, and adds "Class spells" to the character sheet's
 * header menu. Every client: the level up may run on a desktop as well as on a phone.
 */
export function installSpellStep() {
  if (installed || game.system.id !== "dnd5e") return;
  installed = true;

  Hooks.on("dnd5e.advancementManagerComplete", manager => {
    const actor = manager.actor;
    if (!actor?.isOwner || actor.type !== "character") return;
    // Only a class going up: its forward steps carry it (`step.class.item`, on the clone). Feats, backgrounds,
    // species, level downs and deleted classes have no such step and must not pop the window up.
    const clsId = manager.steps?.find(s => (s.type === "forward") && s.class?.item)?.class.item.id;
    const id = clsId && actor.items.get(clsId)?.type === "class" ? clsId : null;
    if (!id) return;
    // Let the sheet settle on the new level (slots, scale values) before reading the counters.
    setTimeout(() => {
      const sources = spellSources(actor);
      if (sources.some(s => s.cls.id === id)) openSpellStep(actor, id);
    }, 250);
  });

  // In the sheet's Spells tab, under each class's spellcasting card (the one showing "prepared 4/7"): where players
  // look for it. The lists may still be loading right after a page load, hence the wait.
  Hooks.on("renderCharacterActorSheet", async (sheet, element) => {
    const actor = sheet.actor;
    if (!actor?.isOwner) return;
    const sources = await waitForSources(actor);
    const cards = [...element.querySelectorAll('.tab[data-tab="spells"] .spellcasting.card')];
    for (const s of sources) {
      const card = cards.length === 1 && sources.length === 1 ? cards[0]
        : cards.find(c => c.querySelector(".header h3")?.textContent.includes(s.cls.name));
      if (!card || card.querySelector(".fcp-ss-open")) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "fcp-ss-open";
      button.innerHTML = `<i class="fa-solid fa-book-sparkles"></i> ${escape(t("FCP.D5.AddSpells"))}`;
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        openSpellStep(actor, s.cls.id);
      });
      card.append(button);
    }
  });

  Hooks.on("getHeaderControlsCharacterActorSheet", (sheet, controls) => {
    const actor = sheet.actor;
    if (!actor?.isOwner) return;
    const sources = spellSources(actor);
    for (const s of sources) {
      controls.push({
        icon: "fa-solid fa-book-sparkles",
        label: sources.length > 1 ? f("FCP.Spells.OpenClass", { cls: s.cls.name }) : t("FCP.Spells.Open"),
        action: `fcpClassSpells-${s.cls.id}`,
        onClick: () => openSpellStep(actor, s.cls.id)
      });
    }
  });
  log("class spells step installed");
}
