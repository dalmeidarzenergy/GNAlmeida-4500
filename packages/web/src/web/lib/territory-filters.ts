import { fullRestMonths, normalizeTerritoryText, type Territory } from "../../api/shared/territories";

export const TERRITORY_PAGE_SIZE = 20;

export const emptyTerritoryFilters = {
  query: "", district: "", municipality: "",
  sweep: "", month: "", from: "", to: "",
  restMin: "", restMax: "", contractsMin: "", contractsMax: "",
  distance: "", kmMin: "", kmMax: "",
};
export type TerritoryFilters = typeof emptyTerritoryFilters;

export function territoryFilterError(f: TerritoryFilters, canViewContracts: boolean) {
  if (f.sweep === "range" && f.from && f.to && f.from > f.to) return "A data inicial não pode ser posterior à data final.";
  const ranges = [
    [f.restMin, f.restMax, "meses de descanso"],
    ...(canViewContracts ? [[f.contractsMin, f.contractsMax, "número de contratos"]] : []),
    ...(f.distance === "range" ? [[f.kmMin, f.kmMax, "distância"]] : []),
  ];
  for (const [min, max, label] of ranges) {
    const allowDecimals = label === "distância";
    const invalid = (v: string) => {
      const n = Number(v);
      return !Number.isFinite(n) || n < 0 || (!allowDecimals && !Number.isInteger(n));
    };
    if ([min, max].some(invalid)) {
      return `Introduz valores ${label === "distância" ? "não negativos" : "inteiros não negativos"} para ${label}.`;
    }
    if (min && max && Number(min) > Number(max)) return `O mínimo de ${label} não pode ser superior ao máximo.`;
  }
}

function inRange(value: number | null, min: string, max: string) {
  if (!min && !max) return true;
  return value !== null && (!min || value >= Number(min)) && (!max || value <= Number(max));
}

export function filterTerritories(rows: Territory[], f: TerritoryFilters, today: string, canViewContracts: boolean) {
  const q = normalizeTerritoryText(f.query);
  return rows.filter((row) => {
    if (q && !normalizeTerritoryText(`${row.district} ${row.municipality}`).includes(q)) return false;
    if (f.district && f.district !== row.district) return false;
    if (f.municipality && f.municipality !== row.municipality) return false;
    const date = row.lastSweep;
    if (f.sweep === "missing" && date) return false;
    if (f.sweep === "month" && (!date || (f.month && date.slice(5, 7) !== f.month))) return false;
    if (f.sweep === "range" && (!date || (f.from && date < f.from) || (f.to && date > f.to))) return false;
    if (!inRange(fullRestMonths(date, today), f.restMin, f.restMax)) return false;
    if (canViewContracts && !inRange(row.contracts, f.contractsMin, f.contractsMax)) return false;
    if (f.distance === "no_route" && row.distance.status !== "no_route") return false;
    if (f.distance === "range" && (row.distance.status !== "ok" || !inRange(Math.round(row.distance.meters / 100) / 10, f.kmMin, f.kmMax))) return false;
    return true;
  });
}