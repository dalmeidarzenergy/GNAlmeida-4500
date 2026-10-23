import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

function useInv(employeeId?: number) {
  const qc = useQueryClient();
  return async () => {
    await qc.invalidateQueries({ queryKey: orpc.hr.key() });
    if (employeeId != null) await qc.invalidateQueries({ queryKey: orpc.hr.employeeTables.list.key({ input: { employeeId } }) });
  };
}

/** Histórico de tabelas de um funcionário (com vigência por datas). */
export const useEmployeeTables = (employeeId: number | null) =>
  useQuery(orpc.hr.employeeTables.list.queryOptions({ input: { employeeId: employeeId ?? -1 }, enabled: employeeId != null }));

export function useSaveEmployeeTable(employeeId: number | null) {
  const inv = useInv(employeeId ?? undefined);
  return useMutation(orpc.hr.employeeTables.save.mutationOptions({ onSuccess: inv }));
}

export function useRemoveEmployeeTable(employeeId: number | null) {
  const inv = useInv(employeeId ?? undefined);
  return useMutation(orpc.hr.employeeTables.remove.mutationOptions({ onSuccess: inv }));
}
