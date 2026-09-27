/** Localize `key`, falling back to `fallback` (or the last key segment) when the key is unknown. */
export function loc(key, fallback) {
  if (game.i18n.has(key)) return game.i18n.localize(key);
  return fallback ?? key.split(".").pop();
}

/** "+3" / "-1" formatting for modifiers. */
export function signed(n) {
  n = Number(n) || 0;
  return n >= 0 ? `+${n}` : `${n}`;
}

/** Toggle descriptor for an equippable item row. */
export function equipToggle(item) {
  const on = !!item.system.equipped;
  return {
    action: "toggleItem",
    label: game.i18n.localize(on ? "FCP.Unequip" : "FCP.Equip"),
    icon: "ph-duotone ph-shield-check"
  };
}

/** Plain text of an HTML description, cut at a word boundary. */
/**
 * Foundry enricher syntax as the text a reader sees: @UUID[...]{Archery} -> "Archery",
 * [[/r 1d6]] -> "1d6", &Reference[prone] -> "prone". Left raw, a compendium id is one long
 * unbreakable word that pushes the phone layout sideways.
 */
export function enricherText(text) {
  return String(text ?? "")
    .replace(/@Embed\[[^\]]*\](?:\{[^}]*\})?/g, "")
    .replace(/@\w+\[([^\]]*)\](?:\{([^}]*)\})?/g, (_, ref, label) => label ?? ref.split(/[.#]/).pop())
    .replace(/\[\[\/\w+\s+([^\]]*?)\]\](?:\{([^}]*)\})?/g, (_, formula, label) => label ?? formula)
    .replace(/&\w+\[([^\]]*)\](?:\{([^}]*)\})?/g, (_, ref, label) => label ?? ref.split(/\s/)[0]);
}

export function plainText(html, max = 180) {
  const text = enricherText(String(html ?? "").replace(/<[^>]*>/g, " ")).replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 30))}…`;
}

/**
 * Base adapter. Every system adapter returns the same context shapes so the
 * templates stay system-agnostic.
 *
 * Shapes:
 *  header:   { hp: {value,max,temp}|null, stats: [{label, value}] }
 *  sheet:    { modes: [{key,label,active}]|null, sections: [{title, layout:"grid"|"list", cols?, tiles:[Tile]}], rests: [{kind,label}] }
 *  Tile:     { label, value, sub?, img?, prof?, inactive?, action, data: {k:v} }
 *  items:    { groups: [{title, items:[Item]}] }
 *  Item:     { id, name, img, meta?, uses?: {value,max}, action?, actionLabel?, data?, toggle?: {action,label,icon}, inactive? }
 */
export class SystemAdapter {
  /** @type {string} */
  static id = "generic";

  /** Roll mode currently selected on the phone (adv/dis/normal for dnd5e). */
  mode = "normal";

  /** Actors this user may play with. Owned characters first. */
  playableActors() {
    return game.actors.filter(a => a.isOwner && this.isPlayable(a))
      .sort((a, b) => (a.id === game.user.character?.id ? -1 : b.id === game.user.character?.id ? 1 : a.name.localeCompare(b.name)));
  }

  isPlayable(actor) {
    return !!actor;
  }

  subtitle(actor) {
    return "";
  }

  /** Right side of the header kicker on the sheet tab, e.g. "Daggerheart · Lv. 4". */
  kicker(actor) {
    return "";
  }

  async prepareHeader(actor) {
    return { hp: null, stats: [] };
  }

  async prepareSheet(actor) {
    return { modes: null, sections: [], rests: [] };
  }

  async prepareActions(actor) {
    return { groups: [] };
  }

  async prepareInventory(actor) {
    return { groups: [] };
  }

  /** Conditions shown as toggle chips: [{id, name, img, active}] */
  conditions(actor) {
    const active = actor.statuses ?? new Set();
    // v14: CONFIG.statusEffects is a record keyed by id (older cores used an array).
    const effects = Array.isArray(CONFIG.statusEffects) ? CONFIG.statusEffects : Object.values(CONFIG.statusEffects ?? {});
    return effects
      .filter(s => s.hud !== false)
      .map(s => ({ id: s.id, name: game.i18n.localize(s.name ?? s.label ?? s.id), img: s.img ?? s.icon, active: active.has(s.id) }));
  }

  async toggleStatus(actor, statusId) {
    return actor.toggleStatusEffect(statusId);
  }

  /** Apply a signed HP delta (negative = damage). Default: raw update of the HP path. */
  async modifyHP(actor, delta) {
    const path = this.hpPath(actor);
    if (!path) return;
    const hp = foundry.utils.getProperty(actor, path);
    const max = foundry.utils.getProperty(actor, path.replace(/\.value$/, ".max")) ?? Infinity;
    const next = Math.clamp(hp + delta, 0, max);
    return actor.update({ [path]: next });
  }

  hpPath(actor) {
    return null;
  }

  /** Damage of a given amount (from the "Damage" box). Systems may route through their own pipeline. */
  async applyDamage(actor, amount) {
    return this.modifyHP(actor, -Math.abs(amount));
  }

  async applyHealing(actor, amount) {
    return this.modifyHP(actor, Math.abs(amount));
  }

  /** Header counters (e.g. Hope/Stress): [{key,label,value,max}] shown with +/- buttons. */
  async counter(actor, key, delta) {
    return false;
  }

  /** Dispatch an action coming from the UI. `data` is the element dataset. */
  async handle(actor, action, data, event) {
    return false;
  }

  async rest(actor, kind) {
    return false;
  }
}

/** Fallback adapter for unsupported systems: chat, dice and map only. */
export class GenericAdapter extends SystemAdapter {
  static id = "generic";

  isPlayable(actor) {
    return actor.hasPlayerOwner || actor.isOwner;
  }

  hpPath(actor) {
    for (const p of ["system.attributes.hp.value", "system.hp.value", "system.health.value", "system.resources.hitPoints.value"]) {
      if (foundry.utils.getProperty(actor, p) !== undefined) return p;
    }
    return null;
  }

  async prepareHeader(actor) {
    const path = this.hpPath(actor);
    if (!path) return { hp: null, stats: [] };
    return {
      hp: { value: foundry.utils.getProperty(actor, path), max: foundry.utils.getProperty(actor, path.replace(/\.value$/, ".max")), temp: 0 },
      stats: []
    };
  }
}
