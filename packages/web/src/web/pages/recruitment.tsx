import { useMemo, useState } from "react";
import { Plus, Star, MapPin, Mail, Pencil, Briefcase } from "lucide-react";
import { useCandidates, useJobs, useMoveCandidate, useRemoveCandidate, useRemoveJob, useSaveCandidate, useSaveJob } from "../queries/recruitment";
import { useDepartments } from "../queries/hr";
import { PageHeader, Pill, Avatar, Modal, Field, SubmitRow, Empty, ConfirmDelete } from "../components/ui/kit";
import { JOB_STATUS, STAGES } from "../lib/labels";
import { errMsg } from "../lib/format";

type Job = NonNullable<ReturnType<typeof useJobs>["data"]>[number];
type Cand = NonNullable<ReturnType<typeof useCandidates>["data"]>[number];
type Stage = (typeof STAGES)[number]["key"];

function Stars({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <button type="button" key={i} disabled={!onChange} onClick={() => onChange?.(i)} className={onChange ? "cursor-pointer" : "cursor-default"}>
          <Star size={onChange ? 18 : 11} className={i <= value ? "fill-amber text-amber" : "text-ink-3"} />
        </button>
      ))}
    </div>
  );
}

function JobForm({ initial, onClose }: { initial: Job | null; onClose: () => void }) {
  const depts = useDepartments();
  const save = useSaveJob();
  const remove = useRemoveJob();
  const [f, setF] = useState({
    title: initial?.title ?? "", departmentId: initial?.departmentId ?? null as number | null, location: initial?.location ?? "",
    description: initial?.description ?? "", status: (initial?.status ?? "aberta") as "aberta" | "pausada" | "fechada",
  });
  const [error, setError] = useState<string | null>(null);
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      try {
        const p = { ...f, location: f.location || null, description: f.description || null };
        if (initial) await save.update.mutateAsync({ ...p, id: initial.id });
        else await save.create.mutateAsync(p);
        onClose();
      } catch (err) { setError(errMsg(err)); }
    }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Título da vaga" className="sm:col-span-2"><input aria-label="Título da vaga" className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required /></Field>
        <Field label="Departamento">
          <select className="input" value={f.departmentId ?? ""} onChange={(e) => setF({ ...f, departmentId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">—</option>
            {depts.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Localização"><input aria-label="Localização" className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        <Field label="Estado">
          <select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as typeof f.status })}>
            {Object.entries(JOB_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </Field>
        <Field label="Descrição" className="sm:col-span-2"><textarea aria-label="Descrição" className="input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </div>
      <SubmitRow pending={save.isPending} onCancel={onClose} error={error} extra={initial && <ConfirmDelete pending={remove.isPending} onConfirm={async () => { await remove.mutateAsync({ id: initial.id }); onClose(); }} />} />
    </form>
  );
}

function CandForm({ initial, jobs, defaultJob, onClose }: { initial: Cand | null; jobs: Job[]; defaultJob: number | null; onClose: () => void }) {
  const save = useSaveCandidate();
  const remove = useRemoveCandidate();
  const [f, setF] = useState({
    jobId: initial?.jobId ?? defaultJob ?? jobs.find((j) => j.status === "aberta")?.id ?? 0,
    name: initial?.name ?? "", email: initial?.email ?? "", phone: initial?.phone ?? "",
    stage: (initial?.stage ?? "candidatura") as Stage, rating: initial?.rating ?? 3, notes: initial?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      if (!f.jobId) return setError("Escolha uma vaga.");
      try {
        const p = { ...f, email: f.email || null, phone: f.phone || null, notes: f.notes || null };
        if (initial) await save.update.mutateAsync({ ...p, id: initial.id });
        else await save.create.mutateAsync(p);
        onClose();
      } catch (err) { setError(errMsg(err)); }
    }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome" className="sm:col-span-2"><input aria-label="Nome" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
        <Field label="Email"><input aria-label="Email" className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Telefone"><input aria-label="Telefone" className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Vaga">
          <select className="input" value={f.jobId} onChange={(e) => setF({ ...f, jobId: Number(e.target.value) })}>
            <option value={0}>—</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
          </select>
        </Field>
        <Field label="Etapa">
          <select className="input" value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value as Stage })}>
            {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Avaliação" className="sm:col-span-2"><Stars value={f.rating} onChange={(v) => setF({ ...f, rating: v })} /></Field>
        <Field label="Notas" className="sm:col-span-2"><textarea aria-label="Notas" className="input" rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      <SubmitRow pending={save.isPending} onCancel={onClose} error={error} extra={initial && <ConfirmDelete pending={remove.isPending} onConfirm={async () => { await remove.mutateAsync({ id: initial.id }); onClose(); }} />} />
    </form>
  );
}

export default function RecruitmentPage() {
  const jobs = useJobs();
  const cands = useCandidates();
  const move = useMoveCandidate();
  const [jobFilter, setJobFilter] = useState<number | null>(null);
  const [jEdit, setJEdit] = useState<Job | null | "new">(null);
  const [cEdit, setCEdit] = useState<Cand | null | "new">(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const list = useMemo(() => (cands.data ?? []).filter((c) => !jobFilter || c.jobId === jobFilter), [cands.data, jobFilter]);

  return (
    <div>
      <PageHeader eyebrow="Recursos Humanos" title="Recrutamento">
        <button className="btn btn-ghost" onClick={() => setJEdit("new")}><Briefcase size={15} /> Nova vaga</button>
        <button className="btn btn-primary" onClick={() => setCEdit("new")} disabled={!jobs.data?.length}><Plus size={15} /> Novo candidato</button>
      </PageHeader>

      <div className="rise -mx-1 mb-6 flex gap-3 overflow-x-auto px-1 pb-2">
        <button onClick={() => setJobFilter(null)} className={`card shrink-0 px-4 py-3 text-left transition ${!jobFilter ? "border-volt/50 bg-volt/5" : "hover:border-ink-3"}`}>
          <div className="label-mono">Todas as vagas</div>
          <div className="num mt-1 text-[20px] font-semibold">{cands.data?.length ?? "–"}</div>
        </button>
        {jobs.isLoading && Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-[74px] w-60 shrink-0 rounded-[14px]" />)}
        {jobs.data?.map((j) => (
          <div key={j.id} className={`group relative w-64 shrink-0 ${j.status === "fechada" ? "opacity-60" : ""}`}>
            <button type="button" onClick={() => setJobFilter(j.id === jobFilter ? null : j.id)} className={`card block w-full px-4 py-3 text-left transition ${jobFilter === j.id ? "border-volt/50 bg-volt/5" : "hover:border-ink-3"}`}>
              <div className="min-w-0 pr-6">
                <div className="truncate text-[13px] font-medium">{j.title}</div>
                <div className="mt-0.5 flex items-center gap-1 text-[11.5px] text-ink-3"><MapPin size={11} />{j.location || "—"} · {j.departmentName}</div>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <Pill {...JOB_STATUS[j.status]} />
                <span className="num text-[12px] text-ink-2">{j.candidateCount} cand.</span>
              </div>
            </button>
            <button type="button" aria-label="Editar vaga" className="btn-icon absolute right-1.5 top-1.5 h-7 w-7 opacity-0 focus:opacity-100 group-hover:opacity-100" onClick={() => setJEdit(j)}><Pencil size={12} /></button>
          </div>
        ))}
      </div>

      {cands.isLoading ? (
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">{STAGES.map((s) => <div key={s.key} className="skeleton h-80 rounded-[14px]" />)}</div>
      ) : !jobs.data?.length ? (
        <div className="card"><Empty title="Sem vagas" text="Crie uma vaga para começar a receber candidatos." action={<button className="btn btn-primary" onClick={() => setJEdit("new")}><Plus size={15} /> Nova vaga</button>} /></div>
      ) : (
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {STAGES.map((s, si) => {
            const items = list.filter((c) => c.stage === s.key);
            return (
              <div
                key={s.key}
                onDragOver={(e) => { e.preventDefault(); setDragOver(s.key); }}
                onDragLeave={() => setDragOver(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(null);
                  const id = Number(e.dataTransfer.getData("text/plain"));
                  if (id) move.mutate({ id, stage: s.key });
                }}
                className={`rise flex min-h-[320px] flex-col rounded-[14px] border p-2.5 transition ${dragOver === s.key ? "border-volt/50 bg-volt/5" : "border-line bg-surface/50"}`}
                style={{ animationDelay: `${si * 40}ms` }}
              >
                <div className="mb-2.5 flex items-center justify-between px-1.5 pt-1">
                  <span className="flex items-center gap-2 text-[12.5px] font-medium"><span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}</span>
                  <span className="num text-[11px] text-ink-3">{items.length}</span>
                </div>
                <div className="flex flex-1 flex-col gap-2">
                  {items.map((c) => (
                    <button
                      type="button"
                      key={c.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", String(c.id))}
                      onClick={() => setCEdit(c)}
                      className="block w-full cursor-grab rounded-[11px] border border-line bg-surface p-3 text-left transition hover:border-ink-3 active:cursor-grabbing"
                    >
                      <div className="flex items-center gap-2">
                        <Avatar name={c.name} size={24} color={s.color} />
                        <div className="min-w-0 flex-1 truncate text-[13px] font-medium">{c.name}</div>
                      </div>
                      <div className="mt-2 truncate text-[11.5px] text-ink-3">{c.jobTitle}</div>
                      <div className="mt-2 flex items-center justify-between">
                        <Stars value={c.rating} />
                        {c.email && <span title={c.email} className="text-ink-3"><Mail size={12} /></span>}
                      </div>
                    </button>
                  ))}
                  {!items.length && <div className="flex flex-1 items-center justify-center rounded-[11px] border border-dashed border-line text-[11.5px] text-ink-3">Arraste para aqui</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={jEdit !== null} onClose={() => setJEdit(null)} title={jEdit === "new" ? "Nova vaga" : "Editar vaga"}>
        {jEdit !== null && <JobForm initial={jEdit === "new" ? null : jEdit} onClose={() => setJEdit(null)} />}
      </Modal>
      <Modal open={cEdit !== null} onClose={() => setCEdit(null)} title={cEdit === "new" ? "Novo candidato" : "Candidato"}>
        {cEdit !== null && <CandForm initial={cEdit === "new" ? null : cEdit} jobs={jobs.data ?? []} defaultJob={jobFilter} onClose={() => setCEdit(null)} />}
      </Modal>
    </div>
  );
}
