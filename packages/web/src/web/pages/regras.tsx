import { useState } from "react";
import { Plus, Pencil, Trash2, Loader2, Scale, Zap } from "lucide-react";
import { PageHeader, Empty, Field, Modal, SubmitRow, ConfirmDelete, TableSkeleton } from "../components/ui/kit";
import { useMe } from "../queries/me";
import { useRules, useSaveRule, useRemoveRule } from "../queries/rules";
import { errMsg, fmtDate } from "../lib/format";

type Rule = NonNullable<ReturnType<typeof useRules>["data"]>[number];

const blank = {
  name: "",
  type: "manual" as "manual" | "auto",
  description: "" as string,
  sourceColumn: "" as string,
  operator: ">" as ">" | "<" | ">=" | "<=" | "==" | "!=",
  compareValue: "" as string,
  effectType: "fixed_eur" as "fixed_eur" | "percent",
  effectValue: 0,
  active: true,
};

const OPERATORS = [
  { key: ">", label: "maior que (>)" },
  { key: "<", label: "menor que (<)" },
  { key: ">=", label: "maior ou igual (>=)" },
  { key: "<=", label: "menor ou igual (<=)" },
  { key: "==", label: "igual (==)" },
  { key: "!=", label: "diferente (!=)" },
] as const;

export default function RegrasPage() {
  const me = useMe();
  const canEdit = me.data?.permissions?.["regras"]?.edit ?? false;
  const rules = useRules();
  const save = useSaveRule();
  const remove = useRemoveRule();
  const [editing, setEditing] = useState<Rule | null | "new">(null);

  const list = rules.data ?? [];

  return (
    <div className="p-5 lg:p-7">
      <PageHeader
        eyebrow="Pagamentos"
        title="Regras"
        subtitle="Regras que descontam ou penalizam sobre o Auto Iberdrola. As automáticas aplicam-se a todos; as manuais são atribuídas a cada comercial."
      >
        {canEdit && (
          <button className="btn btn-primary" onClick={() => setEditing("new")}>
            <Plus size={15} /> Nova regra
          </button>
        )}
      </PageHeader>

      {rules.isLoading ? (
        <div className="card p-5"><TableSkeleton rows={4} cols={4} /></div>
      ) : rules.isError ? (
        <div className="card p-5"><Empty title="Não foi possível carregar" text={errMsg(rules.error)} /></div>
      ) : !list.length ? (
        <div className="card">
          <Empty
            title="Ainda sem regras"
            text={canEdit ? "Cria a primeira regra para começar a descontar sobre os autos." : "Ainda não há regras definidas."}
            action={canEdit ? <button className="btn btn-primary" onClick={() => setEditing("new")}><Plus size={15} /> Nova regra</button> : undefined}
          />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <div className="font-display text-[15px] font-semibold">Regras</div>
            <div className="text-[11.5px] text-ink-3">{list.length} regra{list.length === 1 ? "" : "s"}</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="px-5 py-3 font-medium">REGRA</th>
                  <th className="px-3 py-3 font-medium">TIPO</th>
                  <th className="px-3 py-3 font-medium">CONDIÇÃO</th>
                  <th className="px-3 py-3 text-right font-medium">EFEITO</th>
                  <th className="px-3 py-3 font-medium">ESTADO</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-3">
                      <div className="font-medium">{r.name}</div>
                      {r.description && <div className="text-[11.5px] text-ink-3">{r.description}</div>}
                    </td>
                    <td className="px-3 py-3">
                      {r.type === "auto" ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-sky/10 px-2 py-0.5 text-[11.5px] font-medium text-sky"><Zap size={11} /> Automática</span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-volt/10 px-2 py-0.5 text-[11.5px] font-medium text-volt"><Scale size={11} /> Manual</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-ink-2">
                      {r.type === "auto" && r.sourceColumn ? (
                        <span className="num">"{r.sourceColumn}" {r.operator} {r.compareValue}</span>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                    <td className="num px-3 py-3 text-right font-medium">
                      {r.effectType === "percent"
                        ? `${r.effectValue > 0 ? "+" : ""}${Math.round(r.effectValue * 100)}%`
                        : `${r.effectValue > 0 ? "+" : ""}${r.effectValue.toLocaleString("pt-PT", { maximumFractionDigits: 2 })}€`}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`text-[11.5px] font-medium ${r.active ? "text-volt" : "text-ink-3"}`}>{r.active ? "Ativa" : "Inativa"}</span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      {canEdit && (
                        <span className="flex justify-end gap-1">
                          <button type="button" className="btn-icon" aria-label="Editar" onClick={() => setEditing(r)}><Pencil size={14} /></button>
                          <button
                            type="button"
                            className="btn-icon text-rose"
                            aria-label="Eliminar"
                            onClick={async () => {
                              if (window.confirm(`Eliminar a regra "${r.name}"?`)) await remove.mutateAsync({ id: r.id });
                            }}
                          ><Trash2 size={14} /></button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Nova regra" : "Editar regra"}>
        {editing !== null && <RuleForm initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function RuleForm({ initial, onClose }: { initial: Rule | null; onClose: () => void }) {
  const save = useSaveRule();
  const remove = useRemoveRule();
  const [f, setF] = useState(initial ? { ...initial, description: initial.description ?? "" } : { ...blank });
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        name: f.name.trim(),
        type: f.type,
        description: f.description.trim() || null,
        effectType: f.effectType,
        effectValue: f.effectValue,
        active: f.active,
      };
      if (f.type === "auto") {
        payload.sourceColumn = f.sourceColumn.trim() || null;
        payload.operator = f.operator;
        payload.compareValue = f.compareValue;
      } else {
        payload.sourceColumn = null;
        payload.operator = null;
        payload.compareValue = null;
      }
      if (initial) await save.update.mutateAsync({ id: initial.id, ...payload } as never);
      else await save.create.mutateAsync(payload as never);
      onClose();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="grid gap-4">
        <Field label="Nome da regra">
          <input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} required placeholder="Ex: Folha de Km's" />
        </Field>
        <Field label="Descrição">
          <input className="input" value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Opcional" />
        </Field>
        <Field label="Tipo">
          <select className="input" value={f.type} onChange={(e) => set("type", e.target.value as typeof f.type)}>
            <option value="manual">Manual — atribuída a cada comercial</option>
            <option value="auto">Automática — aplica-se a todos</option>
          </select>
        </Field>

        {f.type === "auto" && (
          <>
            <Field label="Coluna do Excel (condição)">
              <input className="input" value={f.sourceColumn} onChange={(e) => set("sourceColumn", e.target.value)} required placeholder="Ex: Timing de contratação" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Operador">
                <select className="input" value={f.operator} onChange={(e) => set("operator", e.target.value as typeof f.operator)}>
                  {OPERATORS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="Valor">
                <input className="input num" value={f.compareValue} onChange={(e) => set("compareValue", e.target.value)} required placeholder="Ex: 3" />
              </Field>
            </div>
            <p className="-mt-1 text-[11.5px] text-ink-3">A regra aplica-se a cada venda cujo valor desta coluna satisfaça a condição.</p>
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo de efeito">
            <select className="input" value={f.effectType} onChange={(e) => set("effectType", e.target.value as typeof f.effectType)}>
              <option value="fixed_eur">Valor fixo (€)</option>
              <option value="percent">Percentagem (%)</option>
            </select>
          </Field>
          <Field label={f.effectType === "percent" ? "Desconto (%)" : "Valor (€)"}>
            <input
              className="input num"
              type="number"
              step={f.effectType === "percent" ? "0.01" : "1"}
              value={f.effectValue}
              onChange={(e) => set("effectValue", Number(e.target.value))}
              required
            />
          </Field>
        </div>
        <p className="-mt-1 text-[11.5px] text-ink-3">
          {f.effectType === "percent" ? "Use um valor negativo para descontar (ex: -10 = -10%)." : "Use um valor negativo para penalizar (ex: -10€)."}
        </p>

        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={f.active} onChange={(e) => set("active", e.target.checked)} />
          Regra ativa
        </label>
      </div>
      <SubmitRow
        pending={save.isPending}
        onCancel={onClose}
        error={error}
        extra={initial && <ConfirmDelete pending={remove.isPending} onConfirm={async () => { await remove.mutateAsync({ id: initial.id }); onClose(); }} />}
      />
    </form>
  );
}