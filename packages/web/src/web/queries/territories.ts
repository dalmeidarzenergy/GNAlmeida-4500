import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

export function useTerritories() {
  return useQuery(orpc.territories.list.queryOptions());
}

export function useTerritoryHistory() {
  return useQuery(orpc.territories.history.queryOptions());
}

export function useTerritoryContracts(id: string) {
  return useQuery(orpc.territories.contracts.queryOptions({ input: { id }, gcTime: 0, retry: false }));
}

export function useTerritoryMutations() {
  const qc = useQueryClient();
  const onSuccess = () => qc.invalidateQueries({ queryKey: orpc.territories.list.key() });
  const create = useMutation(orpc.territories.create.mutationOptions({ onSuccess }));
  const update = useMutation(orpc.territories.update.mutationOptions({ onSuccess }));
  const importRows = useMutation(orpc.territories.importRows.mutationOptions({ onSuccess }));
  const remove = useMutation(orpc.territories.remove.mutationOptions({ onSuccess }));
  return { create, update, importRows, remove };
}
