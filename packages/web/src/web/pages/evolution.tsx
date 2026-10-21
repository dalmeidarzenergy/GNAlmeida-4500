import { useState } from "react";
import { Download } from "lucide-react";
import { useEvolution, type Granularity } from "../queries/reports";
import { useMe } from "../queries/me";
import { PageHeader, Tabs, Stat, Empty } from "../components/ui/kit";
import { EvolutionChart } from "../components/charts";
import { monthLabel, thisMonth } from "../lib/format";
import { MonthYearFilter } from "../components/month-year-filter";
import { EmployeeFilter } from "../components/employee-filter";
import { TeamFilter, useTeamIds } from "../components/team-filter";
import { DASHBOARD_SERVICES, ServiceFilter } from "../components/service-filter";

const GRAN: Record<Granularity, { tab: string; unit: string; avgUnit: string; col: string; range: (m: string) => string }> = {
  dia: { tab: "Diária", unit: "dia", avgUnit: "dia de calendário", col: "Dia", range: (m) => `Todos os dias de ${monthLabel(m)}` },
  semana: { tab: "Semanal", unit: "semana", avgUnit: "semana", col: "Semana (seg–dom)", range: (m) => `12 semanas até ${monthLabel(m)}` },
  mes: { tab: "Mensal", unit: "mês", avgUnit: "mês", col: "Mês", range: (m) => `12 meses até ${monthLabel(m)}` },
  todos: { tab: "Todos", unit: "mês", avgUnit: "mês", col: "Mês", range: (m) => `Todos os meses até ${monthLabel(m)}` },
};

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const dec = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1).replace(".", ","));

function downloadCsv(name: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

export default function EvolutionPage() {
  const me = useMe();
  const isAdmin = me.data?.role === "admin" || me.data?.role === "rh";
  const [gran, setGran] = useState<Granularity>("dia");
  const [month, setMonth] = useState(thisMonth());
  const [seller, setSeller] = useState<number | null>(null);
  const [team, setTeam] = useState<number | null>(null);
  const teamIds = useTeamIds(team, month);
  const [services, setServices] = useState<string[]>(DASHBOARD_SERVICES);
  const [cumulative, setCumulative] = useState(false);
  const r = useEvolution(gran, month, isAdmin ? seller : null, services, isAdmin ? team : null);
  const d = r.data;
  const g = GRAN[gran];
  const rows = d ? [...d.series].reverse() : [];

  return (
    <div>
      <PageHeader eyebrow="Análise" title="Evolução">
        {isAdmin && <TeamFilter value={team} onChange={setTeam} />}
        {isAdmin && <EmployeeFilter month={month} value={seller} onChange={setSeller} onlyIds={teamIds} />}
        <MonthYearFilter value={month} onChange={setMonth} />
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={gran} onChange={setGran} items={(Object.keys(GRAN) as Granularity[]).map((k) => ({ key: k, label: GRAN[k].tab }))} />
          <ServiceFilter value={services} onChange={setServices} />
          <span className="text-[12.5px] text-ink-3">{g.range(month)}</span>
        </div>
        {d && (
          <button
            className="btn btn-ghost"
            onClick={() => downloadCsv(`evolucao-${gran}-${month}.csv`, [[g.col, "Inseridas", "Em Fornecimento", "Taxa"], ...d.series.map((x) => [x.label, x.inserted, x.supplied, pct(x.rate)]), ["Total", d.inserted, d.supplied, pct(d.rate)]])}
          >
            <Download size={14} /> Exportar CSV
          </button>
        )}
      </div>

      {r.isLoading || !d ? <div className="skeleton h-96 rounded-[14px]" /> : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Stat label="Vendas inseridas" value={d.inserted} accent="var(--sky)" sub={`média ${dec(d.avgInserted)} / ${g.avgUnit}`} />
            <Stat delay={40} label="Em Fornecimento" value={d.supplied} accent="var(--volt)" sub={`média ${dec(d.avgSupplied)} / ${g.avgUnit}`} />
            <Stat delay={80} label="Taxa de sucesso" value={pct(d.rate)} sub="em fornecimento / inseridas no período" />
            <Stat delay={120} label={`Melhor ${g.unit}`} value={d.best ? d.best.label : "—"} sub={d.best ? `${d.best.inserted} venda(s) inserida(s)` : "sem vendas"} />
          </div>

          {gran !== "todos" && (
          <div className="mb-4 grid gap-4 md:grid-cols-3">
            <Stat
              delay={160}
              label="Média diária de vendas"
              value={dec(Math.round(d.pace.avgInserted * 10) / 10)}
              accent="var(--sky)"
              sub={d.pace.elapsed ? `${d.pace.inserted} vendas em ${d.pace.elapsed} dia(s) úteis · ${dec(Math.round(d.pace.avgSupplied * 10) / 10)} em fornec./dia` : "ainda sem dias úteis decorridos"}
            />
            <Stat
              delay={200}
              label={`Previsão de fecho · ${monthLabel(month)}`}
              value={d.pace.forecastInserted}
              accent="var(--volt)"
              sub={d.pace.remaining ? `vendas inseridas ao ritmo atual · ${d.pace.forecastSupplied} em fornec.` : `mês fechado · ${d.pace.supplied} em fornec.`}
            />
            <Stat
              delay={240}
              label="Dias úteis por trabalhar"
              value={d.pace.remaining}
              sub={`de ${d.pace.workdays} dias úteis (seg. a sex.)${d.pace.holidays.length ? ` · feriado: ${d.pace.holidays.map((h) => `${h.date.slice(8, 10)}/${h.date.slice(5, 7)} ${h.name}`).join(", ")}` : ""}`}
            />
          </div>
          )}

          <div className="card rise mb-4 p-5">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="label-mono">Evolução {g.tab.toLowerCase()}</div>
                <div className="mt-1 font-display text-[16px] font-semibold">Vendas inseridas vs. em fornecimento</div>
              </div>
              <div className="flex items-center gap-4 text-[12px]">
                <span className="flex items-center gap-1.5 text-ink-2"><span className="h-2.5 w-2.5 rounded-sm bg-sky/60" /> Inseridas</span>
                <span className="flex items-center gap-1.5 text-ink-2"><span className="h-0.5 w-4 rounded bg-volt" /> Em Fornecimento</span>
                <Tabs value={cumulative ? "acum" : "periodo"} onChange={(v) => setCumulative(v === "acum")} items={[{ key: "periodo", label: `Por ${g.unit}` }, { key: "acum", label: "Acumulado" }]} />
              </div>
            </div>
            {d.inserted === 0 ? <Empty title="Sem vendas no período" /> : <EvolutionChart data={d.series} cumulative={cumulative} />}
          </div>

          <div className="card rise overflow-hidden">
            <div className="max-h-[440px] overflow-auto">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-surface">
                  <tr className="border-b border-line text-left">
                    <th className="label-mono px-5 py-3 font-normal">{g.col}</th>
                    <th className="label-mono px-5 py-3 text-right font-normal">Inseridas</th>
                    <th className="label-mono px-5 py-3 text-right font-normal">Em Fornecimento</th>
                    <th className="label-mono px-5 py-3 text-right font-normal">Taxa</th>
                    <th className="label-mono px-5 py-3 text-right font-normal">Acum. inseridas</th>
                    <th className="label-mono px-5 py-3 text-right font-normal">Acum. em fornec.</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((x) => (
                    <tr key={x.key} className={`border-b border-line/60 ${x.inserted ? "" : "text-ink-3"}`}>
                      <td className="px-5 py-2.5">{x.label}</td>
                      <td className="num px-5 py-2.5 text-right">{x.inserted}</td>
                      <td className={`num px-5 py-2.5 text-right ${x.supplied ? "text-volt" : ""}`}>{x.supplied}</td>
                      <td className="num px-5 py-2.5 text-right">{pct(x.rate)}</td>
                      <td className="num px-5 py-2.5 text-right text-ink-2">{x.cumInserted}</td>
                      <td className="num px-5 py-2.5 text-right text-ink-2">{x.cumSupplied}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="mt-3 text-[12px] text-ink-3">
            "Inseridas" contam pela data da venda. "Em Fornecimento" conta pelo dia em que a venda passou a esse estado (registado em cada mudança de estado, incluindo sábados) e só inclui as que continuam em fornecimento; nas DUAL conta o estado da luz. Com equipa escolhida, cada venda conta para a equipa onde o comercial estava na data da venda. Os dias úteis do ritmo são de segunda a sexta, sem feriados nacionais.
          </p>
        </>
      )}
    </div>
  );
}
