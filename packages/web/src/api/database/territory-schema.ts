import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const territoryRecords = sqliteTable("territories", {
  id: text("id").primaryKey(),
  locationKey: text("location_key").notNull(),
  district: text("district").notNull(),
  municipality: text("municipality").notNull(),
  parish: text("parish").notNull(),
  village: text("village").notNull().default(""),
  lastSweep: text("last_sweep"),
  // Legado: preservado para não perder o histórico manual; a API lê o total de Vendas.
  contracts: integer("contracts").notNull().default(0),
}, (t) => [uniqueIndex("idx_territories_location").on(t.locationKey)]);

// A tabela territories anterior permanece intacta como arquivo.
export const municipalityTerritories = sqliteTable("municipality_territories", {
  id: text("id").primaryKey(),
  locationKey: text("location_key").notNull().unique(),
  district: text("district").notNull(),
  municipality: text("municipality").notNull(),
  lastSweep: text("last_sweep"),
});

export const territoryMigrations = sqliteTable("territory_migrations", {
  key: text("key").primaryKey().notNull(),
});
