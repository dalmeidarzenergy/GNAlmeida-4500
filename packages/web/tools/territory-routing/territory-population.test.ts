import { expect, spyOn, test } from "bun:test";
import ca from "../../src/api/data/territory-municipality-distances.json";
import fallback from "../../src/api/data/territory-municipality-population.json";
import { createPopulationCache, parseInePopulation } from "../../src/api/lib/territory-population";

const municipalRows = Object.entries(fallback.byMunicipality).map(([code, value]) => [code === "0503" ? "1960503" : `1A0${code}`, value] as const);
const row = (geocod: string, value: number) => ({ geocod, dim_3: "T", dim_4: "T", valor: String(value) });
const data = [...municipalRows.map(([code, value]) => row(code, value)), row("PT", fallback.nationalTotal), row("1A0", 5000)];
const payload = (year = fallback.year, rows = data, updatedAt = fallback.updatedAt) => [{
  IndicadorCod: "0012918", UltimoPref: String(year), DataUltimoAtualizacao: updatedAt, Dados: { [year]: rows },
}];

test("validates totals for all 308 CAOP codes, including NUTS prefixes with letters and digits", () => {
  const parsed = parseInePopulation(payload());
  expect(Object.keys(parsed.byMunicipality).sort()).toEqual(ca.rows.map(([code]) => code).sort());
  expect(Object.keys(parsed.byMunicipality)).toHaveLength(308);
  expect(parsed).toEqual(fallback);
  expect(parsed.byMunicipality["0503"]).toBe(51045);
  expect(parsed.byMunicipality["4901"]).toBe(434);
});

test("rejects incomplete, ambiguous or inconsistent INE data instead of adopting it", () => {
  expect(() => parseInePopulation(payload(fallback.year, data.slice(1)))).toThrow();
  expect(() => parseInePopulation(payload(fallback.year, [...data, data[0]]))).toThrow();
  expect(() => parseInePopulation(payload(fallback.year, data.map((item) => item.geocod === "PT" ? row("PT", 1) : item)))).toThrow();
  expect(() => parseInePopulation(payload(fallback.year, [{ ...data[0], dim_4: "1" }, ...data.slice(1)]))).toThrow();
  expect(() => parseInePopulation(payload(fallback.year, [{ ...data[0], valor: ".." }, ...data.slice(1)]))).toThrow();
});

test("serves immediately, checks once per day and keeps valid data across outages and older releases", async () => {
  let time = 0;
  let calls = 0;
  const newer = fallback.year + 1;
  const releaseDate = `${newer + 1}-06-22`;
  const history = [payload(newer, data, releaseDate), payload(newer, data.slice(1), releaseDate), null, payload(fallback.year)];
  const warnings = spyOn(console, "warn").mockImplementation(() => {});
  const cache = createPopulationCache(async () => {
    const result = history[calls++];
    if (!result) throw new Error("INE indisponível");
    return result;
  }, () => time);
  try {
    expect(cache.get()).toBe(fallback);
    const refreshing = cache.refresh();
    expect(refreshing).toBeDefined();
    expect(cache.refresh()).toBe(refreshing);
    await refreshing;
    expect(cache.get().year).toBe(newer);
    expect(cache.refresh()).toBeUndefined();
    expect(calls).toBe(1);
    for (let i = 0; i < 3; i++) {
      time += 86_400_000;
      await cache.refresh();
      expect(cache.get().year).toBe(newer);
    }
    expect(calls).toBe(4);
    expect(warnings).toHaveBeenCalledTimes(2);
  } finally {
    warnings.mockRestore();
  }
});