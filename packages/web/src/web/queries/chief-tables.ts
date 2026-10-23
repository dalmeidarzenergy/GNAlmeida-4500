import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

function useInv() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: orpc.chiefTables.key() });
}

export const useChiefTables = () => useQuery(orpc.chiefTables.list.queryOptions());

export function useSaveChiefTable() {
  const inv = useInv();
  const c = useMutation(orpc.chiefTables.create.mutationOptions({ onSuccess: inv }));
  const u = useMutation(orpc.chiefTables.update.mutationOptions({ onSuccess: inv }));
  return { create: c, update: u, isPending: c.isPending || u.isPending };
}

export const useRemoveChiefTable = () =>
  useMutation(orpc.chiefTables.remove.mutationOptions({ onSuccess: useInv() }));

/** Cálculo do escalão de chefe de equipa, por mes. */
export const useChiefCalc = (month: string) =>
  useQuery(orpc.chiefTables.calc.queryOptions({ input: { month } }));
