import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

function useInv() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: orpc.commissionTables.key() });
}

export const useCommissionTables = () => useQuery(orpc.commissionTables.list.queryOptions());

export function useSaveCommissionTable() {
  const inv = useInv();
  const c = useMutation(orpc.commissionTables.create.mutationOptions({ onSuccess: inv }));
  const u = useMutation(orpc.commissionTables.update.mutationOptions({ onSuccess: inv }));
  return { create: c, update: u, isPending: c.isPending || u.isPending };
}

export const useRemoveCommissionTable = () =>
  useMutation(orpc.commissionTables.remove.mutationOptions({ onSuccess: useInv() }));

/** Cálculo de comissões de um mês, por vendedor. */
export const useCommissionCalc = (month: string) =>
  useQuery(orpc.commissionTables.calc.queryOptions({ input: { month } }));
