import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { usePaymentAutoDetail, usePaymentBreakdown } from "../queries/payments";
import { PageHeader, Empty, Pill } from "../components/ui/kit";
import UnlockBoard from "../components/unlock-board";
import { fmtEur, today } from "../lib/format";

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
  forceCommissions: boolean;
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
  const penaltyHireSum = lines.reduce((s, l) => s + l.penaltyHire, 0);
  const penaltyCampaignSum = lines.reduce((s, l) => s + l.penaltyCampaign, 0);
  const netSum = lines.reduce((s, l) => s + l.total, 0);
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
            <td className="num px-3 py-2 text-right text-ink-2">{penaltyHireSum ? `-${fmtEur(penaltyHireSum)}` : "-"}</td>
            <td className="num px-3 py-2 text-right text-ink-2">{penaltyCampaignSum ? `-${fmtEur(penaltyCampaignSum)}` : "-"}</td>
            <td className="num px-3 py-2 text-right">{fmtEur(netSum)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Resumo (os campos que saem no PDF). */
function AutoResumo({ p }: { p: AutoPerson }) {
  const totalLuz = p.lines.reduce((s, l) => s + l.luz, 0);
  const totalGas = p.lines.reduce((s, l) => s + l.gas, 0);
  const rows: [string, string][] = [
    ["Total a pagar", fmtEur(p.due)],
    ["Vendas a pagamento", `${p.totalSales} (${p.luzCount} luz, ${p.gasCount} gas)`],
    ["Extras", `${p.pelQty} PEL PLUS, ${p.ddQty} debito direto, ${p.feQty} FE (${fmtEur(p.extrasAmount)})`],
    ["Total luz", fmtEur(totalLuz)],
    ["Total gas", fmtEur(totalGas)],
    ["Subtotal sem descontos", fmtEur(p.gross)],
    ["Chargeback a descontar", p.chargeback ? `-${fmtEur(p.chargeback)}` : "-"],
    ["Penalizacao de timing", p.penaltyTiming ? `-${fmtEur(p.penaltyTiming)}` : "-"],
    ["Penalizacao de campanha", p.penaltyCampaign ? `-${fmtEur(p.penaltyCampaign)}` : "-"],
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
}) {
  const [open, setOpen] = useState(true);
  const [openTransit, setOpenTransit] = useState(true);
  const q = usePaymentAutoDetail(month, employeeId);
  const person = q.data && q.data.found ? q.data.person : null;

  if (employeeId == null) {
    return <Empty title="Escolhe um comercial" text="Seleciona um comercial na lista para ver a previsao de pagamento." />;
  }
  if (q.isLoading) return <div className="p-5"><div className="skeleton h-24 rounded-[12px]" /></div>;
  if (!person) return <Empty title="Sem auto neste mes" text="Este comercial nao tem vendas a pagamento no mes escolhido." />;

  const total = person.lines.reduce((s, l) => s + l.luz + l.gas + l.extras, 0);
  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-volt/5 px-5 py-4">
        <div>
          <div className="font-display text-[15px] font-semibold">{person.employeeName}</div>
          <div className="mt-1 text-[11.5px] text-ink-3">
            {person.role} | {person.tableName ?? "sem tabela"}{person.unit ? ` | ${fmtEur(person.unit)}/venda` : ""} | Mes {monthLabel(month)}
          </div>
        </div>
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
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
  const breakdown = usePaymentBreakdown(month);
  const people = breakdown.data?.people ?? [];

  return (
    <div className="p-5 lg:p-7">
      <PageHeader eyebrow="PAGAMENTOS" title="Previsão de Pagamentos" subtitle="Previsão por comercial e por mes, calculada a partir das vendas registadas no CRM.">
        <input aria-label="Mes" type="month" className="input num w-40" value={month} onChange={(e) => setMonth(e.target.value)} />
      </PageHeader>

      <div className="mt-4">
        <UnlockBoard month={month} />
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

        <AutoPanel month={month} employeeId={selected} />
      </div>
    </div>
  );
}
