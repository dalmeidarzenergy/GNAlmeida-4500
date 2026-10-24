import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";
import { authClient } from "../lib/auth";

function useInv() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: orpc.iberdrola.key() });
}

/** Histórico de ficheiros Iberdrola carregados. */
export const useIberdrolaImports = () => useQuery(orpc.iberdrola.list.queryOptions());

/** Linhas de um ficheiro carregado. */
export const useIberdrolaImport = (id: number | null) =>
  useQuery({ ...orpc.iberdrola.get.queryOptions({ input: { id: id ?? 0 } }), enabled: id != null });

/** Envia o ficheiro Iberdrola (multipart) e guarda-o no histórico. */
export function useSaveIberdrola() {
  const inv = useInv();
  const [error, setError] = useState<string | null>(null);
  const c = useMutation({
    mutationFn: async (input: { file: File; month: string }) => {
      const form = new FormData();
      form.append("file", input.file);
      form.append("month", input.month);
      const token = authClient.managedAuth.getToken();
      const res = await fetch(`${window.location.origin}/api/iberdrola/upload`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Erro ${res.status}`);
      }
      return (await res.json()) as { id: number };
    },
    onSuccess: () => {
      setError(null);
      inv();
    },
    onError: (e: unknown) => {
      setError(e && typeof e === "object" && "message" in e ? String((e as { message: string }).message) : "Ocorreu um erro");
    },
  });
  return { save: c, isPending: c.isPending, error };
}

export const useRemoveIberdrola = () =>
  useMutation(orpc.iberdrola.remove.mutationOptions({ onSuccess: useInv() }));

/** Muda o mês de pagamento de um ficheiro carregado. */
export const useSetIberdrolaMonth = () =>
  useMutation(orpc.iberdrola.setMonth.mutationOptions({ onSuccess: useInv() }));

/** "Autos Finais" do mês. */
export const useIberdrolaCalc = (month: string) =>
  useQuery({ ...orpc.iberdrola.calc.queryOptions({ input: { month } }), enabled: /^\d{4}-\d{2}$/.test(month) });
