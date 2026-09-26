# Effetti dal telefono: bersagli e ▶ nella scheda Azioni

Data: 2026-09-25 · Stato: approvato in brainstorming, da pianificare

## Problema

Al tavolo i dadi sono fisici. Il giocatore dice cosa fa, tira, il GM dice che è riuscito:
a quel punto sullo schermo grande non succede niente. Il modulo `daggerheart-vfx` ("Tavolo
VFX") sa giocare l'effetto di un'azione dal token di chi agisce verso i bersagli, ma parte
solo quando l'oggetto viene usato in Foundry, e dal telefono non si usa niente.

La parte 1 (in `~/daggerheart-vfx`, spec `docs/superpowers/specs/2026-09-25-dnd5e-design.md`
§7) aggiunge un'API pubblica. Questa spec è la parte 2: il lato telefono, nel companion.

## Obiettivi

- Scegliere dal telefono uno o più bersagli, visibili sullo schermo grande col mirino nativo
  di Foundry.
- Un ▶ sulle righe della scheda Azioni che hanno un effetto: toccato, l'effetto parte sullo
  schermo del GM dal token del giocatore verso i bersagli.
- D&D 5e e Daggerheart, con lo stesso codice.
- Il companion non dipende da `daggerheart-vfx`: se il modulo non c'è, nulla cambia.

## Fuori scopo

- **Consumo di slot o Speranza.** Il ▶ gioca solo l'effetto; le risorse si segnano a mano
  con le caselle che il companion ha già e che si aggiornano.
- Anello del bersaglio personalizzato e più grande: se il mirino nativo si vede poco al
  tavolo, è un progetto successivo sugli stessi target.
- Filtro dei bersagli per gittata.
- Qualsiasi modifica a `daggerheart-vfx`.

## Decisioni

Prese con Francesco il 25/9/2026.

| | Decisione | Perché |
|---|---|---|
| **Consumo** | Nessuno | Il ▶ arriva dopo il "riuscito" del GM; un tocco per sbaglio non costa risorse; le caselle degli slot esistono già. |
| **Bersagli** | Più di uno, a tocco; zero ammesso | L'API accetta un elenco; le aree (`area`) si centrano sui bersagli; con zero l'effetto va sul lanciatore. |
| **Candidati** | Tutti i token non nascosti della scena, esclusi quelli in zone inesplorate se la nebbia è attiva | Fuori dal combattimento servono anche gli alleati (*Cura ferite*); nascosti e nebbia evitano spoiler. |
| **Ordine** | Combattenti per iniziativa, poi per distanza dal mio token; il mio in fondo | Il caso comune (il nemico vicino) sta in testa. |
| **Marcatore** | Mirino nativo (`user.targets`) | Zero codice di disegno, sincronizzato da Foundry, significativo per dnd5e e le macro. |
| **Interfaccia** | Striscia dei bersagli fissa in cima ad Azioni, ▶ su ogni riga con effetto | I target sono dell'utente, non della singola azione: si scelgono una volta, poi un tocco per azione. |

## Il contratto con daggerheart-vfx

Da §7 della spec della parte 1, esposto al `ready`:

```js
const api = game.modules.get("daggerheart-vfx")?.api;
api.gioca({ item, azioneId, origine, bersagli })  → Promise<boolean>
api.haEffetto(item, azioneId)                      → boolean
```

- `item`: il documento; `azioneId`: id dell'azione Daggerheart (ignorato in D&D).
- `origine`: id del token di chi agisce; `bersagli`: id dei token bersaglio.
- `gioca` va chiamata sul client che ha il canvas sulla scena dei token (il GM); restituisce
  `false` senza canvas, senza riga, senza token d'origine in scena.
- `haEffetto` funziona su ogni client (legge un setting di mondo).
- Il controllo dei permessi spetta al chiamante.

Finché la parte 1 non esiste, i test usano un'API finta e le verifiche in Foundry un modulo
stub che registra `api.gioca` e scrive in console.

## Architettura

```
scripts/
  vfx.mjs                  unico punto che conosce daggerheart-vfx          ← nuovo
  app/targets-data.mjs     ordine e filtri dei candidati, lettura nebbia (puri) ← nuovo
  socket.mjs               + vfxRequest / vfxResult (e targetsRequest, se serve)
  app/companion-app.mjs    striscia bersagli, ▶ sulle righe, hook di refresh
templates/parts/
  targets.hbs              la striscia                                        ← nuovo
  items.hbs                ▶ come bottone fratello della riga
styles/companion.css       striscia e ▶ in stile Carta & Inchiostro
lang/it.json, en.json      etichette e motivi di errore
```

Gli adattatori di sistema (`systems/*.mjs`) non cambiano.

### `scripts/vfx.mjs`

- `vfxApi()` → l'API se `daggerheart-vfx` è attivo e la espone, altrimenti `null`.
- `hasEffect(item, actionId)` → `boolean`: avvolge `api.haEffetto` in try/catch; su
  eccezione `warn` col prefisso del modulo e `false`.
- `requestPlay({ tokenDoc, item, actionId, targetIds })` → `Promise<{ok, reason}>`, lato
  giocatore (vedi Flusso).
- `playLocally(...)`: usata dal client del GM attivo, chiama `api.gioca`.

### `scripts/app/targets-data.mjs` (puro)

- `orderCandidates(tokens, { originId, combatants, distance })`: combattenti prima,
  nell'ordine d'iniziativa; poi gli altri; dentro ogni gruppo per distanza in caselle
  dall'origine; l'origine sempre in fondo. `combatants` è l'elenco ordinato di id token;
  `distance(a)` è passata dal chiamante.
- `isExplored(imageData, point)`: alfa del pixel della maschera di nebbia nel punto
  (coordinate già scalate alla maschera), `true` se opaco.
- `filterCandidates(tokens, { explored })`: esclude `hidden` e, se `explored` è una
  funzione, i token il cui centro non è esplorato.
- `checkPlayRequest({ user, tokenDoc, item })` → `null` oppure `"missing" | "denied"`:
  utente e token esistono, l'utente è OWNER dell'attore del token (o del token se senza
  attore), l'item appartiene a quell'attore.

## Flusso

### Scelta dei bersagli

1. La striscia legge i candidati dalla scena attiva (`activeScene()`), li filtra e li ordina.
2. Un tocco su una tessera accende o spegne il token e trasmette i target dell'utente con
   `game.user.broadcastActivity({ sceneId, targets })`: gli altri client disegnano il mirino
   col colore dell'utente. `User#updateTokenTargets` non esiste in v14.367; gli altri client
   applicano i target solo per chi guarda la loro scena, e un telefono senza canvas non ne
   guarda nessuna, per questo va anche `sceneId`. La ✕ azzera.
3. Lo stato acceso/spento sta nel companion (senza canvas `game.user.targets` resta vuoto).
   Quando un bersaglio esce dalla striscia viene tolto e i target vengono ritrasmessi.

**Da verificare in Foundry:** che il mirino compaia sullo schermo del GM. Se no, il telefono
manda `targetsRequest {sceneId, targetIds}` al GM attivo, che imposta i target per conto
dell'utente; stesso controllo `missing`.

### ▶

1. Il ▶ compare su una riga se `vfxApi()` c'è, la riga ha un item e
   `hasEffect(item, data["action-id"])` è vero. La passata avviene in `companion-app` dopo
   `prepareActions`: aggiunge `vfx: true` alle righe.
2. Tocco su ▶: se il client è il GM attivo, `playLocally` direttamente. Altrimenti
   `game.socket.emit(SOCKET_NAME, { type: "vfxRequest", requestId, userId, sceneId,
   originId, targetIds, itemUuid, actionId })`.
3. Client del GM attivo: risolve utente, scena, token d'origine e item (`fromUuid`),
   `checkPlayRequest`; se passa, `api.gioca({ item, azioneId: actionId, origine: originId,
   bersagli: targetIds })`; risponde `vfxResult { requestId, targetUserId, ok, reason }`
   con `reason` fra `missing`, `denied`, `noEffect` (gioca → false), `error`.
4. Telefono: con `ok:false` una notifica breve e localizzata. Timeout 6 s → `timeout`.
   **Nessun piano B locale**: il telefono non ha canvas.
5. Nessun GM attivo: notifica subito, senza richiesta.

L'origine è il token già scelto per la mappa (`CompanionApp#token`). Senza token in scena
la striscia mostra "Nessun token in scena" e i ▶ sono disattivati.

## Interfaccia

**Striscia** in cima alla scheda Azioni, attaccata (sticky) mentre la lista scorre; compare
solo se almeno una riga ha il ▶.

```
┌ Bersagli ─────────────── 2 · ✕ ┐
│ (◉Gob) (◉Gob2) (○Lupo) (○Io) → │
└─────────────────────────────────┘
 Attacchi
 [img] Scimitarra  +4 · 1d6    ▶
 [img] Arco corto              ▶
 Incantesimi 1°  ▣▣□
 [img] Dardo incantato         ▶
 [img] Scudo                   ⌄
```

- Tessere rotonde col ritratto (stessa scelta dell'immagine della minimappa), nome
  abbreviato sotto, bordo col colore della disposizione: ostile terracotta, amichevole
  verde, neutrale inchiostro. Selezionata: anello pieno col colore dell'utente e ✓.
- Scorrimento orizzontale con snap. A destra il contatore e la ✕.

**▶**: 44 px, bottone fratello della riga (oggi la riga è un `<button>`: la struttura di
`items.hbs` diventa un contenitore con riga e ▶ affiancati). Acceso anche con zero bersagli.
Dopo il tocco pulsa ed è disattivato fino alla risposta, contro il doppio tocco.

**Aggiornamento**: `refreshParts` della scheda Azioni su `createToken`, `updateToken`,
`deleteToken`, `updateCombat`, `combatTurn`, `targetToken` e sul cambio di scena attiva.

## Errori

Un effetto non blocca mai il gioco.

- `daggerheart-vfx` assente o senza API: niente ▶ né striscia; un `log` all'avvio.
- `haEffetto` che lancia: niente ▶ su quella riga, `warn`.
- Motivi `missing`, `denied`, `noEffect`, `error`, `timeout`, e "nessun GM": notifiche
  localizzate in `lang/it.json` e `lang/en.json`.
- Lato GM ogni eccezione è catturata e scritta in console; la risposta è `error`.

## Test

`node --test`, senza Foundry:

- `targets-data`: ordine (combattenti per iniziativa, poi distanza, origine in fondo, senza
  combattimento solo distanza); esclusione dei nascosti; `isExplored` su un `ImageData`
  finto (esplorato, inesplorato, punto sul bordo e fuori maschera); `checkPlayRequest` con
  utente assente, token assente, non proprietario, item di un altro attore, caso valido.
- `vfx.mjs` con `game` finto e API finta: modulo assente o inattivo, `haEffetto` che lancia,
  vero e falso; `playLocally` che passa i parametri con i nomi dell'API.

## Verifiche in Foundry

Sul Foundry locale (`localhost:30000`, mondo `fcp-test`), a turno con la sessione di
`daggerheart-vfx`. Si scrivono in `docs/verifiche-in-foundry.md` (nuovo).

1. `updateTokenTargets` dal telefono con canvas spento: il mirino compare sullo schermo
   del GM. Se no, si attiva `targetsRequest`.
2. Con la nebbia attiva la striscia non mostra i token in zone inesplorate; i nascosti
   non compaiono mai.
3. ▶ da telefono, D&D e Daggerheart, con 0, 1 e 3 bersagli (stub fino alla parte 1, poi
   il modulo vero).
4. Un utente non proprietario manda un `vfxRequest` dalla console: il GM risponde `denied`.
5. Senza `daggerheart-vfx` attivo: la scheda Azioni è identica a oggi.
