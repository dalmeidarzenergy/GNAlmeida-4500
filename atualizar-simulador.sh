#!/usr/bin/env bash
# atualizar-simulador.sh — rebuild + restart do servidor numa so vez.
#
# Uso:
#   ./atualizar-simulador.sh          -> build + restart
#   ./atualizar-simulador.sh --no-restart -> so build (fica pronto para restart manual)
#
# Alem do restart, faz o "cache bust": escreve a data da build no dist/version.txt
# para conseguires confirmar de relance que o browser esta a ver o build novo.

set -euo pipefail

WEB_DIR="/home/user/rzenergy/packages/web"
RAIZ="/home/user/rzenergy"
PORTA="${PORT:-4200}"
SESSAO="rz"
LOG="/tmp/srv4200.log"

cd "$RAIZ"

echo ">> 1/4  Build (turborepo)…"
# O turbo serve o resultado a partir de cache e, nesse caso, o dist/ nao é
# reescrito — o servidor reinicia com o bundle antigo e o codigo novo nao
# aparece. Forcamos a recompilacao do pacote web para garantir dist/ fresco.
bunx turbo build --force --filter=@template/web

echo ">> 2/4  Marcar versao do build…"
STAMP="$(date '+%Y-%m-%d %H:%M:%S')"
printf '%s\n' "$STAMP" > "$WEB_DIR/dist/version.txt"
echo "     versao: $STAMP"

if [ "${1:-}" = "--no-restart" ]; then
  echo ">> 3/4  (--no-restart) Saltar o restart do servidor."
  echo ">> Build pronto. Corre depois: $0 --restart-only"
  exit 0
fi
echo ">> 3/4  Reiniciar servidor na porta $PORTA…"
tmux kill-session -t "$SESSAO" 2>/dev/null || true
sleep 1
tmux new-session -d -s "$SESSAO" -c "$WEB_DIR" \
  "PORT=$PORTA bun --env-file=../../.env src/start-server.ts 2>&1 | tee $LOG"

# esperar que responda
echo -n "     a arrancar"
for _ in $(seq 1 30); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORTA/" || true)"
  if [ "$CODE" = "200" ]; then echo " ok"; break; fi
  echo -n "."
  sleep 1
done

if [ "${CODE:-}" != "200" ]; then
  echo
  echo "!!  O servidor nao respondeu na porta $PORTA. Ultimas linhas do log:"
  tail -20 "$LOG"
  exit 1
fi

echo ">> 4/4  Confirmar bundle servido…"
SERVIDO="$(curl -s "http://localhost:$PORTA/" | grep -o 'assets/index-[^\"]*\.js' | head -1)"
LOCAL="$(ls "$WEB_DIR/dist/assets/" | grep '^index-.*\.js$' | head -1)"
echo "     HTML serve:  $SERVIDO"
echo "     ficheiro:    assets/$LOCAL"

echo
echo "Pronto. App em http://localhost:$PORTA  (build de $STAMP)"
echo "Se o browser teimar em mostrar a versao antiga: Ctrl+Shift+R"
