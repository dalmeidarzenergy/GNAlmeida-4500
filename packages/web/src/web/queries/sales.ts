import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

function useInv() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: orpc.sales.key() });
    qc.invalidateQueries({ queryKey: orpc.reports.key() });
    qc.invalidateQueries({ queryKey: orpc.territories.list.key() });
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
        qc.invalidateQueries({ queryKey: orpc.territories.list.key() });
      },
    }),
  );
}
export const useSetTarget = () => useMutation(orpc.sales.targets.set.mutationOptions({ onSuccess: useInv() }));
export const useSaleHistory = (id: number) => useQuery(orpc.sales.orders.history.queryOptions({ input: { id } }));
export const useSetHistoryDate = () => useMutation(orpc.sales.orders.setHistoryDate.mutationOptions({ onSuccess: useInv() }));
export function useToggleAlerts() {
  const qc = useQueryClient();
  const key = orpc.sales.orders.list.queryOptions().queryKey;
  return useMutation(
    orpc.sales.orders.toggleAlerts.mutationOptions({
      onMutate: async ({ id, disabled }) => {
        await qc.cancelQueries({ queryKey: key });
        const prev = qc.getQueryData(key);
        qc.setQueryData(key, (old: any) => old?.map((o: any) => (o.id !== id ? o : { ...o, alertsDisabled: disabled })));
        return { prev };
      },
      onError: (_e, _i, ctx) => qc.setQueryData(key, ctx?.prev),
      onSettled: () => qc.invalidateQueries({ queryKey: orpc.sales.key() }),
    }),
  );
}
export function useSetReady() {
  const qc = useQueryClient();
  const key = orpc.sales.orders.list.queryOptions().queryKey;
  return useMutation(
    orpc.sales.orders.setReady.mutationOptions({
      onMutate: async ({ id, ready }) => {
        await qc.cancelQueries({ queryKey: key });
        const prev = qc.getQueryData(key);
        qc.setQueryData(key, (old: any) => old?.map((o: any) => (o.id !== id ? o : { ...o, ready })));
        return { prev };
      },
      onError: (_e, _i, ctx) => qc.setQueryData(key, ctx?.prev),
      onSettled: () => qc.invalidateQueries({ queryKey: orpc.sales.key() }),
    }),
  );
}
export const useImportSales = () => useMutation(orpc.sales.orders.importMany.mutationOptions({ onSuccess: useInv() }));

/* ------------------------------------------------------------------ *
 * Clientes a ser tratados (leads)
 * ------------------------------------------------------------------ */

export const useLeads = () => useQuery(orpc.sales.leads.list.queryOptions());
export const useLead = (id: number | null) =>
  useQuery({ ...orpc.sales.leads.get.queryOptions({ input: { id: id ?? 0 } }), enabled: id != null });

function useLeadInv() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: orpc.sales.key() });
    qc.invalidateQueries({ queryKey: orpc.reports.key() });
  };
}

export function useSaveLead() {
  const inv = useLeadInv();
  const c = useMutation(orpc.sales.leads.create.mutationOptions({ onSuccess: inv }));
  const u = useMutation(orpc.sales.leads.update.mutationOptions({ onSuccess: inv }));
  return { create: c, update: u, isPending: c.isPending || u.isPending };
}
export const useRemoveLead = () => useMutation(orpc.sales.leads.remove.mutationOptions({ onSuccess: useLeadInv() }));
/** Avançar: a lead passa a cliente e a venda é criada. */
export const useAdvanceLead = () => useMutation(orpc.sales.leads.advance.mutationOptions({ onSuccess: useInv() }));
export function useLeadDocuments() {
  const inv = useLeadInv();
  const up = useMutation(orpc.sales.leads.documents.upload.mutationOptions({ onSuccess: inv }));
  const rm = useMutation(orpc.sales.leads.documents.remove.mutationOptions({ onSuccess: inv }));
  return { upload: up, remove: rm, isPending: up.isPending };
}

/* ------------------------------------------------------------------ *
 * Reports à venda (dentro da lead)
 * ------------------------------------------------------------------ */

export const useLeadReports = (leadId: number | null) =>
  useQuery({ ...orpc.sales.leads.reports.list.queryOptions({ input: { leadId: leadId ?? 0 } }), enabled: leadId != null });
export const useAllLeadReports = () => useQuery(orpc.sales.leads.reports.all.queryOptions({ input: {} }));
export function useLeadReportsMutation() {
  const inv = useLeadInv();
  const create = useMutation(orpc.sales.leads.reports.create.mutationOptions({ onSuccess: inv }));
  const remove = useMutation(orpc.sales.leads.reports.remove.mutationOptions({ onSuccess: inv }));
  return { create, remove, isPending: create.isPending };
}
