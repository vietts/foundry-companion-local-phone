# Phone Companion per Foundry VTT

Interfaccia mobile per giocare **dal vivo, al tavolo, con Foundry sullo schermo del GM**. I giocatori aprono lo stesso mondo dal telefono e trovano, al posto dell'interfaccia standard, una schermata pensata per il touch. Il telefono sostituisce la scheda cartacea e serve a muovere il proprio token; i dadi restano quelli veri, a meno che non si attivino i dadi digitali.

Priorità, in ordine:

1. **Scheda**: punti ferita con danno/cura, caratteristiche, abilità, tiri salvezza (D&D 5e) o tratti, Speranza, Stress, Armatura, soglie di danno (Daggerheart), condizioni, riposi. È il riferimento da tenere sotto mano.
2. **Mappa**: minimappa leggera (senza canvas) con i token e un pad direzionale per muovere il proprio token di una casella alla volta, oppure toccando un punto della minimappa. I movimenti vengono validati dal client del GM, che controlla i muri.
3. **Azioni** e **Oggetti**: attacchi, incantesimi, carte dominio, privilegi e inventario. Toccando una riga si apre il testo dell'oggetto, per leggere cosa fa. Equipaggia, prepara, sposta nel vault.
4. **Chat**: in secondo piano, per le regole o gli appunti che il GM manda in chat. Con un badge sui messaggi non letti.

Con **Dadi digitali** attivi (impostazione del dispositivo, spenta di default) toccare caratteristiche, attacchi e incantesimi tira tramite il sistema, con il risultato nella chat di Foundry, e la chat guadagna dadi rapidi e formule libere.

Il modulo non usa un server esterno e nemmeno CDN: gira dentro il normale client Foundry, con font (Source Serif 4, OFL) e icone (Phosphor duotone, MIT) incluse in `styles/vendor/`. Sul telefono si può disattivare il canvas (il modulo lo propone al primo avvio), così non vengono scaricate le immagini delle scene e il caricamento resta leggero.

## Requisiti

- Foundry VTT v14
- Sistema **dnd5e** (5.x o superiore) oppure **daggerheart** (2.x o superiore). Con altri sistemi restano disponibili chat, dadi e mappa.

## Installazione

Da Foundry, *Add-on Modules → Install Module*, incolla il manifest:

```
https://github.com/vietts/foundry-companion-local-phone/releases/latest/download/module.json
```

Oppure copia questa cartella in `Data/modules/foundry-companion-local-phone`.

## Uso al tavolo

1. Il GM crea un utente Foundry per ogni giocatore e gli assegna il personaggio (proprietà sull'attore).
2. Il telefono si collega alla stessa Wi‑Fi del computer del GM e apre `http://<ip-del-pc>:30000` (l'indirizzo lo vedi nella schermata di setup di Foundry).
3. Il giocatore entra con il suo utente. Su telefono e tablet l'interfaccia companion parte da sola.
4. Al primo avvio il modulo propone di disattivare il canvas su quel dispositivo: accetta.

Per forzare la modalità da desktop (per esempio per provarla): `Impostazioni → Phone Companion → Modalità companion = Sempre attiva`, oppure aggiungi `?companion=1` all'URL. Dal companion il pulsante con il monitor riporta all'interfaccia Foundry completa.

## Impostazioni

Mondo (GM):

- **Token mostrati sulla minimappa**: solo i propri, propri + amichevoli, tutti i non nascosti.
- **Valida i movimenti sul client del GM**: attivo di default. Il telefono invia la richiesta, il client del GM esegue lo spostamento con controllo dei muri. Il controllo funziona solo se il GM sta guardando la scena attiva; se guarda un'altra scena, o se nessun GM è connesso, il token viene mosso senza controllo e il giocatore riceve un avviso.

Dispositivo (ogni giocatore):

- **Modalità companion**: auto / sempre / off.
- **Dadi digitali**: spenti di default. Accesi, le caratteristiche e gli oggetti diventano tirabili.
- **Tiri rapidi**: tira subito con la modalità scelta sul telefono (vantaggio, svantaggio, reazione) senza aprire il dialog del sistema. Disattivala se vuoi il dialog completo (per esempio per lanciare un incantesimo a livello più alto in D&D 5e).
- **Messaggi di chat tenuti sul telefono**.

## Cosa fa per ogni sistema

**D&D 5e** (scheda Tira): caratteristiche, tiri salvezza, abilità con passiva, iniziativa, dadi vita, tiri salvezza contro morte a 0 PF, concentrazione se attiva, slot incantesimo. Azioni: attacchi con bonus e danno, incantesimi preparati per livello con gli slot, privilegi e consumabili attivabili. Oggetti: equipaggia/togli, libro incantesimi con preparazione, monete. Danno e cura passano da `applyDamage` del sistema (PF temporanei compresi).

**Daggerheart**: tratti con tiro Speranza/Paura (`rollTrait`), modalità azione/reazione/vantaggio/svantaggio, esperienze selezionabili per il tiro successivo (costano 1 Speranza), contatori Speranza/Stress/Armatura, soglie di danno. Il danno inserito passa da `takeDamage`, quindi applica soglie e slot armatura come dal foglio. Azioni: attacchi con le armi equipaggiate (o disarmato), carte dominio nel loadout, privilegi con azioni. Oggetti: armi e armature con equipaggiamento, consumabili, vault delle carte dominio con recall, oro. Riposi e mossa di morte aprono i dialog del sistema.

## Stato

Prima versione, scritta contro i sorgenti di dnd5e 6.0 e daggerheart 2.10 su Foundry v14 ma **non ancora provata in un mondo reale**. Le API usate sono quelle dei sistemi (stessi metodi chiamati dai loro fogli), quindi le cose da verificare al primo avvio sono soprattutto layout e rendering della chat sul telefono.

## Struttura

```
scripts/
  main.mjs              avvio, hook, attivazione della modalità companion
  settings.mjs          impostazioni
  device.mjs            rilevamento telefono/tablet
  socket.mjs            richieste di movimento verso il client GM
  movement.mjs          esecuzione dello spostamento e minimappa
  app/companion-app.mjs interfaccia (ApplicationV2)
  systems/              adattatori: dnd5e, daggerheart, generico
templates/parts/        template Handlebars per ogni sezione
styles/companion.css
  styles/vendor/        font e icone incluse (licenze accanto ai file)
lang/                   en, it
```

Gli adattatori di sistema espongono la stessa interfaccia (`prepareHeader`, `prepareSheet`, `prepareActions`, `prepareInventory`, `handle`), quindi aggiungere un sistema vuol dire scrivere un file in `scripts/systems/`.

## Licenza

MIT.
