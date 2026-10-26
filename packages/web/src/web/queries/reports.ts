import { useQuery } from "@tanstack/react-query";
import { orpc } from "../lib/api";

export const useDashboard = (month: string, sellerId: number | null = null, services?: string[], teamId: number | null = null, months = 6) =>
  useQuery(orpc.reports.dashboard.queryOptions({ input: { month: month || undefined, months, sellerId, teamId, services }, placeholderData: (prev) => prev }));
export const useSalesReport = (
  months: number,
  month: string,
  sellerId: number | null = null,
  services?: string[],
  teamId: number | null = null,
  place: { district?: string | null; municipality?: string | null } = {},
) =>
  useQuery(
    orpc.reports.sales.queryOptions({
      input: { months, month, sellerId, teamId, services, district: place.district || null, municipality: place.municipality || null },
      placeholderData: (prev) => prev,
    }),
  );
export const useHrReport = (month: string) => useQuery(orpc.reports.hr.queryOptions({ input: { month }, placeholderData: (prev) => prev }));
export type Granularity = "dia" | "semana" | "mes" | "todos";
export const useEvolution = (granularity: Granularity, month: string, sellerId: number | null = null, services?: string[], teamId: number | null = null) =>
  useQuery(orpc.reports.evolution.queryOptions({ input: { granularity, month, sellerId, teamId, services }, placeholderData: (prev) => prev }));
export const useCompare = (month: string, months: number, sellerId: number | null = null, services?: string[], teamId: number | null = null) =>
  useQuery(orpc.reports.compare.queryOptions({ input: { month, months, sellerId, teamId, services }, placeholderData: (prev) => prev }));
export const useMedemReport = (
  months: number,
  month: string,
  sellerId: number | null = null,
  teamId: number | null = null,
  place: { district?: string | null; municipality?: string | null } = {},
) =>
  useQuery(
    orpc.reports.medem.queryOptions({
      input: { months, month, sellerId, teamId, district: place.district || null, municipality: place.municipality || null },
      placeholderData: (prev) => prev,
    }),
  );
