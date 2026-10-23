import { z } from "zod";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { authed, requireView, requireEdit } from "../middleware/auth";
import { db } from "../database";
import { commissionRows, commissionTables, employees, sales, saleStatusHistory } from "../database/schema";

/** Estados que contam como venda em fornecimento. */
const COUNTED_STATUS = "Em Fornecimento";

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
  blockedSales: z.number().min(0).default(0),
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

  /**
   * Cálculo de comissões de um mês, por vendedor.
   *
   * Escalão: nº de vendas LUZ (ou a luz das DUAL) com Nível de Tensão BTN que entraram em
   * "Em Fornecimento" dentro do mês escolhido.
   * Bloqueio: à tabela aplicada ao vendedor é descontado um nº fixo de vendas; o escalão é
   * determinado pelo nº de vendas ANTES do bloqueio, e o valor pago é comissão × (vendas − bloqueio).
   */
  calc: requireView("tabelas-comissionais")
    .input(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }))
    .handler(async ({ input }) => {
      const from = `${input.month}-01`;
      const lastDay = new Date(Number(input.month.slice(0, 4)), Number(input.month.slice(5, 7)), 0).getDate();
      const to = `${input.month}-${String(lastDay).padStart(2, "0")}`;

      // Vendas LUZ/Dual BTN que entraram em fornecimento no mês, agrupadas por vendedor.
      const counted = await db
        .select({
          sellerId: sales.sellerId,
          saleId: sales.id,
          on: sql<string>`max(${saleStatusHistory.changedOn})`,
        })
        .from(saleStatusHistory)
        .innerJoin(sales, eq(sales.id, saleStatusHistory.saleId))
        .where(
          and(
            eq(saleStatusHistory.energy, "luz"),
            eq(saleStatusHistory.status, COUNTED_STATUS),
            sql`json_extract(${sales.details}, '$.voltageLevel') = 'BTN'`,
            sql`${sales.service} in ('LUZ', 'DUAL')`,
          ),
        )
        .groupBy(saleStatusHistory.saleId);

      const inMonth = counted.filter((r) => r.on >= from && r.on <= to);
      const bySeller = new Map<number, number>();
      for (const r of inMonth) {
        if (r.sellerId == null) continue;
        bySeller.set(r.sellerId, (bySeller.get(r.sellerId) ?? 0) + 1);
      }

      const sellers = await db
        .select({
          id: employees.id,
          name: employees.name,
          isSeller: employees.isSeller,
          commissionTableId: employees.commissionTableId,
        })
        .from(employees);

      const tables = await db.select().from(commissionTables);
      const rows = await db.select().from(commissionRows).orderBy(asc(commissionRows.position));

      const result = sellers
        .filter((s) => s.isSeller && (bySeller.get(s.id) ?? 0) > 0)
        .map((s) => {
          const count = bySeller.get(s.id) ?? 0;
          const table = tables.find((t) => t.id === s.commissionTableId) ?? null;
          if (!table) return { sellerId: s.id, sellerName: s.name, sales: count, tableName: null, blocked: 0, paidSales: count, band: null, commission: 0, missingTable: true };

          const bands = rows.filter((r) => r.tableId === table.id && r.kind === "clients");
          const band = bands.find((b) => count >= (b.min ?? 0) && (b.max == null || count <= b.max)) ?? bands.filter((b) => b.max == null && count >= (b.min ?? 0)).at(-1) ?? null;
          const blocked = table.blockedSales ?? 0;
          const paidSales = Math.max(0, count - blocked);
          const perSale = band?.luz ?? 0;
          return {
            sellerId: s.id,
            sellerName: s.name,
            sales: count,
            tableName: table.name,
            blocked,
            paidSales,
            band: band ? { min: band.min, max: band.max } : null,
            commission: paidSales * perSale,
            missingTable: false,
          };
        })
        .sort((a, b) => b.commission - a.commission);

      return { month: input.month, from, to, sellers: result };
    }),
};
