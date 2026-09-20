# Phone Companion per Foundry VTT

Interfaccia mobile per i giocatori seduti al tavolo. Il GM tiene Foundry sul suo computer; i giocatori aprono lo stesso mondo dal telefono e trovano, al posto dell'interfaccia standard, una schermata pensata per il touch:

- **Scheda**: punti ferita, caratteristiche, abilità, tiri salvezza (D&D 5e) o tratti, Speranza, Stress, soglie di danno (Daggerheart). Tocca un valore per tirare.
- **Azioni**: attacchi, incantesimi, carte dominio e privilegi con un pulsante "Usa" che passa dal sistema, quindi il risultato finisce nella chat di Foundry come se fosse stato tirato dal PC.
- **Oggetti**: inventario con usi e stato equipaggiato/preparato.
- **Chat**: messaggi recenti, dadi rapidi e formule libere.
- **Mappa**: minimappa leggera (senza canvas) con i token e un pad direzionale per muovere il proprio token di una casella alla volta, oppure toccando un punto della minimappa. I movimenti vengono validati dal client del GM, che controlla i muri.

Il modulo non usa un server esterno: gira dentro il normale client Foundry. Sul telefono si può disattivare il canvas (il modulo lo propone al primo avvio), così non vengono scaricate le immagini delle scene e il caricamento resta leggero.

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

## Impostazioni (GM)

- **Token mostrati sulla minimappa**: solo i propri, propri + amichevoli, tutti i non nascosti.
- **Valida i movimenti sul client del GM**: attivo di default. Il telefono invia la richiesta, il client del GM esegue lo spostamento con controllo dei muri. Se nessun GM è connesso il telefono muove il token direttamente.

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
lang/                   en, it
```

Gli adattatori di sistema espongono la stessa interfaccia (`prepareHeader`, `prepareSheet`, `prepareActions`, `prepareInventory`, `handle`), quindi aggiungere un sistema vuol dire scrivere un file in `scripts/systems/`.

## Licenza

MIT.
