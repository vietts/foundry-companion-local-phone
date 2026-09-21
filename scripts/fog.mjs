import { MODULE_ID, SETTINGS, log, warn } from "./constants.mjs";
import { getSetting } from "./settings.mjs";

/** Scene flag holding the explored area as an image (opaque = explored), sized to the scene rectangle. */
export const FOG_FLAG = "fog";

const MASK_SIZE = 1024;
const SAVE_EVERY_MS = 3000;

/**
 * Explored area of the party, recorded on the active GM's client (the one with a canvas) and shared with
 * the phones through a scene flag. Players' phones run without a canvas, so they cannot explore by themselves.
 */
class FogRecorder {
  /** @type {Map<string, {canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, ready: Promise<void>, saved: string|null}>} */
  #masks = new Map();
  #queued = new Set();
  #saveTimers = new Map();

  get enabled() {
    return game.user.isActiveGM && getSetting(SETTINGS.MAP_FOG) && !!canvas?.ready && !!canvas.scene;
  }

  isPartyToken(tokenDoc) {
    return !tokenDoc.hidden && !!tokenDoc.actor?.hasPlayerOwner;
  }

  /** Queue tokens of the viewed scene; the vision is computed once the burst of updates settles. */
  queue(tokenDocs) {
    if (!this.enabled) return;
    for (const t of tokenDocs) {
      if (t.parent?.id === canvas.scene.id && this.isPartyToken(t)) this.#queued.add(t.id);
    }
    if (this.#queued.size) this.#flush();
  }

  queueAll() {
    if (this.enabled) this.queue(canvas.scene.tokens.contents);
  }

  #flush = foundry.utils.debounce(() => this.#record(), 250);

  async #record() {
    if (!this.enabled) return this.#queued.clear();
    const scene = canvas.scene;
    const ids = Array.from(this.#queued);
    this.#queued.clear();
    const mask = await this.#mask(scene);
    const d = scene.dimensions;
    const sx = mask.canvas.width / d.sceneWidth;
    const sy = mask.canvas.height / d.sceneHeight;
    let drawn = 0;
    for (const id of ids) {
      const tokenDoc = scene.tokens.get(id);
      if (!tokenDoc) continue;
      const points = this.#visionPoints(scene, tokenDoc);
      if (points.length < 6) continue;
      const { ctx } = mask;
      ctx.beginPath();
      ctx.moveTo((points[0] - d.sceneX) * sx, (points[1] - d.sceneY) * sy);
      for (let i = 2; i < points.length; i += 2) ctx.lineTo((points[i] - d.sceneX) * sx, (points[i + 1] - d.sceneY) * sy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      drawn++;
    }
    if (drawn) this.#scheduleSave(scene);
  }

  /**
   * Line of sight from the token's center, stopped by walls and closed doors. In a dark scene it is capped at the
   * token's sight range; lights are not considered (what is in view, not how well lit it is).
   */
  #visionPoints(scene, tokenDoc) {
    try {
      const center = tokenDoc.getCenterPoint();
      const origin = { x: center.x, y: center.y, elevation: tokenDoc.elevation };
      const config = { type: "sight" };
      const level = scene.levels?.get(tokenDoc._source.level);
      if (level) config.level = level;
      const sight = tokenDoc.sight ?? {};
      const dark = (scene.environment?.darknessLevel ?? 0) >= 0.5;
      if (dark && sight.enabled && sight.range > 0) {
        const perUnit = scene.dimensions.size / scene.dimensions.distance;
        config.radius = sight.range * perUnit + Math.max(tokenDoc.width, tokenDoc.height) * scene.dimensions.size / 2;
      }
      return CONFIG.Canvas.polygonBackends.sight.create(origin, config).points ?? [];
    } catch (err) {
      warn("could not compute vision for", tokenDoc.name, err);
      return [];
    }
  }

  /** The mask of a scene, seeded with what is already saved on it. */
  #mask(scene) {
    let mask = this.#masks.get(scene.id);
    if (mask) return mask.ready.then(() => mask);
    const d = scene.dimensions;
    const scale = MASK_SIZE / Math.max(d.sceneWidth, d.sceneHeight);
    const el = document.createElement("canvas");
    el.width = Math.max(1, Math.round(d.sceneWidth * scale));
    el.height = Math.max(1, Math.round(d.sceneHeight * scale));
    const ctx = el.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#fff";
    ctx.lineJoin = "round";
    // Vision stops exactly on a wall: widen the area a little so the walls around what was seen show in full.
    ctx.lineWidth = Math.max(2, d.size / 6 * scale);
    const saved = scene.getFlag(MODULE_ID, FOG_FLAG) ?? null;
    const ready = saved ? new Promise(resolve => {
      const img = new Image();
      img.onload = () => { ctx.drawImage(img, 0, 0, el.width, el.height); resolve(); };
      img.onerror = () => resolve();
      img.src = saved;
    }) : Promise.resolve();
    mask = { canvas: el, ctx, ready, saved };
    this.#masks.set(scene.id, mask);
    return ready.then(() => mask);
  }

  #scheduleSave(scene) {
    if (this.#saveTimers.has(scene.id)) return;
    this.#saveTimers.set(scene.id, setTimeout(() => this.#save(scene), SAVE_EVERY_MS));
  }

  async #save(scene) {
    this.#saveTimers.delete(scene.id);
    const mask = this.#masks.get(scene.id);
    if (!mask || !game.user.isActiveGM) return;
    let data = mask.canvas.toDataURL("image/webp", 0.8);
    if (!data.startsWith("data:image/webp")) data = mask.canvas.toDataURL("image/png");
    if (data === mask.saved) return;
    mask.saved = data;
    try {
      await scene.setFlag(MODULE_ID, FOG_FLAG, data);
    } catch (err) {
      warn("could not save the explored area of", scene.name, err);
    }
  }

  /** Forget the explored area of a scene (GM only). */
  async reset(scene = canvas.scene) {
    if (!scene || !game.user.isGM) return;
    clearTimeout(this.#saveTimers.get(scene.id));
    this.#saveTimers.delete(scene.id);
    this.#masks.delete(scene.id);
    await scene.unsetFlag(MODULE_ID, FOG_FLAG);
    log(`explored area of ${scene.name} reset`);
    if (scene.id === canvas.scene?.id) this.queueAll();
  }
}

export const fogRecorder = new FogRecorder();

export function registerFogHooks() {
  Hooks.on("canvasReady", () => fogRecorder.queueAll());
  Hooks.on("createToken", tokenDoc => fogRecorder.queue([tokenDoc]));
  Hooks.on("updateToken", (tokenDoc, changes) => {
    if (["x", "y", "elevation", "level", "hidden", "width", "height"].some(k => k in changes)) fogRecorder.queue([tokenDoc]);
  });
  // A door opening (or closing) changes what the party can see from where it stands.
  Hooks.on("updateWall", (wall, changes) => {
    if ("ds" in changes && wall.parent?.id === canvas.scene?.id) fogRecorder.queueAll();
  });
}
