import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { vfxApi, hasEffect, playLocally, resolveActionId, VFX_MODULE_ID } from "../scripts/vfx.mjs";

function installModule(mod) {
  globalThis.game = { modules: new Map(mod ? [[VFX_MODULE_ID, mod]] : []) };
}

beforeEach(() => {
  installModule(null);
  console.warn = () => {}; // keep the output clean: warn() is expected in some tests
});

const fakeApi = (over = {}) => ({ haEffetto: () => true, gioca: async () => true, ...over });

test("vfxApi is null without the module, when inactive, or without the functions", () => {
  assert.equal(vfxApi(), null);
  installModule({ active: false, api: fakeApi() });
  assert.equal(vfxApi(), null);
  installModule({ active: true, api: { gioca: async () => true } });
  assert.equal(vfxApi(), null);
  installModule({ active: true });
  assert.equal(vfxApi(), null);
});

test("vfxApi returns the api of the active module", () => {
  const api = fakeApi();
  installModule({ active: true, api });
  assert.equal(vfxApi(), api);
});

test("hasEffect is false without the module or without an item", () => {
  assert.equal(hasEffect({ name: "x" }, null), false);
  installModule({ active: true, api: fakeApi() });
  assert.equal(hasEffect(null, null), false);
});

test("hasEffect forwards item and action id and coerces to boolean", () => {
  const calls = [];
  installModule({ active: true, api: fakeApi({ haEffetto: (item, id) => { calls.push([item.name, id]); return id === "a1" ? 1 : 0; } }) });
  assert.equal(hasEffect({ name: "Card" }, "a1"), true);
  assert.equal(hasEffect({ name: "Card" }, "a2"), false);
  assert.deepEqual(calls, [["Card", "a1"], ["Card", "a2"]]);
});

test("hasEffect is false when haEffetto throws", () => {
  installModule({ active: true, api: fakeApi({ haEffetto: () => { throw new Error("boom"); } }) });
  assert.equal(hasEffect({ name: "Card" }, "a1"), false);
});

test("playLocally passes the parameters with the API's names", async () => {
  let got = null;
  installModule({ active: true, api: fakeApi({ gioca: async args => { got = args; return true; } }) });
  const item = { name: "Fire Bolt" };
  const res = await playLocally({ item, actionId: null, originId: "t0", targetIds: ["t1", "t2"] });
  assert.deepEqual(res, { ok: true });
  assert.equal(got.item, item);
  assert.equal(got.azioneId, undefined);
  assert.equal(got.origine, "t0");
  assert.deepEqual(got.bersagli, ["t1", "t2"]);
});

test("playLocally reports noEffect when gioca returns false or the module is missing", async () => {
  assert.deepEqual(await playLocally({ item: {}, originId: "t0", targetIds: [] }), { ok: false, reason: "noEffect" });
  installModule({ active: true, api: fakeApi({ gioca: async () => false }) });
  assert.deepEqual(await playLocally({ item: {}, originId: "t0", targetIds: [] }), { ok: false, reason: "noEffect" });
});

test("playLocally reports error when gioca throws", async () => {
  installModule({ active: true, api: fakeApi({ gioca: async () => { throw new Error("boom"); } }) });
  assert.deepEqual(await playLocally({ item: {}, originId: "t0", targetIds: [] }), { ok: false, reason: "error" });
});

test("resolveActionId maps the companion's attack marker to the weapon's attack action", () => {
  const weapon = { system: { attack: { id: "atk123" } } };
  assert.equal(resolveActionId(weapon, "attack"), "atk123");
  assert.equal(resolveActionId({ system: {} }, "attack"), "attack");
  assert.equal(resolveActionId(weapon, "act9"), "act9");
  assert.equal(resolveActionId(weapon, ""), null);
  assert.equal(resolveActionId(weapon, undefined), null);
  assert.equal(resolveActionId(null, "act9"), "act9");
});
