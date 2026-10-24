import { useState } from "react";
import { Plus, Pencil, Trash2, Wallet, Check, Clock, FileDown, ChevronDown, ChevronRight } from "lucide-react";
import {
  useAutoPdf,
  usePaymentAutoDetail,
  usePaymentBreakdown,
  usePaymentCalc,
  usePayments,
  useRemovePayment,
  useSavePayment,
} from "../queries/payments";
import { useEmployeeOptions } from "../queries/hr";
import { PageHeader, Modal, Field, Empty, Pill, Stat, ConfirmDelete, SubmitRow } from "../components/ui/kit";
import { errMsg, fmtDate, fmtEur, today } from "../lib/format";

const KINDS = [
  { key: "commission", label: "Comissao (vendedor)" },
  { key: "solar", label: "Solar" },
  { key: "medem", label: "MEDEM" },
  { key: "outro", label: "Outro" },
];

const kindLabel = (k: string) => KINDS.find((x) => x.key === k)?.label ?? k;

type PayKind = "commission" | "solar" | "medem" | "outro";

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
  pelQty: number;
  ddQty: number;
  feQty: number;
  extrasAmount: number;
  grossAmount: number;
  penaltyTiming: number;
  penaltyCampaign: number;
  kmDeduction: number;
  notes: string | null;
};

type AutoLine = {
  saleId: number;
  number: string;
  clientName: string | null;
  service: string;
  campaign: string | null;
  luz: number;
  gas: number;
  extras: number;
  penaltyHire: number;
  penaltyCampaign: number;
  total: number;
};

type AutoPerson = {
  employeeId: number;
  employeeName: string;
  role: string;
  roleKey: "vendedor";
  tableName: string | null;
  unit: number;
  bandSales: number;
  totalSales: number;
  luzCount: number;
  gasCount: number;
  pelQty: number;
  ddQty: number;
  feQty: number;
  extrasAmount: number;
  gross: number;
  chargeback: number;
  penaltyTiming: number;
  penaltyCampaign: number;
  kmDeduction: number;
  due: number;
  missingTable: boolean;
  lines: AutoLine[];
  chargebackLines: AutoLine[];
  notPaid: { number: string; service: string; status: string; value: number }[];
  team: { name: string; luz: number; gas: number }[];
};

const monthLabel = (m: string) => {
  const [y, mm] = m.split("-");
  return `${mm}/${y}`;
};
function PaymentForm({ initial, onClose, defaultMonth }: { initial: PayRow | null; onClose: () => void; defaultMonth: string }) {
  const save = useSavePayment();
  const remove = useRemovePayment();
  const emps = useEmployeeOptions();
  const [employeeId, setEmployeeId] = useState(initial ? String(initial.employeeId) : "");
  const [month, setMonth] = useState(initial?.month ?? defaultMonth);
  const [kind, setKind] = useState<PayKind>((initial?.kind as PayKind) ?? "commission");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [salesCount, setSalesCount] = useState(initial ? String(initial.salesCount) : "");
  const [paidOn, setPaidOn] = useState(initial?.paidOn ?? "");
  const [pelQty, setPelQty] = useState(initial ? String(initial.pelQty) : "");
  const [ddQty, setDdQty] = useState(initial ? String(initial.ddQty) : "");
  const [feQty, setFeQty] = useState(initial ? String(initial.feQty) : "");
  const [extrasAmount, setExtrasAmount] = useState(initial ? String(initial.extrasAmount) : "");
  const [grossAmount, setGrossAmount] = useState(initial ? String(initial.grossAmount) : "");
  const [penaltyTiming, setPenaltyTiming] = useState(initial ? String(initial.penaltyTiming) : "");
  const [penaltyCampaign, setPenaltyCampaign] = useState(initial ? String(initial.penaltyCampaign) : "");
  const [kmDeduction, setKmDeduction] = useState(initial ? String(initial.kmDeduction) : "");
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
          status: (paidOn ? "pago" : "por_pagar") as "pago" | "por_pagar",
          pelQty: num(pelQty),
          ddQty: num(ddQty),
          feQty: num(feQty),
          extrasAmount: num(extrasAmount),
          grossAmount: num(grossAmount),
          penaltyTiming: num(penaltyTiming),
          penaltyCampaign: num(penaltyCampaign),
          kmDeduction: num(kmDeduction),
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
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as PayKind)}>
            {KINDS.map((k) => (<option key={k.key} value={k.key}>{k.label}</option>))}
          </select>
        </Field>
        <Field label="Valor (EUR)"><input className="input num" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="No de vendas"><input className="input num" placeholder="0" value={salesCount} onChange={(e) => setSalesCount(e.target.value)} /></Field>
        <Field label="Data de pagamento"><input type="date" className="input num" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
      </div>

      <div className="rounded-[12px] border border-line p-4">
        <div className="label-mono mb-3">Detalhe do auto (formula)</div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="PEL PLUS (nº)"><input className="input num" placeholder="0" value={pelQty} onChange={(e) => setPelQty(e.target.value)} /></Field>
          <Field label="Debito direto (nº)"><input className="input num" placeholder="0" value={ddQty} onChange={(e) => setDdQty(e.target.value)} /></Field>
          <Field label="FE (nº)"><input className="input num" placeholder="0" value={feQty} onChange={(e) => setFeQty(e.target.value)} /></Field>
          <Field label="Extras (EUR)"><input className="input num" placeholder="0" value={extrasAmount} onChange={(e) => setExtrasAmount(e.target.value)} /></Field>
          <Field label="Base antes de descontos (EUR)"><input className="input num" placeholder="0" value={grossAmount} onChange={(e) => setGrossAmount(e.target.value)} /></Field>
          <Field label="Desconto folha de km (EUR)"><input className="input num" placeholder="0" value={kmDeduction} onChange={(e) => setKmDeduction(e.target.value)} /></Field>
          <Field label="Penalizacao de timing (EUR)"><input className="input num" placeholder="0" value={penaltyTiming} onChange={(e) => setPenaltyTiming(e.target.value)} /></Field>
          <Field label="Penalizacao de campanha (EUR)"><input className="input num" placeholder="0" value={penaltyCampaign} onChange={(e) => setPenaltyCampaign(e.target.value)} /></Field>
        </div>
        <p className="mt-3 text-[11px] text-ink-3">Deixa em branco para usar o valor calculado. As regras das penalizacoes ainda nao existem: o campo fica manual.</p>
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
/** Uma linha de venda do auto. */
function LineTable({ lines, empty }: { lines: AutoLine[]; empty: string }) {
  if (!lines.length) return <Empty title={empty} text="Sem vendas nesta situacao." />;
  const sum = lines.reduce((s, l) => s + l.luz + l.gas + l.extras, 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-[12.5px]">
        <thead>
          <tr className="border-b border-line bg-volt/10 text-left">
            <th className="px-3 py-2 font-medium">Nº contrato</th>
            <th className="px-3 py-2 font-medium">Tipo</th>
            <th className="px-3 py-2 font-medium">Campanha</th>
            <th className="px-3 py-2 text-right font-medium">Luz</th>
            <th className="px-3 py-2 text-right font-medium">Gas</th>
            <th className="px-3 py-2 text-right font-medium">Extras</th>
            <th className="px-3 py-2 text-right font-medium">Pen. contratacao</th>
            <th className="px-3 py-2 text-right font-medium">Penal. camp.</th>
            <th className="px-3 py-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.saleId} className="border-b border-line last:border-0">
              <td className="px-3 py-2 text-ink-2">{l.number}</td>
              <td className="px-3 py-2">{l.service}</td>
              <td className="px-3 py-2 text-ink-2">{l.campaign ?? "-"}</td>
              <td className="num px-3 py-2 text-right">{l.luz ? fmtEur(l.luz) : "-"}</td>
              <td className="num px-3 py-2 text-right">{l.gas ? fmtEur(l.gas) : "-"}</td>
              <td className="num px-3 py-2 text-right">{l.extras ? fmtEur(l.extras) : "-"}</td>
              <td className="num px-3 py-2 text-right text-ink-2">{l.penaltyHire ? `-${fmtEur(l.penaltyHire)}` : "-"}</td>
              <td className="num px-3 py-2 text-right text-ink-2">{l.penaltyCampaign ? `-${fmtEur(l.penaltyCampaign)}` : "-"}</td>
              <td className="num px-3 py-2 text-right font-semibold">{fmtEur(l.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line bg-volt/5 font-semibold">
            <td className="px-3 py-2" colSpan={3}>Subtotal</td>
            <td className="num px-3 py-2 text-right">{fmtEur(lines.reduce((s, l) => s + l.luz, 0))}</td>
            <td className="num px-3 py-2 text-right">{fmtEur(lines.reduce((s, l) => s + l.gas, 0))}</td>
            <td className="num px-3 py-2 text-right">{fmtEur(lines.reduce((s, l) => s + l.extras, 0))}</td>
            <td className="px-3 py-2 text-right">-</td>
            <td className="px-3 py-2 text-right">-</td>
            <td className="num px-3 py-2 text-right">{fmtEur(sum)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Resumo (os campos que saem no PDF). */
function AutoResumo({ p }: { p: AutoPerson }) {
  const rows: [string, string][] = [
    ["Total a pagar", fmtEur(p.due)],
    ["Vendas a pagamento", `${p.totalSales} (${p.luzCount} luz, ${p.gasCount} gas)`],
    ["Extras", `${p.pelQty} PEL PLUS, ${p.ddQty} debito direto, ${p.feQty} FE (${fmtEur(p.extrasAmount)})`],
    ["Base antes de descontos", fmtEur(p.gross)],
    ["Chargeback a descontar", p.chargeback ? `-${fmtEur(p.chargeback)}` : "-"],
    ["Penalizacao de timing", p.penaltyTiming ? `-${fmtEur(p.penaltyTiming)}` : "-"],
    ["Penalizacao de campanha", p.penaltyCampaign ? `-${fmtEur(p.penaltyCampaign)}` : "-"],
    ["Desconto folha de km", p.kmDeduction ? `-${fmtEur(p.kmDeduction)}` : "-"],
  ];
  return (
    <div className="overflow-hidden rounded-[12px] border border-line">
      <div className="bg-volt px-4 py-2 text-[11px] font-semibold tracking-wide text-ink">Resumo</div>
      <dl className="divide-y divide-line">
        {rows.map(([k, v], i) => (
          <div key={k} className={`flex items-center justify-between gap-4 px-4 py-2 ${i % 2 ? "bg-[#f7faf9]" : ""}`}>
            <dt className="text-[12px] text-ink-3">{k}</dt>
            <dd className="num text-[12.5px] font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Painel do auto de pagamento de uma pessoa (todos os campos do PDF). */
function AutoPanel({
  month,
  employeeId,
  onRegister,
  onPdf,
  pdfPending,
}: {
  month: string;
  employeeId: number | null;
  onRegister: (p: AutoPerson) => void;
  onPdf: (employeeId: number) => void;
  pdfPending: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [openTransit, setOpenTransit] = useState(true);
  const q = usePaymentAutoDetail(month, employeeId);
  const person = q.data && q.data.found ? q.data.person : null;

  if (employeeId == null) {
    return <Empty title="Escolhe um comercial" text="Seleciona um comercial na lista para ver o auto de pagamento." />;
  }
  if (q.isLoading) return <div className="p-5"><div className="skeleton h-24 rounded-[12px]" /></div>;
  if (!person) return <Empty title="Sem auto neste mes" text="Este comercial nao tem vendas a pagamento no mes escolhido." />;

  const total = person.lines.reduce((s, l) => s + l.total, 0);
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-volt/5 px-5 py-4">
        <div>
          <div className="font-display text-[15px] font-semibold">{person.employeeName}</div>
          <div className="mt-1 text-[11.5px] text-ink-3">
            {person.role} | {person.tableName ?? "sem tabela"}{person.unit ? ` | ${fmtEur(person.unit)}/venda` : ""} | Mes {monthLabel(month)}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={pdfPending}
          onClick={() => onPdf(person.employeeId)}
        >
          <FileDown size={15} /> {pdfPending ? "A gerar..." : "PDF deste comercial"}
        </button>
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <div>
            <div className="rounded-t-[12px] bg-volt px-4 py-2 text-[11px] font-semibold tracking-wide text-ink">A pagamento (EM FORNECIMENTO)</div>
            <div className="rounded-b-[12px] border border-t-0 border-line">
              <LineTable lines={person.lines} empty="Sem vendas a pagamento" />
            </div>
            <div className="mt-3 flex items-center justify-between rounded-[12px] bg-volt/10 px-4 py-3">
              <span className="font-display text-[13px] font-semibold">Total a pagar</span>
              <span className="num font-display text-[18px] font-semibold text-volt">{fmtEur(person.due)}</span>
            </div>
          </div>

          {person.chargebackLines.length > 0 && (
            <div>
              <div className="mb-2 rounded-t-[12px] bg-danger/85 px-4 py-2 text-[11px] font-semibold tracking-wide text-white">Chargeback (a descontar)</div>
              <div className="overflow-x-auto rounded-b-[12px] border border-t-0 border-line">
                <table className="w-full min-w-[560px] text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-[#fdf3f3] text-left">
                      <th className="px-3 py-2 font-medium">Nº contrato</th>
                      <th className="px-3 py-2 font-medium">Tipo</th>
                      <th className="px-3 py-2 font-medium">Campanha</th>
                      <th className="px-3 py-2 text-right font-medium">Valor a descontar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {person.chargebackLines.map((l) => (
                      <tr key={l.saleId} className="border-b border-line last:border-0">
                        <td className="px-3 py-2 text-ink-2">{l.number}</td>
                        <td className="px-3 py-2">{l.service}</td>
                        <td className="px-3 py-2 text-ink-2">{l.campaign ?? "-"}</td>
                        <td className="num px-3 py-2 text-right font-semibold text-danger">-{fmtEur(l.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {person.team.length > 0 && (
            <div>
              <div className="mb-2 rounded-t-[12px] bg-ink px-4 py-2 text-[11px] font-semibold tracking-wide text-white">Equipa (tabela base)</div>
              <div className="overflow-x-auto rounded-b-[12px] border border-t-0 border-line">
                <table className="w-full min-w-[480px] text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line text-left">
                      <th className="px-3 py-2 font-medium">Pessoa</th>
                      <th className="px-3 py-2 text-right font-medium">Vendas luz</th>
                      <th className="px-3 py-2 text-right font-medium">Vendas gas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {person.team.map((t) => (
                      <tr key={t.name} className="border-b border-line last:border-0">
                        <td className="px-3 py-2">{t.name}</td>
                        <td className="num px-3 py-2 text-right">{t.luz}</td>
                        <td className="num px-3 py-2 text-right">{t.gas}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-line bg-volt/5 font-semibold">
                      <td className="px-3 py-2">Total da equipa</td>
                      <td className="num px-3 py-2 text-right">{person.team.reduce((s, t) => s + t.luz, 0)}</td>
                      <td className="num px-3 py-2 text-right">{person.team.reduce((s, t) => s + t.gas, 0)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {person.transit.length > 0 && (
            <div>
              <button type="button" className="flex w-full items-center gap-2 rounded-[12px] border border-line bg-[#f5f8fa] px-4 py-2 text-left text-[11px] font-semibold tracking-wide" onClick={() => setOpenTransit(!openTransit)}>
                {openTransit ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                VENDAS EM TRANSITO (PRE-VENDA A PEDIDO DE FORNECIMENTO) - {person.transit.length}
              </button>
              {openTransit && (
                <div className="mt-2 overflow-x-auto rounded-[12px] border border-line">
                  <table className="w-full min-w-[640px] text-[12.5px]">
                    <thead>
                      <tr className="border-b border-line bg-[#fafbfa] text-left">
                        <th className="px-3 py-2 font-medium">Nº contrato</th>
                        <th className="px-3 py-2 font-medium">Tipo</th>
                        <th className="px-3 py-2 font-medium">Estado atual</th>
                        <th className="px-3 py-2 font-medium">Assinatura</th>
                        <th className="px-3 py-2 text-right font-medium">Valor se passar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {person.transit.map((n) => (
                        <tr key={`${n.number}-${n.service}`} className="border-b border-line last:border-0">
                          <td className="px-3 py-2 text-ink-2">{n.number}</td>
                          <td className="px-3 py-2">{n.service}</td>
                          <td className="px-3 py-2 text-ink-2">{n.status}</td>
                          <td className="px-3 py-2 text-ink-2">{n.signedOn ? monthLabel(n.signedOn.slice(0, 7)) : "-"}</td>
                          <td className="num px-3 py-2 text-right">{n.value ? fmtEur(n.value) : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {person.notPaid.length > 0 && (
            <div>
              <button type="button" className="flex w-full items-center gap-2 rounded-[12px] border border-line bg-[#fafbfa] px-4 py-2 text-left text-[11px] font-semibold tracking-wide" onClick={() => setOpen(!open)}>
                {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                NAO VEM A PAGAMENTO (ESTADO DIFERENTE DE EM FORNECIMENTO) - {person.notPaid.length}
              </button>
              {open && (
                <div className="mt-2 overflow-x-auto rounded-[12px] border border-line">
                  <table className="w-full min-w-[560px] text-[12.5px]">
                    <thead>
                      <tr className="border-b border-line bg-[#fafbfa] text-left">
                        <th className="px-3 py-2 font-medium">Nº contrato</th>
                        <th className="px-3 py-2 font-medium">Tipo</th>
                        <th className="px-3 py-2 font-medium">Estado</th>
                        <th className="px-3 py-2 text-right font-medium">Valor indicativo se passar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {person.notPaid.map((n) => (
                        <tr key={n.number} className="border-b border-line last:border-0">
                          <td className="px-3 py-2 text-ink-2">{n.number}</td>
                          <td className="px-3 py-2">{n.service}</td>
                          <td className="px-3 py-2 text-ink-2">{n.status}</td>
                          <td className="num px-3 py-2 text-right">{n.value ? fmtEur(n.value) : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <AutoResumo p={person} />
          <button type="button" className="btn btn-volt w-full" onClick={() => onRegister(person)}>
            <Plus size={15} /> Registar pagamento
          </button>
          <div className="rounded-[12px] border border-line p-4 text-[11.5px] text-ink-3">
            <div className="label-mono mb-2">Base de calculo</div>
            Subtotal das vendas: <span className="num font-semibold text-ink">{fmtEur(total)}</span>
            <br />Escalao: <span className="font-semibold text-ink">{person.bandSales}</span> vendas luz/dual em fornecimento
            {person.missingTable && <div className="mt-2 text-danger">Sem tabela comisional em vigor — valores a zero.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
export default function PaymentsPage() {
  const [month, setMonth] = useState(today().slice(0, 7));
  const [selected, setSelected] = useState<number | null>(null);
  const [edit, setEdit] = useState<PayRow | "new" | null>(null);
  const [pdfMsg, setPdfMsg] = useState<string | null>(null);
  const payments = usePayments();
  const breakdown = usePaymentBreakdown(month);
  const pdf = useAutoPdf();
  const removePay = useRemovePayment();
  const rows = payments.data ?? [];
  const people = breakdown.data?.people ?? [];

  const monthRows = rows.filter((r) => r.month === month);
  const totalPaid = monthRows.filter((r) => r.status === "pago").reduce((s, r) => s + r.amount, 0);
  const calc = usePaymentCalc(month);
  const totalDue = calc.data?.totals?.due ?? 0;
  // Por pagar = calculado menos o que ja foi pago.
  const totalPending = totalDue - totalPaid;

  const download = async (employeeId?: number) => {
    setPdfMsg(null);
    try {
      const res = await pdf.generate.mutateAsync(employeeId ? { month, employeeId } : { month });
      if (!res.ok || !res.url) return setPdfMsg(res.reason ?? "Nao foi possivel gerar o PDF.");
      window.open(res.url, "_blank");
      setPdfMsg(employeeId ? `PDF gerado: ${res.name}` : `PDF gerado com ${res.count} autos: ${res.name}`);
    } catch (e) { setPdfMsg(errMsg(e)); }
  };

  return (
    <div className="p-5 lg:p-7">
      <PageHeader eyebrow="PAGAMENTOS" title="Auto Pagamentos" subtitle="Auto de pagamento por comercial e por mes: vendas, extras, chargebacks, penalizacoes e km.">
        <input aria-label="Mes" type="month" className="input num w-40" value={month} onChange={(e) => setMonth(e.target.value)} />
        <button type="button" className="btn btn-ghost" disabled={pdf.isPending} onClick={() => download()}>
          <FileDown size={15} /> {pdf.isPending ? "A gerar..." : "PDF (todos)"}
        </button>
        <button type="button" className="btn btn-volt" onClick={() => setEdit("new")}><Plus size={15} /> Novo pagamento</button>
      </PageHeader>

      {pdfMsg && <div className="mt-4 rounded-[12px] border border-line bg-volt/5 px-4 py-2 text-[12px] text-ink-2">{pdfMsg}</div>}

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="A PAGAR (CALCULADO)" value={fmtEur(totalDue)} accent="var(--volt)" icon={<Wallet size={16} />} delay={0} />
        <Stat label="JA PAGO" value={fmtEur(totalPaid)} accent="var(--sky)" icon={<Check size={16} />} delay={60} />
        <Stat label="POR PAGAR" value={fmtEur(totalPending)} accent="var(--amber)" icon={<Clock size={16} />} delay={120} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="card overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <div className="font-display text-[13px] font-semibold">Comerciais</div>
            <div className="text-[11px] text-ink-3">{people.length} com vendas em {monthLabel(month)}</div>
          </div>
          {breakdown.isLoading ? (
            <div className="p-4"><div className="skeleton h-24 rounded-[12px]" /></div>
          ) : !people.length ? (
            <Empty title="Sem autos neste mes" text="Nenhum comercial tem vendas pagaveis no periodo." />
          ) : (
            <ul className="divide-y divide-line">
              {people.map((p) => (
                <li key={p.employeeId}>
                  <button
                    type="button"
                    onClick={() => setSelected(selected === p.employeeId ? null : p.employeeId)}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-volt/5 ${selected === p.employeeId ? "bg-volt/10" : ""}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium">{p.employeeName}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-3">
                        <Pill tone="info">Comercial</Pill>
                        {p.missingTable ? <span className="text-danger">sem tabela</span> : <span>{p.totalSales} vendas</span>}
                      </span>
                    </span>
                    <span className="num text-[12.5px] font-semibold">{fmtEur(p.due)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <AutoPanel month={month} employeeId={selected} onPdf={(id) => download(id)} pdfPending={pdf.isPending} onRegister={(p) => setEdit({
          id: null,
          employeeId: p.employeeId,
          employeeName: p.employeeName,
          month,
          kind: "commission",
          amount: Number(p.due.toFixed(2)),
          salesCount: p.totalSales,
          paidOn: today(),
          status: "pago",
          pelQty: p.pelQty,
          ddQty: p.ddQty,
          feQty: p.feQty,
          extrasAmount: p.extrasAmount,
          grossAmount: p.gross,
          penaltyTiming: p.penaltyTiming,
          penaltyCampaign: p.penaltyCampaign,
          kmDeduction: p.kmDeduction,
          notes: p.tableName ? `Tabela: ${p.tableName}` : null,
        })} />
      </div>

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
          <Empty title="Sem pagamentos registados" text="Lance um pagamento, ou usa Registar num auto." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="px-5 py-3 font-medium">FUNCIONARIO</th>
                  <th className="px-3 py-3 font-medium">TIPO</th>
                  <th className="px-3 py-3 text-right font-medium">VENDAS</th>
                  <th className="px-3 py-3 text-right font-medium">EXTRAS</th>
                  <th className="px-3 py-3 text-right font-medium">VALOR</th>
                  <th className="px-3 py-3 font-medium">PAGO EM</th>
                  <th className="px-3 py-3 font-medium">ESTADO</th>
                  <th className="px-3 py-3 font-medium">PENALIZACOES</th>
                  <th className="px-3 py-3 font-medium">NOTAS</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {monthRows.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-3 font-medium">{r.employeeName}</td>
                    <td className="px-3 py-3 text-ink-2">{kindLabel(r.kind)}</td>
                    <td className="num px-3 py-3 text-right">{r.salesCount}</td>
                    <td className="num px-3 py-3 text-right text-ink-2">{r.extrasAmount ? fmtEur(r.extrasAmount) : "-"}</td>
                    <td className="num px-3 py-3 text-right font-semibold">{fmtEur(r.amount)}</td>
                    <td className="px-3 py-3 text-ink-2">{r.paidOn ? fmtDate(r.paidOn) : "-"}</td>
                    <td className="px-3 py-3">{r.status === "pago" ? <Pill tone="ok">Pago</Pill> : <Pill tone="warn">Por pagar</Pill>}</td>
                    <td className="px-3 py-3 text-[11.5px] text-ink-3">
                      {r.penaltyTiming || r.penaltyCampaign || r.kmDeduction ? (
                        <>
                          {r.penaltyTiming ? <div>Timing: -{fmtEur(r.penaltyTiming)}</div> : null}
                          {r.penaltyCampaign ? <div>Campanha: -{fmtEur(r.penaltyCampaign)}</div> : null}
                          {r.kmDeduction ? <div>Km: -{fmtEur(r.kmDeduction)}</div> : null}
                        </>
                      ) : ("-")}
                    </td>
                    <td className="px-3 py-3 text-ink-2">{r.notes ?? "-"}</td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button type="button" className="btn-icon" aria-label="PDF do auto" disabled={pdf.isPending} onClick={() => download(r.employeeId)}><FileDown size={14} /></button>
                        <button type="button" className="btn-icon" aria-label="Editar" onClick={() => setEdit(r)}><Pencil size={14} /></button>
                        <button type="button" className="btn-icon" aria-label="Apagar" onClick={async () => { if (r.id != null) await removePay.mutateAsync({ id: r.id }); }}><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit && edit !== "new" && edit.id ? "Editar pagamento" : "Novo pagamento"}>
        {edit !== null && (<PaymentForm initial={edit === "new" ? null : edit} defaultMonth={month} onClose={() => setEdit(null)} />)}
      </Modal>
    </div>
  );
}
