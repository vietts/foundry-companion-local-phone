import { MODULE_ID, SETTINGS, TABS, GM_TABS, warn } from "../constants.mjs";
import { getSetting, setSetting } from "../settings.mjs";
import { activeScene, actorTokens, ownedTokens, visibleMinimapTokens, shiftedPosition, positionAtCenter } from "../movement.mjs";
import { requestMove, requestPlay } from "../socket.mjs";
import { vfxApi, hasEffect, resolveActionId } from "../vfx.mjs";
import { filterCandidates, orderCandidates, isExplored, pruneTargets, failureKey } from "./targets-data.mjs";
import { FOG_FLAG } from "../fog.mjs";
import { GmNotes } from "./gm-notes.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
const T = `modules/${MODULE_ID}/templates/parts`;
const VIDEO_RE = /\.(webm|mp4|m4v|ogv|ogg)(\?.*)?$/i;
/** Tablet layout: the sheet stays on the left, the other tabs open on the right. Phones in landscape stay single-column. */
const WIDE_QUERY = "(min-width: 740px) and (min-height: 500px)";

/** Parts that do not exist in each mode: the GM has no character, players have no notes. */
const GM_HIDDEN_PARTS = ["sheet", "actions", "inventory", "map"];
const PLAYER_HIDDEN_PARTS = ["notes"];

const TAB_ICONS = {
  sheet: "ph-duotone ph-scroll",
  actions: "ph-duotone ph-sword",
  inventory: "ph-duotone ph-backpack",
  chat: "ph-duotone ph-chat-teardrop-text",
  map: "ph-duotone ph-compass",
  notes: "ph-duotone ph-scroll"
};

export class CompanionApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(adapter, options = {}) {
    super(options);
    this.adapter = adapter;
    this.notes = game.user.isGM ? new GmNotes(this) : null;
    const lastTab = getSetting(SETTINGS.LAST_TAB);
    this.activeTab = this.tabs.includes(lastTab) ? lastTab : this.tabs[0];
    this.step = 1;
    this.tokenId = null;
    this.mapTarget = null;
    this.unreadChat = 0;
    this._chatCache = new Map();
    this._actorId = getSetting(SETTINGS.LAST_ACTOR) || null;
    this.expandedItems = new Set();
    this.pin = null;
    this.sheetPane = "stats";
    this.condPicker = false;
    this.spellQuery = "";
    this.spellFilter = "all";
    /** Tokens targeted from the phone. Without a canvas `game.user.targets` stays empty, so the ids live here. */
    this.targetIds = new Set();
    this.wideQuery = window.matchMedia?.(WIDE_QUERY) ?? null;
    this.#onWideChange = () => this.render();
  }

  #onWideChange;

  /** Two columns (tablet): the sheet is always shown, so the active tab is one of the others. */
  get wide() {
    return !!this.wideQuery?.matches;
  }

  /** The GM gets notes and chat instead of a character. */
  get gmMode() {
    return !!this.notes;
  }

  get tabs() {
    return this.gmMode ? GM_TABS : TABS;
  }

  /** The tab pinned to the left column in two columns: the sheet, or the GM's notes. */
  get primaryTab() {
    return this.gmMode ? "notes" : "sheet";
  }

  /** The tab the header describes: in two columns it heads the sheet column. */
  get headerTab() {
    return this.wide ? this.primaryTab : this.activeTab;
  }

  /** Digital dice off = reference mode: nothing rolls, items open their text. */
  get diceEnabled() {
    return !!getSetting(SETTINGS.DIGITAL_DICE);
  }

  static DEFAULT_OPTIONS = {
    id: "fcp-app",
    tag: "section",
    classes: ["fcp"],
    window: { frame: false, positioned: false },
    actions: {
      // "tab" is reserved: ApplicationV2 handles data-action="tab" itself and throws without a tab group.
      switchTab: CompanionApp.#onTab,
      selectActor: CompanionApp.#onSelectActor,
      refresh: CompanionApp.#onRefresh,
      exitCompanion: CompanionApp.#onExit,
      logOut: CompanionApp.#onLogOut,
      hpDelta: CompanionApp.#onHpDelta,
      hpApply: CompanionApp.#onHpApply,
      counter: CompanionApp.#onAdapterAction,
      pin: CompanionApp.#onPin,
      setMode: CompanionApp.#onSetMode,
      roll: CompanionApp.#onAdapterAction,
      useItem: CompanionApp.#onAdapterAction,
      toggleItem: CompanionApp.#onAdapterAction,
      rest: CompanionApp.#onAdapterAction,
      spendUse: CompanionApp.#onAdapterAction,
      endConcentration: CompanionApp.#onAdapterAction,
      switchPane: CompanionApp.#onSwitchPane,
      togglePicker: CompanionApp.#onTogglePicker,
      spellFilter: CompanionApp.#onSpellFilter,
      expandItem: CompanionApp.#onExpandItem,
      toggleStatus: CompanionApp.#onToggleStatus,
      quickRoll: CompanionApp.#onQuickRoll,
      customRoll: CompanionApp.#onCustomRoll,
      sendChat: CompanionApp.#onSendChat,
      move: CompanionApp.#onMove,
      mapTap: CompanionApp.#onMapTap,
      stepToggle: CompanionApp.#onStepToggle,
      selectToken: CompanionApp.#onSelectToken,
      toggleTarget: CompanionApp.#onToggleTarget,
      clearTargets: CompanionApp.#onClearTargets,
      playVfx: CompanionApp.#onPlayVfx,
      openNote: CompanionApp.#onOpenNote,
      closeNote: CompanionApp.#onCloseNote,
      notePage: CompanionApp.#onNotePage,
      toggleFolder: CompanionApp.#onToggleFolder,
      quickNote: CompanionApp.#onQuickNote,
      noteHeading: CompanionApp.#onNoteHeading,
      noop: () => {}
    }
  };

  static PARTS = {
    header: { template: `${T}/header.hbs` },
    notes: { template: `${T}/notes.hbs`, scrollable: [""] },
    sheet: { template: `${T}/sheet.hbs`, scrollable: [""] },
    actions: { template: `${T}/items.hbs`, scrollable: [""] },
    inventory: { template: `${T}/items.hbs`, scrollable: [""] },
    chat: { template: `${T}/chat.hbs`, scrollable: [""] },
    map: { template: `${T}/map.hbs`, scrollable: [""] },
    nav: { template: `${T}/nav.hbs` }
  };

  /* -------------------------------------------- */
  /*  State                                        */
  /* -------------------------------------------- */

  get actors() {
    return this.adapter.playableActors();
  }

  get actor() {
    if (this.gmMode) return null;
    const actors = this.actors;
    let actor = actors.find(a => a.id === this._actorId);
    actor ??= actors.find(a => a.id === game.user.character?.id) ?? actors[0] ?? null;
    if (actor && actor.id !== this._actorId) {
      this._actorId = actor.id;
      setSetting(SETTINGS.LAST_ACTOR, actor.id);
    }
    return actor;
  }

  get token() {
    if (this.gmMode) return null;
    const scene = activeScene();
    if (!scene) return null;
    const mine = actorTokens(this.actor, scene);
    const choices = mine.length ? mine : ownedTokens(scene);
    return choices.find(t => t.id === this.tokenId) ?? choices[0] ?? null;
  }

  /** Re-render only some parts, coalescing bursts of updates. */
  refreshParts = foundry.utils.debounce(() => {
    if (!this._dirty.size) return;
    if (!this.rendered) {
      // Mid-render (or not rendered yet): try again shortly instead of dropping the update.
      if (this.state === CompanionApp.RENDER_STATES.RENDERING) setTimeout(() => this.refreshParts(), 120);
      return;
    }
    const parts = Array.from(this._dirty);
    this._dirty.clear();
    this.render({ parts });
  }, 80);

  _dirty = new Set();

  markDirty(...parts) {
    const hidden = this.gmMode ? GM_HIDDEN_PARTS : PLAYER_HIDDEN_PARTS;
    for (const p of parts) if (!hidden.includes(p)) this._dirty.add(p);
    this.refreshParts();
  }

  /** @override */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    for (const id of this.gmMode ? GM_HIDDEN_PARTS : PLAYER_HIDDEN_PARTS) delete parts[id];
    return parts;
  }

  /* -------------------------------------------- */
  /*  Rendering                                    */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    // Two columns: the primary tab is always shown on the left, so the right column opens on
    // Actions for players (as before GM notes) and on Chat for the GM.
    if (this.wide && this.activeTab === this.primaryTab) this.activeTab = this.gmMode ? "chat" : "actions";
    const actor = this.actor;
    const actors = this.actors.map(a => ({ id: a.id, name: a.name, img: a.img, active: a.id === actor?.id }));
    const header = actor ? await this.adapter.prepareHeader(actor) : { hp: null, stats: [] };
    const panes = actor ? (this.adapter.sheetPanes?.() ?? null) : null;
    const conditions = actor ? this.adapter.conditions(actor) : [];
    if (panes && !panes.some(p => p.key === this.sheetPane)) this.sheetPane = panes[0]?.key;
    return {
      panes: panes?.map(p => ({ ...p, active: p.key === this.sheetPane })) ?? null,
      actor: actor ? { id: actor.id, name: actor.name, img: actor.img, subtitle: this.adapter.subtitle(actor) } : null,
      actors,
      header,
      headerInfo: this.#headerInfo(actor, header),
      dice: this.diceEnabled,
      conditions,
      conditionsActive: conditions.some(c => c.active),
      activeTab: this.activeTab,
      headerTab: this.headerTab,
      wide: this.wide,
      tabs: this.tabs.map(id => ({
        id,
        label: game.i18n.localize(`FCP.Tabs.${id.capitalize()}`),
        icon: TAB_ICONS[id],
        active: id === this.activeTab,
        badge: id === "chat" && this.activeTab !== "chat" && this.unreadChat ? this.unreadChat : null
      }))
    };
  }

  /** Pinned hint, derived from the live actor so it never goes stale. */
  #pinText(actor) {
    if (!this.pin || !actor || this.pin.actorId !== actor.id) return "";
    return this.adapter.pinText?.(actor, this.pin.key) ?? "";
  }

  /** Kicker, one-line summary and pinned hint shown by the header of each tab. */
  #headerInfo(actor, header) {
    const loc = key => game.i18n.localize(key);
    const tab = this.headerTab;
    const right = {
      sheet: actor ? this.adapter.kicker(actor) : "",
      actions: loc(this.diceEnabled ? "FCP.Hint.ActionsDice" : "FCP.Hint.Actions"),
      inventory: loc("FCP.Hint.Inventory"),
      chat: game.i18n.format("FCP.Hint.Chat", { n: getSetting(SETTINGS.CHAT_LIMIT) }),
      map: "",
      notes: ""
    }[tab] ?? "";
    return {
      left: tab === "sheet" ? loc("FCP.Title") : loc(`FCP.Tabs.${tab.capitalize()}`),
      right,
      summary: header?.summary?.[tab] ?? "",
      // Actions show the pin only where opening an item sets it (dnd5e); elsewhere it belongs to the sheet.
      pin: tab === "sheet" || (tab === "actions" && this.adapter.pinOnExpand) ? this.#pinText(actor) : "",
      menu: tab === this.primaryTab
    };
  }

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    const actor = this.actor;
    switch (partId) {
      case "header":
        context.chat = this.#diceBar();
        break;
      case "sheet":
        context.sheet = actor ? await this.adapter.prepareSheet(actor) : { sections: [], rests: [] };
        context.hpDraft = this.#draft("hpAmount");
        if (!this.diceEnabled) this.#stripRolls(context.sheet);
        if (context.panes) {
          // Sections tagged with a pane show only under their sub-tab; untagged ones always.
          context.sheet.sections = (context.sheet.sections ?? []).filter(s => !s.pane || s.pane === this.sheetPane);
          if (context.sheet.restsPane && context.sheet.restsPane !== this.sheetPane) context.sheet.rests = [];
        }
        for (const section of context.sheet.sections ?? []) {
          for (const tile of section.tiles ?? []) {
            tile.zero ??= /^[+−-]?0$/.test(String(tile.value).trim());
            tile.pinned = tile.action === "pin" && this.pin?.actorId === actor?.id && this.pin?.key === tile.data?.key;
          }
        }
        context.condPicker = this.condPicker;
        break;
      case "actions":
        context.tabId = "actions";
        {
          const prepared = actor ? await this.adapter.prepareActions(actor) : { groups: [] };
          context.groups = prepared.groups;
          context.useInBody = !!prepared.useInBody;
        }
        await this.#decorateItems(actor, context.groups);
        context.targets = actor && this.#decorateVfx(actor, context.groups) ? this.#prepareTargets() : null;
        this.showsTargets = !!context.targets;
        break;
      case "inventory":
        context.tabId = "inventory";
        context.targets = null;
        context.groups = actor ? (await this.adapter.prepareInventory(actor)).groups : [];
        context.spellQuery = this.spellQuery;
        context.spellFilter = this.spellFilter;
        await this.#decorateItems(actor, context.groups);
        break;
      case "notes":
        context.notes = await this.notes.prepare();
        break;
      case "chat":
        // In two columns the header belongs to the sheet, so the chat carries its own dice bar.
        context.chat = { ...this.#diceBar(), messageDraft: this.#draft("message") };
        break;
      case "map":
        context.map = this.#prepareMap();
        break;
    }
    return context;
  }

  #diceBar() {
    return { quickDice: ["d4", "d6", "d8", "d10", "d12", "d20", "d100"], formulaDraft: this.#draft("formula") };
  }

  /** Current value of a text input, so a re-render does not wipe what the player is typing. */
  #draft(name) {
    // Not gated on `rendered`: during a re-render the state is already RENDERING but the old DOM is still there.
    return this.element?.querySelector(`input[name=${name}]`)?.value ?? "";
  }

  /** Reference mode: tiles stay informative but do not roll; no advantage/reaction bar. */
  #stripRolls(sheet) {
    sheet.modes = null;
    for (const section of sheet.sections ?? []) {
      for (const tile of section.tiles ?? []) {
        if (tile.action !== "roll") continue;
        if (tile.data?.pin && this.adapter.pinText) {
          // Reference mode: tapping pins what to roll at the table in the header.
          tile.action = "pin";
          tile.data = { key: tile.data.pin };
          continue;
        }
        if (tile.data?.kind === "trait" && this.adapter.pinText) {
          // Reference mode: tapping a trait pins its dice recipe in the header instead of rolling.
          tile.action = "pin";
          continue;
        }
        tile.action = "noop";
        if (tile.data?.kind === "experience") { tile.sub = null; tile.prof = false; }
      }
    }
  }

  /** Hide "use" buttons in reference mode and inline the enriched text of expanded items. */
  async #decorateItems(actor, groups) {
    const dice = this.diceEnabled;
    const TextEditor = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
    for (const group of groups) {
      for (const row of group.items) {
        if (!dice && (row.action === "useItem" || row.action === "useActivity")) row.action = null;
        if (!row.id || !this.expandedItems.has(row.id)) continue;
        const item = actor?.items.get(row.itemId ?? row.id);
        if (!item) continue;
        const raw = item.system?.description?.value ?? item.system?.description ?? "";
        try {
          row.description = await TextEditor.enrichHTML(typeof raw === "string" ? raw : "", { relativeTo: item, secrets: false });
        } catch (err) {
          row.description = "";
        }
        row.expanded = true;
        if (!row.description) row.description = `<p>${game.i18n.localize("FCP.Empty")}</p>`;
      }
    }
  }

  /** Mark the rows whose item has an effect; true when at least one does. */
  #decorateVfx(actor, groups) {
    if (!vfxApi()) return false;
    let any = false;
    for (const group of groups) {
      for (const row of group.items ?? []) {
        const item = row.id ? actor.items.get(row.itemId ?? row.id) : null;
        const actionId = resolveActionId(item, row.data?.["action-id"]);
        if (item && hasEffect(item, actionId)) {
          row.vfx = { actionId: actionId ?? "" };
          any = true;
        }
      }
    }
    return any;
  }

  /** Candidates of the targets strip: visible tokens of the active scene, nearest first, mine last. */
  #prepareTargets() {
    const scene = activeScene();
    const origin = this.token;
    if (!scene || !origin) return { noToken: true };
    const grid = scene.grid;
    const center = t => ({ x: t.x + (t.width * grid.sizeX) / 2, y: t.y + (t.height * grid.sizeY) / 2 });
    const o = center(origin);
    const distance = t => {
      const c = center(t);
      return Math.max(Math.abs(c.x - o.x) / grid.sizeX, Math.abs(c.y - o.y) / grid.sizeY);
    };
    const combat = game.combats?.find(c => c.scene?.id === scene.id && c.started) ?? null;
    const combatants = combat ? combat.turns.map(c => c.tokenId).filter(Boolean) : [];
    const fog = this.#fogTest(scene, center);
    const list = orderCandidates(
      filterCandidates(scene.tokens.contents, { explored: fog?.test ?? null }),
      { originId: origin.id, combatants, distance }
    );
    // Targets that left the strip (deleted, hidden, fogged, other scene) are dropped, so they are never sent.
    // Not while the first fog mask is still decoding: everything but the user's own tokens would look unexplored.
    if (!fog?.pending && pruneTargets(this.targetIds, new Set(list.map(t => t.id)))) this.#syncTargets();
    return {
      list: list.map(t => ({
        id: t.id,
        name: t.name,
        short: (t.name ?? "").trim().split(/\s+/)[0].slice(0, 10),
        img: this.#tokenImage(t),
        cls: t.id === origin.id ? "mine"
          : (t.isOwner || t.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY) ? "friendly"
          : t.disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE ? "hostile" : "other",
        selected: this.targetIds.has(t.id),
        mine: t.id === origin.id
      })),
      count: this.targetIds.size,
      color: game.user.color?.css ?? String(game.user.color ?? "")
    };
  }

  #fog = { src: null, sceneId: null, data: null };

  /**
   * With fog on, `{ test, pending }`: `test(token)` says whether the token's center is explored, `pending` that
   * no mask of this scene is decoded yet. Null when fog is off.
   */
  #fogTest(scene, center) {
    if (!getSetting(SETTINGS.MAP_FOG)) return null;
    const src = scene.getFlag(MODULE_ID, FOG_FLAG);
    if (!src) return { test: () => false, pending: false }; // nothing explored yet: only the user's own tokens
    if (this.#fog.src !== src) this.#loadFog(src, scene.id);
    // The explored area only grows: until the new image is decoded the previous mask of this scene still holds.
    const mask = this.#fog.sceneId === scene.id ? this.#fog.data : null;
    if (!mask) return { test: () => false, pending: true }; // re-rendered once decoded
    const d = scene.dimensions;
    return {
      pending: false,
      test: t => {
        const c = center(t);
        return isExplored(mask, ((c.x - d.sceneX) * mask.width) / d.sceneWidth, ((c.y - d.sceneY) * mask.height) / d.sceneHeight);
      }
    };
  }

  /** Decode the explored-area image once per change and re-render the actions. */
  #loadFog(src, sceneId) {
    const previous = this.#fog.sceneId === sceneId ? this.#fog.data : null;
    this.#fog = { src, sceneId, data: previous };
    const img = new Image();
    img.onload = () => {
      if (this.#fog.src !== src) return;
      const el = document.createElement("canvas");
      el.width = img.naturalWidth;
      el.height = img.naturalHeight;
      const ctx = el.getContext("2d");
      ctx.drawImage(img, 0, 0);
      this.#fog.data = ctx.getImageData(0, 0, el.width, el.height);
      this.markDirty("actions");
    };
    img.onerror = () => warn("could not read the explored area for the targets strip");
    img.src = src;
  }

  /**
   * Share the targets: Foundry draws the user's crosshair on every client with a canvas. Other clients apply
   * targets only for users viewing their scene, and a phone without a canvas views none, so the scene goes along.
   */
  #syncTargets() {
    const sceneId = activeScene()?.id;
    if (!sceneId) return;
    try {
      game.user.broadcastActivity({ sceneId, targets: Array.from(this.targetIds) });
    } catch (err) {
      warn("could not share the targets", err);
    }
  }

  /** Token art, falling back to the actor portrait when it is a video (webm/mp4 cannot be a CSS background). */
  #tokenImage(token) {
    const src = token.texture?.src;
    if (src && !VIDEO_RE.test(src)) return src;
    const portrait = token.actor?.img;
    return portrait && !VIDEO_RE.test(portrait) ? portrait : "icons/svg/mystery-man.svg";
  }

  #prepareMap() {
    const scene = activeScene();
    if (!scene) return { hasScene: false };
    const actor = this.actor;
    const mine = actorTokens(actor, scene);
    const choices = mine.length ? mine : ownedTokens(scene);
    const token = this.token;
    const d = scene.dimensions;
    const grid = scene.grid;
    const src = scene.background?.src;
    // "schematic": white ground with the scene grid and the walls; "image": the scene background.
    const schematic = getSetting(SETTINGS.MAP_STYLE) !== "image";
    const background = (!schematic && this.activeTab === "map" && src && !VIDEO_RE.test(src)) ? src : null;
    const cells = grid.isSquare ? { w: (grid.sizeX / d.sceneWidth * 100).toFixed(4), h: (grid.sizeY / d.sceneHeight * 100).toFixed(4) } : null;

    const myIds = choices.map(t => t.id);
    const tokens = visibleMinimapTokens(scene, myIds).map(t => {
      const w = t.width * grid.sizeX;
      const h = t.height * grid.sizeY;
      const cx = t.x + w / 2;
      const cy = t.y + h / 2;
      let cls = "other";
      if (t.id === token?.id) cls = "mine";
      else if (t.isOwner || t.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY) cls = "friendly";
      else if (t.disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE) cls = "hostile";
      return {
        id: t.id,
        name: t.name,
        img: this.#tokenImage(t),
        left: ((cx - d.sceneX) / d.sceneWidth * 100).toFixed(2),
        top: ((cy - d.sceneY) / d.sceneHeight * 100).toFixed(2),
        size: Math.max(2.5, w / d.sceneWidth * 100).toFixed(2),
        cls,
        mine: cls === "mine"
      };
    });

    // Fog of war: the explored area recorded by the GM's client masks background, walls and other tokens.
    const fogOn = !!getSetting(SETTINGS.MAP_FOG);
    const fogMask = fogOn ? scene.getFlag(MODULE_ID, FOG_FLAG) ?? null : null;

    return {
      hasScene: true,
      sceneName: scene.navName || scene.name,
      hasToken: !!token,
      ratio: (d.sceneWidth / d.sceneHeight).toFixed(4),
      initial: (token?.name ?? "").trim().charAt(0).toUpperCase(),
      background,
      tokens,
      fog: { on: fogOn, mask: fogMask },
      schematic,
      cells,
      walls: this.#mapWalls(scene),
      viewBox: `0 0 ${d.sceneWidth} ${d.sceneHeight}`,
      tokenChoices: choices.map(t => ({ id: t.id, name: t.name, selected: t.id === token?.id })),
      step: this.step,
      target: this.mapTarget
    };
  }

  /** Walls as layout lines: only the ones that block sight normally ("building") or partially ("terrain"). */
  #mapWalls(scene) {
    const S = CONST.EDGE_SENSE_TYPES ?? { NONE: 0, LIMITED: 10, NORMAL: 20 };
    const d = scene.dimensions;
    return scene.walls
      .filter(w => (w.sight === S.LIMITED || w.sight === S.NORMAL) && w.move !== S.NONE)
      .map(w => {
        const [x1, y1, x2, y2] = w.c;
        return {
          x1: Math.round(x1 - d.sceneX), y1: Math.round(y1 - d.sceneY),
          x2: Math.round(x2 - d.sceneX), y2: Math.round(y2 - d.sceneY),
          // Secret doors are drawn as plain walls, the way a player sees them.
          door: w.door === CONST.WALL_DOOR_TYPES.DOOR,
          terrain: w.sight === S.LIMITED
        };
      });
  }

  async _preRender(context, options) {
    await super._preRender(context, options);
    // The targets strip scrolls sideways and is rebuilt when tokens move: keep its position.
    this._stripScroll = this.element?.querySelector(".fcp-targets-strip")?.scrollLeft ?? 0;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const el = this.element;
    const strip = el.querySelector(".fcp-targets-strip");
    if (strip && this._stripScroll) strip.scrollLeft = this._stripScroll;
    el.classList.toggle("fcp-wide", this.wide);
    if (options.isFirstRender) this.wideQuery?.addEventListener("change", this.#onWideChange);

    // Enter key on text inputs triggers the paired action.
    for (const input of el.querySelectorAll("input[data-enter]")) {
      if (input.dataset.bound) continue;
      input.dataset.bound = "1";
      input.addEventListener("keydown", ev => {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        const handler = CompanionApp.DEFAULT_OPTIONS.actions[input.dataset.enter];
        handler?.call(this, ev, input);
      });
    }

    // Token picker on the map tab is a <select>: react to change, not click.
    const select = el.querySelector("select[name=tokenId]");
    if (select && !select.dataset.bound) {
      select.dataset.bound = "1";
      select.addEventListener("change", () => {
        this.tokenId = select.value;
        this.mapTarget = null;
        this.markDirty("map");
      });
    }

    const search = el.querySelector("input[name=spellQuery]");
    if (search && !search.dataset.bound) {
      search.dataset.bound = "1";
      search.addEventListener("input", () => {
        this.spellQuery = search.value;
        this.#applySpellFilter();
      });
    }
    this.#applySpellFilter();
    this.notes?.onRender(el);

    const log = el.querySelector(".fcp-chat-log");
    if (log && (options.isFirstRender || options.parts?.includes("chat") || !options.parts)) {
      await this.#fillChat(log);
    }

    if (options.isFirstRender && this._dirty.size) this.refreshParts();
  }

  _onClose(options) {
    // Saves, then disposes the editor: its update hook and autosave timer must not outlive the app.
    this.notes?.dispose();
    this.wideQuery?.removeEventListener("change", this.#onWideChange);
    super._onClose(options);
  }

  /** Spellbook search and "prepared only" filter, applied in place so typing never re-renders. */
  #applySpellFilter() {
    const book = this.element?.querySelector(".fcp-spellbook");
    if (!book) return;
    const q = this.spellQuery.trim().toLowerCase();
    const onlyPrepared = this.spellFilter === "prepared";
    let shown = 0;
    for (const level of book.querySelectorAll(".fcp-spell-level")) {
      let visible = 0;
      for (const row of level.querySelectorAll(".fcp-spell")) {
        const hide = (q && !row.dataset.name.includes(q)) || (onlyPrepared && row.dataset.prepared !== "1");
        row.hidden = !!hide;
        if (!hide) visible++;
      }
      level.hidden = !visible;
      shown += visible;
    }
    const empty = book.querySelector(".fcp-spell-empty");
    if (empty) empty.hidden = !!shown;
    for (const btn of book.querySelectorAll("[data-action=spellFilter]")) btn.classList.toggle("active", btn.dataset.filter === this.spellFilter);
  }

  async #fillChat(log) {
    const limit = getSetting(SETTINGS.CHAT_LIMIT);
    const messages = game.messages.contents.filter(m => m.visible).slice(-limit);
    log.replaceChildren();
    for (const m of messages) {
      let html = this._chatCache.get(m.id);
      if (!html) {
        try {
          html = await m.renderHTML();
          this._chatCache.set(m.id, html);
        } catch (err) {
          warn("could not render chat message", m.id, err);
          continue;
        }
      }
      log.appendChild(html);
    }
    log.scrollTop = log.scrollHeight;
  }

  /** Called by hooks when a chat message changes. */
  onChatChanged(message, { deleted = false } = {}) {
    this._chatCache.delete(message.id);
    if (!deleted && !message.visible) return;
    if (this.activeTab !== "chat" && !deleted) {
      this.unreadChat++;
      this.markDirty("nav");
    }
    this.refreshChatLog();
  }

  /** Refill the chat log without re-templating the part (keeps the inputs and their drafts). */
  refreshChatLog = foundry.utils.debounce(() => {
    const log = this.element?.querySelector(".fcp-chat-log");
    if (log) this.#fillChat(log);
  }, 80);

  /* -------------------------------------------- */
  /*  Tabs / actor                                 */
  /* -------------------------------------------- */

  setTab(tab) {
    if (!this.tabs.includes(tab) || (this.wide && tab === this.primaryTab)) return;
    if (this.activeTab === "notes" && tab !== "notes") this.notes?.flush();
    this.activeTab = tab;
    setSetting(SETTINGS.LAST_TAB, tab);
    for (const section of this.element.querySelectorAll(".fcp-tab")) {
      section.classList.toggle("active", section.dataset.tab === tab);
    }
    for (const btn of this.element.querySelectorAll(".fcp-nav button")) {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    }
    if (tab === "chat") {
      this.unreadChat = 0;
      this.markDirty("nav");
      this.refreshChatLog();
    }
    if (tab === "map") this.markDirty("map");
    this.markDirty("header");
  }

  static #onPin(event, target) {
    const key = target.dataset.key;
    const same = this.pin?.key === key && this.pin?.actorId === this.actor?.id;
    this.pin = same ? null : { actorId: this.actor?.id, key };
    this.markDirty("header", "sheet");
  }

  static #onSwitchPane(event, target) {
    this.sheetPane = target.dataset.pane;
    this.markDirty("header", "sheet");
  }

  static #onTogglePicker() {
    this.condPicker = !this.condPicker;
    this.markDirty("sheet");
  }

  static #onSpellFilter(event, target) {
    this.spellFilter = target.dataset.filter;
    this.#applySpellFilter();
  }

  static #onTab(event, target) {
    this.setTab(target.dataset.tab);
  }

  static #onSelectActor(event, target) {
    this._actorId = target.dataset.actorId;
    this.pin = null;
    setSetting(SETTINGS.LAST_ACTOR, this._actorId);
    this.tokenId = null;
    this.mapTarget = null;
    this.render({ force: true });
  }

  static #onRefresh() {
    this._chatCache.clear();
    this.render({ force: true });
  }

  /** Log out of Foundry (back to the join page), with a confirm: the button sits next to others on a small screen. */
  static async #onLogOut() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("FCP.LogOut") },
      content: `<p>${game.i18n.localize("FCP.LogOutConfirm")}</p>`,
      rejectClose: false
    });
    if (ok) game.logOut();
  }

  static async #onExit() {
    await setSetting(SETTINGS.MOBILE_MODE, "off");
    const url = new URL(window.location.href);
    url.searchParams.delete("companion");
    window.location.replace(url.toString());
  }

  /* -------------------------------------------- */
  /*  Sheet actions                                */
  /* -------------------------------------------- */

  static async #onHpDelta(event, target) {
    const actor = this.actor;
    if (!actor) return;
    await this.adapter.modifyHP(actor, Number(target.dataset.delta));
  }

  static async #onHpApply(event, target) {
    const actor = this.actor;
    if (!actor) return;
    const input = this.element.querySelector("input[name=hpAmount]");
    const amount = Math.abs(Number(input?.value) || 0);
    if (!amount) return;
    if (Number(target.dataset.sign) < 0) await this.adapter.applyDamage(actor, amount);
    else await this.adapter.applyHealing(actor, amount);
    input.value = "";
  }

  static #onSetMode(event, target) {
    this.adapter.mode = target.dataset.mode;
    for (const btn of this.element.querySelectorAll(".fcp-modebar button")) {
      btn.classList.toggle("active", btn.dataset.mode === this.adapter.mode);
    }
  }

  static async #onAdapterAction(event, target) {
    const actor = this.actor;
    if (!actor) return;
    const action = target.dataset.action;
    target.disabled = true;
    try {
      const result = await this.adapter.handle(actor, action, { ...target.dataset }, event);
      if (result?.rerender?.length) this.markDirty(...result.rerender);
    } catch (err) {
      warn(`action ${action} failed`, err);
      ui.notifications.error(String(err.message ?? err));
    } finally {
      target.disabled = false;
    }
  }

  static #onExpandItem(event, target) {
    const id = target.dataset.itemId;
    if (!id) return;
    const opening = !this.expandedItems.has(id);
    if (opening) this.expandedItems.add(id);
    else this.expandedItems.delete(id);
    const part = target.closest("[data-application-part]")?.dataset.applicationPart;
    // Reference mode: opening an action pins its to-hit and damage in the header, like a trait.
    if (opening && part === "actions" && !this.diceEnabled && this.adapter.pinOnExpand) {
      this.pin = { actorId: this.actor?.id, key: `item:${id}` };
      this.markDirty("header", "sheet");
    }
    this.markDirty(part ?? "actions");
  }

  static async #onToggleStatus(event, target) {
    const actor = this.actor;
    if (!actor) return;
    await this.adapter.toggleStatus(actor, target.dataset.statusId);
  }

  /* -------------------------------------------- */
  /*  Chat                                         */
  /* -------------------------------------------- */

  async rollFormula(formula, flavor) {
    const actor = this.actor;
    const roll = new Roll(formula, actor?.getRollData() ?? {});
    await roll.evaluate();
    const speaker = ChatMessage.implementation.getSpeaker({ actor, token: this.token });
    await roll.toMessage({ speaker, flavor });
  }

  static async #onQuickRoll(event, target) {
    await this.rollFormula(`1${target.dataset.formula}`);
  }

  static async #onCustomRoll() {
    const input = this.element.querySelector("input[name=formula]");
    const formula = input?.value.trim();
    if (!formula) return;
    try {
      Roll.validate(formula);
      await this.rollFormula(formula);
      input.value = "";
    } catch (err) {
      ui.notifications.warn(String(err.message ?? err));
    }
  }

  static async #onSendChat() {
    const input = this.element.querySelector("input[name=message]");
    const text = input?.value.trim();
    if (!text) return;
    input.value = "";
    if (typeof ui.chat?.processMessage === "function") {
      await ui.chat.processMessage(text);
    } else {
      const speaker = ChatMessage.implementation.getSpeaker({ actor: this.actor, token: this.token });
      await ChatMessage.implementation.create({ content: text, speaker });
    }
  }

  /* -------------------------------------------- */
  /*  Map                                          */
  /* -------------------------------------------- */

  _moveChain = Promise.resolve();

  /**
   * Queue a move. `computePosition(token)` runs when the move actually starts, so taps queued
   * while a relay round-trip is pending build on the token's updated position.
   */
  #moveTo(computePosition) {
    const run = async () => {
      const token = this.token;
      if (!token) return;
      const position = computePosition(token);
      if (!position) return;
      this.#setPadEnabled(false);
      try {
        const result = await requestMove(token, position);
        if (result?.constrained) ui.notifications.warn(game.i18n.localize("FCP.MoveBlocked"));
        else if (result?.validated === false) ui.notifications.info(game.i18n.localize("FCP.MoveUnchecked"));
      } catch (err) {
        warn("move failed", err);
      } finally {
        this.mapTarget = null;
        this.#setPadEnabled(true);
        this.markDirty("map");
      }
    };
    this._moveChain = this._moveChain.then(run, run);
    return this._moveChain;
  }

  #setPadEnabled(enabled) {
    for (const btn of this.element?.querySelectorAll(".fcp-dpad button[data-action=move]") ?? []) btn.disabled = !enabled;
  }

  static async #onMove(event, target) {
    const dx = Number(target.dataset.dx);
    const dy = Number(target.dataset.dy);
    const steps = this.step;
    await this.#moveTo(token => shiftedPosition(token, dx, dy, steps));
  }

  static async #onMapTap(event, target) {
    const token = this.token;
    const scene = activeScene();
    if (!token || !scene) return;
    const rect = target.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    if (px < 0 || px > 1 || py < 0 || py > 1) return;
    const d = scene.dimensions;
    const center = { x: d.sceneX + px * d.sceneWidth, y: d.sceneY + py * d.sceneHeight };
    this.mapTarget = { left: (px * 100).toFixed(2), top: (py * 100).toFixed(2) };
    await this.#moveTo(t => positionAtCenter(t, center));
  }

  static #onStepToggle() {
    this.step = this.step >= 3 ? 1 : this.step + 1;
    this.markDirty("map");
  }

  static #onToggleTarget(event, target) {
    const id = target.dataset.tokenId;
    if (!id) return;
    if (this.targetIds.has(id)) this.targetIds.delete(id);
    else this.targetIds.add(id);
    this.#syncTargets();
    this.markDirty("actions");
  }

  static #onClearTargets() {
    this.targetIds.clear();
    this.#syncTargets();
    this.markDirty("actions");
  }

  static async #onPlayVfx(event, target) {
    const tokenDoc = this.token;
    const item = this.actor?.items.get(target.dataset.itemId);
    if (!tokenDoc || !item || target.disabled) return;
    target.disabled = true;
    target.classList.add("playing");
    try {
      const targetIds = Array.from(this.targetIds).filter(id => tokenDoc.parent.tokens.has(id));
      const result = await requestPlay({ tokenDoc, item, actionId: target.dataset.vfxAction || null, targetIds });
      if (!result.ok) ui.notifications.warn(game.i18n.localize(`FCP.Vfx.Fail.${failureKey(result.reason, targetIds.length)}`));
    } catch (err) {
      warn("effect request failed", err);
      ui.notifications.warn(game.i18n.localize("FCP.Vfx.Fail.error"));
    } finally {
      target.disabled = false;
      target.classList.remove("playing");
    }
  }

  static #onSelectToken() {
    // handled by the change listener bound in _onRender
  }

  /* -------------------------------------------- */
  /*  GM notes                                     */
  /* -------------------------------------------- */

  static async #onOpenNote(event, target) {
    await this.notes?.open(target.dataset.entryId);
  }

  static async #onCloseNote() {
    await this.notes?.close();
  }

  static async #onNotePage(event, target) {
    await this.notes?.showPage(target.dataset.pageId);
  }

  static #onToggleFolder(event, target) {
    this.notes?.toggleFolder(target.dataset.folderId);
  }

  static async #onQuickNote(event, target) {
    target.disabled = true;
    try {
      await this.notes?.quickNote();
    } catch (err) {
      warn("quick note failed", err);
      ui.notifications.error(String(err.message ?? err));
    } finally {
      target.disabled = false;
    }
  }

  static #onNoteHeading(event, target) {
    this.notes?.scrollToHeading(Number(target.dataset.index));
  }
}
