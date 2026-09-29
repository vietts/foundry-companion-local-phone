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
- 4 ok in D&D: Fire Bolt sul lupo e Longbow su lupo e due goblin partono, visti sullo schermo. Con 0 bersagli un proiettile non parte (`noEffect`): ora il telefono chiede di scegliere un bersaglio.
- 4 ok in Daggerheart (mondo `faglia-dh`, system 2.10.5): un ▶ per ogni azione delle carte di dominio, con l'id dell'azione; Cinder Grasp sull'orso e su orso e bandito, Unleash Chaos (proiettile) sull'orso, Unleash Chaos: Replenish Tokens senza bersagli sull'Arcanista: tutti partiti, visti sullo schermo. Le armi dei PG Daggerheart non hanno effetti in daggerheart-vfx, quindi niente ▶.
- 5 ok: origine falsa → `denied`; un `userId` falso nel messaggio viene ignorato (conta il mittente del server).
- 6 non provato.
- 7 ok: la risposta "scene" arriva, ma con il GM collegato da due client (uno senza canvas) arrivava per prima anche quando l'effetto partiva. Corretto: risponde solo il client che ha la scena aperta (testato con node; dal vivo in Daggerheart con un solo client GM arriva una sola risposta, il caso con due client non è stato rifatto).

## Mappa zoomata (telefono)

Giocatore dal telefono vero (iPhone e Android), canvas spento, una scena con sfondo e con *Stile della mappa = Immagine della scena*.

1. All'apertura della scheda Mappa il proprio token è al centro, circa dieci caselle in larghezza; vicino al bordo della scena la mappa si ferma al bordo.
2. Con il D-pad la mappa scorre insieme al token, che resta al centro senza scatti.
3. Un trascinamento sposta la vista e non muove il token; compare il mirino, che riporta sul token.
4. Due dita allargano e stringono la vista attorno al punto fra le dita; lo zoom si ferma a circa cinque caselle e alla scena intera.
5. Un tocco singolo sulla mappa muove ancora il token in quel punto (anche dopo uno zoom o un trascinamento).
6. Il pulsante in alto a destra alterna scena intera e vista vicina.
7. La vista non si perde quando un altro giocatore muove il suo token (la parte della mappa viene ridisegnata).
8. Nebbia di guerra attiva: la maschera resta allineata allo sfondo a ogni zoom.
9. Scena grande (oltre 60 caselle) con immagine pesante: su iPhone lo sfondo resta visibile e Safari non ricarica la pagina.
10. Tablet in orizzontale: la mappa nella colonna di destra si comporta allo stesso modo.

Nota per chi prova: GM e giocatore vanno in due sessioni separate del browser (per esempio GM in incognito). Nello stesso profilo, entrare col secondo utente ricarica l'altra scheda con quell'utente, e "canvas spento" vale per tutte le schede.
