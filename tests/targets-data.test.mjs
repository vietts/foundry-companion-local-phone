import { test } from "node:test";
import assert from "node:assert/strict";
import { filterCandidates, orderCandidates, isExplored, checkPlayRequest, sanitizeTargetIds, pruneTargets, requestUserId } from "../scripts/app/targets-data.mjs";

const tok = (id, extra = {}) => ({ id, name: id, hidden: false, isOwner: false, ...extra });

test("filterCandidates drops hidden tokens", () => {
  const out = filterCandidates([tok("a"), tok("b", { hidden: true })]);
  assert.deepEqual(out.map(t => t.id), ["a"]);
});

test("filterCandidates drops unexplored tokens but always keeps the user's own", () => {
  const explored = t => t.id === "seen";
  const out = filterCandidates([tok("seen"), tok("dark"), tok("mine", { isOwner: true })], { explored });
  assert.deepEqual(out.map(t => t.id), ["seen", "mine"]);
});

test("filterCandidates keeps the user's own tokens when nothing is explored yet", () => {
  const out = filterCandidates([tok("gob"), tok("mine", { isOwner: true })], { explored: () => false });
  assert.deepEqual(out.map(t => t.id), ["mine"]);
});

test("orderCandidates without combat: nearest first, origin last", () => {
  const dist = { me: 0, far: 5, near: 1, mid: 3 };
  const out = orderCandidates([tok("me"), tok("far"), tok("near"), tok("mid")], { originId: "me", distance: t => dist[t.id] });
  assert.deepEqual(out.map(t => t.id), ["near", "mid", "far", "me"]);
});

test("orderCandidates in combat: combatants by turn order, then the rest by distance", () => {
  const dist = { me: 0, wolf: 1, gob1: 4, gob2: 2, cat: 3 };
  const out = orderCandidates(
    [tok("me"), tok("wolf"), tok("gob1"), tok("gob2"), tok("cat")],
    { originId: "me", combatants: ["gob1", "me", "gob2"], distance: t => dist[t.id] }
  );
  assert.deepEqual(out.map(t => t.id), ["gob1", "gob2", "wolf", "cat", "me"]);
});

test("orderCandidates breaks distance ties by name and does not mutate the input", () => {
  const input = [tok("b"), tok("a")];
  const out = orderCandidates(input, { distance: () => 1 });
  assert.deepEqual(out.map(t => t.id), ["a", "b"]);
  assert.deepEqual(input.map(t => t.id), ["b", "a"]);
});

function mask(width, height, alphaAt) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[(y * width + x) * 4 + 3] = alphaAt(x, y);
  return { width, height, data };
}

test("isExplored reads the alpha of the mask", () => {
  const m = mask(4, 4, x => (x < 2 ? 255 : 0));
  assert.equal(isExplored(m, 0.5, 1.5), true);
  assert.equal(isExplored(m, 3.2, 1), false);
});

test("isExplored treats soft edges above half alpha as explored", () => {
  const m = mask(2, 1, x => (x === 0 ? 200 : 60));
  assert.equal(isExplored(m, 0, 0), true);
  assert.equal(isExplored(m, 1, 0), false);
});

test("isExplored is false outside the mask", () => {
  const m = mask(2, 2, () => 255);
  assert.equal(isExplored(m, -1, 0), false);
  assert.equal(isExplored(m, 2, 0), false);
  assert.equal(isExplored(m, 0, 2), false);
});

const user = { id: "u1" };
const actor = (id, owners) => ({ id, testUserPermission: (u, level) => level === "OWNER" && owners.includes(u.id) });
const tokenOf = a => ({ id: "t1", actor: a, testUserPermission: () => false });

test("checkPlayRequest: missing user, token or item", () => {
  const a = actor("a1", ["u1"]);
  const item = { parent: { id: "a1" } };
  assert.equal(checkPlayRequest({ user: null, tokenDoc: tokenOf(a), item }), "missing");
  assert.equal(checkPlayRequest({ user, tokenDoc: null, item }), "missing");
  assert.equal(checkPlayRequest({ user, tokenDoc: tokenOf(a), item: null }), "missing");
});

test("checkPlayRequest: the user must own the token's actor", () => {
  const a = actor("a1", ["someone-else"]);
  assert.equal(checkPlayRequest({ user, tokenDoc: tokenOf(a), item: { parent: { id: "a1" } } }), "denied");
});

test("checkPlayRequest: the item must belong to the token's actor", () => {
  const a = actor("a1", ["u1"]);
  assert.equal(checkPlayRequest({ user, tokenDoc: tokenOf(a), item: { parent: { id: "a2" } } }), "denied");
});

test("checkPlayRequest: an unlinked token's synthetic actor matches the world actor by id", () => {
  const synthetic = actor("a1", ["u1"]);
  const worldItem = { parent: { id: "a1" } }; // a different object with the same id
  assert.equal(checkPlayRequest({ user, tokenDoc: tokenOf(synthetic), item: worldItem }), null);
});

test("checkPlayRequest: a token without an actor is denied", () => {
  const tokenDoc = { id: "t1", actor: null, testUserPermission: () => true };
  assert.equal(checkPlayRequest({ user, tokenDoc, item: { parent: { id: "a1" } } }), "denied");
});

test("sanitizeTargetIds keeps known string ids once", () => {
  const known = new Set(["t1", "t2"]);
  assert.deepEqual(sanitizeTargetIds(["t1", 7, null, "zz", "t2", "t1"], id => known.has(id)), ["t1", "t2"]);
  assert.deepEqual(sanitizeTargetIds("t1", id => known.has(id)), []);
  assert.deepEqual(sanitizeTargetIds(undefined, id => known.has(id)), []);
});

test("pruneTargets drops ids that left the strip and says whether anything changed", () => {
  const selected = new Set(["gob", "wolf"]);
  assert.equal(pruneTargets(selected, new Set(["gob", "me"])), true);
  assert.deepEqual([...selected], ["gob"]);
  assert.equal(pruneTargets(selected, new Set(["gob"])), false);
  assert.deepEqual([...selected], ["gob"]);
});

test("requestUserId trusts the sender id from the server, never the message", () => {
  assert.equal(requestUserId({ userId: "someone-else" }, "u1"), "u1");
  assert.equal(requestUserId({ userId: "someone-else" }, undefined), null);
  assert.equal(requestUserId({ userId: "someone-else" }, 42), null);
});
