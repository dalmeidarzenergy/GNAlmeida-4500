import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

const key = () => orpc.notifications.list.queryOptions().queryKey;

export function useNotifications() {
  return useQuery(orpc.notifications.list.queryOptions({ staleTime: 30_000 }));
}
export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation(
    orpc.notifications.markRead.mutationOptions({
      onSuccess: () => qc.invalidateQueries({ queryKey: [orpc.notifications.key()] }),
    }),
  );
}
export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation(
    orpc.notifications.markAllRead.mutationOptions({
      onSuccess: () => qc.invalidateQueries({ queryKey: key() }),
    }),
  );
}
