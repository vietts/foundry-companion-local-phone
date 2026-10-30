import { SOCKET_NAME, SETTINGS, MODULE_ID, warn } from "./constants.mjs";
import { getSetting } from "./settings.mjs";
import { executeMove } from "./movement.mjs";
import { checkPlayRequest, sanitizeTargetIds, requestUserId, vfxRequestOutcome } from "./app/targets-data.mjs";
import { playLocally } from "./vfx.mjs";
import { onDisplayMessage } from "./live-display.mjs";
import { onPhoneError } from "./errors.mjs";
import { onLogEntries } from "./error-log.mjs";

const pending = new Map();
const TIMEOUT_MS = 6000;
/** A GM client that shows the scene acknowledged the move: the result may take a while (animation, walls). */
const ACK_TIMEOUT_MS = 15000;
/** After an "off scene" answer, how long to wait for a GM client that does show the scene. */
const OFF_SCENE_GRACE_MS = 1500;

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
    case "moveAck":
      if (msg.targetUserId !== game.user.id) return;
      return ackPending(msg);
    case "moveResult":
      if (msg.targetUserId !== game.user.id) return;
      if (msg.reason === "offScene") return offScenePending(msg);
      return resolvePending(msg);
    case "vfxRequest":
      if (game.user.isActiveGM) return handleVfxRequest(msg, requestUserId(msg, senderId));
      return;
    case "vfxResult":
      if (msg.targetUserId !== game.user.id) return;
      return resolvePending(msg);
    case "phoneError":
      return onPhoneError(msg, senderId);
    case "logEntries":
      return onLogEntries(msg, senderId);
    case "liveQr":
    case "liveQrHide":
      return onDisplayMessage(msg, senderId);
  }
}

function resolvePending(msg) {
  const p = pending.get(msg.requestId);
  if (!p) return;
  clearTimeout(p.timer);
  clearTimeout(p.graceTimer);
  pending.delete(msg.requestId);
  p.resolve(msg);
}

/** A GM client with the scene on screen is working on the move: wait longer for its result. */
function ackPending(msg) {
  const p = pending.get(msg.requestId);
  if (!p) return;
  p.acked = true;
  clearTimeout(p.graceTimer);
  clearTimeout(p.timer);
  p.timer = setTimeout(() => resolvePending({ requestId: msg.requestId, ok: false, reason: "timeout" }), ACK_TIMEOUT_MS);
}

/**
 * A GM client that does not show the scene answered. Another GM client (the laptop next to the GM's phone)
 * may still check the walls: give it a moment before settling for an unchecked move.
 */
function offScenePending(msg) {
  const p = pending.get(msg.requestId);
  if (!p || p.acked || p.graceTimer) return;
  p.graceTimer = setTimeout(() => resolvePending(msg), OFF_SCENE_GRACE_MS);
}

/**
 * GM side: validate ownership and perform the move. Only a GM client that shows the token's scene moves it, so walls
 * are checked: the same GM logged in twice (laptop and phone) would otherwise race an unchecked update against the
 * checked move. A GM client without that scene on screen answers "offScene" and the player moves the token itself.
 */
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

  if (!tokenDoc.object || (canvas?.scene?.id !== scene.id)) {
    if (canvas?.ready) warnOffScene(user, scene);
    return reply({ ok: false, reason: "offScene" });
  }

  game.socket.emit(SOCKET_NAME, { type: "moveAck", requestId: msg.requestId, targetUserId: userId });
  try {
    const result = await executeMove(tokenDoc, { x, y });
    return reply(result);
  } catch (err) {
    warn("move failed", err);
    return reply({ ok: false, reason: "error" });
  }
}

/** Tell the GM once a minute that players move on a scene they are not looking at. */
let offSceneWarned = 0;
function warnOffScene(user, scene) {
  if (Date.now() - offSceneWarned < 60000) return;
  offSceneWarned = Date.now();
  ui.notifications.warn(game.i18n.format("FCP.GmOffScene", { name: user.name, scene: scene.name }));
}

/** Player side: the same notice at most every 30 s, instead of one per tap. */
const noticeTimes = new Map();
export function noticeOnce(key, level = "info", data) {
  if (Date.now() - (noticeTimes.get(key) ?? 0) < 30000) return;
  noticeTimes.set(key, Date.now());
  const text = data ? game.i18n.format(key, data) : game.i18n.localize(key);
  ui.notifications[level](text);
}

/**
 * Player side: ask the GM to move the token (wall-checked). Moves directly only when relay is disabled, no GM is
 * connected, or no GM client shows the scene. A GM that does not answer leaves the token where it is: moving it anyway
 * would cross walls, and a late answer would move it twice.
 */
export async function requestMove(tokenDoc, { x, y }) {
  const gm = game.users.activeGM;
  const relay = getSetting(SETTINGS.MOVE_RELAY);

  if (game.user.isActiveGM || !relay || !gm) {
    if (!gm && relay) noticeOnce("FCP.NoGM");
    const result = await executeMove(tokenDoc, { x, y });
    if (!relay || !gm) result.validated = true; // nothing to check against: do not nag on every tap
    return result;
  }

  const requestId = foundry.utils.randomID();
  const result = await new Promise(resolve => {
    const timer = setTimeout(() => resolvePending({ requestId, ok: false, reason: "timeout" }), TIMEOUT_MS);
    pending.set(requestId, { resolve, timer, acked: false, graceTimer: null });
    game.socket.emit(SOCKET_NAME, {
      type: "moveRequest", requestId, userId: game.user.id,
      sceneId: tokenDoc.parent.id, tokenId: tokenDoc.id, x, y
    });
  });

  if (result.reason === "offScene") {
    const moved = await executeMove(tokenDoc, { x, y });
    return { ...moved, validated: false, offScene: true };
  }
  if (result.reason === "timeout") {
    warn(`${MODULE_ID}: GM did not answer, token left in place`);
    return { ok: false, reason: "timeout" };
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
