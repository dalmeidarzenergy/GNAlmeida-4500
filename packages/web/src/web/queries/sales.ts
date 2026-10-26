import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

function useInv() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: orpc.sales.key() });
    qc.invalidateQueries({ queryKey: orpc.reports.key() });
  };
}

export const useClients = () => useQuery(orpc.sales.clients.list.queryOptions());
export const useOrders = () => useQuery(orpc.sales.orders.list.queryOptions());
export const useTargets = (month: string) => useQuery(orpc.sales.targets.list.queryOptions({ input: { month } }));

export function useSaveClient() {
  const inv = useInv();
  const c = useMutation(orpc.sales.clients.create.mutationOptions({ onSuccess: inv }));
  const u = useMutation(orpc.sales.clients.update.mutationOptions({ onSuccess: inv }));
  return { create: c, update: u, isPending: c.isPending || u.isPending };
}
export const useRemoveClient = () => useMutation(orpc.sales.clients.remove.mutationOptions({ onSuccess: useInv() }));
export function useSaveSale() {
  const inv = useInv();
  const c = useMutation(orpc.sales.orders.create.mutationOptions({ onSuccess: inv }));
  const u = useMutation(orpc.sales.orders.update.mutationOptions({ onSuccess: inv }));
  return { create: c, update: u, isPending: c.isPending || u.isPending };
}
export const useRemoveClients = () => useMutation(orpc.sales.clients.removeMany.mutationOptions({ onSuccess: useInv() }));
export const useRemoveOrders = () => useMutation(orpc.sales.orders.removeMany.mutationOptions({ onSuccess: useInv() }));
export const useRemoveOrder = () => useMutation(orpc.sales.orders.remove.mutationOptions({ onSuccess: useInv() }));
export function useSetOrderStatus() {
  const qc = useQueryClient();
  const key = orpc.sales.orders.list.queryOptions().queryKey;
  return useMutation(
    orpc.sales.orders.setStatus.mutationOptions({
      onMutate: async ({ id, status, energy }) => {
        await qc.cancelQueries({ queryKey: key });
        const prev = qc.getQueryData(key);
        qc.setQueryData(key, (old: any) =>
          old?.map((o: any) => (o.id !== id ? o : energy === "gas" ? { ...o, details: { ...o.details, saleStatusGas: status } } : { ...o, status })),
        );
        return { prev };
      },
      onError: (_e, _i, ctx) => qc.setQueryData(key, ctx?.prev),
      onSettled: () => {
        qc.invalidateQueries({ queryKey: orpc.sales.key() });
        qc.invalidateQueries({ queryKey: orpc.reports.key() });
      },
    }),
  );
}
export const useSetTarget = () => useMutation(orpc.sales.targets.set.mutationOptions({ onSuccess: useInv() }));
export const useSaleHistory = (id: number) => useQuery(orpc.sales.orders.history.queryOptions({ input: { id } }));
export const useSetHistoryDate = () => useMutation(orpc.sales.orders.setHistoryDate.mutationOptions({ onSuccess: useInv() }));
export function useToggleAlerts() {
  const qc = useQueryClient();
  return useMutation(
    orpc.sales.orders.toggleAlerts.mutationOptions({
      onSuccess: () => qc.invalidateQueries({ queryKey: orpc.sales.key() }),
    }),
  );
}
export const useImportSales = () => useMutation(orpc.sales.orders.importMany.mutationOptions({ onSuccess: useInv() }));
