import { z } from "zod";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { requireView, requireEdit } from "../middleware/auth";
import { db } from "../database";
import { chiefRows, chiefTables, employees, sales, saleStatusHistory, teamMemberships, teams } from "../database/schema";

const rowInput = z.object({
  kind: z.enum(["team", "own"]),
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
  teamRows: z.array(rowInput).default([]),
  ownRows: z.array(rowInput).default([]),
});

const clean = (r: z.infer<typeof rowInput>, kind: "team" | "own", i: number) => ({
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

export const chiefTablesRoute = {
  list: requireView("tabelas-comissionais").handler(async () => {
    const tables = await db.select().from(chiefTables).orderBy(asc(chiefTables.name));
    const rows = await db
      .select()
      .from(chiefRows)
      .orderBy(asc(chiefRows.position), asc(chiefRows.id));
    return tables.map((t) => ({
      ...t,
      teamRows: rows.filter((r) => r.tableId === t.id && r.kind === "team"),
      ownRows: rows.filter((r) => r.tableId === t.id && r.kind === "own"),
    }));
  }),

  create: requireEdit("tabelas-comissionais").input(tableInput).handler(async ({ input }) => {
    const { teamRows, ownRows, ...data } = input;
    const [table] = await db.insert(chiefTables).values(data).returning();
    const all = [...teamRows.map((r, i) => clean(r, "team", i)), ...ownRows.map((r, i) => clean(r, "own", i))];
    if (all.length) await db.insert(chiefRows).values(all.map((r) => ({ ...r, tableId: table.id })));
    return table;
  }),

  update: requireEdit("tabelas-comissionais").input(tableInput.extend({ id: z.number() })).handler(async ({ input }) => {
    const { id, teamRows, ownRows, ...data } = input;
    await db.update(chiefTables).set(data).where(eq(chiefTables.id, id));
    await db.delete(chiefRows).where(eq(chiefRows.tableId, id));
    const all = [...teamRows.map((r, i) => clean(r, "team", i)), ...ownRows.map((r, i) => clean(r, "own", i))];
    if (all.length) await db.insert(chiefRows).values(all.map((r) => ({ ...r, tableId: id })));
    return { ok: true };
  }),

  /** Associa o escalão de chefe a vários colaboradores de uma vez. */
  assign: requireEdit("tabelas-comissionais").input(z.object({ tableId: z.number().nullable(), employeeIds: z.array(z.number()).min(1).max(500) })).handler(async ({ input }) => {
    await db.update(employees).set({ chiefTableId: input.tableId }).where(inArray(employees.id, input.employeeIds));
    return { ok: true };
  }),

  /**
   * Cálculo do escalão de chefe de equipa, por chefe e por mês.
   *
   * Vendas contadas = LUZ/Dual BTN que entraram em fornecimento no mês (menos as que baixaram no próprio mês),
   * da equipa inteira (o chefe incluído) para o escalão de equipa, e só as próprias para o escalão próprio.
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
            sql`json_extract(${sales.details}, '$.voltageLevel') = 'BTN'`,
            sql`${sales.service} in ('LUZ', 'DUAL')`,
          ),
        );

      const perSale = new Map<number, { sellerId: number | null; service: string | null; details: Record<string, unknown> | null; suppliedOn: string | null; baixaOn: string[] }>();
      for (const r of hist) {
        const e = perSale.get(r.saleId) ?? { sellerId: r.sellerId, service: r.service, details: r.details, suppliedOn: null, baixaOn: [] };
        if (r.status === "Em Fornecimento") {
          if (!e.suppliedOn || r.on < e.suppliedOn) e.suppliedOn = r.on;
        } else {
          e.baixaOn.push(r.on);
        }
        perSale.set(r.saleId, e);
      }

      // Vendas válidas do mês, por vendedor.
      const valid = new Map<number, { service: string | null; details: Record<string, unknown> | null }[]>();
      for (const [, e] of perSale) {
        if (e.sellerId == null) continue;
        if (!e.suppliedOn || e.suppliedOn < from || e.suppliedOn > to) continue;
        if (e.baixaOn.some((d) => d >= from && d <= to)) continue;
        const list = valid.get(e.sellerId) ?? [];
        list.push({ service: e.service, details: e.details });
        valid.set(e.sellerId, list);
      }

      const staff = await db.select({ id: employees.id, name: employees.name, chiefTableId: employees.chiefTableId }).from(employees);
      const chiefStaff = staff.filter((s) => s.chiefTableId != null);
      const tables = await db.select().from(chiefTables);
      const rows = await db.select().from(chiefRows).orderBy(asc(chiefRows.position));

      // Equipa de cada chefe: chefes das equipas onde ele é líder.
      const memberships = await db
        .select({ teamId: teamMemberships.teamId, employeeId: teamMemberships.employeeId, startDate: teamMemberships.startDate, endDate: teamMemberships.endDate })
        .from(teamMemberships);
      const allTeams = await db.select({ id: teams.id, leaderId: teams.leaderId }).from(teams);

      const teamOfChief = (chiefId: number) => {
        const led = allTeams.filter((t) => t.leaderId === chiefId).map((t) => t.id);
        const ids = new Set<number>([chiefId]);
        for (const m of memberships) {
          if (!led.includes(m.teamId)) continue;
          if (m.startDate > to || (m.endDate && m.endDate < from)) continue;
          ids.add(m.employeeId);
        }
        return ids;
      };

      const bandFor = (tableId: number, kind: string, count: number) => {
        const bands = rows.filter((r) => r.tableId === tableId && r.kind === kind);
        return (
          bands.find((b) => count >= (b.min ?? 0) && (b.max == null || count <= b.max)) ??
          bands.filter((b) => b.max == null && count >= (b.min ?? 0)).at(-1) ??
          null
        );
      };

      const yes = (v: unknown) => (typeof v === "string" ? v.toLowerCase() === "sim" : v === true);

      const result = chiefStaff
        .map((s) => {
          const table = tables.find((t) => t.id === s.chiefTableId) ?? null;
          if (!table) return null;
          const ids = teamOfChief(s.id);
          let teamCount = 0;
          for (const id of ids) teamCount += valid.get(id)?.length ?? 0;
          const own = valid.get(s.id) ?? [];
          if (!teamCount) return null;

          const band = bandFor(table.id, "team", teamCount);
          const blocked = table.blockedSales ?? 0;
          const paidSales = Math.max(0, teamCount - blocked);
          const bandCommission = band?.commission ?? 0;

          const ownBand = bandFor(table.id, "own", own.length);
          const ownValue = own.reduce((sum, e) => {
            const d = e.details ?? {};
            const base = (e.service === "GÁS" ? ownBand?.gas : ownBand?.luz) ?? 0;
            return sum + base + (yes(d.ddc) ? ownBand?.dd ?? 0 : 0) + (yes(d.fe) ? ownBand?.fe ?? 0 : 0) + (yes(d.pel) ? ownBand?.pel ?? 0 : 0);
          }, 0);

          return {
            sellerId: s.id,
            sellerName: s.name,
            role: "chefe" as const,
            tableName: table.name,
            teamSales: teamCount,
            ownSales: own.length,
            blocked,
            paidSales,
            band: band ? { min: band.min, max: band.max } : null,
            teamCommission: bandCommission,
            ownBand: ownBand ? { min: ownBand.min, max: ownBand.max } : null,
            ownCommission: ownValue,
            commission: bandCommission + ownValue,
            missingTable: false,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x != null)
        .sort((a, b) => b.commission - a.commission);

      const totals = { commission: result.reduce((s, r) => s + r.commission, 0) };
      return { month: input.month, from, to, chiefs: result, totals };
    }),
};
