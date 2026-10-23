import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useCommissionTables, useRemoveCommissionTable, useSaveCommissionTable } from "../queries/commission-tables";
import { PageHeader, Modal, Field, SubmitRow, Empty, ConfirmDelete, Pill } from "../components/ui/kit";
import { errMsg, fmtEur } from "../lib/format";

type Table = NonNullable<ReturnType<typeof useCommissionTables>["data"]>[number];
type Row = Table["medemRows"][number];
type DraftRow = { min: string; max: string; commission: string };

const COLORS = ["#c6f432", "#f5a524", "#38bdf8", "#a78bfa", "#f472b6", "#34d399", "#fb7185", "#facc15"];

const emptyDraft = (): DraftRow => ({ min: "", max: "", commission: "" });
const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
const str = (v: number | null | undefined) => (v == null ? "" : String(v));

/** Campo numérico de comissão fixa (€). */
function MoneyField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <input aria-label={label} className="input num" placeholder="€" value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

/** Linhas de escalões (MEDEM por pontos ou SOLAR por painéis). */
function EscaloesEditor({ title, hint, unit, rows, onChange }: { title: string; hint: string; unit: string; rows: DraftRow[]; onChange: (rows: DraftRow[]) => void }) {
  const setRow = (i: number, patch: Partial<DraftRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => onChange([...rows, emptyDraft()]);
  const del = (i: number) => onChange(rows.length === 1 ? [emptyDraft()] : rows.filter((_, j) => j !== i));
  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <div className="font-display text-[14px] font-semibold">{title}</div>
          <div className="text-[11.5px] text-ink-3">{hint}</div>
        </div>
        <button type="button" className="btn btn-ghost" onClick={add}><Plus size={14} /> Escalão</button>
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid gap-2 rounded-[10px] border border-line p-3 sm:grid-cols-12">
            <div className="sm:col-span-4">
              <input aria-label={`${title} mínimo ${i + 1}`} className="input num" placeholder={`De (${unit})`} value={r.min} onChange={(e) => setRow(i, { min: e.target.value })} />
            </div>
            <div className="sm:col-span-4">
              <input aria-label={`${title} máximo ${i + 1}`} className="input num" placeholder={`Até (${unit})`} value={r.max} onChange={(e) => setRow(i, { max: e.target.value })} />
            </div>
            <div className="sm:col-span-3">
              <input aria-label={`${title} comissão ${i + 1}`} className="input num" placeholder="Comissão €" value={r.commission} onChange={(e) => setRow(i, { commission: e.target.value })} />
            </div>
            <button type="button" aria-label={`Remover escalão ${i + 1}`} className="btn-icon sm:col-span-1" onClick={() => del(i)}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function TableForm({ initial, onClose }: { initial: Table | null; onClose: () => void }) {
  const save = useSaveCommissionTable();
  const remove = useRemoveCommissionTable();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [color, setColor] = useState(initial?.color ?? COLORS[0]);
  const [active, setActive] = useState(initial?.active ?? true);
  const [luz, setLuz] = useState(str(initial?.luz));
  const [gas, setGas] = useState(str(initial?.gas));
  const [ddc, setDdc] = useState(str(initial?.ddc));
  const [fe, setFe] = useState(str(initial?.fe));
  const [pel, setPel] = useState(str(initial?.pel));
  const [medemRows, setMedemRows] = useState<DraftRow[]>(initial?.medemRows.length ? initial.medemRows.map((r) => ({ min: str(r.min), max: str(r.max), commission: str(r.commission) })) : [emptyDraft()]);
  const [solarRows, setSolarRows] = useState<DraftRow[]>(initial?.solarRows.length ? initial.solarRows.map((r) => ({ min: str(r.min), max: str(r.max), commission: str(r.commission) })) : [emptyDraft()]);
  const [error, setError] = useState<string | null>(null);

  const toRow = (r: DraftRow) => ({ min: num(r.min), max: num(r.max), commission: num(r.commission) });

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const p = {
          name,
          description: description || null,
          color,
          active,
          luz: num(luz),
          gas: num(gas),
          ddc: num(ddc),
          fe: num(fe),
          pel: num(pel),
          medemRows: medemRows.map(toRow),
          solarRows: solarRows.map(toRow),
        };
        try {
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

      <div className="mt-6">
        <div className="font-display text-[14px] font-semibold">Comissões fixas (por venda)</div>
        <div className="text-[11.5px] text-ink-3">Valores pagos por cada venda. Deixa em branco os que não se aplicam.</div>
        <div className="mt-3 grid gap-4 sm:grid-cols-5">
          <MoneyField label="LUZ (€)" value={luz} onChange={setLuz} />
          <MoneyField label="GÁS (€)" value={gas} onChange={setGas} />
          <MoneyField label="DDC (€)" value={ddc} onChange={setDdc} />
          <MoneyField label="FE (€)" value={fe} onChange={setFe} />
          <MoneyField label="PEL (€)" value={pel} onChange={setPel} />
        </div>
      </div>

      <EscaloesEditor title="Escalões MEDEM" hint="Faixas por número de pontos." unit="pontos" rows={medemRows} onChange={setMedemRows} />
      <EscaloesEditor title="Tabela Solar" hint="Faixas por quantidade de painéis solares." unit="painéis" rows={solarRows} onChange={setSolarRows} />

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
        <div className="card"><Empty title="Sem tabelas comissionais" text="Crie a primeira tabela de comissões (LUZ, GÁS, DDC, FE, PEL), escalões MEDEM e tabela Solar." /></div>
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
                {!t.active && <Pill tone="muted">Inativa</Pill>}
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
                <div>
                  <div className="text-[10.5px] uppercase tracking-wide text-ink-3">LUZ</div>
                  <div className="num text-[13px] font-semibold">{t.luz != null ? fmtEur(t.luz) : "—"}</div>
                </div>
                <div>
                  <div className="text-[10.5px] uppercase tracking-wide text-ink-3">MEDEM</div>
                  <div className="num text-[13px] font-semibold">{t.medemRows.length} escalões</div>
                </div>
                <div>
                  <div className="text-[10.5px] uppercase tracking-wide text-ink-3">Solar</div>
                  <div className="num text-[13px] font-semibold">{t.solarRows.length} faixas</div>
                </div>
              </div>
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
