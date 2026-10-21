import { useMemo, useState } from "react";
import { Plus, Check, X, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { useAbsences, useCreateAbsence, useEmployeeOptions, useRemoveAbsence, useSetAbsenceStatus } from "../queries/hr";
import { useMe } from "../queries/me";
import { PageHeader, Pill, Avatar, Modal, Field, SubmitRow, Empty, TableSkeleton, Tabs } from "../components/ui/kit";
import { ABSENCE_TYPE, APPROVAL } from "../lib/labels";
import { errMsg, fmtDate, monthLabel, today } from "../lib/format";

type AbsType = "ferias" | "baixa" | "falta" | "formacao" | "outro";

function AbsenceForm({ onClose, isSelf }: { onClose: () => void; isSelf: boolean }) {
  const emps = useEmployeeOptions();
  const create = useCreateAbsence();
  const [employeeId, setEmp] = useState<number>(0);
  const [type, setType] = useState<AbsType>("ferias");
  const [startDate, setStart] = useState(today());
  const [endDate, setEnd] = useState(today());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if (endDate < startDate) return setError("A data de fim deve ser posterior à de início.");
        if (!isSelf && !employeeId) return setError("Escolha um funcionário.");
        try {
          await create.mutateAsync({ employeeId: employeeId || 0, type, startDate, endDate, notes: notes || null });
          onClose();
        } catch (err) {
          setError(errMsg(err));
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {!isSelf && (
          <Field label="Funcionário" className="sm:col-span-2">
            <select className="input" value={employeeId} onChange={(e) => setEmp(Number(e.target.value))} required>
              <option value={0}>Escolher…</option>
              {emps.data?.filter((x) => x.status !== "inativo").map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Tipo" className="sm:col-span-2">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(ABSENCE_TYPE) as AbsType[]).map((k) => (
              <button type="button" key={k} onClick={() => setType(k)} className={`h-9 rounded-[9px] border px-3 text-[12.5px] transition ${type === k ? "border-volt/50 bg-volt/10 text-volt" : "border-line text-ink-2 hover:text-ink"}`}>
                {ABSENCE_TYPE[k].label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Início"><input aria-label="Início" type="date" className="input" value={startDate} onChange={(e) => { setStart(e.target.value); if (e.target.value > endDate) setEnd(e.target.value); }} /></Field>
        <Field label="Fim"><input aria-label="Fim" type="date" className="input" value={endDate} min={startDate} onChange={(e) => setEnd(e.target.value)} /></Field>
        <Field label="Observações" className="sm:col-span-2"><textarea aria-label="Observações" className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <SubmitRow pending={create.isPending} onCancel={onClose} error={error} label="Submeter pedido" />
    </form>
  );
}

function MonthCalendar({ items }: { items: { employeeName: string; type: string; startDate: string; endDate: string; status: string }[] }) {
  const [offset, setOffset] = useState(0);
  const base = new Date();
  const first = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  const key = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, "0")}`;
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const cells = Array.from({ length: lead + daysInMonth }, (_, i) => (i < lead ? null : i - lead + 1));
  const approved = items.filter((a) => a.status !== "rejeitado");
  const t = today();
  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="font-display text-[16px] font-semibold">{monthLabel(key)}</div>
        <div className="flex gap-1">
          <button className="btn-icon" onClick={() => setOffset(offset - 1)}><ChevronLeft size={16} /></button>
          <button className="btn-icon" onClick={() => setOffset(offset + 1)}><ChevronRight size={16} /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {["S", "T", "Q", "Q", "S", "S", "D"].map((d, i) => <div key={i} className="label-mono pb-2">{d}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const ds = `${key}-${String(d).padStart(2, "0")}`;
          const on = approved.filter((a) => a.startDate <= ds && a.endDate >= ds);
          const weekend = i % 7 >= 5;
          return (
            <div key={i} title={on.map((a) => `${a.employeeName} · ${ABSENCE_TYPE[a.type]?.label}`).join("\n")} className={`relative flex h-11 flex-col items-center justify-center rounded-lg text-[12px] ${ds === t ? "bg-volt/15 text-volt" : weekend ? "text-ink-3" : "text-ink-2"} ${on.length ? "bg-surface-2" : ""}`}>
              <span className="num">{d}</span>
              {on.length > 0 && (
                <div className="mt-1 flex gap-0.5">
                  {on.slice(0, 3).map((a, j) => <span key={j} className="h-1 w-1 rounded-full" style={{ background: a.status === "pendente" ? "var(--amber)" : ABSENCE_TYPE[a.type]?.color }} />)}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-3 border-t border-line pt-4 text-[11.5px] text-ink-2">
        {Object.entries(ABSENCE_TYPE).map(([k, v]) => <span key={k} className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full" style={{ background: v.color }} />{v.label}</span>)}
        <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-amber" />Pendente</span>
      </div>
    </div>
  );
}

export default function AbsencesPage() {
  const me = useMe();
  const abs = useAbsences();
  const setStatus = useSetAbsenceStatus();
  const remove = useRemoveAbsence();
  const role = me.data?.role;
  const canApprove = role === "admin" || role === "rh";
  const isManager = canApprove; // mostra ações de aprovação
  const isSelf = role === "vendedor" || role === "chefe"; // gestor/chefe pedem para si ou (chefe) para a equipa
  const [tab, setTab] = useState<"pendente" | "aprovado" | "rejeitado" | "todos">("pendente");
  const [open, setOpen] = useState(false);
  const list = useMemo(() => (abs.data ?? []).filter((a) => tab === "todos" || a.status === tab), [abs.data, tab]);
  const c = (s: string) => (abs.data ?? []).filter((a) => s === "todos" || a.status === s).length;
  const selfBlocked = isSelf && !me.data?.employeeId;

  return (
    <div>
      <PageHeader eyebrow="Recursos Humanos" title={canApprove ? "Férias e ausências" : role === "chefe" ? "Ausências da minha equipa" : "As minhas ausências"}>
        <button className="btn btn-primary" onClick={() => setOpen(true)} disabled={selfBlocked} title={selfBlocked ? "Conta sem funcionário associado" : undefined}>
          <Plus size={15} /> {isManager ? "Registar ausência" : "Pedir férias / ausência"}
        </button>
      </PageHeader>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          <div className="mb-4">
            <Tabs value={tab} onChange={setTab} items={[
              { key: "pendente", label: "Pendentes", count: c("pendente") },
              { key: "aprovado", label: "Aprovados", count: c("aprovado") },
              { key: "rejeitado", label: "Rejeitados", count: c("rejeitado") },
              { key: "todos", label: "Todos", count: c("todos") },
            ]} />
          </div>
          <div className="card overflow-hidden">
            {abs.isLoading ? <TableSkeleton cols={5} /> : abs.isError ? <Empty title="Não foi possível carregar" text={errMsg(abs.error)} /> : !list.length ? (
              <Empty title={tab === "pendente" ? "Nenhum pedido pendente" : "Sem registos"} text={tab === "pendente" ? "Tudo em dia." : undefined} />
            ) : (
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead><tr><th>Funcionário</th><th>Tipo</th><th>Período</th><th className="text-right">Dias úteis</th><th>Estado</th><th aria-label="Ações" /></tr></thead>
                  <tbody>
                    {list.map((a) => (
                      <tr key={a.id}>
                        <td><div className="flex items-center gap-2.5"><Avatar name={a.employeeName} size={28} color={ABSENCE_TYPE[a.type]?.color} /><div><div className="font-medium">{a.employeeName}</div>{a.notes && <div className="max-w-[220px] truncate text-[11.5px] text-ink-3">{a.notes}</div>}</div></div></td>
                        <td><span style={{ color: ABSENCE_TYPE[a.type]?.color }}>{ABSENCE_TYPE[a.type]?.label}</span></td>
                        <td className="num whitespace-nowrap text-[12.5px]">{fmtDate(a.startDate)} <span className="text-ink-3">→</span> {fmtDate(a.endDate)}</td>
                        <td className="num text-right">{a.days}</td>
                        <td><Pill {...APPROVAL[a.status]} /></td>
                        <td className="whitespace-nowrap text-right">
                          {isManager && a.status === "pendente" && (
                            <>
                              <button className="btn-icon text-volt hover:bg-volt/10" title="Aprovar" onClick={() => setStatus.mutate({ id: a.id, status: "aprovado" })}><Check size={15} /></button>
                              <button className="btn-icon text-danger hover:bg-danger/10" title="Rejeitar" onClick={() => setStatus.mutate({ id: a.id, status: "rejeitado" })}><X size={15} /></button>
                            </>
                          )}
                          {(isManager || a.status === "pendente") && (
                            <button className="btn-icon" title="Eliminar" onClick={() => remove.mutate({ id: a.id })}><Trash2 size={14} /></button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        <div>{abs.data && <MonthCalendar items={abs.data} />}</div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={isManager ? "Registar ausência" : "Novo pedido"}>
        {open && <AbsenceForm onClose={() => setOpen(false)} isSelf={isSelf && role !== "chefe"} />}
      </Modal>
    </div>
  );
}
