# Corrigir "Funcionários" no servidor WSL (após atualização de código)
# Uso:  bash /home/diogo_almeida/GNAlmeida-4500/atualizar.sh

set -e
cd /home/diogo_almeida/GNAlmeida-4500

echo "==> 1/4  A atualizar código a partir do GitHub"
git fetch origin && git reset --hard origin/main

echo "==> 2/4  A sincronizar a base de dados (drizzle-kit push)"
cd packages/web

# As tabelas commission_* estão vazias: apagamos para evitar o prompt interativo do drizzle-kit.
python3 - <<'PY'
import sqlite3
c = sqlite3.connect("src/data.db")
for t in ("commission_rows", "commission_tables"):
    c.execute(f"DROP TABLE IF EXISTS {t}")
c.commit()
print("  tabelas commission_* removidas (vazias)")
PY

bun --env-file=../../.env drizzle-kit push

# Confirmar que as colunas existem agora.
python3 - <<'PY'
import sqlite3
c = sqlite3.connect("src/data.db")
cols = [r[1] for r in c.execute("PRAGMA table_info(employees)").fetchall()]
assert "commission_table_id" in cols, "ERRO: coluna commission_table_id em falta em employees"
tabs = [r[0] for r in c.execute("select name from sqlite_master where type='table'").fetchall()]
assert "commission_tables" in tabs and "commission_rows" in tabs, "ERRO: tabelas commission_* em falta"
print("  OK: commission_table_id, commission_tables, commission_rows presentes")
PY

echo "==> 3/4  A reiniciar o servidor"
cd /home/diogo_almeida/GNAlmeida-4500
if command -v pm2 >/dev/null 2>&1 && pm2 list 2>/dev/null | grep -q web-app; then
  pm2 restart web-app --update-env
  echo "  servidor reiniciado via pm2"
else
  echo "  (sem pm2: o watchdog/processo existente deve reiniciar sozinho)"
fi

echo "==> 4/4  Verificação"
CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:${PORT:-3000}/funcionarios || echo 000)
echo "  /funcionarios -> HTTP $CODE"
echo ""
echo "Feito. Abre o CRM e confirma que Funcionários carrega e que existe a aba Tabelas Comissionais."
