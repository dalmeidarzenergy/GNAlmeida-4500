export type Collaborator = {
  id: string;
  name: string;
  days: string;
  daily: string;
  commission: string;
  d2d: string;
};

export type MonthlyPlan = { rows: Collaborator[]; expenses: string; vatRate: string; deductVat: boolean };

export const planFields = [
  ["name", "Colaborador"], ["days", "Dias úteis"], ["daily", "Vendas diárias"],
  ["sales", "Total vendas"], ["commission", "Comissão por venda"], ["payout", "A pagar (comissão)"],
  ["d2d", "Valor D2D por venda"], ["revenue", "Total D2D"], ["profit", "Lucro D2D"],
] as const;

const currency = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", useGrouping: "always" });
const number = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 6, useGrouping: "always" });
export const formatPlanMoney = (value: number) => currency.format(Math.abs(value) < 0.005 ? 0 : value);
export const formatPlanNumber = (value: number) => number.format(value);
export const isPlanLoss = (value: number) => value <= -0.005;

export function newCollaborator(id: string): Collaborator {
  return { id, name: "", days: "20", daily: "2", commission: "30", d2d: "50" };
}

export function initialPlan(): MonthlyPlan {
  return {
    rows: [
      { ...newCollaborator("example-1"), name: "Diogo Almeida" },
      { ...newCollaborator("example-2"), name: "Tiago Costa", commission: "40" },
    ],
    expenses: "400",
    vatRate: "23",
    deductVat: false,
  };
}

export function parseAmount(raw: string): number {
  const input = raw.trim();
  if (!/^[+-]?(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)(?:[.,]\d*)?$|^[+-]?[.,]\d+$/.test(input)) return 0;
  const value = Number(input.replace(/[ \u00a0\u202f]/g, "").replace(",", "."));
  return Number.isFinite(value) ? value : 0;
}

export function calculatePlan(plan: MonthlyPlan) {
  const rows = plan.rows.map((row) => {
    const daily = parseAmount(row.daily);
    const sales = parseAmount(row.days) * daily;
    const commission = parseAmount(row.commission);
    const d2d = parseAmount(row.d2d);
    const payout = sales * commission;
    const revenue = sales * d2d;
    return { daily, sales, commission, payout, d2d, revenue, profit: revenue - payout };
  });
  const totals = rows.reduce((s, r) => ({
    daily: s.daily + r.daily, sales: s.sales + r.sales,
    commission: s.commission + r.commission, payout: s.payout + r.payout,
    d2d: s.d2d + r.d2d, revenue: s.revenue + r.revenue, profit: s.profit + r.profit,
  }), { daily: 0, sales: 0, commission: 0, payout: 0, d2d: 0, revenue: 0, profit: 0 });
  const expenses = parseAmount(plan.expenses);
  const afterExpenses = totals.revenue - expenses;
  const vatRate = parseAmount(plan.vatRate);
  const vat = plan.deductVat ? afterExpenses * (vatRate / 100) : 0;
  const afterVat = afterExpenses - vat;
  return { rows, totals, expenses, afterExpenses, vatRate, vat, afterVat, finalProfit: afterVat - totals.payout };
}

export function planSummary(data: ReturnType<typeof calculatePlan>, deductVat: boolean): { label: string; value: string; result?: number }[] {
  return [
    { label: "Total de vendas", value: formatPlanNumber(data.totals.sales) },
    { label: "Total a pagar em comissões", value: formatPlanMoney(data.totals.payout) },
    { label: "Total faturado D2D", value: formatPlanMoney(data.totals.revenue) },
    { label: "Despesas", value: formatPlanMoney(data.expenses) },
    { label: "Faturado menos despesas", value: formatPlanMoney(data.afterExpenses) },
    ...(deductVat ? [{ label: `IVA a descontar (${formatPlanNumber(data.vatRate)}%)`, value: formatPlanMoney(data.vat) }] : []),
    { label: "Faturado menos despesas e IVA", value: formatPlanMoney(data.afterVat) },
    { label: "Lucro final (após comissões)", value: formatPlanMoney(data.finalProfit), result: data.finalProfit },
  ];
}