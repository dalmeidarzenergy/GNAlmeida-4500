/**
 * Página "Gestão de Empresa": o painel de administração da própria empresa.
 *
 * Mostra a estrutura da empresa (departamentos e cargos, equipas, pessoas) com
 * filtros por estado — ativos, inativos e em entrada — e por mês de referência.
 * O mês é o eixo de tudo: conta quem já tinha entrado e quem ainda não tinha
 * saído nesse mês (mês a mês, não a fotografia de hoje).
 *
 * Regras dos estados:
 *   ativo      — status do funcionário é "ativo" e o mês cai dentro do vínculo
 *   suspenso   — status do funcionário é "suspenso" no mês
 *   inativo    — já saiu: status "inativo" ou data de inativação anterior ao mês
 *   em entrada — admitido há pouco tempo (período de entrada / contrato inicial)
 *   todo       — tudo o que pertence a esse mês, sem filtro de estado
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Landmark, Users, UsersRound, Contact, Plug, ArrowUpRight, Search, Sparkles } from "lucide-react";
import { PageHeader, Stat, Empty, Tabs } from "../components/ui/kit";
import { useMe } from "../queries/me";
import { useDepartments, usePositions, useTeams, useEmployees } from "../queries/hr";
import { useCustomSuppliers } from "../queries/suppliers";

/** Meses de período de entrada: quem foi admitido nos últimos N meses.*/
const ENTRY_MONTHS = 3;

type DeptState = "ativo" | "inativo";
type TeamState = "ativa" | "fechada";
type PersonState = "ativo" | "suspenso" | "inativo" | "entrada";

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

/** Mês de calendário a partir de "YYYY-MM", com mês. */
function parseYM(ym: string) {
  const [yy, mm] = ym.split("-");
  return { y: Number(yy), m: Number(mm) };
}

/** Último dia do mês, em texto ("2026-11" -> "2026-11-30"). */
function monthEnd(ym: string) {
  const { y, m } = parseYM(ym);
  return y + "-" + pad(m) + "-" + pad(new Date(y, m, 0).getDate());
}

/** Fim do mês ym recuado de n meses (para a janela de entrada). */
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

function isEntry(hireDate: string, ym: string) {
  return hireDate.slice(0, 7) >= monthsAgo(ym, ENTRY_MONTHS - 1) && hireDate.slice(0, 7) <= ym;
}

export default function EmpresaPage() {
  const { data: me } = useMe();
  const deps = useDepartments();
  const positions = usePositions();
  const teams = useTeams();
  const emps = useEmployees();
  const sups = useCustomSuppliers();

  const months = useMemo(() => monthOptions(24), []);
  const [month, setMonth] = useState(() => todayLisbon().slice(0, 7));
  const [area, setArea] = useState<"pessoas" | "equipas" | "estrutura">("pessoas");
  const [personState, setPersonState] = useState<PersonState | "todos">("ativo");
  const [teamState, setTeamState] = useState<TeamState | "todas">("ativa");
  const [deptState, setDeptState] = useState<DeptState | "todos">("ativo");
  const [q, setQ] = useState("");

  const today = todayLisbon();
  const monthLast = monthEnd(month);
  const loading = deps.isLoading || teams.isLoading || emps.isLoading;

  /* ------------------------------------------------------------------ pessoas */

  const people = useMemo(() => {
    return (emps.data ?? []).map((e) => {
      const hired = e.hireDate.slice(0, 7) <= month;
      const left = e.status === "inativo" || (e.terminationDate != null && e.terminationDate.slice(0, 7) < month);
      let state: PersonState;
      if (left) state = "inativo";
      else if (e.status === "suspenso") state = "suspenso";
      else if (isEntry(e.hireDate, month)) state = "entrada";
      else state = "ativo";
      return { ...e, hired, left, state };
    });
  }, [emps.data, month]);

  // "Entrada" é um recorte dentro dos ativos: soma-se aos ativos, não compete com eles.
  const matchesPerson = (state: PersonState, filter: PersonState | "todos") =>
    filter === "todos" ? true : filter === "ativo" ? state === "ativo" || state === "entrada" : state === filter;

  const listPeople = useMemo(() => {
    const s = q.trim().toLowerCase();
    return people.filter(
      (p) =>
        matchesPerson(p.state, personState) &&
        (!s || p.name.toLowerCase().includes(s) || p.email.toLowerCase().includes(s) || (p.positionTitle ?? "").toLowerCase().includes(s)),
    );
  }, [people, personState, q]);

  const countPerson = (f: PersonState | "todos") => people.filter((p) => matchesPerson(p.state, f)).length;

  const emEntrada = people.filter((p) => p.state === "entrada").length;
  const ativos = people.filter((p) => p.state === "ativo" || p.state === "entrada").length;
  const inativos = people.filter((p) => p.state === "inativo").length;
  const suspensos = people.filter((p) => p.state === "suspenso").length;

  /* ------------------------------------------------------------------ equipas */

  const teamsView = useMemo(() => {
    return (teams.data ?? []).map((t) => {
      const periods = ((t as any).periods as { id: number; startDate: string; endDate: string | null }[] | undefined) ?? [];
      const open = periods.some((p) => p.startDate <= monthLast && (p.endDate == null || p.endDate >= month + "-01"));
      // A equipa já existia no mês: abriu em ou antes do fim desse mês.
      const existed = periods.some((p) => p.startDate <= monthLast);
      return { ...t, open, existed, periods };
    });
  }, [teams.data, month, monthLast]);

  const listTeams = useMemo(() => {
    const s = q.trim().toLowerCase();
    return teamsView.filter(
      (t) =>
        t.existed &&
        (teamState === "todas" ? true : teamState === "ativa" ? t.open : !t.open) &&
        (!s || t.name.toLowerCase().includes(s) || (t.leaderName ?? "").toLowerCase().includes(s)),
    );
  }, [teamsView, teamState, q]);

  const countTeam = (f: TeamState | "todas") =>
    teamsView.filter((t) => t.existed && (f === "todas" ? true : f === "ativa" ? t.open : !t.open)).length;

  /* --------------------------------------------------------------- estrutura */

  const structure = useMemo(() => {
    return (deps.data ?? []).map((d) => {
      const people = (emps.data ?? []).filter((e) => e.departmentId === d.id);
      const inMonth = people.filter((e) => e.hireDate.slice(0, 7) <= month);
      const ativos = inMonth.filter((e) => e.status !== "inativo" && (e.terminationDate == null || e.terminationDate.slice(0, 7) >= month));
      return { ...d, headcount: ativos.length, total: inMonth.length, ativo: ativos.length > 0 };
    });
  }, [deps.data, emps.data, month]);

  const listStructure = useMemo(() => {
    const s = q.trim().toLowerCase();
    return structure.filter(
      (d) => (deptState === "todos" ? true : deptState === "ativo" ? d.ativo : !d.ativo) && (!s || d.name.toLowerCase().includes(s)),
    );
  }, [structure, deptState, q]);

  const countDept = (f: DeptState | "todos") => structure.filter((d) => (f === "todos" ? true : f === "ativo" ? d.ativo : !d.ativo)).length;

  /* ------------------------------------------------------------------ render */

  const stateChip = (state: PersonState | TeamState | DeptState) => {
    const map: Record<string, { label: string; cls: string }> = {
      ativo: { label: "ativo", cls: "border-volt/40 bg-volt/10 text-volt" },
      ativa: { label: "aberta", cls: "border-volt/40 bg-volt/10 text-volt" },
      entrada: { label: "em entrada", cls: "border-sky/40 bg-sky/10 text-sky" },
      suspenso: { label: "suspenso", cls: "border-amber/40 bg-amber/10 text-amber" },
      inativo: { label: "inativo", cls: "border-line bg-surface-2 text-ink-3" },
      fechada: { label: "fechada", cls: "border-line bg-surface-2 text-ink-3" },
    };
    const m = map[state] ?? { label: "ativo", cls: "border-volt/40 bg-volt/10 text-volt" };
    return <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${m.cls}`}>{m.label}</span>;
  };

  return (
    <>
      <PageHeader
        eyebrow="GESTÃO DE EMPRESA"
        title="Gestão de Empresa"
        subtitle="Estrutura e dados da empresa num só sítio: departamentos, equipas, pessoas e comercializadores. Filtra por estado e por mês de referência."
      />

      {/* Barra de filtros: o mês manda em tudo o que aparece abaixo. */}
      <div className="card rise mb-5 flex flex-wrap items-end gap-3 p-4" style={{ animationDelay: "0ms" }}>
        <label className="flex flex-col gap-1">
          <span className="label-mono">Mês de referência</span>
          <select className="input w-52" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Mês de referência">
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
                {m === today.slice(0, 7) ? " (atual)" : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="label-mono">Estado</span>
          <select
            className="input w-48"
            aria-label="Estado"
            value={area === "pessoas" ? personState : area === "equipas" ? teamState : deptState}
            onChange={(e) => {
              if (area === "pessoas") setPersonState(e.target.value as PersonState | "todos");
              else if (area === "equipas") setTeamState(e.target.value as TeamState | "todas");
              else setDeptState(e.target.value as DeptState | "todos");
            }}
          >
            {area === "pessoas" && (
              <>
                <option value="ativo">Ativos</option>
                <option value="entrada">Em entrada</option>
                <option value="suspenso">Suspensos</option>
                <option value="inativo">Inativos</option>
                <option value="todos">Todos</option>
              </>
            )}
            {area === "equipas" && (
              <>
                <option value="ativa">Ativas (abertas)</option>
                <option value="fechada">Fechadas</option>
                <option value="todas">Todas</option>
              </>
            )}
            {area === "estrutura" && (
              <>
                <option value="ativo">Com pessoas</option>
                <option value="inativo">Sem pessoas</option>
                <option value="todos">Todos</option>
              </>
            )}
          </select>
        </label>

        <label className="flex min-w-[180px] flex-1 flex-col gap-1">
          <span className="label-mono">Procurar</span>
          <span className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input className="input pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome, email, cargo…" />
          </span>
        </label>

        <div className="pb-0.5">
          <Tabs
            value={area}
            onChange={setArea}
            items={[
              { key: "pessoas", label: "Pessoas", count: countPerson(personState) },
              { key: "equipas" as const, label: "Equipas", count: countTeam(teamState) },
              { key: "estrutura" as const, label: "Departamentos", count: countDept(deptState) },
            ]}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Ativos" value={ativos} sub={monthLabel(month)} icon={<Users size={15} />} delay={0} />
        <Stat label="Em entrada" value={emEntrada} sub={`admitidos há menos de ${ENTRY_MONTHS} meses`} icon={<Sparkles size={15} />} accent="var(--sky)" delay={40} />
        <Stat label="Suspensos" value={suspensos} sub="sem contagem para comissões" icon={<Users size={15} />} accent="var(--amber)" delay={80} />
        <Stat label="Inativos" value={inativos} sub="já saíram da empresa" icon={<Users size={15} />} accent="var(--rose)" delay={120} />
      </div>

      <div className="card rise mt-6 overflow-hidden" style={{ animationDelay: "160ms" }}>
        {loading ? (
          <div className="px-6 py-16 text-center text-[13px] text-ink-3">A carregar…</div>
        ) : area === "pessoas" ? (
          !listPeople.length ? (
            <Empty title="Nenhuma pessoa neste filtro" text={"Não há registos com este estado em " + monthLabel(month) + ". Muda o mês ou o estado."} />
          ) : (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-left text-ink-3">
                  <th className="label-mono px-4 py-3 font-normal">Pessoa</th>
                  <th className="label-mono px-4 py-3 font-normal">Departamento</th>
                  <th className="label-mono px-4 py-3 font-normal">Admissão</th>
                  <th className="label-mono px-4 py-3 font-normal">Saída</th>
                  <th className="label-mono px-4 py-3 font-normal">Estado</th>
                </tr>
              </thead>
              <tbody>
                {listPeople.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-b-0 hover:bg-surface-2/60">
                    <td className="px-4 py-2.5">
                      <Link to="/funcionarios" className="font-medium hover:text-volt">{p.name}</Link>
                      <div className="text-[11.5px] text-ink-3">{p.positionTitle ?? "Sem cargo"}</div>
                    </td>
                    <td className="px-4 py-2.5 text-ink-2">{p.departmentName ?? "—"}</td>
                    <td className="num px-4 py-2.5 text-ink-2">{p.hireDate}</td>
                    <td className="num px-4 py-2.5 text-ink-2">{p.terminationDate ?? "—"}</td>
                    <td className="px-4 py-2.5">{stateChip(p.state)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : area === "equipas" ? (
          !listTeams.length ? (
            <Empty title="Nenhuma equipa neste filtro" text={"Não há equipas com este estado em " + monthLabel(month) + "."} />
          ) : (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-left text-ink-3">
                  <th className="label-mono px-4 py-3 font-normal">Equipa</th>
                  <th className="label-mono px-4 py-3 font-normal">Chefe</th>
                  <th className="label-mono px-4 py-3 font-normal">Membros</th>
                  <th className="label-mono px-4 py-3 font-normal">Períodos</th>
                  <th className="label-mono px-4 py-3 font-normal">Estado</th>
                </tr>
              </thead>
              <tbody>
                {listTeams.map((t) => {
                  const members = t.members.filter((m) => m.status !== "inativo");
                  return (
                    <tr key={t.id} className="border-b border-line last:border-b-0 hover:bg-surface-2/60">
                      <td className="px-4 py-2.5">
                        <Link to="/equipas" className="font-medium hover:text-volt">{t.name}</Link>
                        <div className="text-[11.5px] text-ink-3">{t.description || "Sem descrição"}</div>
                      </td>
                      <td className="px-4 py-2.5 text-ink-2">{t.leaderName ?? "Sem chefe"}</td>
                      <td className="num px-4 py-2.5 text-ink-2">{members.length}</td>
                      <td className="px-4 py-2.5 text-ink-3">
                        {t.periods.length
                          ? t.periods.map((p) => p.startDate + " → " + (p.endDate ?? "aberta")).join("  ·  ")
                          : "sem períodos"}
                      </td>
                      <td className="px-4 py-2.5">{stateChip(t.open ? "ativa" : "fechada")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        ) : !listStructure.length ? (
          <Empty title="Nenhum departamento neste filtro" text="Não há departamentos com pessoas nesse mês." />
        ) : (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-left text-ink-3">
                <th className="label-mono px-4 py-3 font-normal">Departamento</th>
                <th className="label-mono px-4 py-3 font-normal">Pessoas no mês</th>
                <th className="label-mono px-4 py-3 font-normal">Total registado</th>
                <th className="label-mono px-4 py-3 font-normal">Estado</th>
              </tr>
            </thead>
            <tbody>
              {listStructure.map((d) => (
                <tr key={d.id} className="border-b border-line last:border-b-0 hover:bg-surface-2/60">
                  <td className="px-4 py-2.5">
                    <Link to="/departamentos" className="inline-flex items-center gap-2 font-medium hover:text-volt">
                      <span className="h-2 w-2 rounded-full" style={{ background: d.color }} />
                      {d.name}
                    </Link>
                    <div className="text-[11.5px] text-ink-3">{d.description || "Sem descrição"}</div>
                  </td>
                  <td className="num px-4 py-2.5 text-ink-2">{d.headcount}</td>
                  <td className="num px-4 py-2.5 text-ink-3">{d.total}</td>
                  <td className="px-4 py-2.5">{stateChip(d.ativo ? "ativo" : "inativo")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="card rise p-5 lg:col-span-2" style={{ animationDelay: "200ms" }}>
          <div className="label-mono mb-3 flex items-center gap-2">
            <Landmark size={13} />
            Acesso rápido
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { to: "/departamentos", label: "Departamentos e cargos", text: "Estrutura e funções" },
              { to: "/equipas", label: "Equipas", text: "Chefes e elementos" },
              { to: "/funcionarios", label: "Funcionários", text: "Ficha de cada pessoa" },
              { to: "/comercializadores", label: "Comercializadores", text: "Parceiros e fornecedores" },
            ].map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="group flex items-center justify-between rounded-[10px] border border-line bg-bg/50 px-3.5 py-3 transition hover:border-volt/40 hover:bg-volt/5"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{l.label}</span>
                  <span className="block truncate text-[11.5px] text-ink-3">{l.text}</span>
                </span>
                <ArrowUpRight size={14} className="shrink-0 text-ink-3 transition group-hover:text-volt" />
              </Link>
            ))}
          </div>
        </div>

        <div className="card rise p-5" style={{ animationDelay: "240ms" }}>
          <div className="label-mono mb-3 flex items-center gap-2">
            <Contact size={13} />
            A minha conta
          </div>
          <div className="text-[13px] font-medium">{me?.name ?? "—"}</div>
          <div className="mt-0.5 text-[11.5px] text-ink-3">{me?.email ?? ""}</div>
          <div className="mt-3 text-[12px] text-ink-2">
            <span className="text-ink-3">Perfil: </span>
            {me?.role ?? "—"}
          </div>
          <div className="mt-3 border-t border-line pt-3 text-[11.5px] text-ink-3">
            <div>{n(deps.data)} departamentos · {n(positions.data)} cargos</div>
            <div>{n(teams.data)} equipas · {n(sups.data)} comercializadores</div>
          </div>
        </div>
      </div>
    </>
  );
}

function n(v: unknown) {
  return Array.isArray(v) ? v.length : 0;
}
