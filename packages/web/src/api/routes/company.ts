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
import { ORPCError } from "@orpc/server";
import { requireView, requireEdit } from "../middleware/auth";
import { db } from "../database";
import { commissionTables, companyExpenses, companySettings, employees, iberdrolaImports, payments } from "../database/schema";
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

/** Chave da definição com a tabela comissional que a empresa aplica. */
const COMPANY_TABLE_KEY = "commission_table";

/** Uma tabela pode valorizar as vendas da empresa: RES+BTN NEG, ou a Tabela Empresa. */
function isSalesTable(t: { group: string; regime: string }) {
  return t.regime === "RES+BTN NEG" || (t.group === "empresa" && !["MEDEM", "SOLAR", "CE"].includes(t.regime));
}

/**
 * Tabela Comissao da empresa: uma só para a empresa toda, usada até ser mudada no
 * Centro de Custos. Por omissão é a Tabela Empresa (o grupo "empresa" das Tabelas
 * Comissionais, que é a tabela que paga a própria empresa); se não houver nenhuma,
 * a empresa fica sem tabela e cada comercial usa a sua.
 */
async function companyCommissionTable(): Promise<{ id: number; name: string; regime: string; isDefault: boolean } | null> {
  const [row] = await db.select().from(companySettings).where(eq(companySettings.key, COMPANY_TABLE_KEY));
  const id = row?.value ? Number(row.value) : NaN;
  if (Number.isFinite(id) && id > 0) {
    const [t] = await db
      .select({ id: commissionTables.id, name: commissionTables.name, regime: commissionTables.regime, group: commissionTables.group })
      .from(commissionTables)
      .where(eq(commissionTables.id, id));
    if (t && isSalesTable(t)) return { id: t.id, name: t.name, regime: t.regime, isDefault: false };
  }
  // Sem escolha guardada: a Tabela Empresa ativa (a primeira criada).
  const empresas = await db
    .select({ id: commissionTables.id, name: commissionTables.name, regime: commissionTables.regime, group: commissionTables.group, active: commissionTables.active })
    .from(commissionTables)
    .where(eq(commissionTables.group, "empresa"))
    .orderBy(asc(commissionTables.id));
  const empresa = empresas.find((t) => t.active && isSalesTable(t)) ?? empresas.find((t) => isSalesTable(t)) ?? null;
  return empresa ? { id: empresa.id, name: empresa.name, regime: empresa.regime, isDefault: true } : null;
}

/** Guarda (ou limpa, com null) a tabela comissional aplicada pela empresa. */
async function saveCompanyCommissionTable(id: number | null) {
  if (id == null) {
    await db.delete(companySettings).where(eq(companySettings.key, COMPANY_TABLE_KEY));
    return { ok: true };
  }
  const [t] = await db.select({ id: commissionTables.id, regime: commissionTables.regime, group: commissionTables.group }).from(commissionTables).where(eq(commissionTables.id, id));
  if (!t) throw new ORPCError("BAD_REQUEST", { message: "A tabela escolhida não existe." });
  if (!isSalesTable(t)) throw new ORPCError("BAD_REQUEST", { message: "Só as tabelas de vendas (RES+BTN NEG) podem ser aplicadas à empresa." });
  const [existing] = await db.select().from(companySettings).where(eq(companySettings.key, COMPANY_TABLE_KEY));
  if (existing) {
    await db.update(companySettings).set({ value: String(id), updatedAt: new Date() }).where(eq(companySettings.key, COMPANY_TABLE_KEY));
  } else {
    await db.insert(companySettings).values({ key: COMPANY_TABLE_KEY, value: String(id), updatedAt: new Date() });
  }
  return { ok: true };
}

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
  // Previsão e auto final são valorizados pela tabela comissional da empresa (por
  // omissão, a Tabela Empresa), para todos os comerciais. Só sem tabela nenhuma é que
  // cada um usa a sua, como em Pagamentos.
  const applied = await companyCommissionTable();
  const companyTableId = applied?.id ?? null;

  const [breakdown, calc, costs, imports, manual, paysAll, staff] = await Promise.all([
    buildBreakdown(m, { companyTableId, d2dOnly: true }),
    buildCalc(m, { companyTableId, d2dOnly: true }),
    costCentersReport(m, { d2dOnly: true }),
    db.select({ id: iberdrolaImports.id }).from(iberdrolaImports).where(eq(iberdrolaImports.month, m)),
    manualExpenses(m),
    db.select().from(payments).where(eq(payments.month, m)),
    db
      .select({ id: employees.id, name: employees.name, d2dConsulting: employees.d2dConsulting })
      .from(employees),
  ]);

  const nome = new Map(staff.map((s) => [s.id, s.name] as const));
  /** Funcionários com a caixa "Funcionário D2D Consulting" ligada: os únicos que contam aqui. */
  const staffD2D = new Set(staff.filter((s) => s.d2dConsulting).map((s) => s.id));
  /** Pagamentos registados: só os de quem conta para o Centro de Custos. */
  const pays = paysAll.filter((p) => staffD2D.has(p.employeeId));

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
        // Nunca "a pagar" negativo: sem comissão apurada não há nada a receber
        // (as penalizações de 10 € por venda só descontam de valores reais).
        due: Math.max(0, round2(p.due)),
      }))
      .sort((a, b) => b.gross - a.gross),
    totals: {
      gross: round2(breakdown.totals.gross),
      chargeback: round2(breakdown.totals.chargeback),
      due: round2(breakdown.people.reduce((s, p) => s + Math.max(0, p.due), 0)),
      sales: breakdown.people.reduce((s, p) => s + p.totalSales, 0),
      people: breakdown.people.length,
    },
  };

  /* ------------------------------------------- quem fica fora do Centro de Custos */

  // Funcionários sem a caixa "Funcionário D2D Consulting": as vendas deles não entram
  // no Centro de Custos. Mostram-se à parte para não parecer que faltam pessoas.
  const foraD2D = staff.filter((s) => !s.d2dConsulting);
  let excluded: { employeeId: number; employeeName: string; sales: number; gross: number }[] = [];
  if (foraD2D.length) {
    const everything = await buildBreakdown(m, { companyTableId });
    const dentro = new Set(breakdown.people.map((p) => p.employeeId));
    excluded = everything.people
      .filter((p) => !dentro.has(p.employeeId))
      .map((p) => ({ employeeId: p.employeeId, employeeName: p.employeeName, sales: p.totalSales, gross: round2(p.gross) }))
      .sort((a, b) => b.sales - a.sales);
  }

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

  // Previsão do lucro: a mesma conta, mas com a receita e as comissões do CRM (ainda
  // sem o Excel da Iberdrola). As despesas são as do mês — já conhecidas.
  const forecastCommissions = registado > 0 ? registado : forecast.totals.due;
  const forecastProfitValue = round2(forecast.totals.gross - forecastCommissions - totalDespesas);

  const result = {
    month: m,
    /** Tabela comissional aplicada pela empresa (null = cada comercial usa a sua). */
    companyTable: applied,
    forecast,
    final,
    /** Funcionários com a caixa D2D desligada e vendas no mês (ficam fora do Centro de Custos). */
    excluded,
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
      forecastProfit: forecastProfitValue,
      /** A conta do lucro feita só com a previsão do CRM (aba "Previsão Lucro de Empresa"). */
      forecast: {
        revenue: round2(forecast.totals.gross),
        commissions: round2(forecastCommissions),
        commissionsSource: registado > 0 ? "registado" : "previsao",
        expenses: totalDespesas,
        value: forecastProfitValue,
        margin: forecast.totals.gross > 0 ? forecastProfitValue / forecast.totals.gross : null,
        sales: forecast.totals.sales,
        people: forecast.totals.people,
        chargeback: round2(forecast.totals.chargeback),
      },
    },
  };

  return result;
}

export const companyRoute = {
  /** Números das cinco abas do Centro de Custos para um mês. */
  finance: requireView("empresa")
    .input(z.object({ month }))
    .handler(async ({ input }) => companyFinance(input.month)),

  /** Tabela comissional aplicada pela empresa (a que valoriza a previsão e o auto final). */
  commissionTableGet: requireView("empresa").handler(async () => companyCommissionTable()),

  commissionTableSet: requireEdit("empresa")
    .input(z.object({ tableId: z.number().int().positive().nullable() }))
    .handler(async ({ input }) => saveCompanyCommissionTable(input.tableId)),

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
