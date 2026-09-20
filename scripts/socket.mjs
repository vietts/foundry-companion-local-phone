import { SOCKET_NAME, SETTINGS, MODULE_ID, warn } from "./constants.mjs";
import { getSetting } from "./settings.mjs";
import { executeMove } from "./movement.mjs";

const pending = new Map();
const TIMEOUT_MS = 6000;

export function registerSocket() {
  game.socket.on(SOCKET_NAME, onSocketMessage);
}

async function onSocketMessage(msg) {
  if (!msg || typeof msg !== "object") return;
  switch (msg.type) {
    case "moveRequest":
      if (game.user.isActiveGM) return handleMoveRequest(msg);
      return;
    case "moveResult":
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
async function handleMoveRequest(msg) {
  const reply = payload => game.socket.emit(SOCKET_NAME, {
    type: "moveResult", requestId: msg.requestId, targetUserId: msg.userId, ...payload
  });

  const user = game.users.get(msg.userId);
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
    return executeMove(tokenDoc, { x, y });
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
