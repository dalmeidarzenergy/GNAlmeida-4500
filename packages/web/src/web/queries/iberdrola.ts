import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

function useInv() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: orpc.iberdrola.key() });
}

/** Histórico de ficheiros Iberdrola carregados. */
export const useIberdrolaImports = () => useQuery(orpc.iberdrola.list.queryOptions());

/** Linhas de um ficheiro carregado. */
export const useIberdrolaImport = (id: number | null) =>
  useQuery({ ...orpc.iberdrola.get.queryOptions({ input: { id: id ?? 0 } }), enabled: id != null });

/** Guarda um ficheiro no histórico. */
export function useSaveIberdrola() {
  const inv = useInv();
  const c = useMutation(orpc.iberdrola.save.mutationOptions({ onSuccess: inv }));
  return { save: c, isPending: c.isPending };
}

export const useRemoveIberdrola = () =>
  useMutation(orpc.iberdrola.remove.mutationOptions({ onSuccess: useInv() }));

/** "Autos Finais" do mês. */
export const useIberdrolaCalc = (month: string) =>
  useQuery({ ...orpc.iberdrola.calc.queryOptions({ input: { month } }), enabled: /^\d{4}-\d{2}$/.test(month) });
