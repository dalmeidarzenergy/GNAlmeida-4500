import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useEditMembership, useEmployees, useMoveMember, useRemoveMembership, useTeams } from "../queries/hr";
import { Field, SubmitRow } from "./ui/kit";
import { errMsg, fmtDate } from "../lib/format";

type Team = NonNullable<ReturnType<typeof useTeams>["data"]>[number];
export const todayLisbon = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" });

/** Histórico de membros de uma equipa, com as datas de entrada e saída editáveis. */
export function TeamHistory({ team }: { team: Team }) {
  const edit = useEditMembership();
  const remove = useRemoveMembership();
  const [error, setError] = useState<string | null>(null);
  const today = todayLisbon();
  const save = async (id: number, startDate: string, endDate: string | null) => {
    setError(null);
    try {
      await edit.mutateAsync({ id, startDate, endDate });
    } catch (err) {
      setError(errMsg(err));
    }
  };
  if (!team.history.length) return <p className="text-[12.5px] text-ink-3">Ainda sem histórico de membros.</p>;
  return (
    <div>
      <div className="overflow-x-auto rounded-[10px] border border-line">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-line text-left text-ink-3">
              <th className="label-mono px-3 py-2 font-normal">Funcionário</th>
              <th className="label-mono px-3 py-2 font-normal">Entrada</th>
              <th className="label-mono px-3 py-2 font-normal">Saída</th>
              <th className="px-3 py-2"><span className="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            {team.history.map((m) => {
              const current = m.startDate <= today && (m.endDate == null || m.endDate >= today);
              return (
                <tr key={m.membershipId} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-2">
                    <span className="font-medium">{m.name}</span>
                    {current ? <span className="ml-2 text-[11px] text-volt">atual</span> : m.startDate > today ? <span className="ml-2 text-[11px] text-sky">a partir de {fmtDate(m.startDate)}</span> : null}
                  </td>
                  <td className="px-3 py-2">
                    <input type="date" aria-label={`Entrada de ${m.name}`} className="input h-8 w-36 text-[12.5px]" defaultValue={m.startDate} key={`s${m.startDate}`} onBlur={(e) => e.target.value && e.target.value !== m.startDate && save(m.membershipId, e.target.value, m.endDate)} />
                  </td>
                  <td className="px-3 py-2">
                    <input type="date" aria-label={`Saída de ${m.name}`} className="input h-8 w-36 text-[12.5px]" defaultValue={m.endDate ?? ""} key={`e${m.endDate}`} onBlur={(e) => (e.target.value || null) !== m.endDate && save(m.membershipId, m.startDate, e.target.value || null)} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" aria-label={`Apagar registo de ${m.name}`} className="text-ink-3 hover:text-danger" onClick={() => remove.mutate({ id: m.membershipId })}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11.5px] text-ink-3">Saída vazia = continua na equipa. As vendas contam para a equipa onde o comercial estava na data da venda. Altere a data e saia do campo para gravar.</p>
      {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
    </div>
  );
}

/** Histórico de chefia de uma equipa (quem liderou, de quando a quando). */
export function TeamLeadershipHistory({ team }: { team: Team }) {
  const today = todayLisbon();
  const leadership = (team as any).leadership as { leadershipId: number; startDate: string; endDate: string | null; leaderId: number; name: string }[] | undefined;
  if (!leadership?.length) return <p className="text-[12.5px] text-ink-3">Ainda sem histórico de chefia.</p>;
  return (
    <div>
      <div className="overflow-x-auto rounded-[10px] border border-line">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-line text-left text-ink-3">
              <th className="label-mono px-3 py-2 font-normal">Chefe</th>
              <th className="label-mono px-3 py-2 font-normal">Desde</th>
              <th className="label-mono px-3 py-2 font-normal">Até</th>
            </tr>
          </thead>
          <tbody>
            {leadership.map((l) => {
              const current = l.startDate <= today && (l.endDate == null || l.endDate >= today);
              return (
                <tr key={l.leadershipId} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-2">
                    <span className="font-medium">{l.name}</span>
                    {current ? <span className="ml-2 text-[11px] text-volt">atual</span> : null}
                  </td>
                  <td className="px-3 py-2">{fmtDate(l.startDate)}</td>
                  <td className="px-3 py-2">{l.endDate ? fmtDate(l.endDate) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11.5px] text-ink-3">Períodos em que cada chefe liderou a equipa. Uma equipa pode fechar e reabrir, ou mudar de chefe — cada período fica registado.</p>
    </div>
  );
}

/** Muda um comercial de equipa a partir de uma data; a saída da equipa anterior fica no dia antes. */
export function MoveMemberForm({ onClose }: { onClose: () => void }) {
  const teams = useTeams();
  const emps = useEmployees();
  const move = useMoveMember();
  const [employeeId, setEmployee] = useState<number | null>(null);
  const [teamId, setTeam] = useState<string>("");
  const [date, setDate] = useState(todayLisbon());
  const [error, setError] = useState<string | null>(null);
  const list = teams.data ?? [];
  const current = employeeId == null ? null : list.find((t) => t.members.some((m) => m.id === employeeId));
  const people = (emps.data ?? []).filter((e) => e.status !== "inativo");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if (!employeeId) return setError("Escolha o comercial.");
        if (!teamId) return setError("Escolha a nova equipa.");
        try {
          await move.mutateAsync({ employeeId, teamId: teamId === "none" ? null : Number(teamId), date });
          onClose();
        } catch (err) {
          setError(errMsg(err));
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Comercial" className="sm:col-span-2">
          <select aria-label="Comercial" className="input" value={employeeId ?? ""} onChange={(e) => setEmployee(e.target.value ? Number(e.target.value) : null)} required>
            <option value="">— Escolher —</option>
            {people.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
        <Field label="Nova equipa">
          <select aria-label="Nova equipa" className="input" value={teamId} onChange={(e) => setTeam(e.target.value)} required>
            <option value="">— Escolher —</option>
            {list.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            <option value="none">Sem equipa (sai da equipa)</option>
          </select>
        </Field>
        <Field label="Entra a partir de">
          <input type="date" aria-label="Data de entrada" className="input" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
      </div>
      <p className="mt-3 rounded-[10px] border border-line bg-bg px-3 py-2 text-[12px] text-ink-2">
        {current ? <>Atualmente em <strong className="text-ink">{current.name}</strong>. </> : employeeId ? "Atualmente sem equipa. " : ""}
        A saída da equipa anterior fica registada no dia antes da data de entrada. As vendas até essa data continuam a contar para a equipa anterior.
      </p>
      <SubmitRow pending={move.isPending} onCancel={onClose} error={error} label="Mudar de equipa" />
    </form>
  );
}
