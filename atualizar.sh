#!/usr/bin/env bash
# Sincroniza o servidor WSL apos alteracoes de codigo na app GNAlmeida.
# Uso: bash /home/diogo_almeida/GNAlmeida-4500/atualizar.sh

set -e
cd /home/diogo_almeida/GNAlmeida-4500

echo "==> 1/4  A atualizar codigo a partir do GitHub"
git fetch origin && git reset --hard origin/main

echo "==> 2/4  A sincronizar a base de dados"
cd packages/web

# Tabelas commission_* estao vazias: apagamos para evitar o prompt interativo do drizzle-kit.
python3 - <<'PY'
import sqlite3
c = sqlite3.connect("src/data.db")
for t in ("commission_rows", "commission_tables", "chief_rows", "chief_tables", "employee_tables"):
    c.execute(f"DROP TABLE IF EXISTS {t}")
c.commit()
print("  tabelas commission_* e chief_* removidas (vazias)")

# Colunas antigas retiradas do schema (is_seller, vacation_days): removemos antes do push
# para o drizzle-kit nao pedir confirmacao interativa.
empcols = [r[1] for r in c.execute("PRAGMA table_info(employees)").fetchall()]
for col in ("is_seller", "vacation_days"):
    if col in empcols:
        c.execute(f"ALTER TABLE employees DROP COLUMN {col}")
        c.commit()
        print(f"  coluna employees.{col} removida")
PY

bun --env-file=../../.env drizzle-kit push

# Colunas novas adicionadas depois (idempotente).
python3 - <<'PY'
import sqlite3
c = sqlite3.connect("src/data.db")
cols = [r[1] for r in c.execute("PRAGMA table_info(commission_tables)").fetchall()]
if "blocked_sales" not in cols:
    c.execute("ALTER TABLE commission_tables ADD COLUMN blocked_sales real NOT NULL DEFAULT 0")
    c.commit()
    print("  coluna blocked_sales adicionada")
if "group" not in cols:
    c.execute("ALTER TABLE commission_tables ADD COLUMN \"group\" text NOT NULL DEFAULT 'gestor-comercial'")
    c.commit()
    print("  coluna commission_tables.group adicionada")
if "regime" not in cols:
    c.execute("ALTER TABLE commission_tables ADD COLUMN regime text NOT NULL DEFAULT 'RES+BTN NEG'")
    c.commit()
    print("  coluna commission_tables.regime adicionada")

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
        c.execute(f"ALTER TABLE payments ADD COLUMN {col} {decl}")
        c.commit()
        print(f"  coluna payments.{col} adicionada")
print("  OK: schema em ordem")
PY

echo "==> 3/4  A reiniciar o servidor"
cd /home/diogo_almeida/GNAlmeida-4500
if command -v pm2 >/dev/null 2>&1 && pm2 list 2>/dev/null | grep -q web-app; then
  pm2 restart web-app --update-env
  echo "  servidor reiniciado via pm2"
else
  echo "  (sem pm2: o watchdog reinicia o codigo; reinicia o processo a mao se necessario)"
fi

echo "==> 4/4  Verificacao"
CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:${PORT:-3000}/funcionarios || echo 000)
echo "  /funcionarios -> HTTP $CODE"
echo ""
echo "Feito. Confirma no CRM: Funcionarios, Tabelas Comissionais, Escaloes de Chefe de Equipa e Calculo de comissoes."
