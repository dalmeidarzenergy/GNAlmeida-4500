// Production & dev entrypoint: resolve o caminho da BD SQLite como
// absoluto. Se houver um volume persistente montado (Fly.io), copia
// o data.db para lá no primeiro arranque e usa-o — assim os dados
// sobrevivem a redeploys.
import { existsSync, copyFileSync } from "node:fs";
import { Database } from "bun:sqlite";

const bundledDb = `${import.meta.dirname}/data.db`;
const volumeDir = "/data";
const volumeDb = `${volumeDir}/data.db`;

let dbPath = bundledDb;
if (existsSync(volumeDir)) {
  // Volume persistente disponível — copiar seed se ainda não existir
  if (!existsSync(volumeDb)) {
    copyFileSync(bundledDb, volumeDb);
    console.log(`BD copiada para volume persistente: ${volumeDb}`);
  }
  process.env.DATABASE_URL = `file:${volumeDb}`;
  dbPath = volumeDb;
} else {
  // Ambiente local / dev — usar BD junto ao código
  process.env.DATABASE_URL = `file:${bundledDb}`;
}

// Migração de arranque idempotente. O `drizzle-kit push` (sem `--force`) falha
// silenciosamente a adicionar colunas NOT NULL novas — o watchdog engole o erro
// e o servidor arranca com código novo contra um schema antigo, quebrando quem
// faz `SELECT` dessas colunas. Garantimos aqui as colunas em falta, sem nunca
// apagar dados, para qualquer ambiente (WSL, Fly.io, dev).
if (existsSync(dbPath)) {
  const db = new Database(dbPath);
  try {
    const tables = db.query(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[];
    const has = (t: string) => tables.some((r) => r.name === t);
    const ensureColumn = (table: string, col: string, decl: string) => {
      if (!has(table)) return;
      const cols = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (!cols.some((c) => c.name === col)) {
        db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
        console.log(`[migração] coluna ${table}.${col} adicionada`);
      }
    };
    ensureColumn("sales", "ready", "integer NOT NULL DEFAULT 0");
    ensureColumn("sales", "alerts_disabled", "integer NOT NULL DEFAULT 0");
    // Propostas: origem (RES/NEG ou Medem) e cópia do PDF para a aba Propostas.
    ensureColumn("simulador_propostas", "source", "text NOT NULL DEFAULT 'res-neg'");
    ensureColumn("simulador_propostas", "pdf_base64", "text");
    ensureColumn("simulador_propostas", "pdf_name", "text");

    // Frota: tabelas novas. `CREATE TABLE IF NOT EXISTS` e idempotente e deixa
    // as bases antigas (sem frota) a funcionar assim que o servidor arranca.
    db.run(`CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plate TEXT NOT NULL,
      brand TEXT,
      model TEXT,
      year INTEGER,
      fuel TEXT,
      km INTEGER NOT NULL DEFAULT 0,
      employee_id INTEGER,
      status TEXT NOT NULL DEFAULT 'ativo',
      notes TEXT,
      created_at INTEGER NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS fleet_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      number TEXT NOT NULL,
      pin TEXT,
      vehicle_id INTEGER,
      employee_id INTEGER,
      monthly_limit REAL NOT NULL DEFAULT 0,
      start_date TEXT,
      end_date TEXT,
      status TEXT NOT NULL DEFAULT 'ativo',
      notes TEXT,
      created_at INTEGER NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS fleet_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER,
      card_id INTEGER,
      kind TEXT NOT NULL DEFAULT 'outro',
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      mime TEXT,
      expires_on TEXT,
      notes TEXT,
      created_at INTEGER NOT NULL
    )`);
  } finally {
    db.close();
  }
}

// Import dinâmico — só depois de DATABASE_URL estar definido
await import("./__server");
