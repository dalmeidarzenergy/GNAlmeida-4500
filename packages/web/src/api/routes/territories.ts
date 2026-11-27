import { ORPCError } from "@orpc/server";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../database";
import { territoryRecords as table } from "../database/territory-schema";
import { requireEdit, requireView, type Permissions, type Role } from "../middleware/auth";
import { territoryInput, territoryKey, TERRITORY_IMPORT_LIMIT, type Territory, type TerritoryInput } from "../shared/territories";
import { territoryDistance, territoryParishCode } from "../lib/territory-distance";
import { territoryContractCounts } from "../lib/territory-contracts";

const view = requireView("gestao-territorios");
const edit = requireEdit("gestao-territorios").use(async ({ context, next }) => {
  if (!context.permissions["gestao-territorios"].view) throw new ORPCError("FORBIDDEN");
  return next();
});
const columns = { id: table.id, district: table.district, municipality: table.municipality, parish: table.parish, village: table.village, lastSweep: table.lastSweep };

async function withMetrics(rows: (TerritoryInput & { id: string })[], context: { permissions: Permissions; role: Role }): Promise<Territory[]> {
  // A contagem é global; perfis limitados a vendas próprias ou de equipa não a recebem.
  const globalSales = context.permissions.vendas.view && context.role !== "vendedor" && context.role !== "chefe";
  const totals = globalSales && rows.length ? await territoryContractCounts() : null;
  return rows.map((row) => {
    const code = totals && territoryParishCode(row);
    return { ...row, distance: territoryDistance(row), contracts: totals && code ? (totals.get(code) ?? 0) : null };
  });
}

function values(data: TerritoryInput) {
  const { district, municipality, parish, village, lastSweep } = data;
  return { district, municipality, parish, village, lastSweep, locationKey: territoryKey(data) };
}

function duplicate() {
  return new ORPCError("CONFLICT", { message: "Já existe um registo para esta localização." });
}

export const territories = {
  list: view.handler(async ({ context }) => withMetrics(await db.select(columns).from(table).orderBy(asc(table.district), asc(table.municipality), asc(table.parish), asc(table.village)), context)),
  create: edit.input(territoryInput).handler(async ({ input }) => {
    const [row] = await db.insert(table).values({ id: crypto.randomUUID(), ...values(input) })
      .onConflictDoNothing({ target: table.locationKey }).returning(columns);
    if (!row) throw duplicate();
    return row;
  }),
  update: edit.input(z.object({ id: z.uuid(), data: territoryInput })).handler(async ({ input }) => {
    const changes = values(input.data);
    // UPDATE OR IGNORE equivale a não alterar nada se a chave da localização já existir.
    const [row] = await db.update(table).set(changes)
      .where(sql`${table.id} = ${input.id} AND NOT EXISTS (SELECT 1 FROM territories AS other WHERE other.location_key = ${changes.locationKey} AND other.id <> ${input.id})`)
      .returning(columns);
    if (row) return row;
    const [existing] = await db.select({ id: table.id }).from(table).where(eq(table.id, input.id));
    if (existing) throw duplicate();
    throw new ORPCError("NOT_FOUND", { message: "Território não encontrado." });
  }),
  remove: edit.input(z.object({ id: z.uuid() })).handler(async ({ input }) => {
    const [deleted] = await db.delete(table).where(eq(table.id, input.id)).returning({ id: table.id });
    if (!deleted) throw new ORPCError("NOT_FOUND", { message: "Território não encontrado." });
    return deleted;
  }),
  importRows: edit.input(z.array(territoryInput).min(1).max(TERRITORY_IMPORT_LIMIT)).handler(async ({ input }) => {
    // Um batch do libSQL é atómico; grupos pequenos evitam o limite de parâmetros SQLite.
    const batches = [];
    for (let i = 0; i < input.length; i += 100) {
      batches.push(db.insert(table).values(input.slice(i, i + 100).map((item) => ({ id: crypto.randomUUID(), ...values(item) })))
        .onConflictDoNothing({ target: table.locationKey }).returning({ id: table.id }));
    }
    const [first, ...rest] = batches;
    const result = await db.batch([first, ...rest]);
    const inserted = result.reduce((sum, rows) => sum + rows.length, 0);
    return { inserted, skipped: input.length - inserted };
  }),
};
