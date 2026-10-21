import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

function useInvalidateHr() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: orpc.hr.key() });
    qc.invalidateQueries({ queryKey: orpc.reports.key() });
  };
}

export const useDepartments = () => useQuery(orpc.hr.departments.list.queryOptions());
export const usePositions = () => useQuery(orpc.hr.positions.list.queryOptions());
export const useEmployees = () => useQuery(orpc.hr.employees.list.queryOptions());
export const useEmployeeOptions = () => useQuery(orpc.hr.employees.options.queryOptions({ staleTime: 30_000 }));
export const useTeams = () => useQuery(orpc.hr.teams.list.queryOptions());
export function useSaveTeam() {
  const inv = useInvalidateHr();
  const c = useMutation(orpc.hr.teams.create.mutationOptions({ onSuccess: inv }));
  const u = useMutation(orpc.hr.teams.update.mutationOptions({ onSuccess: inv }));
  return { create: c, update: u, isPending: c.isPending || u.isPending };
}
export const useMoveMember = () => useMutation(orpc.hr.teams.moveMember.mutationOptions({ onSuccess: useInvalidateHr() }));
export const useEditMembership = () => useMutation(orpc.hr.teams.editMembership.mutationOptions({ onSuccess: useInvalidateHr() }));
export const useRemoveMembership = () => useMutation(orpc.hr.teams.removeMembership.mutationOptions({ onSuccess: useInvalidateHr() }));
export const useRemoveTeam = () => useMutation(orpc.hr.teams.remove.mutationOptions({ onSuccess: useInvalidateHr() }));
export const useAbsences = () => useQuery(orpc.hr.absences.list.queryOptions());

export function useSaveDepartment() {
  const inv = useInvalidateHr();
  const c = useMutation(orpc.hr.departments.create.mutationOptions({ onSuccess: inv }));
  const u = useMutation(orpc.hr.departments.update.mutationOptions({ onSuccess: inv }));
  return { create: c, update: u, isPending: c.isPending || u.isPending };
}
export function useRemoveDepartment() {
  return useMutation(orpc.hr.departments.remove.mutationOptions({ onSuccess: useInvalidateHr() }));
}
export function useSavePosition() {
  const inv = useInvalidateHr();
  const c = useMutation(orpc.hr.positions.create.mutationOptions({ onSuccess: inv }));
  const u = useMutation(orpc.hr.positions.update.mutationOptions({ onSuccess: inv }));
  return { create: c, update: u, isPending: c.isPending || u.isPending };
}
export function useRemovePosition() {
  return useMutation(orpc.hr.positions.remove.mutationOptions({ onSuccess: useInvalidateHr() }));
}
export function useSaveEmployee() {
  const inv = useInvalidateHr();
  const c = useMutation(orpc.hr.employees.create.mutationOptions({ onSuccess: inv }));
  const u = useMutation(orpc.hr.employees.update.mutationOptions({ onSuccess: inv }));
  return { create: c, update: u, isPending: c.isPending || u.isPending };
}
export function useRemoveEmployee() {
  return useMutation(orpc.hr.employees.remove.mutationOptions({ onSuccess: useInvalidateHr() }));
}
export function useCreateAbsence() {
  return useMutation(orpc.hr.absences.create.mutationOptions({ onSuccess: useInvalidateHr() }));
}
export function useRemoveAbsence() {
  return useMutation(orpc.hr.absences.remove.mutationOptions({ onSuccess: useInvalidateHr() }));
}
export function useSetAbsenceStatus() {
  const qc = useQueryClient();
  const key = orpc.hr.absences.list.queryOptions().queryKey;
  return useMutation(
    orpc.hr.absences.setStatus.mutationOptions({
      onMutate: async ({ id, status }) => {
        await qc.cancelQueries({ queryKey: key });
        const prev = qc.getQueryData(key);
        qc.setQueryData(key, (old: any) => old?.map((a: any) => (a.id === id ? { ...a, status } : a)));
        return { prev };
      },
      onError: (_e, _i, ctx) => qc.setQueryData(key, ctx?.prev),
      onSettled: () => {
        qc.invalidateQueries({ queryKey: orpc.hr.key() });
        qc.invalidateQueries({ queryKey: orpc.reports.key() });
      },
    }),
  );
}
