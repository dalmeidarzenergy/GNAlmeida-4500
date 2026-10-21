import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

function useInv() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: orpc.recruitment.key() });
    qc.invalidateQueries({ queryKey: orpc.reports.key() });
  };
}

export const useJobs = () => useQuery(orpc.recruitment.jobs.list.queryOptions());
export const useCandidates = () => useQuery(orpc.recruitment.candidates.list.queryOptions());

export function useSaveJob() {
  const inv = useInv();
  const c = useMutation(orpc.recruitment.jobs.create.mutationOptions({ onSuccess: inv }));
  const u = useMutation(orpc.recruitment.jobs.update.mutationOptions({ onSuccess: inv }));
  return { create: c, update: u, isPending: c.isPending || u.isPending };
}
export const useRemoveJob = () => useMutation(orpc.recruitment.jobs.remove.mutationOptions({ onSuccess: useInv() }));
export function useSaveCandidate() {
  const inv = useInv();
  const c = useMutation(orpc.recruitment.candidates.create.mutationOptions({ onSuccess: inv }));
  const u = useMutation(orpc.recruitment.candidates.update.mutationOptions({ onSuccess: inv }));
  return { create: c, update: u, isPending: c.isPending || u.isPending };
}
export const useRemoveCandidate = () =>
  useMutation(orpc.recruitment.candidates.remove.mutationOptions({ onSuccess: useInv() }));

export function useMoveCandidate() {
  const qc = useQueryClient();
  const key = orpc.recruitment.candidates.list.queryOptions().queryKey;
  return useMutation(
    orpc.recruitment.candidates.move.mutationOptions({
      onMutate: async ({ id, stage }) => {
        await qc.cancelQueries({ queryKey: key });
        const prev = qc.getQueryData(key);
        qc.setQueryData(key, (old: any) => old?.map((c: any) => (c.id === id ? { ...c, stage } : c)));
        return { prev };
      },
      onError: (_e, _i, ctx) => qc.setQueryData(key, ctx?.prev),
      onSettled: () => qc.invalidateQueries({ queryKey: orpc.recruitment.key() }),
    }),
  );
}
