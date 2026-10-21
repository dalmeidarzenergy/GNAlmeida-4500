import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

export function useMe(enabled = true) {
  return useQuery(orpc.me.queryOptions({ enabled, staleTime: 60_000, retry: false }));
}
export function useUsers() {
  return useQuery(orpc.users.list.queryOptions());
}
export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation(
    orpc.users.update.mutationOptions({
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: orpc.users.key() });
        qc.invalidateQueries({ queryKey: orpc.me.key() });
      },
    }),
  );
}
