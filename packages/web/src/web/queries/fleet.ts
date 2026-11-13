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

export const useFleetDocs = () => useQuery(orpc.fleet.documents.list.queryOptions({ input: {} }));

export const useUploadFleetDoc = () => useMutation(orpc.fleet.documents.upload.mutationOptions({ onSuccess: useInvalidateFleet() }));
export const useRemoveFleetDoc = () => useMutation(orpc.fleet.documents.remove.mutationOptions({ onSuccess: useInvalidateFleet() }));

/* ---- quilómetros ---- */
export const useReadings = (vehicleId: number) =>
  useQuery(orpc.fleet.readings.list.queryOptions({ input: { vehicleId }, enabled: vehicleId > 0 }));
export const useAddReading = () => useMutation(orpc.fleet.readings.create.mutationOptions({ onSuccess: useInvalidateFleet() }));
export const useEditReading = () => useMutation(orpc.fleet.readings.update.mutationOptions({ onSuccess: useInvalidateFleet() }));
export const useRemoveReading = () => useMutation(orpc.fleet.readings.remove.mutationOptions({ onSuccess: useInvalidateFleet() }));

/* ---- manutenções ---- */
export const useMaintenance = () => useQuery(orpc.fleet.maintenance.list.queryOptions({ input: {} }));
export function useSaveMaintenance() {
  const inv = useInvalidateFleet();
  const c = useMutation(orpc.fleet.maintenance.create.mutationOptions({ onSuccess: inv }));
  const u = useMutation(orpc.fleet.maintenance.update.mutationOptions({ onSuccess: inv }));
  return { create: c, update: u, isPending: c.isPending || u.isPending };
}
export const useRemoveMaintenance = () => useMutation(orpc.fleet.maintenance.remove.mutationOptions({ onSuccess: useInvalidateFleet() }));
