import { useEffect, useRef, useState, type ReactNode } from "react";
import { Download, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { z } from "zod";
import { PageHeader } from "../components/ui/kit";
import { calculatePlan, formatPlanMoney as money, formatPlanNumber as number, initialPlan, isPlanLoss, newCollaborator, planFields as fields, planSummary, type Collaborator } from "../lib/plano-mensal";
import { exportPlanPdf } from "../lib/plano-mensal-pdf";
import { useMe } from "../queries/me";
import "./plano-mensal.css";

const rowSchema = z.object({ id: z.string(), name: z.string(), days: z.string(), daily: z.string(), commission: z.string(), d2d: z.string() });
const planSchema = z.object({ rows: z.array(rowSchema), expenses: z.string(), vatRate: z.string(), deductVat: z.boolean() });

function loadPlan(key: string) {
  try {
    const parsed = planSchema.safeParse(JSON.parse(sessionStorage.getItem(key) ?? "null"));
    if (parsed.success) return parsed.data;
  } catch { /* O cálculo continua disponível sem armazenamento. */ }
  return initialPlan();
}

const profitClass = (value: number) => isPlanLoss(value) ? "plan-loss" : "plan-profit";

function Cell({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <td role="cell" className={className}>
      <div className="plan-mobile-label" aria-hidden="true">{label}</div>
      {children}
    </td>
  );
}

function SummaryCard({ label, value, result }: { label: string; value: string; result?: number }) {
  return (
    <div className={`card plan-summary-card p-4 ${result === undefined ? "" : "plan-final"}`}>
      <dt className="text-[12px] font-medium text-ink-2">{label}</dt>
      <dd className={`num mt-2 text-[19px] font-semibold ${result === undefined ? "" : profitClass(result)}`}>{value}</dd>
    </div>
  );
}

function Calculator({ storageKey, editable }: { storageKey: string; editable: boolean }) {
  const [plan, setPlan] = useState(() => loadPlan(storageKey));
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  const nextId = useRef(0);
  const pendingFocus = useRef<string | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const data = calculatePlan(plan);

  useEffect(() => {
    if (!editable) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify(plan)); } catch { /* Pode estar bloqueado. */ }
  }, [editable, plan, storageKey]);

  useEffect(() => {
    if (!pendingFocus.current) return;
    document.getElementById(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  }, [plan.rows]);

  function add() {
    const id = `collaborator-${Date.now()}-${++nextId.current}`;
    pendingFocus.current = `plan-name-${id}`;
    setPlan((p) => ({ ...p, rows: [...p.rows, newCollaborator(id)] }));
  }

  function update(id: string, field: Exclude<keyof Collaborator, "id">, value: string) {
    setPlan((p) => ({ ...p, rows: p.rows.map((r) => r.id === id ? { ...r, [field]: value } : r) }));
  }

  function remove(id: string) {
    setPlan((p) => ({ ...p, rows: p.rows.filter((r) => r.id !== id) }));
    addButton.current?.focus();
  }

  async function downloadPdf() {
    setExporting(true);
    setExportError(false);
    try {
      await exportPlanPdf(plan);
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="monthly-plan">
      <PageHeader eyebrow="Gestão de Empresa" title="Plano Mensal" subtitle="Simula as vendas, as comissões e o lucro mensal da equipa D2D.">
        <button type="button" className="btn btn-ghost" onClick={downloadPdf} disabled={exporting} aria-busy={exporting}>
          {exporting ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
          {exporting ? "A exportar…" : "Exportar PDF"}
        </button>
      </PageHeader>
      {exportError && <p role="alert" className="mb-4 text-sm text-danger">Não foi possível exportar o PDF. Tenta novamente.</p>}

      <section className="plan-panel" aria-labelledby="plan-team">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[17px] font-semibold" id="plan-team">Plano por colaborador</h2>
          {editable ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setPlan(initialPlan())}><RotateCcw size={15} /> Repor valores iniciais</button>
              <button ref={addButton} type="button" className="btn btn-primary" onClick={add}><Plus size={16} /> Adicionar colaborador</button>
            </div>
          ) : <p className="text-xs text-ink-2">Modo de visualização</p>}
        </div>
        <div className="plan-table-frame">
          <table role="table" aria-labelledby="plan-team" className="plan-table">
            <colgroup><col className="plan-name-col" />{fields.slice(1).map(([key]) => <col key={key} />)}<col className="plan-action-col" /></colgroup>
            <thead role="rowgroup"><tr role="row">
              {fields.map(([key, label]) => <th key={key} role="columnheader" scope="col">{label}</th>)}
              <th role="columnheader" scope="col" aria-label="Ações" />
            </tr></thead>
            <tbody role="rowgroup">
              {plan.rows.map((row, index) => (
                <tr key={row.id} role="row">
                  {fields.map(([key, label]) => {
                    if (key === "sales" || key === "payout" || key === "revenue" || key === "profit") {
                      const value = data.rows[index][key];
                      return <Cell key={key} label={label} className={`plan-number ${key === "profit" ? profitClass(value) : ""}`}>{key === "sales" ? number(value) : money(value)}</Cell>;
                    }
                    return (
                      <Cell key={key} label={label} className={key === "name" ? "plan-name" : ""}>
                        <input id={key === "name" ? `plan-name-${row.id}` : undefined} className={`input ${key === "name" ? "" : "num text-right"}`} aria-label={`${label} — colaborador ${index + 1}`} value={row[key]} readOnly={!editable}
                          inputMode={key === "name" ? "text" : "decimal"} maxLength={key === "name" ? 120 : 16} placeholder={key === "name" ? "Nome" : "0"}
                          onChange={(e) => update(row.id, key, e.target.value)} />
                      </Cell>
                    );
                  })}
                  <td role="cell" className="plan-action">
                    {editable && <button type="button" className="btn-icon hover:text-danger" aria-label={`Remover ${row.name.trim() || `colaborador ${index + 1}`}`} onClick={() => remove(row.id)}><Trash2 size={16} /></button>}
                  </td>
                </tr>
              ))}
              {plan.rows.length === 0 && <tr role="row" className="plan-empty"><td role="cell" colSpan={10}>Sem colaboradores. {editable && "Usa «Adicionar colaborador» para começar."}</td></tr>}
            </tbody>
            <tfoot role="rowgroup"><tr role="row">
              <th role="rowheader" scope="row" className="plan-name">TOTAL</th>
              <td role="cell" className="plan-empty-days" />
              {fields.slice(2).map(([key, label]) => {
                if (key === "name" || key === "days") return null;
                const value = data.totals[key];
                return <Cell key={key} label={label} className={`plan-number ${key === "profit" ? profitClass(value) : ""}`}>{key === "sales" || key === "daily" ? number(value) : money(value)}</Cell>;
              })}
              <td role="cell" className="plan-action" />
            </tr></tfoot>
          </table>
        </div>
      </section>

      <section className="plan-panel" aria-labelledby="plan-summary">
        <h2 id="plan-summary" className="mb-4 text-[17px] font-semibold">Resumo mensal</h2>
        <div className="card mb-4 p-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <label className="flex items-center gap-2 font-medium">
              <input type="checkbox" className="size-4 shrink-0 accent-volt" checked={plan.deductVat} disabled={!editable} onChange={(e) => setPlan((p) => ({ ...p, deductVat: e.target.checked }))} />
              Descontar IVA ao valor D2D
            </label>
            <label className="flex items-center gap-2 text-[12px] text-ink-2">
              Taxa de IVA (%)
              <input className="input num h-9 w-20 text-right" inputMode="decimal" maxLength={16} value={plan.vatRate} readOnly={!editable} onChange={(e) => setPlan((p) => ({ ...p, vatRate: e.target.value }))} />
            </label>
          </div>
          <label className="mt-3 flex w-fit items-center gap-2 text-[12px] text-ink-2">
            Despesas (€)
            <input className="input num h-9 w-32 text-right" inputMode="decimal" maxLength={16} value={plan.expenses} readOnly={!editable} onChange={(e) => setPlan((p) => ({ ...p, expenses: e.target.value }))} />
          </label>
          <p className="mt-3 text-[12px] text-ink-2">O IVA é aplicado depois de subtrair as despesas e antes de descontar as comissões.</p>
        </div>
        <dl className="plan-summary-grid">
          {planSummary(data, plan.deductVat).map(({ label, value, result }) => <SummaryCard key={label} label={label} value={value} result={result} />)}
        </dl>
      </section>
      <p className="mt-4 text-[12px] text-ink-2">Os valores são guardados apenas nesta sessão do navegador.</p>
    </div>
  );
}

export default function PlanoMensalPage() {
  const me = useMe();
  if (me.isLoading) return <div className="skeleton h-64 rounded-[14px]" />;
  const permission = me.data?.permissions?.["plano-mensal"];
  if (!me.data || !permission?.view) return <PageHeader title="Plano Mensal" subtitle="Não foi possível confirmar o acesso a esta página." />;
  return <Calculator key={me.data.id} storageKey={`rzenergy:plano-mensal:v1:${me.data.id}`} editable={permission.edit && !permission.readOnly} />;
}