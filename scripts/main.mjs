import { MODULE_ID, SETTINGS, log } from "./constants.mjs";
import { registerSettings, getSetting, setSetting } from "./settings.mjs";
import { shouldUseCompanion } from "./device.mjs";
import { registerSocket } from "./socket.mjs";
import { CompanionApp } from "./app/companion-app.mjs";
import { getAdapter, registerAdapter } from "./systems/index.mjs";
import { Dnd5eAdapter } from "./systems/dnd5e.mjs";
import { DaggerheartAdapter } from "./systems/daggerheart.mjs";
import { activeScene } from "./movement.mjs";
import { fogRecorder, registerFogHooks } from "./fog.mjs";

let app = null;

Hooks.once("init", () => {
  registerSettings();
  registerAdapter(Dnd5eAdapter);
  registerAdapter(DaggerheartAdapter);
  registerSocket();
  // Runs on every client but only records on the active GM's (the one with a canvas).
  registerFogHooks();
  game.modules.get(MODULE_ID).api = {
    getApp: () => app, getAdapter, registerAdapter, CompanionApp,
    /** Forget what the party explored on a scene, e.g. from a macro: `game.modules.get("foundry-companion-local-phone").api.resetFog()` */
    resetFog: scene => fogRecorder.reset(scene)
  };
});

Hooks.once("ready", async () => {
  if (!shouldUseCompanion()) return;
  await maybePromptCanvas();
  activateCompanion();
});

async function maybePromptCanvas() {
  let noCanvas = false;
  try { noCanvas = game.settings.get("core", "noCanvas"); } catch (err) { return; }
  if (noCanvas || getSetting(SETTINGS.CANVAS_PROMPTED)) return;
  await setSetting(SETTINGS.CANVAS_PROMPTED, true);
  const yes = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize("FCP.CanvasPrompt.Title") },
    content: game.i18n.localize("FCP.CanvasPrompt.Content"),
    yes: { label: game.i18n.localize("FCP.CanvasPrompt.Yes"), default: true },
    no: { label: game.i18n.localize("FCP.CanvasPrompt.No") },
    rejectClose: false
  });
  if (yes) {
    await game.settings.set("core", "noCanvas", true);
    window.location.reload();
    await new Promise(() => {}); // never resolve: page is reloading
  }
}

function activateCompanion() {
  const adapter = getAdapter();
  log(`companion mode on (system adapter: ${adapter.constructor.id})`);
  document.body.classList.add("fcp-active");
  app = new CompanionApp(adapter);
  app.render({ force: true });
  registerRefreshHooks();
}

function isCurrentActor(doc) {
  return doc && app?.actor && doc.id === app.actor.id;
}

function registerRefreshHooks() {
  const actorParts = ["header", "sheet", "actions", "inventory"];

  Hooks.on("updateActor", actor => { if (isCurrentActor(actor)) app.markDirty(...actorParts); });
  for (const hook of ["createItem", "updateItem", "deleteItem"]) {
    Hooks.on(hook, item => { if (isCurrentActor(item.parent)) app.markDirty(...actorParts); });
  }
  for (const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
    Hooks.on(hook, effect => {
      const actor = effect.parent?.documentName === "Actor" ? effect.parent : effect.parent?.parent;
      if (isCurrentActor(actor)) app.markDirty(...actorParts);
    });
  }

  Hooks.on("createChatMessage", message => app.onChatChanged(message));
  Hooks.on("updateChatMessage", message => app.onChatChanged(message));
  Hooks.on("deleteChatMessage", message => app.onChatChanged(message, { deleted: true }));

  for (const hook of ["createToken", "updateToken", "deleteToken"]) {
    Hooks.on(hook, token => { if (token.parent?.id === activeScene()?.id) app.markDirty("map"); });
  }
  Hooks.on("updateScene", (scene, changes) => {
    if ("active" in changes || scene.id === activeScene()?.id) app.markDirty("map");
  });
  Hooks.on("canvasReady", () => app.markDirty("map"));
  Hooks.on("updateUser", (user, changes) => {
    if (user.id === game.user.id && "character" in changes) app.render({ force: true });
  });
}
