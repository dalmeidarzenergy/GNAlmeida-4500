#!/bin/bash
set -e
cd /home/diogo_almeida/GNAlmeida-4500
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"

start_server() {
  pgrep -f "start-server" > /dev/null && return 0
  echo "[auto-update] A arrancar servidor..."
  bun install --frozen-lockfile 2>/dev/null || true
  # Sincroniza o schema da BD (cria tabelas novas, p.e. d2d_*) sem tocar nos dados.
  (cd packages/web && bun --env-file=../../.env drizzle-kit push) 2>/dev/null || true
  bun run build 2>/dev/null || true
  bun --env-file=.env packages/web/src/start-server.ts &
  sleep 4
}

echo "[auto-update] $(date): A iniciar..."
start_server
echo "[auto-update] Servidor ativo. A vigiar alterações..."

while true; do
  git fetch origin main 2>/dev/null
  LOCAL=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
  REMOTE=$(git rev-parse origin/main 2>/dev/null || echo "unknown")

  if [ "$LOCAL" != "$REMOTE" ] && [ "$LOCAL" != "unknown" ] && [ "$REMOTE" != "unknown" ]; then
    echo "[auto-update] $(date): Nova versão — a atualizar..."
    kill $(pgrep -f "start-server") 2>/dev/null || true
    sleep 2
    git checkout auto-update.sh 2>/dev/null || true
    git pull origin main || { echo "[auto-update] git pull falhou — a tentar de novo em 60s."; sleep 60; continue; }
    start_server
    echo "[auto-update] Servidor reiniciado."
  fi

  sleep 60
done