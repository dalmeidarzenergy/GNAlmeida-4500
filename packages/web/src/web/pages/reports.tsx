import { useState } from "react";
import { Download } from "lucide-react";
import { useHrReport, useSalesReport } from "../queries/reports";
import { useMe } from "../queries/me";
import { PageHeader, Tabs, Stat, Progress, Empty } from "../components/ui/kit";
import { TrendChart, BarsChart, Donut } from "../components/charts";
import { fmtEur, fmtMonth, monthLabel, thisMonth } from "../lib/format";
import { MonthYearFilter } from "../components/month-year-filter";
import { EmployeeFilter } from "../components/employee-filter";
import { TeamFilter, useTeamIds } from "../components/team-filter";
import { DASHBOARD_SERVICES, ServiceFilter } from "../components/service-filter";
import { ABSENCE_TYPE, SALE_STATUS } from "../lib/labels";
import { PlaceFilter, type Place } from "../components/place-filter";

const HEX: Record<string, string> = { "var(--volt)": "#c6f432", "var(--amber)": "#f5a524", "var(--sky)": "#38bdf8", "var(--danger)": "#f05252", "var(--rose)": "#f472b6", "var(--ink-2)": "#9aa39b" };

function downloadCsv(name: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

function Panel({ title, eyebrow, children, className = "" }: { title: string; eyebrow: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`card rise p-5 ${className}`}>
      <div className="label-mono">{eyebrow}</div>
      <div className="mb-4 mt-1 font-display text-[16px] font-semibold">{title}</div>
      {children}
    </div>
  );
}

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);

function SalesReports({ month, sellerId, teamId, showPlace = true }: { month: string; sellerId: number | null; teamId: number | null; showPlace?: boolean }) {
  const [months, setMonths] = useState<"1" | "3" | "6" | "12" | "0">("1");
  const [services, setServices] = useState<string[]>(DASHBOARD_SERVICES);
  const [place, setPlace] = useState<Place>({ district: "", municipality: "" });
  const r = useSalesReport(Number(months), month, sellerId, services, teamId, place);
  const d = r.data;
  const where = place.municipality || place.district;
  const period = (months === "0" ? `Todos os meses até ${monthLabel(month)}` : months === "1" ? monthLabel(month) : `${months} meses até ${monthLabel(month)}`) + (where ? ` · ${where}` : "");
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={months} onChange={setMonths} items={[{ key: "1", label: "Só o mês" }, { key: "3", label: "3 meses" }, { key: "6", label: "6 meses" }, { key: "12", label: "12 meses" }, { key: "0", label: "Todos" }]} />
          <ServiceFilter value={services} onChange={setServices} />
          {showPlace && <PlaceFilter value={place} onChange={setPlace} />}
          <span className="text-[12.5px] text-ink-3">{period}</span>
        </div>
        {d && (
          <button className="btn btn-ghost" onClick={() => downloadCsv(`vendas-${month}-${months === "0" ? "todos" : `${months}m`}.csv`, [["Mês", "Vendas em fornecimento"], ...d.byMonth.map((m) => [fmtMonth(m.month, true), m.orders]), [], ["Estado", "Vendas"], ...d.byStatus.map((x) => [SALE_STATUS[x.status]?.label ?? x.status, x.count])])}>
            <Download size={14} /> Exportar CSV
          </button>
        )}
      </div>
      {r.isLoading || !d ? <div className="skeleton h-96 rounded-[14px]" /> : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Stat label="Em Fornecimento" value={d.orders} accent="var(--volt)" />
            <Stat delay={40} label="Vendas registadas" value={d.byStatus.reduce((s, x) => s + x.count, 0)} sub="todos os estados" />
            <Stat delay={80} label="Taxa de sucesso" value={d.byStatus.length ? `${Math.round((d.orders / (d.byStatus.reduce((s, x) => s + x.count, 0) || 1)) * 100)}%` : "—"} sub="em fornecimento / registadas" />
            <Stat delay={120} label="Clientes em fornecimento" value={d.topClients.length >= 8 ? "8+" : d.topClients.length} sub="no período" />
          </div>
          <div className="mb-4 grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Stat delay={160} label="Taxa de DDC" value={pct(d.quality.ddc.rate)} sub={`${d.quality.ddc.hits} de ${d.quality.ddc.base} vendas com DDC`} />
            <Stat delay={200} label="Taxa de FE" value={pct(d.quality.fe.rate)} sub={`${d.quality.fe.hits} de ${d.quality.fe.base} vendas com FE`} />
            <Stat delay={220} label="Taxa de PEL" value={pct(d.quality.pel.rate)} sub={`${d.quality.pel.hits} de ${d.quality.pel.base} vendas com PEL`} />
            <Stat
              delay={240}
              label="Média de contratação"
              value={d.quality.contractDays == null ? "—" : `${d.quality.contractDays.toLocaleString("pt-PT", { maximumFractionDigits: 1 })} dias`}
              sub={d.quality.contractBase ? `da venda até Control · ${d.quality.contractBase} venda(s)` : "ainda sem vendas em Control"}
            />
          </div>
          <div className="mb-4 grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Stat delay={280} label="Taxa de Robinson" value={pct(d.quality.robinson.rate)} accent="var(--rose)" sub={`${d.quality.robinson.hits} de ${d.quality.robinson.base} sem consentimento`} />
            <Stat
              delay={320}
              label="Taxa de Chargeback"
              value={pct(d.quality.chargeback.rate)}
              accent="var(--danger)"
              sub={
                <>
                  {d.quality.chargeback.hits} de {d.quality.chargeback.base} em fornecimento passaram a Baixa em 3 meses
                  {d.quality.chargeback.maturing > 0 && <span className="text-ink-3"> · {d.quality.chargeback.maturing} ainda dentro dos 3 meses</span>}
                </>
              }
            />
            <Stat delay={360} label="Taxa de Baixas" value={pct(d.quality.baixas.rate)} accent="var(--danger)" sub={`${d.quality.baixas.hits} de ${d.quality.baixas.base} vendas registadas passaram a Baixa`} />
            <Stat
              delay={400}
              label="Taxa de Anulados"
              value={pct((d.byStatus.find((s) => s.status === "Anulado")?.count ?? 0) / (d.byStatus.reduce((a, x) => a + x.count, 0) || 1))}
              accent="var(--danger)"
              sub={`${d.byStatus.find((s) => s.status === "Anulado")?.count ?? 0} de ${d.byStatus.reduce((a, x) => a + x.count, 0)} vendas registadas`}
            />
          </div>
          <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
            <Panel eyebrow="Evolução" title="Vendas em fornecimento por mês"><TrendChart data={d.byMonth} dataKey="orders" money={false} height={280} /></Panel>
            <Panel eyebrow="Pipeline" title="Vendas por estado">
              <Donut data={d.byStatus.map((s) => ({ name: SALE_STATUS[s.status]?.label ?? s.status, value: s.count, color: HEX[SALE_STATUS[s.status]?.color ?? ""] ?? "#666" }))} />
              <div className="mt-4 grid grid-cols-2 gap-2">
                {d.byStatus.map((s) => (
                  <div key={s.status} className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-[12px]">
                    <span style={{ color: SALE_STATUS[s.status]?.color }}>{SALE_STATUS[s.status]?.label}</span>
                    <span className="num text-ink-2">{s.count}</span>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel eyebrow="Equipa comercial" title="Vendas por vendedor"><BarsChart money={false} data={d.bySeller} dataKey="orders" xKey="name" height={260} /></Panel>
            <Panel eyebrow="Clientes" title="Top clientes">
              <div className="space-y-3">
                {d.topClients.map((c) => (
                  <div key={c.name}>
                    <div className="mb-1 flex justify-between gap-2 text-[12.5px]"><span className="truncate">{c.name}</span><span className="num text-ink-2">{c.orders}</span></div>
                    <Progress value={c.orders / (d.topClients[0]?.orders || 1)} color="var(--sky)" />
                  </div>
                ))}
                {!d.topClients.length && <div className="text-[13px] text-ink-3">Sem dados.</div>}
              </div>
            </Panel>
          </div>
        </>
      )}
    </>
  );
}

function HrReports({ month }: { month: string }) {
  const r = useHrReport(month);
  const d = r.data;
  if (r.isLoading || !d) return <div className="skeleton h-96 rounded-[14px]" />;
  return (
    <>
      {d.missingTermination > 0 && (
        <div className="mb-4 rounded-[12px] border border-amber/30 bg-amber/5 px-4 py-3 text-[13px] text-amber">
          {d.missingTermination} funcionário(s) inativo(s) sem data de inativação: não são contados em nenhum mês. Indique a data na ficha do funcionário.
        </div>
      )}
      <div className="mb-4 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat label={`Ativos em ${monthLabel(month)}`} value={d.headcount} sub={`${d.hiresInMonth} entrada(s) · ${d.exitsInMonth} saída(s)`} />
        <Stat delay={40} label="Massa salarial / mês" value={fmtEur(d.payroll)} accent="var(--volt)" />
        <Stat delay={80} label="Salário médio" value={fmtEur(d.headcount ? d.payroll / d.headcount : 0)} />
        <Stat delay={120} label="Vagas abertas" value={d.openJobs} accent="var(--rose)" sub={`${d.pipeline} candidatos em processo`} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel eyebrow="Estrutura" title="Funcionários por departamento">
          <BarsChart money={false} data={d.byDepartment.map((x) => ({ ...x, color: x.color }))} dataKey="count" xKey="name" height={260} />
        </Panel>
        <Panel eyebrow="Custos" title="Massa salarial por departamento">
          <div className="space-y-3.5">
            {d.byDepartment.sort((a, b) => b.payroll - a.payroll).map((x) => (
              <div key={x.name}>
                <div className="mb-1 flex justify-between text-[12.5px]"><span className="text-ink-2">{x.name}</span><span className="num">{fmtEur(x.payroll)}</span></div>
                <Progress value={x.payroll / (d.payroll || 1)} color={x.color} />
              </div>
            ))}
          </div>
        </Panel>
        <Panel eyebrow={`12 meses até ${monthLabel(month)}`} title="Contratações"><BarsChart money={false} data={d.hires} dataKey="count" xKey="month" height={240} color="#38bdf8" /></Panel>
        <Panel eyebrow={monthLabel(month)} title="Ausências aprovadas (dias)">
          {d.absencesByType.length ? (
            <Donut data={d.absencesByType.map((a) => ({ name: ABSENCE_TYPE[a.type]?.label ?? a.type, value: a.days, color: { ferias: "#c6f432", baixa: "#f05252", falta: "#f5a524", formacao: "#38bdf8", outro: "#9aa39b" }[a.type] ?? "#666" }))} height={240} />
          ) : <Empty title="Sem ausências" />}
        </Panel>
      </div>
    </>
  );
}

export default function ReportsPage() {
  const me = useMe();
  const role = me.data?.role;
  const options = [
    ...(role !== "rh" ? [{ key: "vendas" as const, label: "Vendas" }] : []),
    ...(role !== "vendedor" ? [{ key: "rh" as const, label: "Recursos Humanos" }] : []),
  ];
  const [tab, setTab] = useState<"vendas" | "rh">(role === "rh" ? "rh" : "vendas");
  const [month, setMonth] = useState(thisMonth());
  const [seller, setSeller] = useState<number | null>(null);
  const [team, setTeam] = useState<number | null>(null);
  const teamIds = useTeamIds(team, month);
  const showSales = tab === "vendas" && role !== "rh";
  const showFilters = role === "admin" || role === "rh";
  return (
    <div>
      <PageHeader eyebrow="Análise" title="Relatórios">
        {showSales && showFilters && <TeamFilter value={team} onChange={setTeam} month={month} />}
        {showSales && showFilters && <EmployeeFilter month={month} value={seller} onChange={setSeller} onlyIds={teamIds} />}
        <MonthYearFilter value={month} onChange={setMonth} />
        {options.length > 1 && <Tabs value={tab} onChange={setTab} items={options} />}
      </PageHeader>
      {showSales ? <SalesReports month={month} sellerId={showFilters ? seller : null} teamId={showFilters ? team : null} showPlace={showFilters} /> : <HrReports month={month} />}
    </div>
  );
}
