import { normalizeTerritoryText } from "../shared/territory-municipalities";

const nameKey = (s: string) => normalizeTerritoryText(s).replace(/[^a-z0-9]+/g, " ").trim();

export function allocateTerritoryContracts(
  parishes: ReadonlyArray<{ code: string; name: string; short: string; localities: readonly string[] }>,
  groups: ReadonlyArray<{ city: string | null; total: number }>,
) {
  const candidates = new Map<string, string | null>();
  for (const { code, name, short, localities } of parishes) {
    for (const label of [name, short, ...localities]) {
      const key = nameKey(label);
      if (!key) continue;
      if (!candidates.has(key)) candidates.set(key, code);
      else if (candidates.get(key) !== code) candidates.set(key, null);
    }
  }
  let total = 0, unassigned = 0;
  const perParish = new Map<string, number>();
  for (const { city, total: count } of groups) {
    total += count;
    const parish = city && candidates.get(nameKey(city));
    if (parish) perParish.set(parish, (perParish.get(parish) ?? 0) + count);
    else unassigned += count;
  }
  return { total, unassigned, perParish };
}
