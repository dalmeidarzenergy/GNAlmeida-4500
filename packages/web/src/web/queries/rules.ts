import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

function useInv() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: orpc.rules.key() });
}

export const useRules = () => useQuery(orpc.rules.list.queryOptions());

export function useSaveRule() {
  const inv = useInv();
  const c = useMutation(orpc.rules.create.mutationOptions({ onSuccess: inv }));
  const u = useMutation(orpc.rules.update.mutationOptions({ onSuccess: inv }));
  return { create: c, update: u, isPending: c.isPending || u.isPending };
}

export const useRemoveRule = () =>
  useMutation(orpc.rules.remove.mutationOptions({ onSuccess: useInv() }));

/** Regras atribuídas num mês (para um grupo de funcionários). */
export const useRuleAssignments = (month: string, employeeIds?: number[]) =>
  useQuery({
    ...orpc.rules.assignments.list.queryOptions({ input: { month, employeeIds } }),
    enabled: !!month,
  });

export function useSaveRuleAssignments() {
  const qc = useQueryClient();
  return useMutation(
    orpc.rules.assignments.save.mutationOptions({
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: orpc.rules.key() });
        // As regras mudam o "devido" dos autos: recalcular o Auto Iberdrola e a ficha.
        qc.invalidateQueries({ queryKey: orpc.iberdrola.key() });
      },
    }),
  );
}