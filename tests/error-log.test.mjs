import { test } from "node:test";
import assert from "node:assert/strict";

// The log travels to the active GM, who alone writes the day's file; without a GM the phone keeps it.
const store = new Map();
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1" }, configurable: true });
globalThis.window = { innerWidth: 390, innerHeight: 844 };
const sent = [];
const uploads = [];
const users = new Map([["gm", { id: "gm", name: "Master", isGM: true }], ["p1", { id: "p1", name: "Tester", isGM: false }]]);
globalThis.game = {
  user: users.get("p1"),
  users: Object.assign(users, { activeGM: null }),
  system: { id: "dnd5e", version: "6.0.6" },
  version: "14.369",
  modules: new Map([["foundry-companion-local-phone", { version: "0.9.2" }]]),
  world: { id: "w" },
  socket: { emit: (name, msg, opts) => sent.push({ msg, opts }) }
};
globalThis.foundry = { utils: { getRoute: p => `/${p}` } };
globalThis.CONFIG = { ux: { FilePicker: { createDirectory: async () => {}, upload: async (src, dir, file) => uploads.push({ dir, text: await file.text() }) } } };
globalThis.fetch = async () => ({ ok: false });
const { logEvent, flushLogQueue, onLogEntries } = await import("../scripts/error-log.mjs");

test("without a GM the phone keeps entries, and sends them when one connects", () => {
  logEvent("error", "hp", new Error("boom"));
  assert.equal(sent.length, 0);
  const kept = JSON.parse(store.get("fcp-log-queue"));
  assert.equal(kept.length, 1);
  assert.equal(kept[0].msg, "boom");
  assert.equal(kept[0].user, "Tester");
  assert.match(kept[0].dev, /^iOS Safari 390x844$/);
  game.users.activeGM = users.get("gm");
  flushLogQueue();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].opts, { recipients: ["gm"] });
  assert.equal(store.has("fcp-log-queue"), false);
});

test("the same error is logged a few times per session, not on every redraw", () => {
  sent.length = 0;
  for (let i = 0; i < 20; i++) logEvent("error", "render", new Error("same"));
  assert.equal(sent.length, 5);
  assert.match(sent.at(-1).msg.entries[0].note, /repeated/);
});

test("the GM writes entries under the sender's real name, whatever the message says", async () => {
  game.user = users.get("gm");
  onLogEntries({ entries: [{ msg: "x", user: "Somebody else", gm: true }] }, "p1");
  await new Promise(r => setTimeout(r, 4200));
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].dir, "worlds/w/phone-companion-log");
  const line = JSON.parse(uploads[0].text.trim());
  assert.equal(line.user, "Tester");
  assert.equal(line.gm, false);
});
