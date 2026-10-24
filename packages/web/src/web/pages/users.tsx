import { useState } from "react";
import { Loader2, Check, Plus, CalendarCog, Trash2, KeyRound, Pencil, Camera } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useUpdateUser, useEditPersonal, useUsers, useMe } from "../queries/me";
import { useEmployeeOptions, useTeams } from "../queries/hr";
import { orpc, client } from "../lib/api";
import { PageHeader, Avatar, TableSkeleton, Empty, Modal, Field } from "../components/ui/kit";
import { ROLE_LABEL } from "../lib/labels";
import { fmtDate } from "../lib/format";
import { MODULES, defaultsForRole } from "../../api/permissions";
import type { Permissions } from "../../api/middleware/auth";

type U = NonNullable<ReturnType<typeof useUsers>["data"]>[number];
type Role = "admin" | "diretor" | "rh" | "backoffice" | "coordenador" | "chefe" | "vendedor";

const ROLE_CARDS: [string, string][] = [
  ["Administrador", "Acesso total: RH, vendas, metas, relatórios, agenda e gestão de utilizadores."],
  ["Diretor", "Acesso total, incluindo a agenda completa e as atribuições de calendários."],
  ["Recursos Humanos", "RH completo. Na agenda, vê só os calendários que lhe forem atribuídos."],
  ["Backoffice", "Na agenda, vê só os calendários que lhe forem atribuídos; cria utilizadores (exceto Administrador e Diretor)."],
  ["Coordenador", "Vê na agenda as equipas que coordena e os seus membros."],
  ["Chefe de Equipa", "Vê só ele e a sua equipa. Na agenda pode editar os eventos da sua equipa."],
  ["Gestor Comercial", "Vê o seu painel, clientes e vendas (só leitura) e o seu calendário pessoal."],
];

function UserRow({ u, isSelf, canEdit, canEditData, canAssign }: { u: U; isSelf: boolean; canEdit: boolean; canEditData: boolean; canAssign: boolean }) {
  const emps = useEmployeeOptions();
  const update = useUpdateUser();
  const qc = useQueryClient();
  const remove = useMutation(orpc.users.remove.mutationOptions({ onSuccess: () => qc.invalidateQueries({ predicate: (q) => JSON.stringify(q.queryKey).includes("users") }) }));
  const [err, setErr] = useState<string | null>(null);
  const [role, setRole] = useState<Role>((u.role ?? "vendedor") as Role);
  const [emp, setEmp] = useState<number | null>(u.employeeId ?? null);
  const dirty = role !== (u.role ?? "vendedor") || emp !== (u.employeeId ?? null);
  const [saved, setSaved] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [permOpen, setPermOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const disabled = isSelf || !canEdit;
  const isAssignable = role === "backoffice" || role === "rh";
  return (
    <tr>
      <td>
        <div className="flex items-center gap-3">
          <Avatar name={u.name || u.email || "?"} src={u.image} />
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 text-[13px] font-medium">{u.name || "—"}{isSelf && <span className="text-[11px] font-normal text-ink-3">(você)</span>}</div>
            <div className="text-[12px] text-ink-2">{u.email || "—"}{u.phone ? ` · ${u.phone}` : ""}</div>
          </div>
        </div>
      </td>
      <td className="num text-[12.5px] text-ink-2">{fmtDate(u.createdAt)}</td>
      <td>
        <select className="input h-9 w-48" value={role} disabled={disabled} onChange={(e) => setRole(e.target.value as Role)}>
          {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </td>
      <td>
        <select className="input h-9 w-56" value={emp ?? ""} disabled={disabled} onChange={(e) => setEmp(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Sem ficha associada</option>
          {emps.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </td>
      <td className="w-44 text-right">
        <div className="flex items-center justify-end gap-2">
          {canEditData && (
            <button className="btn btn-ghost h-9 px-2.5" title="Editar dados pessoais" onClick={() => setEditOpen(true)}>
              <Pencil size={15} />
            </button>
          )}
          {canEdit && (
            <button className="btn btn-ghost h-9 px-2.5" title="Permissões por área" onClick={() => setPermOpen(true)}>
              <KeyRound size={15} />
            </button>
          )}
          {canAssign && isAssignable && (
            <button className="btn btn-ghost h-9 px-2.5" title="Calendários atribuídos" onClick={() => setAssignOpen(true)}>
              <CalendarCog size={15} />
            </button>
          )}
          {dirty && canEdit ? (
            <button className="btn btn-primary h-9" disabled={update.isPending} onClick={async () => { await update.mutateAsync({ userId: u.id, role, employeeId: emp }); setSaved(true); setTimeout(() => setSaved(false), 1500); }}>
              {update.isPending ? <Loader2 size={14} className="animate-spin" /> : "Guardar"}
            </button>
          ) : saved ? <span className="inline-flex items-center gap-1 text-[12px] text-volt"><Check size={14} /> Guardado</span> : null}
          {!isSelf && canEdit && (
            <button
              className="btn btn-ghost h-9 px-2.5 text-danger"
              title="Eliminar utilizador"
              disabled={remove.isPending}
              onClick={async () => {
                if (!confirm(`Eliminar ${u.name ?? u.email}? Perde o acesso de imediato e o seu calendário pessoal e respetivos eventos são apagados.`)) return;
                try { await remove.mutateAsync({ userId: u.id }); } catch (e) { setErr(e instanceof Error ? e.message : "Não foi possível eliminar."); }
              }}
            >
              {remove.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={15} />}
            </button>
          )}
        </div>
        {err && <div className="mt-1 text-right text-[12px] text-danger">{err}</div>}
        {assignOpen && <AssignModal userId={u.id} userName={u.name ?? u.email ?? ""} onClose={() => setAssignOpen(false)} />}
        {permOpen && <PermissionModal u={u} onClose={() => setPermOpen(false)} />}
        {editOpen && <EditPersonalModal u={u} onClose={() => setEditOpen(false)} />}
      </td>
    </tr>
  );
}

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

/** Edição dos dados pessoais (foto, nome, email, telefone, NIF) e reset de palavra-passe. */
function EditPersonalModal({ u, onClose }: { u: U; onClose: () => void }) {
  const edit = useEditPersonal();
  const [name, setName] = useState(u.name ?? "");
  const [email, setEmail] = useState(u.email ?? "");
  const [phone, setPhone] = useState(u.phone ?? "");
  const [nif, setNif] = useState(u.employeeNif ?? "");
  const [image, setImage] = useState<string | null>(u.image ?? null);
  const [password, setPassword] = useState("");
  const [preview, setPreview] = useState<string | null>(u.image ?? null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pickPhoto = async (file: File) => {
    if (!file.type.startsWith("image/")) return setErr("Escolha um ficheiro de imagem.");
    setErr(null);
    setUploading(true);
    try {
      const blob = await squareJpeg(file);
      const base64 = await new Promise<string>((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result as string); r.readAsDataURL(blob); });
      const { url } = await client.users.avatarUpload({ content: base64 });
      setImage(url);
      setPreview(URL.createObjectURL(blob));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Não foi possível enviar a foto.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Dados pessoais · ${u.name ?? u.email}`}>
      <form className="flex flex-col gap-4" onSubmit={async (e) => {
        e.preventDefault();
        setErr(null);
        try {
          await edit.mutateAsync({ userId: u.id, name, email, phone: phone || null, image: image ?? null, password: password || undefined, employeeNif: nif || null });
          onClose();
        } catch (x) {
          setErr(x instanceof Error ? x.message : "Não foi possível guardar.");
        }
      }}>
        <div className="flex items-center gap-4">
          <label className="group relative cursor-pointer" title="Escolher foto">
            <Avatar name={name || email || "?"} size={72} src={preview} />
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-[var(--overlay-bg)] opacity-0 transition group-hover:opacity-100">
              <Camera size={18} className="text-white" />
            </span>
            {uploading && <span className="absolute inset-0 flex items-center justify-center rounded-full bg-[var(--overlay-bg)]"><Loader2 size={18} className="animate-spin text-white" /></span>}
            <input type="file" accept="image/*" aria-label="Foto do utilizador" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) pickPhoto(f); e.target.value = ""; }} />
          </label>
          <div className="text-[12.5px] text-ink-3">
            Foto de perfil.
            {preview && !uploading && (
              <button type="button" onClick={() => { setImage(null); setPreview(null); }} className="mt-0.5 flex items-center gap-1 text-[12px] text-rose hover:underline"><Trash2 size={12} /> Remover foto</button>
            )}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome"><input aria-label="Nome" className="input" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
          <Field label="Email"><input aria-label="Email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <Field label="Telefone"><input aria-label="Telefone" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <Field label={`NIF${u.employeeId ? "" : " (requer ficha de funcionário)"}`}>
            <input aria-label="NIF" className="input" value={nif} onChange={(e) => setNif(e.target.value)} disabled={!u.employeeId} />
          </Field>
        </div>
        <Field label="Nova palavra-passe (opcional)">
          <input aria-label="Nova palavra-passe" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Deixe em branco para manter a atual" minLength={8} />
          <span className="mt-1 block text-[11.5px] text-ink-3">Só disponível para contas com palavra-passe (não sociais). Comunique-a à pessoa.</span>
        </Field>
        {err && <div className="text-[12.5px] text-danger">{err}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={edit.isPending || uploading}>{edit.isPending ? <Loader2 size={15} className="animate-spin" /> : "Guardar"}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Atribuição de calendários (equipas e/ou funcionários) a um utilizador Backoffice/RH. Só admin/diretor. */
function AssignModal({ userId, userName, onClose }: { userId: string; userName: string; onClose: () => void }) {
  const qc = useQueryClient();
  const teams = useTeams();
  const emps = useEmployeeOptions();
  const current = useQuery(orpc.agenda.assignments.list.queryOptions({ input: { userId } }));
  const [teamIds, setTeamIds] = useState<Set<number> | null>(null);
  const [empIds, setEmpIds] = useState<Set<number> | null>(null);
  const save = useMutation(orpc.agenda.assignments.set.mutationOptions({ onSuccess: () => { qc.invalidateQueries(); onClose(); } }));
  if (current.data && teamIds === null) {
    setTeamIds(new Set(current.data.filter((a) => a.teamId != null).map((a) => a.teamId!)));
    setEmpIds(new Set(current.data.filter((a) => a.employeeId != null).map((a) => a.employeeId!)));
  }
  const toggle = (set: Set<number>, id: number) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };
  return (
    <Modal open onClose={onClose} title={`Calendários atribuídos · ${userName}`}>
      {teamIds === null || empIds === null ? <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-volt" /></div> : (
        <form className="flex flex-col gap-4" onSubmit={async (e) => { e.preventDefault(); await save.mutateAsync({ userId, teamIds: [...teamIds], employeeIds: [...empIds] }); }}>
          <Field label="Equipas (inclui o calendário da equipa e os dos membros)">
            <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-[10px] border border-line p-2">
              {(teams.data ?? []).map((t) => (
                <label key={t.id} className="flex items-center gap-2 text-[13px]">
                  <input aria-label={t.name} type="checkbox" checked={teamIds.has(t.id)} onChange={() => setTeamIds(toggle(teamIds, t.id))} /> {t.name}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Funcionários individuais">
            <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-[10px] border border-line p-2">
              {(emps.data ?? []).map((x) => (
                <label key={x.id} className="flex items-center gap-2 text-[13px]">
                  <input aria-label={x.name} type="checkbox" checked={empIds.has(x.id)} onChange={() => setEmpIds(toggle(empIds, x.id))} /> {x.name}
                </label>
              ))}
            </div>
          </Field>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={save.isPending}>{save.isPending ? <Loader2 size={15} className="animate-spin" /> : "Guardar"}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

const GROUP_KEYS = [...new Set(MODULES.map((m) => m.group))];

/** Grelha de permissões: cada área com interruptores independentes de ver/editar. */
function PermissionsEditor({ value, onChange }: { value: Permissions; onChange: (p: Permissions) => void }) {
  const set = (key: keyof Permissions, field: "view" | "edit", v: boolean) => {
    onChange({ ...value, [key]: { ...value[key], [field]: v } });
  };
  return (
    <div className="flex flex-col gap-4">
      {GROUP_KEYS.map((g) => (
        <div key={g}>
          <div className="label-mono mb-2">{g}</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {MODULES.filter((m) => m.group === g).map((m) => (
              <div key={m.key} className="flex items-center justify-between gap-3 rounded-[8px] border border-line px-3 py-2">
                <span className="text-[13px]">{m.label}</span>
                <div className="flex items-center gap-3">
                  <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-ink-2">
                    <input aria-label={`${m.label} — ver`} type="checkbox" checked={value[m.key]?.view ?? false} onChange={(e) => set(m.key, "view", e.target.checked)} /> Ver
                  </label>
                  <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-ink-2">
                    <input aria-label={`${m.label} — editar`} type="checkbox" checked={value[m.key]?.edit ?? false} onChange={(e) => set(m.key, "edit", e.target.checked)} /> Editar
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Edição das permissões por área de um utilizador existente. O perfil serve de ponto de partida. */
function PermissionModal({ u, onClose }: { u: U; onClose: () => void }) {
  const qc = useQueryClient();
  const update = useMutation(orpc.users.update.mutationOptions({ onSuccess: () => { qc.invalidateQueries(); onClose(); } }));
  const [role, setRole] = useState<Role>((u.role ?? "vendedor") as Role);
  const [perms, setPerms] = useState<Permissions>(() => ({ ...defaultsForRole((u.role ?? "vendedor") as Role), ...u.permissions }));
  const [err, setErr] = useState<string | null>(null);
  const changeRole = (r: Role) => { setRole(r); setPerms(defaultsForRole(r)); };
  return (
    <Modal open onClose={onClose} title={`Permissões · ${u.name ?? u.email}`}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          try {
            await update.mutateAsync({ userId: u.id, role, employeeId: u.employeeId ?? null, permissions: perms });
          } catch (x) {
            setErr(x instanceof Error ? x.message : "Não foi possível guardar.");
          }
        }}
      >
        <Field label="Perfil (ponto de partida)">
          <select className="input" value={role} onChange={(e) => changeRole(e.target.value as Role)}>
            {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <span className="mt-1 block text-[11.5px] text-ink-3">Alterar o perfil repõe as permissões padrão; ajuste depois cada área.</span>
        </Field>
        <div className="flex max-h-[46vh] flex-col overflow-y-auto rounded-[10px] border border-line p-3">
          <PermissionsEditor value={perms} onChange={setPerms} />
        </div>
        {err && <div className="text-[12.5px] text-danger">{err}</div>}
        <div className="flex items-center justify-between gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => setPerms(defaultsForRole(role))}>Restaurar padrão</button>
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={update.isPending}>{update.isPending ? <Loader2 size={15} className="animate-spin" /> : "Guardar"}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/** Criação de utilizadores com palavra-passe temporária. */
function CreateModal({ onClose, canCreatePrivileged }: { onClose: () => void; canCreatePrivileged: boolean }) {
  const qc = useQueryClient();
  const emps = useEmployeeOptions();
  const create = useMutation(orpc.users.create.mutationOptions({ onSuccess: () => { qc.invalidateQueries(); onClose(); } }));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(() => Math.random().toString(36).slice(-8) + "Aa1");
  const [role, setRole] = useState<Role>("vendedor");
  const [perms, setPerms] = useState<Permissions>(() => defaultsForRole("vendedor"));
  const [emp, setEmp] = useState<number | "">("");
  const [err, setErr] = useState<string | null>(null);
  const roles = Object.entries(ROLE_LABEL).filter(([k]) => canCreatePrivileged || (k !== "admin" && k !== "diretor"));
  const changeRole = (r: Role) => { setRole(r); setPerms(defaultsForRole(r)); };
  return (
    <Modal open onClose={onClose} title="Novo utilizador">
      <form className="flex flex-col gap-4" onSubmit={async (e) => {
        e.preventDefault();
        setErr(null);
        try {
          await create.mutateAsync({ name, email, password, role, employeeId: emp === "" ? null : emp, permissions: perms });
        } catch (x) {
          setErr(x instanceof Error ? x.message : "Não foi possível criar.");
        }
      }}>
        <Field label="Nome"><input aria-label="Nome" className="input" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        <Field label="Email"><input aria-label="Email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field label="Palavra-passe temporária">
          <input aria-label="Palavra-passe temporária" className="input" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
          <span className="mt-1 block text-[11.5px] text-ink-3">Comunique-a à pessoa; ela deve alterá-la depois de entrar.</span>
        </Field>
        <Field label="Perfil (ponto de partida)">
          <select className="input" value={role} onChange={(e) => changeRole(e.target.value as Role)}>
            {roles.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label={`Ficha de funcionário${role === "chefe" || role === "vendedor" ? " (obrigatória)" : ""}`}>
          <select className="input" value={emp} onChange={(e) => setEmp(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Sem ficha associada</option>
            {emps.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        <div className="flex max-h-[40vh] flex-col overflow-y-auto rounded-[10px] border border-line p-3">
          <PermissionsEditor value={perms} onChange={setPerms} />
        </div>
        {err && <div className="text-[12.5px] text-danger">{err}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>{create.isPending ? <Loader2 size={15} className="animate-spin" /> : "Criar utilizador"}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function UsersPage() {
  const users = useUsers();
  const me = useMe();
  const [createOpen, setCreateOpen] = useState(false);
  const canEdit = me.data?.role === "admin" || me.data?.role === "diretor";
  const canCreate = canEdit || me.data?.role === "backoffice";
  const canEditData = canEdit || me.data?.role === "backoffice";
  return (
    <div>
      <PageHeader eyebrow="Administração" title="Utilizadores e perfis">
        {canCreate && <button className="btn btn-primary" onClick={() => setCreateOpen(true)}><Plus size={15} /> Novo utilizador</button>}
      </PageHeader>
      <div className="rise mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {ROLE_CARDS.map(([t, s]) => (
          <div key={t} className="card p-4"><div className="font-display text-[14px] font-semibold">{t}</div><div className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{s}</div></div>
        ))}
      </div>
      <div className="card overflow-hidden">
        {users.isLoading ? <TableSkeleton cols={4} /> : !users.data?.length ? <Empty title="Sem utilizadores" /> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Utilizador</th><th>Registo</th><th>Perfil</th><th>Ficha de funcionário</th><th aria-label="Ações" /></tr></thead>
              <tbody>{users.data.map((u) => <UserRow key={u.id} u={u} isSelf={u.id === me.data?.id} canEdit={canEdit} canEditData={canEditData} canAssign={canEdit} />)}</tbody>
            </table>
          </div>
        )}
      </div>
      {createOpen && <CreateModal onClose={() => setCreateOpen(false)} canCreatePrivileged={me.data?.role === "admin" || me.data?.role === "diretor"} />}
    </div>
  );
}
