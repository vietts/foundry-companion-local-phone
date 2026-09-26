import { warn } from "./constants.mjs";

/* The only place that knows the daggerheart-vfx ("Tavolo VFX") API. Without the module nothing changes. */

export const VFX_MODULE_ID = "daggerheart-vfx";

/** The effects API when the module is active and exposes it, otherwise null. */
export function vfxApi() {
  const mod = globalThis.game?.modules?.get(VFX_MODULE_ID);
  const api = mod?.active ? mod.api : null;
  return api && typeof api.gioca === "function" && typeof api.haEffetto === "function" ? api : null;
}

/** Daggerheart rows mark the weapon attack as "attack": the API wants the id of the attack action. */
export function resolveActionId(item, raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  if (raw === "attack") return item?.system?.attack?.id ?? raw;
  return raw;
}

/** Whether an item (and action) has an effect. Never throws. */
export function hasEffect(item, actionId) {
  const api = vfxApi();
  if (!api || !item) return false;
  try {
    return !!api.haEffetto(item, actionId ?? undefined);
  } catch (err) {
    warn("haEffetto failed for", item.name, err);
    return false;
  }
}

/** Play an effect on this client (the active GM's, which has the canvas). */
export async function playLocally({ item, actionId = null, originId, targetIds = [] }) {
  const api = vfxApi();
  if (!api) return { ok: false, reason: "noEffect" };
  try {
    const ok = await api.gioca({ item, azioneId: actionId ?? undefined, origine: originId, bersagli: targetIds });
    return ok ? { ok: true } : { ok: false, reason: "noEffect" };
  } catch (err) {
    warn("gioca failed", err);
    return { ok: false, reason: "error" };
  }
}
