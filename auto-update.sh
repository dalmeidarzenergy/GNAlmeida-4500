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

# Prepara o código para correr: dependências, esquema da BD e build.
#
# Isto é SEPARADO de arrancar o processo, de propósito: antes o
# `drizzle-kit push` vivia dentro do arranque e só corria quando o servidor
# NÃO estava a correr — ou seja, numa atualização normal (servidor já ativo)
# a migração nunca acontecia e as tabelas novas nunca eram criadas.
provision() {
  log "a preparar (bun install + drizzle-kit push + build)..."
  bun install --frozen-lockfile >/dev/null 2>&1 || log "aviso: bun install falhou"
  (cd packages/web && bun --env-file=../../.env drizzle-kit push --force) >/dev/null 2>&1 \
    || log "aviso: drizzle-kit push falhou"
  bun run build >/dev/null 2>&1 || log "aviso: build falhou"
}

start_server() {
  if pgrep -f "start-server" > /dev/null 2>&1; then
    return 0
  fi
  log "a arrancar o servidor..."
  bun --env-file=.env packages/web/src/start-server.ts &
  sleep 4
}

# Mata o servidor e espera que o processo morra mesmo, em vez de confiar
# num `sleep` fixo (um `sleep 2` curto deixava o processo de pé e o arranque
# seguinte era abortado pelo `pgrep`).
stop_server() {
  local pids
  pids="$(pgrep -f 'start-server' | tr '\n' ' ')"
  [ -n "$pids" ] || return 0
  kill $pids 2>/dev/null
  for _ in $(seq 1 20); do
    pgrep -f "start-server" >/dev/null 2>&1 || return 0
    sleep 1
  done
  log "aviso: o servidor não parou em 20s — forço."
  pkill -9 -f "start-server" 2>/dev/null
  sleep 2
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
    stop_server
    # reset --hard descarta alterações locais em ficheiros versionados,
    # mas NUNCA toca em ficheiros ignorados (data.db, .env, *.log) —
    # por isso a BD e as chaves de produção ficam intactas.
    if ! git reset --hard origin/main; then
      log "reset --hard falhou — a tentar de novo em 60s."
      return 1
    fi
    # provision() corre SEMPRE, mesmo que o servidor já estivesse ativo.
    provision
    start_server
    log "servidor reiniciado na versão $(git rev-parse --short HEAD)."
  fi
  return 0
}

log "a iniciar..."
# No arranque também garantimos que a BD está em dia com o esquema.
provision
start_server
log "servidor ativo. a vigiar alterações no GitHub."

while true; do
  sync_now
  sleep 60
done
