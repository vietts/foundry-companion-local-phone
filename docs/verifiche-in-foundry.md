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

Esito dell'ultima prova: 26/9/2026, VPS (Foundry 14.367), mondo `faglia` (dnd5e 6.0.3), daggerheart-vfx vero (branch `feature/dnd5e`), giocatore "tester" col canvas spento, GM sul portatile.

- 1 ok: il mirino compare sullo schermo del GM, ma piccolo (Foundry disegna così i bersagli degli altri utenti, le frecce grandi sono solo per i propri).
- 2 ok per la nebbia: i goblin in zona inesplorata non erano nella striscia. Token nascosti non provati dal vivo (coperti dai test).
- 3 non provato dal vivo (coperto dai test).
- 4 ok in D&D: Fire Bolt sul lupo e Longbow su lupo e due goblin partono, visti sullo schermo. Con 0 bersagli un proiettile non parte (`noEffect`): ora il telefono chiede di scegliere un bersaglio. Daggerheart non provato.
- 5 ok: origine falsa → `denied`; un `userId` falso nel messaggio viene ignorato (conta il mittente del server).
- 6 non provato.
- 7 ok: la risposta "scene" arriva, ma con il GM collegato da due client (uno senza canvas) arrivava per prima anche quando l'effetto partiva. Corretto: risponde solo il client che ha la scena aperta; la correzione è testata con node ma non ancora dal vivo (l'altro client GM non è stato ricaricato).
