import { MODULE_ID, SETTINGS, log } from "./constants.mjs";
import { registerSettings, getSetting, setSetting } from "./settings.mjs";
import { shouldUseCompanion, migrateStuckMobileMode } from "./device.mjs";
import { registerSocket } from "./socket.mjs";
import { CompanionApp } from "./app/companion-app.mjs";
import { getAdapter, registerAdapter } from "./systems/index.mjs";
import { Dnd5eAdapter } from "./systems/dnd5e.mjs";
import { DaggerheartAdapter } from "./systems/daggerheart.mjs";
import { activeScene } from "./movement.mjs";
import { fogRecorder, registerFogHooks } from "./fog.mjs";
import { registerDocSheet } from "./journal/doc-sheet.mjs";
import { registerRemoteRefresh } from "./journal/doc-editor.mjs";
import { startWakeLock } from "./wake-lock.mjs";

let app = null;

Hooks.once("init", () => {
  registerSettings();
  registerAdapter(Dnd5eAdapter);
  registerAdapter(DaggerheartAdapter);
  registerSocket();
  registerRemoteRefresh();
  // Runs on every client but only records on the active GM's (the one with a canvas).
  registerFogHooks();
  game.modules.get(MODULE_ID).api = {
    getApp: () => app, getAdapter, registerAdapter, CompanionApp,
    /** Forget what the party explored on a scene, e.g. from a macro: `game.modules.get("foundry-companion-local-phone").api.resetFog()` */
    resetFog: scene => fogRecorder.reset(scene)
  };
});

Hooks.once("ready", async () => {
  // Journal entries open as a document. The system's sheet stays available under "Configure Sheet".
  const base = registerDocSheet();
  log(`journal document sheet built over ${base.name}`);
  await migrateStuckMobileMode();
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
  startWakeLock();
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

  // The targets strip lists the scene's tokens: refresh it too, but only when the last render showed it.
  const sceneParts = () => (app.showsTargets ? ["map", "actions"] : ["map"]);
  for (const hook of ["createToken", "updateToken", "deleteToken"]) {
    Hooks.on(hook, token => { if (token.parent?.id === activeScene()?.id) app.markDirty(...sceneParts()); });
  }
  Hooks.on("updateScene", (scene, changes) => {
    if ("active" in changes || scene.id === activeScene()?.id) app.markDirty(...sceneParts());
  });
  for (const hook of ["createCombat", "updateCombat", "deleteCombat", "createCombatant", "updateCombatant", "deleteCombatant"]) {
    Hooks.on(hook, () => { if (app.showsTargets) app.markDirty("actions"); });
  }
  Hooks.on("canvasReady", () => app.markDirty("map"));
  Hooks.on("updateUser", (user, changes) => {
    if (user.id === game.user.id && "character" in changes) app.render({ force: true });
  });

  if (app.notes) {
    for (const name of ["JournalEntry", "JournalEntryPage", "Folder"]) {
      Hooks.on(`create${name}`, doc => app.notes.onDocumentChange(doc));
      Hooks.on(`delete${name}`, doc => app.notes.onDocumentChange(doc, { deleted: true }));
    }
    Hooks.on("updateJournalEntry", doc => app.notes.onDocumentChange(doc));
    Hooks.on("updateFolder", doc => app.notes.onDocumentChange(doc));
  }
}
