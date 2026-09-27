export const MODULE_ID = "foundry-companion-local-phone";
export const SOCKET_NAME = `module.${MODULE_ID}`;
export const CSS_PREFIX = "fcp";

export const SETTINGS = {
  MOBILE_MODE: "mobileMode",
  CANVAS_PROMPTED: "canvasPrompted",
  MINIMAP_TOKENS: "minimapTokens",
  MOVE_RELAY: "moveRelay",
  MAP_FOG: "mapFog",
  MAP_STYLE: "mapStyle",
  CHAT_LIMIT: "chatLimit",
  QUICK_ROLLS: "quickRolls",
  DIGITAL_DICE: "digitalDice",
  LAST_ACTOR: "lastActor",
  LAST_TAB: "lastTab",
  RECENT_NOTES: "recentNotes",
  KEEP_AWAKE: "keepAwake"
};

/* Order of the bottom bar: what a player touches most often first, the map last. */
export const TABS = ["sheet", "actions", "inventory", "chat", "map"];

/** The GM has no character: notes and chat only. */
export const GM_TABS = ["notes", "chat"];

export function log(...args) {
  console.log(`${MODULE_ID} |`, ...args);
}

export function warn(...args) {
  console.warn(`${MODULE_ID} |`, ...args);
}
