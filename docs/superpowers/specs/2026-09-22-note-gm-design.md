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
- L'elemento `<prose-mirror>` (`HTMLProseMirrorElement`) senza attributo `toggled` è sempre attivo; la modalità `collaborate` esiste ma non è usata (vedi "Salvataggi fra dispositivi e utenti").
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

- Se `game.user.isGM` e il companion è attivo, le schede sono **Note** e **Chat** (niente Scheda, Azioni, Oggetti, Mappa). Sul tablet le Note (elenco e voce aperta) stanno nella colonna fissa a sinistra, come la scheda per i giocatori, e la Chat a destra.
- **Elenco**: ricerca per nome in cima, poi "Recenti" (ultime 5 voci aperte su questo dispositivo, in un'impostazione `client` del modulo come `lastTab`), poi l'albero delle cartelle del journal, chiuse di default.
- **Voce**: a tutto schermo. Con più pagine, un selettore in alto; accanto, l'indice dei titoli della pagina per saltare alle sezioni.
- **Scrittura**: stesso `<prose-mirror>` sempre attivo; la barra di formattazione di Foundry resta completa e va a capo su più righe (non scorre in orizzontale: lo scorrimento taglierebbe i menu a tendina).
- **"+ Appunto"**: crea una voce nella cartella "Appunti" (creata alla prima occorrenza, tipo `JournalEntry`), con titolo uguale alla data e ora locali (es. "22 set 2026, 18:40") modificabile, una pagina di testo vuota, e la apre in scrittura.

## Architettura

| File | Compito |
|---|---|
| `scripts/journal/autosave.mjs` (nuovo) | Salvataggio automatico di un campo di un documento. Indipendente da Foundry UI, testabile con `node --test`. |
| `scripts/journal/doc-editor.mjs` (nuovo) | Monta un `<prose-mirror>` sempre attivo su una pagina e lo collega all'autosave; indicatore di stato. Usato dal foglio e dal companion. |
| `scripts/app/notes-data.mjs` (nuovo) | Funzioni pure per la scheda Note: albero appiattito delle cartelle, ricerca senza accenti, recenti, titolo dell'appunto. Testabili con `node --test`. |
| `scripts/journal/doc-sheet.mjs` (nuovo) | `DocSheetMixin(Base)`, applicato al foglio del journal del sistema (o a `JournalEntrySheet` di Foundry): pagine di testo come editor sempre attivo, indicatore, "+ Pagina". |
| `scripts/app/gm-notes.mjs` (nuovo) | Dati e azioni della scheda Note del companion: albero, ricerca, recenti, apertura voce, "+ Appunto". |
| `templates/parts/notes.hbs` (nuovo) | Template della scheda Note (elenco e voce). |
| `scripts/main.mjs` | Registra il foglio in `ready` (solo allora i fogli del sistema sono in `CONFIG`); in modalità GM crea il companion senza cercare un personaggio. |
| `scripts/app/companion-app.mjs` | Schede diverse per il GM (Note, Chat); parte `notes`. |
| `lang/it.json`, `lang/en.json`, `styles/companion.css` | Stringhe e stili. |
| `tests/autosave.test.mjs`, `tests/notes-data.test.mjs` (nuovi) | Test delle parti pure. |

### `autosave.mjs`

```js
createAutosave({ read, save, initial = "", delay = 1000, onState })
// → { touch(), flush(value?), dispose() }
```

- `touch()`: segna una modifica (stato `"dirty"`) e fa ripartire il timer di `delay` ms. Il valore non viene letto a ogni tasto: serializzare l'HTML costa, lo si fa solo al salvataggio.
- Allo scadere del timer, o su `flush()`, legge `read()` (o usa `value` se passato a `flush`) e, se diverso dall'ultimo valore salvato con successo, chiama `await save(value)`. `flush` restituisce `true` se alla fine non resta niente da salvare.
- `onState` riceve `"dirty"`, `"saving"`, `"saved"` o `"error"`. Su errore la modifica resta pendente e viene ritentata alla prossima `touch` o `flush`.
- Un salvataggio alla volta: se arriva una modifica durante un salvataggio, il salvataggio successivo parte al termine con il valore più recente.
- `dispose()`: annulla il timer senza salvare (chi chiude chiama prima `flush()`).

Il foglio e la scheda Note segnalano ogni modifica del documento ProseMirror (un plugin `view.update`, che copre anche formattazione e modifiche arrivate da altri client) e usano `save = v => page.update({ "text.content": v }, { render: false })`. `render: false` è necessario: senza, ogni salvataggio ridisegnerebbe il foglio e distruggerebbe l'editor mentre si scrive. `flush()` al cambio pagina, alla chiusura del foglio (`_preClose`) e al cambio scheda o voce nel companion. Se `flush()` in chiusura fallisce: `ui.notifications.warn` con il titolo della pagina.

### Salvataggi fra dispositivi e utenti

L'editor non usa la modalità collaborativa di Foundry: le sue sessioni sono per utente, quindi non sincronizzano i dispositivi dello stesso GM, e il loro salvataggio lato server ridisegnerebbe il foglio durante la scrittura. Al suo posto:

- ogni salvataggio porta negli `options` dell'update un identificativo del client che l'ha fatto;
- un editor aperto che riceve un salvataggio della sua pagina da un altro client si rimonta con il testo nuovo se non ha modifiche in sospeso, altrimenti tiene il suo testo e il prossimo salvataggio vince;
- chi guarda la pagina senza editor (giocatori con la nota condivisa, fogli di sola lettura) viene ridisegnato a ogni salvataggio che arriva da un altro client;
- un editor che viene rimosso senza modifiche non salva niente, così aprire e sfogliare una nota non la riscrive.

Un co-GM vede quindi le modifiche dopo ogni salvataggio (circa un secondo), non a ogni tasto.

### Sistemi con un proprio foglio del journal

Il foglio Documento si costruisce sopra il foglio del journal predefinito del sistema (per esempio quello di D&D 5e), così stile e navigazione del sistema restano; cambia solo il modo in cui si mostrano le pagine di testo modificabili.

## Errori

- Salvataggio fallito: indicatore rosso "Non salvato", testo mantenuto, nuovo tentativo alla modifica successiva.
- Chiusura con modifiche non salvate e salvataggio fallito: avviso con il titolo della pagina.
- Pagina cancellata da un altro client mentre è aperta: il foglio si ridisegna come fa già Foundry; l'autosave in sospeso viene scartato (`dispose`).

## Test

- `node --test tests/`: ritardo e reset del timer, `flush` immediato, niente `save` senza modifiche, errore → stato `"error"` e ritentativo, serializzazione dei salvataggi concorrenti; albero, ricerca, recenti e titolo dell'appunto.
- Verifica dal vivo su Foundry locale (14.367, dnd5e e daggerheart):
  1. Apertura dalla barra laterale, da un segnaposto sulla mappa, da un link `@UUID`.
  2. Scrivere, chiudere, riaprire: il testo c'è.
  3. Una nota esistente con titoli, elenchi e link: aprirla e modificarla non ne altera la formattazione.
  4. Stessa pagina aperta su portatile e telefono (`?companion=1`), stesso utente GM: quello che si scrive da una parte compare dall'altra dopo il salvataggio, se lì non si sta scrivendo.
  5. Giocatore con nota condivisa: sola lettura.
  6. "+ Pagina" e "+ Appunto".
  7. Tornare al foglio di Foundry da *Configura foglio*.
