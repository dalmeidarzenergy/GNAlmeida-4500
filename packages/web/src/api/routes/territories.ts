import { ORPCError } from "@orpc/server";
import { asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../database";
import { municipalityTerritories as table, territoryRecords as archive } from "../database/territory-schema";
import { requireEdit, requireView, type Permissions, type Role } from "../middleware/auth";
import { canViewTerritoryContracts, territoryInput, territoryKey, TERRITORY_IMPORT_LIMIT, type Territory, type TerritoryInput } from "../shared/territories";
import { mergeTerritorySweeps, territoryMunicipality } from "../shared/territory-municipalities";
import { territoryContractCounts, territoryContractDetails } from "../lib/territory-contracts";
import { territoryPopulation } from "../lib/territory-population";

const view = requireView("gestao-territorios");
const edit = requireEdit("gestao-territorios").use(async ({ context, next }) => {
  if (!context.permissions["gestao-territorios"].view) throw new ORPCError("FORBIDDEN");
  return next();
});
const columns = { id: table.id, district: table.district, municipality: table.municipality, lastSweep: table.lastSweep };

async function withMetrics(rows: (TerritoryInput & { id: string })[], context: { permissions: Permissions; role: Role }): Promise<Territory[]> {
  if (!rows.length) return [];
  // A contagem e a taxa são globais; perfis limitados a vendas próprias ou de equipa não as recebem.
  const totals = canViewTerritoryContracts(context) ? await territoryContractCounts() : null;
  const census = territoryPopulation.get();
  return rows.map((row) => {
    const place = territoryMunicipality(row);
    const distance = !place ? { status: "not_found" as const } : place.meters === null ? { status: "no_route" as const } : { status: "ok" as const, meters: place.meters };
    const contracts = totals && place ? (totals.get(place.code) ?? 0) : null;
    const population = place ? (census.byMunicipality[place.code] ?? null) : null;
    return {
      ...row, distance, contracts, population,
      populationYear: population === null ? null : census.year,
      penetrationRate: contracts !== null && population !== null && population > 0 ? contracts / population : null,
    };
  });
}

function values(data: TerritoryInput) {
  const known = territoryMunicipality(data);
  return { district: known?.district ?? data.district, municipality: known?.municipality ?? data.municipality, lastSweep: data.lastSweep, locationKey: territoryKey(data) };
}

function duplicate() {
  return new ORPCError("CONFLICT", { message: "Já existe um registo para este concelho." });
}

export const territories = {
  list: view.handler(async ({ context }) => withMetrics(await db.select(columns).from(table).orderBy(asc(table.district), asc(table.municipality)), context)),
  contracts: view.input(z.object({ id: z.uuid() })).handler(async ({ input, context }) => {
    if (!canViewTerritoryContracts(context)) throw new ORPCError("FORBIDDEN", { message: "É necessário acesso global a Vendas." });
    const [row] = await db.select({ district: table.district, municipality: table.municipality }).from(table).where(eq(table.id, input.id));
    if (!row) throw new ORPCError("NOT_FOUND", { message: "Território não encontrado." });
    const place = territoryMunicipality(row);
    return { recognized: !!place, sales: place ? await territoryContractDetails(place.code) : [] };
  }),
  history: view.handler(async () => db.select({ id: archive.id, district: archive.district, municipality: archive.municipality, lastSweep: archive.lastSweep })
    .from(archive).orderBy(desc(archive.lastSweep), asc(archive.district), asc(archive.municipality), asc(archive.id))),
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
      .where(sql`${table.id} = ${input.id} AND NOT EXISTS (SELECT 1 FROM municipality_territories AS other WHERE other.location_key = ${changes.locationKey} AND other.id <> ${input.id})`)
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
    const unique = mergeTerritorySweeps(input);
    const batches = [];
    for (let i = 0; i < unique.length; i += 100) {
      batches.push(db.insert(table).values(unique.slice(i, i + 100).map((item) => ({ id: crypto.randomUUID(), ...values(item) })))
        .onConflictDoNothing({ target: table.locationKey }).returning({ id: table.id }));
    }
    const [first, ...rest] = batches;
    const result = await db.batch([first, ...rest]);
    const inserted = result.reduce((sum, rows) => sum + rows.length, 0);
    return { inserted, skipped: input.length - inserted };
  }),
};
