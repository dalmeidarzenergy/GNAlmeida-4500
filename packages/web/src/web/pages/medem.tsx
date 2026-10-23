import { useState } from "react";
import { Download } from "lucide-react";
import { useMedemReport } from "../queries/reports";
import { useMe } from "../queries/me";
import { PageHeader, Tabs, Stat, Progress, Empty } from "../components/ui/kit";
import { TrendChart, BarsChart, Donut } from "../components/charts";
import { fmtMonth, monthLabel, thisMonth } from "../lib/format";
import { MonthYearFilter } from "../components/month-year-filter";
import { EmployeeFilter } from "../components/employee-filter";
import { TeamFilter, useTeamIds } from "../components/team-filter";
import { PlaceFilter, type Place } from "../components/place-filter";
import { SALE_STATUS } from "../lib/labels";

const TIPO_COLORS = ["#c6f432", "#38bdf8", "#f472b6", "#f5a524", "#a78bfa", "#34d399"];
const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);

function downloadCsv(name: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

function Rows({ items, colors, showShare = true }: { items: { name: string; count: number; share?: number; counted?: number }[]; colors: string[]; showShare?: boolean }) {
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <div className="space-y-2.5">
      {items.map((x, i) => (
        <div key={x.name}>
          <div className="mb-1 flex items-center justify-between gap-2 text-[12.5px]">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colors[i % colors.length] }} />
              <span className="truncate">{x.name}</span>
            </span>
            <span className="num shrink-0 text-ink-2">
              {showShare && x.share != null && <span className="font-semibold text-ink">{pct(x.share)} · </span>}
              {x.count}
              {x.counted ? <span className="text-volt"> · {x.counted} em fornec.</span> : null}
            </span>
          </div>
          <Progress value={x.count / max} color={colors[i % colors.length]} />
        </div>
      ))}
    </div>
  );
}

export default function MedemPage() {
  const me = useMe();
  const isAdmin = me.data?.role === "admin" || me.data?.role === "rh";
  const [month, setMonth] = useState(thisMonth());
  const [months, setMonths] = useState<"1" | "3" | "6" | "12" | "0">("1");
  const [seller, setSeller] = useState<number | null>(null);
  const [team, setTeam] = useState<number | null>(null);
  const [place, setPlace] = useState<Place>({ district: "", municipality: "" });
  const teamIds = useTeamIds(team, month);
  const r = useMedemReport(Number(months), month, isAdmin ? seller : null, isAdmin ? team : null, place);
  const d = r.data;

  const period = months === "0" ? `Todos os meses até ${monthLabel(month)}` : months === "1" ? monthLabel(month) : `${months} meses até ${monthLabel(month)}`;

  return (
    <div>
      <PageHeader eyebrow="Análise" title="MEDEM">
        {isAdmin && <TeamFilter value={team} onChange={setTeam} />}
        {isAdmin && <EmployeeFilter month={month} value={seller} onChange={setSeller} onlyIds={teamIds} />}
        <MonthYearFilter value={month} onChange={setMonth} />
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={months} onChange={setMonths} items={[{ key: "1", label: "Só o mês" }, { key: "3", label: "3 meses" }, { key: "6", label: "6 meses" }, { key: "12", label: "12 meses" }, { key: "0", label: "Todos" }]} />
          <PlaceFilter value={place} onChange={setPlace} />
          <span className="text-[12.5px] text-ink-3">{period}</span>
        </div>
        {d && (
          <button className="btn btn-ghost" onClick={() => downloadCsv(`medem-${month}.csv`, [["Métrica", "Valor"], ["Em Fornecimento", d.orders], ["Vendas registadas", d.byStatus.reduce((s, x) => s + x.count, 0)], ["Total de consumo (MWh)", d.totalConsumption], ["Crédito", d.totalCredit], [], ["Tipo", "Vendas", "%"], ...d.byTipo.map((x) => [x.name, x.count, Math.round((x.share ?? 0) * 100)]), [], ["Estado da Proposta", "Vendas", "%"], ...d.byProposalStatus.map((x) => [x.name, x.count, Math.round((x.share ?? 0) * 100)]), [], ["Vendedor", "Vendas"], ...d.bySeller.map((s) => [s.name, s.orders]), [], ["Vendedor", "Consumo (MWh)"], ...d.bySellerConsumption.map((s) => [s.name, s.consumption])])}>
            <Download size={14} /> Exportar CSV
          </button>
        )}
      </div>

      {r.isLoading || !d ? (
        <div className="skeleton h-96 rounded-[14px]" />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Stat label="Em fornecimento" value={d.orders} accent="var(--volt)" />
            <Stat delay={40} label="Vendas registadas" value={d.byStatus.reduce((s, x) => s + x.count, 0)} sub={d.byStatus.length ? `${d.byStatus.length} estados` : "sem registos"} accent="var(--sky)" />
            <Stat delay={80} label="Total de consumo" value={`${d.totalConsumption.toLocaleString("pt-PT")} MWh`} sub={d.consumptionCount ? `${d.consumptionCount} vendas com consumo` : "sem consumo registado"} accent="var(--volt)" />
            <Stat delay={120} label="Crédito" value={d.totalCredit.toLocaleString("pt-PT")} sub="total acumulado" accent="var(--rose)" />
          </div>

          <div className="mb-4 grid gap-4 xl:grid-cols-2">
            <div className="card rise p-5">
              <div className="label-mono mb-1">Tipo · {period}</div>
              <div className="mb-4 font-display text-[16px] font-semibold">Vendas por tipo de proposta</div>
              {!d.byTipo.length ? (
                <Empty title="Sem vendas MEDEM no período" />
              ) : (
                <div className="grid items-center gap-6 lg:grid-cols-[220px_1fr]">
                  <Donut data={d.byTipo.map((x, i) => ({ name: x.name, value: x.count, color: TIPO_COLORS[i % TIPO_COLORS.length] }))} />
                  <Rows items={d.byTipo} colors={TIPO_COLORS} />
                </div>
              )}
            </div>
            <div className="card rise p-5">
              <div className="label-mono mb-1">Proposta · {period}</div>
              <div className="mb-4 font-display text-[16px] font-semibold">Estado da proposta</div>
              {!d.byProposalStatus.length ? <Empty title="Sem propostas no período" /> : <Rows items={d.byProposalStatus} colors={TIPO_COLORS} />}
            </div>
          </div>

          <div className="card rise mb-4 p-5">
            <div className="label-mono mb-1">Evolução · {period}</div>
            <div className="mb-4 font-display text-[16px] font-semibold">Vendas MEDEM por mês</div>
            <TrendChart data={d.byMonth} dataKey="orders" money={false} />
          </div>

          <div className="mb-4 grid gap-4 xl:grid-cols-2">
            <div className="card rise p-5">
              <div className="label-mono mb-1">Consumo · {period}</div>
              <div className="mb-4 font-display text-[16px] font-semibold">Consumo anual por mês (MWh)</div>
              {!d.byMonthConsumption.some((m) => m.consumption > 0) ? <Empty title="Sem consumo registado no período" /> : <TrendChart data={d.byMonthConsumption} dataKey="consumption" money={false} />}
            </div>
            <div className="card rise p-5">
              <div className="label-mono mb-1">Consumo · {period}</div>
              <div className="mb-4 font-display text-[16px] font-semibold">Consumo por vendedor (MWh)</div>
              {!d.bySellerConsumption.length ? <Empty title="Sem consumo registado no período" /> : <BarsChart money={false} data={d.bySellerConsumption} dataKey="consumption" xKey="name" height={300} />}
            </div>
          </div>

          <div className="mb-4 grid gap-4 xl:grid-cols-2">
            <div className="card rise p-5">
              <div className="label-mono mb-1">Comercializador · {period}</div>
              <div className="mb-4 font-display text-[16px] font-semibold">Antigo comercializador</div>
              {!d.byOldSupplier.length ? <Empty title="Sem vendas de luz no período" /> : <Rows items={d.byOldSupplier} colors={TIPO_COLORS} />}
            </div>
            <div className="card rise p-5">
              <div className="label-mono mb-1">Estado da venda · {period}</div>
              <div className="mb-4 font-display text-[16px] font-semibold">Estado da venda</div>
              {!d.byStatus.length ? <Empty title="Sem vendas no período" /> : (
                <Rows items={d.byStatus.map((x) => ({ name: SALE_STATUS[x.status]?.label ?? x.status, count: x.count }))} colors={TIPO_COLORS} showShare={false} />
              )}
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="card rise p-5">
              <div className="label-mono mb-1">Vendedores · {period}</div>
              <div className="mb-4 font-display text-[16px] font-semibold">Vendas por vendedor</div>
              {!d.bySeller.length ? <Empty title="Sem vendedores no período" /> : <BarsChart money={false} data={d.bySeller} dataKey="orders" xKey="name" height={300} />}
            </div>
            <div className="card rise overflow-hidden">
              <div className="max-h-[400px] overflow-auto">
                <table className="w-full text-[13px]">
                  <thead className="sticky top-0 bg-surface">
                    <tr className="border-b border-line text-left">
                      <th className="label-mono px-5 py-3 font-normal">Vendedor</th>
                      <th className="label-mono px-5 py-3 text-right font-normal">Vendas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.bySeller.map((s) => (
                      <tr key={s.name} className="border-b border-line/60">
                        <td className="px-5 py-2.5">{s.name}</td>
                        <td className="num px-5 py-2.5 text-right font-semibold">{s.orders}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {isAdmin && d.byTeam.length > 0 && (
            <div className="mt-4 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
              <div className="card rise p-5">
                <div className="label-mono mb-1">Equipas · {period}</div>
                <div className="mb-4 font-display text-[16px] font-semibold">Vendas por equipa</div>
                <BarsChart money={false} data={d.byTeam.map((t) => ({ ...t, color: t.color ?? "#c6f432" }))} dataKey="orders" xKey="teamName" height={300} />
              </div>
              <div className="card rise overflow-hidden">
                <div className="max-h-[400px] overflow-auto">
                  <table className="w-full text-[13px]">
                    <thead className="sticky top-0 bg-surface">
                      <tr className="border-b border-line text-left">
                        <th className="label-mono px-5 py-3 font-normal">Equipa</th>
                        <th className="label-mono px-5 py-3 text-right font-normal">Vendas</th>
                        <th className="label-mono px-5 py-3 text-right font-normal">Elementos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.byTeam.map((t) => (
                        <tr key={t.teamId} className="border-b border-line/60">
                          <td className="px-5 py-2.5">
                            <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: t.color ?? "#9aa39b" }} />
                            {t.teamName}
                          </td>
                          <td className="num px-5 py-2.5 text-right font-semibold">{t.orders}</td>
                          <td className="num px-5 py-2.5 text-right text-ink-2">{t.memberCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
