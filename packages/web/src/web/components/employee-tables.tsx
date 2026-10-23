import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useEmployeeTables, useRemoveEmployeeTable, useSaveEmployeeTable } from "../queries/employee-tables";
import { Field, Pill } from "./ui/kit";
import { errMsg, fmtDate, today } from "../lib/format";

type Option = { id: number; name: string };

const blankRow = () => ({ kind: "commission" as "commission" | "chief", tableId: "", startDate: today(), endDate: "" });

/** Histórico de tabelas atribuídas ao funcionário, com datas de vigência. */
export function EmployeeTableHistory({ employeeId, commissionOptions, chiefOptions }: { employeeId: number | null; commissionOptions: Option[]; chiefOptions: Option[] }) {
  const list = useEmployeeTables(employeeId);
  const save = useSaveEmployeeTable(employeeId);
  const remove = useRemoveEmployeeTable(employeeId);
  const [draft, setDraft] = useState<ReturnType<typeof blankRow> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = list.data ?? [];
  const options = draft?.kind === "chief" ? chiefOptions : commissionOptions;

  if (employeeId == null) {
    return (
      <div className="mt-6 border-t border-line pt-4 sm:col-span-2">
        <div className="font-display text-[14px] font-semibold">Histórico de tabelas (vigência por datas)</div>
        <p className="mt-1.5 text-[11.5px] text-ink-3">Guarde o funcionário primeiro para poder registar as tabelas e respetivas datas.</p>
      </div>
    );
  }

  return (
    <div className="mt-6 border-t border-line pt-4 sm:col-span-2">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-display text-[14px] font-semibold">Histórico de tabelas (vigência por datas)</div>
          <p className="mt-1.5 text-[11.5px] text-ink-3">
            Registe que tabela estava em vigor em cada período. O cálculo de um mês usa a tabela vigente nesse mês; sem histórico, usa a tabela atual indicada acima.
          </p>
        </div>
        {draft === null && (
          <button type="button" className="btn btn-ghost shrink-0" onClick={() => { setError(null); setDraft(blankRow()); }}>
            <Plus size={14} /> Período
          </button>
        )}
      </div>

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-ink-3">
                <th className="px-2 pb-2 font-medium">Tipo</th>
                <th className="px-2 pb-2 font-medium">Tabela</th>
                <th className="px-2 pb-2 font-medium">De</th>
                <th className="px-2 pb-2 font-medium">Até</th>
                <th className="w-10 pb-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-2 py-2"><Pill tone={r.kind === "chief" ? "amber" : "sky"}>{r.kind === "chief" ? "Chefe" : "Vendedor"}</Pill></td>
                  <td className="px-2 py-2 font-medium">{r.tableName ?? <span className="text-danger">tabela apagada</span>}</td>
                  <td className="num px-2 py-2">{fmtDate(r.startDate)}</td>
                  <td className="num px-2 py-2">{r.endDate ? fmtDate(r.endDate) : <span className="text-ink-3">em vigor</span>}</td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      aria-label={`Remover período ${r.id}`}
                      className="btn-icon"
                      disabled={remove.isPending}
                      onClick={async () => { await remove.mutateAsync({ id: r.id }); }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {draft !== null && (
        <div className="mt-3 rounded-[12px] border border-line bg-bg p-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Tipo">
              <select aria-label="Tipo de tabela" className="input" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as "commission" | "chief", tableId: "" })}>
                <option value="commission">Tabela comisional (vendedor)</option>
                <option value="chief">Escalão de chefe de equipa</option>
              </select>
            </Field>
            <Field label="Tabela">
              <select aria-label="Tabela do período" className="input" value={draft.tableId} onChange={(e) => setDraft({ ...draft, tableId: e.target.value })}>
                <option value="">— Escolher —</option>
                {options.map((o) => (<option key={o.id} value={o.id}>{o.name}</option>))}
              </select>
            </Field>
            <Field label="Em vigor de">
              <input aria-label="Data de início" type="date" className="input" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} />
            </Field>
            <Field label="Até (opcional)">
              <input aria-label="Data de fim" type="date" className="input" value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} />
            </Field>
          </div>
          {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={save.isPending}
              onClick={async () => {
                setError(null);
                if (!draft.tableId) return setError("Escolha a tabela.");
                if (!draft.startDate) return setError("Indique a data de início.");
                try {
                  await save.mutateAsync({
                    employeeId,
                    kind: draft.kind,
                    tableId: Number(draft.tableId),
                    startDate: draft.startDate,
                    endDate: draft.endDate || null,
                  });
                  setDraft(null);
                } catch (err) {
                  setError(errMsg(err));
                }
              }}
            >
              Adicionar período
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => { setDraft(null); setError(null); }}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
