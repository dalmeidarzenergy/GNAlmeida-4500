import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const territoryRecords = sqliteTable("territories", {
  id: text("id").primaryKey(),
  locationKey: text("location_key").notNull(),
  district: text("district").notNull(),
  municipality: text("municipality").notNull(),
  parish: text("parish").notNull(),
  village: text("village").notNull().default(""),
  lastSweep: text("last_sweep"),
  contracts: integer("contracts").notNull().default(0),
}, (t) => [uniqueIndex("idx_territories_location").on(t.locationKey)]);
