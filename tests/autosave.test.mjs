import { test } from "node:test";
import assert from "node:assert/strict";
import { createAutosave } from "../scripts/journal/autosave.mjs";

// Timers are mocked; promises are not, so let them run between ticks.
const settle = () => new Promise(resolve => setImmediate(resolve));

function setup(t, { initial = "", save } = {}) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let current = initial;
  const saves = [];
  const states = [];
  const autosave = createAutosave({
    initial,
    delay: 1000,
    read: () => current,
    save: save ?? (async value => { saves.push(value); }),
    onState: state => states.push(state)
  });
  const type = value => { current = value; autosave.touch(); };
  return { autosave, saves, states, type };
}

test("saves once, a second after the last change", async t => {
  const { saves, states, type } = setup(t);
  type("a");
  t.mock.timers.tick(500);
  type("ab");
  t.mock.timers.tick(999);
  await settle();
  assert.deepEqual(saves, []);
  assert.equal(states.at(-1), "dirty");
  t.mock.timers.tick(1);
  await settle();
  assert.deepEqual(saves, ["ab"]);
  assert.equal(states.at(-1), "saved");
});

test("flush saves right away", async t => {
  const { autosave, saves, type } = setup(t);
  type("x");
  assert.equal(await autosave.flush(), true);
  assert.deepEqual(saves, ["x"]);
});

test("flush with a value saves that value even without changes", async t => {
  const { autosave, saves } = setup(t);
  assert.equal(await autosave.flush("given"), true);
  assert.deepEqual(saves, ["given"]);
});

test("no save when the value is what is already stored", async t => {
  const { autosave, saves, type } = setup(t, { initial: "same" });
  type("same");
  assert.equal(await autosave.flush(), true);
  assert.deepEqual(saves, []);
});

test("a failed save keeps the change and is retried", async t => {
  let fail = true;
  const saved = [];
  const { autosave, states, type } = setup(t, {
    save: async value => {
      if (fail) throw new Error("offline");
      saved.push(value);
    }
  });
  type("x");
  assert.equal(await autosave.flush(), false);
  assert.equal(states.at(-1), "error");
  fail = false;
  assert.equal(await autosave.flush(), true);
  assert.deepEqual(saved, ["x"]);
  assert.equal(states.at(-1), "saved");
});

test("one save at a time, the next one with the newest value", async t => {
  const started = [];
  const releases = [];
  const { autosave, type } = setup(t, {
    save: value => {
      started.push(value);
      return new Promise(resolve => releases.push(resolve));
    }
  });
  type("a");
  const first = autosave.flush();
  await settle();
  assert.deepEqual(started, ["a"]);
  type("ab");
  const second = autosave.flush();
  await settle();
  assert.deepEqual(started, ["a"], "second save waits for the first");
  releases[0]();
  assert.equal(await first, false, "a newer change is still pending");
  await settle();
  assert.deepEqual(started, ["a", "ab"]);
  releases[1]();
  assert.equal(await second, true);
});

test("dispose cancels a pending save", async t => {
  const { autosave, saves, type } = setup(t);
  type("x");
  autosave.dispose();
  t.mock.timers.tick(1000);
  await settle();
  assert.deepEqual(saves, []);
});

test("hasChanges is false until there is something to save", async t => {
  const { autosave, type } = setup(t);
  assert.equal(autosave.hasChanges(), false);
  type("x");
  assert.equal(autosave.hasChanges(), true);
});

test("hasChanges is true while a save is in flight, false once it succeeds", async t => {
  const releases = [];
  const { autosave, type } = setup(t, {
    save: () => new Promise(resolve => releases.push(resolve))
  });
  type("x");
  const flushed = autosave.flush();
  await settle();
  assert.equal(autosave.hasChanges(), true, "a save is in flight");
  releases[0]();
  assert.equal(await flushed, true);
  assert.equal(autosave.hasChanges(), false);
});

test("hasChanges is true after a failed save", async t => {
  const { autosave, type } = setup(t, {
    save: async () => { throw new Error("offline"); }
  });
  type("x");
  assert.equal(await autosave.flush(), false);
  assert.equal(autosave.hasChanges(), true);
});

test("a change while flush(value) waits for a save in flight is kept and saved later", async t => {
  const started = [];
  const releases = [];
  const { autosave, type } = setup(t, {
    save: value => {
      started.push(value);
      return new Promise(resolve => releases.push(resolve));
    }
  });
  type("a");
  const first = autosave.flush();
  await settle();
  const second = autosave.flush("ab");
  await settle();
  type("abc");
  releases[0]();
  await first;
  await settle();
  assert.deepEqual(started, ["a", "ab"]);
  releases[1]();
  assert.equal(await second, false, "the newer change is still pending");
  assert.equal(autosave.hasChanges(), true);
  const third = autosave.flush();
  await settle();
  assert.deepEqual(started, ["a", "ab", "abc"]);
  releases[2]();
  assert.equal(await third, true);
  assert.equal(autosave.hasChanges(), false);
});

test("no save on flush() without changes after a successful save", async t => {
  const { autosave, saves, type } = setup(t);
  type("x");
  assert.equal(await autosave.flush(), true);
  assert.equal(await autosave.flush(), true);
  assert.deepEqual(saves, ["x"]);
});
