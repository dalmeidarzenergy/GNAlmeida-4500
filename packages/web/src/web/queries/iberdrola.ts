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

/** Equipas com líderes e membros ativos no mês. */
export const useIberdrolaTeams = (month: string) =>
  useQuery({ ...orpc.iberdrola.teamList.queryOptions({ input: { month } }) });

/** Todos os colaboradores (para escolher o destino de uma troca de venda). */
export const useIberdrolaStaffList = (month: string) =>
  useQuery({ ...orpc.iberdrola.staffList.queryOptions({ input: { month } }) });

/** Resumo dos autos de um funcionário, por mês. */
export const useIberdrolaEmployee = (employeeId: number | null) =>
  useQuery({ ...orpc.iberdrola.employee.queryOptions({ input: { employeeId: employeeId ?? 0 } }), enabled: employeeId != null });

/** Define o desbloqueio de comissões de um comercial (0 = objetivo; 25/50/75/100 = % do 2.º escalão). */
export const useIberdrolaForceCommissionsSet = () =>
  useMutation(orpc.iberdrola.forceCommissionsSet.mutationOptions({ onSuccess: useInv() }));

/** Adiciona uma penalidade VNC a um comercial num mês. */
export const useIberdrolaVncAdd = () =>
  useMutation(orpc.iberdrola.vncAdd.mutationOptions({ onSuccess: useInv() }));

/** Remove uma penalidade VNC. */
export const useIberdrolaVncRemove = () =>
  useMutation(orpc.iberdrola.vncRemove.mutationOptions({ onSuccess: useInv() }));

/** Aplica um bloqueio de comissão (total ou parcial) ao auto de um comercial. */
export const useIberdrolaBlockAdd = () =>
  useMutation(orpc.iberdrola.blockAdd.mutationOptions({ onSuccess: useInv() }));

/** Remove um bloqueio de comissão. */
export const useIberdrolaBlockRemove = () =>
  useMutation(orpc.iberdrola.blockRemove.mutationOptions({ onSuccess: useInv() }));

/** Aplica uma anulação de chargeback (total ou parcial) ao auto de um comercial. */
export const useIberdrolaChargebackOverrideAdd = () =>
  useMutation(orpc.iberdrola.chargebackOverrideAdd.mutationOptions({ onSuccess: useInv() }));

/** Remove uma anulação de chargeback. */
export const useIberdrolaChargebackOverrideRemove = () =>
  useMutation(orpc.iberdrola.chargebackOverrideRemove.mutationOptions({ onSuccess: useInv() }));

/** Lista de trocas de venda do mês. */
export const useIberdrolaOverrideList = (month: string) =>
  useQuery({ ...orpc.iberdrola.overrideList.queryOptions({ input: { month } }), enabled: /^\d{4}-\d{2}$/.test(month) });

/** Precos de cada venda pela tabela de origem e pela tabela de destino. */
export const useIberdrolaSwapQuote = (month: string, fromEmployeeId: number, toEmployeeId: number | null) =>
  useQuery({
    ...orpc.iberdrola.swapQuote.queryOptions({ input: { month, fromEmployeeId, toEmployeeId: toEmployeeId ?? 0 } }),
    enabled: /^\d{4}-\d{2}$/.test(month) && toEmployeeId != null && toEmployeeId > 0,
  });

/** Troca uma venda de um comercial para outro. */
export const useIberdrolaOverrideCreate = () =>
  useMutation(orpc.iberdrola.overrideCreate.mutationOptions({ onSuccess: useInv() }));

/** Desfaz uma troca de venda. */
export const useIberdrolaOverrideRemove = () =>
  useMutation(orpc.iberdrola.overrideRemove.mutationOptions({ onSuccess: useInv() }));

/** PDFs guardados na aba Autos (filtros + paginação de 20). */
export const useIberdrolaPdfList = (input: {
  employeeId?: number;
  leaderId?: number;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}) => useQuery({ ...orpc.iberdrola.pdfList.queryOptions({ input }), refetchOnMount: "always" });

/** Comerciais com PDFs guardados (filtro por vendedor). */
export const useIberdrolaPdfSellers = () => useQuery({ ...orpc.iberdrola.pdfSellers.queryOptions(), refetchOnMount: "always" });

/** Chefes de equipa com PDFs guardados (filtro por chefe). */
export const useIberdrolaPdfTeams = () => useQuery({ ...orpc.iberdrola.pdfTeams.queryOptions(), refetchOnMount: "always" });

/** Elimina um PDF guardado (só admin/diretor). */
export const useIberdrolaPdfRemove = () =>
  useMutation(orpc.iberdrola.pdfRemove.mutationOptions({ onSuccess: useInv() }));
