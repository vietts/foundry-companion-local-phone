import { test } from "node:test";
import assert from "node:assert/strict";

// dnd5e rolls the attack after the activity, from a clone of the item (Activity#use clones it):
// the phone's advantage must reach that roll, and must not linger once the use is over.
const hooks = new Map();
let nextId = 1;
globalThis.Hooks = {
  on(name, fn) { const id = nextId++; hooks.set(id, { name, fn }); return id; },
  off(name, id) { hooks.delete(id); },
  call(name, ...args) { for (const h of [...hooks.values()]) if (h.name === name) h.fn(...args); return true; },
  callAll() {}, once() {}
};
globalThis.ui = { notifications: { warn() {}, error() {} } };
globalThis.foundry = { applications: { api: { HandlebarsApplicationMixin: c => c, ApplicationV2: class {} } }, utils: {} };
globalThis.game = { i18n: { localize: k => k, format: k => k }, settings: { get: () => true }, scenes: { active: null }, combat: null };
const { Dnd5eAdapter } = await import("../scripts/systems/dnd5e.mjs");

const actor = { id: "a1", items: new Map() };
function weapon(id, { rolls = true, cancelled = false } = {}) {
  const item = { id, actor };
  item.use = async () => {
    if (cancelled) return null;
    const clone = { id, actor };
    const config = { subject: { item: clone }, rolls: [{ options: {} }] };
    if (rolls) Hooks.call("dnd5e.preRollAttackV2", config);
    item.lastConfig = config;
    return { message: true };
  };
  actor.items.set(id, item);
  return item;
}
const use = (adapter, id) => adapter.handle(actor, "useItem", { itemId: id });

test("advantage reaches the attack rolled from the item's clone", async () => {
  const sword = weapon("sword");
  const adapter = new Dnd5eAdapter();
  adapter.mode = "advantage";
  await use(adapter, "sword");
  assert.equal(sword.lastConfig.rolls[0].options.advantage, true);
  assert.equal(hooks.size, 0);
});

test("normal mode adds nothing and leaves no hook", async () => {
  const bow = weapon("bow");
  const adapter = new Dnd5eAdapter();
  adapter.mode = "normal";
  await use(adapter, "bow");
  assert.deepEqual(bow.lastConfig.rolls[0].options, {});
  assert.equal(hooks.size, 0);
});

test("a cancelled use removes the hook: a later attack is not given advantage", async () => {
  weapon("axe", { cancelled: true });
  const adapter = new Dnd5eAdapter();
  adapter.mode = "advantage";
  await use(adapter, "axe");
  assert.equal(hooks.size, 0);
});

test("another item's attack is left alone", async () => {
  const dagger = weapon("dagger", { rolls: false });
  weapon("club");
  const adapter = new Dnd5eAdapter();
  adapter.mode = "disadvantage";
  await use(adapter, "dagger");
  const config = { subject: { item: { id: "club", actor } }, rolls: [{ options: {} }] };
  Hooks.call("dnd5e.preRollAttackV2", config);
  assert.deepEqual(config.rolls[0].options, {});
  for (const id of [...hooks.keys()]) hooks.delete(id); // the 2-minute timer would clean it up
});
