import catalogue from "../data/territory-report.json";
import arms from "../data/territory-report-arms.json";
import provinces from "../data/territory-report-provinces.json";
import { territoryMunicipality } from "../shared/territory-municipalities";
import type { TerritoryInput } from "../shared/territories";
import { territoryContractLocations } from "./territory-contracts";
import { allocateTerritoryContracts } from "./territory-parish-contracts";
import { territoryPopulation } from "./territory-population";

type Ages = [young: number, adult: number, senior: number];
type Place = [code: string, name: string, short: string, meters: number | null, ages: Ages | null, localities: string[], label: [number, number], rings: number[][]];
type Snapshot = [[district: string, nuts1: string, nuts2: string, nuts3: string], Place[], [name: string, ages: Ages][]];
const reports = catalogue as unknown as Partial<Record<string, Snapshot>>;
const armFiles: Partial<Record<string, { file: string; author?: string; license?: string; licenseUrl?: string }>> = arms;
const historicalProvinces: Partial<Record<string, string>> = provinces;
const sortByName = new Intl.Collator("pt-PT");
const totalPopulation = (ages: Ages) => ages[0] + ages[1] + ages[2];
const fraction = (contracts: number, population: number | null) => population && population > 0 ? contracts / population : null;

export async function territoryReport(row: TerritoryInput, allowSales: boolean) {
  const place = territoryMunicipality(row);
  const data = place && reports[place.code];
  if (!place || !data) return null;
  const [[districtOrIsland, , nuts2, nuts3], current, census] = data;
  const snapshot = territoryPopulation.get();
  const population = snapshot.byMunicipality[place.code] ?? null;
  const parishes = current.map(([code, name, short, meters, ages, localities, label, rings]) => ({
    code, name, short, meters, censusPopulation: ages ? totalPopulation(ages) : null,
    localities: [...localities].sort(sortByName.compare), label, rings,
  })).sort((a, b) => sortByName.compare(a.short || a.name, b.short || b.name));
  const sales = allowSales ? await territoryContractLocations(place.code) : null;
  const counts = sales ? allocateTerritoryContracts(parishes, sales) : null;
  return {
    code: place.code, municipality: place.municipality, districtOrIsland, nuts2, nuts3,
    province: historicalProvinces[place.code] ?? null,
    lastSweep: row.lastSweep, meters: place.meters, population,
    populationYear: population === null ? null : snapshot.year,
    arms: armFiles[place.code] ?? null,
    parishes,
    census: census.map(([name, ages]) => ({ name, ages })).sort((a, b) => sortByName.compare(a.name, b.name)),
    penetration: counts && {
      total: { contracts: counts.total, rate: fraction(counts.total, population) },
      byParish: parishes.map(({ code, censusPopulation }) => {
        const contracts = counts.perParish.get(code) ?? 0;
        return { code, contracts, rate: fraction(contracts, censusPopulation) };
      }),
      unassigned: counts.unassigned,
    },
  };
}

export type TerritoryReport = NonNullable<Awaited<ReturnType<typeof territoryReport>>>;
