import { z } from "zod";

export const TERRITORY_COLUMNS = ["Distrito", "Concelho", "Freguesia", "Aldeia", "Data último varrimento", "Mês último varrimento", "Nº contratos", "Meses descanso", "KM"] as const;
export const TERRITORY_ROUTE_ORIGIN = "Rua do Mato, 1, 2000-531 Póvoa de Santarém";
export const TERRITORY_IMPORT_LIMIT = 2000;
const lisbonDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit" });
export const territoryToday = () => lisbonDate.format();
const place = (label: string) => z.string().trim().min(1, `${label} é obrigatório.`).max(120, `${label}: máximo de 120 caracteres.`);

export const territoryInput = z.object({
  district: place("Distrito"),
  municipality: place("Concelho"),
  parish: place("Freguesia"),
  village: z.string().trim().max(120, "Aldeia: máximo de 120 caracteres."),
  lastSweep: z.iso.date("Data do último varrimento inválida.").refine((date) => date >= "1900-01-01" && date <= territoryToday(), "A data do último varrimento não pode ser futura nem anterior a 1900.").nullable(),
  contracts: z.number().int("Nº de contratos: indica um número inteiro.").min(0, "Nº de contratos: indica um valor não negativo.").max(999999999, "Nº de contratos acima do limite."),
});
export type TerritoryInput = z.infer<typeof territoryInput>;
export type TerritoryDistance = { status: "ok"; meters: number } | { status: "not_found" | "no_route" };
export type Territory = TerritoryInput & { id: string; distance: TerritoryDistance };

export function normalizeTerritoryText(s: string) {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function territoryKey(t: TerritoryInput) {
  return JSON.stringify([t.district, t.municipality, t.parish, t.village].map(normalizeTerritoryText));
}

export function fullRestMonths(lastSweep: string | null, today = territoryToday()): number | null {
  if (!lastSweep) return null;
  const [year, month, day] = lastSweep.split("-").map(Number);
  const [currentYear, currentMonth, currentDay] = today.split("-").map(Number);
  const months = (currentYear - year) * 12 + currentMonth - month;
  const lastDay = new Date(Date.UTC(currentYear, currentMonth, 0)).getUTCDate();
  return Math.max(0, months - Number(currentDay < Math.min(day, lastDay)));
}
