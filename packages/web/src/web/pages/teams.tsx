import { useMemo, useState } from "react";
import { Plus, Pencil, Crown, Users, ArrowRightLeft } from "lucide-react";
import { MoveMemberForm, TeamHistory, TeamLeadershipHistory, todayLisbon } from "../components/team-history";
import { useEmployees, useRemoveTeam, useSaveTeam, useTeams } from "../queries/hr";
import { useMe } from "../queries/me";
import { PageHeader, Modal, Field, SubmitRow, Empty, ConfirmDelete, Avatar, SearchBox } from "../components/ui/kit";
import { errMsg } from "../lib/format";
import { canManage } from "../../api/shared/hierarchy";

type Team = NonNullable<ReturnType<typeof useTeams>["data"]>[number];
const COLORS = ["#c6f432", "#f5a524", "#38bdf8", "#a78bfa", "#f472b6", "#34d399", "#fb7185", "#facc15"];

function TeamForm({ initial, teams, onClose }: { initial: Team | null; teams: Team[]; onClose: () => void }) {
  const emps = useEmployees();
  const save = useSaveTeam();
  const remove = useRemoveTeam();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [color, setColor] = useState(initial?.color ?? COLORS[0]);
  const [leaderId, setLeader] = useState<number | null>(initial?.leaderId ?? null);
  const [coordinatorId, setCoordinator] = useState<number | null>(initial?.coordinatorId ?? null);
  const [members, setMembers] = useState<Set<number>>(() => new Set(initial?.members.map((m) => m.id)));
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [effectiveDate, setEffectiveDate] = useState(todayLisbon());
  const initialIds = useMemo(() => new Set(initial?.members.map((m) => m.id)), [initial]);
  const changed = [...members].some((id) => !initialIds.has(id)) || [...initialIds].some((id) => !members.has(id));

  /** Equipa atual de cada funcionário (para avisar quando muda de equipa). */
  const teamOf = useMemo(() => {
    const m = new Map<number, string>();
    for (const t of teams) if (t.id !== initial?.id) for (const e of t.members) m.set(e.id, t.name);
    return m;
  }, [teams, initial?.id]);

  const all = emps.data ?? [];
  const leaders = all.filter((e) => (e.status !== "inativo" && canManage(e.positionTitle)) || e.id === leaderId);
  const coordinators = all.filter((e) => (e.status !== "inativo" && canManage(e.positionTitle)) || e.id === coordinatorId);
  const candidates = all
    .filter((e) => e.id !== leaderId && (e.status !== "inativo" || members.has(e.id)))
    .filter((e) => !q || e.name.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: number) =>
    setMembers((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!leaderId) return setError("Escolha o chefe de equipa.");
        try {
          const p = { name, description: description || null, color, leaderId, coordinatorId, memberIds: [...members].filter((id) => id !== leaderId), effectiveDate };
          if (initial) await save.update.mutateAsync({ ...p, id: initial.id });
          else await save.create.mutateAsync(p);
          onClose();
        } catch (err) {
          setError(errMsg(err));
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome da equipa"><input aria-label="Nome da equipa" className="input" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        <Field label="Chefe de equipa">
          <select aria-label="Chefe de equipa" className="input" value={leaderId ?? ""} onChange={(e) => setLeader(e.target.value ? Number(e.target.value) : null)} required>
            <option value="">— Escolher —</option>
            {leaders.map((e) => <option key={e.id} value={e.id}>{e.name}{e.positionTitle ? ` · ${e.positionTitle}` : ""}</option>)}
          </select>
        </Field>
        <Field label="Coordenador responsável (opcional)" className="sm:col-span-2">
          <select aria-label="Coordenador responsável" className="input" value={coordinatorId ?? ""} onChange={(e) => setCoordinator(e.target.value ? Number(e.target.value) : null)}>
            <option value="">— Sem coordenador —</option>
            {coordinators.map((e) => <option key={e.id} value={e.id}>{e.name}{e.positionTitle ? ` · ${e.positionTitle}` : ""}</option>)}
          </select>
        </Field>
        <Field label="Descrição" className="sm:col-span-2"><textarea aria-label="Descrição" className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Cor" className="sm:col-span-2">
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button type="button" aria-label={`Cor ${c}`} key={c} onClick={() => setColor(c)} className={`h-8 w-8 rounded-full transition ${color === c ? "ring-2 ring-offset-2 ring-offset-surface" : "opacity-70 hover:opacity-100"}`} style={{ background: c, ["--tw-ring-color" as string]: c }} />
            ))}
          </div>
        </Field>
      </div>

      <div className="mt-5 mb-2 flex items-center justify-between gap-3">
        <div className="label-mono">Membros · {[...members].filter((id) => id !== leaderId).length} selecionados</div>
        <div className="w-56 [&_input]:w-full"><SearchBox value={q} onChange={setQ} placeholder="Procurar funcionário…" /></div>
      </div>
      <div className="max-h-72 overflow-y-auto rounded-[10px] border border-line">
        {emps.isLoading ? <div className="p-4 text-[13px] text-ink-3">A carregar…</div> : !candidates.length ? (
          <div className="p-4 text-[13px] text-ink-3">Sem funcionários.</div>
        ) : candidates.map((e) => {
          const other = teamOf.get(e.id);
          const on = members.has(e.id);
          return (
            <label key={e.id} className={`flex cursor-pointer items-center gap-3 border-b border-line px-3 py-2 last:border-b-0 hover:bg-surface-2 ${on ? "bg-surface-2/60" : ""}`}>
              <input type="checkbox" aria-label={`Membro ${e.name}`} checked={on} onChange={() => toggle(e.id)} className="accent-[var(--volt)]" />
              <Avatar name={e.name} size={26} src={e.photoUrl} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{e.name}{e.status === "inativo" && <span className="ml-2 text-[11px] text-ink-3">(inativo)</span>}</div>
                <div className="truncate text-[11.5px] text-ink-3">{e.positionTitle ?? "Sem cargo"}</div>
              </div>
              {other && <span className="text-[11px] text-amber">{on ? `sai de ${other}` : `em ${other}`}</span>}
            </label>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Field label="As entradas e saídas contam a partir de">
          <input type="date" aria-label="Data das entradas e saídas" className="input h-10 w-44" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} required />
        </Field>
        <p className="flex-1 pb-2 text-[11.5px] text-ink-3">
          Cada funcionário só pertence a uma equipa de cada vez: quem entra aqui sai da equipa anterior no dia antes desta data; quem é retirado fica com a saída nesse dia antes.
          {changed && <strong className="ml-1 text-amber">Há alterações aos membros.</strong>}
        </p>
      </div>

      {initial && (
        <div className="mt-5">
          <div className="label-mono mb-2">Histórico de chefia</div>
          <TeamLeadershipHistory team={teams.find((t) => t.id === initial.id) ?? initial} />
        </div>
      )}

      {initial && (
        <div className="mt-5">
          <div className="label-mono mb-2">Histórico de membros</div>
          <TeamHistory team={teams.find((t) => t.id === initial.id) ?? initial} />
        </div>
      )}

      <SubmitRow pending={save.isPending} onCancel={onClose} error={error} extra={initial && <ConfirmDelete pending={remove.isPending} onConfirm={async () => { await remove.mutateAsync({ id: initial.id }); onClose(); }} />} />
    </form>
  );
}

export default function TeamsPage() {
  const teams = useTeams();
  const me = useMe();
  const isAdmin = me.data?.role === "admin" || me.data?.role === "rh";
  const [edit, setEdit] = useState<Team | null | "new">(null);
  const [moving, setMoving] = useState(false);
  const list = teams.data ?? [];

  return (
    <div>
      <PageHeader eyebrow="Recursos Humanos" title="Equipas">
        <button className="btn btn-ghost" onClick={() => setMoving(true)}><ArrowRightLeft size={15} /> Mudar comercial de equipa</button>
        {isAdmin && <button className="btn btn-primary" onClick={() => setEdit("new")}><Plus size={15} /> Nova equipa</button>}
      </PageHeader>

      {teams.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-52 rounded-[14px]" />)}</div>
      ) : teams.isError ? (
        <div className="card"><Empty title="Não foi possível carregar" text={errMsg(teams.error)} /></div>
      ) : !list.length ? (
        <div className="card"><Empty title="Sem equipas" text={isAdmin ? "Crie a primeira equipa interna e escolha o chefe de equipa." : "Não chefia nenhuma equipa."} action={isAdmin && <button className="btn btn-primary" onClick={() => setEdit("new")}><Plus size={15} /> Nova equipa</button>} /></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((t, i) => {
            const active = t.members.filter((m) => m.status !== "inativo");
            return (
              <button key={t.id} onClick={() => isAdmin && setEdit(t)} className={`card rise group relative overflow-hidden p-5 text-left transition ${isAdmin ? "hover:border-ink-3" : "cursor-default"}`} style={{ animationDelay: `${i * 40}ms` }}>
                <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-20 blur-2xl transition group-hover:opacity-40" style={{ background: t.color }} />
                <div className="flex items-start justify-between">
                  <span className="h-2.5 w-8 rounded-full" style={{ background: t.color }} />
                  {isAdmin && <Pencil size={13} className="text-ink-3 opacity-0 transition group-hover:opacity-100" />}
                </div>
                <div className="mt-4 font-display text-[17px] font-semibold">{t.name}</div>
                <div className="mt-1 line-clamp-1 text-[12.5px] text-ink-3">{t.description || "Sem descrição"}</div>

                <div className="mt-4 flex items-center gap-3 rounded-[10px] bg-surface-2 px-3 py-2.5">
                  <Avatar name={t.leaderName ?? "?"} size={30} src={t.leaderPhotoUrl} color={t.color} />
                  <div className="min-w-0">
                    <div className="label-mono flex items-center gap-1"><Crown size={11} /> Chefe de equipa</div>
                    <div className="truncate text-[13px] font-medium">{t.leaderName ?? "Sem chefe"}{t.leaderStatus === "inativo" && <span className="ml-1 text-[11px] text-danger">(inativo)</span>}</div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <div className="flex -space-x-2">
                    {active.slice(0, 6).map((m) => <span key={m.id} className="rounded-full ring-2 ring-surface"><Avatar name={m.name} size={26} src={m.photoUrl} /></span>)}
                    {active.length > 6 && <span className="grid h-[26px] w-[26px] place-items-center rounded-full bg-surface-2 text-[10.5px] ring-2 ring-surface">+{active.length - 6}</span>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Users size={14} className="text-ink-3" />
                    <span className="num text-[20px] font-semibold leading-none">{active.length}</span>
                    <span className="text-[12px] text-ink-3">{active.length === 1 ? "membro" : "membros"}</span>
                  </div>
                </div>
                {!!active.length && <div className="mt-2 line-clamp-2 text-[11.5px] text-ink-3">{active.map((m) => m.name.split(" ")[0]).join(", ")}</div>}
              </button>
            );
          })}
        </div>
      )}

      <Modal wide open={edit !== null} onClose={() => setEdit(null)} title={edit === "new" ? "Nova equipa" : "Editar equipa"}>
        {edit !== null && <TeamForm initial={edit === "new" ? null : edit} teams={list} onClose={() => setEdit(null)} />}
      </Modal>
      <Modal open={moving} onClose={() => setMoving(false)} title="Mudar comercial de equipa">
        {moving && <MoveMemberForm onClose={() => setMoving(false)} />}
      </Modal>
    </div>
  );
}
