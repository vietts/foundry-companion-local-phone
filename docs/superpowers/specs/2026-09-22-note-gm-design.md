# Note GM: il journal come un documento

Data: 2026-09-22 · Stato: approvato in brainstorming, da pianificare

## Problema

Il GM vuole tenere le note di campagna in Foundry invece che su Google Docs, ma il journal è scomodo: aprendo una voce si è in lettura e si può modificare solo il titolo; per scrivere bisogna passare sulla pagina, cliccare la matita, lavorare in una seconda finestra e salvare. Inoltre dal telefono l'interfaccia di Foundry è inutilizzabile, quindi non si può scrivere quando si è in giro (Foundry gira su una VPS, raggiungibile ovunque).

## Obiettivi

- Aprire una nota e poterci scrivere subito, come in un documento, con salvataggio automatico.
- Scrivere e consultare le note dal telefono, dentro il companion.
- Nessun modulo nuovo: tutto dentro Phone Companion.
- Le note restano normali `JournalEntry`/`JournalEntryPage`: segnaposti sulla mappa, *Jump to Pin*, link `@UUID`, permessi e condivisione con i giocatori continuano a funzionare come in Foundry.

## Fuori scopo

- Mappa GM, token nascosti e trascinamento sulla scena dal telefono (dal portatile li gestisce già Foundry).
- Import da Google Docs (i documenti esistenti sono pochi).
- Editor per pagine non di testo (immagini, PDF, video): restano quelle di Foundry.
- Pagine in formato Markdown: il foglio gestisce le pagine di testo HTML (il formato di default); una pagina Markdown viene mostrata come in Foundry.

## Contesto tecnico (Foundry v14)

- `foundry.applications.sheets.journal.JournalEntrySheet` si può estendere; `_renderPageViews` è il punto in cui le pagine vengono trasformate in viste.
- L'elemento `<prose-mirror>` (`HTMLProseMirrorElement`) senza attributo `toggled` è sempre attivo; con `collaborate` e `data-document-uuid` apre una sessione collaborativa sul campo indicato da `name` (qui `text.content`), con le modifiche propagate in tempo reale agli altri client che hanno la stessa pagina aperta.
- Un modulo registra un foglio con `DocumentSheetConfig.registerSheet(JournalEntry, MODULE_ID, Classe, { makeDefault: true, label })`; l'utente può tornare al foglio di Foundry dal menu *Configura foglio*.

## Esperienza

### Portatile: foglio "Documento"

- Registrato come foglio predefinito per `JournalEntry`. Si apre da barra laterale, segnaposto sulla mappa, link.
- Colonna sinistra invariata (pagine, indice dei titoli, ricerca, categorie di Foundry).
- Pagine di testo: `<prose-mirror>` sempre attivo con barra di formattazione. Niente matita, niente finestra separata, niente pulsante Salva.
- Indicatore nell'intestazione della pagina: "Salvato", "Salvataggio…", oppure in rosso "Non salvato".
- Pulsante "+ Pagina": crea una pagina di testo vuota in coda e la apre con il cursore nell'editor.
- Chi non ha permesso di modifica sulla pagina (giocatori con nota condivisa, GM con la voce bloccata) la vede in lettura come nel foglio di Foundry.

### Telefono: companion in modalità GM

- Se `game.user.isGM` e il companion è attivo, le schede sono **Note** e **Chat** (niente Scheda, Azioni, Oggetti, Mappa). Sul tablet la colonna fissa a sinistra è la lista delle note.
- **Elenco**: ricerca per nome in cima, poi "Recenti" (ultime 5 voci aperte su questo dispositivo, in `localStorage`, con try/catch), poi l'albero delle cartelle del journal, chiuse di default.
- **Voce**: a tutto schermo. Con più pagine, un selettore in alto; accanto, l'indice dei titoli della pagina per saltare alle sezioni.
- **Scrittura**: stesso `<prose-mirror>` sempre attivo e collaborativo, con la barra ridotta a titolo, grassetto, corsivo, elenco, link.
- **"+ Appunto"**: crea una voce nella cartella "Appunti" (creata alla prima occorrenza, tipo `JournalEntry`), con titolo uguale alla data e ora locali (es. "22 set 2026, 18:40") modificabile, una pagina di testo vuota, e la apre in scrittura.

## Architettura

| File | Compito |
|---|---|
| `scripts/journal/autosave.mjs` (nuovo) | Salvataggio automatico di un campo di un documento. Indipendente da Foundry UI, testabile con `node --test`. |
| `scripts/journal/doc-sheet.mjs` (nuovo) | `CompanionJournalSheet extends JournalEntrySheet`: pagine di testo come editor sempre attivo, indicatore, "+ Pagina". |
| `scripts/app/gm-notes.mjs` (nuovo) | Dati e azioni della scheda Note del companion: albero, ricerca, recenti, apertura voce, "+ Appunto". |
| `templates/parts/notes.hbs` (nuovo) | Template della scheda Note (elenco e voce). |
| `scripts/main.mjs` | Registra il foglio in `init`; in modalità GM crea il companion senza cercare un personaggio. |
| `scripts/app/companion-app.mjs` | Schede diverse per il GM (Note, Chat); parte `notes`. |
| `lang/it.json`, `lang/en.json`, `styles/companion.css` | Stringhe e stili. |
| `tests/autosave.test.mjs` (nuovo) | Test del salvataggio automatico. |

### `autosave.mjs`

```js
createAutosave({ save, delay = 1000, onState })
// → { change(value), flush(), dispose() }
```

- `change(value)`: memorizza l'ultimo valore e fa ripartire il timer di `delay` ms.
- Allo scadere del timer, o su `flush()`, se il valore è diverso dall'ultimo salvato con successo chiama `await save(value)`.
- `onState` riceve `"saving"`, `"saved"` o `"error"`. Su errore il valore resta pendente e viene ritentato alla prossima `change` o `flush`.
- Un salvataggio alla volta: se arriva una `change` durante un salvataggio, parte un altro salvataggio al termine con l'ultimo valore.
- `dispose()`: annulla il timer senza salvare (chi chiude chiama prima `flush()`).

Il foglio e la scheda Note collegano l'evento `input` del `<prose-mirror>` a `change(element.value)` e usano `save = v => page.update({ "text.content": v })`. `flush()` al cambio pagina, alla chiusura del foglio (`_preClose`) e al cambio scheda o voce nel companion. Se `flush()` in chiusura fallisce: `ui.notifications.warn` con il titolo della pagina.

### Modalità collaborativa e salvataggi

Con più client sulla stessa pagina ciascuno fa autosave dello stesso contenuto sincronizzato. Gli `update` ridondanti sono innocui (stesso valore, `diff` vuoto non invia niente lato Foundry). Se la sessione collaborativa non è disponibile (client offline), l'editor funziona da solo e l'ultimo salvataggio vince.

## Errori

- Salvataggio fallito: indicatore rosso "Non salvato", testo mantenuto, nuovo tentativo alla modifica successiva.
- Chiusura con modifiche non salvate e salvataggio fallito: avviso con il titolo della pagina.
- Pagina cancellata da un altro client mentre è aperta: il foglio si ridisegna come fa già Foundry; l'autosave in sospeso viene scartato (`dispose`).

## Test

- `node --test tests/`: ritardo e reset del timer, `flush` immediato, niente `save` senza modifiche, errore → stato `"error"` e ritentativo, serializzazione dei salvataggi concorrenti.
- Verifica dal vivo su Foundry locale (14.367, dnd5e e daggerheart):
  1. Apertura dalla barra laterale, da un segnaposto sulla mappa, da un link `@UUID`.
  2. Scrivere, chiudere, riaprire: il testo c'è.
  3. Una nota esistente con titoli, elenchi e link: aprirla e modificarla non ne altera la formattazione.
  4. Stessa pagina aperta su portatile e telefono (`?companion=1`): le modifiche compaiono dall'altra parte.
  5. Giocatore con nota condivisa: sola lettura.
  6. "+ Pagina" e "+ Appunto".
  7. Tornare al foglio di Foundry da *Configura foglio*.
