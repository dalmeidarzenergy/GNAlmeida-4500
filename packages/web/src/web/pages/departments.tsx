import { useState } from "react";
import { Plus, Pencil, Users } from "lucide-react";
import { useDepartments, usePositions, useRemoveDepartment, useRemovePosition, useSaveDepartment, useSavePosition } from "../queries/hr";
import { PageHeader, Modal, Field, SubmitRow, Empty, TableSkeleton, ConfirmDelete } from "../components/ui/kit";
import { errMsg, fmtEur } from "../lib/format";
import { BONDS } from "../../api/shared/bonds";

type Dept = NonNullable<ReturnType<typeof useDepartments>["data"]>[number];
type Pos = NonNullable<ReturnType<typeof usePositions>["data"]>[number];
const COLORS = ["#c6f432", "#f5a524", "#38bdf8", "#a78bfa", "#f472b6", "#34d399", "#fb7185", "#facc15"];
const LEVELS = ["Estagiário", "Júnior", "Pleno", "Sénior", "Direção"];

function DeptForm({ initial, onClose }: { initial: Dept | null; onClose: () => void }) {
  const save = useSaveDepartment();
  const remove = useRemoveDepartment();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [color, setColor] = useState(initial?.color ?? COLORS[0]);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          const p = { name, description: description || null, color };
          if (initial) await save.update.mutateAsync({ ...p, id: initial.id });
          else await save.create.mutateAsync(p);
          onClose();
        } catch (err) {
          setError(errMsg(err));
        }
      }}
    >
      <div className="space-y-4">
        <Field label="Nome"><input aria-label="Nome" className="input" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        <Field label="Descrição"><textarea aria-label="Descrição" className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Cor">
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button type="button" aria-label={`Cor ${c}`} key={c} onClick={() => setColor(c)} className={`h-8 w-8 rounded-full transition ${color === c ? "ring-2 ring-offset-2 ring-offset-surface" : "opacity-70 hover:opacity-100"}`} style={{ background: c, ["--tw-ring-color" as string]: c }} />
            ))}
          </div>
        </Field>
      </div>
      <SubmitRow pending={save.isPending} onCancel={onClose} error={error} extra={initial && <ConfirmDelete pending={remove.isPending} onConfirm={async () => { await remove.mutateAsync({ id: initial.id }); onClose(); }} />} />
    </form>
  );
}

function PosForm({ initial, onClose }: { initial: Pos | null; onClose: () => void }) {
  const depts = useDepartments();
  const save = useSavePosition();
  const remove = useRemovePosition();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [departmentId, setDept] = useState<number | null>(initial?.departmentId ?? null);
  const [level, setLevel] = useState(initial?.level ?? "Pleno");
  const [bondTypes, setBondTypes] = useState<string[]>((initial?.bondTypes ?? []) as string[]);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          const p = { title, departmentId, level, bondTypes };
          if (initial) await save.update.mutateAsync({ ...p, id: initial.id });
          else await save.create.mutateAsync(p);
          onClose();
        } catch (err) {
          setError(errMsg(err));
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Cargo" className="sm:col-span-2"><input aria-label="Cargo" className="input" value={title} onChange={(e) => setTitle(e.target.value)} required /></Field>
        <Field label="Departamento">
          <select className="input" value={departmentId ?? ""} onChange={(e) => setDept(e.target.value ? Number(e.target.value) : null)}>
            <option value="">—</option>
            {depts.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Nível">
          <select className="input" value={level} onChange={(e) => setLevel(e.target.value)}>
            {LEVELS.map((l) => <option key={l}>{l}</option>)}
          </select>
        </Field>
        <Field label="Tipos de vínculo que este cargo aceita" className="sm:col-span-2">
          <div className="flex flex-wrap gap-2">
            {BONDS.map((b) => {
              const on = bondTypes.includes(b);
              return (
                <button type="button" key={b} onClick={() => setBondTypes((p) => (on ? p.filter((x) => x !== b) : [...p, b]))} className={`h-9 rounded-[9px] border px-3 text-[12.5px] transition ${on ? "border-volt/50 bg-volt/10 text-volt" : "border-line text-ink-2 hover:text-ink"}`}>
                  {b}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-[11.5px] text-ink-3">Sem seleção, a ficha do funcionário não mostra o campo Tipo de vínculo para este cargo.</p>
        </Field>
      </div>
      <SubmitRow pending={save.isPending} onCancel={onClose} error={error} extra={initial && <ConfirmDelete pending={remove.isPending} onConfirm={async () => { await remove.mutateAsync({ id: initial.id }); onClose(); }} />} />
    </form>
  );
}

export default function DepartmentsPage() {
  const depts = useDepartments();
  const positions = usePositions();
  const [dEdit, setDEdit] = useState<Dept | null | "new">(null);
  const [pEdit, setPEdit] = useState<Pos | null | "new">(null);
  const maxHead = Math.max(...(depts.data ?? []).map((d) => Number(d.headcount)), 1);

  return (
    <div>
      <PageHeader eyebrow="Recursos Humanos" title="Departamentos e cargos">
        <button className="btn btn-ghost" onClick={() => setPEdit("new")}><Plus size={15} /> Novo cargo</button>
        <button className="btn btn-primary" onClick={() => setDEdit("new")}><Plus size={15} /> Novo departamento</button>
      </PageHeader>

      {depts.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-40 rounded-[14px]" />)}</div>
      ) : !depts.data?.length ? (
        <div className="card"><Empty title="Sem departamentos" text="Crie o primeiro departamento da empresa." /></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {depts.data.map((d, i) => (
            <button key={d.id} onClick={() => setDEdit(d)} className="card rise group relative overflow-hidden p-5 text-left transition hover:border-ink-3" style={{ animationDelay: `${i * 40}ms` }}>
              <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-20 blur-2xl transition group-hover:opacity-40" style={{ background: d.color }} />
              <div className="flex items-start justify-between">
                <span className="h-2.5 w-8 rounded-full" style={{ background: d.color }} />
                <Pencil size={13} className="text-ink-3 opacity-0 transition group-hover:opacity-100" />
              </div>
              <div className="mt-4 font-display text-[17px] font-semibold">{d.name}</div>
              <div className="mt-1 line-clamp-1 text-[12.5px] text-ink-3">{d.description || "Sem descrição"}</div>
              <div className="mt-5 flex items-end justify-between">
                <div className="flex items-center gap-2">
                  <Users size={14} className="text-ink-3" />
                  <span className="num text-[22px] font-semibold leading-none">{d.headcount}</span>
                  <span className="text-[12px] text-ink-3">pessoas</span>
                </div>
                <div className="text-right">
                  <div className="label-mono">massa salarial</div>
                  <div className="num text-[13px]">{fmtEur(Number(d.payroll))}</div>
                </div>
              </div>
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full" style={{ width: `${(Number(d.headcount) / maxHead) * 100}%`, background: d.color }} />
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="mt-10 mb-4 flex items-baseline justify-between">
        <h2 className="text-[20px] font-semibold">Cargos</h2>
        <span className="label-mono">{positions.data?.length ?? 0} cargos</span>
      </div>
      <div className="card overflow-hidden">
        {positions.isLoading ? <TableSkeleton cols={4} /> : (
          <table className="tbl">
            <thead><tr><th>Cargo</th><th>Departamento</th><th>Nível</th><th className="text-right">Pessoas</th><th aria-label="Ações" /></tr></thead>
            <tbody>
              {positions.data?.map((p) => {
                const d = depts.data?.find((x) => x.id === p.departmentId);
                return (
                  <tr key={p.id} className="cursor-pointer" onClick={() => setPEdit(p)}>
                    <td className="font-medium">{p.title}</td>
                    <td><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: d?.color ?? "var(--ink-3)" }} />{p.departmentName ?? "—"}</span></td>
                    <td className="text-ink-2">{p.level}</td>
                    <td className="num text-right">{p.headcount}</td>
                    <td className="w-10 text-right"><span className="btn-icon"><Pencil size={14} /></span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={dEdit !== null} onClose={() => setDEdit(null)} title={dEdit === "new" ? "Novo departamento" : "Editar departamento"}>
        {dEdit !== null && <DeptForm initial={dEdit === "new" ? null : dEdit} onClose={() => setDEdit(null)} />}
      </Modal>
      <Modal open={pEdit !== null} onClose={() => setPEdit(null)} title={pEdit === "new" ? "Novo cargo" : "Editar cargo"}>
        {pEdit !== null && <PosForm initial={pEdit === "new" ? null : pEdit} onClose={() => setPEdit(null)} />}
      </Modal>
    </div>
  );
}
