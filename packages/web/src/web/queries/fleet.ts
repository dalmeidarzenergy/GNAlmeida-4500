import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

function useInvalidateFleet() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: orpc.fleet.key() });
  };
}

export const useVehicles = () => useQuery(orpc.fleet.vehicles.list.queryOptions());
export const useFleetCards = () => useQuery(orpc.fleet.cards.list.queryOptions());
export const useFleetDrivers = () => useQuery(orpc.fleet.drivers.queryOptions({ staleTime: 30_000 }));

export function useSaveVehicle() {
  const inv = useInvalidateFleet();
  const c = useMutation(orpc.fleet.vehicles.create.mutationOptions({ onSuccess: inv }));
  const u = useMutation(orpc.fleet.vehicles.update.mutationOptions({ onSuccess: inv }));
  return { create: c, update: u, isPending: c.isPending || u.isPending };
}
export const useRemoveVehicle = () => useMutation(orpc.fleet.vehicles.remove.mutationOptions({ onSuccess: useInvalidateFleet() }));

export function useSaveCard() {
  const inv = useInvalidateFleet();
  const c = useMutation(orpc.fleet.cards.create.mutationOptions({ onSuccess: inv }));
  const u = useMutation(orpc.fleet.cards.update.mutationOptions({ onSuccess: inv }));
  return { create: c, update: u, isPending: c.isPending || u.isPending };
}
export const useRemoveCard = () => useMutation(orpc.fleet.cards.remove.mutationOptions({ onSuccess: useInvalidateFleet() }));

export const useUploadFleetDoc = () => useMutation(orpc.fleet.documents.upload.mutationOptions({ onSuccess: useInvalidateFleet() }));
export const useRemoveFleetDoc = () => useMutation(orpc.fleet.documents.remove.mutationOptions({ onSuccess: useInvalidateFleet() }));
