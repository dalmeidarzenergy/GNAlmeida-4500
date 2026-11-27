import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import catalogue from "../../src/api/data/territory-municipality-distances.json";
import { migrateTerritoryMunicipalities } from "../../src/api/database/migrate-territory-municipalities";
import { mergeTerritorySweeps, territoryKey, territoryMunicipality } from "../../src/api/shared/territory-municipalities";

const covilha = { district: "Castelo Branco", municipality: "Covilhã" };

test("routes to all 278 mainland seats and resolves all 308 CAOP keys", () => {
  expect(catalogue.rows.length).toBe(308);
  expect(catalogue.rows.filter((row) => row[3] !== null).length).toBe(278);
  for (const [code, district, municipality, meters] of catalogue.rows as [string, string, string, number | null][]) {
    const found = territoryMunicipality({ district, municipality });
    expect(found).toMatchObject({ code, meters });
    expect(territoryKey(found!)).toBe(code);
  }
  expect(territoryMunicipality(covilha)).toMatchObject({ code: "0503", meters: 194751 });
  expect(territoryMunicipality({ district: "", municipality: " COVILHA " })?.code).toBe("0503");
  expect(territoryMunicipality({ district: "Lisboa", municipality: "Covilhã" })).toBeUndefined();
  expect(territoryMunicipality({ district: "", municipality: "Lagoa" })).toBeUndefined();
  expect(territoryMunicipality({ district: "Faro", municipality: "Lagoa" })?.code).toBe("0806");
  expect(territoryMunicipality({ district: "Região Autónoma dos Açores", municipality: "Lagoa (Açores)" })).toMatchObject({ code: "4201", meters: null });
  expect(territoryMunicipality({ district: "Madeira", municipality: "Calheta (Madeira)" })?.code).toBe("3101");
});

test("merges a municipality's rows using the latest non-empty sweep", () => {
  expect(mergeTerritorySweeps([{ ...covilha, lastSweep: null }, { ...covilha, lastSweep: "2025-04-17" }, { district: "Castelo Branco", municipality: " COVILHA ", lastSweep: "2026-05-05" }])).toHaveLength(1);
  expect(mergeTerritorySweeps([{ ...covilha, lastSweep: "2026-05-05" }, { ...covilha, lastSweep: null }])[0].lastSweep).toBe("2026-05-05");
});

test("migration preserves legacy rows even when Drizzle created the new tables before startup and does not resurrect deletes", () => {
  using db = new Database(":memory:");
  db.run("CREATE TABLE territories (id TEXT, district TEXT, municipality TEXT, parish TEXT, village TEXT, last_sweep TEXT)");
  db.run("CREATE TABLE municipality_territories (id TEXT PRIMARY KEY, location_key TEXT UNIQUE, district TEXT, municipality TEXT, last_sweep TEXT)");
  db.run("CREATE TABLE territory_migrations (key TEXT PRIMARY KEY)");
  db.run("INSERT INTO territories VALUES ('old','Castelo Branco','Covilhã','Teixoso','', '2025-01-01'), ('recent','Castelo Branco','COVILHA','Covilhã','', '2026-05-05')");
  migrateTerritoryMunicipalities(db);
  expect(db.query("SELECT * FROM municipality_territories").all()).toEqual([{ id: "recent", district: "Castelo Branco", municipality: "Covilhã", location_key: "0503", last_sweep: "2026-05-05" }]);
  expect(db.query("SELECT parish,last_sweep FROM territories ORDER BY last_sweep").all()).toEqual([{ parish: "Teixoso", last_sweep: "2025-01-01" }, { parish: "Covilhã", last_sweep: "2026-05-05" }]);
  db.run("DELETE FROM municipality_territories");
  migrateTerritoryMunicipalities(db);
  expect(db.query("SELECT * FROM municipality_territories").all()).toEqual([]);
  expect(db.query("SELECT * FROM territories").all()).toHaveLength(2);
});
