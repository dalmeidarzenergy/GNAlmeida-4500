import { useState } from "react";
import { Plus, Trash2, Wallet, Check, Clock } from "lucide-react";
import { usePaymentCalc, usePayments, useRemovePayment, useSavePayment } from "../queries/payments";
import { useEmployeeOptions } from "../queries/hr";
import { PageHeader, Modal, Field, Empty, Pill, Stat, ConfirmDelete, SubmitRow } from "../components/ui/kit";
import { errMsg, fmtDate, fmtEur, today } from "../lib/format";

const KINDS = [
  { key: "commission", label: "Comissao (vendedor)" },
  { key: "chief", label: "Escalao de chefe de equipa" },
  { key: "solar", label: "Solar" },
  { key: "medem", label: "MEDEM" },
  { key: "outro", label: "Outro" },
];

const kindLabel = (k: string) => KINDS.find((x) => x.key === k)?.label ?? k;

type PayRow = {
  id: number | null;
  employeeId: number;
  employeeName: string;
  month: string;
  kind: string;
  amount: number;
  salesCount: number;
  paidOn: string | null;
  status: string;
  notes: string | null;
};

type CalcRow = {
  employeeId: number;
  employeeName: string;
  role: string;
  tableName: string | null;
  sales: number;
  bandSales: number;
  unit: number;
  gross: number;
  chargeback: number;
  due: number;
  missingTable: boolean;
};

function PaymentForm({ initial, onClose, defaultMonth }: { initial: PayRow | null; onClose: () => void; defaultMonth: string }) {
  const save = useSavePayment();
  const remove = useRemovePayment();
  const emps = useEmployeeOptions();
  const [employeeId, setEmployeeId] = useState(initial ? String(initial.employeeId) : "");
  const [month, setMonth] = useState(initial?.month ?? defaultMonth);
  const [kind, setKind] = useState(initial?.kind ?? "commission");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [salesCount, setSalesCount] = useState(initial ? String(initial.salesCount) : "");
  const [paidOn, setPaidOn] = useState(initial?.paidOn ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  const num = (v: string) => (v.trim() === "" ? 0 : Number(v.replace(",", ".")));

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if (!employeeId) { setError("Escolha um funcionario."); return; }
        const p = {
          employeeId: Number(employeeId),
          month,
          kind,
          amount: num(amount),
          salesCount: num(salesCount),
          paidOn: paidOn || null,
          status: paidOn ? "pago" : "por_pagar",
          notes: notes || null,
        };
        try {
          const payload = initial && initial.id ? { ...p, id: initial.id } : p;
          await save.save.mutateAsync(payload);
          onClose();
        } catch (err) { setError(errMsg(err)); }
      }}
      className="space-y-4"
    >
      <Field label="Funcionario">
        <select className="input" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">Escolher...</option>
          {(emps.data ?? []).map((e) => (<option key={e.id} value={e.id}>{e.name}</option>))}
        </select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Mes"><input type="month" className="input num" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
        <Field label="Tipo">
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((k) => (<option key={k.key} value={k.key}>{k.label}</option>))}
          </select>
        </Field>
        <Field label="Valor (EUR)"><input className="input num" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="No de vendas"><input className="input num" placeholder="0" value={salesCount} onChange={(e) => setSalesCount(e.target.value)} /></Field>
        <Field label="Data de pagamento"><input type="date" className="input num" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
      </div>
      <Field label="Notas"><textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <SubmitRow
        pending={save.isPending}
        onCancel={onClose}
        error={error}
        extra={initial && initial.id && (<ConfirmDelete pending={remove.isPending} onConfirm={async () => { if (initial.id) await remove.mutateAsync({ id: initial.id }); onClose(); }} />)}
      />
    </form>
  );
}

type EmpOpt = { id: number; name: string };

/** Painel do calculo do mes (o que e devido a cada vendedor/chefe). */
function CalcPanel({ month, onRegister }: { month: string; onRegister: (r: CalcRow) => void }) {
  const calc = usePaymentCalc(month);
  const rows = calc.data?.rows ?? [];
  const t = calc.data?.totals;
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <div className="font-display text-[15px] font-semibold">A pagar em {month}</div>
          <div className="text-[11.5px] text-ink-3">Escalao so por vendas LUZ/Dual BTN em fornecimento; GAS pago ao escalao atingido; baixas do mes descontam (chargeback).</div>
        </div>
        <div className="text-right">
          <div className="label-mono">TOTAL A PAGAR</div>
          <div className="num font-display text-[20px] font-semibold text-volt">{fmtEur(t?.due ?? 0)}</div>
        </div>
      </div>
      {calc.isLoading ? (
        <div className="p-5"><div className="skeleton h-24 rounded-[12px]" /></div>
      ) : !rows.length ? (
        <Empty title="Sem comissoes neste mes" text="Nenhum vendedor ou chefe tem vendas pagaveis no periodo." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-3">
                <th className="px-5 py-3 font-medium">Nome</th>
                <th className="px-3 py-3 font-medium">Perfil</th>
                <th className="px-3 py-3 font-medium">Tabela</th>
                <th className="px-3 py-3 text-right font-medium">Vendas</th>
                <th className="px-3 py-3 text-right font-medium">P/ escalao</th>
                <th className="px-3 py-3 text-right font-medium">Bruto</th>
                <th className="px-3 py-3 text-right font-medium">Chargeback</th>
                <th className="px-3 py-3 text-right font-medium">A pagar</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employeeId} className="border-b border-line last:border-0">
                  <td className="px-5 py-3 font-medium">{r.employeeName}</td>
                  <td className="px-3 py-3">{r.role === "chefe" ? <Pill tone="warn">Chefe</Pill> : <Pill tone="info">Vendedor</Pill>}</td>
                  <td className="px-3 py-3 text-ink-2">{r.missingTable ? <span className="text-danger">sem tabela</span> : r.tableName}</td>
                  <td className="num px-3 py-3 text-right">{r.sales}</td>
                  <td className="num px-3 py-3 text-right text-ink-2">{r.bandSales}</td>
                  <td className="num px-3 py-3 text-right">{fmtEur(r.gross)}</td>
                  <td className="num px-3 py-3 text-right" style={{ color: r.chargeback ? "var(--danger)" : undefined }}>{r.chargeback ? `-${fmtEur(r.chargeback)}` : "-"}</td>
                  <td className="num px-3 py-3 text-right font-semibold">{fmtEur(r.due)}</td>
                  <td className="px-5 py-3 text-right">
                    <button type="button" className="btn btn-ghost" onClick={() => onRegister(r)} title="Registar pagamento"><Plus size={14} /> Registar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function PaymentsPage() {
  const [month, setMonth] = useState(today().slice(0, 7));
  const payments = usePayments();
  const [edit, setEdit] = useState<PayRow | "new" | null>(null);
  const rows = payments.data ?? [];

  const monthRows = rows.filter((r) => r.month === month);
  const totalPaid = monthRows.filter((r) => r.status === "pago").reduce((s, r) => s + r.amount, 0);
  const totalPending = monthRows.filter((r) => r.status !== "pago").reduce((s, r) => s + r.amount, 0);
  const calc = usePaymentCalc(month);
  const totalDue = calc.data?.totals?.due ?? 0;

  const register = (r: CalcRow) => setEdit({ id: null, employeeId: r.employeeId, employeeName: r.employeeName, month, kind: r.role === "chefe" ? "chief" : "commission", amount: Number(r.due.toFixed(2)), salesCount: r.sales, paidOn: today(), status: "pago", notes: r.tableName ? `Tabela: ${r.tableName}` : null });

  return (
    <div className="p-5 lg:p-7">
      <PageHeader eyebrow="PAGAMENTOS" title="Auto Pagamentos" subtitle="O que e devido a cada vendedor e chefe de equipa no mes, e o registo do que ja foi pago.">
        <input aria-label="Mes" type="month" className="input num w-40" value={month} onChange={(e) => setMonth(e.target.value)} />
        <button type="button" className="btn btn-volt" onClick={() => setEdit("new")}><Plus size={15} /> Novo pagamento</button>
      </PageHeader>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="A PAGAR (CALCULADO)" value={fmtEur(totalDue)} accent="var(--volt)" icon={<Wallet size={16} />} delay={0} />
        <Stat label="JA PAGO" value={fmtEur(totalPaid)} accent="var(--sky)" icon={<Check size={16} />} delay={60} />
        <Stat label="POR PAGAR (REGISTO)" value={fmtEur(totalPending)} accent="var(--amber)" icon={<Clock size={16} />} delay={120} />
        <Stat label="DIFERENCA" value={fmtEur(totalDue - totalPaid - totalPending)} accent="var(--ink)" delay={180} />
      </div>

      <div className="mt-6"><CalcPanel month={month} onRegister={register} /></div>

      <div className="card mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <div className="font-display text-[15px] font-semibold">Registo de pagamentos</div>
            <div className="text-[11.5px] text-ink-3">Pagamentos lancados manualmente, com estado pago ou por pagar.</div>
          </div>
        </div>
        {payments.isLoading ? (
          <div className="p-5"><div className="skeleton h-24 rounded-[12px]" /></div>
        ) : !monthRows.length ? (
          <Empty title="Sem pagamentos registados" text="Lance um pagamento ou registe a partir do calculo acima." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-3">
                  <th className="px-5 py-3 font-medium">Funcionario</th>
                  <th className="px-3 py-3 font-medium">Tipo</th>
                  <th className="px-3 py-3 text-right font-medium">Vendas</th>
                  <th className="px-3 py-3 text-right font-medium">Valor</th>
                  <th className="px-3 py-3 font-medium">Pago em</th>
                  <th className="px-3 py-3 font-medium">Estado</th>
                  <th className="px-3 py-3 font-medium">Notas</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {monthRows.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-3 font-medium">{r.employeeName}</td>
                    <td className="px-3 py-3 text-ink-2">{kindLabel(r.kind)}</td>
                    <td className="num px-3 py-3 text-right">{r.salesCount}</td>
                    <td className="num px-3 py-3 text-right font-semibold">{fmtEur(r.amount)}</td>
                    <td className="px-3 py-3 text-ink-2">{r.paidOn ? fmtDate(r.paidOn) : "-"}</td>
                    <td className="px-3 py-3">{r.status === "pago" ? <Pill tone="ok">Pago</Pill> : <Pill tone="warn">Por pagar</Pill>}</td>
                    <td className="px-3 py-3 text-ink-2">{r.notes ?? "-"}</td>
                    <td className="px-5 py-3 text-right"><button type="button" className="btn-icon" aria-label="Editar" onClick={() => setEdit(r)}><Plus size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit && edit.id ? "Editar pagamento" : "Novo pagamento"}>
        {edit !== null && (<PaymentForm initial={edit === "new" ? null : edit} defaultMonth={month} onClose={() => setEdit(null)} />)}
      </Modal>
    </div>
  );
}

