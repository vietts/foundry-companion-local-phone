import { SystemAdapter, loc } from "./base.mjs";
import { SETTINGS } from "../constants.mjs";
import { getSetting } from "../settings.mjs";

const TRAITS = ["agility", "strength", "finesse", "instinct", "presence", "knowledge"];

function signed(n) {
  n = Number(n) || 0;
  return n >= 0 ? `+${n}` : `${n}`;
}

function labelsToText(item) {
  try {
    const labels = item._getLabels?.() ?? [];
    return labels.map(l => (typeof l === "string" ? l : l?.value)).filter(Boolean).join(" · ");
  } catch (err) {
    return "";
  }
}

/**
 * Daggerheart (Foundryborne system, 2.x).
 * HP and Stress are "reversed" resources: value = boxes marked. The companion shows remaining HP.
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
    const parts = [];
    const cls = s.class?.value?.name;
    const sub = s.class?.subclass?.name;
    if (cls) parts.push(sub ? `${cls} (${sub})` : cls);
    const anc = s.ancestry?.name;
    if (anc) parts.push(anc);
    const lvl = s.levelData?.level?.current;
    if (lvl) parts.push(`${game.i18n.localize("FCP.Level")} ${lvl}`);
    return parts.join(" · ");
  }

  /* ---------------- Header ---------------- */

  async prepareHeader(actor) {
    const r = actor.system.resources;
    const hp = r.hitPoints;
    const stats = [
      { label: loc("DAGGERHEART.GENERAL.evasion"), value: actor.system.evasion },
      { label: loc("DAGGERHEART.GENERAL.armor"), value: `${r.armor?.value ?? 0}/${r.armor?.max ?? 0}` },
      { label: loc("DAGGERHEART.GENERAL.DamageThresholds.major", "Major"), value: actor.system.damageThresholds?.major ?? "—" },
      { label: loc("DAGGERHEART.GENERAL.DamageThresholds.severe", "Severe"), value: actor.system.damageThresholds?.severe ?? "—" }
    ];

    const counters = [
      { key: "hope", label: loc("DAGGERHEART.GENERAL.hope"), value: r.hope.value, max: r.hope.max },
      { key: "stress", label: loc("DAGGERHEART.GENERAL.stress"), value: r.stress.value, max: r.stress.max },
      { key: "armor", label: loc("DAGGERHEART.GENERAL.armor"), value: r.armor?.value ?? 0, max: r.armor?.max ?? 0 }
    ];
    return {
      hp: { value: Math.max(0, (hp.max ?? 0) - (hp.value ?? 0)), max: hp.max ?? 0, temp: 0 },
      stats,
      counters
    };
  }

  /* ---------------- Sheet ---------------- */

  async prepareSheet(actor) {
    const s = actor.system;
    const traitLabel = key => {
      const cfg = CONFIG.DH?.ACTOR?.abilities?.[key];
      return cfg?.label ? game.i18n.localize(cfg.label) : key;
    };

    const sections = [
      {
        title: loc("DAGGERHEART.GENERAL.Trait.plural", "Traits"),
        layout: "grid",
        cols: 3,
        tiles: TRAITS.map(key => ({
          label: traitLabel(key),
          value: signed(s.traits?.[key]?.value),
          action: "roll",
          data: { kind: "trait", key }
        }))
      }
    ];

    const experiences = Object.entries(s.experiences ?? {}).map(([id, e]) => ({
      label: e.name || "—",
      value: signed(e.value),
      sub: this.selectedExperiences.has(id) ? game.i18n.localize("FCP.DH.ExperienceSelected") : game.i18n.localize("FCP.DH.ExperienceHint"),
      prof: this.selectedExperiences.has(id),
      action: "roll",
      data: { kind: "experience", key: id }
    }));
    if (experiences.length) {
      sections.push({ title: loc("DAGGERHEART.GENERAL.Experience.plural", "Experiences"), layout: "list", tiles: experiences });
    }

    const rests = [
      { kind: "short", label: game.i18n.localize("FCP.Rest.Short") },
      { kind: "long", label: game.i18n.localize("FCP.Rest.Long") }
    ];
    if (s.deathMoveViable) rests.push({ kind: "deathMove", label: game.i18n.localize("FCP.DH.DeathMove") });

    return {
      modes: [
        { key: "action", label: game.i18n.localize("FCP.DH.Action"), active: this.mode === "action" },
        { key: "reaction", label: game.i18n.localize("FCP.DH.Reaction"), active: this.mode === "reaction" },
        { key: "advantage", label: game.i18n.localize("FCP.Advantage"), active: this.mode === "advantage" },
        { key: "disadvantage", label: game.i18n.localize("FCP.Disadvantage"), active: this.mode === "disadvantage" }
      ],
      sections,
      rests
    };
  }

  /* ---------------- Actions ---------------- */

  #actionRows(item, { actionLabel } = {}) {
    const list = item.system.actionsList ?? [];
    const rows = [];
    for (const action of list) {
      const isAttack = action === item.system.attack;
      rows.push({
        id: item.id,
        name: list.length > 1 && action.name && action.name !== item.name ? `${item.name}: ${action.name}` : item.name,
        img: action.img || item.img,
        meta: isAttack ? labelsToText(item) : (action.name && list.length <= 1 ? "" : action.name ?? ""),
        uses: action.uses?.max ? { value: action.remainingUses ?? action.uses.value, max: action.uses.max } : null,
        action: "useItem",
        actionLabel: actionLabel ?? game.i18n.localize("FCP.Use"),
        data: { "action-id": isAttack ? "attack" : action.id }
      });
    }
    return rows;
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
    const cards = [];
    for (const c of loadout) {
      const rows = this.#actionRows(c);
      if (rows.length) cards.push(...rows.map(r => ({ ...r, meta: [labelsToText(c), r.meta].filter(Boolean).join(" · "), uses: r.uses ?? this.#itemResource(c) })));
      else cards.push({ id: c.id, name: c.name, img: c.img, meta: labelsToText(c), uses: this.#itemResource(c), toggle: { action: "toggleItem", label: game.i18n.localize("FCP.DH.ToVault"), icon: "fas fa-box-archive" } });
    }
    if (cards.length) groups.push({ title: game.i18n.localize("FCP.DH.Loadout"), items: cards });

    // Features with actions (class, subclass, ancestry, community, beastform...).
    const featureRows = [];
    for (const f of actor.items.filter(i => i.type === "feature")) {
      featureRows.push(...this.#actionRows(f).map(r => ({ ...r, uses: r.uses ?? this.#itemResource(f) })));
    }
    if (featureRows.length) groups.push({ title: game.i18n.localize("FCP.DH.Features"), items: featureRows });

    return { groups };
  }

  #itemResource(item) {
    const res = item.system.resource;
    if (!res || (!res.max && !res.value)) return null;
    let max = res.max;
    if (typeof max === "string") {
      try { max = Roll.safeEval(Roll.replaceFormulaData(max, item.actor?.getRollData() ?? {})); } catch (err) { max = "?"; }
    }
    return { value: res.value ?? 0, max: max ?? "∞" };
  }

  /* ---------------- Inventory ---------------- */

  async prepareInventory(actor) {
    const groups = [];
    const equipToggle = item => ({
      action: "toggleItem",
      label: game.i18n.localize("FCP.Equipped"),
      icon: item.system.equipped ? "fas fa-check-circle" : "far fa-circle"
    });

    const weapons = actor.items.filter(i => i.type === "weapon").map(i => ({
      id: i.id, name: i.name, img: i.img, meta: labelsToText(i), inactive: !i.system.equipped, toggle: equipToggle(i)
    }));
    if (weapons.length) groups.push({ title: game.i18n.localize("FCP.DH.Weapons"), items: weapons });

    const armor = actor.items.filter(i => i.type === "armor").map(i => ({
      id: i.id, name: i.name, img: i.img, meta: labelsToText(i), inactive: !i.system.equipped, toggle: equipToggle(i),
      uses: i.system.equipped ? { value: i.system.armor?.current ?? 0, max: i.system.armor?.max ?? 0 } : null
    }));
    if (armor.length) groups.push({ title: game.i18n.localize("FCP.DH.Armor"), items: armor });

    const consumables = actor.items.filter(i => i.type === "consumable").map(i => ({
      id: i.id, name: i.name, img: i.img, meta: labelsToText(i), uses: this.#itemResource(i),
      action: i.system.actionsList?.length ? "useItem" : null, actionLabel: game.i18n.localize("FCP.Use"), data: {}
    }));
    if (consumables.length) groups.push({ title: game.i18n.localize("FCP.DH.Consumables"), items: consumables });

    const loot = actor.items.filter(i => i.type === "loot").map(i => ({ id: i.id, name: i.name, img: i.img, meta: labelsToText(i) }));
    if (loot.length) groups.push({ title: game.i18n.localize("FCP.DH.Loot"), items: loot });

    const vault = (actor.system.domainCards?.vault ?? actor.items.filter(i => i.type === "domainCard" && i.system.inVault)).map(c => ({
      id: c.id, name: c.name, img: c.img, meta: labelsToText(c), inactive: true,
      toggle: { action: "toggleItem", label: game.i18n.localize("FCP.DH.ToLoadout"), icon: "fas fa-arrow-up-from-bracket" }
    }));
    if (vault.length) groups.push({ title: game.i18n.localize("FCP.DH.Vault"), items: vault });

    const g = actor.system.gold;
    if (g) {
      groups.push({
        title: game.i18n.localize("FCP.DH.Gold"),
        items: [{ id: "", name: `${g.chests ?? 0} 🧰 · ${g.bags ?? 0} 👝 · ${g.handfuls ?? 0} ✋ · ${g.coins ?? 0} 🪙`, img: "icons/commodities/currency/coins-plain-stack-gold.webp" }]
      });
    }
    return { groups };
  }

  /* ---------------- HP / resources ---------------- */

  hpPath() {
    return "system.resources.hitPoints.value";
  }

  async modifyHP(actor, delta) {
    // Reversed resource: damage marks boxes (positive), healing clears them (negative).
    return actor.modifyResource([{ key: "hitPoints", value: -delta }]);
  }

  async applyDamage(actor, amount) {
    // Goes through thresholds, armor slots and resistances exactly like the chat button.
    return actor.takeDamage({ total: amount });
  }

  async applyHealing(actor, amount) {
    return actor.takeHealing({ hitPoints: amount });
  }

  async counter(actor, key, delta) {
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
      // Re-render the sheet part so the selection shows.
      game.modules.get("foundry-companion-local-phone")?.api?.getApp()?.markDirty("sheet");
      return true;
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
    return true;
  }

  async #useItem(actor, { itemId, actionId }) {
    const opts = this.#rollOptions();
    const useOpts = { dialog: opts.dialog, event: {} };
    if (actionId === "unarmed") return actor.system.attack.use({}, useOpts);
    const item = actor.items.get(itemId);
    if (!item) return false;
    if (actionId === "attack") return item.system.attack.use({}, useOpts);
    if (actionId) {
      const action = item.system.actions?.get(actionId);
      if (action) return action.use({}, useOpts);
    }
    return item.use({});
  }

  async #toggleItem(actor, { itemId }) {
    const item = actor.items.get(itemId);
    if (!item) return false;
    if (item.type === "domainCard") return item.system.toggleVault({}, !item.system.inVault, item.system.inVault);
    if (item.type === "weapon" || item.type === "armor") {
      if (!item.system.equipped && typeof actor.system.unequipBeforeEquip === "function") {
        await actor.system.unequipBeforeEquip(item);
      }
      return item.update({ "system.equipped": !item.system.equipped });
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
