# Verifiche dentro Foundry

Cose che i test con `node --test` non coprono. Da rifare dopo ogni modifica che le tocca.

## Prima del tavolo (ogni release)

Su un telefono vero (almeno un iPhone e un Android), giocatore senza canvas, GM sul portatile.

**Ingresso**
1. QR di una carta appena stampata: pagina «Ciao, sei …» con ritratto, poi la stessa schermata mentre Foundry carica, poi la Mappa. Nessuna pagina di Foundry, nessuna domanda, nessun avviso rosso.
2. Carta vecchia (password cambiata): «Questa carta non vale più» con Riprova.
3. Finestra «Accessi della giornata dal vivo» senza indirizzo di accesso: avviso rosso e, se `/accesso/` risponde, il pulsante per usarla.
4. Ristampa con un giocatore collegato: la conferma lo nomina; non spuntato di default.

**Scheda e tiri (dnd5e)**
5. Tocco su caratteristica, salvezza, abilità: il tiro parte; con Vantaggio il dado è doppio, poi la barra torna su Normale.
6. Privilegio con più attività (es. Incanalare Divinità): ogni «Usa» parte.
7. Attacco con Vantaggio dalla scheda Azioni: la finestra di dnd5e si apre già su Vantaggio.
8. Iniziativa dal telefono col token già in combattimento: nessun combattente nuovo nel tracker; toccata due volte, sempre uno.
9. PF: tre «−» rapidi tolgono 3; doppio tocco su Danno lo applica una volta.

**Scheda e tiri (Daggerheart)**
10. Reazione per una prova, poi un attacco: l'attacco è un'azione (Speranza/Paura assegnate).
11. Esperienza scelta sul telefono con la finestra del tiro attiva: è già spuntata nella finestra.
12. Danno grezzo: soglie e armatura come dal desktop.

**Telefono**
13. Bloccare lo schermo 30 s e sbloccare: si torna sulla stessa tab, stesso personaggio, stessi oggetti aperti.
14. Durante un combattimento con tanti tiri: la barra in basso e i pulsanti rispondono al primo tocco.
15. Chat: rileggere un tiro vecchio mentre arrivano messaggi nuovi, la chat non salta in fondo; nessun messaggio doppio.
16. Scrivere nel campo dei PF mentre il GM cambia qualcosa del personaggio: la tastiera resta aperta.

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

Nota per chi prova: GM e giocatore vanno in due sessioni separate del browser (per esempio GM in incognito). Nello stesso profilo, entrare col secondo utente ricarica l'altra scheda con quell'utente, e "canvas spento" vale per tutte le schede.

## Registro degli errori

Ogni errore del modulo, e sui telefoni ogni errore o avviso che il giocatore vede, finisce in
`Data/worlds/<mondo>/phone-companion-log/<aaaa-mm-gg>.txt`: una riga JSON per evento, con utente,
personaggio, tab, dispositivo, versioni e stack. Lo scrive il client del GM attivo (i telefoni mandano
a lui); senza GM collegato il telefono tiene fino a 60 eventi e li manda quando un GM entra.
Nessuna password, nessun QR, nessun testo di chat.

- Dal server: `jq -c '{t,lvl,where,msg,user,actor,tab,dev}' Data/worlds/<mondo>/phone-companion-log/<giorno>.txt`
- Dalla console del GM: `await game.modules.get("foundry-companion-local-phone").api.errorLog("2026-11-15")`

Il GM deve avere il permesso di caricare file (il ruolo Gamemaster ce l'ha).
