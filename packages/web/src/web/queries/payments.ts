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

/** Detalhe completo por pessoa/venda do mes (ecra + PDF). */
export const usePaymentBreakdown = (month: string) =>
  useQuery({ ...orpc.payments.breakdown.queryOptions({ input: { month } }), enabled: /^\d{4}-\d{2}$/.test(month) });

/** Detalhe de um funcionario no mes. */
export const usePaymentAutoDetail = (month: string, employeeId: number | null) =>
  useQuery({
    ...orpc.payments.autoDetail.queryOptions({ input: { month, employeeId: employeeId ?? 0 } }),
    enabled: employeeId != null && /^\d{4}-\d{2}$/.test(month),
  });

/** Gera o PDF do auto de pagamento (todos ou um funcionario). */
export function useAutoPdf() {
  const c = useMutation(orpc.payments.autoPdf.mutationOptions());
  return { generate: c, isPending: c.isPending };
}
