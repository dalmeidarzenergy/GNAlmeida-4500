import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

function useInv() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: orpc.payments.key() });
}

/** Registo de pagamentos (autos de pagamento). */
export const usePayments = () => useQuery(orpc.payments.list.queryOptions());

export function useSavePayment() {
  const inv = useInv();
  const c = useMutation(orpc.payments.save.mutationOptions({ onSuccess: inv }));
  return { save: c, isPending: c.isPending };
}

export const useRemovePayment = () =>
  useMutation(orpc.payments.remove.mutationOptions({ onSuccess: useInv() }));

/** Calculo do que e devido no mes (vendedores + chefes). */
export const usePaymentCalc = (month: string) =>
  useQuery(orpc.payments.calc.queryOptions({ input: { month } }));
