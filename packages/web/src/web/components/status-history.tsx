import { useState } from "react";
import { History } from "lucide-react";
import { Pill } from "./ui/kit";
import { useSaleHistory, useSetHistoryDate } from "../queries/sales";
import { SALE_STATUS } from "../lib/labels";
import { errMsg, fmtDate } from "../lib/format";

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" });

/** Histórico de estados da venda, com a data de cada mudança. O admin pode corrigir as datas. */
export function StatusHistory({ saleId, isAdmin, dual }: { saleId: number; isAdmin: boolean; dual: boolean }) {
  const h = useSaleHistory(saleId);
  const setDate = useSetHistoryDate();
  const [error, setError] = useState<string | null>(null);
  const rows = h.data ?? [];
  return (
    <div className="mt-5 rounded-[12px] border border-line bg-bg p-4">
      <div className="mb-3 flex items-center gap-2 text-[13px] font-medium">
        <History size={14} className="text-ink-3" /> Histórico de estados
      </div>
      {h.isLoading ? (
        <div className="skeleton h-16 rounded-lg" />
      ) : !rows.length ? (
        <p className="text-[12.5px] text-ink-3">Ainda sem mudanças de estado registadas.</p>
      ) : (
        <ul className="grid gap-2">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
              {isAdmin ? (
                <input
                  type="date"
                  aria-label={`Data da mudança para ${r.status}`}
                  className="input h-8 w-40 text-[12.5px]"
                  defaultValue={r.changedOn}
                  max={today()}
                  onBlur={async (e) => {
                    const v = e.target.value;
                    if (!v || v === r.changedOn) return;
                    setError(null);
                    try {
                      await setDate.mutateAsync({ id: r.id, changedOn: v });
                      await h.refetch();
                    } catch (err) {
                      setError(errMsg(err));
                      e.target.value = r.changedOn;
                    }
                  }}
                />
              ) : (
                <span className="w-24 tabular-nums text-ink-2">{fmtDate(r.changedOn)}</span>
              )}
              {dual && <span className="label-mono w-8 text-ink-3">{r.energy === "gas" ? "Gás" : "Luz"}</span>}
              <Pill label={SALE_STATUS[r.status]?.label ?? r.status} color={SALE_STATUS[r.status]?.color ?? "var(--ink-2)"} />
              <span className="text-ink-3">{r.changedBy === "importado" ? "data estimada (registo anterior)" : (r.userName ?? "")}</span>
            </li>
          ))}
        </ul>
      )}
      {isAdmin && rows.length > 0 && <p className="mt-3 text-[11.5px] text-ink-3">Pode corrigir a data de cada mudança (sai do campo para gravar). Conta para a Evolução e para a média de contratação.</p>}
      {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
    </div>
  );
}
