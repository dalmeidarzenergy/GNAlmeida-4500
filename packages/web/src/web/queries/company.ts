import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

function useInv() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: orpc.company.key() });
}

/** Numeros das abas do Centro de Custos: previsao, auto final, despesas, comissoes e lucro. */
export const useCompanyFinance = (month: string) =>
  useQuery(orpc.company.finance.queryOptions({ input: { month }, placeholderData: (prev) => prev }));

/** Despesas da empresa lancadas a mao num mes. */
export const useCompanyExpenses = (month: string) =>
  useQuery(orpc.company.expenses.queryOptions({ input: { month }, placeholderData: (prev) => prev }));

export function useSaveCompanyExpense() {
  const inv = useInv();
  const c = useMutation(orpc.company.expenseCreate.mutationOptions({ onSuccess: inv }));
  const u = useMutation(orpc.company.expenseUpdate.mutationOptions({ onSuccess: inv }));
  return { create: c, update: u, isPending: c.isPending || u.isPending };
}

export const useRemoveCompanyExpense = () => useMutation(orpc.company.expenseRemove.mutationOptions({ onSuccess: useInv() }));
