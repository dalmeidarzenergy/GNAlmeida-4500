import { SERVICE_LABELS } from "../../api/shared/client-forms";

/** Serviços contabilizados por defeito nos painéis, rankings e gráficos. */
export const DASHBOARD_SERVICES = ["LUZ", "DUAL"];

/** Filtro de tipo de venda (LUZ, GÁS, DUAL, SOLAR) com seleção múltipla; fica sempre pelo menos um ativo. */
export function ServiceFilter({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (s: string) => {
    const next = value.includes(s) ? value.filter((x) => x !== s) : [...value, s];
    if (next.length) onChange(SERVICE_LABELS.filter((x) => next.includes(x)));
  };
  return (
    <fieldset aria-label="Tipo de venda" className="m-0 flex min-w-0 h-10 items-center gap-1 rounded-[10px] border border-line bg-surface p-1">
      {SERVICE_LABELS.map((s) => {
        const on = value.includes(s);
        return (
          <button
            type="button"
            key={s}
            aria-pressed={on}
            onClick={() => toggle(s)}
            className={`h-full rounded-[7px] px-2.5 text-[11.5px] font-semibold tracking-wide transition ${on ? "bg-volt/15 text-volt" : "text-ink-3 hover:text-ink"}`}
          >
            {s}
          </button>
        );
      })}
    </fieldset>
  );
}
