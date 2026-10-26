import { useState } from "react";
import { Link } from "wouter";
import { ArrowUpRight, ArrowDownRight, Zap, Target, ShoppingCart, Receipt, Users, CalendarOff, Clock, Briefcase, AlertTriangle } from "lucide-react";
import { useDashboard } from "../queries/reports";
import { useMe } from "../queries/me";
import { PageHeader, Stat, Progress, Avatar, Tabs } from "../components/ui/kit";
import { MonthYearFilter } from "../components/month-year-filter";
import { EmployeeFilter } from "../components/employee-filter";
import { TeamFilter, useTeamIds } from "../components/team-filter";
import { DASHBOARD_SERVICES, ServiceFilter } from "../components/service-filter";
import { TrendChart, Donut } from "../components/charts";
import { fmtEur, fmtPct, monthLabel, thisMonth } from "../lib/format";
import { ABSENCE_TYPE, SALE_STATUS } from "../lib/labels";

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (!prev) return <span className="text-ink-3">sem histórico</span>;
  const d = (cur - prev) / prev;
  const up = d >= 0;
  return (
    <span className={`inline-flex items-center gap-1 ${up ? "text-volt" : "text-danger"}`}>
      {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
      {fmtPct(Math.abs(d))} <span className="text-ink-3">vs mês anterior</span>
    </span>
  );
}

export default function Dashboard() {
  const me = useMe();
  const [selMonth, setSelMonth] = useState(thisMonth());
  const [seller, setSeller] = useState<number | null>(null);
  const [team, setTeam] = useState<number | null>(null);
  const teamIds = useTeamIds(team, selMonth);
  const [services, setServices] = useState<string[]>(DASHBOARD_SERVICES);
  const [aggMonths, setAggMonths] = useState<"3" | "6" | "12" | "0">("6");
  const q = useDashboard(selMonth, seller, services, team, Number(aggMonths));  const firstName = (me.data?.name || "").split(" ")[0];
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Bom dia" : hour < 20 ? "Boa tarde" : "Boa noite";

  if (q.isLoading || !q.data) {
    return (
      <div>
        <div className="skeleton mb-8 h-14 w-72" />
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-[128px] rounded-[14px]" />
          ))}
        </div>
        <div className="skeleton mt-4 h-[340px] rounded-[14px]" />
      </div>
    );
  }
  const { sales, hr, month } = q.data;
  const unlinked = me.data?.role === "vendedor" && !me.data.employeeId;
  const allMonths = !selMonth;
  const aggLabel = aggMonths === "0" ? "Todos os meses" : `${aggMonths} meses`;

  return (
    <div>
      <PageHeader eyebrow={monthLabel(month)} title={`${greet}${firstName ? `, ${firstName}` : ""}`}>
        {sales && <ServiceFilter value={services} onChange={setServices} />}
        {sales && (me.data?.role === "admin" || me.data?.role === "rh") && <TeamFilter value={team} onChange={setTeam} month={selMonth} />}
        {sales && (me.data?.role === "admin" || me.data?.role === "rh") && <EmployeeFilter month={selMonth} value={seller} onChange={setSeller} onlyIds={teamIds} />}
        {sales && <MonthYearFilter value={selMonth} onChange={setSelMonth} allowAll />}
        {sales && (
          <Link to="/vendas" className="btn btn-primary">
            <ShoppingCart size={15} /> Nova venda
          </Link>
        )}
      </PageHeader>

      {unlinked && (
        <div className="card rise mb-6 flex items-start gap-3 border-amber/30 bg-amber/5 p-4 text-[13px]">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber" />
          <div>
            <div className="font-medium text-amber">A sua conta ainda não está associada a um vendedor</div>
            <div className="text-ink-2">Peça a um administrador para associar o seu utilizador a uma ficha de funcionário em Utilizadores.</div>
          </div>
        </div>
      )}

      {sales && !unlinked && (
        <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Stat delay={0} label={allMonths ? "Em Fornecimento · histórico" : `Em Fornecimento · ${monthLabel(month)}`} value={sales.monthTotal} accent="var(--volt)" icon={<Zap size={16} />} sub={allMonths ? "todos os meses registados" : <Delta cur={sales.monthTotal} prev={sales.prevMonth} />} />
            <Stat
              delay={40}
              label={allMonths ? "Meta do mês (referência)" : "Meta do mês"}
              value={sales.target ? fmtPct(sales.monthTotal / sales.target) : "—"}
              icon={<Target size={16} />}
              sub={
                <div className="space-y-2">
                  <Progress value={sales.target ? sales.monthTotal / sales.target : 0} />
                  <div>
                    {allMonths
                      ? sales.monthTotal + " vendas no total · meta de " + sales.target + " para " + monthLabel(month)
                      : sales.monthTotal + " de " + sales.target + " vendas"}
                  </div>
                </div>
              }
            />
            <Stat delay={80} label={allMonths ? "Vendas registadas (histórico)" : "Vendas registadas (mês)"} value={sales.month.byStatus.reduce((s, x) => s + x.count, 0)} icon={<Receipt size={16} />} sub="todos os estados" />
            <Stat delay={120} label={allMonths ? "Em Fornecimento (histórico)" : `Em Fornecimento (${aggLabel.toLowerCase()})`} value={sales.orders} icon={<ShoppingCart size={16} />} sub={allMonths ? "todos os meses registados" : `até ${monthLabel(month)}`} />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1.7fr_1fr]">
            <div className="card rise p-5" style={{ animationDelay: "160ms" }}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="label-mono">Vendas em fornecimento</div>
                  <div className="mt-1 font-display text-[17px] font-semibold">{allMonths ? "Todo o histórico" : `${aggLabel} até ${monthLabel(month)}`}</div>
                </div>
                <div className="flex items-center gap-3">
                  <Tabs value={aggMonths} onChange={setAggMonths} items={[{ key: "3", label: "3 meses" }, { key: "6", label: "6 meses" }, { key: "12", label: "12 meses" }, { key: "0", label: "Todos" }]} />
                  <div className="num text-[20px] font-semibold text-volt">{sales.orders}</div>
                </div>
              </div>
              <TrendChart data={sales.byMonth} dataKey="orders" money={false} height={250} />
            </div>
            <div className="card rise p-5" style={{ animationDelay: "200ms" }}>
              <div className="label-mono">Ranking · {allMonths ? "histórico" : monthLabel(month)}</div>
              <div className="mb-4 mt-1 font-display text-[17px] font-semibold">{me.data?.role === "vendedor" ? "Os meus melhores clientes" : me.data?.role === "chefe" ? "Vendedores da minha equipa" : "Vendedores"}</div>
              <div className="space-y-3.5">
                {(me.data?.role === "vendedor" ? sales.month.topClients : me.data?.role === "chefe" ? sales.month.bySeller : sales.month.bySeller).slice(0, 6).map((s, i, arr) => (
                  <div key={s.name} className="flex items-center gap-3">
                    <span className="num w-4 text-[11px] text-ink-3">{i + 1}</span>
                    <Avatar name={s.name} size={28} color={i === 0 ? "var(--volt)" : "var(--ink-2)"} src={(s as { photoUrl?: string | null }).photoUrl} />
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between gap-2 text-[13px]">
                        <span className="truncate">{s.name}</span>
                        <span className="num text-ink-2">{s.orders}</span>
                      </div>
                      <div className="mt-1.5">
                        <Progress value={s.orders / (arr[0]?.orders || 1)} color={i === 0 ? "var(--volt)" : "#4a524b"} />
                      </div>
                    </div>
                  </div>
                ))}
                {!sales.month.bySeller.length && <div className="text-[13px] text-ink-3">Sem vendas em fornecimento neste mês.</div>}
              </div>
            </div>
          </div>

          {(me.data?.role === "admin" || me.data?.role === "rh") && (
            <div className="card rise mt-4 p-5" style={{ animationDelay: "210ms" }}>
              <div className="flex items-baseline justify-between gap-3">
                <div>
                  <div className="label-mono">Ranking · {allMonths ? "histórico" : monthLabel(month)}</div>
                  <div className="mb-4 mt-1 font-display text-[17px] font-semibold">Chefes de equipa</div>
                </div>
                <span className="text-[11.5px] text-ink-3">vendas em fornecimento da equipa (membros + chefe)</span>
              </div>
              {!sales.month.byTeam.length ? (
                <div className="text-[13px] text-ink-3">
                  Ainda não há equipas. <Link to="/equipas" className="text-volt hover:underline">Criar equipas</Link>
                </div>
              ) : (
                <div className="grid gap-x-8 gap-y-3.5 md:grid-cols-2">
                  {sales.month.byTeam.map((t, i, arr) => (
                    <div key={t.teamId} className="flex items-center gap-3">
                      <span className="num w-4 text-[11px] text-ink-3">{i + 1}</span>
                      <Avatar name={t.name} size={32} color={i === 0 && t.orders > 0 ? "var(--volt)" : "var(--ink-2)"} src={t.photoUrl} />
                      <div className="min-w-0 flex-1">
                        <div className="flex justify-between gap-2 text-[13px]">
                          <span className="truncate">{t.name}</span>
                          <span className="num text-ink-2">{t.orders}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-ink-3">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.color }} />
                          <span className="truncate">{t.teamName} · {t.memberCount} {t.memberCount === 1 ? "membro" : "membros"}</span>
                        </div>
                        <div className="mt-1.5">
                          <Progress value={t.orders / (arr[0]?.orders || 1)} color={i === 0 && t.orders > 0 ? "var(--volt)" : "#4a524b"} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="card rise mt-4 p-5" style={{ animationDelay: "220ms" }}>
            <div className="label-mono">{allMonths ? "Relatório histórico" : "Relatório do mês"}</div>
            <div className="mb-4 mt-1 font-display text-[17px] font-semibold">Vendas por estado · {allMonths ? "histórico" : monthLabel(month)}</div>
            {sales.month.byStatus.length === 0 ? (
              <div className="text-[13px] text-ink-3">Sem vendas registadas neste mês.</div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {[...sales.month.byStatus].sort((a, b) => b.count - a.count).map((s) => (
                  <div key={s.status} className="flex items-center justify-between rounded-[10px] border border-line px-3 py-2.5 text-[13px]">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: SALE_STATUS[s.status]?.color ?? "var(--ink-3)" }} />
                      {SALE_STATUS[s.status]?.label ?? s.status}
                    </span>
                    <span className="num font-semibold">{s.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {hr && (
        <>
          <div className={`grid grid-cols-2 gap-4 xl:grid-cols-4 ${sales ? "mt-8" : ""}`}>
            <Stat delay={240} label="Funcionários ativos" value={hr.headcount} icon={<Users size={16} />} accent="var(--ink)" sub={`Massa salarial ${fmtEur(hr.payroll)}/mês`} />
            <Stat delay={280} label="Ausentes hoje" value={hr.outToday} icon={<CalendarOff size={16} />} accent="var(--sky)" sub="férias e ausências aprovadas" />
            <Stat
              delay={320}
              label="Pedidos pendentes"
              value={hr.pendingAbsences}
              icon={<Clock size={16} />}
              accent={hr.pendingAbsences ? "var(--amber)" : undefined}
              sub={
                <Link to="/ausencias" className="text-amber hover:underline">
                  Rever pedidos →
                </Link>
              }
            />
            <Stat delay={360} label="Vagas abertas" value={hr.openJobs} icon={<Briefcase size={16} />} accent="var(--rose)" sub={`${hr.pipeline} candidatos em processo`} />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="card rise p-5" style={{ animationDelay: "400ms" }}>
              <div className="label-mono">Equipa</div>
              <div className="mb-3 mt-1 font-display text-[17px] font-semibold">Por departamento</div>
              <div className="grid items-center gap-4 sm:grid-cols-[200px_1fr]">
                <Donut data={hr.byDepartment.map((d) => ({ name: d.name, value: d.count, color: d.color }))} height={200} />
                <div className="space-y-2.5">
                  {hr.byDepartment.map((d) => (
                    <div key={d.name} className="flex items-center gap-2.5 text-[13px]">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: d.color }} />
                      <span className="flex-1 truncate text-ink-2">{d.name}</span>
                      <span className="num">{d.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="card rise p-5" style={{ animationDelay: "440ms" }}>
              <div className="label-mono">Este ano</div>
              <div className="mb-4 mt-1 font-display text-[17px] font-semibold">Dias de ausência aprovados</div>
              <div className="space-y-4">
                {hr.absencesByType.length === 0 && <div className="text-[13px] text-ink-3">Sem registos.</div>}
                {(() => {
                  const max = Math.max(...hr.absencesByType.map((a) => a.days), 1);
                  return hr.absencesByType
                    .sort((a, b) => b.days - a.days)
                    .map((a) => (
                      <div key={a.type}>
                        <div className="mb-1.5 flex justify-between text-[13px]">
                          <span className="text-ink-2">{ABSENCE_TYPE[a.type]?.label ?? a.type}</span>
                          <span className="num">{a.days} dias</span>
                        </div>
                        <Progress value={a.days / max} color={ABSENCE_TYPE[a.type]?.color} />
                      </div>
                    ));
                })()}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
