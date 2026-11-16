/**
 * Financeiro da empresa: o que entra (autos) e o que sai (despesas e comissões).
 *
 * Alimenta as abas do Centro de Custos:
 *  - Previsão Auto  — cálculo das vendas do CRM, antes de chegar o Excel da Iberdrola
 *  - Auto Final     — valores do ficheiro da Iberdrola já carregado para o mês
 *  - Despesas       — massa salarial + frota + despesas lançadas à mão
 *  - Comissões      — o que está registado a pagar aos comerciais nesse mês
 *  - Lucro          — Auto Final (o que a Iberdrola paga) menos comissões e despesas
 *
 * A previsão e o auto final vêm dos mesmos cálculos que já alimentam a Previsão de
 * Pagamentos e os Autos Finais: aqui só se somam por rubrica, para não haver duas
 * verdades diferentes no sistema.
 */
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { requireView, requireEdit } from "../middleware/auth";
import { db } from "../database";
import { companyExpenses, employees, iberdrolaImports, payments } from "../database/schema";
import { buildBreakdown } from "./payments";
import { buildCalc } from "./iberdrola";
import { costCentersReport } from "./reports";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const month = z.string().regex(/^\d{4}-\d{2}$/, "Mês inválido.");

/** Categorias das despesas lançadas à mão. */
export const EXPENSE_CATEGORIES = ["rendas", "software", "marketing", "servicos", "impostos", "outros"] as const;

const expenseInput = z.object({
  month,
  description: z.string().trim().min(2, "Indica a descrição da despesa.").max(120, "A descrição é demasiado longa."),
  category: z.enum(EXPENSE_CATEGORIES).default("outros"),
  amount: z.number().min(0, "O valor não pode ser negativo."),
  notes: z.string().trim().max(300).nullable().optional(),
});

/** Despesas lançadas à mão num mês (ordem alfabética por categoria e descrição). */
async function manualExpenses(m: string) {
  const rows = await db.select().from(companyExpenses).where(eq(companyExpenses.month, m)).orderBy(asc(companyExpenses.category), asc(companyExpenses.description));
  const total = round2(rows.reduce((s, r) => s + (r.amount ?? 0), 0));
  return { rows, total };
}

/**
 * Tudo o que as abas do Centro de Custos precisam para um mês, num só pedido:
 * previsão, auto final, despesas, comissões e o lucro que sai daí.
 */
async function companyFinance(m: string) {
  const [breakdown, calc, costs, imports, manual, pays, staff] = await Promise.all([
    buildBreakdown(m),
    buildCalc(m),
    costCentersReport(m),
    db.select({ id: iberdrolaImports.id }).from(iberdrolaImports).where(eq(iberdrolaImports.month, m)),
    manualExpenses(m),
    db.select().from(payments).where(eq(payments.month, m)),
    db.select({ id: employees.id, name: employees.name }).from(employees),
  ]);

  const nome = new Map(staff.map((s) => [s.id, s.name] as const));

  /* ------------------------------------------------------------ previsão (CRM) */

  const forecast = {
    people: breakdown.people
      .map((p) => ({
        employeeId: p.employeeId,
        employeeName: p.employeeName,
        tableName: p.tableName,
        sales: p.totalSales,
        gross: p.gross,
        chargeback: p.chargeback,
        due: p.due,
      }))
      .sort((a, b) => b.gross - a.gross),
    totals: {
      gross: round2(breakdown.totals.gross),
      chargeback: round2(breakdown.totals.chargeback),
      due: round2(breakdown.totals.due),
      sales: breakdown.people.reduce((s, p) => s + p.totalSales, 0),
      people: breakdown.people.length,
    },
  };

  /* --------------------------------------------------------- auto final (Excel) */

  const final = {
    loaded: imports.length > 0,
    imports: imports.length,
    people: calc.people
      .map((p) => ({
        employeeId: p.employeeId,
        employeeName: p.employeeName,
        tableName: p.tableName ?? null,
        sales: p.salesCount ?? 0,
        gross: p.gross,
        chargeback: round2(p.chargebackNet ?? p.chargeback),
        medem: p.medemTotal ?? 0,
        due: p.due,
      }))
      .sort((a, b) => b.gross - a.gross),
    totals: {
      gross: round2(calc.totals.gross),
      chargeback: round2(calc.totals.chargeback),
      due: round2(calc.totals.due),
      medem: round2(calc.totals.medemTotal),
      people: calc.people.length,
    },
  };

  /* ----------------------------------------------------------------- despesas */

  const despesas = {
    payroll: round2(costs.totals.payroll),
    fleet: round2(costs.totals.fleet),
    manual: manual.total,
    rows: manual.rows,
    centres: costs.rows,
    previousMonth: costs.previousMonth,
    previousTotal: round2(costs.totals.previous),
    advances: round2(costs.totals.advances),
  };
  const totalDespesas = round2(despesas.payroll + despesas.fleet + despesas.manual);

  /* ---------------------------------------------------------------- comissões */

  const registado = round2(pays.reduce((s, p) => s + (p.amount ?? 0), 0));
  const pago = round2(pays.filter((p) => p.status === "pago").reduce((s, p) => s + (p.amount ?? 0), 0));
  const porPagar = round2(registado - pago);

  /** Uma linha por pessoa: o que o auto diz e o que está registado a pagar. */
  const porPessoa = new Map<number, { employeeId: number; employeeName: string; expected: number; registered: number; paid: number; status: string }>();
  const linha = (id: number) => {
    let r = porPessoa.get(id);
    if (!r) {
      r = { employeeId: id, employeeName: nome.get(id) ?? "—", expected: 0, registered: 0, paid: 0, status: "sem_registo" };
      porPessoa.set(id, r);
    }
    return r;
  };
  for (const p of final.people) if (p.due > 0) linha(p.employeeId).expected = round2(linha(p.employeeId).expected + p.due);
  for (const p of pays) {
    const r = linha(p.employeeId);
    r.registered = round2(r.registered + (p.amount ?? 0));
    if (p.status === "pago") r.paid = round2(r.paid + (p.amount ?? 0));
  }
  for (const r of porPessoa.values()) {
    r.status = r.registered <= 0 ? "sem_registo" : r.registered - r.paid > 0.005 ? "por_pagar" : "pago";
  }

  const commissions = {
    rows: [...porPessoa.values()].sort((a, b) => b.expected - a.expected || b.registered - a.registered),
    registered: registado,
    paid: pago,
    pending: porPagar,
    expected: final.totals.due,
    forecastExpected: forecast.totals.due,
    records: pays
      .map((p) => ({ id: p.id, employeeName: nome.get(p.employeeId) ?? "—", kind: p.kind, amount: p.amount, status: p.status, paidOn: p.paidOn }))
      .sort((a, b) => (a.employeeName > b.employeeName ? 1 : -1)),
  };

  /* -------------------------------------------------------------------- lucro */

  // Receita: o que a Iberdrola paga (auto final). Sem Excel do mês, usa-se a previsão
  // do CRM e diz-se que é previsão — nunca se apresenta uma previsão como final.
  const revenue = final.loaded ? final.totals.gross : forecast.totals.gross;
  const revenueSource = final.loaded ? "final" : "previsao";
  // Comissões: o registado no mês; se ainda não há autos lançados, o que o auto manda pagar.
  const commissionsUsed = registado > 0 ? registado : revenueSource === "final" ? final.totals.due : forecast.totals.due;
  const commissionsSource = registado > 0 ? "registado" : revenueSource === "final" ? "auto" : "previsao";
  const profit = round2(revenue - commissionsUsed - totalDespesas);

  const result = {
    month: m,
    forecast,
    final,
    expenses: { ...despesas, total: despesas.manual, monthTotal: totalDespesas },
    commissions,
    profit: {
      revenue,
      revenueSource,
      commissions: commissionsUsed,
      commissionsSource,
      expenses: totalDespesas,
      value: profit,
      margin: revenue > 0 ? profit / revenue : null,
      // O mesmo cálculo com a previsão do CRM, para se ver o que muda se o Excel não vier igual.
      forecastProfit: round2(forecast.totals.gross - (registado > 0 ? registado : forecast.totals.due) - totalDespesas),
    },
  };

  return result;
}

export const companyRoute = {
  /** Números das cinco abas do Centro de Custos para um mês. */
  finance: requireView("empresa")
    .input(z.object({ month }))
    .handler(async ({ input }) => companyFinance(input.month)),

  /** Despesas lançadas à mão de um mês. */
  expenses: requireView("empresa")
    .input(z.object({ month }))
    .handler(async ({ input }) => manualExpenses(input.month)),

  expenseCreate: requireEdit("empresa")
    .input(expenseInput)
    .handler(async ({ input }) => {
      const [row] = await db
        .insert(companyExpenses)
        .values({ month: input.month, description: input.description, category: input.category, amount: round2(input.amount), notes: input.notes || null })
        .returning();
      return row;
    }),

  expenseUpdate: requireEdit("empresa")
    .input(expenseInput.extend({ id: z.number().int().positive() }))
    .handler(async ({ input }) => {
      const { id, ...data } = input;
      await db
        .update(companyExpenses)
        .set({ month: data.month, description: data.description, category: data.category, amount: round2(data.amount), notes: data.notes || null })
        .where(eq(companyExpenses.id, id));
      return { ok: true };
    }),

  expenseRemove: requireEdit("empresa")
    .input(z.object({ id: z.number().int().positive() }))
    .handler(async ({ input }) => {
      await db.delete(companyExpenses).where(eq(companyExpenses.id, input.id));
      return { ok: true };
    }),
};
