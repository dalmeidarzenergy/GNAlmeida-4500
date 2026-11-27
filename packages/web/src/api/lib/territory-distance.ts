import catalogue from "../data/territory-road-distances.json";
import { normalizeTerritoryText, type TerritoryDistance, type TerritoryInput } from "../shared/territories";

type Parish = [code: string, district: string, municipality: string, official: string, short: string, meters: number | null];
type Location = Pick<TerritoryInput, "district" | "municipality" | "parish">;
const normalizePlace = (text: string) => normalizeTerritoryText(text).replace(/[^a-z0-9]+/g, " ").trim();
const key = (district: string, municipality: string, parish: string) =>
  JSON.stringify([district, municipality, parish].map(normalizePlace));
const parishKey = (name: string) => normalizePlace(name).replace(/^(?:u ?f(?: d[aeo]s?)?|uniao (?:d[aeo]s? )?freguesias(?: d[aeo]s?)?|freguesia d[aeo]s?) +/, "");

// Anexo I da Lei n.º 11-A/2013, Município da Covilhã. Só as uniões ainda presentes na CAOP 2025;
// não aplicar nomes de antigas uniões entretanto desagregadas a qualquer uma das suas sucessoras.
const aliasesByCode: Partial<Record<string, readonly string[]>> = {
  "050335": ["Covilhã", "Covilhã (Conceição)", "Covilhã (Santa Maria)", "Covilhã (São Martinho)", "Covilhã (São Pedro)", "Canhoso"],
  "050337": ["Teixoso", "Sarzedo"],
  "050338": ["Vale Formoso", "Aldeia do Souto"],
};

const index = new Map<string, Parish | null>();
const aliases = new Map<string, Parish | null>();
function add(target: Map<string, Parish | null>, location: string, row: Parish) {
  if (!target.has(location)) target.set(location, row);
  else if (target.get(location)?.[0] !== row[0]) target.set(location, null);
}
for (const row of catalogue.rows as Parish[]) {
  const [code, district, municipality, official, short] = row;
  const regions = code.startsWith("3") ? ["Madeira", "Região Autónoma da Madeira"] : code.startsWith("4") ? ["Açores", "Região Autónoma dos Açores"] : [];
  for (const d of [district, ...regions]) {
    for (const name of [official, short, parishKey(official)].filter(Boolean)) add(index, key(d, municipality, name), row);
    for (const name of aliasesByCode[code] ?? []) add(aliases, key(d, municipality, name), row);
  }
}

function resolveParish({ district, municipality, parish }: Location) {
  const exact = key(district, municipality, parish);
  const simplified = key(district, municipality, parishKey(parish));
  if (index.has(exact)) return index.get(exact);
  if (index.has(simplified)) return index.get(simplified);
  return aliases.get(simplified);
}

export const territoryParishCode = (location: Location) => resolveParish(location)?.[0];

export function territoryDistance(location: Location): TerritoryDistance {
  const row = resolveParish(location);
  if (!row) return { status: "not_found" };
  return row[5] === null ? { status: "no_route" } : { status: "ok", meters: row[5] };
}
