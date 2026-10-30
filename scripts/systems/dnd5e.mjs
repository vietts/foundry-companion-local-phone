import { SystemAdapter, signed, equipToggle, plainText } from "./base.mjs";
import { SETTINGS } from "../constants.mjs";
import { getSetting } from "../settings.mjs";
import { spellSources, openSpellStep, isCaster } from "../app/spell-step.mjs";

const t = key => game.i18n.localize(key);
const f = (key, data) => game.i18n.format(key, data);

function damageText(item) {
  const damages = item.labels?.damages ?? [];
  return damages.map(d => [d.formula, d.damageType ?? d.label].filter(Boolean).join(" ")).join(", ");
}

/** Boxes for a meter: box n is filled when n <= filled. */
function boxes(max, filled) {
  return Array.from({ length: max }, (_, i) => ({ on: i < filled, n: i + 1 }));
}

/** Number in the user's locale ("7,5" in Italian). */
function num(n) {
  return new Intl.NumberFormat(game.i18n.lang).format(n);
}

const MARKERS = { 0.5: "◇", 1: "◆", 2: "◆◆" };

/**
 * D&D 5e (dnd5e 5.x / 6.x). Uses the system's own roll pipeline so results land in chat
 * exactly like a roll from the desktop sheet.
 */
export class Dnd5eAdapter extends SystemAdapter {
  static id = "dnd5e";

  mode = "normal"; // normal | advantage | disadvantage

  /** Opening an item with digital dice off pins its to-hit and damage in the header. */
  pinOnExpand = true;

  /** Player characters, plus creatures they summoned (dnd5e marks them with flags.dnd5e.summon). */
  isPlayable(actor) {
    return actor.type === "character" || this.#isSummon(actor);
  }

  #isSummon(actor) {
    return actor.type === "npc" && !!actor.getFlag("dnd5e", "summon");
  }

  subtitle(actor) {
    if (this.#isSummon(actor)) {
      const origin = actor.getFlag("dnd5e", "summon")?.origin;
      const owner = origin ? fromUuidSync(origin)?.actor?.name : null;
      return owner ? f("FCP.D5.SummonedBy", { name: owner }) : t("FCP.D5.Summon");
    }
    const s = actor.system;
    const classes = Object.values(actor.classes ?? {}).map(c => `${c.name} ${c.system.levels}`).join(" / ");
    const race = s.details?.race?.name ?? (typeof s.details?.race === "string" ? s.details.race : "");
    return [race, classes || `${t("FCP.Level")} ${s.details?.level ?? ""}`].filter(Boolean).join(" · ");
  }

  kicker(actor) {
    const lvl = actor.system.details?.level;
    return ["D&D 5e", lvl ? `${t("FCP.LevelShort")} ${lvl}` : null].filter(Boolean).join(" · ");
  }

  sheetPanes() {
    return [{ key: "stats", label: t("FCP.D5.PaneStats") }, { key: "skills", label: t("FCP.D5.PaneSkills") }];
  }

  /* ---------------- Header ---------------- */

  /** Spell slot pools with a maximum, in level order, pact slots last. */
  #slots(actor) {
    const spells = actor.system.spells ?? {};
    const out = [];
    for (let lvl = 1; lvl <= 9; lvl++) {
      const s = spells[`spell${lvl}`];
      if (s?.max) out.push({ key: `spell${lvl}`, level: lvl, value: s.value ?? 0, max: s.max, pact: false });
    }
    const p = spells.pact;
    if (p?.max) out.push({ key: "pact", level: p.level ?? 1, value: p.value ?? 0, max: p.max, pact: true });
    return out;
  }

  #weightUnits() {
    try {
      const unit = dnd5e.utils?.defaultUnits?.("weight");
      return CONFIG.DND5E.weightUnits?.[unit]?.abbreviation ?? unit ?? "";
    } catch (err) {
      return "";
    }
  }

  #coins(actor) {
    const c = actor.system.currency ?? {};
    return Object.entries(c).filter(([, v]) => v).map(([k, v]) => `${v} ${CONFIG.DND5E.currencies?.[k]?.abbreviation ?? k}`).join(" · ");
  }

  async prepareHeader(actor) {
    const a = actor.system.attributes;
    const hp = a.hp;
    const max = hp.effectiveMax ?? hp.max ?? 0;
    const value = Math.max(hp.value ?? 0, 0);
    const temp = hp.temp || 0;
    const total = Math.max(max + temp, 1);

    const move = a.movement ?? {};
    const walk = move.walk ?? move.speeds?.walk;
    const speed = walk ? `${num(walk)} ${move.units ?? ""}`.trim() : "—";
    const caster = !!(a.spellcasting && a.spell?.dc);
    // Initiative last: it is the one that rolls, a green chip at the end of a row of plain numbers.
    const stats = [
      { label: t("FCP.D5.AC"), value: a.ac?.value ?? "—" },
      { label: t("FCP.D5.Prof"), value: signed(a.prof) },
      caster ? { label: t("FCP.D5.SpellDC"), value: a.spell.dc } : { label: t("FCP.D5.Speed"), value: speed },
      { label: t("FCP.D5.Initiative"), value: signed(a.init?.total), action: "roll", data: { kind: "initiative", pin: "init" } }
    ];

    const d = a.death ?? {};
    const slots = this.#slots(actor);
    const slotText = slots.length ? `${t("FCP.D5.Slot")} ${slots.map(s => `${s.value}/${s.max}`).join(" · ")}` : null;
    const enc = a.encumbrance;
    const weight = enc?.value ? f("FCP.D5.Carried", { w: `${num(enc.value)} ${this.#weightUnits()}`.trim() }) : null;

    return {
      hpBar: {
        value, max, temp,
        hpPct: `${Math.round(value / total * 100)}%`,
        tempPct: `${Math.round(temp / total * 100)}%`
      },
      death: value <= 0 && actor.type === "character" ? {
        rows: [
          { key: "death.success", label: t("FCP.D5.Successes"), boxes: boxes(3, d.success ?? 0) },
          { key: "death.failure", label: t("FCP.D5.Failures"), boxes: boxes(3, d.failure ?? 0) }
        ]
      } : null,
      stats,
      modes: [
        { key: "normal", label: t("FCP.Normal"), active: this.mode === "normal" },
        { key: "advantage", label: t("FCP.Advantage"), active: this.mode === "advantage" },
        { key: "disadvantage", label: t("FCP.D5.DisadvantageShort"), active: this.mode === "disadvantage" }
      ],
      summary: {
        actions: [`${t("FCP.HP")} ${value}/${max}`, `${t("FCP.D5.AC")} ${a.ac?.value ?? "—"}`, slotText].filter(Boolean).join(" · "),
        inventory: [this.#coins(actor), weight].filter(Boolean).join(" · ")
      }
    };
  }

  /* ---------------- Sheet ---------------- */

  #skillLabel(key) {
    return CONFIG.DND5E.skills[key]?.label ?? key;
  }

  #abbr(key) {
    return String(CONFIG.DND5E.abilities[key]?.abbreviation ?? key).toUpperCase();
  }

  #skillTile(key, sk, { feature = false } = {}) {
    const mult = Number(sk.value ?? sk.proficient ?? 0);
    const sub = [`${this.#abbr(sk.ability)} · ${t("FCP.D5.Passive")} ${sk.passive}`];
    if (feature && mult === 2) sub.push(t("FCP.D5.Expertise"));
    return {
      label: this.#skillLabel(key),
      sub: sub.join(" · "),
      value: signed(sk.total),
      marker: MARKERS[mult] ?? "",
      inactive: !feature && !mult,
      action: "roll",
      data: { kind: "skill", key, pin: `skill:${key}` }
    };
  }

  /** Features with limited uses: the "Resources" block. */
  #resources(actor) {
    return actor.items
      .filter(i => i.type === "feat" && i.system.uses?.max)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(i => {
        const { value = 0, max } = i.system.uses;
        return {
          id: i.id,
          name: i.name,
          recharge: [i.labels?.recovery, i.labels?.activation].filter(Boolean).join(" · "),
          count: `${value} / ${max}`,
          spent: value < max
        };
      });
  }

  async prepareSheet(actor) {
    const s = actor.system;
    const a = s.attributes;
    const sections = [];

    sections.push({
      pane: "stats", title: t("FCP.D5.Abilities"), layout: "grid", cols: 3, stack: true,
      tiles: Object.entries(s.abilities).map(([key, ab]) => ({
        label: `${this.#abbr(key)} · ${ab.value}`,
        value: signed(ab.mod),
        zero: ab.mod <= 0,
        action: "roll",
        data: { kind: "ability", key, pin: `ability:${key}` }
      }))
    });

    // Saves as a grid of chips under the abilities, with the short names ("Des +2").
    sections.push({
      pane: "stats", title: t("FCP.D5.Saves"), layout: "grid", cols: 3, inline: true,
      tiles: Object.entries(s.abilities).map(([key, ab]) => ({
        label: game.i18n.has?.(`FCP.D5.Ab.${key}`) ? t(`FCP.D5.Ab.${key}`) : CONFIG.DND5E.abilities[key]?.label ?? key,
        value: signed(ab.save?.value ?? ab.save),
        marker: (ab.proficient ?? 0) > 0 ? "◆" : "",
        action: "roll",
        data: { kind: "save", key, pin: `save:${key}` }
      }))
    });

    const slots = this.#slots(actor);
    if (slots.length) {
      sections.push({
        pane: "stats", title: t("FCP.D5.Slots"), note: t("FCP.D5.SlotsHint"), layout: "boxes",
        rows: slots.map(sl => ({
          key: `slot:${sl.key}`,
          label: sl.pact ? f("FCP.D5.PactLevel", { n: sl.level }) : f("FCP.D5.SlotLevel", { n: sl.level }),
          count: `${sl.value} / ${sl.max}`,
          tone: sl.pact ? "pact" : "slot",
          boxes: boxes(sl.max, sl.value)
        }))
      });
    }

    const resources = this.#resources(actor);
    if (resources.length) {
      sections.push({ pane: "stats", title: t("FCP.D5.Resources"), note: t("FCP.D5.ResourcesHint"), layout: "resources", entries: resources });
    }

    const hd = a.hd;
    if (hd?.max) {
      const dice = Array.from(hd.sizes ?? []).sort((x, y) => y - x).map(n => `d${n}`).join(" / ");
      sections.push({
        pane: "stats", title: t("FCP.D5.HitDice"), note: [`${hd.value} / ${hd.max}`, dice].filter(Boolean).join(" · "), layout: "boxes",
        rows: [{ key: "hd", tone: "hd", boxes: boxes(hd.max, hd.value) }],
        roll: hd.value > 0 ? { kind: "hitDie", label: t("FCP.D5.RollHitDie") } : null
      });
    }

    const conc = actor.concentration;
    const concItem = Array.from(conc?.items ?? [])[0];
    const concEffect = Array.from(conc?.effects ?? [])[0];
    // Initiative moved under the hit points: what is left here is concentration, when there is one.
    if (concEffect) {
      sections.push({
        pane: "stats", title: t("FCP.D5.Other"), layout: "list", variant: "compact", tiles: [],
        concentration: { name: concItem?.name ?? concEffect.name, rollLabel: t("FCP.D5.ConcSave") }
      });
    }

    const passives = actor.items
      .filter(i => i.type === "feat" && !(i.system.activities?.size) && !i.system.uses?.max)
      .sort((x, y) => x.name.localeCompare(y.name))
      .map(i => ({ name: i.name, text: plainText(i.system.description?.value, 160) }));
    if (passives.length) sections.push({ pane: "stats", title: t("FCP.D5.Passives"), layout: "passives", entries: passives });

    sections.push({ pane: "stats", title: t("FCP.Conditions"), layout: "picker" });

    // Skills pane: expertise first, then the best proficient skills, as the highlight.
    const skills = Object.entries(s.skills ?? {});
    const top = skills
      .filter(([, sk]) => Number(sk.value ?? 0) > 0)
      .sort(([, x], [, y]) => (Number(y.value) - Number(x.value)) || (y.total - x.total))
      .slice(0, 2);
    if (top.length) {
      sections.push({ pane: "skills", title: t("FCP.D5.Highlight"), layout: "list", variant: "feature", tiles: top.map(([k, sk]) => this.#skillTile(k, sk, { feature: true })) });
    }
    sections.push({
      pane: "skills", title: f("FCP.D5.AllSkills", { n: skills.length }), note: t("FCP.D5.SkillLegend"), layout: "list", variant: "compact",
      tiles: skills.map(([k, sk]) => this.#skillTile(k, sk)).sort((x, y) => x.label.localeCompare(y.label))
    });

    return {
      modes: null,
      sections,
      conditionsInline: true,
      restsPane: "stats",
      rests: [
        { kind: "short", label: t("FCP.Rest.Short") },
        { kind: "long", label: t("FCP.Rest.Long") }
      ],
      levelUps: this.#levelUps(actor)
    };
  }

  /** One "level up" button per class below the level cap; summons and NPCs have no classes to raise. */
  #levelUps(actor) {
    if (actor.type !== "character") return [];
    const cap = CONFIG.DND5E.maxLevel ?? 20;
    if ((actor.system.details?.level ?? 0) >= cap) return [];
    const classes = Object.values(actor.classes ?? {});
    return classes.map(c => ({
      classId: c.id,
      label: classes.length > 1 ? f("FCP.D5.LevelUpClass", { cls: c.name, n: c.system.levels + 1 }) : f("FCP.D5.LevelUp", { n: c.system.levels + 1 })
    }));
  }

  conditions(actor) {
    const active = actor.statuses ?? new Set();
    const types = CONFIG.DND5E?.conditionTypes;
    if (!types) return super.conditions(actor);
    return Object.entries(types)
      .filter(([, c]) => !c.pseudo)
      .map(([id, c]) => ({ id, name: game.i18n.localize(c.name ?? c.label ?? id), img: c.img ?? c.icon, active: active.has(id) }))
      .sort((x, y) => x.name.localeCompare(y.name));
  }

  /* ---------------- Actions ---------------- */

  #uses(item) {
    const u = item.system.uses;
    if (!u || !u.max) return null;
    return { value: u.value ?? 0, max: u.max };
  }

  /** One-line summary of an item: to-hit, damage and range for attacks, casting data for spells. */
  #meta(item) {
    if (item.type === "spell") {
      return [item.labels?.activation, item.labels?.range, damageText(item), item.labels?.components?.vsm,
        item.system.method && item.system.method !== "spell" ? CONFIG.DND5E.spellcasting?.[item.system.method]?.label : null].filter(Boolean).join(" · ");
    }
    if (item.hasAttack) return [damageText(item), item.labels?.range].filter(Boolean).join(" · "); // to-hit is in the badge
    if (item.type === "feat") return [item.labels?.activation, item.labels?.recovery].filter(Boolean).join(" · ");
    return item.labels?.activation ?? "";
  }

  /**
   * The number players forget: total to-hit for attacks, save DC for save effects.
   * dnd5e already computes both (proficiency, ability, magic bonuses, active effects).
   */
  #badge(source) {
    const acts = source.system?.activities ? Array.from(source.system.activities) : [source];
    const attack = acts.find(a => a.type === "attack");
    const toHit = attack?.labels?.toHit ?? (source.hasAttack ? source.labels?.toHit : null);
    // `hit`: the use button shows the to-hit itself ("⚔ +7"); a save DC goes in the line under the name.
    if (toHit) return { text: toHit, hint: t("FCP.D5.ToHit"), hit: true };
    const save = acts.find(a => a.type === "save")?.save;
    const dc = save?.dc?.value;
    if (!dc) return null;
    const ab = Array.from(save.ability ?? []);
    // Our own abbreviations: the system's come out untranslated ("wis") on an Italian table.
    const key = `FCP.D5.Ab.${ab[0]}`;
    const abbr = ab.length !== 1 ? "" : game.i18n.has?.(key) ? t(key)
      : String(t(CONFIG.DND5E.abilities?.[ab[0]]?.abbreviation ?? ab[0])).replace(/^./, c => c.toUpperCase());
    return { text: f("FCP.D5.SaveBadge", { dc, ab: abbr }).trim(), hint: t("FCP.D5.SaveDC") };
  }

  #row(item, { actionLabel, big = false } = {}) {
    return {
      id: item.id,
      name: item.name,
      img: item.img,
      meta: this.#meta(item),
      badge: this.#badge(item),
      uses: this.#uses(item),
      big,
      action: "useItem",
      actionLabel: actionLabel ?? t("FCP.Use"),
      data: {}
    };
  }

  async prepareActions(actor) {
    const groups = [];
    const hasActivities = i => (i.system.activities?.size ?? 0) > 0;

    // Attacks: anything with an attack activity; unequipped weapons shown dimmed.
    const attacks = actor.items
      .filter(i => i.hasAttack && i.type !== "spell" && !i.system.isHidden)
      .sort((a, b) => Number(b.system.equipped ?? true) - Number(a.system.equipped ?? true) || a.name.localeCompare(b.name))
      .map(i => ({
        ...this.#row(i, { actionLabel: t("FCP.D5.Attack"), big: true }),
        inactive: i.type === "weapon" && i.system.equipped === false
      }));
    if (attacks.length) groups.push({ title: t("FCP.D5.Attacks"), items: attacks });

    // Spells: only castable ones, by level, with the slots of that level to mark by hand.
    const spells = actor.items.filter(i => i.type === "spell" && this.#castable(i));
    const byLevel = new Map();
    for (const sp of spells) {
      const lvl = sp.system.level ?? 0;
      if (!byLevel.has(lvl)) byLevel.set(lvl, []);
      byLevel.get(lvl).push(sp);
    }
    const slots = this.#slots(actor);
    for (const lvl of Array.from(byLevel.keys()).sort((a, b) => a - b)) {
      const list = byLevel.get(lvl);
      const slot = slots.find(s => !s.pact && s.level === lvl)
        ?? (list.some(sp => sp.system.method === "pact") ? slots.find(s => s.pact) : null);
      groups.push({
        // Title by spell level; pact spells show the pact pool (cast at the pact level) as their slots.
        title: lvl === 0 ? t("FCP.D5.Cantrips") : f("FCP.D5.SlotLevel", { n: lvl }),
        count: slot ? f(slot.pact ? "FCP.D5.PactCount" : "FCP.D5.SlotCount", { v: slot.value, m: slot.max, n: slot.level }) : "",
        slots: slot ? { key: `slot:${slot.key}`, tone: slot.pact ? "pact" : "slot", boxes: boxes(slot.max, slot.value) } : null,
        items: list.sort((a, b) => a.name.localeCompare(b.name)).map(sp => this.#row(sp, { actionLabel: t("FCP.D5.Cast") }))
      });
    }

    // Features with something to activate: one row per activity, so an option hidden inside a
    // multi-activity feature (e.g. Psionic Power -> Protective Field) is visible and usable directly.
    const reactions = [];
    const feats = [];
    for (const i of actor.items.filter(i => i.type === "feat" && hasActivities(i) && !i.hasAttack)) {
      for (const r of this.#activityRows(i)) (r.reaction ? reactions : feats).push(r);
    }
    feats.sort((a, b) => a.name.localeCompare(b.name));
    if (feats.length) groups.push({ title: t("FCP.D5.Features"), items: feats });

    // Consumables and other usable gear.
    const usable = [];
    for (const i of actor.items.filter(i => ["consumable", "equipment", "tool"].includes(i.type) && hasActivities(i) && !i.hasAttack)) {
      for (const r of this.#activityRows(i)) (r.reaction ? reactions : usable).push(r);
    }
    usable.sort((a, b) => a.name.localeCompare(b.name));
    if (usable.length) groups.push({ title: t("FCP.D5.Consumables"), items: usable });

    // Reactions first: they happen on someone else's turn, when there is no time to look for them.
    // Reaction spells stay in their level group too, where their slots are.
    for (const sp of spells) {
      if (this.#activation(sp) === "reaction") reactions.push({ ...this.#row(sp, { actionLabel: t("FCP.D5.Cast") }), reaction: true });
    }
    reactions.sort((a, b) => a.name.localeCompare(b.name));
    if (reactions.length) groups.unshift({ title: t("FCP.D5.Reactions"), items: reactions });

    return { groups };
  }

  /** Activation type of an item: its only activity's, or the first one's. */
  #activation(item) {
    const acts = Array.from(item.system.activities ?? []);
    return acts[0]?.activation?.type ?? item.system.activation?.type ?? "";
  }

  /** Rows for an item: itself when it has one activity, one per activity otherwise. */
  #activityRows(item) {
    const acts = Array.from(item.system.activities ?? []);
    if (acts.length <= 1) {
      return [{ ...this.#row(item), reaction: acts[0]?.activation?.type === "reaction" }];
    }
    const uses = this.#uses(item);
    return acts.map(a => ({
      id: `${item.id}.${a.id}`,
      itemId: item.id,
      name: a.name && a.name !== item.name ? a.name : item.name,
      img: a.img || item.img,
      meta: [a.labels?.activation ?? game.i18n.localize(CONFIG.DND5E.activityActivationTypes?.[a.activation?.type]?.label ?? ""),
        a.name && a.name !== item.name ? item.name : null].filter(Boolean).join(" · "),
      uses,
      badge: this.#badge(a),
      big: false,
      action: "useActivity",
      actionLabel: t("FCP.Use"),
      data: { activity: a.id },
      reaction: a.activation?.type === "reaction"
    }));
  }

  #castable(spell) {
    const sys = spell.system;
    if ((sys.level ?? 0) === 0) return true;
    if (sys.method && !(sys.canPrepare ?? sys.method === "spell")) return true; // pact, innate, atwill, ritual
    if (sys.preparation) return sys.preparation.mode !== "prepared" || !!sys.preparation.prepared; // dnd5e 4/5
    return (sys.prepared ?? 0) > 0; // dnd5e 6: 1 prepared, 2 always
  }

  #alwaysPrepared(spell) {
    const sys = spell.system;
    if ((sys.level ?? 0) === 0) return true;
    if (sys.preparation) return sys.preparation.mode !== "prepared";
    const always = CONFIG.DND5E.spellPreparationStates?.always?.value ?? 2;
    return sys.prepared === always || (!!sys.method && !(sys.canPrepare ?? sys.method === "spell"));
  }

  /* ---------------- Inventory ---------------- */

  async prepareInventory(actor) {
    const groups = [];
    const weight = i => (i.system.weight?.value ? `${num(i.system.weight.value)} ${i.system.weight.units ?? ""}`.trim() : null);
    const detail = i => {
      if (i.type === "weapon") return damageText(i);
      if (i.type === "equipment" && i.system.armor?.value) return `${t("FCP.D5.AC")} ${i.system.armor.value}`;
      if (i.type === "container") {
        const n = actor.items.filter(x => x.system.container === i.id).length;
        return n ? f("FCP.D5.Inside", { n }) : null;
      }
      return null;
    };
    const invRow = (i, extra = {}) => ({
      id: i.id, name: i.name, img: i.img,
      meta: [detail(i), i.system.quantity > 1 ? `×${i.system.quantity}` : null, weight(i)].filter(Boolean).join(" · "),
      uses: this.#uses(i),
      ...extra
    });

    const sections = [
      ["weapon", "FCP.D5.Inv.Weapons", true],
      ["equipment", "FCP.D5.Inv.Equipment", true],
      ["consumable", "FCP.D5.Consumables", false],
      ["tool", "FCP.D5.Inv.Tools", false],
      ["container", "FCP.D5.Inv.Containers", false],
      ["loot", "FCP.D5.Inv.Loot", false]
    ];
    for (const [type, title, equippable] of sections) {
      const items = actor.items.filter(i => i.type === type && !i.system.container).sort((a, b) => a.name.localeCompare(b.name))
        .map(i => invRow(i, equippable ? { inactive: !i.system.equipped, toggle: equipToggle(i) } : {}));
      if (items.length) groups.push({ title: t(title), items });
    }

    // Coins: read only, one row.
    const coins = this.#coins(actor);
    if (coins) groups.push({ title: t("FCP.D5.Inv.Coins"), items: [{ id: "", name: coins, img: "icons/commodities/currency/coins-plain-stack-gold.webp" }] });

    // Spellbook: every spell by level, with a "prepared" switch where the spell can be prepared,
    // and a button per spellcasting class to choose spells from its list (spell-step.mjs).
    const spells = actor.items.filter(i => i.type === "spell");
    const adders = this.#spellAdders(actor);
    if (spells.length || adders.length) {
      const levels = new Map();
      for (const sp of spells) {
        const lvl = sp.system.level ?? 0;
        if (!levels.has(lvl)) levels.set(lvl, []);
        levels.get(lvl).push(sp);
      }
      groups.push({
        title: t("FCP.D5.Spellbook"),
        spellbook: true,
        adders,
        items: [],
        levels: Array.from(levels.keys()).sort((a, b) => a - b).map(lvl => ({
          title: lvl === 0 ? t("FCP.D5.Cantrips") : f("FCP.D5.SlotLevel", { n: lvl }),
          spells: levels.get(lvl).sort((a, b) => a.name.localeCompare(b.name)).map(sp => {
            const always = this.#alwaysPrepared(sp);
            return {
              id: sp.id,
              name: sp.name,
              search: sp.name.toLowerCase(),
              school: CONFIG.DND5E.spellSchools?.[sp.system.school]?.label ?? "",
              always,
              prepared: always || this.#castable(sp)
            };
          })
        }))
      });
    }
    return { groups };
  }

  /**
   * One "choose spells" button per spellcasting class. Right after a page load dnd5e may not have loaded the spell
   * lists yet: then every class that casts gets its button anyway, and the window waits for the lists.
   */
  #spellAdders(actor) {
    let sources = spellSources(actor);
    if (!sources.length && actor.type === "character") sources = Object.values(actor.classes ?? {})
      .filter(isCaster)
      .map(cls => ({ cls }));
    return sources.map(({ cls }) => ({
      classId: cls.id,
      label: sources.length > 1 ? f("FCP.D5.AddSpellsClass", { cls: cls.name }) : t("FCP.D5.AddSpells")
    }));
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

  /* ---------------- Boxes ---------------- */

  /** Taps are applied one after the other, each reading the value the previous one left behind. */
  #queue = Promise.resolve();

  #enqueue(fn) {
    const run = this.#queue.then(fn, fn);
    this.#queue = run.catch(() => {});
    return run;
  }

  /** Tap box n: filled up to n; tapping the last filled box empties it. Absolute values, so quick taps cannot add up wrongly. */
  #next(filled, n) {
    return filled === n ? n - 1 : n;
  }

  setBox(actor, key, n) {
    return this.#enqueue(async () => {
      const a = actor.system.attributes;
      if (key === "death.success" || key === "death.failure") {
        const field = key.split(".")[1];
        return actor.update({ [`system.attributes.death.${field}`]: Math.clamp(this.#next(a.death?.[field] ?? 0, n), 0, 3) });
      }
      if (key.startsWith("slot:")) {
        const slotKey = key.slice(5);
        const slot = actor.system.spells?.[slotKey];
        if (!slot?.max) return false;
        // Filled = available, like hit dice: tapping the last full slot spends it, an empty one fills up to it.
        const value = this.#next(slot.value ?? 0, n);
        return actor.update({ [`system.spells.${slotKey}.value`]: Math.clamp(value, 0, slot.max) });
      }
      if (key === "hd") return this.#setHitDice(actor, this.#next(a.hd?.value ?? 0, n));
      return false;
    });
  }

  /** Bring the remaining hit dice to `target`, spending the largest dice first and recovering the smallest first. */
  async #setHitDice(actor, target) {
    // NPCs (summons) have no classes: their dice are spent on the actor itself.
    if (!Object.keys(actor.classes ?? {}).length) {
      const hd = actor.system.attributes.hd;
      if (!hd?.max) return false;
      return actor.update({ "system.attributes.hd.spent": Math.clamp(hd.max - target, 0, hd.max) });
    }
    const classes = Object.values(actor.classes ?? {})
      .map(c => ({ c, faces: parseInt(String(c.system.hd?.denomination ?? "d0").slice(1)) || 0 }));
    let delta = (actor.system.attributes.hd?.value ?? 0) - target; // > 0: spend, < 0: recover
    const updates = [];
    classes.sort((x, y) => (delta > 0 ? y.faces - x.faces : x.faces - y.faces));
    for (const { c } of classes) {
      if (!delta) break;
      const hd = c.system.hd;
      const step = delta > 0 ? Math.min(delta, hd.value ?? 0) : -Math.min(-delta, hd.spent ?? 0);
      if (!step) continue;
      updates.push({ _id: c.id, "system.hd.spent": (hd.spent ?? 0) + step });
      delta -= step;
    }
    if (updates.length) return actor.updateEmbeddedDocuments("Item", updates);
    return false;
  }

  /** Mark one use of a limited feature; once none are left, the next tap refills it (manual tracking). */
  async #spendUse(actor, { itemId }) {
    const item = actor.items.get(itemId);
    const uses = item?.system.uses;
    if (!uses?.max) return false;
    const value = uses.value ?? 0;
    return item.update({ "system.uses.spent": value > 0 ? uses.max - value + 1 : 0 });
  }

  /** Text pinned in the header in reference mode: what to roll at the table. */
  pinText(actor, key) {
    const s = actor.system;
    const [kind, id] = String(key).split(":");
    switch (kind) {
      case "ability": {
        const ab = s.abilities?.[id];
        return ab ? f("FCP.D5.PinCheck", { name: CONFIG.DND5E.abilities[id]?.label ?? id, mod: signed(ab.mod) }) : "";
      }
      case "save": {
        const ab = s.abilities?.[id];
        return ab ? f("FCP.D5.PinSave", { name: CONFIG.DND5E.abilities[id]?.label ?? id, mod: signed(ab.save?.value ?? ab.save) }) : "";
      }
      case "skill": {
        const sk = s.skills?.[id];
        return sk ? f("FCP.D5.PinD20", { name: this.#skillLabel(id), mod: signed(sk.total) }) : "";
      }
      case "init":
        return f("FCP.D5.PinD20", { name: t("FCP.D5.Initiative"), mod: signed(s.attributes.init?.total) });
      case "item": {
        // Rows of a multi-activity item are keyed "itemId.activityId".
        const item = actor.items.get(id.split(".")[0]);
        if (!item) return "";
        const meta = this.#meta(item);
        return meta ? `${item.name} · ${meta}` : item.name;
      }
    }
    return "";
  }

  /* ---------------- Handlers ---------------- */

  #dialog() {
    return { configure: !getSetting(SETTINGS.QUICK_ROLLS) };
  }

  /** Only the chosen mode: an explicit false would override advantage granted by features and effects. */
  #adv() {
    if (this.mode === "advantage") return { advantage: true };
    if (this.mode === "disadvantage") return { disadvantage: true };
    return {};
  }

  /**
   * Without a canvas Actor#getActiveTokens is empty, so core's createCombatants adds a tokenless duplicate
   * on every tap. The phone joins the combat itself with the actor's token on the combat's scene, once.
   */
  /** One initiative at a time per actor: two quick taps both saw no combatant and both added one. */
  #initiativeLocks = new Map();

  #rollInitiative(actor, adv, dialog) {
    const key = actor.uuid;
    if (this.#initiativeLocks.has(key)) return this.#initiativeLocks.get(key);
    const run = this.#rollInitiativeNow(actor, adv, dialog).finally(() => this.#initiativeLocks.delete(key));
    this.#initiativeLocks.set(key, run);
    return run;
  }

  async #rollInitiativeNow(actor, adv, dialog) {
    const combat = game.combat;
    if (!combat) {
      ui.notifications.warn("COMBAT.NoneActive", { localize: true });
      return null;
    }
    if (!combat.getCombatantsByActor(actor).length) {
      const scene = combat.scene ?? game.scenes.active;
      const tokens = actor.isToken ? [actor.token].filter(t => t?.parent === scene)
        : scene?.tokens.filter(t => t.actorLink && t.actorId === actor.id) ?? [];
      // A token actor elsewhere: a tokenless combatant would never match it, and a new one came at every tap.
      if (actor.isToken && !tokens.length) {
        ui.notifications.warn("FCP.D5.InitiativeOffScene", { localize: true });
        return null;
      }
      const data = tokens.length
        ? tokens.map(t => ({ tokenId: t.id, sceneId: t.parent.id, actorId: actor.id, hidden: t.hidden }))
        : [{ actorId: actor.id, hidden: false }];
      await combat.createEmbeddedDocuments("Combatant", data);
    }
    // dnd5e's dialog always asks core to create combatants: turn that off for this call only.
    const own = Object.getOwnPropertyDescriptor(actor, "rollInitiative");
    const roll = actor.rollInitiative;
    actor.rollInitiative = (options = {}, rollOptions) => roll.call(actor, { ...options, createCombatants: false }, rollOptions);
    try {
      // dnd5e's dialog returns nothing even when it rolled: the combat says whether a roll was made.
      if (dialog.configure) {
        await actor.rollInitiativeDialog(adv);
        return combat.getCombatantsByActor(actor).some(c => c.initiative !== null) || null;
      }
      return await actor.rollInitiative({}, adv);
    } finally {
      if (own) Object.defineProperty(actor, "rollInitiative", own);
      else delete actor.rollInitiative;
    }
  }

  async handle(actor, action, data) {
    switch (action) {
      case "roll": return this.#roll(actor, data);
      case "useItem": return this.#useItem(actor, data);
      case "useActivity": return this.#useActivity(actor, data);
      case "toggleItem": return this.#toggleItem(actor, data);
      case "rest": return this.rest(actor, data.kind);
      case "levelUp": return this.#levelUp(actor, data);
      case "addSpells": return openSpellStep(actor, data.classId);
      case "counter": return this.setBox(actor, data.key, Number(data.box));
      case "spendUse": return this.#spendUse(actor, data);
      case "endConcentration": return actor.endConcentration();
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
      case "initiative": return this.#rollInitiative(actor, adv, dialog);
      case "deathSave": return actor.rollDeathSave({ ...adv }, dialog);
      case "hitDie": return actor.rollHitDie({}, dialog);
      case "concentration": return actor.rollConcentration({ ...adv }, dialog);
    }
    return false;
  }

  async #useItem(actor, { itemId }) {
    const item = actor.items.get(itemId);
    if (!item) return false;
    const off = this.#attackMode(item);
    const result = await item.use({ event: {} }, this.#dialog(), {});
    // Usage window closed: no attack will come, the mode must not wait for a later one.
    if (!result) off();
    return result;
  }

  async #useActivity(actor, { itemId, activity }) {
    const item = actor.items.get(String(itemId).split(".")[0]);
    const act = item?.system.activities?.get(activity);
    if (!act) return false;
    const off = this.#attackMode(item);
    const result = await act.use({ event: {} }, this.#dialog(), {});
    if (!result) off();
    return result;
  }

  /**
   * The attack roll comes after the activity, from dnd5e itself, with no way to pass options: the phone's
   * advantage or disadvantage goes in through the attack hook, for the next attack of this item only.
   * Added to what features and effects already grant, never removing it.
   */
  #attackMode(item) {
    const adv = this.#adv();
    if (!adv.advantage && !adv.disadvantage) return () => {};
    const name = "dnd5e.preRollAttackV2";
    let id = null;
    const off = () => { if (id !== null) Hooks.off(name, id); id = null; };
    id = Hooks.on(name, config => {
      // Activity#use works on a clone of the item: same id and actor, not the same object.
      const subject = config.subject?.item;
      if (subject?.id !== item.id || subject?.actor !== item.actor) return;
      for (const roll of config.rolls ?? []) {
        roll.options ??= {};
        if (adv.advantage) roll.options.advantage = true;
        if (adv.disadvantage) roll.options.disadvantage = true;
      }
      off();
    });
    // An activity that never rolls must not leave the hook for a later attack.
    // unref: in node (the tests) the timer must not keep the process alive; browsers have no unref.
    setTimeout(off, 120_000)?.unref?.();
    return off;
  }

  async #toggleItem(actor, { itemId }) {
    const item = actor.items.get(itemId);
    if (!item) return false;
    if (item.type === "spell") {
      if (item.system.preparation) return item.update({ "system.preparation.prepared": !item.system.preparation.prepared });
      return item.update({ "system.prepared": item.system.prepared ? 0 : 1 });
    }
    if ("equipped" in item.system) return item.update({ "system.equipped": !item.system.equipped });
    return false;
  }

  /**
   * Same path as the level selector on the desktop sheet: the system's advancement window walks through hit points,
   * features, subclass and ASI, and nothing changes until its last step. Without advancements it just adds the level.
   */
  async #levelUp(actor, { classId }) {
    const cls = actor.items.get(classId);
    if (cls?.type !== "class") return false;
    if (!game.settings.get("dnd5e", "disableAdvancements")) {
      const manager = dnd5e.applications.advancement.AdvancementManager.forLevelChange(actor, classId, 1);
      if (manager.steps.length) return manager.render({ force: true });
    }
    return cls.update({ "system.levels": cls.system.levels + 1 });
  }

  async rest(actor, kind) {
    if (kind === "short") return actor.shortRest();
    if (kind === "long") return actor.longRest();
    return false;
  }
}
