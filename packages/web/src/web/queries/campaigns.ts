import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

export const useCampaigns = () => useQuery(orpc.campaigns.list.queryOptions());

export function useSaveCampaign() {
  const qc = useQueryClient();
  const onSuccess = () => {
    qc.invalidateQueries({ queryKey: orpc.campaigns.key() });
    qc.invalidateQueries({ queryKey: orpc.sales.key() });
  };
  const c = useMutation(orpc.campaigns.create.mutationOptions({ onSuccess }));
  const u = useMutation(orpc.campaigns.update.mutationOptions({ onSuccess }));
  const r = useMutation(orpc.campaigns.remove.mutationOptions({ onSuccess }));
  return { create: c, update: u, remove: r, isPending: c.isPending || u.isPending };
}

type Campaign = NonNullable<ReturnType<typeof useCampaigns>["data"]>[number];
export type CampaignState = "ativa" | "agendada" | "terminada";

/** Estado da campanha a partir do interruptor "ativa" e do período. */
export function campaignState(c: Pick<Campaign, "active" | "startDate" | "endDate">, today = new Date().toISOString().slice(0, 10)): CampaignState {
  if (!c.active) return "terminada";
  if (c.endDate && c.endDate < today) return "terminada";
  if (c.startDate && c.startDate > today) return "agendada";
  return "ativa";
}

/** A campanha aplica-se ao serviço/tipo de cliente da venda? */
export const campaignFits = (c: Pick<Campaign, "service">, service: string | null) => !c.service || !service || c.service === service;
