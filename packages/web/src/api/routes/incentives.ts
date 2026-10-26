import { eq, and, gte, lte, lt, inArray, not, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { ORPCError, os } from "@orpc/server";
import { authed } from "../middleware/auth";
import { db } from "../database";
import { incentives, incentiveCalculations, sales, employees } from "../database/schema";
import type { IncentiveCalcRow, IncentiveRules } from "../database/schema";
import { SALE_COUNTED, DISTRICTS } from "../shared/client-forms";
import { normalizeSupplier } from "../shared/suppliers";

// ── Zod schemas ──

const tierSchema = z.object({ pct: z.number(), label: z.string(), amount: z.number() });
const pillarSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("per_sale"), name: z.string(), amount: z.number(), conditionKey: z.string(), conditionValues: z.array(z.string()) }),
  z.object({ type: z.literal("tiered_mix"), name: z.string(), percentageOf: z.string(), percentageOfValues: z.array(z.string()), baseRate: z.number(), tiers: z.array(tierSchema) }),
  z.object({ type: z.literal("weekly_top"), name: z.string(), amount: z.number(), topN: z.number(), eligibilityMin: z.number() }),
  z.object({ type: z.literal("rookie_best"), name: z.string(), amount: z.number(), eligibilityMin: z.number() }),
]);
const rulesSchema = z.object({
  eligibleServices: z.array(z.string()),
  eligibleSuppliers: z.array(z.string()),
  eligibleVoltages: z.array(z.string()),
  eligiblePowers: z.array(z.string()),
  eligibleSegments: z.array(z.string()),
  excludeOffers: z.array(z.string()),
  zbrDistricts: z.array(z.string()),
  pillars: z.array(pillarSchema),
});

const incentiveInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  active: z.boolean().optional(),
  rules: rulesSchema,
});

// ── Helpers ──

/** Verifica se o distrito está numa zona ZBR. */
function isZBR(district: string | null | undefined, zbrDistricts: string[]): boolean {
  if (!district || !zbrDistricts.length) return false;
  return zbrDistricts.includes(district.trim());
}

/**
 * Determina se uma venda é elegível para um pilar per_sale.
 *
 * Para pillar 1 do exemplo: conditionKey = "zone", conditionValues = ["ZAR"] / ["ZBR"]
 * O mapeamento distrito → zona é feito com zbrDistricts.
 */
function saleMatchesPillar(details: Record<string, string | boolean | null> | null, service: string | null, p: IncentivePillar["type"] extends "per_sale" ? Extract<IncentivePillar, { type: "per_sale" }> : never, zbrDistricts: string[]): boolean {
  if (!details) return false;
  const key = p.conditionKey;
  if (key === "zone") {
    const d = (details.district as string) ?? "";
    const zbr = isZBR(d, zbrDistricts);
    return p.conditionValues.includes(zbr ? "ZBR" : "ZAR");
  }
  // other condition keys: match directly against details field
  const val = String(details[key] ?? "");
  return p.conditionValues.some((v) => val === v);
}

/** Constrói a condição SQL base para vendas elegíveis do incentivo. */
function eligibleWhere(rules: IncentiveRules, startDate: string, endDate: string): (SQL | undefined)[] {
  const conds: (SQL | undefined)[] = [
    inArray(sales.status, SALE_COUNTED),
    gte(sales.date, startDate),
    lte(sales.date, endDate),
  ];
  if (rules.eligibleServices.length) conds.push(inArray(sales.service, rules.eligibleServices));
  return conds;
}

// ── Routes ──

export const incentivesRoutes = {
  list: authed.handler(async ({ context }) => {
    if (!context.permissions?.incentivos?.view) throw new ORPCError("FORBIDDEN");
    return db.select().from(incentives).orderBy(incentives.startDate);
  }),

  get: authed
    .input(z.object({ id: z.number() }))
    .handler(async ({ input, context }) => {
      if (!context.permissions?.incentivos?.view) throw new ORPCError("FORBIDDEN");
      const r = await db.select().from(incentives).where(eq(incentives.id, input.id)).limit(1);
      if (!r.length) throw new ORPCError("NOT_FOUND");
      return r[0];
    }),

  create: authed
    .input(incentiveInput)
    .handler(async ({ input, context }) => {
      if (!context.permissions?.incentivos?.edit) throw new ORPCError("FORBIDDEN");
      const [r] = await db.insert(incentives).values({
        name: input.name,
        description: input.description ?? null,
        startDate: input.startDate,
        endDate: input.endDate,
        active: input.active ?? true,
        rules: input.rules,
      }).returning();
      return r;
    }),

  update: authed
    .input(z.object({ id: z.number(), ...incentiveInput.shape }))
    .handler(async ({ input, context }) => {
      if (!context.permissions?.incentivos?.edit) throw new ORPCError("FORBIDDEN");
      const { id, ...data } = input;
      const [r] = await db.update(incentives).set({
        name: data.name,
        description: data.description ?? null,
        startDate: data.startDate,
        endDate: data.endDate,
        active: data.active ?? true,
        rules: data.rules,
      }).where(eq(incentives.id, id)).returning();
      if (!r) throw new ORPCError("NOT_FOUND");
      return r;
    }),

  remove: authed
    .input(z.object({ id: z.number() }))
    .handler(async ({ input, context }) => {
      if (!context.permissions?.incentivos?.edit) throw new ORPCError("FORBIDDEN");
      await db.delete(incentives).where(eq(incentives.id, input.id));
      return { ok: true };
    }),

  /** Calcula o incentivo para um mês (pré-visualização). */
  calculate: authed
    .input(z.object({ incentiveId: z.number(), month: z.string().regex(/^\d{4}-\d{2}$/) }))
    .handler(async ({ input, context }) => {
      if (!context.permissions?.incentivos?.view) throw new ORPCError("FORBIDDEN");

      const [inc] = await db.select().from(incentives).where(eq(incentives.id, input.incentiveId)).limit(1);
      if (!inc) throw new ORPCError("NOT_FOUND", { message: "Incentivo não encontrado." });

      const rules = inc.rules;
      const mStart = `${input.month}-01`;
      const mEnd = `${input.month}-31`;

      // Busca todas as vendas em fornecimento no mês, dentro do período do incentivo
      const baseConds = eligibleWhere(rules, inc.startDate, inc.endDate);
      baseConds.push(gte(sales.date, mStart), lte(sales.date, mEnd));

      const allSales = await db
        .select({
          id: sales.id,
          sellerId: sales.sellerId,
          service: sales.service,
          details: sales.details,
          date: sales.date,
        })
        .from(sales)
        .where(and(...baseConds.filter(Boolean) as SQL[]));

      // Agrupa por vendedor
      const bySeller = new Map<number, typeof allSales>();
      for (const s of allSales) {
        if (!s.sellerId) continue;
        if (!bySeller.has(s.sellerId)) bySeller.set(s.sellerId, []);
        bySeller.get(s.sellerId)!.push(s);
      }

      // Busca nomes dos vendedores
      const sellerIds = [...bySeller.keys()];
      const empRows = sellerIds.length
        ? await db.select({ id: employees.id, name: employees.name, createdAt: employees.createdAt }).from(employees).where(inArray(employees.id, sellerIds))
        : [];
      const empNames = new Map(empRows.map((e) => [e.id, e.name]));
      const empCreatedAt = new Map(empRows.map((e) => [e.id, e.createdAt]));

      // Total de vendas no mês (para o mix %)
      const monthTotal = allSales.length;

      // Filtro de elegibilidade base
      const isEligible = (s: typeof allSales[number]) => {
        const d = s.details as Record<string, string | boolean | null> | null;
        if (!d) return false;
        // Service
        if (rules.eligibleServices.length && s.service && !rules.eligibleServices.includes(s.service)) return false;
        // Voltage
        const vl = String(d.voltageLevel ?? "");
        if (rules.eligibleVoltages.length && !rules.eligibleVoltages.includes(vl)) return false;
        // Power
        const pw = String(d.power ?? "");
        if (rules.eligiblePowers.length && !rules.eligiblePowers.includes(pw)) return false;
        // Exclude offers
        const offer = String(d.campaign ?? "");
        if (rules.excludeOffers.length && rules.excludeOffers.some((o) => offer.toLowerCase().includes(o.toLowerCase()))) return false;
        // Segment (via NIF — NIF não está em details, mas podemos inferir de clientType ou do campo nif em details)
        // Para simplificar, usamos o campo "segment" se existir, senão assumimos elegível
        return true;
      };

      // Old supplier normalizado (do campo details.oldSupplier)
      const getSupplier = (s: typeof allSales[number]) => {
        const d = s.details as Record<string, string | boolean | null> | null;
        return normalizeSupplier(String(d?.oldSupplier ?? ""));
      };

      // ── Prémios de ranking (weekly_top / rookie_best) ──
      // Calcula, à parte, os prémios que dependem de ordenação global por semana/rookie.

      /** Segunda-feira da semana a que a data pertence (chave de agrupamento semanal). */
      const mondayOf = (dateStr: string): string => {
        const d = new Date(`${dateStr}T00:00:00`);
        const diff = (d.getDay() + 6) % 7;
        d.setDate(d.getDate() - diff);
        return d.toISOString().slice(0, 10);
      };

      // Elegíveis por vendedor (para rankings).
      const eligibleBySeller = new Map<number, typeof allSales>();
      for (const [sid, slist] of bySeller) eligibleBySeller.set(sid, slist.filter(isEligible));

      const rankingAwards = new Map<number, { name: string; amount: number; count: number; detail: string }[]>();

      // Rookies: sem vendas nos 3 meses anteriores ao início, ou registo novo após o início.
      const startD = new Date(`${inc.startDate}T00:00:00`);
      const threeBefore = new Date(startD);
      threeBefore.setMonth(threeBefore.getMonth() - 3);
      const beforeStr = threeBefore.toISOString().slice(0, 10);
      const priorSales = sellerIds.length
        ? await db.select({ sellerId: sales.sellerId }).from(sales).where(and(gte(sales.date, beforeStr), lt(sales.date, inc.startDate), inArray(sales.sellerId, sellerIds)))
        : [];
      const hadPrior = new Set(priorSales.map((s) => s.sellerId));
      const rookieIds = new Set<number>(sellerIds.filter((sid) => !hadPrior.has(sid) || (empCreatedAt.get(sid) ? new Date(empCreatedAt.get(sid)!) >= startD : false)));

      for (const p of rules.pillars) {
        if (p.type === "weekly_top") {
          // Só vendedores com ≥ eligibilityMin vendas no mês entram.
          const eligibleSellers = sellerIds.filter((sid) => (eligibleBySeller.get(sid)?.length ?? 0) >= p.eligibilityMin);
          // Agrupa as vendas elegíveis por semana.
          const byWeek = new Map<string, Map<number, number>>();
          for (const sid of eligibleSellers) {
            for (const s of eligibleBySeller.get(sid) ?? []) {
              const wk = mondayOf(s.date);
              if (!byWeek.has(wk)) byWeek.set(wk, new Map());
              byWeek.get(wk)!.set(sid, (byWeek.get(wk)!.get(sid) ?? 0) + 1);
            }
          }
          for (const [wk, counts] of byWeek) {
            const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, p.topN);
            for (const [sid, cnt] of ranked) {
              if (!rankingAwards.has(sid)) rankingAwards.set(sid, []);
              rankingAwards.get(sid)!.push({ name: p.name, amount: p.amount, count: 1, detail: `Top ${p.topN} da semana ${wk} (${cnt} vendas) · ${p.amount.toFixed(0)}€` });
            }
          }
        } else if (p.type === "rookie_best") {
          const eligibleRookies = [...rookieIds].filter((sid) => (eligibleBySeller.get(sid)?.length ?? 0) >= p.eligibilityMin);
          const ranked = eligibleRookies
            .map((sid) => ({ sid, cnt: eligibleBySeller.get(sid)?.length ?? 0 }))
            .sort((a, b) => b.cnt - a.cnt);
          if (ranked.length > 0) {
            const best = ranked[0];
            if (!rankingAwards.has(best.sid)) rankingAwards.set(best.sid, []);
            rankingAwards.get(best.sid)!.push({ name: p.name, amount: p.amount, count: 1, detail: `Melhor rookie (${best.cnt} vendas) · ${p.amount.toFixed(0)}€` });
          }
        }
      }

      const rows: IncentiveCalcRow[] = [];

      for (const [sid, slist] of bySeller) {
        const eligibleSales = slist.filter(isEligible);
        const eligibleCount = eligibleSales.length;
        const totalCount = slist.length;

        // Mix %: percentagem de vendas elegíveis com oldSupplier dentro dos suppliers-alvo
        // Segundo o documento: % de vendas EDP, SU & ED no mix
        const mixTargetSales = eligibleSales.filter((s) =>
          rules.eligibleSuppliers.length ? rules.eligibleSuppliers.includes(getSupplier(s)) : true
        );
        const mixPct = monthTotal > 0 ? (mixTargetSales.length / monthTotal) * 100 : 0;

        const pillarResults: IncentiveCalcRow["pillars"] = [];

        for (const p of rules.pillars) {
          if (p.type === "per_sale") {
            const matching = eligibleSales.filter((s) =>
              saleMatchesPillar(s.details as Record<string, string | boolean | null> | null, s.service, p as any, rules.zbrDistricts)
            );
            if (matching.length > 0) {
              pillarResults.push({
                name: p.name,
                amount: matching.length * p.amount,
                count: matching.length,
                detail: `${matching.length} × ${p.amount.toFixed(0)}€`,
              });
            }
          } else if (p.type === "tiered_mix") {
            // Determina o tier
            let tierAmount = 0;
            let tierLabel = "—";
            const sorted = [...p.tiers].sort((a, b) => a.pct - b.pct);
            for (const t of sorted) {
              if (mixPct >= t.pct) {
                tierAmount = t.amount;
                tierLabel = t.label;
              }
            }
            if (tierAmount > 0 && mixTargetSales.length > 0) {
              pillarResults.push({
                name: p.name,
                amount: mixTargetSales.length * tierAmount,
                count: mixTargetSales.length,
                detail: `${mixTargetSales.length} vendas × ${tierAmount.toFixed(0)}€ (${tierLabel}, ${mixPct.toFixed(1)}%)`,
              });
            }
          }
        }

        // Junta prémios de ranking (weekly_top / rookie_best).
        if (rankingAwards.has(sid)) pillarResults.push(...rankingAwards.get(sid)!);

        const total = pillarResults.reduce((s, p) => s + p.amount, 0);

        rows.push({
          employeeId: sid,
          employeeName: empNames.get(sid) ?? `ID ${sid}`,
          totalSales: totalCount,
          eligibleSales: eligibleCount,
          mixPct: Math.round(mixPct * 10) / 10,
          pillars: pillarResults,
          total: Math.round(total * 100) / 100,
        });
      }

      rows.sort((a, b) => b.total - a.total);

      return { month: input.month, incentiveId: inc.id, incentiveName: inc.name, rows };
    }),

  /** Guarda um cálculo (rascunho ou aprovado). */
  saveCalc: authed
    .input(z.object({ incentiveId: z.number(), month: z.string().regex(/^\d{4}-\d{2}$/), status: z.enum(["draft", "approved"]), rows: z.array(z.any()) }))
    .handler(async ({ input, context }) => {
      if (!context.permissions?.incentivos?.edit) throw new ORPCError("FORBIDDEN");
      // Upsert
      const existing = await db
        .select({ id: incentiveCalculations.id })
        .from(incentiveCalculations)
        .where(and(eq(incentiveCalculations.incentiveId, input.incentiveId), eq(incentiveCalculations.month, input.month)))
        .limit(1);

      let r: typeof incentiveCalculations.$inferSelect;
      if (existing.length) {
        const vals: Record<string, unknown> = { status: input.status, rows: input.rows };
        if (input.status === "approved") {
          vals.approvedBy = context.employeeId ?? null;
          vals.approvedAt = new Date();
        }
        [r] = await db.update(incentiveCalculations).set(vals).where(eq(incentiveCalculations.id, existing[0].id)).returning();
      } else {
        const vals: Record<string, unknown> = {
          incentiveId: input.incentiveId,
          month: input.month,
          status: input.status,
          rows: input.rows,
        };
        if (input.status === "approved") {
          vals.approvedBy = context.employeeId ?? null;
          vals.approvedAt = new Date();
        }
        [r] = await db.insert(incentiveCalculations).values(vals as any).returning();
      }
      return r;
    }),

  /** Lista os cálculos guardados. */
  listCalcs: authed
    .input(z.object({ incentiveId: z.number().optional() }))
    .handler(async ({ input, context }) => {
      if (!context.permissions?.incentivos?.view) throw new ORPCError("FORBIDDEN");
      const cond = input.incentiveId ? eq(incentiveCalculations.incentiveId, input.incentiveId) : undefined;
      return db
        .select()
        .from(incentiveCalculations)
        .where(cond)
        .orderBy(incentiveCalculations.month);
    }),

  /** Remove um cálculo guardado. */
  removeCalc: authed
    .input(z.object({ id: z.number() }))
    .handler(async ({ input, context }) => {
      if (!context.permissions?.incentivos?.edit) throw new ORPCError("FORBIDDEN");
      await db.delete(incentiveCalculations).where(eq(incentiveCalculations.id, input.id));
      return { ok: true };
    }),
};