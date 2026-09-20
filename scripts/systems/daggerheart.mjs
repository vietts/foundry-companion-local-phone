import { SystemAdapter, loc, signed, equipToggle, plainText } from "./base.mjs";
import { SETTINGS } from "../constants.mjs";
import { getSetting } from "../settings.mjs";

const TRAITS = ["agility", "strength", "finesse", "instinct", "presence", "knowledge"];

/** Text for one system label; icon-only information (recall cost, damage type) is rendered as text. */
function labelToText(label) {
  if (typeof label === "string") return label;
  if (!label?.value) return "";
  const icons = label.icons ?? [];
  if (icons.includes("fa-bolt")) return `⚡\uFE0E${label.value}`;
  const types = Object.values(CONFIG.DH?.GENERAL?.damageTypes ?? {}).filter(t => icons.includes(t.icon));
  const abbr = types.map(t => game.i18n.localize(t.abbreviation ?? t.label)).join("/");
  return abbr ? `${label.value} ${abbr}` : label.value;
}

function labelsToText(item) {
  try {
    return (item._getLabels?.() ?? []).map(labelToText).filter(Boolean).join(" · ");
  } catch (err) {
    return "";
  }
}

/**
 * Daggerheart (Foundryborne system, 2.x).
 * HP and Stress are "reversed" resources: value = boxes marked. The companion shows marked boxes, like the desktop sheet.
 */
export class DaggerheartAdapter extends SystemAdapter {
  static id = "daggerheart";

  mode = "action"; // action | reaction | advantage | disadvantage
  selectedExperiences = new Set();

  isPlayable(actor) {
    return actor.type === "character";
  }

  subtitle(actor) {
    const s = actor.system;
    const cls = s.class?.value?.name;
    const sub = s.class?.subclass?.name;
    const parts = [];
    if (cls) parts.push(sub ? `${cls}, ${sub}` : cls);
    if (s.ancestry?.name) parts.push(s.ancestry.name);
    if (s.community?.name) parts.push(s.community.name);
    return parts.join(" · ");
  }

  kicker(actor) {
    const lvl = actor.system.levelData?.level?.current;
    return ["Daggerheart", lvl ? `${game.i18n.localize("FCP.LevelShort")} ${lvl}` : null].filter(Boolean).join(" · ");
  }

  /* ---------------- Header ---------------- */

  async prepareHeader(actor) {
    const r = actor.system.resources;
    const t = key => game.i18n.localize(key);
    const defs = [
      { key: "hp", label: t("FCP.DH.HPMarked"), tone: "hp", res: r.hitPoints },
      { key: "hope", label: t("FCP.DH.Hope"), tone: "hope", res: r.hope },
      { key: "stress", label: t("FCP.DH.Stress"), tone: "stress", res: r.stress },
      { key: "armor", label: t("FCP.DH.ArmorLabel"), tone: "armor", res: r.armor }
    ].filter(d => d.res && d.res.max > 0);

    // Tap box n: fill up to n, or clear it when it is already the last filled one.
    const meters = defs.map(({ key, label, tone, res }) => {
      const value = res.value ?? 0;
      const max = res.max ?? 0;
      return {
        key, label, tone, value, max,
        boxes: Array.from({ length: max }, (_, i) => ({ on: i < value, delta: i + 1 === value ? -1 : i + 1 - value }))
      };
    });
    const by = key => meters.find(m => m.key === key);
    const fmt = key => (by(key) ? `${by(key).value}/${by(key).max}` : "—");

    return {
      meters,
      stats: [],
      summary: {
        actions: `${t("FCP.DH.HPShort")} ${fmt("hp")} · ${t("FCP.DH.Hope")} ${fmt("hope")} · ${t("FCP.DH.Stress")} ${fmt("stress")}`,
        inventory: [`${t("FCP.DH.ArmorLabel")} ${fmt("armor")}`, this.#goldText(actor)].filter(Boolean).join(" · ")
      }
    };
  }

  /** Enabled currencies as "1 bag, 7 coins" (empty ones left out). */
  #goldText(actor) {
    const g = actor.system.gold;
    if (!g) return "";
    return this.#currencies(actor)
      .filter(c => c.value > 0)
      .map(c => `${c.value} ${c.name}`)
      .join(", ");
  }

  /** Currencies the world has enabled, in the order of the desktop sheet. */
  #currencies(actor) {
    const g = actor.system.gold ?? {};
    let enabled = null;
    try {
      const { title, ...rest } = game.settings.get(CONFIG.DH.id, CONFIG.DH.SETTINGS.gameSettings.Homebrew).currency;
      enabled = Object.entries(rest).filter(([, c]) => c?.enabled).map(([k]) => k);
    } catch (err) { /* fall back to all four */ }
    return ["chests", "bags", "handfuls", "coins"]
      .filter(k => !enabled || enabled.includes(k))
      .map(k => {
        const value = Number(g[k] ?? 0);
        const [one, many] = game.i18n.localize(`FCP.DH.Currency.${k}`).split("|");
        return { key: k, value, name: value === 1 ? one : many };
      });
  }

  /* ---------------- Sheet ---------------- */

  async prepareSheet(actor) {
    const s = actor.system;
    const t = key => game.i18n.localize(key);
    const traitLabel = key => {
      const cfg = CONFIG.DH?.ACTOR?.abilities?.[key];
      return cfg?.label ? game.i18n.localize(cfg.label) : key;
    };

    const sections = [
      {
        title: loc("DAGGERHEART.GENERAL.Trait.plural", "Traits"),
        layout: "grid",
        cols: 3,
        tiles: TRAITS.map(key => {
          const label = traitLabel(key);
          const mod = signed(s.traits?.[key]?.value);
          return {
            label,
            value: mod,
            action: "roll",
            data: { kind: "trait", key },
            // Reference mode: what to roll at the table, pinned in the header.
            pin: game.i18n.format("FCP.DH.DiceRecipe", { trait: label, mod })
          };
        })
      }
    ];

    const th = s.damageThresholds;
    if (th?.major && th?.severe) {
      const hp = t("FCP.DH.HPShort");
      sections.push({
        title: loc("DAGGERHEART.GENERAL.DamageThresholds.plural", t("FCP.DH.Thresholds")),
        layout: "thresholds",
        note: s.evasion !== undefined ? `${loc("DAGGERHEART.GENERAL.evasion")} ${s.evasion}` : "",
        bands: [
          { range: `1 – ${th.major - 1}`, sub: `1 ${hp}` },
          { cut: th.major, range: `${th.major} – ${th.severe - 1}`, sub: `2 ${hp}` },
          { cut: th.severe, range: `${th.severe} +`, sub: `3 ${hp}` }
        ]
      });
    }

    const experiences = Object.entries(s.experiences ?? {}).map(([id, e]) => ({
      label: e.name || "—",
      value: signed(e.value),
      sub: this.selectedExperiences.has(id) ? t("FCP.DH.ExperienceSelected") : null,
      prof: this.selectedExperiences.has(id),
      action: "roll",
      data: { kind: "experience", key: id }
    }));
    if (experiences.length) {
      sections.push({ title: loc("DAGGERHEART.GENERAL.Experience.plural", "Experiences"), layout: "list", tiles: experiences });
    }

    // Conditions are rendered here by the template, between experiences and effects.
    sections.push({ title: t("FCP.Conditions"), layout: "conditions" });

    const effects = actor.effects
      .filter(e => e.name && !e.disabled && !e.isSuppressed && !e.statuses?.size)
      .map(e => ({ label: e.name, note: e.duration?.label ?? "" }));
    if (effects.length) sections.push({ title: t("FCP.DH.ActiveEffects"), layout: "notes", lines: effects });

    const passives = actor.items
      .filter(i => i.type === "feature" && !i.system.actionsList?.length && this.#isAvailable(actor, i))
      .map(i => ({ name: i.name, text: plainText(i.system.description, 200) }));
    if (passives.length) sections.push({ title: t("FCP.DH.Passives"), layout: "passives", entries: passives });

    const community = s.community?.name;
    const bio = plainText(s.biography?.background, 420);
    if (community || bio) {
      sections.push({ title: t("FCP.DH.AboutTitle"), layout: "about", headline: community ?? "", note: community ? t("FCP.DH.Community") : "", text: bio });
    }

    const rests = [
      { kind: "short", label: t("FCP.Rest.Short") },
      { kind: "long", label: t("FCP.Rest.Long") }
    ];
    if (s.deathMoveViable) rests.push({ kind: "deathMove", label: t("FCP.DH.DeathMove") });

    return {
      modes: [
        { key: "action", label: t("FCP.DH.Action"), active: this.mode === "action" },
        { key: "reaction", label: t("FCP.DH.Reaction"), active: this.mode === "reaction" },
        { key: "advantage", label: t("FCP.Advantage"), active: this.mode === "advantage" },
        { key: "disadvantage", label: t("FCP.Disadvantage"), active: this.mode === "disadvantage" }
      ],
      sections,
      rests,
      conditionsInline: true
    };
  }

  /** Whether a feature applies to the character (e.g. subclass features not yet unlocked are hidden). */
  #isAvailable(actor, item) {
    try {
      return actor.system.isItemAvailable ? !!actor.system.isItemAvailable(item) : true;
    } catch (err) {
      return true;
    }
  }

  /* ---------------- Actions ---------------- */

  #actionRows(item, { actionLabel } = {}) {
    const list = item.system.actionsList ?? [];
    const rows = [];
    for (const action of list) {
      const isAttack = action === item.system.attack;
      const base = isAttack ? labelsToText(item) : (action.name && list.length <= 1 ? "" : action.name ?? "");
      rows.push({
        id: item.id,
        name: list.length > 1 && action.name && action.name !== item.name ? `${item.name}: ${action.name}` : item.name,
        img: action.img || item.img,
        meta: [base, this.#costText(action)].filter(Boolean).join(" · "),
        uses: this.#actionUses(action, item),
        action: "useItem",
        actionLabel: actionLabel ?? game.i18n.localize("FCP.Use"),
        data: { "action-id": isAttack ? "attack" : action.id }
      });
    }
    return rows;
  }

  /** Same substitution rules as the system's itemAbleRollParse ("item.@x" reads the item, "@x" the actor). */
  #evalFormula(value, actor, item) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number") return value;
    const str = String(value);
    const onItem = /item\.@/i.test(str);
    const source = onItem ? item : actor;
    try {
      const data = source?.getRollData?.() ?? {};
      const n = Roll.safeEval(Roll.replaceFormulaData(onItem ? str.replaceAll(/item\.@/gi, "@") : str, data));
      return Number.isFinite(n) ? n : null;
    } catch (err) {
      return null;
    }
  }

  /** Remaining/max uses. action.remainingUses is NaN for formula maxima, so it is computed here. */
  #actionUses(action, item) {
    const uses = action.uses;
    if (!uses?.max) return null;
    const max = this.#evalFormula(uses.max, action.actor ?? item.actor, item);
    if (max === null) return { value: "?", max: String(uses.max) };
    return { value: Math.max(max - (uses.value ?? 0), 0), max };
  }

  /** "2 Stress · 1 Hope" for the action's costs. */
  #costText(action) {
    const costs = action.cost ?? [];
    return costs.filter(c => c?.value).map(c => {
      const cfg = CONFIG.DH?.GENERAL?.abilityCosts?.[c.key];
      const fromItem = c.key === "resource" ? action.actor?.items.get(c.itemId)?.name : null;
      const label = fromItem ?? (cfg?.label ? game.i18n.localize(cfg.label) : c.key);
      return `${c.value}${c.scalable ? "+" : ""} ${label}`;
    }).join(" · ");
  }

  async prepareActions(actor) {
    const s = actor.system;
    const groups = [];

    // Attacks: equipped weapons, unarmed fallback.
    const attacks = [];
    const weapons = actor.items.filter(i => i.type === "weapon" && i.system.equipped);
    for (const w of weapons) attacks.push(...this.#actionRows(w, { actionLabel: game.i18n.localize("FCP.DH.Attack") }));
    if (!weapons.length && s.attack) {
      attacks.push({
        id: "",
        name: s.attack.name || game.i18n.localize("FCP.DH.Unarmed"),
        img: s.attack.img || actor.img,
        meta: "",
        action: "useItem",
        actionLabel: game.i18n.localize("FCP.DH.Attack"),
        data: { "action-id": "unarmed" }
      });
    }
    if (attacks.length) groups.push({ title: game.i18n.localize("FCP.DH.Attacks"), items: attacks });

    // Domain cards in loadout.
    const loadout = s.domainCards?.loadout ?? actor.items.filter(i => i.type === "domainCard" && !i.system.inVault);
    const toVault = { action: "toggleItem", label: game.i18n.localize("FCP.DH.ToVault"), icon: "ph-duotone ph-archive" };
    const cards = [];
    for (const c of loadout) {
      const rows = this.#actionRows(c);
      if (rows.length) {
        rows.forEach((r, i) => cards.push({ ...r, meta: [labelsToText(c), r.meta].filter(Boolean).join(" · "), uses: r.uses ?? this.#itemResource(c), toggle: i === 0 ? toVault : null }));
      } else {
        cards.push({ id: c.id, name: c.name, img: c.img, meta: labelsToText(c), uses: this.#itemResource(c), toggle: toVault });
      }
    }
    if (cards.length) groups.push({ title: `${game.i18n.localize("FCP.DH.Loadout")} ${loadout.length}${this.#loadoutMax(actor)}`, items: cards });

    // Features with actions (class, subclass, ancestry, community, beastform...).
    const featureRows = [];
    for (const f of actor.items.filter(i => i.type === "feature")) {
      featureRows.push(...this.#actionRows(f).map(r => ({ ...r, uses: r.uses ?? this.#itemResource(f) })));
    }
    if (featureRows.length) groups.push({ title: game.i18n.localize("FCP.DH.Features"), items: featureRows });

    return { groups };
  }

  /** " / max" suffix for the loadout title, empty when the limit cannot be read. */
  #loadoutMax(actor) {
    const max = (game.system.settings?.homebrew?.maxLoadout ?? null);
    const bonus = actor.system.bonuses?.maxLoadout ?? 0;
    return typeof max === "number" ? ` / ${max + bonus}` : "";
  }

  #itemResource(item) {
    const res = item.system.resource;
    if (!res || (!res.max && !res.value)) return null;
    const max = this.#evalFormula(res.max, item.actor, item);
    return { value: res.value ?? 0, max: max ?? (res.max ? "?" : "∞") };
  }

  /* ---------------- Inventory ---------------- */

  async prepareInventory(actor) {
    const groups = [];
    const weapons = actor.items.filter(i => i.type === "weapon").map(i => ({
      id: i.id, name: i.name, img: i.img, meta: labelsToText(i), inactive: !i.system.equipped, toggle: equipToggle(i)
    }));
    if (weapons.length) groups.push({ title: game.i18n.localize("FCP.DH.Weapons"), items: weapons });

    const armor = actor.items.filter(i => i.type === "armor").map(i => ({
      id: i.id, name: i.name, img: i.img, meta: labelsToText(i), inactive: !i.system.equipped, toggle: equipToggle(i),
      uses: i.system.equipped ? { value: i.system.armor?.current ?? 0, max: i.system.armor?.max ?? 0 } : null
    }));
    if (armor.length) groups.push({ title: game.i18n.localize("FCP.DH.Armor"), items: armor });

    const withQty = i => [labelsToText(i) || game.i18n.localize(`FCP.DH.Kind.${i.type}`), i.system.quantity > 1 ? `×${i.system.quantity}` : ""].filter(Boolean).join(" · ");
    const consumables = actor.items.filter(i => i.type === "consumable").map(i => ({
      id: i.id, name: i.name, img: i.img, meta: withQty(i), uses: this.#itemResource(i),
      action: i.system.actionsList?.length ? "useItem" : null, actionLabel: game.i18n.localize("FCP.Use"), data: {}
    }));
    if (consumables.length) groups.push({ title: game.i18n.localize("FCP.DH.Consumables"), items: consumables });

    const loot = actor.items.filter(i => i.type === "loot").map(i => ({ id: i.id, name: i.name, img: i.img, meta: withQty(i) }));
    if (loot.length) groups.push({ title: game.i18n.localize("FCP.DH.Loot"), items: loot });

    const vault = (actor.system.domainCards?.vault ?? actor.items.filter(i => i.type === "domainCard" && i.system.inVault)).map(c => ({
      id: c.id, name: c.name, img: c.img, meta: labelsToText(c), inactive: true,
      // Two distinct moves, like the desktop sheet: a free move (downtime) and a recall that costs Stress.
      toggle: { action: "toggleItem", label: game.i18n.localize("FCP.DH.ToLoadout"), icon: "ph-duotone ph-arrow-up-right" },
      extra: [{ action: "toggleItem", label: game.i18n.localize("FCP.DH.Recall"), icon: "ph-duotone ph-lightning", data: { mode: "recall" } }]
    }));
    if (vault.length) groups.push({ title: game.i18n.localize("FCP.DH.Vault"), items: vault });

    if (actor.system.gold) {
      const line = this.#currencies(actor).map(c => `${c.value} ${c.name}`).join(" · ");
      if (line) groups.push({ title: game.i18n.localize("FCP.DH.Gold"), items: [{ id: "", name: line, img: "icons/commodities/currency/coins-plain-stack-gold.webp" }] });
    }
    return { groups };
  }

  /* ---------------- HP / resources ---------------- */

  hpPath() {
    return "system.resources.hitPoints.value";
  }

  async modifyHP(actor, delta) {
    // The header shows marked boxes: "+" marks one (damage), "−" clears one (healing).
    return actor.modifyResource([{ key: "hitPoints", value: delta }]);
  }

  async applyDamage(actor, amount) {
    // Goes through thresholds, armor slots and resistances exactly like the chat button.
    return actor.takeDamage({ total: amount });
  }

  async applyHealing(actor, amount) {
    return actor.takeHealing({ hitPoints: amount });
  }

  async counter(actor, key, delta) {
    if (key === "hp") return this.modifyHP(actor, delta);
    if (key === "armor") return actor.system.updateArmorValue({ value: delta });
    return actor.modifyResource([{ key, value: delta }]);
  }

  /* ---------------- Handlers ---------------- */

  #rollOptions() {
    const quick = getSetting(SETTINGS.QUICK_ROLLS);
    const advMode = CONFIG.Dice?.daggerheart?.D20Roll?.ADV_MODE ?? { NORMAL: 0, ADVANTAGE: 1, DISADVANTAGE: -1 };
    const roll = {};
    if (this.mode === "advantage") roll.advantage = advMode.ADVANTAGE;
    if (this.mode === "disadvantage") roll.advantage = advMode.DISADVANTAGE;
    return {
      event: {},
      dialog: { configure: !quick },
      roll,
      actionType: this.mode === "reaction" ? "reaction" : "action"
    };
  }

  async handle(actor, action, data) {
    switch (action) {
      case "roll": return this.#roll(actor, data);
      case "useItem": return this.#useItem(actor, data);
      case "toggleItem": return this.#toggleItem(actor, data);
      case "rest": return this.rest(actor, data.kind);
      case "counter": return this.counter(actor, data.key, Number(data.delta));
    }
    return false;
  }

  async #roll(actor, { kind, key }) {
    if (kind === "experience") {
      if (this.selectedExperiences.has(key)) this.selectedExperiences.delete(key);
      else this.selectedExperiences.add(key);
      return { rerender: ["sheet"] };
    }
    if (kind !== "trait") return false;

    const opts = this.#rollOptions();
    const experiences = Array.from(this.selectedExperiences).filter(id => actor.system.experiences?.[id]);
    const config = { ...opts, roll: { ...opts.roll, trait: key, type: "trait" } };
    if (experiences.length) config.experiences = experiences;

    const result = await actor.rollTrait(key, config);
    if (!result) return false;

    // Mirror what the system sheet does after a roll: apply queued hope/fear/stress changes and costs.
    if (result.resourceUpdates) {
      const costs = (result.costs ?? []).filter(c => c.enabled).map(c => ({ ...c, value: -c.value }));
      if (costs.length) result.resourceUpdates.addResources(costs);
      // Experiences used outside the dialog cost 1 Hope each.
      if (experiences.length && opts.dialog.configure === false) {
        result.resourceUpdates.addResources([{ key: "hope", value: -experiences.length }]);
      }
      await result.resourceUpdates.updateResources();
    }
    this.selectedExperiences.clear();
    return { rerender: ["sheet"] };
  }

  async #useItem(actor, { itemId, actionId }) {
    const opts = this.#rollOptions();
    const useOpts = { dialog: opts.dialog, event: {}, ...(opts.actionType === "reaction" ? { actionType: "reaction" } : {}) };
    if (actionId === "unarmed") return this.#useAction(actor.system.attack, useOpts, opts.roll.advantage);
    const item = actor.items.get(itemId);
    if (!item) return false;
    if (actionId === "attack") return this.#useAction(item.system.attack, useOpts, opts.roll.advantage);
    if (item.type === "domainCard" && item.system.isDomainTouchedSuppressed) {
      // Same check as Item#use on the desktop, which we skip by calling the action directly.
      const domain = game.i18n.localize(CONFIG.DH.DOMAIN.allDomains()[item.system.domain]?.label ?? "");
      return ui.notifications.warn(game.i18n.format("DAGGERHEART.UI.Notifications.domainTouchRequirement", { nr: item.system.domainTouched, domain }));
    }
    if (actionId) {
      const action = item.system.actions?.get(actionId);
      if (action) return this.#useAction(action, useOpts, opts.roll.advantage);
    }
    return item.use({});
  }

  /**
   * Use an action with the phone's advantage/disadvantage. The system rebuilds `config.roll` from the
   * action itself, so options cannot carry it: it is set in preUseAction, only for this action.
   */
  async #useAction(action, useOpts, advantage) {
    let hook = null;
    if (advantage) {
      hook = Hooks.on(`${CONFIG.DH.id}.preUseAction`, (a, config) => {
        if (a === action && config.roll) config.roll.advantage = advantage;
      });
    }
    try {
      return await action.use({}, useOpts);
    } finally {
      if (hook !== null) Hooks.off(`${CONFIG.DH.id}.preUseAction`, hook);
    }
  }

  async #toggleItem(actor, { itemId, mode }) {
    const item = actor.items.get(itemId);
    if (!item) return false;
    // Vault -> loadout is free unless the player asked for a recall (which pays the Stress cost).
    if (item.type === "domainCard") return item.system.toggleVault({}, !item.system.inVault, mode === "recall");
    if (item.type === "weapon" || item.type === "armor") {
      if (item.system.equipped) return item.update({ "system.equipped": false });
      // Same rules as the desktop sheet's equip button (#toggleEquipItem).
      if (item.type === "armor") {
        await actor.system.armor?.update({ "system.equipped": false });
      } else {
        if (actor.effects.find(e => !e.disabled && e.type === "beastform")) {
          return ui.notifications.warn(game.i18n.localize("DAGGERHEART.UI.Notifications.beastformEquipWeapon"));
        }
        // unequipBeforeEquip is a static method that expects the system as `this`.
        await actor.system.constructor.unequipBeforeEquip.call(actor.system, item);
      }
      return item.update({ "system.equipped": true });
    }
    return false;
  }

  async rest(actor, kind) {
    const dialogs = game.system.api?.applications?.dialogs;
    if (!dialogs) return false;
    if (kind === "deathMove") return new dialogs.DeathMove(actor).render({ force: true });
    return new dialogs.Downtime(actor, kind === "short").render({ force: true });
  }
}
