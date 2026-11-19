import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

/**
 * Modelo + dados da assinatura do utilizador. Sem nada gravado, o servidor
 * devolve os valores por omissao (campos vazios).
 */
export const useAssinatura = () => useQuery(orpc.assinaturas.get.queryOptions());

/** Galeria de logos: os que vem com a app e os carregados aqui. */
export const useAssinaturaLogos = () => useQuery(orpc.assinaturas.logos.queryOptions());

/** A biblioteca de logos muda com o upload e com o remover. */
function useInvalidarLogos() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: orpc.assinaturas.logos.key() });
}

export function useLogoUpload() {
  const inv = useInvalidarLogos();
  return useMutation(orpc.assinaturas.logoUpload.mutationOptions({ onSuccess: inv }));
}

export function useLogoRemove() {
  const inv = useInvalidarLogos();
  return useMutation(orpc.assinaturas.logoRemove.mutationOptions({ onSuccess: inv }));
}

/** Grava modelo e dados. A resposta e so { ok }, por isso a cache do `get`
 *  tem de ser invalidada para a pagina recarregar o que ficou gravado. */
export function useAssinaturaSave() {
  const qc = useQueryClient();
  return useMutation(
    orpc.assinaturas.save.mutationOptions({
      onSuccess: () => qc.invalidateQueries({ queryKey: orpc.assinaturas.key() }),
    }),
  );
}
