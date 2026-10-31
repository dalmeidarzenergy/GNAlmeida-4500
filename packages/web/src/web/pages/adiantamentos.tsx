import { useMemo, useState } from "react";
import { Plus, Trash2, Loader2, Pencil, Wallet, Check, Undo2, X } from "lucide-react";
import { PageHeader, Empty, Field, Modal, Stat, SubmitRow, TableSkeleton } from "../components/ui/kit";
import { useAdvances, useAdvanceCreate, useAdvanceUpdate, useAdvanceRemove, useAdvanceDeduct } from "../queries/iberdrola";
import { useEmployeeOptions } from "../queries/hr";
import { useMe } from "../queries/me";
import { errMsg, fmtEur2, thisMonth } from "../lib/format";

type Advance = {
  id: number;
  employeeId: number;
  employeeName: string;
  date: string;
  amount: number;
  repaid: number;
  note: string | null;
  settled: boolean;
  deducted: number;
  remaining: number;
};

/** Página "Adiantamentos": dinheiro entregue a colaboradores por conta de comissões futuras.
 *  O saldo fica pendente e vai sendo descontado mês a mês nos Autos Finais até estar liquidado. */
export default function AdiantamentosPage() {
  const me = useMe();
  const canEdit = me.data?.permissions?.adiantamentos?.edit ?? false;
  const { data, isLoading } = useAdvances();
  const emps = useEmployeeOptions();
  const create = useAdvanceCreate();
  const update = useAdvanceUpdate();
  const remove = useAdvanceRemove();
  const deduct = useAdvanceDeduct();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Advance | null>(null);
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [repaid, setRepaid] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Modal de desconto manual (corte num mês combinado fora do auto).
  const [dedOpen, setDedOpen] = useState(false);
  const [dedEmp, setDedEmp] = useState<number | null>(null);
  const [dedMonth, setDedMonth] = useState(thisMonth());
  const [dedAmount, setDedAmount] = useState("");
  const [dedNote, setDedNote] = useState("");
  const [dedError, setDedError] = useState<string | null>(null);

  const [filter, setFilter] = useState<"todos" | "pendentes" | "liquidadas">("pendentes");

  const rows = data?.rows ?? [];
  const totals = data?.totals;

  const filtered = useMemo(() => {
    if (filter === "pendentes") return rows.filter((r) => r.remaining > 0.005 && !r.settled);
    if (filter === "liquidadas") return rows.filter((r) => r.remaining <= 0.005 || r.settled);
    return rows;
  }, [rows, filter]);

  /** Saldo pendente por colaborador, para o resumo de cima. */
  const byEmployee = useMemo(() => {
    const map = new Map<number, { name: string; pending: number; total: number }>();
    for (const r of rows) {
      const row = map.get(r.employeeId) ?? { name: r.employeeName, pending: 0, total: 0 };
      row.total = Math.round((row.total + r.amount) * 100) / 100;
      if (!r.settled) row.pending = Math.round((row.pending + r.remaining) * 100) / 100;
      map.set(r.employeeId, row);
    }
    return [...map.values()].filter((x) => x.pending > 0.005).sort((a, b) => b.pending - a.pending);
  }, [rows]);

  function resetForm() {
    setEditing(null);
    setEmployeeId(null);
    setDate(new Date().toISOString().slice(0, 10));
    setAmount("");
    setRepaid("");
    setNote("");
    setError(null);
  }

  function openNew() {
    resetForm();
    setOpen(true);
  }

  function openEdit(a: Advance) {
    setEditing(a);
    setEmployeeId(a.employeeId);
    setDate(a.date);
    setAmount(String(a.amount));
    setRepaid(a.repaid ? String(a.repaid) : "");
    setNote(a.note ?? "");
    setError(null);
    setOpen(true);
  }

  async function submit() {
    setError(null);
    const value = Number(String(amount).replace(",", "."));
    const repaidValue = repaid.trim() ? Number(String(repaid).replace(",", ".")) : 0;
    if (employeeId == null) return setError("Escolhe o colaborador.");
    if (!date) return setError("Indica a data do adiantamento.");
    if (!Number.isFinite(value) || value <= 0) return setError("Indica um valor maior que 0 €.");
    if (!Number.isFinite(repaidValue) || repaidValue < 0) return setError("O valor devolvido não pode ser negativo.");
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, employeeId, date, amount: value, repaid: repaidValue, note: note.trim() || undefined, settled: editing.settled });
      } else {
        await create.mutateAsync({ employeeId, date, amount: value, repaid: repaidValue, note: note.trim() || undefined });
      }
      setOpen(false);
      resetForm();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function toggleSettled(a: Advance) {
    try {
      await update.mutateAsync({ id: a.id, employeeId: a.employeeId, date: a.date, amount: a.amount, repaid: a.repaid, note: a.note ?? undefined, settled: !a.settled });
    } catch (e) {
      window.alert(errMsg(e));
    }
  }

  async function onRemove(a: Advance) {
    if (!window.confirm(`Eliminar o adiantamento de ${fmtEur2(a.amount)} de ${a.employeeName}?`)) return;
    try {
      await remove.mutateAsync({ id: a.id });
    } catch (e) {
      window.alert(errMsg(e));
    }
  }

  async function submitDeduct() {
    setDedError(null);
    const value = Number(String(dedAmount).replace(",", "."));
    if (dedEmp == null) return setDedError("Escolhe o colaborador.");
    if (!Number.isFinite(value) || value <= 0) return setDedError("Indica um valor maior que 0 €.");
    try {
      await deduct.mutateAsync({ employeeId: dedEmp, month: dedMonth, amount: value, note: dedNote.trim() || undefined });
      setDedOpen(false);
      setDedAmount("");
      setDedNote("");
    } catch (e) {
      setDedError(errMsg(e));
    }
  }

  const pending = create.isPending || update.isPending;

  return (
    <div className="p-5 lg:p-7">
      <PageHeader
        eyebrow="Pagamentos"
        title="Adiantamentos"
        subtitle="Dinheiro entregue a colaboradores por conta de comissões futuras. O saldo fica pendente e vai sendo descontado mês a mês nos Autos Finais (botão Verificar Adiantamento) até estar liquidado."
      >
        {canEdit && (
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => { setDedEmp(null); setDedMonth(thisMonth()); setDedAmount(""); setDedNote(""); setDedError(null); setDedOpen(true); }} title="Registar um desconto mensal combinado fora do auto.">
              <Undo2 size={15} /> Desconto manual
            </button>
            <button type="button" className="btn btn-volt" onClick={openNew}>
              <Plus size={15} /> Novo adiantamento
            </button>
          </div>
        )}
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="TOTAL EMPRESTADO" value={fmtEur2(totals?.lent ?? 0)} accent="var(--sky)" icon={<Wallet size={16} />} delay={0} />
        <Stat label="DEVOLVIDO PELO COLABORADOR" value={fmtEur2(totals?.repaid ?? 0)} accent="var(--amber)" icon={<Undo2 size={16} />} delay={60} />
        <Stat label="JÁ DESCONTADO" value={fmtEur2(totals?.deducted ?? 0)} accent="var(--volt)" icon={<Check size={16} />} delay={90} />
        <Stat label="SALDO PENDENTE" value={fmtEur2(totals?.pending ?? 0)} accent="var(--danger)" icon={<Wallet size={16} />} delay={120} />
      </div>

      {byEmployee.length > 0 && (
        <div className="card mt-5 overflow-hidden">
          <div className="border-b border-line px-5 py-3">
            <div className="font-display text-[13px] font-semibold">Saldo pendente por colaborador</div>
            <div className="text-[11px] text-ink-3">Quem ainda tem adiantamento por descontar. Aplica o corte nos Autos Finais.</div>
          </div>
          <ul className="divide-y divide-line">
            {byEmployee.map((e) => (
              <li key={e.name} className="flex items-center gap-3 px-5 py-2.5 text-[12.5px]">
                <span className="min-w-0 flex-1 truncate">{e.name}</span>
                <span className="num text-ink-3">de {fmtEur2(e.total)}</span>
                <span className="num font-semibold text-danger">{fmtEur2(e.pending)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {([["pendentes", "Pendentes"], ["liquidadas", "Liquidadas"], ["todos", "Todos"]] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`btn ${filter === k ? "btn-volt" : "btn-ghost"} px-3 py-1.5 text-[12px]`}
            onClick={() => setFilter(k)}
          >
            {label}
            <span className="ml-1.5 text-ink-3">{k === "pendentes" ? rows.filter((r) => r.remaining > 0.005 && !r.settled).length : k === "liquidadas" ? rows.filter((r) => r.remaining <= 0.005 || r.settled).length : rows.length}</span>
          </button>
        ))}
      </div>

      <div className="card mt-4 overflow-hidden">
        {isLoading ? (
          <div className="p-5"><TableSkeleton rows={5} cols={6} /></div>
        ) : !filtered.length ? (
          <Empty title="Sem adiantamentos" text={filter === "pendentes" ? "Não há adiantamentos por descontar. Cria um novo adiantamento ou muda o filtro." : "Ainda não há adiantamentos registados."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-3">
                  <th className="px-4 py-2.5 font-medium">Colaborador</th>
                  <th className="px-4 py-2.5 font-medium">Data</th>
                  <th className="px-4 py-2.5 text-right font-medium">Valor</th>
                  <th className="px-4 py-2.5 text-right font-medium">Devolvido</th>
                  <th className="px-4 py-2.5 text-right font-medium">Descontado</th>
                  <th className="px-4 py-2.5 text-right font-medium">Por descontar</th>
                  <th className="px-4 py-2.5 font-medium">Nota</th>
                  {canEdit && <th className="px-4 py-2.5" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((a) => (
                  <tr key={a.id} className="hover:bg-volt/5">
                    <td className="px-4 py-2.5">
                      {a.employeeName}
                      {a.settled && <span className="ml-2 rounded-full bg-volt/15 px-2 py-[1px] text-[10px] uppercase tracking-wide text-volt">Liquidado</span>}
                    </td>
                    <td className="num px-4 py-2.5 text-ink-2">{a.date.split("-").reverse().join("/")}</td>
                    <td className="num px-4 py-2.5 text-right">{fmtEur2(a.amount)}</td>
                    <td className="num px-4 py-2.5 text-right text-ink-2">{fmtEur2(a.repaid)}</td>
                    <td className="num px-4 py-2.5 text-right text-ink-2">{fmtEur2(a.deducted)}</td>
                    <td className={`num px-4 py-2.5 text-right font-semibold ${a.remaining > 0.005 ? "text-danger" : "text-volt"}`}>{fmtEur2(a.remaining)}</td>
                    <td className="px-4 py-2.5 text-ink-3">{a.note ?? "—"}</td>
                    {canEdit && (
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" className="btn-icon" title={a.settled ? "Reabrir (volta a contar como pendente)" : "Marcar como liquidado"} onClick={() => toggleSettled(a)}>
                            {a.settled ? <X size={13} /> : <Check size={13} />}
                          </button>
                          <button type="button" className="btn-icon" title="Editar" onClick={() => openEdit(a)}>
                            <Pencil size={13} />
                          </button>
                          <button type="button" className="btn-icon hover:bg-rose/10 hover:text-rose" title="Eliminar" onClick={() => onRemove(a)}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Editar adiantamento" : "Novo adiantamento"}>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <Field label="Colaborador">
            <select className="input w-full" value={employeeId ?? ""} onChange={(e) => setEmployeeId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Escolhe o colaborador</option>
              {(emps.data ?? []).map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Data do adiantamento">
              <input type="date" className="input num w-full" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Valor emprestado (€)">
              <input type="number" step="0.01" min="0" className="input num w-full" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
          </div>
          <Field label="Já devolvido pelo colaborador (€) — opcional">
            <input type="number" step="0.01" min="0" className="input num w-full" placeholder="0.00" value={repaid} onChange={(e) => setRepaid(e.target.value)} />
            <span className="mt-1 block text-[11px] text-ink-3">Dinheiro que o colaborador já devolveu por fora do auto. Baixa o saldo pendente sem passar pelo desconto mensal.</span>
          </Field>
          <Field label="Nota (opcional)">
            <input className="input w-full" placeholder="Ex.: pedido a meio do mês" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="rounded-[10px] border border-line bg-surface-2 px-4 py-3 text-[11.5px] text-ink-2">
            O valor fica pendente e vai sendo descontado mês a mês no Auto Iberdrola. O desconto aparece no PDF e no Excel do comercial.
          </div>
          <SubmitRow pending={pending} onCancel={() => setOpen(false)} label={editing ? "Guardar alterações" : "Criar adiantamento"} error={error} />
        </form>
      </Modal>

      <Modal open={dedOpen} onClose={() => setDedOpen(false)} title="Desconto manual de adiantamento">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submitDeduct(); }}>
          <div className="text-[12.5px] text-ink-2">Usa isto apenas para cortes combinados fora do auto. No dia a dia aplicas o desconto com o botão <strong className="text-ink">Verificar Adiantamento</strong> nos Autos Finais.</div>
          <Field label="Colaborador">
            <select className="input w-full" value={dedEmp ?? ""} onChange={(e) => setDedEmp(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Escolhe o colaborador</option>
              {byEmployee.map((e) => (
                <option key={e.name} value={rows.find((r) => r.employeeName === e.name)?.employeeId ?? ""}>{e.name} — {fmtEur2(e.pending)}</option>
              ))}
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Mês">
              <input type="month" className="input num w-full" value={dedMonth} onChange={(e) => setDedMonth(e.target.value)} />
            </Field>
            <Field label="Valor a descontar (€)">
              <input type="number" step="0.01" min="0" className="input num w-full" placeholder="0.00" value={dedAmount} onChange={(e) => setDedAmount(e.target.value)} />
            </Field>
          </div>
          <Field label="Nota (opcional)">
            <input className="input w-full" placeholder="Ex.: acordo de pagamento" value={dedNote} onChange={(e) => setDedNote(e.target.value)} />
          </Field>
          <SubmitRow pending={deduct.isPending} onCancel={() => setDedOpen(false)} label="Registar desconto" error={dedError} />
        </form>
      </Modal>
    </div>
  );
}
