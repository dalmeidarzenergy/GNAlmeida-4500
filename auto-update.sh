#!/bin/bash
cd /home/diogo_almeida/GNAlmeida-4500
echo "[auto-update] $(date): A iniciar..."

# Arrancar servidor se ainda não estiver a correr
pgrep -f "start-server" > /dev/null || { echo "[auto-update] A arrancar servidor..."; bun --env-file=.env packages/web/src/start-server.ts & sleep 5; }
echo "[auto-update] Servidor ativo. A vigiar alterações..."

while true; do
  git fetch origin main 2>/dev/null
  LOCAL=$(git rev-parse HEAD)
  REMOTE=$(git rev-parse origin/main)
  
  if [ "$LOCAL" != "$REMOTE" ]; then
    echo "[auto-update] $(date): Nova versão — a atualizar..."
    kill $(pgrep -f "start-server") 2>/dev/null
    sleep 2
    git pull origin main
    bun install 2>/dev/null
    bun run build
    bun --env-file=.env packages/web/src/start-server.ts &
    echo "[auto-update] Servidor reiniciado."
  fi
  
  sleep 60
done