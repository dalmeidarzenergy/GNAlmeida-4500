import { thisMonth } from "../lib/format";

export const MONTH_NAMES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

/**
 * Filtro de mês + ano. Com `allowAll`, o valor "" significa "Todos os meses".
 */
export function MonthYearFilter({ value, onChange, allowAll }: { value: string; onChange: (v: string) => void; allowAll?: boolean }) {
  const all = allowAll && !value;
  const [y, m] = (value || thisMonth()).split("-");
  const cur = new Date().getFullYear();
  const years = Array.from({ length: Math.max(cur - 2024 + 2, 3) }, (_, i) => String(2024 + i));
  if (!years.includes(y)) years.push(y);
  return (
    <div className="flex items-center gap-2">
      <select aria-label="Mês" className="input h-10 w-40" value={all ? "" : m} onChange={(e) => onChange(e.target.value ? `${y}-${e.target.value}` : "")}>
        {allowAll && <option value="">Todos os meses</option>}
        {MONTH_NAMES.map((n, i) => <option key={n} value={String(i + 1).padStart(2, "0")}>{n}</option>)}
      </select>
      {!all && (
        <select aria-label="Ano" className="input h-10 w-24" value={y} onChange={(e) => onChange(`${e.target.value}-${m}`)}>
          {years.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      )}
      {value !== thisMonth() && (
        <button type="button" className="btn btn-ghost h-10" onClick={() => onChange(thisMonth())}>Mês atual</button>
      )}
    </div>
  );
}
