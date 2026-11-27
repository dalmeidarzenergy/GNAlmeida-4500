import catalogue from "../data/territory-road-distances.json";
import { normalizeTerritoryText, type TerritoryDistance, type TerritoryInput } from "../shared/territories";

type Parish = [code: string, district: string, municipality: string, official: string, short: string, meters: number | null];
type Location = Pick<TerritoryInput, "district" | "municipality" | "parish">;
const key = (district: string, municipality: string, parish: string) =>
  JSON.stringify([district, municipality, parish].map((text) => normalizeTerritoryText(text).replace(/[^a-z0-9]+/g, " ").trim()));
const parishKey = (name: string) => normalizeTerritoryText(name).replace(/^u\.?\s*f\.?\s+(?:(?:de|da|das|do|dos)\s+)?|^uniao (?:das|de) freguesias(?: (?:de|da|das|do|dos))?\s+/, "");

const index = new Map<string, Parish | null>();
function add(location: string, row: Parish) {
  if (!index.has(location)) index.set(location, row);
  else if (index.get(location)?.[0] !== row[0]) index.set(location, null);
}
for (const row of catalogue.rows as Parish[]) {
  const [code, district, municipality, official, short] = row;
  const regions = code.startsWith("3") ? ["Madeira", "Região Autónoma da Madeira"] : code.startsWith("4") ? ["Açores", "Região Autónoma dos Açores"] : [];
  for (const d of [district, ...regions]) {
    for (const name of [official, short, parishKey(official)].filter(Boolean)) add(key(d, municipality, name), row);
  }
}

export function territoryDistance({ district, municipality, parish }: Location): TerritoryDistance {
  const exact = key(district, municipality, parish);
  const row = index.has(exact) ? index.get(exact) : index.get(key(district, municipality, parishKey(parish)));
  if (!row) return { status: "not_found" };
  return row[5] === null ? { status: "no_route" } : { status: "ok", meters: row[5] };
}
