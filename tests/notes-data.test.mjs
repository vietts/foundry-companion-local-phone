import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTree, matchesQuery, normalize, pushRecent, quickNoteName } from "../scripts/app/notes-data.mjs";

test("normalize drops case and accents", () => {
  assert.equal(normalize("  Città Perduta "), "citta perduta");
});

test("matchesQuery needs every word, in any order, without accents", () => {
  assert.equal(matchesQuery("La città perduta", "perduta citta"), true);
  assert.equal(matchesQuery("La città perduta", "citta sommersa"), false);
  assert.equal(matchesQuery("Anything", "   "), true);
});

test("buildTree lists folders first, then entries, and opens only open folders", () => {
  const folders = [
    { id: "f2", name: "Luoghi", parentId: null, sort: 200 },
    { id: "f1", name: "PNG", parentId: null, sort: 100 },
    { id: "f3", name: "Taverne", parentId: "f2", sort: 0 }
  ];
  const entries = [
    { id: "e1", name: "Oste", folderId: "f1", sort: 0 },
    { id: "e2", name: "Sessione 1", folderId: null, sort: 0 },
    { id: "e3", name: "Il Corvo", folderId: "f3", sort: 0 },
    { id: "e4", name: "Mappa", folderId: "f2", sort: 0 }
  ];
  assert.deepEqual(buildTree(folders, entries, new Set()), [
    { kind: "folder", id: "f1", name: "PNG", depth: 0, open: false },
    { kind: "folder", id: "f2", name: "Luoghi", depth: 0, open: false },
    { kind: "entry", id: "e2", name: "Sessione 1", depth: 0 }
  ]);
  assert.deepEqual(buildTree(folders, entries, new Set(["f2", "f3"])), [
    { kind: "folder", id: "f1", name: "PNG", depth: 0, open: false },
    { kind: "folder", id: "f2", name: "Luoghi", depth: 0, open: true },
    { kind: "folder", id: "f3", name: "Taverne", depth: 1, open: true },
    { kind: "entry", id: "e3", name: "Il Corvo", depth: 2 },
    { kind: "entry", id: "e4", name: "Mappa", depth: 1 },
    { kind: "entry", id: "e2", name: "Sessione 1", depth: 0 }
  ]);
});

test("buildTree falls back to the name when sort values tie", () => {
  const entries = [
    { id: "b", name: "Beta", folderId: null, sort: 0 },
    { id: "a", name: "Alfa", folderId: null, sort: 0 }
  ];
  assert.deepEqual(buildTree([], entries, new Set()).map(r => r.id), ["a", "b"]);
});

test("pushRecent puts the id first, without duplicates, capped", () => {
  assert.deepEqual(pushRecent(["a", "b", "c"], "b"), ["b", "a", "c"]);
  assert.deepEqual(pushRecent(["a", "b", "c", "d", "e"], "f"), ["f", "a", "b", "c", "d"]);
});

test("quickNoteName is the local date and time", () => {
  assert.equal(quickNoteName(new Date(2026, 8, 22, 18, 40), "it"), "22 set 2026, 18:40");
});
