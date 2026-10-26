import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

export const useIncentives = () =>
  useQuery(orpc.incentives.list.queryOptions({ placeholderData: (prev) => prev }));

export const useIncentive = (id: number) =>
  useQuery(orpc.incentives.get.queryOptions({ input: { id }, placeholderData: (prev) => prev, enabled: !!id }));

export const useCreateIncentive = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof orpc.incentives.create>[0]) => orpc.incentives.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: orpc.incentives.list.key() }),
  });
};

export const useUpdateIncentive = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof orpc.incentives.update>[0]) => orpc.incentives.update(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: orpc.incentives.list.key() }),
  });
};

export const useRemoveIncentive = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => orpc.incentives.remove({ id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: orpc.incentives.list.key() }),
  });
};

export const useIncentiveCalc = (incentiveId: number, month: string) =>
  useQuery(
    orpc.incentives.calculate.queryOptions({
      input: { incentiveId, month },
      placeholderData: (prev) => prev,
      enabled: !!incentiveId && !!month,
    }),
  );

export const useSaveIncentiveCalc = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof orpc.incentives.saveCalc>[0]) => orpc.incentives.saveCalc(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: orpc.incentives.listCalcs.key() }),
  });
};

export const useIncentiveCalcs = (incentiveId?: number) =>
  useQuery(
    orpc.incentives.listCalcs.queryOptions({
      input: { incentiveId },
      placeholderData: (prev) => prev,
      enabled: incentiveId !== undefined,
    }),
  );

export const useRemoveIncentiveCalc = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => orpc.incentives.removeCalc({ id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: orpc.incentives.listCalcs.key() }),
  });
};