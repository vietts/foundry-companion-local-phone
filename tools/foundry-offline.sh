#!/bin/bash
# Porta Foundry dalla VPS al portatile per giocare senza internet, e ritorno.
#
#   tools/foundry-offline.sh pull     VPS -> portatile, poi spegne Foundry sulla VPS
#   tools/foundry-offline.sh push     portatile -> VPS (solo mondi e asset), poi la riaccende
#   tools/foundry-offline.sh status   dove si sta giocando adesso
#
# Fra pull e push la copia "vera" e' quella del portatile: Foundry sulla VPS
# resta spento, cosi' nessuno modifica il mondo da due parti e la licenza gira
# su una macchina sola.
#
# Configurazione in tools/offline.env (vedi offline.env.example).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
[ -f "$here/offline.env" ] && . "$here/offline.env"

: "${FOUNDRY_SSH:?imposta FOUNDRY_SSH in tools/offline.env (host ssh della VPS)}"
REMOTE_DATA="${REMOTE_DATA:-/opt/foundry/data/Data}"
REMOTE_BACKUPS="${REMOTE_BACKUPS:-/opt/foundry/backups}"
CONTAINER="${CONTAINER:-foundry}"
LOCAL_ROOT="${LOCAL_ROOT:-$HOME/Library/Application Support/FoundryVTT}"
LOCAL_DATA="$LOCAL_ROOT/Data"
LOCAL_BACKUPS="$LOCAL_ROOT/Backups/offline-sync"

# Cartelle di Data/ portate sul portatile. I moduli pesano parecchio la prima
# volta, poi rsync copia solo le differenze.
PULL_DIRS=(worlds systems modules assets)
[ -n "${EXTRA_DIRS:-}" ] && PULL_DIRS+=($EXTRA_DIRS)

say(){ printf '\n\033[1m%s\033[0m\n' "$*"; }
die(){ printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
remote(){ ssh -o ConnectTimeout=10 "$FOUNDRY_SSH" "$@"; }

local_foundry_running(){ pgrep -f "Foundry Virtual Tabletop" >/dev/null; }
remote_running(){ [ "$(remote docker inspect -f '{{.State.Running}}' "$CONTAINER")" = "true" ]; }

sync(){ rsync -a --delete --partial --exclude '.DS_Store' "$@"; }

cmd_pull(){
  local_foundry_running && die "Chiudi Foundry sul portatile prima del pull."

  say "Spengo Foundry sulla VPS (i mondi vanno copiati a database fermo)"
  remote docker stop "$CONTAINER" >/dev/null

  if [ -d "$LOCAL_DATA/worlds" ]; then
    mkdir -p "$LOCAL_BACKUPS"
    out="$LOCAL_BACKUPS/worlds-$(date +%Y%m%d-%H%M%S).tar.gz"
    say "Backup dei mondi locali in $out"
    tar czf "$out" -C "$LOCAL_DATA" worlds
  fi

  for d in "${PULL_DIRS[@]}"; do
    say "Copio $d"
    mkdir -p "$LOCAL_DATA/$d"
    sync --stats "$FOUNDRY_SSH:$REMOTE_DATA/$d/" "$LOCAL_DATA/$d/" | grep -E 'Number of files|Total transferred' || true
  done

  remote_ver=$(remote docker inspect -f '{{.Config.Image}}' "$CONTAINER" | sed 's/.*://')
  local_ver=$(defaults read "/Applications/Foundry Virtual Tabletop.app/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo "?")

  say "Fatto. Foundry sulla VPS resta spento finche' non fai push."
  if [ "$remote_ver" != "$local_ver" ]; then
    printf '\033[33mAttenzione: VPS %s, portatile %s. Aggiorna Foundry sul portatile alla stessa versione\nprima di aprire i mondi, altrimenti potrebbe rifiutarli o migrarli.\033[0m\n' "$remote_ver" "$local_ver"
  fi
  cat <<EOF

Al tavolo:
  1. Apri Foundry sul portatile e lancia il mondo.
  2. Collega portatile e telefoni alla stessa rete (hotspot del Mac o router da viaggio).
  3. Dai telefoni: http://$(ipconfig getifaddr en0 2>/dev/null || echo '<ip-del-mac>'):30000
Dopo la sessione: chiudi Foundry e lancia  tools/foundry-offline.sh push
EOF
}

cmd_push(){
  local_foundry_running && die "Chiudi Foundry sul portatile prima del push (il database dev'essere fermo)."
  remote_running && die "Foundry sulla VPS e' acceso: il mondo li' potrebbe essere cambiato dopo il pull. Non sovrascrivo."

  say "Backup dei mondi sulla VPS"
  remote "tar czf $REMOTE_BACKUPS/worlds-prepush-\$(date +%Y%m%d-%H%M%S).tar.gz -C $REMOTE_DATA worlds"

  say "Riporto i mondi sulla VPS"
  sync --stats "$LOCAL_DATA/worlds/" "$FOUNDRY_SSH:$REMOTE_DATA/worlds/" | grep -E 'Number of files|Total transferred' || true

  # Gli asset caricati durante la sessione: si aggiungono, non si cancella niente.
  say "Riporto gli asset nuovi"
  rsync -a --partial --exclude '.DS_Store' "$LOCAL_DATA/assets/" "$FOUNDRY_SSH:$REMOTE_DATA/assets/"

  # Il container legge i file con l'utente proprietario di Data/, non con quello del Mac.
  remote "chown -R \$(stat -c %u:%g $REMOTE_DATA) $REMOTE_DATA/worlds $REMOTE_DATA/assets"

  say "Riaccendo Foundry sulla VPS"
  remote docker start "$CONTAINER" >/dev/null
  say "Fatto. Da qui in poi si gioca di nuovo sulla VPS."
}

cmd_status(){
  if remote_running; then echo "VPS: Foundry acceso (si gioca online)"
  else echo "VPS: Foundry spento (copia attiva sul portatile, ricordati il push)"; fi
  if local_foundry_running; then echo "Portatile: Foundry aperto"
  else echo "Portatile: Foundry chiuso"; fi
}

case "${1:-}" in
  pull) cmd_pull ;;
  push) cmd_push ;;
  status) cmd_status ;;
  *) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
