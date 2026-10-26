import { useEffect, useMemo, useState } from "react";
import { Timer, AlertTriangle } from "lucide-react";
import { Link } from "wouter";
import { useOrders } from "../queries/sales";
import { PageHeader, SearchBox, Empty, TableSkeleton, Tabs, Stat, Pill } from "../components/ui/kit";
import { SALE_STATUS } from "../lib/labels";
import { errMsg, fmtDate } from "../lib/format";

type Order = NonNullable<ReturnType<typeof useOrders>["data"]>[number];

/** A venda tem de chegar ao estado Control em até 3 dias após a data da venda. */
const DEADLINE_DAYS = 3;
const PENALTY = 10; // €

/** Estados anteriores ao Control (a venda ainda está "por tratar"). */
const PRE_CONTROL = ["Prospeção", "Pré-Venda"] as const;
const isPreControl = (status: string) => (PRE_CONTROL as readonly string[]).includes(status);

const deadlineOf = (date: string) => new Date(`${date}T00:00:00`).getTime() + DEADLINE_DAYS * 86400000;

function fmtDuration(ms: number) {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

type Tab = "tratar" | "criticas";

export default function CriticalSalesPage() {
  const orders = useOrders();
  const now = useNow();
  const [tab, setTab] = useState<Tab>("tratar");
  const [q, setQ] = useState("");

  const pending = useMemo(
    () =>
      (orders.data ?? []).filter(
        (o) => isPreControl(o.status) && deadlineOf(o.date) > now,
      ),
    [orders.data, now],
  );
  const critical = useMemo(
    () => (orders.data ?? []).filter((o) => isPreControl(o.status) && deadlineOf(o.date) <= now),
    [orders.data, now],
  );

  const list = useMemo(() => {
    const src = tab === "tratar" ? pending : critical;
    const s = q.toLowerCase();
    return src.filter(
      (o) =>
        !s ||
        o.number.toLowerCase().includes(s) ||
        o.clientName.toLowerCase().includes(s) ||
        (o.sellerName ?? "").toLowerCase().includes(s) ||
        (o.details?.contractNumber as string | undefined)?.toLowerCase().includes(s),
    );
  }, [tab, pending, critical, q]);

  if (orders.error) {
    return (
      <div>
        <PageHeader eyebrow="Vendas" title="Vendas Críticas" />
        <div className="card"><Empty title="Sem acesso" text={errMsg(orders.error)} /></div>
      </div>
    );
  }

  const urgent = pending.filter((o) => deadlineOf(o.date) - now < 12 * 3600000).length;

  return (
    <div>
      <PageHeader
        eyebrow="Vendas"
        title="Vendas Críticas"
        subtitle={`A venda tem de chegar ao estado Control em até ${DEADLINE_DAYS} dias após a data da venda. Depois disso aplica-se uma penalidade de ${PENALTY}€.`}
      >
        <SearchBox value={q} onChange={setQ} placeholder="Nº, contrato, cliente, vendedor…" />
      </PageHeader>

      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-3">
        <Stat delay={0} label="Por tratar" value={pending.length} accent="var(--sky)" sub="dentro do prazo de contratação" />
        <Stat delay={40} label="Críticas (fora de prazo)" value={critical.length} accent="var(--danger)" sub={`penalidade de ${PENALTY}€ cada`} />
        <Stat delay={80} label="Urgentes (< 12h)" value={urgent} accent="var(--amber)" sub="a acabar o prazo" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={tab} onChange={setTab} items={[
          { key: "tratar", label: "Vendas por Tratar", count: pending.length },
          { key: "criticas", label: "Vendas Críticas", count: critical.length },
        ]} />
      </div>

      <div className="card overflow-hidden">
        {orders.isLoading ? (
          <TableSkeleton cols={7} />
        ) : !list.length ? (
          <Empty title={tab === "tratar" ? "Sem vendas por tratar" : "Sem vendas críticas"} text={tab === "tratar" ? "Nenhuma venda está dentro do prazo de contratação sem chegar ao Control." : "Nenhuma venda ultrapassou os 3 dias de contratação."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Nº</th>
                  <th>Nº Contrato</th>
                  <th>Data</th>
                  <th>Cliente</th>
                  <th>Serviço</th>
                  <th>Vendedor</th>
                  <th>Estado</th>
                  <th>{tab === "tratar" ? "Tempo restante" : "Em atraso"}</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {list.map((o) => {
                  const remaining = deadlineOf(o.date) - now;
                  const overdue = now - deadlineOf(o.date);
                  const less12 = remaining < 12 * 3600000;
                  const c = SALE_STATUS[o.status]?.color ?? "var(--ink-3)";
                  return (
                    <tr key={o.id}>
                      <td className="num text-[12.5px] text-ink-2">{o.number}</td>
                      <td className="num text-[12.5px] text-ink-2">{(o.details?.contractNumber as string) || "—"}</td>
                      <td className="num whitespace-nowrap text-[12.5px]">{fmtDate(o.date)}</td>
                      <td><div className="font-medium">{o.clientName}</div>{o.clientNif && <div className="num text-[11px] text-ink-3">{o.clientNif}</div>}</td>
                      <td className="text-[12.5px] text-ink-2">{o.service ?? "—"}</td>
                      <td className="text-ink-2">{o.sellerName ?? "—"}</td>
                      <td><Pill color={c}>{o.status}</Pill></td>
                      <td>
                        {tab === "tratar" ? (
                          <span className={`inline-flex items-center gap-1.5 whitespace-nowrap font-medium ${less12 ? "text-amber" : "text-ink-2"}`}>
                            <Timer size={14} className={less12 ? "text-amber" : ""} />
                            {fmtDuration(remaining)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium text-danger">
                            <AlertTriangle size={14} />
                            {fmtDuration(overdue)}
                          </span>
                        )}
                      </td>
                      <td className="w-24 whitespace-nowrap">
                        {tab === "criticas" && (
                          <Pill tone="red" label={`−${PENALTY}€`} />
                        )}
                        <Link href={`/vendas`} className="btn btn-ghost h-8 text-[12px]">Abrir venda</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
