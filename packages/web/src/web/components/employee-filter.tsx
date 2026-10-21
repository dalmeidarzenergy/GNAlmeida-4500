import { useEffect, useMemo } from "react";
import { useEmployeeOptions } from "../queries/hr";
import { thisMonth } from "../lib/format";
import { activeInMonth } from "../../api/shared/hierarchy";

/**
 * Funcionários que estiveram ativos no mês `YYYY-MM` (pela data de admissão e de inativação).
 * Sem mês ("todos os meses"), lista os ativos hoje e, à parte, os inativos.
 */
export function useEmployeesActiveIn(month: string) {
  const emps = useEmployeeOptions();
  return useMemo(() => {
    const list = emps.data ?? [];
    const m = month || thisMonth();
    const active = list.filter((e) => activeInMonth(e, m));
    const inactive = month ? [] : list.filter((e) => !activeInMonth(e, m));
    return { active, inactive, isLoading: emps.isLoading };
  }, [emps.data, emps.isLoading, month]);
}

/** Filtro por funcionário. Se o escolhido não estava ativo no mês selecionado, volta a "Todos". */
export function EmployeeFilter({ month, value, onChange, label = "Todos os funcionários", onlyIds = null }: { month: string; value: number | null; onChange: (v: number | null) => void; label?: string; onlyIds?: number[] | null }) {
  const all = useEmployeesActiveIn(month);
  const isLoading = all.isLoading;
  const keep = (e: { id: number }) => onlyIds == null || onlyIds.includes(e.id);
  const active = all.active.filter(keep);
  const inactive = all.inactive.filter(keep);
  const valid = value == null || active.some((e) => e.id === value) || inactive.some((e) => e.id === value);
  useEffect(() => {
    if (!isLoading && !valid) onChange(null);
  }, [isLoading, valid, onChange]);
  return (
    <select aria-label="Funcionário" className="input h-10 w-60" value={valid && value != null ? value : ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">{label}</option>
      {inactive.length ? (
        <>
          <optgroup label={month ? "Ativos no mês" : "Ativos"}>
            {active.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </optgroup>
          <optgroup label="Inativos">
            {inactive.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </optgroup>
        </>
      ) : (
        active.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)
      )}
    </select>
  );
}
