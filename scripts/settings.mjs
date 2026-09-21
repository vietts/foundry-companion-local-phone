import { MODULE_ID, SETTINGS } from "./constants.mjs";

export function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.MOBILE_MODE, {
    name: "FCP.Settings.MobileMode.Name",
    hint: "FCP.Settings.MobileMode.Hint",
    scope: "client",
    config: true,
    type: String,
    choices: {
      auto: "FCP.Settings.MobileMode.Auto",
      on: "FCP.Settings.MobileMode.On",
      off: "FCP.Settings.MobileMode.Off"
    },
    default: "auto",
    requiresReload: true
  });

  game.settings.register(MODULE_ID, SETTINGS.CANVAS_PROMPTED, {
    name: "FCP.Settings.CanvasPrompted.Name",
    scope: "client",
    config: false,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, SETTINGS.MINIMAP_TOKENS, {
    name: "FCP.Settings.MinimapTokens.Name",
    hint: "FCP.Settings.MinimapTokens.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      owned: "FCP.Settings.MinimapTokens.Owned",
      friendly: "FCP.Settings.MinimapTokens.Friendly",
      all: "FCP.Settings.MinimapTokens.All"
    },
    default: "friendly"
  });

  game.settings.register(MODULE_ID, SETTINGS.MOVE_RELAY, {
    name: "FCP.Settings.MoveRelay.Name",
    hint: "FCP.Settings.MoveRelay.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.MAP_FOG, {
    name: "FCP.Settings.MapFog.Name",
    hint: "FCP.Settings.MapFog.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.MAP_STYLE, {
    name: "FCP.Settings.MapStyle.Name",
    hint: "FCP.Settings.MapStyle.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      schematic: "FCP.Settings.MapStyle.Schematic",
      image: "FCP.Settings.MapStyle.Image"
    },
    default: "schematic"
  });

  game.settings.register(MODULE_ID, SETTINGS.CHAT_LIMIT, {
    name: "FCP.Settings.ChatLimit.Name",
    hint: "FCP.Settings.ChatLimit.Hint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 10, max: 200, step: 10 },
    default: 40
  });

  game.settings.register(MODULE_ID, SETTINGS.DIGITAL_DICE, {
    name: "FCP.Settings.DigitalDice.Name",
    hint: "FCP.Settings.DigitalDice.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => game.modules.get(MODULE_ID)?.api?.getApp()?.render({ force: true })
  });

  game.settings.register(MODULE_ID, SETTINGS.QUICK_ROLLS, {
    name: "FCP.Settings.QuickRolls.Name",
    hint: "FCP.Settings.QuickRolls.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.LAST_ACTOR, {
    scope: "client",
    config: false,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, SETTINGS.LAST_TAB, {
    scope: "client",
    config: false,
    type: String,
    default: "sheet"
  });
}

export function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}

export async function setSetting(key, value) {
  return game.settings.set(MODULE_ID, key, value);
}
