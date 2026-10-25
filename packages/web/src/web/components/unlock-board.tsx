import { useState } from "react";
import { Lock, LockOpen } from "lucide-react";
import { usePaymentForecast } from "../queries/payments";
import { Empty } from "./ui/kit";
import { errMsg } from "../lib/format";

type Forecast = NonNullable<ReturnType<typeof usePaymentForecast>["data"]>;
type SellerRow = Forecast["unlock"]["sellers"][number];
type TeamRow = Forecast["unlock"]["teams"][number];

/** Barra de progresso das vendas face ao 1.º escalão. */
function Progress({ value, min }: { value: number; min: number }) {
  if (min <= 0) {
    return (
      <div className="flex items-center gap-2">
        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2" />
        <span className="num text-[11.5px] text-ink-3">{value} vendas</span>
      </div>
    );
  }
  const pct = Math.min(100, Math.round((value / min) * 100));
  const done = value >= min;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full ${done ? "bg-volt" : "bg-amber"}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="num text-[11.5px] text-ink-3">{value}/{min}</span>
    </div>
  );
}

/** Número de vendas que faltam, com destaque quando já está desbloqueado. */
function Missing({ faltam, desbloqueado, min }: { faltam: number; desbloqueado: boolean; min: number }) {
  // Tabela sem escalão a pagar (ex.: freelancer): não há objetivo a desbloquear.
  if (min <= 0) return <span className="text-[13px] text-ink-3">sem mínimo</span>;
  if (desbloqueado) return <span className="num text-[13px] font-semibold text-volt">desbloqueado</span>;
  return (
    <span className="num text-[13px] font-semibold text-amber">
      {faltam} {faltam === 1 ? "venda" : "vendas"}
    </span>
  );
}

/**
 * Quadro de desbloqueio de comissões: quantas vendas faltam para atingir o
 * mínimo do 1.º escalão da tabela comissional. Alterna entre comercial e equipa.
 */
export default function UnlockBoard({ month }: { month: string }) {
  const q = usePaymentForecast(month);
  const [mode, setMode] = useState<"comercial" | "equipa">("comercial");

  if (q.isLoading) return <div className="skeleton h-48 rounded-[14px]" />;
  if (q.isError) return <div className="card p-4"><Empty title="Não foi possível calcular" text={errMsg(q.error)} /></div>;

  const data = q.data;
  const sellers: SellerRow[] = data?.unlock.sellers ?? [];
  const teams: TeamRow[] = data?.unlock.teams ?? [];
  const rows = mode === "comercial" ? sellers : teams;

  const totalFaltam = rows.filter((r) => r.bandMin > 0 && !r.desbloqueado).length;

  return (
    <div className="card mb-4 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <div>
          <div className="label-mono">Desbloqueio de comissões</div>
          <p className="mt-0.5 text-[12px] text-ink-3">
            Vendas necessárias para atingir o 1.º escalão que paga comissão da tabela atribuída.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {totalFaltam > 0 && <span className="text-[12px] text-ink-3">{totalFaltam} por desbloquear</span>}
          <div className="flex rounded-[10px] border border-line p-0.5">
            {(["comercial", "equipa"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-[8px] px-3 py-1.5 text-[12px] font-medium transition ${mode === m ? "bg-volt text-[#0c0e0d]" : "text-ink-2 hover:text-ink"}`}
              >
                {m === "comercial" ? "Por comercial" : "Por equipa"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!rows.length ? (
        <div className="p-5">
          <Empty title="Sem vendas neste mês" text="Não há vendas registadas no CRM para este mês." />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-left text-ink-3">
                <th className="label-mono px-5 py-2 font-normal">{mode === "comercial" ? "Comercial" : "Equipa"}</th>
                <th className="label-mono px-3 py-2 font-normal">Tabela</th>
                <th className="label-mono px-3 py-2 font-normal">Em fornecimento</th>
                <th className="label-mono px-3 py-2 font-normal">Faltam</th>
                <th className="label-mono px-3 py-2 font-normal">Registadas</th>
                <th className="label-mono px-3 py-2 font-normal">Faltam</th>
                <th className="px-5 py-2"><span className="sr-only">Estado</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const key = "employeeId" in r ? `e${r.employeeId}` : `t${r.teamId}`;
                const label = "name" in r ? r.name : r.name;
                return (
                  <tr key={key} className="border-b border-line last:border-b-0 hover:bg-surface-2/50">
                    <td className="px-5 py-2.5">
                      <span className="font-medium">{label}</span>
                      {"isChief" in r && r.isChief && <span className="ml-2 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-3">chefe</span>}
                    </td>
                    <td className="px-3 py-2.5 text-ink-3">{r.tableName ?? "—"}</td>
                    <td className="px-3 py-2.5"><Progress value={r.fornecimento} min={r.bandMin} /></td>
                    <td className="px-3 py-2.5"><Missing faltam={r.faltamFornecimento} desbloqueado={r.desbloqueado} min={r.bandMin} /></td>
                    <td className="num px-3 py-2.5 text-ink-2">{r.registadas}</td>
                    <td className="px-3 py-2.5">
                      {r.bandMin <= 0
                        ? <span className="text-[13px] text-ink-3">—</span>
                        : r.faltamRegistadas === 0
                          ? <span className="num text-[13px] font-semibold text-volt">desbloqueado</span>
                          : <span className="num text-[13px] text-ink-2">{r.faltamRegistadas}</span>}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      {r.bandMin <= 0
                        ? <span className="text-ink-3">—</span>
                        : r.desbloqueado
                          ? <LockOpen size={14} className="inline text-volt" />
                          : <Lock size={14} className="inline text-amber" />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-line px-5 py-2.5 text-[11.5px] text-ink-3">
        <strong className="text-ink-2">Em fornecimento</strong> são as vendas BTN (Luz/Dual) que já entraram em fornecimento — é o que apura o escalão.{" "}
        <strong className="text-ink-2">Registadas</strong> são todas as vendas do mês, exceto as que estão em Baixa ou Anuladas.
      </p>
    </div>
  );
}
