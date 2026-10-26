import { z } from "zod";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { authed, requireView, requireEdit } from "../middleware/auth";
import { db } from "../database";
import { commissionRows, commissionTables, employeeTables, employees, sales, saleStatusHistory } from "../database/schema";

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
  color: z.string().default("#206a9f"),
  active: z.boolean().default(true),
  group: z.enum(["gestor-comercial", "team-leader", "coordenador", "gestor-parcerias", "parceiro", "freelancer"]).default("gestor-comercial"),
  regime: z.enum(["RES+BTN NEG", "MEDEM", "SOLAR", "CE"]).default("RES+BTN NEG"),
  blockedSales: z.number().min(0).default(0),
  isBase: z.boolean().default(false),
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
   * Escalão: apurado apenas pelas vendas LUZ/Dual BTN que entraram em fornecimento no mês
   * (menos as que baixaram no próprio mês). O GÁS não conta para o escalão.
   * Pagamento: todas as vendas (LUZ, DUAL, GÁS) são pagas ao valor do escalão atingido
   * (+ DDC + FE + PEL conforme o que cada venda tem).
   * Chargeback: as vendas que passaram a Baixa neste mês descontam tudo o que foi pago por elas.
   */
  calc: requireView("tabelas-comissionais")
    .input(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }))
    .handler(async ({ input }) => {
      const from = `${input.month}-01`;
      const lastDay = new Date(Number(input.month.slice(0, 4)), Number(input.month.slice(5, 7)), 0).getDate();
      const to = `${input.month}-${String(lastDay).padStart(2, "0")}`;

      const hist = await db
        .select({
          saleId: saleStatusHistory.saleId,
          status: saleStatusHistory.status,
          on: saleStatusHistory.changedOn,
          sellerId: sales.sellerId,
          service: sales.service,
          details: sales.details,
        })
        .from(saleStatusHistory)
        .innerJoin(sales, eq(sales.id, saleStatusHistory.saleId))
        .where(
          and(
            eq(saleStatusHistory.energy, "luz"),
            sql`${saleStatusHistory.status} in ('Em Fornecimento', 'Baixa')`,
            sql`(
              (json_extract(${sales.details}, '$.voltageLevel') = 'BTN' AND ${sales.service} in ('LUZ', 'DUAL'))
              OR ${sales.service} = 'GÁS'
            )`,
          ),
        );

      // Entrada em fornecimento da venda (1ª passagem) e datas de baixa.
      const perSale = new Map<number, { sellerId: number | null; service: string | null; details: Record<string, unknown> | null; suppliedOn: string | null; baixaOn: string[] }>();
      for (const r of hist) {
        const e = perSale.get(r.saleId) ?? { sellerId: r.sellerId, service: r.service, details: r.details, suppliedOn: null, baixaOn: [] };
        if (r.status === "Em Fornecimento") {
          if (!e.suppliedOn || r.on < e.suppliedOn) e.suppliedOn = r.on;
        } else if (r.status === "Baixa") {
          e.baixaOn.push(r.on);
        }
        perSale.set(r.saleId, e);
      }

      const sellers = await db
        .select({ id: employees.id, name: employees.name, commissionTableId: employees.commissionTableId })
        .from(employees);
      const tables = await db.select().from(commissionTables);
      const rows = await db.select().from(commissionRows).orderBy(asc(commissionRows.position));
      const assignments = await db.select().from(employeeTables).where(eq(employeeTables.kind, "commission"));

      /**
       * Tabela em vigor no mês: usa a atribuição cuja vigência cobre o mês (a mais recente),
       * e só recorre à tabela atual do funcionário quando não há histórico.
       */
      const tableInForce = (seller: { id: number; commissionTableId: number | null }) => {
        const mine = assignments
          .filter((a) => a.employeeId === seller.id && a.commissionTableId != null)
          .filter((a) => a.startDate <= to && (a.endDate == null || a.endDate >= from))
          .sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
        const id = mine.length ? mine[0].commissionTableId : seller.commissionTableId;
        return tables.find((t) => t.id === id) ?? null;
      };

      // Escalão pelo total de vendas (antes do bloqueio).
      const bandFor = (tableId: number, count: number) => {
        const bands = rows.filter((r) => r.tableId === tableId && r.kind === "clients");
        return (
          bands.find((b) => count >= (b.min ?? 0) && (b.max == null || count <= b.max)) ??
          bands.filter((b) => b.max == null && count >= (b.min ?? 0)).at(-1) ??
          null
        );
      };

      const yes = (v: unknown) => (typeof v === "string" ? v.toLowerCase() === "sim" : v === true);

      const result = sellers
        .map((s) => {
          const table = tableInForce(s);
          const mine = [...perSale.entries()].filter(([, e]) => e.sellerId === s.id);

          // Vendas que entraram em fornecimento neste mês e não baixaram no mesmo mês.
          const entered = mine.filter(([, e]) => e.suppliedOn && e.suppliedOn >= from && e.suppliedOn <= to);
          const active = entered.filter(([, e]) => !e.baixaOn.some((d) => d >= from && d <= to));
          // Chargebacks: baixas neste mês de vendas que ENTRARAM antes (já pagas).
          // Vendas que entraram e baixaram no próprio mês não contam para o escalão nem são pagas,
          // portanto nunca entram no chargeback.
          const chargebacks = mine.filter(([, e]) => e.baixaOn.some((d) => d >= from && d <= to) && !!e.suppliedOn && e.suppliedOn < from);

          if (!active.length && !chargebacks.length) return null;
          if (!table) return { sellerId: s.id, sellerName: s.name, sales: active.length, tableName: null, blocked: 0, paidSales: active.length, band: null, unit: 0, gross: 0, commission: 0, chargebackSales: chargebacks.length, chargebackValue: 0, missingTable: true };

          const band = bandFor(table.id, active.filter(([, e]) => e.service !== "GÁS").length);
          const bandValue = (service: string | null) => (service === "GÁS" ? band?.gas : band?.luz) ?? 0;
          const perDdc = band?.dd ?? 0;
          const perFe = band?.fe ?? 0;
          const perPel = band?.pel ?? 0;

          // Valor pago por uma venda: escalão (LUZ/GÁS) + DDC + FE + PEL conforme o que tem.
          const valueOf = (e: { service: string | null; details: Record<string, unknown> | null }) => {
            const d = e.details ?? {};
            return bandValue(e.service) + (yes(d.ddc) ? perDdc : 0) + (yes(d.fe) ? perFe : 0) + (yes(d.pel) ? perPel : 0);
          };

          const blocked = table.blockedSales ?? 0;
          // O bloqueio remove as `blocked` primeiras vendas (por id); cada venda bloqueada perde o valor todo.
          const paid = active.slice().sort((a, b) => a[0] - b[0]).slice(blocked);
          const paidSales = paid.length;
          const unit = bandValue("LUZ");
          const gross = paid.reduce((sum, [, e]) => sum + valueOf(e), 0);
          const chargebackValue = chargebacks.reduce((sum, [, e]) => sum + valueOf(e), 0);
          // As baixas incluem vendas pagas em meses anteriores; o desconto cai sempre no mês da baixa.
          const commission = gross - chargebackValue;

          return {
            sellerId: s.id,
            sellerName: s.name,
            sales: active.length,
            tableName: table.name,
            blocked,
            paidSales,
            band: band ? { min: band.min, max: band.max } : null,
            unit,
            gross,
            chargebackSales: chargebacks.length,
            chargebackValue,
            commission,
            missingTable: false,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x != null)
        .sort((a, b) => b.commission - a.commission);

      const totals = {
        commission: result.reduce((s, r) => s + r.commission, 0),
        gross: result.reduce((s, r) => s + (r.gross ?? 0), 0),
        chargeback: result.reduce((s, r) => s + (r.chargebackValue ?? 0), 0),
      };
      return { month: input.month, from, to, sellers: result, totals };
    }),
};
