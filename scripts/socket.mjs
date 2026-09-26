import { SOCKET_NAME, SETTINGS, MODULE_ID, warn } from "./constants.mjs";
import { getSetting } from "./settings.mjs";
import { executeMove } from "./movement.mjs";
import { checkPlayRequest, sanitizeTargetIds, requestUserId, vfxRequestOutcome } from "./app/targets-data.mjs";
import { playLocally } from "./vfx.mjs";

const pending = new Map();
const TIMEOUT_MS = 6000;

export function registerSocket() {
  game.socket.on(SOCKET_NAME, onSocketMessage);
}

/** `senderId` is attached by the server: requests are checked against it, not against `msg.userId`. */
async function onSocketMessage(msg, senderId) {
  if (!msg || typeof msg !== "object") return;
  switch (msg.type) {
    case "moveRequest":
      if (game.user.isActiveGM) return handleMoveRequest(msg, requestUserId(msg, senderId));
      return;
    case "moveResult":
      if (msg.targetUserId !== game.user.id) return;
      return resolvePending(msg);
    case "vfxRequest":
      if (game.user.isActiveGM) return handleVfxRequest(msg, requestUserId(msg, senderId));
      return;
    case "vfxResult":
      if (msg.targetUserId !== game.user.id) return;
      return resolvePending(msg);
  }
}

function resolvePending(msg) {
  const p = pending.get(msg.requestId);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(msg.requestId);
  p.resolve(msg);
}

/** GM side: validate ownership and perform the move. */
async function handleMoveRequest(msg, userId) {
  const reply = payload => game.socket.emit(SOCKET_NAME, {
    type: "moveResult", requestId: msg.requestId, targetUserId: userId, ...payload
  });

  const user = userId ? game.users.get(userId) : null;
  const scene = game.scenes.get(msg.sceneId);
  const tokenDoc = scene?.tokens.get(msg.tokenId);
  if (!user || !tokenDoc) return reply({ ok: false, reason: "missing" });

  const owns = tokenDoc.actor
    ? tokenDoc.actor.testUserPermission(user, "OWNER")
    : tokenDoc.testUserPermission(user, "OWNER");
  if (!owns) return reply({ ok: false, reason: "denied" });

  const x = Number(msg.x);
  const y = Number(msg.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return reply({ ok: false, reason: "invalid" });

  try {
    const result = await executeMove(tokenDoc, { x, y });
    return reply(result);
  } catch (err) {
    warn("move failed", err);
    return reply({ ok: false, reason: "error" });
  }
}

/**
 * Player side: ask the active GM to move the token (wall-checked). Falls back to a
 * direct update when relay is disabled, no GM is connected, or the GM does not answer.
 */
export async function requestMove(tokenDoc, { x, y }) {
  const gm = game.users.activeGM;
  const relay = getSetting(SETTINGS.MOVE_RELAY);

  if (game.user.isActiveGM || !relay || !gm) {
    if (!gm && relay) ui.notifications.info(game.i18n.localize("FCP.NoGM"));
    const result = await executeMove(tokenDoc, { x, y });
    if (!relay) result.validated = true; // relay off: the user chose unchecked moves, do not nag
    return result;
  }

  const requestId = foundry.utils.randomID();
  const result = await new Promise(resolve => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({ ok: false, reason: "timeout" });
    }, TIMEOUT_MS);
    pending.set(requestId, { resolve, timer });
    game.socket.emit(SOCKET_NAME, {
      type: "moveRequest", requestId, userId: game.user.id,
      sceneId: tokenDoc.parent.id, tokenId: tokenDoc.id, x, y
    });
  });

  if (result.reason === "timeout") {
    warn(`${MODULE_ID}: GM did not answer, moving directly`);
    return executeMove(tokenDoc, { x, y });
  }
  if (result.reason === "denied") ui.notifications.warn(game.i18n.localize("FCP.MoveDenied"));
  return result;
}

/** GM side: check who asks, then play the effect on this client's canvas. */
async function handleVfxRequest(msg, userId) {
  const reply = payload => game.socket.emit(SOCKET_NAME, {
    type: "vfxResult", requestId: msg.requestId, targetUserId: userId, ...payload
  });
  try {
    const user = userId ? game.users.get(userId) : null;
    const scene = game.scenes.get(msg.sceneId);
    const tokenDoc = scene?.tokens.get(msg.originId) ?? null;
    const item = typeof msg.itemUuid === "string" ? await fromUuid(msg.itemUuid) : null;
    const outcome = vfxRequestOutcome({ reason: checkPlayRequest({ user, tokenDoc, item }), onScene: canvas?.scene?.id === scene?.id });
    if (outcome.reply) return reply({ ok: false, reason: outcome.reply });
    if (outcome.silent) return; // another client of the GM user shows the scene; if none does, the player times out
    const targetIds = sanitizeTargetIds(msg.targetIds, id => scene.tokens.has(id));
    const actionId = typeof msg.actionId === "string" ? msg.actionId : null;
    return reply(await playLocally({ item, actionId, originId: tokenDoc.id, targetIds }));
  } catch (err) {
    warn("effect request failed", err);
    return reply({ ok: false, reason: "error" });
  }
}

/**
 * Player side: ask the active GM, who has the canvas, to play the effect. There is no local fallback:
 * the phone has no canvas to play on.
 */
export async function requestPlay({ tokenDoc, item, actionId = null, targetIds = [] }) {
  if (game.user.isActiveGM) {
    if (canvas?.scene?.id !== tokenDoc.parent.id) return { ok: false, reason: "scene" };
    return playLocally({ item, actionId, originId: tokenDoc.id, targetIds });
  }
  if (!game.users.activeGM) return { ok: false, reason: "noGM" };

  const requestId = foundry.utils.randomID();
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({ ok: false, reason: "timeout" });
    }, TIMEOUT_MS);
    pending.set(requestId, { resolve, timer });
    game.socket.emit(SOCKET_NAME, {
      type: "vfxRequest", requestId, userId: game.user.id,
      sceneId: tokenDoc.parent.id, originId: tokenDoc.id, targetIds,
      itemUuid: item.uuid, actionId
    });
  });
}
