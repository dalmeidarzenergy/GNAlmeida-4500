import { useState } from "react";
import { Download } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useCompare } from "../queries/reports";
import { useMe } from "../queries/me";
import { PageHeader, Tabs, Stat, Progress, Empty } from "../components/ui/kit";
import { BarsChart, Donut } from "../components/charts";
import { fmtEur, fmtMonth, monthLabel, thisMonth } from "../lib/format";
import { MonthYearFilter } from "../components/month-year-filter";
import { EmployeeFilter } from "../components/employee-filter";
import { TeamFilter, useTeamIds } from "../components/team-filter";
import { DASHBOARD_SERVICES, ServiceFilter } from "../components/service-filter";

const SUPPLIER_COLORS = ["#c6f432", "#38bdf8", "#f472b6", "#f5a524", "#a78bfa", "#34d399", "#fb7185", "#facc15", "#9aa39b"];
const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const dec = (v: number | null) => (v == null ? "—" : v.toLocaleString("pt-PT", { maximumFractionDigits: 1 }));

/** +X% de a para b (positivo = subiu). */
function delta(a: number | null, b: number | null) {
  if (a == null || b == null || b === 0) return null;
  return (a - b) / b;
}

function Delta({ v }: { v: number | null }) {
  if (v == null) return <span className="text-ink-3">—</span>;
  const up = v >= 0;
  return <span className={up ? "text-volt" : "text-danger"}>{up ? "+" : ""}{Math.round(v * 100)}%</span>;
}

type MonthSummary = {
  key: string;
  orders: number;
  registered: number;
  total: number;
  avgTicket: number;
  success: number | null;
  quality: {
    ddc: { rate: number | null }; fe: { rate: number | null }; pel: { rate: number | null }; robinson: { rate: number | null };
    contractDays: number | null; chargeback: { rate: number | null }; baixas: { rate: number | null };
  };
};

function downloadCsv(name: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

function MetricTable({ periods, labels }: { periods: MonthSummary[]; labels: string[] }) {
  const rows: { label: string; get: (s: MonthSummary) => number | null; fmt: (v: number | null) => string }[] = [
    { label: "Em Fornecimento", get: (s) => s.orders, fmt: (v) => (v == null ? "—" : String(v)) },
    { label: "Vendas registadas", get: (s) => s.registered, fmt: (v) => (v == null ? "—" : String(v)) },
    { label: "Taxa de sucesso", get: (s) => s.success, fmt: pct },
    { label: "Taxa de DDC", get: (s) => s.quality.ddc.rate, fmt: pct },
    { label: "Taxa de FE", get: (s) => s.quality.fe.rate, fmt: pct },
    { label: "Taxa de PEL", get: (s) => s.quality.pel.rate, fmt: pct },
    { label: "Taxa de Robinson", get: (s) => s.quality.robinson.rate, fmt: pct },
    { label: "Média de contratação", get: (s) => s.quality.contractDays, fmt: (v) => (v == null ? "—" : `${dec(v)} dias`) },
    { label: "Chargeback", get: (s) => s.quality.chargeback.rate, fmt: pct },
    { label: "Baixas", get: (s) => s.quality.baixas.rate, fmt: pct },
  ];
  return (
    <div className="card rise overflow-hidden">
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-line text-left">
              <th className="label-mono px-5 py-3 font-normal">Métrica</th>
              {labels.map((l) => (
                <th key={l} className="label-mono px-5 py-3 text-right font-normal">{l}</th>
              ))}
              <th className="label-mono px-5 py-3 text-right font-normal">Δ vs anterior</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const vals = periods.map((p) => row.get(p));
              const best = Math.max(...vals.filter((v): v is number => v != null));
              return (
                <tr key={row.label} className="border-b border-line/60">
                  <td className="px-5 py-2.5 text-ink-2">{row.label}</td>
                  {vals.map((v, i) => (
                    <td key={i} className={`num px-5 py-2.5 text-right ${v === best && v != null ? "font-semibold text-ink" : "text-ink-2"}`}>{row.fmt(v)}</td>
                  ))}
                  <td className="num px-5 py-2.5 text-right"><Delta v={delta(vals[0], vals[1])} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MonthsView({ d }: { d: NonNullable<ReturnType<typeof useCompare>["data"]> }) {
  const { ref, prev, lastYear } = d.months;
  const periods: MonthSummary[] = [ref as MonthSummary, prev as MonthSummary, lastYear as MonthSummary];
  const labels = [monthLabel(ref.key), monthLabel(prev.key), monthLabel(lastYear.key)];
  return (
    <>
      <div className="mb-4 grid gap-4 md:grid-cols-3">
        {periods.map((p, i) => (
          <div key={p.key} className="card rise p-5">
            <div className="label-mono">{labels[i]}</div>
            <div className="mt-2 font-display text-[15px] font-semibold">{i === 0 ? "Mês selecionado" : i === 1 ? "Mês anterior" : "Homólogo (ano anterior)"}</div>
            <div className="mt-4 flex items-end gap-6">
              <div>
                <div className="num text-[30px] font-semibold text-volt">{p.orders}</div>
                <div className="label-mono">em fornec.</div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-2 text-[12px] text-ink-2">
              <div className="rounded-lg bg-surface-2 px-3 py-2">Sucesso <span className="num float-right text-ink">{pct(p.success)}</span></div>
            </div>
          </div>
        ))}
      </div>
      <MetricTable periods={periods} labels={labels} />
    </>
  );
}

function YearBars({ data }: { data: { label: string; current: number; previous: number; prevLabel: string }[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 10, right: 6, left: -8, bottom: 0 }}>
        <CartesianGrid stroke="#1f2420" vertical={false} />
        <XAxis dataKey="label" tick={{ stroke: "#636b64", fontSize: 11, fontFamily: "JetBrains Mono" }} tickLine={false} axisLine={false} />
        <YAxis tick={{ stroke: "#636b64", fontSize: 11, fontFamily: "JetBrains Mono" }} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
        <Tooltip cursor={{ fill: "rgba(255,255,255,0.03)" }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar name="Este ano" dataKey="current" fill="#c6f432" radius={[4, 4, 0, 0]} maxBarSize={18} />
        <Bar name="Ano anterior" dataKey="previous" fill="#38bdf8" fillOpacity={0.6} radius={[4, 4, 0, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function YearsView({ d }: { d: NonNullable<ReturnType<typeof useCompare>["data"]> }) {
  const { current, previous } = d.years;
  const series = current.byMonth.map((m, i) => ({
    label: fmtMonth(m.month),
    current: m.orders,
    previous: previous.byMonth[i]?.orders ?? 0,
  }));
  const rows = current.byMonth.map((m, i) => {
    const p = previous.byMonth[i]?.orders ?? 0;
    return { month: m.month, current: m.orders, previous: p, delta: delta(m.orders, p) };
  });
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-4 xl:grid-cols-3">
        <Stat label={`Vendas · ${current.year}`} value={current.orders} accent="var(--volt)" />
        <Stat delay={40} label={`Vendas · ${previous.year}`} value={previous.orders} accent="var(--sky)" />
        <Stat delay={80} label="Δ em fornecimento" value={<Delta v={delta(current.orders, previous.orders)} />} sub={`${current.year} vs ${previous.year}`} />
      </div>
      <div className="card rise mb-4 p-5">
        <div className="label-mono mb-1">Ano a ano</div>
        <div className="mb-4 font-display text-[16px] font-semibold">Vendas por mês · {current.year} vs {previous.year}</div>
        <YearBars data={series} />
      </div>
      <div className="card rise overflow-hidden">
        <div className="max-h-[440px] overflow-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-line text-left">
                <th className="label-mono px-5 py-3 font-normal">Mês</th>
                <th className="label-mono px-5 py-3 text-right font-normal">{current.year}</th>
                <th className="label-mono px-5 py-3 text-right font-normal">{previous.year}</th>
                <th className="label-mono px-5 py-3 text-right font-normal">Δ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month} className="border-b border-line/60">
                  <td className="px-5 py-2.5 text-ink-2">{monthLabel(r.month)}</td>
                  <td className="num px-5 py-2.5 text-right text-volt">{r.current}</td>
                  <td className="num px-5 py-2.5 text-right text-ink-2">{r.previous}</td>
                  <td className="num px-5 py-2.5 text-right"><Delta v={r.delta} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function TeamsView({ d, period }: { d: NonNullable<ReturnType<typeof useCompare>["data"]>; period: string }) {
  const teams = d.teams;
  if (!teams.length) return <Empty title="Sem equipas com vendas no período" />;
  return (
    <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
      <div className="card rise p-5">
        <div className="label-mono mb-1">Equipas · {period}</div>
        <div className="mb-4 font-display text-[16px] font-semibold">Vendas por equipa</div>
        <BarsChart money={false} data={teams.map((t) => ({ ...t, color: t.color ?? "#c6f432" }))} dataKey="orders" xKey="teamName" height={320} />
      </div>
      <div className="card rise overflow-hidden">
        <div className="max-h-[440px] overflow-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-line text-left">
                <th className="label-mono px-5 py-3 font-normal">Equipa</th>
                <th className="label-mono px-5 py-3 text-right font-normal">Vendas</th>
                <th className="label-mono px-5 py-3 text-right font-normal">Elementos</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <tr key={t.teamId} className="border-b border-line/60">
                  <td className="px-5 py-2.5"><span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: t.color ?? "#9aa39b" }} />{t.teamName}</td>
                  <td className="num px-5 py-2.5 text-right font-semibold">{t.orders}</td>
                  <td className="num px-5 py-2.5 text-right text-ink-2">{t.memberCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SellersView({ d, period }: { d: NonNullable<ReturnType<typeof useCompare>["data"]>; period: string }) {
  const sellers = d.sellers;
  if (!sellers.length) return <Empty title="Sem vendedores com vendas no período" />;
  return (
    <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
      <div className="card rise p-5">
        <div className="label-mono mb-1">Vendedores · {period}</div>
        <div className="mb-4 font-display text-[16px] font-semibold">Vendas por vendedor</div>
        <BarsChart money={false} data={sellers} dataKey="orders" xKey="name" height={320} />
      </div>
      <div className="card rise overflow-hidden">
        <div className="max-h-[440px] overflow-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-line text-left">
                <th className="label-mono px-5 py-3 font-normal">Vendedor</th>
                <th className="label-mono px-5 py-3 text-right font-normal">Vendas</th>
                <th className="label-mono px-5 py-3 text-right font-normal">Faturação</th>
              </tr>
            </thead>
            <tbody>
              {sellers.map((s) => (
                <tr key={s.name} className="border-b border-line/60">
                  <td className="px-5 py-2.5">{s.name}</td>
                  <td className="num px-5 py-2.5 text-right font-semibold">{s.orders}</td>
                  <td className="num px-5 py-2.5 text-right text-ink-2">{fmtEur(s.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SuppliersView({ d, period }: { d: NonNullable<ReturnType<typeof useCompare>["data"]>; period: string }) {
  const suppliers = d.suppliers;
  if (!suppliers.length) return <Empty title="Sem vendas de luz no período" />;
  return (
    <div className="card rise p-5">
      <div className="label-mono mb-1">Comercializador · {period}</div>
      <div className="mb-4 font-display text-[16px] font-semibold">Antigo comercializador</div>
      <div className="grid items-center gap-6 lg:grid-cols-[280px_1fr]">
        <Donut data={suppliers.map((x, i) => ({ name: x.name, value: x.count, color: SUPPLIER_COLORS[i % SUPPLIER_COLORS.length] }))} />
        <div className="space-y-2.5">
          {suppliers.map((x, i) => (
            <div key={x.name}>
              <div className="mb-1 flex items-center justify-between gap-2 text-[12.5px]">
                <span className="flex min-w-0 items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SUPPLIER_COLORS[i % SUPPLIER_COLORS.length] }} /><span className="truncate">{x.name}</span></span>
                <span className="num shrink-0 text-ink-2">
                  <span className="font-semibold text-ink">{Math.round(x.share * 100)}%</span> · {x.count}
                  {x.counted > 0 && <span className="text-volt"> · {x.counted} em fornec.</span>}
                </span>
              </div>
              <Progress value={x.share / (suppliers[0]?.share || 1)} color={SUPPLIER_COLORS[i % SUPPLIER_COLORS.length]} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LocalView({ d, period }: { d: NonNullable<ReturnType<typeof useCompare>["data"]>; period: string }) {
  const [mode, setMode] = useState<"distrito" | "concelho">("distrito");
  const list = mode === "distrito" ? d.districts : d.concelhos;
  if (!list.length) return <Empty title="Sem vendas no período" />;
  return (
    <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
      <div className="card rise p-5">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <div className="label-mono mb-1">Local · {period}</div>
            <div className="font-display text-[16px] font-semibold">Vendas por {mode === "distrito" ? "distrito" : "concelho"}</div>
          </div>
          <Tabs value={mode} onChange={setMode} items={[{ key: "distrito", label: "Distrito" }, { key: "concelho", label: "Concelho" }]} />
        </div>
        <BarsChart money={false} data={list} dataKey="orders" xKey="name" height={320} />
      </div>
      <div className="card rise overflow-hidden">
        <div className="max-h-[440px] overflow-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-line text-left">
                <th className="label-mono px-5 py-3 font-normal">{mode === "distrito" ? "Distrito" : "Concelho"}</th>
                <th className="label-mono px-5 py-3 text-right font-normal">Vendas</th>
              </tr>
            </thead>
            <tbody>
              {list.map((x) => (
                <tr key={x.name} className="border-b border-line/60">
                  <td className="px-5 py-2.5">{x.name}</td>
                  <td className="num px-5 py-2.5 text-right font-semibold">{x.orders}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function ComparisonPage() {
  const me = useMe();
  const isAdmin = me.data?.role === "admin" || me.data?.role === "rh";
  const [dim, setDim] = useState<"meses" | "anos" | "equipas" | "vendedores" | "comercializador" | "local">("meses");
  const [month, setMonth] = useState(thisMonth());
  const [seller, setSeller] = useState<number | null>(null);
  const [team, setTeam] = useState<number | null>(null);
  const [services, setServices] = useState<string[]>(DASHBOARD_SERVICES);
  const teamIds = useTeamIds(team, month);
  const [months, setMonths] = useState<"1" | "3" | "6" | "12" | "0">("1");
  const periodMonths = Number(months);
  const r = useCompare(month, periodMonths, isAdmin ? seller : null, services, isAdmin ? team : null);
  const d = r.data;

  const dims = [
    { key: "meses" as const, label: "Meses" },
    { key: "anos" as const, label: "Ano a ano" },
    { key: "equipas" as const, label: "Equipas" },
    { key: "vendedores" as const, label: "Vendedores" },
    { key: "comercializador" as const, label: "Comercializador" },
    { key: "local" as const, label: "Local" },
  ];

  const showMonthsFilter = !["meses", "anos"].includes(dim);
  const periodLabel = months === "0" ? "Todos os meses" : months === "1" ? monthLabel(month) : `${months} meses até ${monthLabel(month)}`;

  return (
    <div>
      <PageHeader eyebrow="Análise" title="Comparativo">
        {isAdmin && <TeamFilter value={team} onChange={setTeam} />}
        {isAdmin && <EmployeeFilter month={month} value={seller} onChange={setSeller} onlyIds={teamIds} />}
        <MonthYearFilter value={month} onChange={setMonth} />
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={dim} onChange={setDim} items={dims} />
          {showMonthsFilter && <Tabs value={months} onChange={setMonths} items={[{ key: "1", label: "Só o mês" }, { key: "3", label: "3 meses" }, { key: "6", label: "6 meses" }, { key: "12", label: "12 meses" }, { key: "0", label: "Todos" }]} />}
          <ServiceFilter value={services} onChange={setServices} />
          {showMonthsFilter && <span className="text-[12.5px] text-ink-3">{periodLabel}</span>}
        </div>
        {d && (
          <button className="btn btn-ghost" onClick={() => downloadCsv(`comparativo-${dim}-${month}.csv`, dim === "anos" ? [["Mês", `${d.years.current.year}`, `${d.years.previous.year}`], ...d.years.current.byMonth.map((m, i) => [fmtMonth(m.month, true), m.orders, d.years.previous.byMonth[i]?.orders ?? 0])] : dim === "equipas" ? [["Equipa", "Vendas", "Elementos"], ...d.teams.map((t) => [t.teamName, t.orders, t.memberCount])] : dim === "vendedores" ? [["Vendedor", "Vendas", "Faturação"], ...d.sellers.map((s) => [s.name, s.orders, s.total])] : dim === "comercializador" ? [["Comercializador", "Vendas", "%"], ...d.suppliers.map((s) => [s.name, s.count, Math.round(s.share * 100)])] : dim === "local" ? [["Distrito", "Vendas"], ...d.districts.map((x) => [x.name, x.orders])] : [["Métrica", "Mês", "Mês anterior", "Homólogo"], ["Em Fornecimento", d.months.ref.orders, d.months.prev.orders, d.months.lastYear.orders]])}>
            <Download size={14} /> Exportar CSV
          </button>
        )}
      </div>

      {r.isLoading || !d ? <div className="skeleton h-96 rounded-[14px]" /> : (
        <>
          {dim === "meses" && <MonthsView d={d} />}
          {dim === "anos" && <YearsView d={d} />}
          {dim === "equipas" && <TeamsView d={d} period={periodLabel} />}
          {dim === "vendedores" && <SellersView d={d} period={periodLabel} />}
          {dim === "comercializador" && <SuppliersView d={d} period={periodLabel} />}
          {dim === "local" && <LocalView d={d} period={periodLabel} />}
        </>
      )}
    </div>
  );
}
