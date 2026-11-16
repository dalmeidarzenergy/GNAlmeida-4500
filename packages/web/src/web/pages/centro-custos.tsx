/**
 * Página "Centro de Custos": quanto custa a empresa, por centro de custo, num mês.
 *
 * Cada departamento é um centro de custo. As rubricas somam-se por departamento:
 *  - massa salarial: salário base das pessoas que estão na empresa nesse mês
 *  - comissões e pagamentos: o que foi pago a cada pessoa (pelo departamento dela)
 *  - adiantamentos
 *  - frota: combustível, portagens e manutenções das viaturas do departamento
 *
 * O que não tem departamento associado cai num centro de custo próprio ("Sem
 * departamento"), para o total nunca perder dinheiro pelo caminho. A coluna final
 * compara com o mês anterior, para se ver o que subiu e o que desceu.
 */
import { useMemo, useState } from "react";
import { Search, Wallet, Users, TrendingUp, Fuel } from "lucide-react";
import { PageHeader, Stat, Empty } from "../components/ui/kit";
import { useCostCenters } from "../queries/reports";
import { fmtEur } from "../lib/format";

function pad(v: number) {
  return v < 10 ? "0" + v : "" + v;
}

function todayLisbon() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" });
}

/** "2026-11" -> "Novembro 2026" */
function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  const names = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  return names[Number(m) - 1] + " " + y;
}

function parseYM(ym: string) {
  const [yy, mm] = ym.split("-");
  return { y: Number(yy), m: Number(mm) };
}

/** Mês ym recuado de n meses ("2026-11", 1 -> "2026-10"). */
function monthsAgo(ym: string, n: number) {
  const { y, m } = parseYM(ym);
  const d = new Date(y, m - 1 - n, 1);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1);
}

/** Janela rolante de meses, do mais recente para o mais antigo. */
function monthOptions(count: number) {
  const now = todayLisbon().slice(0, 7);
  const { y, m } = parseYM(now);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(y, m - 1 - i, 1);
    out.push(d.getFullYear() + "-" + pad(d.getMonth() + 1));
  }
  return out;
}

export default function CentroCustosPage() {
  const months = useMemo(() => monthOptions(24), []);
  const [month, setMonth] = useState(() => todayLisbon().slice(0, 7));
  const [q, setQ] = useState("");
  const costs = useCostCenters(month);

  const costData = costs.data;
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const all = costData?.rows ?? [];
    return s ? all.filter((c) => c.name.toLowerCase().includes(s)) : all;
  }, [costData, q]);

  const totals = costData?.totals ?? {
    count: 0,
    payroll: 0,
    commissions: 0,
    advances: 0,
    fleet: 0,
    total: 0,
    previous: 0,
    delta: 0,
    deltaPct: null as number | null,
  };
  const monthBefore = costData?.previousMonth ?? monthsAgo(month, 1);
  const delta = totals.previous > 0 || totals.delta !== 0 ? { delta: totals.delta, label: `${totals.delta > 0 ? "+" : ""}${fmtEur(totals.delta)}` } : null;

  return (
    <>
      <PageHeader
        eyebrow="GESTÃO DE EMPRESA"
        title="Centro de Custos"
        subtitle="Quanto a empresa gasta por centro de custo em cada mês: massa salarial, comissões e pagamentos, adiantamentos e frota, com comparação ao mês anterior."
      />

      <div className="card rise mb-5 flex flex-wrap items-end gap-3 p-4">
        <label className="flex flex-col gap-1">
          <span className="label-mono">Mês de referência</span>
          <select className="input w-52" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Mês de referência">
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
                {m === todayLisbon().slice(0, 7) ? " (atual)" : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="flex min-w-[180px] flex-1 flex-col gap-1">
          <span className="label-mono">Procurar</span>
          <span className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input className="input pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Centro de custo…" aria-label="Procurar centro de custo" />
          </span>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Total do mês"
          value={fmtEur(totals.total)}
          sub={delta ? `${delta.label} vs ${monthLabel(monthBefore)}` : "sem mês anterior para comparar"}
          icon={<Wallet size={15} />}
          delay={0}
        />
        <Stat label="Massa salarial" value={fmtEur(totals.payroll)} sub="salário base das pessoas no mês" icon={<Users size={15} />} accent="var(--sky)" delay={40} />
        <Stat
          label="Comissões e pagamentos"
          value={fmtEur(totals.commissions)}
          sub={`${fmtEur(totals.advances)} em adiantamentos`}
          icon={<TrendingUp size={15} />}
          accent="var(--amber)"
          delay={80}
        />
        <Stat label="Frota" value={fmtEur(totals.fleet)} sub="combustível, portagens e manutenções" icon={<Fuel size={15} />} accent="var(--rose)" delay={120} />
      </div>

      <div className="card rise mt-6 overflow-hidden" style={{ animationDelay: "160ms" }}>
        {costs.isLoading ? (
          <div className="px-6 py-16 text-center text-[13px] text-ink-3">A carregar…</div>
        ) : !rows.length ? (
          <Empty
            title={q ? "Nenhum centro de custo neste filtro" : "Sem custos neste mês"}
            text={
              q
                ? "Não há centros de custo com esse nome."
                : `Não há salários, pagamentos, adiantamentos ou custos de frota registados em ${monthLabel(month)}.`
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-left text-ink-3">
                  <th className="label-mono px-4 py-3 font-normal">Centro de custo</th>
                  <th className="label-mono px-4 py-3 text-right font-normal">Pessoas</th>
                  <th className="label-mono px-4 py-3 text-right font-normal">Massa salarial</th>
                  <th className="label-mono px-4 py-3 text-right font-normal">Comissões</th>
                  <th className="label-mono px-4 py-3 text-right font-normal">Adiantamentos</th>
                  <th className="label-mono px-4 py-3 text-right font-normal">Frota</th>
                  <th className="label-mono px-4 py-3 text-right font-normal">Total do mês</th>
                  <th className="label-mono px-4 py-3 text-right font-normal">vs {monthLabel(monthBefore)}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.name} className="border-b border-line last:border-b-0 hover:bg-surface-2/60">
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-2 font-medium">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c.color }} />
                        {c.name}
                      </span>
                      {c.isBucket && <div className="text-[11.5px] text-ink-3">pessoas e custos sem departamento associado</div>}
                    </td>
                    <td className="num px-4 py-2.5 text-right text-ink-2">{c.count}</td>
                    <td className="num px-4 py-2.5 text-right text-ink-2">{fmtEur(c.payroll)}</td>
                    <td className="num px-4 py-2.5 text-right text-ink-2">{c.commissions ? fmtEur(c.commissions) : <span className="text-ink-3">—</span>}</td>
                    <td className="num px-4 py-2.5 text-right text-ink-2">{c.advances ? fmtEur(c.advances) : <span className="text-ink-3">—</span>}</td>
                    <td className="num px-4 py-2.5 text-right text-ink-2">{c.fleet ? fmtEur(c.fleet) : <span className="text-ink-3">—</span>}</td>
                    <td className="num px-4 py-2.5 text-right font-semibold">{fmtEur(c.total)}</td>
                    <td className="num px-4 py-2.5 text-right">
                      {c.delta === 0 ? (
                        <span className="text-ink-3">—</span>
                      ) : (
                        <span className={c.delta > 0 ? "text-rose" : "text-volt"}>
                          {c.delta > 0 ? "+" : ""}
                          {fmtEur(c.delta)}
                          {c.deltaPct != null && (
                            <span className="ml-1 text-[11px] opacity-70">
                              ({c.deltaPct > 0 ? "+" : ""}
                              {(c.deltaPct * 100).toFixed(0)}%)
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-surface-2/40">
                  <td className="px-4 py-3 font-semibold">Total</td>
                  <td className="num px-4 py-3 text-right font-semibold">{totals.count}</td>
                  <td className="num px-4 py-3 text-right font-semibold">{fmtEur(totals.payroll)}</td>
                  <td className="num px-4 py-3 text-right font-semibold">{fmtEur(totals.commissions)}</td>
                  <td className="num px-4 py-3 text-right font-semibold">{fmtEur(totals.advances)}</td>
                  <td className="num px-4 py-3 text-right font-semibold">{fmtEur(totals.fleet)}</td>
                  <td className="num px-4 py-3 text-right font-semibold text-volt">{fmtEur(totals.total)}</td>
                  <td className="num px-4 py-3 text-right font-semibold">
                    {delta ? (
                      <span className={delta.delta > 0 ? "text-rose" : "text-volt"}>
                        {delta.delta > 0 ? "+" : ""}
                        {fmtEur(delta.delta)}
                      </span>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
