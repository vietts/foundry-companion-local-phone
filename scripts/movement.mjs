import { SETTINGS, log } from "./constants.mjs";
import { getSetting } from "./settings.mjs";

/** The scene players act on. Without a canvas (phone) `canvas.scene` is null, so prefer the active scene. */
export function activeScene() {
  return game.scenes?.active ?? canvas?.scene ?? null;
}

/** Tokens on the active scene that represent this actor (linked or unlinked). */
export function actorTokens(actor, scene = activeScene()) {
  if (!actor || !scene) return [];
  return scene.tokens.filter(t => t.actorId === actor.id || t.actor?.id === actor.id);
}

/** Tokens this user could move on the active scene. */
export function ownedTokens(scene = activeScene()) {
  if (!scene) return [];
  return scene.tokens.filter(t => t.isOwner);
}

/** Tokens to draw on the phone minimap, according to the world setting. */
export function visibleMinimapTokens(scene, myTokenIds) {
  const mode = getSetting(SETTINGS.MINIMAP_TOKENS);
  const mine = new Set(myTokenIds);
  return scene.tokens.filter(t => {
    if (t.hidden) return false;
    if (mine.has(t.id)) return true;
    if (mode === "all") return true;
    if (mode === "friendly") return t.isOwner || t.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY;
    return t.isOwner;
  });
}

const DIRECTIONS = {
  "0,-1": "UP", "0,1": "DOWN", "-1,0": "LEFT", "1,0": "RIGHT",
  "-1,-1": "UP_LEFT", "1,-1": "UP_RIGHT", "-1,1": "DOWN_LEFT", "1,1": "DOWN_RIGHT"
};

/**
 * Compute the destination (top-left) for moving a token by (dx, dy) grid cells.
 * Uses the grid's own shifting when available (hex-aware), otherwise a plain square step.
 */
export function shiftedPosition(tokenDoc, dx, dy, steps = 1) {
  const grid = tokenDoc.parent.grid;
  let point = { x: tokenDoc.x, y: tokenDoc.y };
  const dirName = DIRECTIONS[`${Math.sign(dx)},${Math.sign(dy)}`];
  const dir = CONST.MOVEMENT_DIRECTIONS?.[dirName];
  for (let i = 0; i < steps; i++) {
    if (dir !== undefined && typeof grid.getShiftedPoint === "function" && !grid.isGridless) {
      point = grid.getShiftedPoint(point, dir);
    } else {
      point = { x: point.x + dx * grid.sizeX, y: point.y + dy * grid.sizeY };
    }
  }
  return tokenDoc.getSnappedPosition(point);
}

/**
 * Compute the destination (top-left) so that the token is centred on a scene-space point.
 */
export function positionAtCenter(tokenDoc, center) {
  const grid = tokenDoc.parent.grid;
  const w = tokenDoc.width * grid.sizeX;
  const h = tokenDoc.height * grid.sizeY;
  return tokenDoc.getSnappedPosition({ x: center.x - w / 2, y: center.y - h / 2 });
}

/**
 * Execute a move on this client. On a client that renders the scene (the GM), the Token object
 * constrains the path against walls; without a canvas (or when the executing client is viewing
 * another scene) the position is simply updated and `validated` is false.
 * @returns {Promise<{ok: boolean, x: number, y: number, constrained: boolean, validated: boolean}>}
 */
export async function executeMove(tokenDoc, { x, y }) {
  const from = { x: tokenDoc.x, y: tokenDoc.y };
  const validated = !!tokenDoc.object && typeof tokenDoc.move === "function";
  let completed = null;
  if (validated) {
    completed = await tokenDoc.move({ x, y }, { animate: true });
  } else {
    await tokenDoc.update({ x, y });
  }
  // The document can lag behind the resolved move: give it a moment to land before calling it blocked.
  const atTarget = () => tokenDoc.x === x && tokenDoc.y === y;
  for (let waited = 0; !atTarget() && waited < 2000; waited += 100) {
    await new Promise(r => setTimeout(r, 100));
  }
  const arrived = atTarget();
  const moved = tokenDoc.x !== from.x || tokenDoc.y !== from.y;
  log(`move ${tokenDoc.name} ${from.x},${from.y} → ${x},${y} (now ${tokenDoc.x},${tokenDoc.y}; completed: ${completed}, `
    + `state: ${tokenDoc.movement?.state}, arrived: ${arrived}, moved: ${moved}, walls checked: ${validated})`);
  return { ok: moved, x: tokenDoc.x, y: tokenDoc.y, constrained: !arrived, validated };
}
