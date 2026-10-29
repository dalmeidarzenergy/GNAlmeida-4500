import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

/** Comercializadores acrescentados pelo utilizador (a lista base vive no código). */
export const useSuppliersPayload = () => useQuery(orpc.suppliersRoute.list.queryOptions());

/** Comercializadores acrescentados pelo utilizador (a lista base vive no codigo). */
export const useCustomSuppliers = () => {
  const q = useSuppliersPayload();
  return { ...q, data: q.data?.items };
};

/** Excecoes aos nomes de origem: escondidos e renomeados. */
export const useSupplierOverrides = () => {
  const q = useSuppliersPayload();
  return {
    removed: q.data?.removed ?? [],
    renamed: q.data?.renamed ?? {},
  };
};

export function useSaveSupplier() {
  const qc = useQueryClient();
  const onSuccess = () => {
    qc.invalidateQueries({ queryKey: orpc.suppliersRoute.key() });
  };
  const c = useMutation(orpc.suppliersRoute.create.mutationOptions({ onSuccess }));
  const u = useMutation(orpc.suppliersRoute.update.mutationOptions({ onSuccess }));
  const r = useMutation(orpc.suppliersRoute.remove.mutationOptions({ onSuccess }));
  return { create: c, update: u, remove: r, isPending: c.isPending || u.isPending || r.isPending };
}
