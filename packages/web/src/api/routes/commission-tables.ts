import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { requireView, requireEdit } from "../middleware/auth";
import { db } from "../database";
import { commissionRows, commissionTables } from "../database/schema";

const rowInput = z.object({
  kind: z.enum(["clients", "medem", "solar"]),
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
  commission: z.number().nullable().optional(),
  luz: z.number().nullable().optional(),
  gas: z.number().nullable().optional(),
  dd: z.number().nullable().optional(),
  fe: z.number().nullable().optional(),
  pel: z.number().nullable().optional(),
});

const tableInput = z.object({
  name: z.string().min(1, "Indique o nome da tabela."),
  description: z.string().nullable().optional(),
  color: z.string().default("#c6f432"),
  active: z.boolean().default(true),
  clientRows: z.array(rowInput).default([]),
  medemRows: z.array(rowInput).default([]),
  solarRows: z.array(rowInput).default([]),
});

const clean = (r: z.infer<typeof rowInput>, kind: "clients" | "medem" | "solar", i: number) => ({
  tableId: 0,
  kind,
  min: r.min ?? null,
  max: r.max ?? null,
  commission: r.commission ?? null,
  luz: r.luz ?? null,
  gas: r.gas ?? null,
  dd: r.dd ?? null,
  fe: r.fe ?? null,
  pel: r.pel ?? null,
  position: i,
});

export const commissionTablesRoute = {
  list: requireView("tabelas-comissionais").handler(async () => {
    const tables = await db
      .select()
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
        luz: commissionRows.luz,
        gas: commissionRows.gas,
        dd: commissionRows.dd,
        fe: commissionRows.fe,
        pel: commissionRows.pel,
        position: commissionRows.position,
      })
      .from(commissionRows)
      .orderBy(asc(commissionRows.position), asc(commissionRows.id));

    return tables.map((t) => ({
      ...t,
      clientRows: rows.filter((r) => r.tableId === t.id && r.kind === "clients"),
      medemRows: rows.filter((r) => r.tableId === t.id && r.kind === "medem"),
      solarRows: rows.filter((r) => r.tableId === t.id && r.kind === "solar"),
    }));
  }),

  create: requireEdit("tabelas-comissionais").input(tableInput).handler(async ({ input }) => {
    const { clientRows, medemRows, solarRows, ...data } = input;
    const [table] = await db.insert(commissionTables).values(data).returning();
    const all = [
      ...clientRows.map((r, i) => clean(r, "clients", i)),
      ...medemRows.map((r, i) => clean(r, "medem", i)),
      ...solarRows.map((r, i) => clean(r, "solar", i)),
    ];
    if (all.length) await db.insert(commissionRows).values(all.map((r) => ({ ...r, tableId: table.id })));
    return table;
  }),

  update: requireEdit("tabelas-comissionais").input(tableInput.extend({ id: z.number() })).handler(async ({ input }) => {
    const { id, clientRows, medemRows, solarRows, ...data } = input;
    await db.update(commissionTables).set(data).where(eq(commissionTables.id, id));
    // A página edita a tabela como um todo: substitui todos os escalões.
    await db.delete(commissionRows).where(eq(commissionRows.tableId, id));
    const all = [
      ...clientRows.map((r, i) => clean(r, "clients", i)),
      ...medemRows.map((r, i) => clean(r, "medem", i)),
      ...solarRows.map((r, i) => clean(r, "solar", i)),
    ];
    if (all.length) await db.insert(commissionRows).values(all.map((r) => ({ ...r, tableId: id })));
    return { ok: true };
  }),

  remove: requireEdit("tabelas-comissionais").input(z.object({ id: z.number() })).handler(async ({ input }) => {
    await db.delete(commissionTables).where(eq(commissionTables.id, input.id));
    return { ok: true };
  }),
};
