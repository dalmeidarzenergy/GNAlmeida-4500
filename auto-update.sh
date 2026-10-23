#!/bin/bash
# Watchdog de auto-update do CRM GNAlmeida.
# Corre no servidor (WSL) e sincroniza com o GitHub a cada 60s.
# Robusto: usa git fetch + reset --hard (nunca dá conflito de merge)
# e nunca abandona o loop mesmo que um passo falhe (sem `set -e`).

# Caminho do projeto: resolve a partir da localização do próprio script,
# para funcionar independentemente de onde o clone estiver.
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

# `bun` vive em ~/.bun/bin em shells não-interativas.
export PATH="$HOME/.bun/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:$PATH"

log() { echo "[auto-update] $(date '+%H:%M:%S'): $1"; }

start_server() {
  if pgrep -f "start-server" > /dev/null 2>&1; then
    return 0
  fi
  log "a arrancar o servidor..."
  bun install --frozen-lockfile >/dev/null 2>&1 || log "aviso: bun install falhou"
  (cd packages/web && bun --env-file=../../.env drizzle-kit push) >/dev/null 2>&1 || log "aviso: drizzle-kit push falhou"
  bun run build >/dev/null 2>&1 || log "aviso: build falhou"
  bun --env-file=.env packages/web/src/start-server.ts &
  sleep 4
}

sync_now() {
  # Busca sem alterar nada; se a rede falhar, tentamos outra vez no próximo ciclo.
  if ! git fetch origin main >/dev/null 2>&1; then
    log "git fetch falhou (rede?) — volto a tentar em 60s."
    return 1
  fi
  local LOCAL REMOTE
  LOCAL="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
  REMOTE="$(git rev-parse origin/main 2>/dev/null || echo unknown)"
  if [ "$LOCAL" = "unknown" ] || [ "$REMOTE" = "unknown" ]; then
    return 1
  fi
  if [ "$LOCAL" != "$REMOTE" ]; then
    log "nova versão detetada ($LOCAL -> $REMOTE) — a atualizar..."
    kill "$(pgrep -f 'start-server' | tr '\n' ' ')" 2>/dev/null
    sleep 2
    # reset --hard descarta alterações locais em ficheiros versionados,
    # mas NUNCA toca em ficheiros ignorados (data.db, .env, *.log) —
    # por isso a BD e as chaves de produção ficam intactas.
    if ! git reset --hard origin/main; then
      log "reset --hard falhou — a tentar de novo em 60s."
      return 1
    fi
    start_server
    log "servidor reiniciado na versão $(git rev-parse --short HEAD)."
  fi
  return 0
}

log "a iniciar..."
start_server
log "servidor ativo. a vigiar alterações no GitHub."

while true; do
  sync_now
  sleep 60
done
