import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// ApplicationV2 silently ignores a data-action with no handler: a button that does nothing, no error.
// Every action name the adapters and templates put on a button must be in CompanionApp's actions.
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const app = read("scripts/app/companion-app.mjs");
const block = app.slice(app.indexOf("actions: {"), app.indexOf("static PARTS"));
const registered = new Set([...block.matchAll(/^\s*(\w+):/gm)].map(m => m[1]));

const used = new Map();
const note = (name, where) => used.set(name, [...(used.get(name) ?? []), where]);
for (const file of readdirSync(new URL("../scripts/systems/", import.meta.url))) {
  for (const m of read(`scripts/systems/${file}`).matchAll(/\baction:\s*"(\w+)"/g)) note(m[1], file);
}
for (const file of readdirSync(new URL("../templates/parts/", import.meta.url))) {
  for (const m of read(`templates/parts/${file}`).matchAll(/data-action="(\w+)"/g)) note(m[1], file);
}

test("every action used by adapters and templates has a handler", () => {
  const missing = [...used].filter(([name]) => !registered.has(name)).map(([name, where]) => `${name} (${where.join(", ")})`);
  assert.deepEqual(missing, []);
});
