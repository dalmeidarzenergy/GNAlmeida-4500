#!/usr/bin/env bash
# Sincroniza o servidor WSL apos alteracoes de codigo na app GNAlmeida.
# Uso: bash /home/diogo_almeida/GNAlmeida-4500/atualizar.sh

set -e
cd /home/diogo_almeida/GNAlmeida-4500

echo "==> 1/4  A atualizar codigo a partir do GitHub"
git fetch origin && git reset --hard origin/main

echo "==> 2/4  A sincronizar a base de dados"
cd packages/web

# CÓPIA DE SEGURANÇA antes de qualquer alteração (nunca apagar dados do utilizador).
python3 <<'PY'
import sqlite3, shutil, os, time
src = "src/data.db"
if os.path.exists(src):
    bak = src + ".bak-" + time.strftime("%Y%m%d-%H%M%S")
    shutil.copy2(src, bak)
    print("  copia de seguranca: " + bak)
PY

# Só apagamos tabelas commission_*/chief_*/employee_tables se estiverem VAZIAS.
# Se tiverem dados, mantemo-las e o drizzle-kit só acrescenta colunas em falta (não apaga nada).
python3 <<'PY'
import sqlite3
c = sqlite3.connect("src/data.db")
for t in ("commission_rows", "commission_tables", "chief_rows", "chief_tables", "employee_tables"):
    n = 0
    try:
        n = c.execute("select count(*) from " + t).fetchone()[0]
    except Exception:
        pass
    if n == 0:
        c.execute("DROP TABLE IF EXISTS " + t)
        c.commit()
        print("  tabela " + t + " removida (vazia)")
    else:
        print("  tabela " + t + " mantida (" + str(n) + " registos)")
c.commit()
PY

# Colunas antigas retiradas do schema (is_seller, vacation_days): remove-se antes do push
# para o drizzle-kit nao pedir confirmacao interativa.
python3 <<'PY'
import sqlite3
c = sqlite3.connect("src/data.db")
empcols = [r[1] for r in c.execute("PRAGMA table_info(employees)").fetchall()]
for col in ("is_seller", "vacation_days"):
    if col in empcols:
        c.execute("ALTER TABLE employees DROP COLUMN " + col)
        c.commit()
        print("  coluna employees." + col + " removida")
c.close()
PY

# Colunas novas NOT NULL com default têm de existir ANTES do push, senao o drizzle-kit
# tenta adiciona-las sem default e aborta com aviso de data-loss.
python3 <<'PY'
import sqlite3
c = sqlite3.connect("src/data.db")
empcols = [r[1] for r in c.execute("PRAGMA table_info(employees)").fetchall()]
before = {
    "force_commissions": "integer NOT NULL DEFAULT 0",
    "force_commissions_pct": "integer NOT NULL DEFAULT 0",
}
for col, decl in before.items():
    if col not in empcols:
        c.execute("ALTER TABLE employees ADD COLUMN " + col + " " + decl)
        c.commit()
        print("  coluna employees." + col + " adicionada (antes do push)")
c.close()
PY

bun --env-file=../../.env drizzle-kit push

# Colunas novas adicionadas depois (idempotente).
python3 <<'PY'
import sqlite3
c = sqlite3.connect("src/data.db")
cols = [r[1] for r in c.execute("PRAGMA table_info(commission_tables)").fetchall()]
for col, decl in {
    "blocked_sales": "real NOT NULL DEFAULT 0",
    "group": "text NOT NULL DEFAULT 'gestor-comercial'",
    "regime": "text NOT NULL DEFAULT 'RES+BTN NEG'",
    "is_base": "integer NOT NULL DEFAULT 0",
}.items():
    if col not in cols:
        c.execute("ALTER TABLE commission_tables ADD COLUMN " + col + " " + decl)
        c.commit()
        print("  coluna commission_tables." + col + " adicionada")

emp = [r[1] for r in c.execute("PRAGMA table_info(employees)").fetchall()]
assert "commission_table_id" in emp, "ERRO: employees.commission_table_id em falta"
if "chief_table_id" not in emp:
    c.execute("ALTER TABLE employees ADD COLUMN chief_table_id integer REFERENCES chief_tables(id)")
    c.commit()
    print("  coluna chief_table_id adicionada")
if "category" not in emp:
    c.execute("ALTER TABLE employees ADD COLUMN category text")
    c.commit()
    print("  coluna employees.category adicionada")
if "force_commissions" not in emp:
    c.execute("ALTER TABLE employees ADD COLUMN force_commissions integer NOT NULL DEFAULT 0")
    c.commit()
    print("  coluna employees.force_commissions adicionada")
if "force_commissions_pct" not in emp:
    c.execute("ALTER TABLE employees ADD COLUMN force_commissions_pct integer NOT NULL DEFAULT 0")
    c.commit()
    print("  coluna employees.force_commissions_pct adicionada")

tabs = [r[0] for r in c.execute("select name from sqlite_master where type='table'").fetchall()]
assert "commission_tables" in tabs and "commission_rows" in tabs, "ERRO: tabelas commission_* em falta"
assert "chief_tables" in tabs and "chief_rows" in tabs, "ERRO: tabelas chief_* em falta"
assert "employee_tables" in tabs, "ERRO: tabela employee_tables em falta"
assert "payments" in tabs, "ERRO: tabela payments em falta"

pay = [r[1] for r in c.execute("PRAGMA table_info(payments)").fetchall()]
pay_new = {
    "pel_qty": "real NOT NULL DEFAULT 0",
    "dd_qty": "real NOT NULL DEFAULT 0",
    "fe_qty": "real NOT NULL DEFAULT 0",
    "extras_amount": "real NOT NULL DEFAULT 0",
    "gross_amount": "real NOT NULL DEFAULT 0",
    "penalty_timing": "real NOT NULL DEFAULT 0",
    "penalty_campaign": "real NOT NULL DEFAULT 0",
    "km_deduction": "real NOT NULL DEFAULT 0",
    "pdf_key": "text",
    "pdf_name": "text",
}
for col, decl in pay_new.items():
    if col not in pay:
        c.execute("ALTER TABLE payments ADD COLUMN " + col + " " + decl)
        c.commit()
        print("  coluna payments." + col + " adicionada")
print("  OK: schema em ordem")
PY

echo "==> 3/5  A compilar o frontend (dist)"
cd /home/diogo_almeida/GNAlmeida-4500/packages/web
bun run build
cd /home/diogo_almeida/GNAlmeida-4500
echo "  dist atualizado"

echo "==> 4/5  A reiniciar o servidor"
cd /home/diogo_almeida/GNAlmeida-4500
if command -v pm2 >/dev/null 2>&1 && pm2 list 2>/dev/null | grep -q web-app; then
  pm2 restart web-app --update-env
  echo "  servidor reiniciado via pm2"
else
  echo "  (sem pm2: o watchdog reinicia o codigo; reinicia o processo a mao se necessario)"
fi

echo "==> 5/5  Verificacao"
CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:${PORT:-3000}/funcionarios || echo 000)
echo "  /funcionarios -> HTTP $CODE"
echo ""
SERVED=$(curl -s http://localhost:${PORT:-3000}/ | grep -o 'index-[A-Za-z0-9_-]*\.js' | head -1)
BUILT=$(ls packages/web/dist/assets/ | grep -E '^index-.*\.js$' | head -1)
if [ -n "$SERVED" ] && [ "$SERVED" != "$BUILT" ]; then
  echo "  AVISO: o servidor serve $SERVED mas o dist tem $BUILT — reinicia o servidor a mao."
else
  echo "  frontend: $BUILT (servido corretamente)"
fi
echo ""
echo "Feito."
