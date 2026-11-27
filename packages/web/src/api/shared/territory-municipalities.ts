import catalogue from "../data/territory-municipality-distances.json";

export type MunicipalityLocation = { district: string; municipality: string };
type Municipality = [code: string, districtOrIsland: string, municipality: string, meters: number | null];
const rows = catalogue.rows as Municipality[];
export function normalizeTerritoryText(s: string) {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().replace(/\s+/g, " ").toLowerCase();
}
const normalize = (s: string) => normalizeTerritoryText(s).replace(/[^a-z0-9]+/g, " ").trim();
const byName = new Map<string, Set<Municipality>>();
const byDistrict = new Map<string, Set<Municipality>>();
function add(map: Map<string, Set<Municipality>>, key: string, row: Municipality) {
  const matches = map.get(key) ?? new Set<Municipality>();
  matches.add(row);
  map.set(key, matches);
}
const region = (code: string) => code.startsWith("3") ? "Região Autónoma da Madeira" : code.startsWith("4") ? "Região Autónoma dos Açores" : null;
for (const row of rows) {
  const [code, district, name] = row;
  const area = region(code);
  const districts = [district, ...(code.startsWith("3") ? ["Madeira"] : code.startsWith("4") ? ["Açores"] : []), ...(area ? [area] : [])];
  const names = [name, ...(code === "4201" ? ["Lagoa (Açores)"] : code === "3101" ? ["Calheta (Madeira)"] : code === "4501" ? ["Calheta (Açores)", "Calheta"] : [])];
  for (const name of names.map(normalize)) {
    add(byName, name, row);
    for (const district of districts.map(normalize)) add(byDistrict, `${district}/${name}`, row);
  }
}

export function territoryMunicipality({ district, municipality }: MunicipalityLocation) {
  const name = normalize(municipality);
  const d = normalize(district);
  const matches = d ? byDistrict.get(`${d}/${name}`) : byName.get(name);
  if (matches?.size !== 1) return undefined;
  const [row] = matches;
  const [code, officialDistrict, officialName, meters] = row;
  return { code, district: region(code) ?? officialDistrict, municipality: officialName, meters };
}

export function territoryKey(location: MunicipalityLocation) {
  const found = territoryMunicipality(location);
  return found?.code ?? JSON.stringify([location.district, location.municipality].map(normalize));
}

export function mergeTerritorySweeps<T extends MunicipalityLocation & { lastSweep: string | null }>(rows: T[]) {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const key = territoryKey(row);
    const previous = latest.get(key);
    if (!previous || (row.lastSweep ?? "") > (previous.lastSweep ?? "")) latest.set(key, row);
  }
  return [...latest.values()];
}
