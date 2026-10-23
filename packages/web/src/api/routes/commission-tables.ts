import { z } from "zod";
import { asc, eq, sql } from "drizzle-orm";
import { requireView, requireEdit } from "../middleware/auth";
import { db } from "../database";
import { commissionRows, commissionTables, departments } from "../database/schema";

const rowInput = z.object({
  label: z.string().min(1),
  minSales: z.number().nullable().optional(),
  maxSales: z.number().nullable().optional(),
  baseSalary: z.number().nullable().optional(),
  commissionPerSale: z.number().nullable().optional(),
  extras: z.record(z.string(), z.union([z.number(), z.string(), z.null()])).nullable().optional(),
  position: z.number().int().optional(),
});

const tableInput = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  departmentId: z.number().nullable().optional(),
  scaleBy: z.enum(["none", "sales"]).default("none"),
  color: z.string().default("#c6f432"),
  active: z.boolean().default(true),
  rows: z.array(rowInput).default([]),
});

export const commissionTablesRoute = {
  list: requireView("tabelas-comissionais").handler(async () => {
    const tables = await db
      .select({
        id: commissionTables.id,
        name: commissionTables.name,
        description: commissionTables.description,
        departmentId: commissionTables.departmentId,
        departmentName: departments.name,
        scaleBy: commissionTables.scaleBy,
        color: commissionTables.color,
        active: commissionTables.active,
        createdAt: commissionTables.createdAt,
        rowCount: sql<number>`(select count(*) from commission_rows r where r.table_id = ${commissionTables.id})`,
      })
      .from(commissionTables)
      .leftJoin(departments, eq(departments.id, commissionTables.departmentId))
      .orderBy(asc(commissionTables.name));

    const rows = await db
      .select({
        id: commissionRows.id,
        tableId: commissionRows.tableId,
        label: commissionRows.label,
        minSales: commissionRows.minSales,
        maxSales: commissionRows.maxSales,
        baseSalary: commissionRows.baseSalary,
        commissionPerSale: commissionRows.commissionPerSale,
        extras: commissionRows.extras,
        position: commissionRows.position,
      })
      .from(commissionRows)
      .orderBy(asc(commissionRows.position), asc(commissionRows.id));

    return tables.map((t) => ({ ...t, rows: rows.filter((r) => r.tableId === t.id) }));
  }),

  create: requireEdit("tabelas-comissionais").input(tableInput).handler(async ({ input }) => {
    const { rows, ...data } = input;
    const [table] = await db.insert(commissionTables).values(data).returning();
    if (rows.length) {
      await db.insert(commissionRows).values(rows.map((r, i) => ({ ...r, tableId: table.id, position: r.position ?? i })));
    }
    return table;
  }),

  update: requireEdit("tabelas-comissionais").input(tableInput.extend({ id: z.number() })).handler(async ({ input }) => {
    const { id, rows, ...data } = input;
    await db.update(commissionTables).set(data).where(eq(commissionTables.id, id));
    // Substitui os escalões pelos enviados (a página edita a tabela como um todo).
    await db.delete(commissionRows).where(eq(commissionRows.tableId, id));
    if (rows.length) {
      await db.insert(commissionRows).values(rows.map((r, i) => ({ ...r, tableId: id, position: r.position ?? i })));
    }
    return { ok: true };
  }),

  remove: requireEdit("tabelas-comissionais").input(z.object({ id: z.number() })).handler(async ({ input }) => {
    await db.delete(commissionTables).where(eq(commissionTables.id, input.id));
    return { ok: true };
  }),
};
