import { z } from "zod";
import { asc, eq, sql } from "drizzle-orm";
import { requireView, requireEdit } from "../middleware/auth";
import { db } from "../database";
import { commissionRows, commissionTables } from "../database/schema";

const rowInput = z.object({
  kind: z.enum(["medem", "solar"]),
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
  commission: z.number().nullable().optional(),
});

const tableInput = z.object({
  name: z.string().min(1, "Indique o nome da tabela."),
  description: z.string().nullable().optional(),
  color: z.string().default("#c6f432"),
  active: z.boolean().default(true),
  luz: z.number().nullable().optional(),
  gas: z.number().nullable().optional(),
  ddc: z.number().nullable().optional(),
  fe: z.number().nullable().optional(),
  pel: z.number().nullable().optional(),
  medemRows: z.array(rowInput).default([]),
  solarRows: z.array(rowInput).default([]),
});

export const commissionTablesRoute = {
  list: requireView("tabelas-comissionais").handler(async () => {
    const tables = await db
      .select({
        id: commissionTables.id,
        name: commissionTables.name,
        description: commissionTables.description,
        color: commissionTables.color,
        active: commissionTables.active,
        luz: commissionTables.luz,
        gas: commissionTables.gas,
        ddc: commissionTables.ddc,
        fe: commissionTables.fe,
        pel: commissionTables.pel,
        createdAt: commissionTables.createdAt,
      })
      .from(commissionTables)
      .orderBy(asc(commissionTables.name));

    const rows = await db
      .select({
        id: commissionRows.id,
        tableId: commissionRows.tableId,
        kind: commissionRows.kind,
        min: commissionRows.min,
        max: commissionRows.max,
        commission: commissionRows.commission,
        position: commissionRows.position,
      })
      .from(commissionRows)
      .orderBy(asc(commissionRows.position), asc(commissionRows.id));

    return tables.map((t) => ({
      ...t,
      medemRows: rows.filter((r) => r.tableId === t.id && r.kind === "medem"),
      solarRows: rows.filter((r) => r.tableId === t.id && r.kind === "solar"),
    }));
  }),

  create: requireEdit("tabelas-comissionais").input(tableInput).handler(async ({ input }) => {
    const { medemRows, solarRows, ...data } = input;
    const [table] = await db.insert(commissionTables).values(data).returning();
    const all = [...medemRows.map((r) => ({ ...r, kind: "medem" as const })), ...solarRows.map((r) => ({ ...r, kind: "solar" as const }))];
    if (all.length) {
      await db.insert(commissionRows).values(all.map((r, i) => ({ tableId: table.id, kind: r.kind, min: r.min ?? null, max: r.max ?? null, commission: r.commission ?? null, position: i })));
    }
    return table;
  }),

  update: requireEdit("tabelas-comissionais").input(tableInput.extend({ id: z.number() })).handler(async ({ input }) => {
    const { id, medemRows, solarRows, ...data } = input;
    await db.update(commissionTables).set(data).where(eq(commissionTables.id, id));
    // A página edita a tabela como um todo: substitui todos os escalões.
    await db.delete(commissionRows).where(eq(commissionRows.tableId, id));
    const all = [...medemRows.map((r) => ({ ...r, kind: "medem" as const })), ...solarRows.map((r) => ({ ...r, kind: "solar" as const }))];
    if (all.length) {
      await db.insert(commissionRows).values(all.map((r, i) => ({ tableId: id, kind: r.kind, min: r.min ?? null, max: r.max ?? null, commission: r.commission ?? null, position: i })));
    }
    return { ok: true };
  }),

  remove: requireEdit("tabelas-comissionais").input(z.object({ id: z.number() })).handler(async ({ input }) => {
    await db.delete(commissionTables).where(eq(commissionTables.id, input.id));
    return { ok: true };
  }),
};
