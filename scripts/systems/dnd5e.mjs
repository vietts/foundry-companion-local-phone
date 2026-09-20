import { SystemAdapter, loc } from "./base.mjs";
import { SETTINGS } from "../constants.mjs";
import { getSetting } from "../settings.mjs";

function signed(n) {
  n = Number(n) || 0;
  return n >= 0 ? `+${n}` : `${n}`;
}

function damageText(item) {
  const damages = item.labels?.damages ?? [];
  return damages.map(d => [d.formula, d.damageType ?? d.label].filter(Boolean).join(" ")).join(", ");
}

/**
 * D&D 5e (dnd5e 5.x / 6.x). Uses the system's own roll pipeline so results land in chat
 * exactly like a roll from the desktop sheet.
 */
export class Dnd5eAdapter extends SystemAdapter {
  static id = "dnd5e";

  mode = "normal"; // normal | advantage | disadvantage

  isPlayable(actor) {
    return actor.type === "character";
  }

  subtitle(actor) {
    const s = actor.system;
    const classes = Object.values(actor.classes ?? {}).map(c => `${c.name} ${c.system.levels}`).join(" / ");
    const race = s.details?.race?.name ?? (typeof s.details?.race === "string" ? s.details.race : "");
    return [race, classes || `${game.i18n.localize("FCP.Level")} ${s.details?.level ?? ""}`].filter(Boolean).join(" · ");
  }

  /* ---------------- Header ---------------- */

  async prepareHeader(actor) {
    const a = actor.system.attributes;
    const stats = [
      { label: loc("DND5E.AC"), value: a.ac?.value ?? "—" },
      { label: loc("DND5E.Proficiency"), value: signed(a.prof) },
      { label: loc("DND5E.Initiative"), value: signed(a.init?.total) },
      { label: loc("DND5E.Speed"), value: a.movement?.speeds?.walk ?? a.movement?.walk ?? "—" }
    ];
    if (a.spellcasting && a.spell?.dc) stats.push({ label: loc("DND5E.SpellDC"), value: a.spell.dc });
    return {
      hp: { value: a.hp.value, max: a.hp.effectiveMax ?? a.hp.max, temp: a.hp.temp || 0 },
      stats,
      counters: []
    };
  }

  /* ---------------- Sheet ---------------- */

  async prepareSheet(actor) {
    const s = actor.system;
    const abilities = CONFIG.DND5E.abilities;
    const skills = CONFIG.DND5E.skills;

    const abilityTiles = Object.entries(s.abilities).map(([key, ab]) => ({
      label: abilities[key]?.abbreviation ?? key,
      value: signed(ab.mod),
      sub: String(ab.value),
      action: "roll",
      data: { kind: "ability", key }
    }));

    const saveTiles = Object.entries(s.abilities).map(([key, ab]) => ({
      label: abilities[key]?.abbreviation ?? key,
      value: signed(ab.save?.value ?? ab.save),
      prof: (ab.proficient ?? 0) > 0,
      action: "roll",
      data: { kind: "save", key }
    }));

    const skillTiles = Object.entries(s.skills)
      .map(([key, sk]) => ({
        label: skills[key]?.label ?? key,
        sub: `${abilities[sk.ability]?.abbreviation ?? sk.ability} · ${loc("DND5E.Passive")} ${sk.passive}`,
        value: signed(sk.total),
        prof: (sk.proficient ?? sk.value ?? 0) > 0,
        action: "roll",
        data: { kind: "skill", key }
      }))
      .sort((x, y) => x.label.localeCompare(y.label));

    const other = [
      { label: loc("DND5E.Initiative"), value: signed(s.attributes.init?.total), action: "roll", data: { kind: "initiative" } }
    ];
    const hd = s.attributes.hd;
    if (hd && typeof hd === "object") {
      other.push({ label: loc("DND5E.HitDice"), value: `${hd.value ?? 0}/${hd.max ?? 0}`, action: "roll", data: { kind: "hitDie" } });
    }
    if (s.attributes.hp.value <= 0) {
      const d = s.attributes.death ?? {};
      other.push({
        label: loc("DND5E.DeathSave"),
        value: `✓${d.success ?? 0} ✗${d.failure ?? 0}`,
        action: "roll",
        data: { kind: "deathSave" }
      });
    }
    const concentrating = actor.statuses?.has(CONFIG.specialStatusEffects?.CONCENTRATING ?? "concentrating");
    if (concentrating) {
      other.push({ label: loc("DND5E.Concentration"), value: "d20", action: "roll", data: { kind: "concentration" } });
    }

    const slotTiles = [];
    for (const [key, slot] of Object.entries(s.spells ?? {})) {
      if (!slot?.max) continue;
      slotTiles.push({ label: slot.label ?? key, value: `${slot.value}/${slot.max}`, action: "noop", data: {} });
    }

    const sections = [
      { title: loc("DND5E.Abilities"), layout: "grid", cols: 3, tiles: abilityTiles },
      { title: loc("DND5E.ClassSaves"), layout: "grid", cols: 3, tiles: saveTiles },
      { title: loc("DND5E.Skills"), layout: "list", tiles: skillTiles },
      { title: game.i18n.localize("FCP.Other"), layout: "grid", cols: 2, tiles: other }
    ];
    if (slotTiles.length) sections.push({ title: game.i18n.localize("FCP.SpellSlots"), layout: "grid", cols: 3, tiles: slotTiles });

    return {
      modes: [
        { key: "normal", label: game.i18n.localize("FCP.Normal"), active: this.mode === "normal" },
        { key: "advantage", label: game.i18n.localize("FCP.Advantage"), active: this.mode === "advantage" },
        { key: "disadvantage", label: game.i18n.localize("FCP.Disadvantage"), active: this.mode === "disadvantage" }
      ],
      sections,
      rests: [
        { kind: "short", label: game.i18n.localize("FCP.Rest.Short") },
        { kind: "long", label: game.i18n.localize("FCP.Rest.Long") }
      ]
    };
  }

  conditions(actor) {
    const active = actor.statuses ?? new Set();
    const types = CONFIG.DND5E?.conditionTypes;
    if (!types) return super.conditions(actor);
    return Object.entries(types)
      .filter(([, c]) => !c.pseudo)
      .map(([id, c]) => ({ id, name: game.i18n.localize(c.name ?? c.label ?? id), img: c.img ?? c.icon, active: active.has(id) }));
  }

  /* ---------------- Actions ---------------- */

  #uses(item) {
    const u = item.system.uses;
    if (!u || !u.max) return null;
    return { value: u.value ?? 0, max: u.max };
  }

  #row(item, { meta, actionLabel } = {}) {
    return {
      id: item.id,
      name: item.name,
      img: item.img,
      meta: meta ?? "",
      uses: this.#uses(item),
      action: "useItem",
      actionLabel: actionLabel ?? game.i18n.localize("FCP.Use"),
      data: {}
    };
  }

  async prepareActions(actor) {
    const groups = [];
    const hasActivities = i => (i.system.activities?.size ?? 0) > 0;

    // Attacks: anything with an attack activity; unequipped weapons shown dimmed.
    const attacks = actor.items
      .filter(i => i.hasAttack && !i.system.isHidden)
      .sort((a, b) => Number(b.system.equipped ?? true) - Number(a.system.equipped ?? true) || a.name.localeCompare(b.name))
      .map(i => ({
        ...this.#row(i, { meta: [i.labels?.toHit, damageText(i), i.labels?.range].filter(Boolean).join(" · "), actionLabel: loc("DND5E.Attack") }),
        inactive: i.type === "weapon" && i.system.equipped === false
      }));
    if (attacks.length) groups.push({ title: loc("DND5E.AttackPl", "Attacks"), items: attacks });

    // Spells: only castable ones (prepared, always prepared, cantrips, innate/at-will/pact/ritual).
    const spells = actor.items.filter(i => i.type === "spell" && this.#castable(i));
    const byLevel = new Map();
    for (const sp of spells) {
      const lvl = sp.system.level ?? 0;
      if (!byLevel.has(lvl)) byLevel.set(lvl, []);
      byLevel.get(lvl).push(sp);
    }
    for (const lvl of Array.from(byLevel.keys()).sort((a, b) => a - b)) {
      const slot = lvl > 0 ? actor.system.spells?.[`spell${lvl}`] : null;
      const pact = actor.system.spells?.pact;
      let title = CONFIG.DND5E.spellLevels?.[lvl] ?? `Level ${lvl}`;
      if (slot?.max) title += ` · ${slot.value}/${slot.max}`;
      else if (pact?.max && byLevel.get(lvl).some(sp => sp.system.method === "pact")) title += ` · ${pact.label ?? "Pact"} ${pact.value}/${pact.max}`;
      groups.push({
        title,
        items: byLevel.get(lvl)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(sp => this.#row(sp, {
            meta: [sp.labels?.activation, sp.labels?.range, sp.labels?.components?.vsm, sp.system.method && sp.system.method !== "spell" ? CONFIG.DND5E.spellcasting?.[sp.system.method]?.label : null].filter(Boolean).join(" · "),
            actionLabel: game.i18n.localize("FCP.Cast")
          }))
      });
    }

    // Features with something to activate.
    const feats = actor.items
      .filter(i => i.type === "feat" && hasActivities(i) && !i.hasAttack)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(i => this.#row(i, { meta: [i.labels?.activation, i.labels?.featType].filter(Boolean).join(" · ") }));
    if (feats.length) groups.push({ title: loc("DND5E.Features"), items: feats });

    // Consumables and other usable gear.
    const usable = actor.items
      .filter(i => ["consumable", "equipment", "tool"].includes(i.type) && hasActivities(i) && !i.hasAttack)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(i => this.#row(i, { meta: i.labels?.activation ?? "" }));
    if (usable.length) groups.push({ title: loc("TYPES.Item.consumablePl", "Consumables"), items: usable });

    return { groups };
  }

  #castable(spell) {
    const sys = spell.system;
    if ((sys.level ?? 0) === 0) return true;
    if (sys.method && sys.method !== "spell") return true; // pact, innate, atwill, ritual
    if (sys.preparation) return sys.preparation.mode !== "prepared" || !!sys.preparation.prepared; // dnd5e 4/5
    return (sys.prepared ?? 0) > 0; // dnd5e 6
  }

  /* ---------------- Inventory ---------------- */

  async prepareInventory(actor) {
    const groups = [];
    const equipToggle = item => ({
      action: "toggleItem",
      label: game.i18n.localize("FCP.Equipped"),
      icon: item.system.equipped ? "fas fa-check-circle" : "far fa-circle"
    });
    const invRow = (i, extra = {}) => ({
      id: i.id, name: i.name, img: i.img,
      meta: [i.system.quantity > 1 ? `×${i.system.quantity}` : null, i.system.weight?.value ? `${i.system.weight.value} ${i.system.weight.units ?? ""}`.trim() : null].filter(Boolean).join(" · "),
      uses: this.#uses(i),
      ...extra
    });

    const sections = [
      ["weapon", loc("TYPES.Item.weaponPl", "Weapons"), true],
      ["equipment", loc("TYPES.Item.equipmentPl", "Equipment"), true],
      ["consumable", loc("TYPES.Item.consumablePl", "Consumables"), false],
      ["tool", loc("TYPES.Item.toolPl", "Tools"), false],
      ["container", loc("TYPES.Item.containerPl", "Containers"), false],
      ["loot", loc("TYPES.Item.lootPl", "Loot"), false]
    ];
    for (const [type, title, equippable] of sections) {
      const items = actor.items.filter(i => i.type === type && !i.system.container).sort((a, b) => a.name.localeCompare(b.name))
        .map(i => invRow(i, equippable ? { inactive: !i.system.equipped, toggle: equipToggle(i) } : {}));
      if (items.length) groups.push({ title, items });
    }

    // Spellbook: every spell, with a prepare toggle where it applies.
    const spells = actor.items.filter(i => i.type === "spell").sort((a, b) => (a.system.level - b.system.level) || a.name.localeCompare(b.name));
    if (spells.length) {
      groups.push({
        title: loc("DND5E.Spellbook", "Spellbook"),
        items: spells.map(sp => {
          const canPrepare = sp.system.canPrepare ?? (sp.system.level > 0 && (!sp.system.method || sp.system.method === "spell"));
          const prepared = this.#castable(sp);
          return {
            id: sp.id, name: sp.name, img: sp.img,
            meta: [CONFIG.DND5E.spellLevels?.[sp.system.level], CONFIG.DND5E.spellSchools?.[sp.system.school]?.label].filter(Boolean).join(" · "),
            inactive: !prepared,
            toggle: canPrepare ? { action: "toggleItem", label: game.i18n.localize("FCP.Prepared"), icon: prepared ? "fas fa-check-circle" : "far fa-circle" } : null
          };
        })
      });
    }

    const c = actor.system.currency;
    if (c) {
      groups.push({
        title: loc("DND5E.Currency"),
        items: [{ id: "", name: Object.entries(c).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(" · ") || "0", img: "icons/commodities/currency/coins-plain-stack-gold.webp" }]
      });
    }
    return { groups };
  }

  /* ---------------- HP ---------------- */

  hpPath() {
    return "system.attributes.hp.value";
  }

  async modifyHP(actor, delta) {
    return actor.applyDamage(-delta);
  }

  async applyDamage(actor, amount) {
    return actor.applyDamage(Math.abs(amount));
  }

  async applyHealing(actor, amount) {
    return actor.applyDamage(-Math.abs(amount));
  }

  /* ---------------- Handlers ---------------- */

  #dialog() {
    return { configure: !getSetting(SETTINGS.QUICK_ROLLS) };
  }

  #adv() {
    return { advantage: this.mode === "advantage", disadvantage: this.mode === "disadvantage" };
  }

  async handle(actor, action, data) {
    switch (action) {
      case "roll": return this.#roll(actor, data);
      case "useItem": return this.#useItem(actor, data);
      case "toggleItem": return this.#toggleItem(actor, data);
      case "rest": return this.rest(actor, data.kind);
    }
    return false;
  }

  async #roll(actor, { kind, key }) {
    const dialog = this.#dialog();
    const adv = this.#adv();
    switch (kind) {
      case "ability": return actor.rollAbilityCheck({ ability: key, ...adv }, dialog);
      case "save": return actor.rollSavingThrow({ ability: key, ...adv }, dialog);
      case "skill": return actor.rollSkill({ skill: key, ...adv }, dialog);
      case "initiative":
        if (dialog.configure) return actor.rollInitiativeDialog(adv);
        return actor.rollInitiative({ createCombatants: true }, adv);
      case "hitDie": return actor.rollHitDie({}, dialog);
      case "deathSave": return actor.rollDeathSave({ ...adv }, dialog);
      case "concentration": return actor.rollConcentration({ ...adv }, dialog);
    }
    return false;
  }

  async #useItem(actor, { itemId }) {
    const item = actor.items.get(itemId);
    if (!item) return false;
    return item.use({ event: {} }, this.#dialog(), {});
  }

  async #toggleItem(actor, { itemId }) {
    const item = actor.items.get(itemId);
    if (!item) return false;
    if (item.type === "spell") {
      if (item.system.preparation) return item.update({ "system.preparation.prepared": !item.system.preparation.prepared });
      return item.update({ "system.prepared": Number(!item.system.prepared) });
    }
    if ("equipped" in item.system) return item.update({ "system.equipped": !item.system.equipped });
    return false;
  }

  async rest(actor, kind) {
    if (kind === "short") return actor.shortRest();
    if (kind === "long") return actor.longRest();
    return false;
  }
}
