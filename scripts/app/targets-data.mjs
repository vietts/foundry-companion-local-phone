/* Candidates for the targets strip and checks on effect requests. Pure: no Foundry globals. */

/** Tokens that may appear in the strip: never hidden ones; with fog, only explored ones (the user's own always). */
export function filterCandidates(tokens, { explored = null } = {}) {
  return tokens.filter(t => !t.hidden && (!explored || t.isOwner || explored(t) === true));
}

/**
 * Combatants first in turn order, then the others by distance, the acting token always last.
 * `combatants` is the ordered list of token ids of the scene's combat; `distance(t)` is in grid cells.
 */
export function orderCandidates(tokens, { originId = null, combatants = [], distance = () => 0 } = {}) {
  const turn = new Map(combatants.map((id, i) => [id, i]));
  const rank = t => (t.id === originId ? 2 : turn.has(t.id) ? 0 : 1);
  return [...tokens].sort((a, b) =>
    rank(a) - rank(b)
    || (rank(a) === 0 ? turn.get(a.id) - turn.get(b.id) : 0)
    || distance(a) - distance(b)
    || String(a.name ?? "").localeCompare(String(b.name ?? "")));
}

/** Whether a point of the explored-area mask (in mask pixels) is explored: opaque enough, inside the image. */
export function isExplored(imageData, x, y) {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= imageData.width || py >= imageData.height) return false;
  return imageData.data[(py * imageData.width + px) * 4 + 3] >= 128;
}

/**
 * GM side: may this user play this item from this token? The item comes from the world actor while an
 * unlinked token carries a synthetic actor with the same id, so actors are compared by id.
 */
export function checkPlayRequest({ user, tokenDoc, item }) {
  if (!user || !tokenDoc || !item) return "missing";
  const actor = tokenDoc.actor;
  if (!actor || !actor.testUserPermission(user, "OWNER")) return "denied";
  if (item.parent?.id !== actor.id) return "denied";
  return null;
}

/** Target ids from a socket message: strings only, known to the scene, once each. */
export function sanitizeTargetIds(ids, hasToken) {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter(id => typeof id === "string" && hasToken(id)))];
}

/** Drop from `selected` (a Set, changed in place) the ids no longer in the strip; true when some were dropped. */
export function pruneTargets(selected, visibleIds) {
  let changed = false;
  for (const id of selected) {
    if (visibleIds.has(id)) continue;
    selected.delete(id);
    changed = true;
  }
  return changed;
}

/** Who sent a socket request: the id the server attaches, never the one written in the message. */
export function requestUserId(msg, senderId) {
  return typeof senderId === "string" ? senderId : null;
}

/**
 * What a GM client does with an effect request. The GM user may be connected from several clients (laptop and
 * phone): a refusal is the same everywhere, but only the client showing the token's scene can play, so the
 * others stay silent instead of answering first with a misleading "scene".
 */
export function vfxRequestOutcome({ reason, onScene }) {
  if (reason) return { reply: reason };
  return onScene ? { play: true } : { silent: true };
}

/** Localization suffix for a failed effect: with no targets, "nothing played" usually means "pick a target". */
export function failureKey(reason, targetCount) {
  if (!reason) return "error";
  if (reason === "noEffect" && targetCount === 0) return "noTargets";
  return reason;
}
