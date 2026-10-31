// BUILD:1
import { useMemo, useState } from "react";
import { Filter, Download, Users, Loader2 } from "lucide-react";
import { PageHeader, Empty, Field, Stat, TableSkeleton } from "../components/ui/kit";
import { BarsChart } from "../components/charts";
import { useFiltragemOptions, useFiltragemRun } from "../queries/iberdrola";
import { fmtEur2, monthLabel } from "../lib/format";

const SERVICES = ["LUZ", "GÁS", "DUAL", "SOLAR"];

/** Multi-seletor em popover de checkboxes: escolhe-se várias opções no mesmo filtro. */
function MultiSelect({ label, options, value, onChange, width = "w-64" }: { label: string; options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void; width?: string }) {
  const [open, setOpen] = useState(false);
  const selected = new Set(value);
  const toggle = (v: string) => {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange([...next]);
  };
  return (
    <div className={`relative ${width}`}>
      <button type="button" className="input flex h-10 w-full items-center justify-between gap-2 text-left" onClick={() => setOpen(!open)}>
        <span className="truncate text-[12.5px]">{value.length ? `${label} (${value.length})` : label}</span>
        <span className="text-ink-3">▾</span>
      </button>
      {open && (
        <>
          <button type="button" tabIndex={-1} aria-label="Fechar" className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-[10px] border border-line bg-surface p-1.5 shadow-2xl">
            <button type="button" className="mb-1 w-full rounded-[6px] px-2 py-1.5 text-left text-[11.5px] text-ink-3 hover:bg-volt/10" onClick={() => onChange([])}>
              Limpar seleção
            </button>
            {options.map((o) => (
              <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 text-[12px] hover:bg-volt/10">
                <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--volt)]" checked={selected.has(o.value)} onChange={() => toggle(o.value)} />
                <span className="truncate">{o.label}</span>
              </label>
            ))}
            {!options.length && <div className="px-2 py-3 text-center text-[11.5px] text-ink-3">Sem opções nesta fonte.</div>}
          </div>
        </>
      )}
    </div>
  );
}

/** Página "Filtragem": cruza vários filtros ao mesmo tempo sobre os autos Iberdrola ou
 *  sobre a base de vendas do CRM, e mostra o total, a lista e os gráficos. */
export default function FiltragemPage() {
  const options = useFiltragemOptions();

  const [source, setSource] = useState<"autos" | "crm">("crm");
  const [month, setMonth] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [q, setQ] = useState("");

  // Historico da venda (so a base do CRM tem historico de estados).
  const [dateMode, setDateMode] = useState<"venda" | "estado">("venda");
  const [passedStatuses, setPassedStatuses] = useState<string[]>([]);
  const [enteredStatuses, setEnteredStatuses] = useState<string[]>([]);
  const [leftStatuses, setLeftStatuses] = useState<string[]>([]);
  const [statusOnDate, setStatusOnDate] = useState<string[]>([]);
  const [swapped, setSwapped] = useState<"todos" | "com" | "sem">("todos");
  const [fromEmployeeIds, setFromEmployeeIds] = useState<string[]>([]);
  const [minDays, setMinDays] = useState("");

  const statusOptions = source === "autos" ? (options.data?.autoStatuses ?? []) : (options.data?.salesStatuses ?? []);
  // Estados que ja nao estao em uso continuam a existir no historico.
  const historyStatusOptions = options.data?.historyStatuses ?? statusOptions;

  const input = useMemo(() => ({
    source,
    month: source === "autos" && month ? month : undefined,
    from: from || undefined,
    to: to || undefined,
    dateMode,
    employeeIds: employeeIds.map(Number),
    statuses,
    services,
    teamIds: teamIds.map(Number),
    passedStatuses: source === "crm" ? passedStatuses : [],
    enteredStatuses: source === "crm" ? enteredStatuses : [],
    leftStatuses: source === "crm" ? leftStatuses : [],
    statusOnDate: source === "crm" ? statusOnDate : [],
    swapped: source === "crm" && swapped !== "todos" ? swapped : undefined,
    fromEmployeeIds: source === "crm" ? fromEmployeeIds.map(Number) : [],
    minDaysInStatus: minDays === "" ? undefined : Number(minDays),
    q: q.trim() || undefined,
  }), [source, month, from, to, dateMode, employeeIds, statuses, services, teamIds,
       passedStatuses, enteredStatuses, leftStatuses, statusOnDate, swapped, fromEmployeeIds, minDays, q]);

  const run = useFiltragemRun(input);
  const d = run.data;

  function clearAll() {
    setMonth("");
    setFrom("");
    setTo("");
    setEmployeeIds([]);
    setStatuses([]);
    setServices([]);
    setTeamIds([]);
    setQ("");
    setDateMode("venda");
    setPassedStatuses([]);
    setEnteredStatuses([]);
    setLeftStatuses([]);
    setStatusOnDate([]);
    setSwapped("todos");
    setFromEmployeeIds([]);
    setMinDays("");
  }

  /** Exporta o resultado filtrado para CSV. */
  function exportCsv() {
    if (!d) return;
    const head = [
      "ID venda", "Colaborador", "Cliente", "Data", "Mês", "Estado", "Serviço", "Percurso", "Dias no estado atual", "Comercial anterior",
    ];
    const lines = d.rows.map((r) => [
      r.idVenda,
      r.employeeName,
      r.clientName ?? "",
      r.date,
      r.month ?? "",
      r.status,
      r.service,
      (r.timeline ?? []).map((s) => `${s.status} (${s.on})`).join(" > "),
      r.daysInCurrent ?? "",
      (r.fromEmployees ?? []).join(", "),
    ]);
    const csv = [head, ...lines].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `filtragem-${source}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  const activeFilters = [
    month && `Mês: ${monthLabel(month)}`,
    from && `de ${from.split("-").reverse().join("/")}`,
    to && `até ${to.split("-").reverse().join("/")}`,
    employeeIds.length && `${employeeIds.length} colaborador${employeeIds.length === 1 ? "" : "es"}`,
    statuses.length && `Estado: ${statuses.join(", ")}`,
    services.length && `Serviço: ${services.join(", ")}`,
    teamIds.length && `${teamIds.length} equipa${teamIds.length === 1 ? "" : "s"}`,
    source === "crm" && dateMode === "estado" && "Datas: mudança de estado",
    source === "crm" && passedStatuses.length && `Passou por: ${passedStatuses.join(", ")}`,
    source === "crm" && enteredStatuses.length && `Entrou em: ${enteredStatuses.join(", ")}`,
    source === "crm" && leftStatuses.length && `Saiu de: ${leftStatuses.join(", ")}`,
    source === "crm" && statusOnDate.length && `Estado à data: ${statusOnDate.join(", ")}`,
    source === "crm" && swapped === "com" && "Trocou de comercial",
    source === "crm" && swapped === "sem" && "Nunca trocou de comercial",
    source === "crm" && fromEmployeeIds.length && `Veio de: ${fromEmployeeIds.length} colaborador${fromEmployeeIds.length === 1 ? "" : "es"}`,
    source === "crm" && minDays && `Mín. ${minDays} dias num estado`,
    q.trim() && `Pesquisa: ${q.trim()}`,
  ].filter(Boolean) as string[];

  return (
    <div className="p-5 lg:p-7">
      <PageHeader eyebrow="Análise" title="Filtragem" subtitle="Cruza vários filtros ao mesmo tempo e vê quantas vendas correspondem, com lista detalhada e gráficos. Ex.: colaborador Daniel, entre 01/10 e 31/10, quantas vendas tem no estado Baixa.">
        <div className="flex gap-2">
          <button type="button" className="btn btn-ghost" onClick={clearAll} disabled={!activeFilters.length}>
            <Filter size={15} /> Limpar filtros
          </button>
          <button type="button" className="btn btn-volt" onClick={exportCsv} disabled={!d?.rows.length}>
            <Download size={15} /> Exportar CSV
          </button>
        </div>
      </PageHeader>

      <div className="card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[11.5px] font-medium uppercase tracking-wide text-ink-3">Fonte dos dados</span>
          <div className="flex gap-1.5">
            <button type="button" className={`btn ${source === "autos" ? "btn-volt" : "btn-ghost"} px-3 py-1.5 text-[12px]`} onClick={() => { setSource("autos"); setStatuses([]); }}>Autos Iberdrola</button>
            <button type="button" className={`btn ${source === "crm" ? "btn-volt" : "btn-ghost"} px-3 py-1.5 text-[12px]`} onClick={() => { setSource("crm"); setStatuses([]); }}>Base de vendas do CRM</button>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {source === "autos" && (
            <Field label="Mês do auto">
              <select className="input h-10 w-48" value={month} onChange={(e) => setMonth(e.target.value)}>
                <option value="">Todos os meses carregados</option>
                {(options.data?.months ?? []).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
            </Field>
          )}
          <Field label="De">
            <input type="date" className="input num h-10 w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Até">
            <input type="date" className="input num h-10 w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Colaboradores">
            <MultiSelect
              label="Todos os colaboradores"
              width="w-64"
              value={employeeIds}
              onChange={setEmployeeIds}
              options={(options.data?.employees ?? []).map((e) => ({ value: String(e.id), label: e.name }))}
            />
          </Field>
          <Field label="Estados">
            <MultiSelect
              label="Todos os estados"
              width="w-56"
              value={statuses}
              onChange={setStatuses}
              options={statusOptions.map((s) => ({ value: s, label: s }))}
            />
          </Field>
          <Field label="Serviços">
            <MultiSelect label="Todos os serviços" width="w-48" value={services} onChange={setServices} options={SERVICES.map((s) => ({ value: s, label: s }))} />
          </Field>
          <Field label="Equipas">
            <MultiSelect
              label="Todas as equipas"
              width="w-56"
              value={teamIds}
              onChange={setTeamIds}
              options={(options.data?.teams ?? []).map((t) => ({ value: String(t.id), label: t.name }))}
            />
          </Field>
          <Field label="Pesquisa (ID venda, cliente ou colaborador)">
            <input className="input h-10 w-64" placeholder="Ex.: V12345" value={q} onChange={(e) => setQ(e.target.value)} />
          </Field>
        </div>

        {source === "crm" && (
          <div className="mt-4 border-t border-line pt-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-display text-[12.5px] font-semibold">Histórico da venda</div>
                <div className="text-[11px] text-ink-3">Filtra pelo percurso da venda ao longo do tempo, não só pelo estado em que está hoje.</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11.5px] text-ink-3">Datas referem-se a</span>
                <div className="flex gap-1.5">
                  <button type="button" className={`btn ${dateMode === "venda" ? "btn-volt" : "btn-ghost"} px-3 py-1.5 text-[12px]`} onClick={() => setDateMode("venda")}>Data da venda</button>
                  <button type="button" className={`btn ${dateMode === "estado" ? "btn-volt" : "btn-ghost"} px-3 py-1.5 text-[12px]`} onClick={() => setDateMode("estado")}>Data da mudança de estado</button>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <Field label="Passou por um destes estados">
                <MultiSelect label="Qualquer estado" width="w-60" value={passedStatuses} onChange={setPassedStatuses} options={historyStatusOptions.map((s) => ({ value: s, label: s }))} />
              </Field>
              <Field label="Entrou num destes estados no intervalo">
                <MultiSelect label="Nenhum" width="w-60" value={enteredStatuses} onChange={setEnteredStatuses} options={historyStatusOptions.map((s) => ({ value: s, label: s }))} />
              </Field>
              <Field label="Saiu de um destes estados no intervalo">
                <MultiSelect label="Nenhum" width="w-60" value={leftStatuses} onChange={setLeftStatuses} options={historyStatusOptions.map((s) => ({ value: s, label: s }))} />
              </Field>
              {dateMode === "estado" && (
                <Field label={to ? `Estado em que estava a ${to.split("-").reverse().join("/")}` : "Estado à data (preenche o Até)"}>
                  <MultiSelect label="Qualquer estado" width="w-60" value={statusOnDate} onChange={setStatusOnDate} options={historyStatusOptions.map((s) => ({ value: s, label: s }))} />
                </Field>
              )}
              <Field label="Trocas de comercial">
                <select className="input h-10 w-52" value={swapped} onChange={(e) => setSwapped(e.target.value as "todos" | "com" | "sem")}>
                  <option value="todos">Indiferente</option>
                  <option value="com">Trocou de comercial</option>
                  <option value="sem">Nunca trocou de comercial</option>
                </select>
              </Field>
              {swapped === "com" && (
                <Field label="Veio de (comercial anterior)">
                  <MultiSelect label="Qualquer comercial" width="w-64" value={fromEmployeeIds} onChange={setFromEmployeeIds} options={(options.data?.employees ?? []).map((e) => ({ value: String(e.id), label: e.name }))} />
                </Field>
              )}
              <Field label="Mínimo de dias num estado">
                <input type="number" min={0} placeholder="ex.: 30" className="input num h-10 w-32" value={minDays} onChange={(e) => setMinDays(e.target.value)} />
              </Field>
            </div>
          </div>
        )}

        {activeFilters.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
            <span className="text-[11.5px] text-ink-3">Filtros ativos:</span>
            {activeFilters.map((f) => (
              <span key={f} className="rounded-full bg-volt/15 px-2.5 py-[3px] text-[11px] text-volt">{f}</span>
            ))}
          </div>
        )}
      </div>

      {run.isLoading ? (
        <div className="card mt-5 p-5"><div className="skeleton h-24 rounded-[12px]" /></div>
      ) : (
        <>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="VENDAS ENCONTRADAS" value={String(d?.total ?? 0)} accent="var(--volt)" icon={<Filter size={16} />} delay={0} />
            <Stat label="ESTADOS DISTINTOS" value={String(d?.byStatus.length ?? 0)} accent="var(--sky)" icon={<Users size={16} />} delay={60} />
            <Stat label="COLABORADORES" value={String(d?.byEmployee.length ?? 0)} accent="var(--amber)" icon={<Users size={16} />} delay={90} />
            <Stat label="SERVIÇOS" value={String(d?.byService.length ?? 0)} accent="var(--sky)" icon={<Filter size={16} />} delay={120} />
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <div className="card p-5">
              <div className="mb-3 font-display text-[13px] font-semibold">Por estado</div>
              {d?.byStatus.length ? <BarsChart data={d.byStatus.map((x) => ({ nome: x.name, valor: x.count }))} dataKey="valor" xKey="nome" money={false} color="#206a9f" /> : <div className="text-[12px] text-ink-3">Sem dados.</div>}
            </div>
            <div className="card p-5">
              <div className="mb-3 font-display text-[13px] font-semibold">Por colaborador (top 10)</div>
              {d?.byEmployee.length ? <BarsChart data={d.byEmployee.slice(0, 10).map((x) => ({ nome: x.name, valor: x.count }))} dataKey="valor" xKey="nome" money={false} color="#38bdf8" /> : <div className="text-[12px] text-ink-3">Sem dados.</div>}
            </div>
            <div className="card p-5">
              <div className="mb-3 font-display text-[13px] font-semibold">Por mês</div>
              {d?.byMonth.length ? <BarsChart data={[...d.byMonth].sort((a, b) => a.name.localeCompare(b.name)).map((x) => ({ nome: monthLabel(x.name) || x.name, valor: x.count }))} dataKey="valor" xKey="nome" money={false} color="#34d399" /> : <div className="text-[12px] text-ink-3">Sem dados.</div>}
            </div>
          </div>

          {source === "crm" && !!d?.byDays.length && (
            <div className="card mt-5 p-5">
              <div className="mb-1 font-display text-[13px] font-semibold">Tempo médio em cada estado (dias)</div>
              <div className="mb-3 text-[11px] text-ink-3">Média sobre {d.byDays.reduce((m, x) => Math.max(m, x.samples), 0)} amostras de permanência fechada. Não inclui o estado atual, que ainda não terminou.</div>
              <BarsChart data={[...d.byDays].sort((a, b) => b.days - a.days).map((x) => ({ nome: x.name, valor: x.days }))} dataKey="valor" xKey="nome" money={false} color="#f59e0b" />
            </div>
          )}

          <div className="card mt-5 overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <div>
                <div className="font-display text-[13px] font-semibold">Vendas encontradas</div>
                <div className="text-[11px] text-ink-3">{d?.total ?? 0} linha{(d?.total ?? 0) === 1 ? "" : "s"} com os filtros atuais</div>
              </div>
            </div>
            {!d?.rows.length ? (
              <Empty title="Nenhuma venda corresponde" text="Alarga o intervalo de datas ou limpa alguns filtros." />
            ) : (
              <div className="max-h-[560px] overflow-auto">
                <table className="w-full text-[12.5px]">
                  <thead className="sticky top-0 bg-surface">
                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-3">
                      <th className="px-4 py-2.5 font-medium">ID venda</th>
                      <th className="px-4 py-2.5 font-medium">Colaborador</th>
                      <th className="px-4 py-2.5 font-medium">Cliente</th>
                      <th className="px-4 py-2.5 font-medium">Data</th>
                      <th className="px-4 py-2.5 font-medium">Mês</th>
                      <th className="px-4 py-2.5 font-medium">Estado</th>
                      <th className="px-4 py-2.5 font-medium">Serviço</th>
                      {source === "crm" && <th className="px-4 py-2.5 font-medium">Percurso da venda</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {d.rows.slice(0, 500).map((r) => (
                      <tr key={r.id} className="hover:bg-volt/5">
                        <td className="num px-4 py-2 text-ink-2">{r.idVenda}</td>
                        <td className="px-4 py-2">{r.employeeName}</td>
                        <td className="px-4 py-2 text-ink-2">{r.clientName ?? "—"}</td>
                        <td className="num px-4 py-2 text-ink-2">{r.date ? r.date.split("-").reverse().join("/") : "—"}</td>
                        <td className="px-4 py-2 text-ink-2">{r.month ? monthLabel(r.month) : "—"}</td>
                        <td className="px-4 py-2">{r.status}</td>
                        <td className="px-4 py-2 text-ink-2">{r.service || "—"}</td>
                        {source === "crm" && (
                          <td className="px-4 py-2">
                            {r.timeline?.length ? (
                              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px] text-ink-2">
                                {r.timeline.map((s, i) => (
                                  <span key={`${s.status}-${s.on}-${i}`} className="flex items-center gap-1.5">
                                    {i > 0 && <span className="text-ink-3">→</span>}
                                    <span className="rounded-full bg-ink/5 px-2 py-[2px]" title={s.on.split("-").reverse().join("/") + (s.days != null ? ` · ${s.days} dias` : " · em curso")}>
                                      {s.status}
                                    </span>
                                  </span>
                                ))}
                                {r.daysInCurrent != null && <span className="text-ink-3">· há {r.daysInCurrent} dias em {r.status}</span>}
                              </div>
                            ) : (
                              <span className="text-ink-3">Sem histórico</span>
                            )}
                            {r.swapped && !!r.fromEmployees.length && (
                              <div className="mt-1 text-[11px] text-amber-600">Veio de {r.fromEmployees.join(", ")}</div>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {d.rows.length > 500 && <div className="border-t border-line px-5 py-2.5 text-[11.5px] text-ink-3">A mostrar as primeiras 500 de {d.rows.length} linhas. Exporta o CSV para veres tudo.</div>}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
