# Effetti dal telefono — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nella scheda Azioni del companion, una striscia di bersagli e un ▶ sulle righe con un effetto: il ▶ fa giocare l'effetto di `daggerheart-vfx` sullo schermo del GM, dal token del giocatore verso i bersagli.

**Architecture:** `scripts/vfx.mjs` è l'unico punto che conosce l'API di `daggerheart-vfx`. `scripts/app/targets-data.mjs` contiene le funzioni pure (ordine, filtri, nebbia, permessi). `socket.mjs` aggiunge il giro `vfxRequest`/`vfxResult` verso il client del GM, sullo stesso schema di `moveRequest`. `companion-app.mjs` e `items.hbs` disegnano striscia e ▶. Gli adattatori di sistema non cambiano.

**Tech Stack:** Foundry VTT v14 (ApplicationV2 + Handlebars), ES modules, `node --test` (Node 25) per le funzioni pure.

**Spec:** `docs/superpowers/specs/2026-09-25-vfx-bersagli-design.md`

## Global Constraints

- API di `daggerheart-vfx` (spec della parte 1, §7): `game.modules.get("daggerheart-vfx").api.gioca({ item, azioneId, origine, bersagli }) → Promise<boolean>` e `api.haEffetto(item, azioneId) → boolean`. `origine` e `bersagli` sono **id di token**.
- Il companion non dipende da `daggerheart-vfx`: senza modulo attivo la scheda Azioni è identica a oggi.
- Il ▶ non consuma slot, Speranza o altre risorse.
- `gioca` si chiama solo sul client del GM attivo, dopo il controllo che l'utente possieda l'attore del token d'origine e che l'item sia di quell'attore.
- Un effetto non blocca mai il gioco: ogni eccezione è catturata e scritta con `warn` (prefisso del modulo).
- Testi utente in `lang/it.json` e `lang/en.json` (chiavi piatte `FCP.…`), in italiano corretto con gli accenti.
- Stile Carta & Inchiostro: solo le variabili già definite su `#fcp-app` (`--color-text`, `--color-accent`, `--color-green`, `--color-surface`, `--fcp-tap`, `--fcp-lift`…).
- Test: `node --test tests/*.test.mjs` (con `tests/` da solo Node 25 fallisce).
- Commit con la riga `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Il Foundry locale (`localhost:30000`, mondo `fcp-test`) è condiviso con la sessione di `daggerheart-vfx`: le verifiche nel browser si fanno a turno, chiedendo a Francesco prima di avviarlo o di usarlo.

## Review Focus

1. **Azione d'attacco Daggerheart**: il companion marca l'attacco con l'arma come `action-id="attack"`, ma l'API vuole l'id vero dell'azione → `resolveActionId` lo traduce in `item.system.attack.id` (test nel Task 2).
2. **Token sconosciuti nella richiesta**: un `vfxRequest` con `targetIds` non stringa o non presenti in scena non deve far esplodere il GM → il GM filtra i `targetIds` (test su `sanitizeTargetIds` nel Task 1).
3. **Nebbia non ancora registrata** (scena nuova, maschera assente o in decodifica): la striscia non deve restare vuota → i token dell'utente passano sempre (test su `filterCandidates` con `explored` che rifiuta tutto nel Task 1).
4. **Token d'attore non collegato**: l'item arriva dall'attore del mondo, `tokenDoc.actor` è sintetico con lo stesso id → `checkPlayRequest` confronta gli id, non le istanze (test nel Task 1).
5. **Bersagli rimasti selezionati dopo che il token è sparito o è stato nascosto**: non vanno inviati → la striscia riduce la selezione ai candidati visibili (Task 4, passo di verifica manuale 3 nel Task 5).

---

### Task 1: Funzioni pure dei bersagli (`targets-data.mjs`)

**Files:**
- Create: `scripts/app/targets-data.mjs`
- Test: `tests/targets-data.test.mjs`

**Interfaces:**
- Produces:
  - `filterCandidates(tokens, { explored }?) → token[]`: toglie `hidden`; se `explored` è una funzione, tiene i token con `t.isOwner` o `explored(t) === true`.
  - `orderCandidates(tokens, { originId, combatants, distance }?) → token[]`: combattenti (`combatants`: array ordinato di id token) nell'ordine dato, poi gli altri per `distance(t)` crescente, poi per nome; `originId` sempre in fondo. Non modifica l'input.
  - `isExplored(imageData, x, y) → boolean`: `imageData = { width, height, data }` (RGBA); `true` se il pixel `(floor(x), floor(y))` è dentro l'immagine e ha alfa ≥ 128.
  - `checkPlayRequest({ user, tokenDoc, item }) → null | "missing" | "denied"`.
  - `sanitizeTargetIds(ids, hasToken) → string[]`: tiene solo stringhe per cui `hasToken(id)` è vero, senza duplicati.

- [ ] **Step 1: Scrivi i test che falliscono**

`tests/targets-data.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { filterCandidates, orderCandidates, isExplored, checkPlayRequest, sanitizeTargetIds } from "../scripts/app/targets-data.mjs";

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
```

- [ ] **Step 2: Verifica che falliscano**

Run: `node --test tests/targets-data.test.mjs`
Expected: FAIL con `Cannot find module '.../scripts/app/targets-data.mjs'`

- [ ] **Step 3: Implementa**

`scripts/app/targets-data.mjs`:

```js
/* Candidates for the targets strip and checks on effect requests. Pure: no Foundry globals. */

/** Tokens that may appear in the strip: never hidden ones; with fog, only explored ones (the user's own always). */
export function filterCandidates(tokens, { explored = null } = {}) {
  return tokens.filter(t => !t.hidden && (!explored || t.isOwner || explored(t) === true));
}

/**
 * Combatants first in turn order, then the others by distance, the acting token always last.
 * `combatants` is the ordered list of token ids of the scene's combat; `distance(t)` is in grid cells.
 */
export function orderCandidates(tokens, { originId = null, combatants = [], distance = () => 0 } = {}) {
  const turn = new Map(combatants.map((id, i) => [id, i]));
  const rank = t => (t.id === originId ? 2 : turn.has(t.id) ? 0 : 1);
  return [...tokens].sort((a, b) =>
    rank(a) - rank(b)
    || (rank(a) === 0 ? turn.get(a.id) - turn.get(b.id) : 0)
    || distance(a) - distance(b)
    || String(a.name ?? "").localeCompare(String(b.name ?? "")));
}

/** Whether a point of the explored-area mask (in mask pixels) is explored: opaque enough, inside the image. */
export function isExplored(imageData, x, y) {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= imageData.width || py >= imageData.height) return false;
  return imageData.data[(py * imageData.width + px) * 4 + 3] >= 128;
}

/**
 * GM side: may this user play this item from this token? The item comes from the world actor while an
 * unlinked token carries a synthetic actor with the same id, so actors are compared by id.
 */
export function checkPlayRequest({ user, tokenDoc, item }) {
  if (!user || !tokenDoc || !item) return "missing";
  const actor = tokenDoc.actor;
  if (!actor || !actor.testUserPermission(user, "OWNER")) return "denied";
  if (item.parent?.id !== actor.id) return "denied";
  return null;
}

/** Target ids from a socket message: strings only, known to the scene, once each. */
export function sanitizeTargetIds(ids, hasToken) {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter(id => typeof id === "string" && hasToken(id)))];
}
```

- [ ] **Step 4: Verifica che passino**

Run: `node --test tests/*.test.mjs`
Expected: PASS, 0 fail (18 test esistenti più quelli nuovi)

- [ ] **Step 5: Commit**

```bash
git add scripts/app/targets-data.mjs tests/targets-data.test.mjs
git commit -m "Targets strip helpers: order, fog and permission checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Il ponte con daggerheart-vfx (`vfx.mjs`)

**Files:**
- Create: `scripts/vfx.mjs`
- Test: `tests/vfx.test.mjs`

**Interfaces:**
- Consumes: `warn` da `scripts/constants.mjs` (puro, importabile da Node).
- Produces:
  - `VFX_MODULE_ID = "daggerheart-vfx"`
  - `vfxApi() → api | null`: l'API se il modulo è attivo ed espone `gioca` e `haEffetto` come funzioni.
  - `resolveActionId(item, raw) → string | null`: `raw === "attack"` → `item.system.attack.id` se c'è; stringa vuota, `null` o `undefined` → `null`; altrimenti `raw`.
  - `hasEffect(item, actionId) → boolean`: mai eccezioni.
  - `playLocally({ item, actionId, originId, targetIds }) → Promise<{ ok: true } | { ok: false, reason: "noEffect" | "error" }>`: chiama `api.gioca({ item, azioneId, origine, bersagli })`.

- [ ] **Step 1: Scrivi i test che falliscono**

`tests/vfx.test.mjs`:

```js
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
```

- [ ] **Step 2: Verifica che falliscano**

Run: `node --test tests/vfx.test.mjs`
Expected: FAIL con `Cannot find module '.../scripts/vfx.mjs'`

- [ ] **Step 3: Implementa**

`scripts/vfx.mjs`:

```js
import { warn } from "./constants.mjs";

/* The only place that knows the daggerheart-vfx ("Tavolo VFX") API. Without the module nothing changes. */

export const VFX_MODULE_ID = "daggerheart-vfx";

/** The effects API when the module is active and exposes it, otherwise null. */
export function vfxApi() {
  const mod = globalThis.game?.modules?.get(VFX_MODULE_ID);
  const api = mod?.active ? mod.api : null;
  return api && typeof api.gioca === "function" && typeof api.haEffetto === "function" ? api : null;
}

/** Daggerheart rows mark the weapon attack as "attack": the API wants the id of the attack action. */
export function resolveActionId(item, raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  if (raw === "attack") return item?.system?.attack?.id ?? raw;
  return raw;
}

/** Whether an item (and action) has an effect. Never throws. */
export function hasEffect(item, actionId) {
  const api = vfxApi();
  if (!api || !item) return false;
  try {
    return !!api.haEffetto(item, actionId ?? undefined);
  } catch (err) {
    warn("haEffetto failed for", item.name, err);
    return false;
  }
}

/** Play an effect on this client (the active GM's, which has the canvas). */
export async function playLocally({ item, actionId = null, originId, targetIds = [] }) {
  const api = vfxApi();
  if (!api) return { ok: false, reason: "noEffect" };
  try {
    const ok = await api.gioca({ item, azioneId: actionId ?? undefined, origine: originId, bersagli: targetIds });
    return ok ? { ok: true } : { ok: false, reason: "noEffect" };
  } catch (err) {
    warn("gioca failed", err);
    return { ok: false, reason: "error" };
  }
}
```

- [ ] **Step 4: Verifica che passino**

Run: `node --test tests/*.test.mjs`
Expected: PASS, 0 fail

- [ ] **Step 5: Commit**

```bash
git add scripts/vfx.mjs tests/vfx.test.mjs
git commit -m "Bridge to the daggerheart-vfx API, optional and never throwing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Richiesta dell'effetto via socket

**Files:**
- Modify: `scripts/socket.mjs` (switch di `onSocketMessage`, nuove funzioni in fondo)
- Modify: `lang/it.json`, `lang/en.json` (chiavi `FCP.Vfx.Fail.*`)

**Interfaces:**
- Consumes: `checkPlayRequest`, `sanitizeTargetIds` (Task 1); `playLocally` (Task 2).
- Produces: `requestPlay({ tokenDoc, item, actionId, targetIds }) → Promise<{ ok: boolean, reason?: "noGM" | "missing" | "denied" | "scene" | "noEffect" | "error" | "timeout" }>` esportata da `scripts/socket.mjs`. Ogni `reason` ha la chiave `FCP.Vfx.Fail.<reason>`.

Non ci sono test automatici: il codice è colla verso `game.socket`, `fromUuid` e `canvas`. La logica decisionale è già testata nei Task 1-2; il giro completo si verifica in Foundry nel Task 5.

- [ ] **Step 1: Aggiungi i casi al socket**

In `scripts/socket.mjs`, import in cima:

```js
import { checkPlayRequest, sanitizeTargetIds } from "./app/targets-data.mjs";
import { playLocally } from "./vfx.mjs";
```

Nello `switch (msg.type)` di `onSocketMessage`, dopo il caso `moveResult`:

```js
    case "vfxRequest":
      if (game.user.isActiveGM) return handleVfxRequest(msg);
      return;
    case "vfxResult":
      if (msg.targetUserId !== game.user.id) return;
      return resolvePending(msg);
```

- [ ] **Step 2: Lato GM e lato giocatore**

In fondo a `scripts/socket.mjs`:

```js
/** GM side: check who asks, then play the effect on this client's canvas. */
async function handleVfxRequest(msg) {
  const reply = payload => game.socket.emit(SOCKET_NAME, {
    type: "vfxResult", requestId: msg.requestId, targetUserId: msg.userId, ...payload
  });
  try {
    const user = game.users.get(msg.userId);
    const scene = game.scenes.get(msg.sceneId);
    const tokenDoc = scene?.tokens.get(msg.originId) ?? null;
    const item = typeof msg.itemUuid === "string" ? await fromUuid(msg.itemUuid) : null;
    const reason = checkPlayRequest({ user, tokenDoc, item });
    if (reason) return reply({ ok: false, reason });
    if (canvas?.scene?.id !== scene.id) return reply({ ok: false, reason: "scene" });
    const targetIds = sanitizeTargetIds(msg.targetIds, id => scene.tokens.has(id));
    const actionId = typeof msg.actionId === "string" ? msg.actionId : null;
    return reply(await playLocally({ item, actionId, originId: tokenDoc.id, targetIds }));
  } catch (err) {
    warn("effect request failed", err);
    return reply({ ok: false, reason: "error" });
  }
}

/**
 * Player side: ask the active GM, who has the canvas, to play the effect. There is no local fallback:
 * the phone has no canvas to play on.
 */
export async function requestPlay({ tokenDoc, item, actionId = null, targetIds = [] }) {
  if (game.user.isActiveGM) {
    if (canvas?.scene?.id !== tokenDoc.parent.id) return { ok: false, reason: "scene" };
    return playLocally({ item, actionId, originId: tokenDoc.id, targetIds });
  }
  if (!game.users.activeGM) return { ok: false, reason: "noGM" };

  const requestId = foundry.utils.randomID();
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({ ok: false, reason: "timeout" });
    }, TIMEOUT_MS);
    pending.set(requestId, { resolve, timer });
    game.socket.emit(SOCKET_NAME, {
      type: "vfxRequest", requestId, userId: game.user.id,
      sceneId: tokenDoc.parent.id, originId: tokenDoc.id, targetIds,
      itemUuid: item.uuid, actionId
    });
  });
}
```

- [ ] **Step 3: Testi degli errori**

In `lang/it.json`, prima della `}` finale (aggiungi la virgola alla riga precedente):

```json
  "FCP.Vfx.Fail.noGM": "Nessun GM connesso: l'effetto parte dallo schermo del GM.",
  "FCP.Vfx.Fail.missing": "Effetto non riprodotto: token o oggetto non trovato.",
  "FCP.Vfx.Fail.denied": "Non controlli questo personaggio.",
  "FCP.Vfx.Fail.scene": "Il GM non ha aperta la scena del tuo token.",
  "FCP.Vfx.Fail.noEffect": "Effetto non riprodotto.",
  "FCP.Vfx.Fail.error": "Errore nel riprodurre l'effetto (vedi la console del GM).",
  "FCP.Vfx.Fail.timeout": "Il GM non ha risposto."
```

In `lang/en.json`, nello stesso punto:

```json
  "FCP.Vfx.Fail.noGM": "No GM connected: effects play on the GM's screen.",
  "FCP.Vfx.Fail.missing": "Effect not played: token or item not found.",
  "FCP.Vfx.Fail.denied": "You do not control this character.",
  "FCP.Vfx.Fail.scene": "The GM does not have your token's scene open.",
  "FCP.Vfx.Fail.noEffect": "Effect not played.",
  "FCP.Vfx.Fail.error": "Error while playing the effect (see the GM's console).",
  "FCP.Vfx.Fail.timeout": "The GM did not answer."
```

- [ ] **Step 4: Controlla sintassi e JSON**

Run: `node --check scripts/socket.mjs && node -e 'for (const f of ["lang/it.json","lang/en.json"]) JSON.parse(require("fs").readFileSync(f,"utf8")); console.log("ok")' && node --test tests/*.test.mjs`
Expected: `ok`, poi PASS con 0 fail

- [ ] **Step 5: Commit**

```bash
git add scripts/socket.mjs lang/it.json lang/en.json
git commit -m "Effect requests: the GM checks ownership and plays the effect

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Striscia dei bersagli e ▶ nella scheda Azioni

**Files:**
- Modify: `scripts/app/companion-app.mjs` (import, costruttore, `DEFAULT_OPTIONS.actions`, `_preparePartContext` caso `actions`, nuovi metodi privati e handler statici)
- Modify: `templates/parts/items.hbs` (striscia in cima, riga + ▶)
- Modify: `styles/companion.css` (regola `.fcp-item.expanded > .fcp-row` e stili nuovi)
- Modify: `scripts/main.mjs` (hook di refresh)
- Modify: `lang/it.json`, `lang/en.json` (etichette della striscia)

**Interfaces:**
- Consumes: `filterCandidates`, `orderCandidates`, `isExplored` (Task 1); `vfxApi`, `hasEffect`, `resolveActionId` (Task 2); `requestPlay` (Task 3); `activeScene` da `movement.mjs`; `FOG_FLAG` da `fog.mjs` (già importato).
- Produces: contesto della parte `actions` con `targets = null | { noToken: true } | { list: [{ id, name, short, img, cls, selected, mine }], count, color }`; righe con `vfx = { actionId }`; azioni UI `toggleTarget`, `clearTargets`, `playVfx`.

- [ ] **Step 1: Import e stato**

In `scripts/app/companion-app.mjs`, import in cima:

```js
import { requestMove, requestPlay } from "../socket.mjs";
import { vfxApi, hasEffect, resolveActionId } from "../vfx.mjs";
import { filterCandidates, orderCandidates, isExplored } from "./targets-data.mjs";
```

(sostituisce la riga `import { requestMove } from "../socket.mjs";`). Nel costruttore, dopo `this.spellFilter = "all";`:

```js
    /** Tokens targeted from the phone. Without a canvas `game.user.targets` stays empty, so the ids live here. */
    this.targetIds = new Set();
```

In `DEFAULT_OPTIONS.actions`, dopo `selectToken: CompanionApp.#onSelectToken,`:

```js
      toggleTarget: CompanionApp.#onToggleTarget,
      clearTargets: CompanionApp.#onClearTargets,
      playVfx: CompanionApp.#onPlayVfx,
```

- [ ] **Step 2: Contesto della parte Azioni**

In `_preparePartContext`, caso `"actions"`, dopo `await this.#decorateItems(actor, context.groups);`:

```js
        context.targets = actor && this.#decorateVfx(actor, context.groups) ? this.#prepareTargets() : null;
```

`items.hbs` è condiviso con la parte Oggetti: nel caso `"inventory"`, dopo `context.tabId = "inventory";`, aggiungi `context.targets = null;` così la striscia non compare mai lì.

Nuovi metodi privati, subito dopo `#decorateItems`:

```js
  /** Mark the rows whose item has an effect; true when at least one does. */
  #decorateVfx(actor, groups) {
    if (!vfxApi()) return false;
    let any = false;
    for (const group of groups) {
      for (const row of group.items ?? []) {
        const item = row.id ? actor.items.get(row.id) : null;
        const actionId = resolveActionId(item, row.data?.["action-id"]);
        if (item && hasEffect(item, actionId)) {
          row.vfx = { actionId: actionId ?? "" };
          any = true;
        }
      }
    }
    return any;
  }

  /** Candidates of the targets strip: visible tokens of the active scene, nearest first, mine last. */
  #prepareTargets() {
    const scene = activeScene();
    const origin = this.token;
    if (!scene || !origin) return { noToken: true };
    const grid = scene.grid;
    const center = t => ({ x: t.x + (t.width * grid.sizeX) / 2, y: t.y + (t.height * grid.sizeY) / 2 });
    const o = center(origin);
    const distance = t => {
      const c = center(t);
      return Math.max(Math.abs(c.x - o.x) / grid.sizeX, Math.abs(c.y - o.y) / grid.sizeY);
    };
    const combat = game.combats?.find(c => c.scene?.id === scene.id && c.started) ?? null;
    const combatants = combat ? combat.turns.map(c => c.tokenId).filter(Boolean) : [];
    const list = orderCandidates(
      filterCandidates(scene.tokens.contents, { explored: this.#fogTest(scene, center) }),
      { originId: origin.id, combatants, distance }
    );
    // Targets that left the strip (deleted, hidden, fogged, other scene) are dropped, so they are never sent.
    const visible = new Set(list.map(t => t.id));
    for (const id of this.targetIds) if (!visible.has(id)) this.targetIds.delete(id);
    return {
      list: list.map(t => ({
        id: t.id,
        name: t.name,
        short: (t.name ?? "").trim().split(/\s+/)[0].slice(0, 10),
        img: this.#tokenImage(t),
        cls: t.id === origin.id ? "mine"
          : (t.isOwner || t.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY) ? "friendly"
          : t.disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE ? "hostile" : "other",
        selected: this.targetIds.has(t.id),
        mine: t.id === origin.id
      })),
      count: this.targetIds.size,
      color: game.user.color?.css ?? String(game.user.color ?? "")
    };
  }

  #fog = { src: null, data: null };

  /** With fog on, a test "is this token's center explored"; null when fog is off. */
  #fogTest(scene, center) {
    if (!getSetting(SETTINGS.MAP_FOG)) return null;
    const src = scene.getFlag(MODULE_ID, FOG_FLAG);
    if (!src) return () => false; // nothing explored yet: only the user's own tokens
    if (this.#fog.src !== src) this.#loadFog(src);
    const mask = this.#fog.data;
    if (!mask) return () => false; // still decoding: re-rendered once ready
    const d = scene.dimensions;
    return t => {
      const c = center(t);
      return isExplored(mask, ((c.x - d.sceneX) * mask.width) / d.sceneWidth, ((c.y - d.sceneY) * mask.height) / d.sceneHeight);
    };
  }

  /** Decode the explored-area image once per change and re-render the actions. */
  #loadFog(src) {
    this.#fog = { src, data: null };
    const img = new Image();
    img.onload = () => {
      if (this.#fog.src !== src) return;
      const el = document.createElement("canvas");
      el.width = img.naturalWidth;
      el.height = img.naturalHeight;
      const ctx = el.getContext("2d");
      ctx.drawImage(img, 0, 0);
      this.#fog.data = ctx.getImageData(0, 0, el.width, el.height);
      this.markDirty("actions");
    };
    img.onerror = () => warn("could not read the explored area for the targets strip");
    img.src = src;
  }

  /** Share the targets: Foundry draws the user's crosshair on every client with a canvas. */
  #syncTargets() {
    try {
      game.user.updateTokenTargets(Array.from(this.targetIds));
    } catch (err) {
      warn("could not share the targets", err);
    }
  }
```

- [ ] **Step 3: Handler**

Accanto agli altri handler statici (dopo `#onSelectToken`):

```js
  static #onToggleTarget(event, target) {
    const id = target.dataset.tokenId;
    if (!id) return;
    if (this.targetIds.has(id)) this.targetIds.delete(id);
    else this.targetIds.add(id);
    this.#syncTargets();
    this.markDirty("actions");
  }

  static #onClearTargets() {
    this.targetIds.clear();
    this.#syncTargets();
    this.markDirty("actions");
  }

  static async #onPlayVfx(event, target) {
    const tokenDoc = this.token;
    const item = this.actor?.items.get(target.dataset.itemId);
    if (!tokenDoc || !item || target.disabled) return;
    target.disabled = true;
    target.classList.add("playing");
    try {
      const targetIds = Array.from(this.targetIds).filter(id => tokenDoc.parent.tokens.has(id));
      const result = await requestPlay({ tokenDoc, item, actionId: target.dataset.vfxAction || null, targetIds });
      if (!result.ok) ui.notifications.warn(game.i18n.localize(`FCP.Vfx.Fail.${result.reason ?? "error"}`));
    } catch (err) {
      warn("effect request failed", err);
      ui.notifications.warn(game.i18n.localize("FCP.Vfx.Fail.error"));
    } finally {
      target.disabled = false;
      target.classList.remove("playing");
    }
  }
```

- [ ] **Step 4: Template**

In `templates/parts/items.hbs`, subito dopo `{{#unless groups.length}}…{{/unless}}` (riga 5):

```hbs
  {{#if targets}}
  <div class="fcp-targets" style="--fcp-user: {{targets.color}};">
    <div class="fcp-targets-head">
      <span class="fcp-label">{{localize "FCP.Vfx.Targets"}}</span>
      {{#if targets.count}}
      <button type="button" class="fcp-targets-clear" data-action="clearTargets" aria-label="{{localize 'FCP.Vfx.Clear'}}"><b>{{targets.count}}</b><i class="ph-duotone ph-x"></i></button>
      {{/if}}
    </div>
    {{#if targets.noToken}}
    <div class="fcp-targets-empty">{{localize "FCP.Vfx.NoToken"}}</div>
    {{else}}
    <div class="fcp-targets-strip">
      {{#each targets.list}}
      <button type="button" class="fcp-target {{this.cls}} {{#if this.selected}}on{{/if}}" data-action="toggleTarget" data-token-id="{{this.id}}" aria-pressed="{{#if this.selected}}true{{else}}false{{/if}}" title="{{this.name}}">
        <span class="fcp-target-img" style="background-image: url('{{this.img}}');"></span>
        <span class="fcp-target-name">{{this.short}}</span>
      </button>
      {{/each}}
    </div>
    {{/if}}
  </div>
  {{/if}}
```

Sostituisci il bottone della riga (il blocco `<button type="button" class="fcp-row …">…</button>` dentro `<div class="fcp-item …">`) con lo stesso bottone avvolto e affiancato dal ▶:

```hbs
      <div class="fcp-row-line">
      <button type="button" class="fcp-row {{#if this.inactive}}fcp-inactive{{/if}} {{#if this.big}}big{{/if}}" {{#if this.id}}data-action="expandItem" data-item-id="{{this.id}}"{{else}}data-action="noop"{{/if}}>
        <img src="{{this.img}}" alt="">
        <span class="fcp-row-main">
          <span class="fcp-row-title">{{this.name}}</span>
          {{#if this.meta}}<span class="fcp-row-meta">{{this.meta}}</span>{{/if}}
        </span>
        <span class="fcp-row-right">
          {{#if this.uses}}<span class="fcp-uses">{{this.uses.value}} / {{this.uses.max}}</span>{{/if}}
          {{#if this.id}}<i class="ph-duotone ph-caret-{{#if this.expanded}}up{{else}}down{{/if}} fcp-chevron"></i>{{/if}}
        </span>
      </button>
      {{#if this.vfx}}
      <button type="button" class="fcp-play" data-action="playVfx" data-item-id="{{this.id}}" data-vfx-action="{{this.vfx.actionId}}" {{#if ../../targets.noToken}}disabled{{/if}} aria-label="{{localize 'FCP.Vfx.Play'}}: {{this.name}}"><span class="fcp-play-icon"></span></button>
      {{/if}}
      </div>
```

- [ ] **Step 5: Stili**

In `styles/companion.css`, sostituisci:

```css
.fcp-item.expanded > .fcp-row {
  background: var(--color-surface);
}
```

con:

```css
.fcp-item.expanded > .fcp-row-line {
  background: var(--color-surface);
}

.fcp-row-line {
  display: flex;
  align-items: center;
  gap: 6px;
}

.fcp-row-line > .fcp-row {
  flex: 1;
  min-width: 0;
}
```

In fondo alla sezione `/* ---------- Item lists (actions, inventory) ---------- */` (prima di `/* ---------- Chat ---------- */`):

```css
/* ---------- Targets strip and play button (effects from the phone) ---------- */

.fcp-targets {
  position: sticky;
  top: -8px; /* the tab's top padding */
  z-index: 2;
  margin: -8px -20px 16px;
  padding: 10px 20px 12px;
  background: var(--color-bg);
  border-bottom: 1.5px solid var(--color-text);
}

.fcp-targets-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 28px;
}

.fcp-targets-clear {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 10px;
  border: 1.5px solid var(--color-text);
  background: var(--color-surface);
  font: 600 13px var(--font-body);
}

.fcp-targets-empty {
  padding: 6px 0;
  font: 400 13px/1.35 var(--font-quote);
  color: var(--color-neutral-700);
}

.fcp-targets-strip {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  scroll-snap-type: x proximity;
  scrollbar-width: none;
  padding: 6px 2px 2px;
}

.fcp-target {
  flex: none;
  width: 58px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  scroll-snap-align: start;
}

.fcp-target-img {
  position: relative;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--color-surface) center / cover no-repeat;
  box-shadow: 0 0 0 2px var(--color-text);
}

.fcp-target.hostile .fcp-target-img { box-shadow: 0 0 0 2px var(--color-accent); }
.fcp-target.friendly .fcp-target-img,
.fcp-target.mine .fcp-target-img { box-shadow: 0 0 0 2px var(--color-green); }

.fcp-target.on .fcp-target-img {
  box-shadow: 0 0 0 3px var(--color-bg), 0 0 0 6px var(--fcp-user, var(--color-accent));
}

.fcp-target.on .fcp-target-img::after {
  content: "✓";
  position: absolute;
  right: -6px;
  bottom: -6px;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--color-text);
  color: var(--color-bg);
  font: 700 12px/1 var(--font-body);
}

.fcp-target-name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 500 11.5px var(--font-body);
}

.fcp-play {
  flex: none;
  width: var(--fcp-tap);
  height: var(--fcp-tap);
  display: grid;
  place-items: center;
  border: 1.5px solid var(--color-text);
  background: var(--color-accent);
  box-shadow: var(--fcp-lift);
}

.fcp-play-icon {
  width: 14px;
  height: 16px;
  margin-left: 3px;
  background: var(--color-bg);
  clip-path: polygon(0 0, 100% 50%, 0 100%);
}

.fcp-play:active {
  transform: translate(2px, 2px);
  box-shadow: 1px 1px 0 var(--color-shadow);
}

.fcp-play:disabled {
  opacity: 0.45;
}

.fcp-play.playing {
  animation: fcp-play-pulse 0.6s ease-in-out infinite alternate;
}

@keyframes fcp-play-pulse {
  from { background: var(--color-accent); }
  to { background: var(--color-accent-500); }
}
```

Poi cerca altre regole che assumono la riga figlia diretta di `.fcp-item`:

Run: `grep -n "fcp-item > \|fcp-item\.expanded > " styles/companion.css`
Expected: solo `.fcp-item.expanded > .fcp-row-line`. Se compaiono altre regole `> .fcp-row`, aggiornale allo stesso modo (`> .fcp-row-line > .fcp-row`).

- [ ] **Step 6: Etichette**

In `lang/it.json` (prima delle chiavi `FCP.Vfx.Fail.*` del Task 3):

```json
  "FCP.Vfx.Targets": "Bersagli",
  "FCP.Vfx.Clear": "Azzera i bersagli",
  "FCP.Vfx.Play": "Gioca l'effetto",
  "FCP.Vfx.NoToken": "Nessun token in scena: metti il tuo personaggio sulla mappa.",
```

In `lang/en.json`:

```json
  "FCP.Vfx.Targets": "Targets",
  "FCP.Vfx.Clear": "Clear targets",
  "FCP.Vfx.Play": "Play the effect",
  "FCP.Vfx.NoToken": "No token on the scene: place your character on the map.",
```

- [ ] **Step 7: Refresh**

In `scripts/main.mjs`, import:

```js
import { vfxApi } from "./vfx.mjs";
```

In `registerRefreshHooks`, sostituisci il ciclo dei token e l'hook `updateScene`:

```js
  // The targets strip lists the scene's tokens: refresh it too, but only when effects are on.
  const sceneParts = () => (vfxApi() ? ["map", "actions"] : ["map"]);
  for (const hook of ["createToken", "updateToken", "deleteToken"]) {
    Hooks.on(hook, token => { if (token.parent?.id === activeScene()?.id) app.markDirty(...sceneParts()); });
  }
  Hooks.on("updateScene", (scene, changes) => {
    if ("active" in changes || scene.id === activeScene()?.id) app.markDirty(...sceneParts());
  });
  for (const hook of ["createCombat", "updateCombat", "deleteCombat", "createCombatant", "updateCombatant", "deleteCombatant"]) {
    Hooks.on(hook, () => { if (vfxApi()) app.markDirty("actions"); });
  }
```

- [ ] **Step 8: Controlli**

Run: `node --check scripts/app/companion-app.mjs && node --check scripts/main.mjs && node -e 'for (const f of ["lang/it.json","lang/en.json"]) JSON.parse(require("fs").readFileSync(f,"utf8")); console.log("ok")' && node --test tests/*.test.mjs`
Expected: `ok`, poi PASS con 0 fail

- [ ] **Step 9: Commit**

```bash
git add scripts/app/companion-app.mjs scripts/main.mjs templates/parts/items.hbs styles/companion.css lang/it.json lang/en.json
git commit -m "Actions: targets strip and play button for rows with an effect

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Stub, verifiche in Foundry e documentazione

**Files:**
- Create: `tools/vfx-stub/module.json`, `tools/vfx-stub/stub.mjs`
- Create: `docs/verifiche-in-foundry.md`
- Modify: `README.md` (sezione "Cosa fa per ogni sistema" o nuova sezione "Effetti dal telefono"; "Struttura")

**Interfaces:**
- Consumes: tutto quanto sopra, nel Foundry locale.
- Produces: esito delle verifiche. Se la verifica 1 fallisce, **fermati e riporta**: il ripiego `targetsRequest` della spec diventa un task nuovo da pianificare, non va improvvisato.

- [ ] **Step 1: Modulo stub**

Il modulo finto ha lo stesso id di quello vero, così `game.modules.get("daggerheart-vfx")` lo trova. **Solo per il Foundry locale**: mai sul VPS, e va tolto quando arriva la parte 1.

`tools/vfx-stub/module.json`:

```json
{
  "id": "daggerheart-vfx",
  "title": "Tavolo VFX (stub del companion)",
  "description": "Finto daggerheart-vfx per provare il Phone Companion. Solo per il Foundry locale.",
  "version": "0.0.0-stub",
  "compatibility": { "minimum": "14", "verified": "14" },
  "esmodules": ["stub.mjs"]
}
```

`tools/vfx-stub/stub.mjs`:

```js
/* Stub of the daggerheart-vfx API (spec §7) for testing the companion. Local Foundry only. */
Hooks.once("ready", () => {
  game.modules.get("daggerheart-vfx").api = {
    haEffetto: (item, azioneId) => !!item,
    gioca: async ({ item, azioneId, origine, bersagli }) => {
      console.log("daggerheart-vfx STUB | gioca", { item: item?.name, azioneId, origine, bersagli });
      const token = canvas?.ready ? canvas.tokens.get(origine) : null;
      if (!token) return false;
      ui.notifications.info(`VFX stub: ${item?.name} da ${token.name} → ${bersagli.length} bersagli`);
      return true;
    }
  };
});
```

- [ ] **Step 2: Chiedi il turno sul Foundry locale**

Chiedi a Francesco se il Foundry locale (`localhost:30000`) è libero dalla sessione di `daggerheart-vfx` e acceso. Non avviarlo né riavviarlo senza il suo sì. Poi collega lo stub (il companion è già collegato):

```bash
ln -s "$PWD/tools/vfx-stub" "$HOME/Library/Application Support/FoundryVTT/Data/modules/daggerheart-vfx"
```

Se esiste già una cartella `daggerheart-vfx` (il modulo vero dell'altra sessione), **non toccarla**: fermati e chiedi. Nel mondo `fcp-test` attiva "Tavolo VFX (stub del companion)" da *Gestisci moduli* (serve Foundry riavviato perché veda il modulo nuovo).

- [ ] **Step 3: Verifiche**

Due finestre: GM (desktop, scena aperta) e giocatore (`?companion=1`, canvas spento nel client del giocatore). Per ognuna annota l'esito.

1. **Mirino dal telefono.** Tocca un token nella striscia. Atteso: sullo schermo del GM il mirino col colore del giocatore attorno al token; la ✕ lo toglie. Se non compare: fermati e riporta (vedi *Produces*).
2. **Nebbia.** Con la nebbia attiva e un goblin in una zona inesplorata: il goblin non è nella striscia. Nascondi un token dal GM: sparisce dalla striscia.
3. **Selezione ridotta.** Seleziona un goblin, poi il GM lo nasconde: il contatore cala e il ▶ non lo invia (il `console.log` dello stub sul GM non lo elenca).
4. **▶ con 0, 1 e 3 bersagli.** D&D (mondo `fcp-test`): console del GM con `gioca` e gli id giusti, notifica dello stub. Daggerheart, se c'è un mondo di prova: l'attacco con l'arma arriva con l'id vero dell'azione d'attacco, non con `"attack"`.
5. **Permessi.** Dalla console del giocatore:
   ```js
   game.socket.emit("module.foundry-companion-local-phone", { type: "vfxRequest", requestId: "x1", userId: game.user.id, sceneId: game.scenes.active.id, originId: "<id di un token di cui NON è proprietario>", targetIds: [], itemUuid: "<uuid di un suo item>", actionId: null });
   ```
   Atteso: nessun effetto sul GM (lo stub non scrive niente in console).
6. **Senza modulo.** Disattiva lo stub: la scheda Azioni è identica a prima (nessuna striscia, nessun ▶, righe allineate come prima).
7. **GM su un'altra scena.** Il GM guarda un'altra scena, il giocatore tocca ▶: notifica "Il GM non ha aperta la scena del tuo token."

- [ ] **Step 4: Scrivi le verifiche**

`docs/verifiche-in-foundry.md`:

```markdown
# Verifiche dentro Foundry

Cose che i test con `node --test` non coprono. Da rifare dopo ogni modifica che le tocca.

## Effetti dal telefono (daggerheart-vfx)

Serve `daggerheart-vfx` attivo (o lo stub in `tools/vfx-stub/`, solo sul Foundry locale), un GM
con la scena aperta sul desktop e un giocatore dal telefono (o `?companion=1`) col canvas spento.

1. Toccare un token nella striscia dei bersagli: sullo schermo del GM compare il mirino col colore del giocatore; la ✕ lo toglie.
2. Con la nebbia attiva i token in zone inesplorate non sono nella striscia; i token nascosti non ci sono mai.
3. Un bersaglio selezionato che viene nascosto esce dalla selezione e non viene inviato.
4. ▶ con 0, 1 e 3 bersagli, in D&D e in Daggerheart: l'effetto parte dal token del giocatore. In Daggerheart l'attacco con l'arma arriva con l'id vero dell'azione d'attacco.
5. Una richiesta `vfxRequest` per un token non proprio non gioca niente.
6. Senza il modulo degli effetti la scheda Azioni è identica a prima.
7. Con il GM su un'altra scena il ▶ avvisa "Il GM non ha aperta la scena del tuo token."

Esito dell'ultima prova: <data, versione di Foundry e dei sistemi, stub o modulo vero, punti passati>
```

Sostituisci l'ultima riga con l'esito reale del passo 3 (per esempio `25/9/2026, Foundry 14.367, dnd5e 6.0.3, stub: 1–7 ok`). Se qualcosa è fallito, scrivilo così com'è.

- [ ] **Step 5: README**

In `README.md`, dopo la sezione "Note del GM", aggiungi:

```markdown
## Effetti dal telefono

Con il modulo **Tavolo VFX** (`daggerheart-vfx`) attivo, la scheda Azioni mostra in cima una striscia con i token della scena: toccandoli si scelgono i bersagli, che compaiono sullo schermo del GM con il mirino del giocatore. Le azioni che hanno un effetto hanno un ▶: quando il GM dice che è riuscito, lo si tocca e l'effetto parte sullo schermo grande dal token del personaggio verso i bersagli (con nessun bersaglio, sul personaggio stesso).

- Il ▶ non consuma slot, Speranza o usi: si segnano come sempre con le caselle della scheda.
- La striscia mostra i token non nascosti, ordinati per distanza (in combattimento prima i combattenti, per iniziativa), con il proprio in fondo. Con la nebbia attiva, solo quelli nelle zone esplorate.
- L'effetto lo gioca il client del GM, che controlla che il giocatore possieda il personaggio: serve un GM connesso con la scena del token aperta.
- Senza Tavolo VFX la scheda Azioni resta com'è.
```

Nella sezione "Struttura", dopo la riga di `socket.mjs`:

```
  vfx.mjs               ponte opzionale verso daggerheart-vfx (effetti dal telefono)
```

e dopo la riga di `app/companion-app.mjs`:

```
  app/targets-data.mjs  ordine e filtri della striscia dei bersagli
```

- [ ] **Step 6: Scollega lo stub**

```bash
rm "$HOME/Library/Application Support/FoundryVTT/Data/modules/daggerheart-vfx"
```

(`rm` su un symlink toglie il link, non la cartella del repo.) Lascia Foundry come l'hai trovato e avvisa Francesco che il turno è libero.

- [ ] **Step 7: Commit**

```bash
git add tools/vfx-stub docs/verifiche-in-foundry.md README.md
git commit -m "Effects from the phone: local stub, checks inside Foundry, README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
