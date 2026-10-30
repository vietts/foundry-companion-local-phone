import { test } from "node:test";
import assert from "node:assert/strict";

// Just enough Foundry for the dnd5e adapter: a combat, a scene with tokens, an actor whose dnd5e methods
// end in core's Actor#rollInitiative, which (as in core) adds a tokenless combatant when asked to create
// combatants and the actor has no rendered tokens, i.e. always on a phone without a canvas.
const warnings = [];
let quickRolls = true;
globalThis.ui = { notifications: { warn: key => warnings.push(key), error: () => {} } };
globalThis.foundry = { applications: { api: { HandlebarsApplicationMixin: c => c, ApplicationV2: class {} } }, utils: {} };
globalThis.Hooks = { on() {}, once() {}, callAll() {}, call: () => true };
globalThis.game = {
  i18n: { localize: k => k, format: k => k },
  settings: { get: (mod, key) => (key === "quickRolls" ? quickRolls : undefined) },
  scenes: { active: null },
  combat: null
};
const { Dnd5eAdapter } = await import("../scripts/systems/dnd5e.mjs");

function setup({ inCombat = false, linked = true } = {}) {
  const combatants = [];
  const scene = { id: "s1", tokens: [] };
  const actor = {
    id: "a1", isToken: false, rolled: [],
    async rollInitiative({ createCombatants = false } = {}, rollOptions = {}) {
      if (createCombatants) combatants.push({ actorId: this.id, tokenId: null });
      this.rolled.push(rollOptions);
      return game.combat;
    },
    async rollInitiativeDialog(rollOptions = {}) {
      return this.rollInitiative({ createCombatants: true }, rollOptions);
    }
  };
  scene.tokens.push({ id: "t1", actorId: "a1", actorLink: linked, hidden: false, parent: scene });
  if (inCombat) combatants.push({ actorId: "a1", tokenId: "t1" });
  game.scenes.active = scene;
  game.combat = {
    scene,
    getCombatantsByActor: a => combatants.filter(c => c.actorId === a.id),
    async createEmbeddedDocuments(type, data) { combatants.push(...data); }
  };
  return { actor, combatants };
}

const roll = (adapter, actor) => adapter.handle(actor, "roll", { kind: "initiative" });

for (const quick of [true, false]) {
  const how = quick ? "quick roll" : "roll dialog";

  test(`initiative (${how}) for an actor already in combat adds no combatant`, async () => {
    quickRolls = quick;
    const { actor, combatants } = setup({ inCombat: true });
    const adapter = new Dnd5eAdapter();
    await roll(adapter, actor);
    await roll(adapter, actor);
    assert.equal(combatants.length, 1);
    assert.equal(actor.rolled.length, 2);
  });

  test(`initiative (${how}) for an actor not in combat joins once, with its token`, async () => {
    quickRolls = quick;
    const { actor, combatants } = setup();
    const adapter = new Dnd5eAdapter();
    await roll(adapter, actor);
    await roll(adapter, actor);
    assert.deepEqual(combatants.map(c => c.tokenId), ["t1"]);
    assert.equal(combatants[0].sceneId, "s1");
  });
}

test("initiative without a token on the scene joins as the actor alone", async () => {
  const { actor, combatants } = setup({ linked: false });
  await roll(new Dnd5eAdapter(), actor);
  assert.deepEqual(combatants, [{ actorId: "a1", hidden: false }]);
});

test("initiative without a combat warns and rolls nothing", async () => {
  const { actor } = setup();
  game.combat = null;
  warnings.length = 0;
  await roll(new Dnd5eAdapter(), actor);
  assert.deepEqual(warnings, ["COMBAT.NoneActive"]);
  assert.equal(actor.rolled.length, 0);
});

test("the patched rollInitiative is removed after the roll", async () => {
  const { actor } = setup({ inCombat: true });
  await roll(new Dnd5eAdapter(), actor);
  const before = actor.rollInitiative;
  await roll(new Dnd5eAdapter(), actor);
  assert.equal(actor.rollInitiative, before);
});

test("normal mode passes no advantage keys, so effects can still grant advantage", async () => {
  const { actor } = setup({ inCombat: true });
  const adapter = new Dnd5eAdapter();
  adapter.mode = "normal";
  await roll(adapter, actor);
  adapter.mode = "advantage";
  await roll(adapter, actor);
  assert.deepEqual(actor.rolled, [{}, { advantage: true }]);
});

test("two quick taps on initiative add one combatant, not two", async () => {
  quickRolls = true;
  const { actor, combatants } = setup();
  actor.uuid = "Actor.a1";
  const adapter = new Dnd5eAdapter();
  await Promise.all([roll(adapter, actor), roll(adapter, actor)]);
  assert.equal(combatants.length, 1);
  assert.equal(actor.rolled.length, 1);
});

test("a token actor whose token is on another scene warns and adds nothing", async () => {
  const { actor, combatants } = setup();
  actor.isToken = true;
  actor.uuid = "Scene.x.Token.t9.Actor.a1";
  actor.token = { id: "t9", parent: { id: "other" } };
  game.combat.getCombatantsByActor = () => [];
  warnings.length = 0;
  await roll(new Dnd5eAdapter(), actor);
  assert.deepEqual(combatants, []);
  assert.deepEqual(warnings, ["FCP.D5.InitiativeOffScene"]);
});
