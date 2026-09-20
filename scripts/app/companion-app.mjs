import { MODULE_ID, SETTINGS, TABS, warn } from "../constants.mjs";
import { getSetting, setSetting } from "../settings.mjs";
import { activeScene, actorTokens, ownedTokens, visibleMinimapTokens, shiftedPosition, positionAtCenter } from "../movement.mjs";
import { requestMove } from "../socket.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
const T = `modules/${MODULE_ID}/templates/parts`;
const VIDEO_RE = /\.(webm|mp4|m4v|ogv|ogg)(\?.*)?$/i;

const TAB_ICONS = {
  sheet: "fas fa-user",
  actions: "fas fa-bolt",
  inventory: "fas fa-suitcase",
  chat: "fas fa-comments",
  map: "fas fa-map"
};

export class CompanionApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(adapter, options = {}) {
    super(options);
    this.adapter = adapter;
    this.activeTab = TABS.includes(getSetting(SETTINGS.LAST_TAB)) ? getSetting(SETTINGS.LAST_TAB) : "sheet";
    this.step = 1;
    this.tokenId = null;
    this.mapTarget = null;
    this.unreadChat = 0;
    this._chatCache = new Map();
    this._actorId = getSetting(SETTINGS.LAST_ACTOR) || null;
    this.expandedItems = new Set();
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
      tab: CompanionApp.#onTab,
      selectActor: CompanionApp.#onSelectActor,
      refresh: CompanionApp.#onRefresh,
      exitCompanion: CompanionApp.#onExit,
      hpDelta: CompanionApp.#onHpDelta,
      hpApply: CompanionApp.#onHpApply,
      counter: CompanionApp.#onAdapterAction,
      setMode: CompanionApp.#onSetMode,
      roll: CompanionApp.#onAdapterAction,
      useItem: CompanionApp.#onAdapterAction,
      toggleItem: CompanionApp.#onAdapterAction,
      rest: CompanionApp.#onAdapterAction,
      expandItem: CompanionApp.#onExpandItem,
      toggleStatus: CompanionApp.#onToggleStatus,
      quickRoll: CompanionApp.#onQuickRoll,
      customRoll: CompanionApp.#onCustomRoll,
      sendChat: CompanionApp.#onSendChat,
      move: CompanionApp.#onMove,
      mapTap: CompanionApp.#onMapTap,
      stepToggle: CompanionApp.#onStepToggle,
      selectToken: CompanionApp.#onSelectToken,
      noop: () => {}
    }
  };

  static PARTS = {
    header: { template: `${T}/header.hbs` },
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
    const scene = activeScene();
    if (!scene) return null;
    const mine = actorTokens(this.actor, scene);
    const choices = mine.length ? mine : ownedTokens(scene);
    return choices.find(t => t.id === this.tokenId) ?? choices[0] ?? null;
  }

  /** Re-render only some parts, coalescing bursts of updates. */
  refreshParts = foundry.utils.debounce(() => {
    if (!this.rendered || !this._dirty.size) return; // keep the set: flushed after the first render
    const parts = Array.from(this._dirty);
    this._dirty.clear();
    this.render({ parts });
  }, 80);

  _dirty = new Set();

  markDirty(...parts) {
    for (const p of parts) this._dirty.add(p);
    this.refreshParts();
  }

  /* -------------------------------------------- */
  /*  Rendering                                    */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    const actor = this.actor;
    const actors = this.actors.map(a => ({ id: a.id, name: a.name, img: a.img, active: a.id === actor?.id }));
    const header = actor ? await this.adapter.prepareHeader(actor) : { hp: null, stats: [] };
    return {
      actor: actor ? { id: actor.id, name: actor.name, img: actor.img, subtitle: this.adapter.subtitle(actor) } : null,
      actors,
      header,
      dice: this.diceEnabled,
      conditions: actor ? this.adapter.conditions(actor) : [],
      activeTab: this.activeTab,
      tabs: TABS.map(id => ({
        id,
        label: game.i18n.localize(`FCP.Tabs.${id.capitalize()}`),
        icon: TAB_ICONS[id],
        active: id === this.activeTab,
        badge: id === "chat" && this.activeTab !== "chat" && this.unreadChat ? this.unreadChat : null
      }))
    };
  }

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    const actor = this.actor;
    switch (partId) {
      case "sheet":
        context.sheet = actor ? await this.adapter.prepareSheet(actor) : { sections: [], rests: [] };
        context.hpDraft = this.#draft("hpAmount");
        if (!this.diceEnabled) this.#stripRolls(context.sheet);
        break;
      case "actions":
        context.tabId = "actions";
        context.groups = actor ? (await this.adapter.prepareActions(actor)).groups : [];
        await this.#decorateItems(actor, context.groups);
        break;
      case "inventory":
        context.tabId = "inventory";
        context.groups = actor ? (await this.adapter.prepareInventory(actor)).groups : [];
        await this.#decorateItems(actor, context.groups);
        break;
      case "chat":
        context.chat = {
          quickDice: ["d4", "d6", "d8", "d10", "d12", "d20", "d100"],
          messageDraft: this.#draft("message"),
          formulaDraft: this.#draft("formula")
        };
        break;
      case "map":
        context.map = this.#prepareMap();
        break;
    }
    return context;
  }

  /** Current value of a text input, so a re-render does not wipe what the player is typing. */
  #draft(name) {
    return this.rendered ? (this.element?.querySelector(`input[name=${name}]`)?.value ?? "") : "";
  }

  /** Reference mode: tiles stay informative but do not roll; no advantage/reaction bar. */
  #stripRolls(sheet) {
    sheet.modes = null;
    for (const section of sheet.sections ?? []) {
      for (const tile of section.tiles ?? []) {
        if (tile.action !== "roll") continue;
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
        if (!dice && row.action === "useItem") row.action = null;
        if (!row.id || !this.expandedItems.has(row.id)) continue;
        const item = actor?.items.get(row.id);
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
    const background = (this.activeTab === "map" && src && !VIDEO_RE.test(src)) ? src : null;

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
        cls
      };
    });

    return {
      hasScene: true,
      sceneName: scene.navName || scene.name,
      hasToken: !!token,
      aspect: `${d.sceneWidth} / ${d.sceneHeight}`,
      background,
      tokens,
      tokenChoices: choices.map(t => ({ id: t.id, name: t.name, selected: t.id === token?.id })),
      step: this.step,
      target: this.mapTarget
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const el = this.element;

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

    const log = el.querySelector(".fcp-chat-log");
    if (log && (options.isFirstRender || options.parts?.includes("chat") || !options.parts)) {
      await this.#fillChat(log);
    }

    if (options.isFirstRender && this._dirty.size) this.refreshParts();
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
    const tab = log.closest(".fcp-tab");
    if (tab) tab.scrollTop = tab.scrollHeight;
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
    if (!TABS.includes(tab)) return;
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
  }

  static #onTab(event, target) {
    this.setTab(target.dataset.tab);
  }

  static #onSelectActor(event, target) {
    this._actorId = target.dataset.actorId;
    setSetting(SETTINGS.LAST_ACTOR, this._actorId);
    this.tokenId = null;
    this.mapTarget = null;
    this.render({ force: true });
  }

  static #onRefresh() {
    this._chatCache.clear();
    this.render({ force: true });
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
    if (this.expandedItems.has(id)) this.expandedItems.delete(id);
    else this.expandedItems.add(id);
    const part = target.closest("[data-application-part]")?.dataset.applicationPart;
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

  static #onSelectToken() {
    // handled by the change listener bound in _onRender
  }
}
