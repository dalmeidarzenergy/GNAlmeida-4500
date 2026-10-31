import { z } from "zod";
import { asc, desc, eq, and, sql } from "drizzle-orm";
import { requireView, requireEdit } from "../middleware/auth";
import { db } from "../database";
import { advances, advanceDeductions, employees } from "../database/schema";

const round2 = (n: number) => Math.round(n * 100) / 100;
const month = z.string().regex(/^\d{4}-\d{2}$/, "Mês inválido.");

const advanceInput = z.object({
  employeeId: z.number().int().positive(),
  date: z.string().min(1, "Indica a data do adiantamento."),
  amount: z.number().positive("O valor tem de ser maior que 0 €."),
  repaid: z.number().min(0).optional(),
  note: z.string().trim().max(300).optional(),
  settled: z.boolean().optional(),
});

/** Saldo pendente por colaborador: soma dos adiantamentos menos as devoluções e os descontos. */
async function balanceByEmployee() {
  const list = await db.select().from(advances);
  const deds = await db.select().from(advanceDeductions);
  const map = new Map<number, { pending: number; total: number; repaid: number; deducted: number }>();
  for (const a of list) {
    const row = map.get(a.employeeId) ?? { pending: 0, total: 0, repaid: 0, deducted: 0 };
    row.total = round2(row.total + a.amount);
    row.repaid = round2(row.repaid + a.repaid);
    map.set(a.employeeId, row);
  }
  for (const d of deds) {
    const row = map.get(d.employeeId) ?? { pending: 0, total: 0, repaid: 0, deducted: 0 };
    row.deducted = round2(row.deducted + d.amount);
    map.set(d.employeeId, row);
  }
  for (const [id, row] of map) {
    row.pending = round2(Math.max(0, row.total - row.repaid - row.deducted));
    map.set(id, row);
  }
  return map;
}

export const advancesRoute = {
  /** Lista os adiantamentos com o saldo de cada colaborador (só quem tem acesso a Adiantamentos). */
  list: requireView("adiantamentos").handler(async () => {
    const list = await db
      .select({
        id: advances.id,
        employeeId: advances.employeeId,
        employeeName: employees.name,
        date: advances.date,
        amount: advances.amount,
        repaid: advances.repaid,
        note: advances.note,
        settled: advances.settled,
        createdAt: advances.createdAt,
      })
      .from(advances)
      .leftJoin(employees, eq(employees.id, advances.employeeId))
      .orderBy(desc(advances.date), desc(advances.id));

    const deds = await db.select().from(advanceDeductions).orderBy(desc(advanceDeductions.month));
    const byAdvance = new Map<number, number>();
    const byEmployee = new Map<number, number>();
    for (const d of deds) {
      if (d.advanceId) byAdvance.set(d.advanceId, round2((byAdvance.get(d.advanceId) ?? 0) + d.amount));
      byEmployee.set(d.employeeId, round2((byEmployee.get(d.employeeId) ?? 0) + d.amount));
    }

    const rows = list.map((a) => {
      const deducted = byAdvance.get(a.id) ?? 0;
      return {
        ...a,
        employeeName: a.employeeName ?? "—",
        deducted,
        remaining: round2(Math.max(0, a.amount - a.repaid - deducted)),
      };
    });

    const balances = [...byEmployee.entries()].map(([employeeId, deducted]) => ({ employeeId, deducted }));

    return {
      rows,
      balances,
      totals: {
        lent: round2(rows.reduce((s, r) => s + r.amount, 0)),
        repaid: round2(rows.reduce((s, r) => s + r.repaid, 0)),
        deducted: round2(rows.reduce((s, r) => s + r.deducted, 0)),
        pending: round2(rows.reduce((s, r) => s + r.remaining, 0)),
      },
    };
  }),

  /** Saldo pendente de um colaborador (usado pelo botão "Verificar Adiantamento"). */
  balance: requireView("auto-iberdrola")
    .input(z.object({ employeeId: z.number().int().positive(), month }))
    .handler(async ({ input }) => {
      const map = await balanceByEmployee();
      const row = map.get(input.employeeId);
      const deductedThisMonth = await db
        .select({ total: sql<number>`coalesce(sum(${advanceDeductions.amount}), 0)` })
        .from(advanceDeductions)
        .where(and(eq(advanceDeductions.employeeId, input.employeeId), eq(advanceDeductions.month, input.month)));
      return {
        pending: row?.pending ?? 0,
        total: row?.total ?? 0,
        repaid: row?.repaid ?? 0,
        deducted: row?.deducted ?? 0,
        deductedThisMonth: round2(Number(deductedThisMonth[0]?.total ?? 0)),
      };
    }),

  create: requireEdit("adiantamentos")
    .input(advanceInput)
    .handler(async ({ input, context }) => {
      const [emp] = await db.select({ id: employees.id }).from(employees).where(eq(employees.id, input.employeeId));
      if (!emp) return { ok: false as const, reason: "employee_not_found" as const };
      const [row] = await db
        .insert(advances)
        .values({
          employeeId: input.employeeId,
          date: input.date,
          amount: input.amount,
          repaid: input.repaid ?? 0,
          note: input.note ?? null,
          settled: input.settled ?? false,
          createdBy: context.employeeId,
        })
        .returning();
      return { ok: true as const, advance: row };
    }),

  update: requireEdit("adiantamentos")
    .input(advanceInput.extend({ id: z.number().int().positive() }))
    .handler(async ({ input }) => {
      const { id, ...data } = input;
      await db
        .update(advances)
        .set({
          employeeId: data.employeeId,
          date: data.date,
          amount: data.amount,
          repaid: data.repaid ?? 0,
          note: data.note ?? null,
          settled: data.settled ?? false,
        })
        .where(eq(advances.id, id));
      return { ok: true as const };
    }),

  remove: requireEdit("adiantamentos")
    .input(z.object({ id: z.number().int().positive() }))
    .handler(async ({ input }) => {
      await db.delete(advances).where(eq(advances.id, input.id));
      return { ok: true as const };
    }),

  /** Regista um desconto mensal à mão (ex.: corte combinado fora do auto). */
  deduct: requireEdit("adiantamentos")
    .input(z.object({ employeeId: z.number().int().positive(), month, amount: z.number().positive("O valor tem de ser maior que 0 €."), note: z.string().trim().max(300).optional() }))
    .handler(async ({ input, context }) => {
      const [row] = await db
        .insert(advanceDeductions)
        .values({
          month: input.month,
          employeeId: input.employeeId,
          amount: input.amount,
          source: "manual",
          note: input.note ?? null,
          createdBy: context.employeeId,
        })
        .returning();
      return { ok: true as const, deduction: row };
    }),

  /** Lista os descontos de adiantamento de um mês (detalhe para o painel do auto). */
  deductions: requireView("auto-iberdrola")
    .input(z.object({ month }))
    .handler(async ({ input }) => {
      const rows = await db
        .select({
          id: advanceDeductions.id,
          employeeId: advanceDeductions.employeeId,
          employeeName: employees.name,
          advanceId: advanceDeductions.advanceId,
          amount: advanceDeductions.amount,
          source: advanceDeductions.source,
          note: advanceDeductions.note,
        })
        .from(advanceDeductions)
        .leftJoin(employees, eq(employees.id, advanceDeductions.employeeId))
        .where(eq(advanceDeductions.month, input.month))
        .orderBy(asc(advanceDeductions.id));
      return rows.map((r) => ({ ...r, employeeName: r.employeeName ?? "—" }));
    }),

  removeDeduction: requireEdit("auto-iberdrola")
    .input(z.object({ id: z.number().int().positive() }))
    .handler(async ({ input }) => {
      await db.delete(advanceDeductions).where(eq(advanceDeductions.id, input.id));
      return { ok: true as const };
    }),
};
