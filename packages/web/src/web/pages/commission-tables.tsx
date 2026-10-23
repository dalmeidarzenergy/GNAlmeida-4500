import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useCommissionTables, useRemoveCommissionTable, useSaveCommissionTable } from "../queries/commission-tables";
import { useDepartments } from "../queries/hr";
import { PageHeader, Modal, Field, SubmitRow, Empty, ConfirmDelete, Pill } from "../components/ui/kit";
import { errMsg, fmtEur } from "../lib/format";

type Table = NonNullable<ReturnType<typeof useCommissionTables>["data"]>[number];
type Row = Table["rows"][number];
type Draft = { label: string; minSales: string; maxSales: string; baseSalary: string; commissionPerSale: string };

const COLORS = ["#c6f432", "#f5a524", "#38bdf8", "#a78bfa", "#f472b6", "#34d399", "#fb7185", "#facc15"];
const SCALE_LABEL: Record<string, string> = { none: "Escalões fixos", sales: "Por faixas de vendas" };

const emptyDraft = (): Draft => ({ label: "", minSales: "", maxSales: "", baseSalary: "", commissionPerSale: "" });

const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
const str = (v: number | null | undefined) => (v == null ? "" : String(v));

function TableForm({ initial, onClose }: { initial: Table | null; onClose: () => void }) {
  const depts = useDepartments();
  const save = useSaveCommissionTable();
  const remove = useRemoveCommissionTable();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [departmentId, setDept] = useState<number | null>(initial?.departmentId ?? null);
  const [scaleBy, setScaleBy] = useState<"none" | "sales">((initial?.scaleBy as "none" | "sales") ?? "none");
  const [color, setColor] = useState(initial?.color ?? COLORS[0]);
  const [active, setActive] = useState(initial?.active ?? true);
  const [rows, setRows] = useState<Draft[]>(
    initial?.rows.length
      ? initial.rows.map((r) => ({ label: r.label, minSales: str(r.minSales), maxSales: str(r.maxSales), baseSalary: str(r.baseSalary), commissionPerSale: str(r.commissionPerSale) }))
      : [emptyDraft()],
  );
  const [error, setError] = useState<string | null>(null);

  const setRow = (i: number, patch: Partial<Draft>) => setRows((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const clean = rows.filter((r) => r.label.trim() !== "");
        if (!clean.length) return setError("Adicione pelo menos um escalão à tabela.");
        try {
          const p = {
            name,
            description: description || null,
            departmentId,
            scaleBy,
            color,
            active,
            rows: clean.map((r, i) => ({
              label: r.label.trim(),
              minSales: scaleBy === "sales" ? num(r.minSales) : null,
              maxSales: scaleBy === "sales" ? num(r.maxSales) : null,
              baseSalary: num(r.baseSalary),
              commissionPerSale: num(r.commissionPerSale),
              position: i,
            })),
          };
          if (initial) await save.update.mutateAsync({ ...p, id: initial.id });
          else await save.create.mutateAsync(p);
          onClose();
        } catch (err) {
          setError(errMsg(err));
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome da tabela" className="sm:col-span-2">
          <input aria-label="Nome da tabela" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Descrição" className="sm:col-span-2">
          <textarea aria-label="Descrição" className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Departamento">
          <select className="input" value={departmentId ?? ""} onChange={(e) => setDept(e.target.value ? Number(e.target.value) : null)}>
            <option value="">—</option>
            {depts.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Tipo de escalonamento">
          <select aria-label="Tipo de escalonamento" className="input" value={scaleBy} onChange={(e) => setScaleBy(e.target.value as "none" | "sales")}>
            <option value="none">Escalões fixos (níveis)</option>
            <option value="sales">Por faixas de vendas</option>
          </select>
        </Field>
        <Field label="Cor">
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button type="button" aria-label={`Cor ${c}`} key={c} onClick={() => setColor(c)} className={`h-8 w-8 rounded-full transition ${color === c ? "ring-2 ring-offset-2 ring-offset-surface" : "opacity-70 hover:opacity-100"}`} style={{ background: c, ["--tw-ring-color" as string]: c }} />
            ))}
          </div>
        </Field>
        <Field label="Estado">
          <label className="flex h-10 items-center gap-2.5 text-[13px]">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Tabela ativa
          </label>
        </Field>
      </div>

      <div className="mt-6 mb-2 flex items-center justify-between">
        <span className="label-mono">Escalões</span>
        <button type="button" className="btn btn-ghost" onClick={() => setRows((p) => [...p, emptyDraft()])}>
          <Plus size={14} /> Escalão
        </button>
      </div>

      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid gap-2 rounded-[10px] border border-line p-3 sm:grid-cols-12">
            <div className={scaleBy === "sales" ? "sm:col-span-4" : "sm:col-span-6"}>
              <input aria-label={`Escalão ${i + 1}`} className="input" placeholder={scaleBy === "sales" ? "Sem nome (opcional)" : "Ex.: Nível 1"} value={r.label} onChange={(e) => setRow(i, { label: e.target.value })} />
            </div>
            {scaleBy === "sales" && (
              <>
                <div className="sm:col-span-2">
                  <input aria-label={`Mínimo de vendas ${i + 1}`} className="input num" placeholder="De" value={r.minSales} onChange={(e) => setRow(i, { minSales: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <input aria-label={`Máximo de vendas ${i + 1}`} className="input num" placeholder="Até" value={r.maxSales} onChange={(e) => setRow(i, { maxSales: e.target.value })} />
                </div>
              </>
            )}
            <div className={scaleBy === "sales" ? "sm:col-span-2" : "sm:col-span-2"}>
              <input aria-label={`Salário base ${i + 1}`} className="input num" placeholder="Salário base €" value={r.baseSalary} onChange={(e) => setRow(i, { baseSalary: e.target.value })} />
            </div>
            <div className={scaleBy === "sales" ? "sm:col-span-2" : "sm:col-span-3"}>
              <input aria-label={`Comissão por venda ${i + 1}`} className="input num" placeholder="Comissão/venda €" value={r.commissionPerSale} onChange={(e) => setRow(i, { commissionPerSale: e.target.value })} />
            </div>
            <button type="button" aria-label={`Remover escalão ${i + 1}`} className="btn-icon sm:col-span-1" onClick={() => setRows((p) => (p.length === 1 ? [emptyDraft()] : p.filter((_, j) => j !== i)))}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11.5px] text-ink-3">Podes deixar o salário ou a comissão em branco — os dois valores são opcionais.</p>

      <SubmitRow pending={save.isPending} onCancel={onClose} error={error} extra={initial && <ConfirmDelete pending={remove.isPending} onConfirm={async () => { await remove.mutateAsync({ id: initial.id }); onClose(); }} />} />
    </form>
  );
}

export default function CommissionTablesPage() {
  const tables = useCommissionTables();
  const [edit, setEdit] = useState<Table | null | "new">(null);
  const list = tables.data ?? [];

  return (
    <div>
      <PageHeader eyebrow="Recursos Humanos" title="Tabelas Comissionais">
        <button className="btn btn-primary" onClick={() => setEdit("new")}><Plus size={15} /> Nova tabela</button>
      </PageHeader>

      {tables.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-52 rounded-[14px]" />)}</div>
      ) : !list.length ? (
        <div className="card"><Empty title="Sem tabelas comissionais" text="Crie a primeira tabela de escalões e valores." /></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((t, i) => (
            <button key={t.id} onClick={() => setEdit(t)} className="card rise group relative overflow-hidden p-5 text-left transition hover:border-ink-3" style={{ animationDelay: `${i * 40}ms` }}>
              <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-20 blur-2xl transition group-hover:opacity-40" style={{ background: t.color }} />
              <div className="flex items-start justify-between gap-2">
                <span className="h-2.5 w-8 rounded-full" style={{ background: t.color }} />
                <Pencil size={13} className="shrink-0 text-ink-3 opacity-0 transition group-hover:opacity-100" />
              </div>
              <div className="mt-4 font-display text-[17px] font-semibold">{t.name}</div>
              <div className="mt-1 line-clamp-1 text-[12.5px] text-ink-3">{t.description || "Sem descrição"}</div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Pill tone={t.scaleBy === "sales" ? "amber" : "sky"}>{SCALE_LABEL[t.scaleBy] ?? t.scaleBy}</Pill>
                {!t.active && <Pill tone="muted">Inativa</Pill>}
              </div>
              <div className="mt-5 flex items-end justify-between">
                <div>
                  <div className="label-mono">escalões</div>
                  <div className="num text-[22px] font-semibold leading-none">{t.rowCount}</div>
                </div>
                <div className="text-right">
                  <div className="label-mono">salário base</div>
                  <div className="num text-[13px]">
                    {(() => {
                      const vals = t.rows.map((r) => r.baseSalary).filter((v): v is number => v != null);
                      if (!vals.length) return "—";
                      const mn = Math.min(...vals), mx = Math.max(...vals);
                      return mn === mx ? fmtEur(mn) : `${fmtEur(mn)} – ${fmtEur(mx)}`;
                    })()}
                  </div>
                </div>
              </div>
              {t.departmentName && <div className="mt-3 text-[12px] text-ink-3">{t.departmentName}</div>}
            </button>
          ))}
        </div>
      )}

      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit === "new" ? "Nova tabela comisional" : "Editar tabela comisional"} wide>
        {edit !== null && <TableForm key={edit === "new" ? "new" : edit.id} initial={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
      </Modal>
    </div>
  );
}
