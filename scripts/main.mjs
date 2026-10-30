import { MODULE_ID, SETTINGS, log } from "./constants.mjs";
import { registerSettings, getSetting, setSetting } from "./settings.mjs";
import { shouldUseCompanion, migrateStuckMobileMode, isLivePlayer } from "./device.mjs";
import { registerSocket } from "./socket.mjs";
import { registerDisplayHooks } from "./live-display.mjs";
import { CompanionApp } from "./app/companion-app.mjs";
import { getAdapter, registerAdapter } from "./systems/index.mjs";
import { Dnd5eAdapter } from "./systems/dnd5e.mjs";
import { DaggerheartAdapter } from "./systems/daggerheart.mjs";
import { activeScene } from "./movement.mjs";
import { fogRecorder, registerFogHooks, FOG_FLAG } from "./fog.mjs";
import { registerDocSheet } from "./journal/doc-sheet.mjs";
import { registerRemoteRefresh } from "./journal/doc-editor.mjs";
import { startWakeLock } from "./wake-lock.mjs";
import { installPicker } from "./app/picker.mjs";
import { installAdvancementTheme } from "./app/advancement.mjs";
import { installSpellStep, openSpellStep } from "./app/spell-step.mjs";
import { installRecovery, reportError } from "./errors.mjs";

let app = null;

Hooks.once("init", () => {
  registerSettings();
  registerAdapter(Dnd5eAdapter);
  registerAdapter(DaggerheartAdapter);
  registerSocket();
  registerDisplayHooks();
  registerRemoteRefresh();
  // Runs on every client but only records on the active GM's (the one with a canvas).
  registerFogHooks();
  game.modules.get(MODULE_ID).api = {
    getApp: () => app, getAdapter, registerAdapter, CompanionApp,
    /** Class spells window, e.g. from a macro: `api.openSpellStep(actor)` (first caster class) or `(actor, classId)`. */
    openSpellStep: (actor, classId) => openSpellStep(actor, classId),
    /** Forget what the party explored on a scene, e.g. from a macro: `game.modules.get("foundry-companion-local-phone").api.resetFog()` */
    resetFog: scene => fogRecorder.reset(scene)
  };
});

Hooks.once("setup", () => {
  // Partials are registered by path; the targets strip is shared by Actions and Map.
  foundry.applications.handlebars.loadTemplates([`modules/${MODULE_ID}/templates/parts/targets.hbs`]);
});

Hooks.once("ready", async () => {
  // Journal entries open as a document. The system's sheet stays available under "Configure Sheet".
  const base = registerDocSheet();
  log(`journal document sheet built over ${base.name}`);
  // Class spells after a level up: on every client, the level up can run on a desktop as well as on a phone.
  if (game.system.id === "dnd5e") installSpellStep();
  await migrateStuckMobileMode();
  if (!shouldUseCompanion()) return;
  await maybePromptCanvas();
  activateCompanion();
});

async function maybePromptCanvas() {
  let noCanvas = false;
  try { noCanvas = game.settings.get("core", "noCanvas"); } catch (err) { return; }
  if (noCanvas) return;
  // Live day: no question for people who have never seen Foundry, the phone just skips the canvas.
  if (isLivePlayer()) {
    await game.settings.set("core", "noCanvas", true);
    window.location.reload();
    await new Promise(() => {});
  }
  if (getSetting(SETTINGS.CANVAS_PROMPTED)) return;
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

/**
 * Core gives up after 10 tries 0.5 s apart and sends the browser to the exit page: a phone waking up often needs
 * longer than that to get its wifi back, and the player had to log in again (scan the QR again on a live day).
 * The phone keeps trying, a little slower, for as long as it takes.
 */
function keepReconnecting() {
  const manager = game.socket?.io;
  if (!manager?.reconnectionAttempts) return;
  manager.reconnectionAttempts(Infinity);
  manager.reconnectionDelayMax(3000);
}

function activateCompanion() {
  const adapter = getAdapter();
  log(`companion mode on (system adapter: ${adapter.constructor.id})`);
  document.body.classList.add("fcp-active");
  // dnd5e choices (spells and feats while leveling up, subclass) open as a phone list, not the compendium browser.
  if (game.system.id === "dnd5e") {
    installPicker();
    installAdvancementTheme();
  }
  installRecovery();
  keepReconnecting();
  app = new CompanionApp(adapter);
  app.render({ force: true }).catch(err => reportError("render", err));
  registerRefreshHooks();
  startWakeLock();
}

function isCurrentActor(doc) {
  return doc && app?.actor && doc.id === app.actor.id;
}

/** True when a scene update carries nothing but the module's explored-area flag. */
function onlyFogChanged(changes) {
  const keys = Object.keys(changes).filter(k => k !== "_id");
  if (keys.length !== 1 || keys[0] !== "flags") return false;
  const flags = Object.keys(changes.flags ?? {});
  if (flags.length !== 1 || flags[0] !== MODULE_ID) return false;
  return Object.keys(changes.flags[MODULE_ID] ?? {}).every(k => k === FOG_FLAG || k === `-=${FOG_FLAG}`);
}

function registerRefreshHooks() {
  const actorParts = ["header", "sheet", "actions", "inventory"];

  Hooks.on("updateActor", (actor, changes) => {
    if (isCurrentActor(actor)) app.markDirty(...actorParts);
    // A character just given to (or taken from) this player: the character picker has to know.
    else if ("ownership" in changes) app.markDirty(...actorParts);
  });
  for (const hook of ["createItem", "updateItem", "deleteItem"]) {
    Hooks.on(hook, item => { if (isCurrentActor(item.parent)) app.markDirty(...actorParts); });
  }
  for (const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
    Hooks.on(hook, effect => {
      const actor = effect.parent?.documentName === "Actor" ? effect.parent : effect.parent?.parent;
      if (isCurrentActor(actor)) app.markDirty(...actorParts);
    });
  }

  Hooks.on("createChatMessage", message => app.onChatChanged(message, { created: true }));
  Hooks.on("updateChatMessage", message => app.onChatChanged(message));
  Hooks.on("deleteChatMessage", message => app.onChatChanged(message, { deleted: true }));

  // The targets strip lists the scene's tokens: refresh it too, but only when the last render showed it.
  const sceneParts = () => (app.showsTargets ? ["map", "actions"] : ["map"]);
  const targetParts = () => [...(app.showsTargets ? ["actions"] : []), ...(app.mapShowsTargets ? ["map"] : [])];
  for (const hook of ["createToken", "updateToken", "deleteToken"]) {
    Hooks.on(hook, token => { if (token.parent?.id === activeScene()?.id) app.markDirty(...sceneParts()); });
  }
  Hooks.on("updateScene", (scene, changes) => {
    // The GM saves the explored area every few seconds while the party moves: swap the mask in place instead of
    // redrawing map and actions on every phone (heat and battery on cheap phones, taps lost mid-redraw).
    if (scene.id === activeScene()?.id && onlyFogChanged(changes)) return app.onFogChanged(scene, targetParts());
    if ("active" in changes || scene.id === activeScene()?.id) app.markDirty(...sceneParts());
  });
  for (const hook of ["createCombat", "updateCombat", "deleteCombat", "createCombatant", "updateCombatant", "deleteCombatant"]) {
    Hooks.on(hook, () => { const parts = targetParts(); if (parts.length) app.markDirty(...parts); });
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
