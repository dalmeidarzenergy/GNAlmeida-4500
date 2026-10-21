import { useEffect, useMemo } from "react";
import { useTeams } from "../queries/hr";

const short = (n: string | null) => {
  const p = (n ?? "").trim().split(/\s+/);
  return p.length > 1 ? `${p[0]} ${p.at(-1)}` : (p[0] ?? "");
};

const monthEnd = (m: string) => `${m}-31`;

/**
 * Ids de quem pertence à equipa (o chefe e os membros), ou null sem equipa escolhida.
 * Com `month`, inclui quem esteve na equipa em algum dia desse mês; sem mês, só os membros atuais.
 */
export function useTeamIds(teamId: number | null, month?: string) {
  const teams = useTeams();
  return useMemo(() => {
    if (teamId == null) return null;
    const t = teams.data?.find((x) => x.id === teamId);
    if (!t) return null;
    const members = month ? t.history.filter((m) => m.startDate <= monthEnd(month) && (m.endDate == null || m.endDate >= `${month}-01`)) : t.members;
    return [...new Set([t.leaderId, ...members.map((m) => m.id)].filter((x): x is number => x != null))];
  }, [teams.data, teamId, month]);
}

/**
 * Verifica se uma venda (vendedor + data) pertence à equipa: é do chefe
 * ou o vendedor era membro da equipa na data da venda. Null sem equipa escolhida.
 */
export function useTeamMatcher(teamId: number | null) {
  const teams = useTeams();
  return useMemo(() => {
    if (teamId == null) return null;
    const t = teams.data?.find((x) => x.id === teamId);
    if (!t) return null;
    return (sellerId: number | null | undefined, date: string) =>
      sellerId != null && (sellerId === t.leaderId || t.history.some((m) => m.id === sellerId && m.startDate <= date && (m.endDate == null || m.endDate >= date)));
  }, [teams.data, teamId]);
}

/** Filtro por chefe de equipa (inclui as vendas do chefe e dos membros da equipa). */
export function TeamFilter({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const teams = useTeams();
  const list = teams.data ?? [];
  const valid = value == null || list.some((t) => t.id === value);
  useEffect(() => {
    if (!teams.isLoading && !valid) onChange(null);
  }, [teams.isLoading, valid, onChange]);
  return (
    <select aria-label="Chefe de equipa" className="input h-10 w-64" value={valid && value != null ? value : ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">Todos os chefes de equipa</option>
      {list.map((t) => (
        <option key={t.id} value={t.id}>
          {t.leaderName ? `${short(t.leaderName)} · ${t.name}` : `${t.name} (sem chefe)`}
        </option>
      ))}
    </select>
  );
}
