import { DISTRICTS } from "../../api/shared/client-forms";
import { ALL_CONCELHOS, CONCELHOS } from "../../api/shared/concelhos";

export type Place = { district: string; municipality: string };

/**
 * Filtro de Distrito + Concelho. O concelho só mostra os do distrito escolhido
 * (todos, em "Todos os distritos"); ao mudar de distrito, um concelho que não lhe pertença é limpo.
 */
export function PlaceFilter({ value, onChange }: { value: Place; onChange: (v: Place) => void }) {
  const list = value.district ? (CONCELHOS[value.district] ?? []) : ALL_CONCELHOS;
  const setDistrict = (district: string) => {
    const keep = !district || (CONCELHOS[district] ?? []).includes(value.municipality);
    onChange({ district, municipality: keep ? value.municipality : "" });
  };
  return (
    <div className="flex items-center gap-2">
      <select aria-label="Distrito" className="input h-10 w-48" value={value.district} onChange={(e) => setDistrict(e.target.value)}>
        <option value="">Todos os distritos</option>
        {DISTRICTS.map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>
      <select aria-label="Concelho" className="input h-10 w-48" value={value.municipality} onChange={(e) => onChange({ ...value, municipality: e.target.value })}>
        <option value="">{value.district ? `Todos os concelhos (${list.length})` : "Todos os concelhos"}</option>
        {list.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    </div>
  );
}
