import type { Database } from "bun:sqlite";
import { mergeTerritorySweeps, territoryKey, territoryMunicipality } from "../shared/territory-municipalities";

export function migrateTerritoryMunicipalities(db: Database) {
  // Marcador separado: o provisionamento pode criar a tabela ativa antes deste arranque.
  db.transaction(() => {
    db.run("CREATE TABLE IF NOT EXISTS territory_migrations (key TEXT PRIMARY KEY NOT NULL)");
    if (db.query("SELECT 1 FROM territory_migrations WHERE key = 'municipalities-v1'").get()) return;
    db.run(`CREATE TABLE IF NOT EXISTS municipality_territories (
      id TEXT PRIMARY KEY NOT NULL,
      location_key TEXT NOT NULL UNIQUE,
      district TEXT NOT NULL,
      municipality TEXT NOT NULL,
      last_sweep TEXT
    )`);
    const legacy = db.query<{ id: string; district: string; municipality: string; lastSweep: string | null }, []>(
      'SELECT id, district, municipality, last_sweep AS lastSweep FROM territories ORDER BY id',
    ).all();
    const insert = db.query("INSERT INTO municipality_territories (id, location_key, district, municipality, last_sweep) VALUES (?, ?, ?, ?, ?) ON CONFLICT(location_key) DO NOTHING");
    for (const row of mergeTerritorySweeps(legacy)) {
      const place = territoryMunicipality(row);
      insert.run(row.id, territoryKey(row), place?.district ?? row.district, place?.municipality ?? row.municipality, row.lastSweep);
    }
    db.run("INSERT INTO territory_migrations (key) VALUES ('municipalities-v1')");
  }).immediate();
}
