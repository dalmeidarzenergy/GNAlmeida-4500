import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

export const useCalendars = () => useQuery(orpc.agenda.calendars.queryOptions({}));

export const useAgendaEvents = (from: string, to: string, calendarIds?: number[]) =>
  useQuery(orpc.agenda.events.queryOptions({ input: { from, to, calendarIds }, placeholderData: (prev) => prev }));

export function useEventMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ predicate: (q) => JSON.stringify(q.queryKey).includes("agenda") });
  };
  const create = useMutation(orpc.agenda.create.mutationOptions({ onSuccess: invalidate }));
  const update = useMutation(orpc.agenda.update.mutationOptions({ onSuccess: invalidate }));
  const remove = useMutation(orpc.agenda.remove.mutationOptions({ onSuccess: invalidate }));
  return { create, update, remove };
}
