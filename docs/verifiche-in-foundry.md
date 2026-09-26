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

Esito dell'ultima prova: non ancora eseguita.
