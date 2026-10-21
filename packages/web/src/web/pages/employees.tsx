import { useMemo, useState } from "react";
import { Plus, Pencil, Mail, Phone, List, Network, Crown, AlertTriangle, Camera, Loader2, Trash2 } from "lucide-react";
import { client } from "../lib/api";
import { canManage, NON_MANAGER_POSITIONS } from "../../api/shared/hierarchy";
import { OrgChart } from "../components/org-chart";
import { TeamFilter, useTeamIds } from "../components/team-filter";
import { useDepartments, useEmployees, usePositions, useRemoveEmployee, useSaveEmployee } from "../queries/hr";
import { PageHeader, Pill, Avatar, Modal, Field, SubmitRow, SearchBox, Empty, TableSkeleton, Tabs, ConfirmDelete, Progress } from "../components/ui/kit";
import { EMP_STATUS } from "../lib/labels";
import { ETTS } from "../../api/shared/bonds";
import { errMsg, fmtDate, fmtEur, tenure, today } from "../lib/format";

type Emp = NonNullable<ReturnType<typeof useEmployees>["data"]>[number];

const blank = {
  name: "", email: "", phone: "", nif: "", photoKey: null as string | null, departmentId: null as number | null, positionId: null as number | null, managerId: null as number | null,
  hireDate: today(), terminationDate: "" as string, salary: 0, status: "ativo" as "ativo" | "pendente" | "suspenso" | "blacklist" | "inativo", isSeller: false, commissionRate: 0, vacationDays: 22,
  ett: "" as string, bond: "" as string,
};

/** Recorta ao centro (quadrado) e reduz para 512px em JPEG, para fotos leves. */
async function squareJpeg(file: File, size = 512): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.min(size, side);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Não foi possível processar a imagem"))), "image/jpeg", 0.88));
}

function PhotoPicker({ name, preview, uploading, onPick, onClear }: { name: string; preview: string | null; uploading: boolean; onPick: (f: File) => void; onClear: () => void }) {
  return (
    <div className="flex items-center gap-4 sm:col-span-2">
      <label className="group relative cursor-pointer" title="Escolher foto">
        <Avatar name={name || "?"} size={72} src={preview} />
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 opacity-0 transition group-hover:opacity-100">
          <Camera size={18} className="text-white" />
        </span>
        {uploading && <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45"><Loader2 size={18} className="animate-spin text-white" /></span>}
        <input
          type="file"
          accept="image/*"
          aria-label="Foto do funcionário"
          className="sr-only"
          onChange={(e) => { const file = e.target.files?.[0]; if (file) onPick(file); e.target.value = ""; }}
        />
      </label>
      <div className="text-[12.5px]">
        <div className="font-medium">Foto</div>
        <div className="text-ink-3">Aparece na lista, no organigrama e nos rankings.</div>
        {preview && !uploading && (
          <button type="button" onClick={onClear} className="mt-1 inline-flex items-center gap-1 text-[12px] text-rose hover:underline"><Trash2 size={12} /> Remover foto</button>
        )}
      </div>
    </div>
  );
}

/** IDs de todos os subordinados (diretos e indiretos) de um funcionário. */
function descendants(all: Emp[], id: number) {
  const out = new Set<number>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of all) if (e.managerId === cur && !out.has(e.id)) { out.add(e.id); stack.push(e.id); }
  }
  return out;
}

function EmployeeForm({ initial, onClose }: { initial: Emp | null; onClose: () => void }) {
  const emps = useEmployees();
  const depts = useDepartments();
  const positions = usePositions();
  const save = useSaveEmployee();
  const remove = useRemoveEmployee();
  const [f, setF] = useState(() => (initial ? { ...blank, ...initial, ett: initial.ett ?? "", bond: initial.bond ?? "", phone: initial.phone ?? "", nif: initial.nif ?? "", terminationDate: initial.terminationDate ?? "", status: initial.status as typeof blank.status } : blank));
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(initial?.photoUrl ?? null);
  const [uploading, setUploading] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const posOptions = (positions.data ?? []).filter((p) => !f.departmentId || p.departmentId === f.departmentId);
  const all = emps.data ?? [];
  const top = all.find((e) => e.managerId == null && e.id !== initial?.id);
  const blocked = initial ? descendants(all, initial.id) : new Set<number>();
  const managerOptions = all.filter((e) => e.id !== initial?.id && !blocked.has(e.id) && e.status !== "inativo" && canManage(e.positionTitle));
  const reportsCount = initial ? all.filter((e) => e.managerId === initial.id).length : 0;
  const selectedPos = positions.data?.find((p) => p.id === f.positionId);
  const allowedBonds = (selectedPos?.bondTypes ?? []) as string[];
  const canBeTop = !top;

  const pickPhoto = async (file: File) => {
    if (!file.type.startsWith("image/")) return setError("Escolha um ficheiro de imagem.");
    setError(null);
    setUploading(true);
    try {
      const blob = await squareJpeg(file);
      const { url, key } = await client.hr.employees.photoUpload({ contentType: "image/jpeg" });
      const r = await fetch(url, { method: "PUT", body: blob, headers: { "Content-Type": "image/jpeg" } });
      if (!r.ok) throw new Error("Falha ao enviar a foto");
      set("photoKey", key);
      setPreview(URL.createObjectURL(blob));
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setUploading(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (uploading) return setError("Aguarde o envio da foto.");
    if (f.status === "inativo" && !f.terminationDate) return setError("Indique a data de inativação.");
    if (f.status === "inativo" && f.terminationDate < f.hireDate) return setError("A data de inativação não pode ser anterior à data de admissão.");
    if (selectedPos && !canManage(selectedPos.title) && reportsCount > 0) {
      setError(`O cargo ${selectedPos.title} não pode ser responsável de outros funcionários. Este funcionário é responsável de ${reportsCount}: atribua-lhes outro responsável primeiro.`);
      return;
    }
    if (f.managerId == null && !canBeTop) {
      setError(`Indique o responsável. ${top?.name} já está no topo da hierarquia.`);
      return;
    }
    if (f.bond && !allowedBonds.includes(f.bond)) return setError("O vínculo escolhido não é aceite pelo cargo.");
    const payload = {
      name: f.name, email: f.email, phone: f.phone || null, nif: f.nif || null, photoKey: f.photoKey ?? null, departmentId: f.departmentId, positionId: f.positionId, managerId: f.managerId,
      hireDate: f.hireDate, terminationDate: f.status === "inativo" ? f.terminationDate : null, salary: Number(f.salary), status: f.status, isSeller: f.isSeller, commissionRate: Number(f.commissionRate), vacationDays: Number(f.vacationDays),
      ett: f.ett || null, bond: f.bond || null,
    };
    try {
      if (initial) await save.update.mutateAsync({ ...payload, id: initial.id });
      else await save.create.mutateAsync(payload);
      onClose();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  return (
    <form onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <PhotoPicker name={f.name} preview={preview} uploading={uploading} onPick={pickPhoto} onClear={() => { set("photoKey", null); setPreview(null); }} />
        <Field label="Nome completo" className="sm:col-span-2">
          <input aria-label="Nome completo" className="input" value={f.name} onChange={(e) => set("name", e.target.value)} required />
        </Field>
        <Field label="Email">
          <input aria-label="Email" className="input" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} required />
        </Field>
        <Field label="Telefone">
          <input aria-label="Telefone" className="input" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label="Departamento">
          <select className="input" value={f.departmentId ?? ""} onChange={(e) => { set("departmentId", e.target.value ? Number(e.target.value) : null); set("positionId", null); }}>
            <option value="">—</option>
            {depts.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Cargo">
          <select className="input" value={f.positionId ?? ""} onChange={(e) => { const id = e.target.value ? Number(e.target.value) : null; set("positionId", id); const b = (positions.data?.find((x) => x.id === id)?.bondTypes ?? []) as string[]; if (f.bond && !b.includes(f.bond)) set("bond", ""); }}>
            <option value="">—</option>
            {posOptions.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </Field>
        <Field label="ETT">
          <select aria-label="ETT" className="input" value={f.ett} onChange={(e) => set("ett", e.target.value)}>
            <option value="">—</option>
            {ETTS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </Field>
        <Field label="Tipo de vínculo">
          <select aria-label="Tipo de vínculo" className="input" value={f.bond} onChange={(e) => set("bond", e.target.value)} disabled={!allowedBonds.length}>
            <option value="">—</option>
            {allowedBonds.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          {!allowedBonds.length && <p className="mt-1.5 text-[11.5px] text-ink-3">O cargo escolhido não tem vínculos configurados (configure em Departamentos e cargos).</p>}
        </Field>
        <Field label="Responsável direto" className="sm:col-span-2">
          <select
            aria-label="Responsável direto"
            className="input"
            value={f.managerId ?? ""}
            required={!canBeTop}
            onChange={(e) => set("managerId", e.target.value ? Number(e.target.value) : null)}
          >
            {canBeTop ? <option value="">Topo da hierarquia (sem responsável)</option> : <option value="" disabled>Selecione o responsável…</option>}
            {managerOptions.map((m) => <option key={m.id} value={m.id}>{m.name}{m.positionTitle ? ` — ${m.positionTitle}` : ""}</option>)}
          </select>
          <p className="mt-1.5 text-[11.5px] text-ink-3">
            {canBeTop
              ? "Ainda não há ninguém no topo da hierarquia. Deixe vazio se este funcionário for o topo."
              : `Obrigatório. Só ${top?.name} está no topo sem responsável.`}
            {" "}Funcionários com cargo {NON_MANAGER_POSITIONS.join(", ")} não podem ser responsáveis.
          </p>
        </Field>
        <Field label="Data de admissão">
          <input aria-label="Data de admissão" className="input" type="date" value={f.hireDate} onChange={(e) => set("hireDate", e.target.value)} required />
        </Field>
        <Field label="Salário base mensal (€)">
          <input aria-label="Salário base mensal (€)" className="input num" type="number" min={0} step="0.01" value={f.salary} onChange={(e) => set("salary", Number(e.target.value))} />
        </Field>
        <Field label="NIF">
          <input aria-label="NIF" className="input num" value={f.nif} onChange={(e) => set("nif", e.target.value)} />
        </Field>
        <Field label="Estado">
          <select
            aria-label="Estado"
            className="input"
            value={f.status}
            onChange={(e) => {
              const v = e.target.value as typeof f.status;
              set("status", v);
              if (v === "inativo" && !f.terminationDate) set("terminationDate", today());
            }}
          >
            {Object.entries(EMP_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </Field>
        {f.status === "inativo" && (
          <Field label="Data de inativação">
            <input
              aria-label="Data de inativação"
              className="input"
              type="date"
              min={f.hireDate}
              value={f.terminationDate}
              onChange={(e) => set("terminationDate", e.target.value)}
              required
            />
            <p className="mt-1.5 text-[11.5px] text-ink-3">Último dia ativo. Conta como ativo nos relatórios até este mês.</p>
          </Field>
        )}
        <Field label="Dias de férias / ano">
          <input aria-label="Dias de férias / ano" className="input num" type="number" min={0} value={f.vacationDays} onChange={(e) => set("vacationDays", Number(e.target.value))} />
        </Field>
        <div className="rounded-[12px] border border-line bg-bg p-4 sm:col-span-2">
          <label className="flex cursor-pointer items-center gap-3 text-[13px]">
            <input type="checkbox" aria-label="É vendedor" className="h-4 w-4 accent-[#c6f432]" checked={f.isSeller} onChange={(e) => set("isSeller", e.target.checked)} />
            <span>É vendedor (aparece em vendas, metas e comissões)</span>
          </label>
        </div>
      </div>
      <SubmitRow
        pending={save.isPending || uploading}
        onCancel={onClose}
        error={error}
        extra={initial && <ConfirmDelete pending={remove.isPending} onConfirm={async () => { await remove.mutateAsync({ id: initial.id }); onClose(); }} />}
      />
    </form>
  );
}

export default function EmployeesPage() {
  const emps = useEmployees();
  const depts = useDepartments();
  const [q, setQ] = useState("");
  const [dept, setDept] = useState<string>("");
  const [team, setTeam] = useState<number | null>(null);
  const teamIds = useTeamIds(team);
  const [status, setStatus] = useState<"todos" | "ativo" | "pendente" | "suspenso" | "blacklist" | "inativo">("ativo");
  const [editing, setEditing] = useState<Emp | null | "new">(null);
  const [view, setView] = useState<"lista" | "organigrama">("lista");
  const missing = (emps.data ?? []).filter((e) => e.managerId == null);
  const noTermination = (emps.data ?? []).filter((e) => e.status === "inativo" && !e.terminationDate);

  const list = useMemo(() => {
    const s = q.toLowerCase();
    return (emps.data ?? []).filter(
      (e) =>
        (status === "todos" || e.status === status) &&
        (!dept || String(e.departmentId) === dept) &&
        (teamIds == null || teamIds.includes(e.id)) &&
        (!s || e.name.toLowerCase().includes(s) || e.email.toLowerCase().includes(s) || (e.positionTitle ?? "").toLowerCase().includes(s)),
    );
  }, [emps.data, q, dept, status, teamIds]);
  const count = (st: string) => (emps.data ?? []).filter((e) => st === "todos" || e.status === st).length;

  return (
    <div>
      <PageHeader eyebrow="Recursos Humanos" title="Funcionários">
        <button className="btn btn-primary" onClick={() => setEditing("new")}>
          <Plus size={15} /> Novo funcionário
        </button>
      </PageHeader>

      {noTermination.length > 0 && (
        <div className="rise mb-4 flex items-start gap-3 rounded-[12px] border border-amber/30 bg-amber/5 px-4 py-3 text-[13px]">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber" />
          <div>
            <div className="font-medium text-amber">{noTermination.length} funcionário(s) inativo(s) sem data de inativação</div>
            <div className="mt-0.5 text-ink-2">
              Sem a data, não contam como ativos em nenhum mês dos relatórios. Indique a data em:{" "}
              {noTermination.map((m, i) => (
                <span key={m.id}>{i > 0 && ", "}<button type="button" className="underline hover:text-ink" onClick={() => setEditing(m)}>{m.name}</button></span>
              ))}.
            </div>
          </div>
        </div>
      )}

      {missing.length > 1 && (
        <div className="rise mb-4 flex items-start gap-3 rounded-[12px] border border-amber/30 bg-amber/5 px-4 py-3 text-[13px]">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber" />
          <div>
            <div className="font-medium text-amber">{missing.length} funcionários sem responsável</div>
            <div className="mt-0.5 text-ink-2">Só pode existir um no topo da hierarquia. Atribua um responsável a: {missing.map((m) => m.name).join(", ")}.</div>
          </div>
        </div>
      )}

      <div className="rise mb-4 flex flex-wrap items-center gap-3" style={{ animationDelay: "40ms" }}>
        <div className="flex rounded-[10px] border border-line bg-surface p-0.5">
          <button type="button" onClick={() => setView("lista")} className={`flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[12.5px] transition ${view === "lista" ? "bg-volt text-bg" : "text-ink-2 hover:text-ink"}`}><List size={14} /> Lista</button>
          <button type="button" onClick={() => setView("organigrama")} className={`flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[12.5px] transition ${view === "organigrama" ? "bg-volt text-bg" : "text-ink-2 hover:text-ink"}`}><Network size={14} /> Organigrama</button>
        </div>
      </div>

      {view === "organigrama" ? (
        <OrgChart employees={emps.data ?? []} loading={emps.isLoading} onSelect={(e) => setEditing(e)} />
      ) : (
      <>
      <div className="rise mb-4 flex flex-wrap items-center gap-3" style={{ animationDelay: "60ms" }}>
        <Tabs
          value={status}
          onChange={setStatus}
          items={[
            { key: "ativo", label: "Ativos", count: count("ativo") },
            { key: "pendente", label: "Pendentes", count: count("pendente") },
            { key: "suspenso", label: "Suspensos", count: count("suspenso") },
            { key: "blacklist", label: "Blacklist", count: count("blacklist") },
            { key: "inativo", label: "Inativos", count: count("inativo") },
            { key: "todos", label: "Todos", count: count("todos") },
          ]}
        />
        <div className="ml-auto flex gap-2">
          <TeamFilter value={team} onChange={setTeam} />
          <select className="input w-52" value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">Todos os departamentos</option>
            {depts.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <SearchBox value={q} onChange={setQ} placeholder="Nome, email ou cargo…" />
        </div>
      </div>

      <div className="card rise overflow-hidden" style={{ animationDelay: "100ms" }}>
        {emps.isLoading ? (
          <TableSkeleton cols={7} />
        ) : emps.isError ? (
          <Empty title="Não foi possível carregar" text={errMsg(emps.error)} />
        ) : !list.length ? (
          <Empty title="Nenhum funcionário encontrado" text="Ajuste os filtros ou adicione um novo funcionário." action={<button className="btn btn-primary" onClick={() => setEditing("new")}><Plus size={15} /> Adicionar</button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Funcionário</th>
                  <th>Departamento / cargo</th>
                  <th>Responsável</th>
                  <th>Admissão</th>
                  <th className="text-right">Salário</th>
                  <th>Férias {new Date().getFullYear()}</th>
                  <th>Estado</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {list.map((e) => {
                  const left = e.vacationDays - Number(e.vacationUsed);
                  return (
                    <tr key={e.id} className="cursor-pointer" onClick={() => setEditing(e)}>
                      <td>
                        <div className="flex items-center gap-3">
                          <Avatar name={e.name} color={e.departmentColor ?? undefined} src={e.photoUrl} />
                          <div>
                            <div className="flex items-center gap-2 font-medium">
                              {e.name}
                              {e.isSeller && <span className="rounded bg-volt/10 px-1.5 py-px font-mono text-[9.5px] uppercase tracking-wider text-volt">Vendas</span>}
                            </div>
                            <div className="mt-0.5 flex items-center gap-3 text-[11.5px] text-ink-3">
                              <span className="flex items-center gap-1"><Mail size={11} />{e.email}</span>
                              {e.phone && <span className="hidden items-center gap-1 xl:flex"><Phone size={11} />{e.phone}</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div>{e.positionTitle ?? "—"}</div>
                        <div className="text-[11.5px]" style={{ color: e.departmentColor ?? "var(--ink-3)" }}>{e.departmentName ?? "Sem departamento"}</div>
                      </td>
                      <td>
                        {e.managerName ? (
                          <div className="flex items-center gap-2">
                            <Avatar name={e.managerName} size={22} />
                            <span className="text-[12.5px]">{e.managerName}</span>
                          </div>
                        ) : missing.length > 1 ? (
                          <span className="text-[12px] text-amber">Por atribuir</span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-[12px] text-volt"><Crown size={12} /> Topo</span>
                        )}
                        {Number(e.reportsCount) > 0 && <div className="mt-0.5 text-[11px] text-ink-3">{e.reportsCount} subordinado{Number(e.reportsCount) > 1 ? "s" : ""}</div>}
                      </td>
                      <td>
                        <div className="num text-[12.5px]">{fmtDate(e.hireDate)}</div>
                        <div className="text-[11.5px] text-ink-3">{tenure(e.hireDate)}</div>
                      </td>
                      <td className="num text-right">{fmtEur(e.salary)}</td>
                      <td className="w-40">
                        <div className="num mb-1.5 text-[12px]"><span className={left < 5 ? "text-amber" : ""}>{left}</span><span className="text-ink-3"> / {e.vacationDays} dias</span></div>
                        <Progress value={Number(e.vacationUsed) / (e.vacationDays || 1)} color="var(--sky)" />
                      </td>
                      <td>
                        <Pill {...EMP_STATUS[e.status]} />
                        {e.status === "inativo" && (
                          <div className={`mt-1 text-[11px] ${e.terminationDate ? "text-ink-3" : "text-amber"}`}>
                            {e.terminationDate ? `desde ${fmtDate(e.terminationDate)}` : "sem data de inativação"}
                          </div>
                        )}
                      </td>
                      <td className="text-right">
                        <span className="btn-icon"><Pencil size={14} /></span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Novo funcionário" : "Editar funcionário"} wide>
        {editing !== null && <EmployeeForm initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}
