import { z } from "zod";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { requireView, requireEdit } from "../middleware/auth";
import { db } from "../database";
import { commissionRows, commissionTables, chiefRows, chiefTables, employeeTables, employees, payments, sales, saleStatusHistory, teamMemberships, teams } from "../database/schema";

const COUNTED_STATUS = "Em Fornecimento";

const month = z.string().regex(/^\d{4}-\d{2}$/, "Mês inválido.");

const rowInput = z.object({
  employeeId: z.number().int().positive("Escolha um funcionário."),
  month,
  kind: z.enum(["commission", "chief", "solar", "medem", "outro"]).default("commission"),
  amount: z.number().default(0),
  salesCount: z.number().min(0).default(0),
  paidOn: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."), z.literal(""), z.null()]).optional(),
  status: z.enum(["pago", "por_pagar"]).default("por_pagar"),
  notes: z.string().trim().nullish(),
});

const clean = (r: z.infer<typeof rowInput>) => ({
  employeeId: r.employeeId,
  month: r.month,
  kind: r.kind,
  amount: r.amount ?? 0,
  salesCount: r.salesCount ?? 0,
  paidOn: r.paidOn || null,
  status: r.paidOn ? (r.status ?? "pago") : (r.status === "pago" ? "por_pagar" : (r.status ?? "por_pagar")),
  notes: r.notes || null,
});

/** Limites do mês. */
const bounds = (m: string) => {
  const from = `${m}-01`;
  const lastDay = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();
  const to = `${m}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
};

export const paymentsRoute = {
  list: requireView("pagamentos").handler(async () => {
    const rows = await db
      .select({
        id: payments.id,
        employeeId: payments.employeeId,
        employeeName: employees.name,
        month: payments.month,
        kind: payments.kind,
        amount: payments.amount,
        salesCount: payments.salesCount,
        paidOn: payments.paidOn,
        status: payments.status,
        notes: payments.notes,
      })
      .from(payments)
      .leftJoin(employees, eq(employees.id, payments.employeeId))
      .orderBy(desc(payments.month), asc(employees.name));
    return rows.map((r) => ({ ...r, employeeName: r.employeeName ?? "—" }));
  }),

  save: requireEdit("pagamentos")
    .input(rowInput.extend({ id: z.number().int().positive().optional() }))
    .handler(async ({ input }) => {
      const data = clean(input);
      if (input.id) {
        await db.update(payments).set(data).where(eq(payments.id, input.id));
        return { id: input.id };
      }
      const [row] = await db.insert(payments).values(data).returning({ id: payments.id });
      return { id: row.id };
    }),

  remove: requireEdit("pagamentos")
    .input(z.object({ id: z.number().int().positive() }))
    .handler(async ({ input }) => {
      await db.delete(payments).where(eq(payments.id, input.id));
      return { ok: true };
    }),

  /**
   * Cálculo do que é devido no mês (vendedores + chefes), a partir das tabelas em vigor.
   * Escalão só por vendas LUZ/Dual BTN em fornecimento; GÁS pago ao escalão atingido;
   * baixas do mês descontam o que já foi pago (chargeback).
   */
  calc: requireView("pagamentos")
    .input(z.object({ month }))
    .handler(async ({ input }) => {
      const { from, to } = bounds(input.month);

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
            sql`${saleStatusHistory.status} in (${COUNTED_STATUS}, 'Baixa')`,
            sql`(
              (json_extract(${sales.details}, '$.voltageLevel') = 'BTN' AND ${sales.service} in ('LUZ', 'DUAL'))
              OR ${sales.service} = 'GÁS'
            )`,
          ),
        );

      type SaleLite = { service: string | null; details: Record<string, unknown> | null };
      const perSale = new Map<
        number,
        { sellerId: number | null; service: string | null; details: Record<string, unknown> | null; suppliedOn: string | null; baixaOn: string[] }
      >();
      for (const r of hist) {
        const e = perSale.get(r.saleId) ?? { sellerId: r.sellerId, service: r.service, details: r.details, suppliedOn: null, baixaOn: [] };
        if (r.status === COUNTED_STATUS) {
          if (!e.suppliedOn || r.on < e.suppliedOn) e.suppliedOn = r.on;
        } else {
          e.baixaOn.push(r.on);
        }
        perSale.set(r.saleId, e);
      }

      const valid = new Map<number, SaleLite[]>();
      const chargeback = new Map<number, SaleLite[]>();
      for (const [, e] of perSale) {
        if (e.sellerId == null) continue;
        const lite: SaleLite = { service: e.service, details: e.details };
        const baixou = e.baixaOn.some((d) => d >= from && d <= to);
        if (e.suppliedOn && e.suppliedOn >= from && e.suppliedOn <= to) {
          if (baixou) continue;
          const l = valid.get(e.sellerId) ?? [];
          l.push(lite);
          valid.set(e.sellerId, l);
        } else if (baixou && e.suppliedOn && e.suppliedOn < from) {
          const l = chargeback.get(e.sellerId) ?? [];
          l.push(lite);
          chargeback.set(e.sellerId, l);
        }
      }

      const staff = await db.select({ id: employees.id, name: employees.name, isSeller: employees.isSeller, commissionTableId: employees.commissionTableId, chiefTableId: employees.chiefTableId }).from(employees);
      const cTables = await db.select().from(commissionTables);
      const cRows = await db.select().from(commissionRows).orderBy(asc(commissionRows.position));
      const kTables = await db.select().from(chiefTables);
      const kRows = await db.select().from(chiefRows).orderBy(asc(chiefRows.position));
      const assignments = await db.select().from(employeeTables);
      const memberships = await db.select().from(teamMemberships);
      const allTeams = await db.select({ id: teams.id, leaderId: teams.leaderId }).from(teams);

      const yes = (v: unknown) => (typeof v === "string" ? v.toLowerCase() === "sim" : v === true);

      const pick = <T extends { startDate: string; endDate: string | null }>(list: T[]) =>
        list
          .filter((a) => a.startDate <= to && (a.endDate == null || a.endDate >= from))
          .sort((x, y) => (x.startDate < y.startDate ? 1 : -1))[0];

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

      const out: {
        employeeId: number;
        employeeName: string;
        role: "vendedor" | "chefe";
        tableName: string | null;
        sales: number;
        bandSales: number;
        unit: number;
        gross: number;
        chargeback: number;
        due: number;
        missingTable: boolean;
        detail: { luz: number; gas: number; other: number; chargebackSales: number };
      }[] = [];

      // ---- Vendedores (tabela comisional) ----
      for (const s of staff) {
        if (!s.isSeller) continue;
        const mine = valid.get(s.id) ?? [];
        const cb = chargeback.get(s.id) ?? [];
        if (!mine.length && !cb.length) continue;

        const a = pick(assignments.filter((x) => x.employeeId === s.id && x.kind === "commission" && x.commissionTableId != null));
        const tableId = a?.commissionTableId ?? s.commissionTableId;
        const table = cTables.find((t) => t.id === tableId) ?? null;
        if (!table) {
          out.push({ employeeId: s.id, employeeName: s.name, role: "vendedor", tableName: null, sales: mine.length, bandSales: 0, unit: 0, gross: 0, chargeback: 0, due: 0, missingTable: true, detail: { luz: 0, gas: 0, other: 0, chargebackSales: cb.length } });
          continue;
        }

        const bands = cRows.filter((r) => r.tableId === table.id && r.kind === "clients");
        const bandSales = mine.filter((e) => e.service !== "GÁS").length;
        const band =
          bands.find((b) => bandSales >= (b.min ?? 0) && (b.max == null || bandSales <= b.max)) ??
          bands.filter((b) => b.max == null && bandSales >= (b.min ?? 0)).at(-1) ??
          null;

        const valueOf = (e: SaleLite) => {
          const d = e.details ?? {};
          const base = (e.service === "GÁS" ? band?.gas : band?.luz) ?? 0;
          return base + (yes(d.ddc) ? band?.dd ?? 0 : 0) + (yes(d.fe) ? band?.fe ?? 0 : 0) + (yes(d.pel) ? band?.pel ?? 0 : 0);
        };

        const blocked = table.blockedSales ?? 0;
        const ordered = mine.slice();
        const paidSales = ordered.slice(Math.min(blocked, ordered.length));
        const gross = paidSales.reduce((sum, e) => sum + valueOf(e), 0);
        const cbValue = cb.reduce((sum, e) => sum + valueOf(e), 0);

        out.push({
          employeeId: s.id,
          employeeName: s.name,
          role: "vendedor",
          tableName: table.name,
          sales: mine.length,
          bandSales,
          unit: band?.luz ?? 0,
          gross,
          chargeback: cbValue,
          due: gross - cbValue,
          missingTable: false,
          detail: {
            luz: paidSales.filter((e) => e.service !== "GÁS").length,
            gas: paidSales.filter((e) => e.service === "GÁS").length,
            other: cb.length,
            chargebackSales: cb.length,
          },
        });
      }

      // ---- Chefes de equipa ----
      for (const s of staff) {
        const a = pick(assignments.filter((x) => x.employeeId === s.id && x.kind === "chief" && x.chiefTableId != null));
        const tableId = a?.chiefTableId ?? s.chiefTableId;
        if (tableId == null) continue;
        const table = kTables.find((t) => t.id === tableId) ?? null;
        if (!table) continue;

        const ids = teamOfChief(s.id);
        const teamSales: SaleLite[] = [];
        for (const id of ids) teamSales.push(...(valid.get(id) ?? []));
        const bandSales = teamSales.filter((e) => e.service !== "GÁS").length;
        if (!bandSales) continue;

        const bands = kRows.filter((r) => r.tableId === table.id && r.kind === "team");
        const band =
          bands.find((b) => bandSales >= (b.min ?? 0) && (b.max == null || bandSales <= b.max)) ??
          bands.filter((b) => b.max == null && bandSales >= (b.min ?? 0)).at(-1) ??
          null;

        const valueOf = (e: SaleLite) => {
          const d = e.details ?? {};
          const base = (e.service === "GÁS" ? band?.gas : band?.luz) ?? 0;
          return base + (yes(d.ddc) ? band?.dd ?? 0 : 0) + (yes(d.fe) ? band?.fe ?? 0 : 0) + (yes(d.pel) ? band?.pel ?? 0 : 0);
        };

        // vendas proprias do chefe (escalao "own")
        const own = valid.get(s.id) ?? [];
        const ownSales = own.filter((e) => e.service !== "GÁS").length;
        const ownBands = kRows.filter((r) => r.tableId === table.id && r.kind === "own");
        const ownBand =
          ownBands.find((b) => ownSales >= (b.min ?? 0) && (b.max == null || ownSales <= b.max)) ??
          ownBands.filter((b) => b.max == null && ownSales >= (b.min ?? 0)).at(-1) ??
          null;
        const ownValueOf = (e: SaleLite) => {
          const d = e.details ?? {};
          const base = (e.service === "GÁS" ? ownBand?.gas : ownBand?.luz) ?? 0;
          return base + (yes(d.ddc) ? ownBand?.dd ?? 0 : 0) + (yes(d.fe) ? ownBand?.fe ?? 0 : 0) + (yes(d.pel) ? ownBand?.pel ?? 0 : 0);
        };

        const blocked = table.blockedSales ?? 0;
        const teamPaid = teamSales.slice(Math.min(blocked, teamSales.length));
        const gross = teamPaid.reduce((sum, e) => sum + valueOf(e), 0) + own.reduce((sum, e) => sum + ownValueOf(e), 0);

        let cbValue = 0;
        for (const id of ids) for (const e of chargeback.get(id) ?? []) cbValue += valueOf(e);
        for (const e of chargeback.get(s.id) ?? []) cbValue += ownValueOf(e);

        out.push({
          employeeId: s.id,
          employeeName: s.name,
          role: "chefe",
          tableName: table.name,
          sales: teamSales.length,
          bandSales,
          unit: band?.luz ?? 0,
          gross,
          chargeback: cbValue,
          due: gross - cbValue,
          missingTable: false,
          detail: {
            luz: teamPaid.filter((e) => e.service !== "GÁS").length,
            gas: teamPaid.filter((e) => e.service === "GÁS").length,
            other: own.length,
            chargebackSales: ids.size,
          },
        });
      }

      out.sort((a, b) => b.due - a.due);
      const totals = {
        due: out.reduce((s, r) => s + r.due, 0),
        gross: out.reduce((s, r) => s + r.gross, 0),
        chargeback: out.reduce((s, r) => s + r.chargeback, 0),
        missingTable: out.filter((r) => r.missingTable).length,
      };
      return { month: input.month, from, to, rows: out, totals };
    }),
};
