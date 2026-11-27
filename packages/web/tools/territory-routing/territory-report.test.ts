import { expect, test } from "bun:test";
import reports from "../../src/api/data/territory-report.json";
import arms from "../../src/api/data/territory-report-arms.json";
import provinces from "../../src/api/data/territory-report-provinces.json";
import { allocateTerritoryContracts } from "../../src/api/lib/territory-parish-contracts";

type Ages = [number, number, number];
type Row = [string, string, string, number | null, Ages | null, string[], [number, number], number[][]];
const snapshot = reports as unknown as Record<string, [string[], Row[], [string, Ages][]]>;

test("the report catalogue covers all municipalities, parishes and municipal coats of arms", async () => {
  const codes = Object.keys(snapshot).sort();
  expect(codes).toHaveLength(308);
  expect(Object.keys(arms).sort()).toEqual(codes);
  const assets = new Bun.Glob("*.webp");
  const files = await Array.fromAsync(assets.scan({ cwd: new URL("../../public/territory-arms/", import.meta.url).pathname }));
  expect(files.sort()).toEqual(codes.map((code) => `${code}.webp`));
  expect(new Set(Object.values(snapshot).flatMap(([, parishes]) => parishes.map(([code]) => code))).size).toBe(3259);
  const census = Object.values(snapshot).flatMap(([, , rows]) => rows);
  expect(census).toHaveLength(3092);
  expect(census.flatMap(([, age]) => age).reduce((a, b) => a + b, 0)).toBe(10343066);
});

test("Seia retains 2021 age data and does not use older populations for incompatible parishes", () => {
  const [regions, current, census] = snapshot["0912"];
  expect(regions[0]).toBe("Guarda");
  expect(provinces["0912"]).toBe("Beira Alta");
  expect(current).toHaveLength(24);
  expect(current.filter((r) => r[4] === null)).toHaveLength(5);
  expect(census).toHaveLength(21);
  expect(census.flatMap(([, age]) => age).reduce((a, b) => a + b, 0)).toBe(21755);
  expect(current.find(([code]) => code === "091201")?.[4]).toEqual([23, 149, 159]);
});

test("only matches unambiguous localities and preserves the municipal contract total", () => {
  const calculation = allocateTerritoryContracts([
    { code: "01", name: "Freguesia de São Romão", short: "São Romão", localities: ["Póvoa de Cima", "Lugar Comum"] },
    { code: "02", name: "Aldeia", short: "Aldeia", localities: ["Lugar Comum"] },
  ], [
    { city: " SAO ROMAO ", total: 2 }, { city: "Póvoa de Cima", total: 3 }, { city: "Aldeia", total: 1 },
    { city: "Lugar Comum", total: 4 }, { city: "São Romão — Norte", total: 1 }, { city: null, total: 2 },
  ]);
  expect(calculation.perParish).toEqual(new Map([["01", 5], ["02", 1]]));
  expect(calculation.unassigned).toBe(7);
  expect(calculation.total).toBe(13);
});