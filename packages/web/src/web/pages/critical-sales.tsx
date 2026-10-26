import { useEffect, useMemo, useState } from "react";
import { Timer, AlertTriangle, BellOff, BellRing } from "lucide-react";
import { Link } from "wouter";
import { useOrders, useToggleAlerts, useSetReady } from "../queries/sales";
import { useMe } from "../queries/me";
import { PageHeader, SearchBox, Empty, TableSkeleton, Tabs, Stat, Pill } from "../components/ui/kit";
import { MonthYearFilter } from "../components/month-year-filter";
import { SALE_STATUS } from "../lib/labels";
import { errMsg, fmtDate, thisMonth } from "../lib/format";

type Order = NonNullable<ReturnType<typeof useOrders>["data"]>[number];

/** A venda tem de chegar ao estado Control em até 3 dias após a assinatura. */
const DEADLINE_DAYS = 3;
const PENALTY = 10; // € por venda (número), 1x mesmo em DUAL

/** Estados antes do Control — a venda ainda está "por tratar". */
const PRE_CONTROL = ["Prospeção", "Pré-Venda", "Backoffice"] as const;
const isPreControl = (status: string) => (PRE_CONTROL as readonly string[]).includes(status);

const DAY = 86400000;
const deadineAt = (date: string) => new Date(`${date}T00:00:00`).getTime() + DEADLINE_DAYS * DAY;
const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / DAY);

function fmtDuration(ms: number) {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
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

const MUTABLE_ROLES = new Set(["admin", "diretor", "backoffice"]);

export default function CriticalSalesPage() {
  const me = useMe();
  const orders = useOrders();
  const toggleAlerts = useToggleAlerts();
  const setReady = useSetReady();
  const now = useNow();
  const [tab, setTab] = useState<Tab>("tratar");
  const [q, setQ] = useState("");
  const [month, setMonth] = useState(thisMonth());

  const role = me.data?.role ?? "";
  const canMute = MUTABLE_ROLES.has(role);
  const privileged = MUTABLE_ROLES.has(role);

  const all = orders.data ?? [];

  // Vendas por tratar: ainda nos estados pré-Control (desaparecem ao chegar a Control ou Anulado).
  const pending = useMemo(
    () => all.filter((o) => isPreControl(o.status)),
    [all],
  );

  // Vendas críticas: já passaram os 3 dias de contratação (seja ainda em curso, seja já Control).
  // Filtradas pelo mês selecionado (por defeito o mês atual); "Por Tratar" mostra todas.
  const critical = useMemo(
    () =>
      all.filter((o) => {
        if (month && !o.date.startsWith(month)) return false;
        if (o.status === "Anulado") return false;
        if (o.ctrlOn) return daysBetween(o.date, o.ctrlOn) > DEADLINE_DAYS;
        return deadineAt(o.date) <= now;
      }),
    [all, now, month],
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

  const urgent = pending.filter((o) => deadineAt(o.date) - now < 12 * 3600000 && deadineAt(o.date) > now).length;

  const timerCell = (o: Order) => {
    if (tab === "criticas" && o.ctrlOn) {
      // Já chegou a Control: mostra quanto tempo demorou até lá.
      const d = daysBetween(o.date, o.ctrlOn);
      return (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium text-ink-2">
          <Timer size={14} /> Control em {d}d
        </span>
      );
    }
    const remaining = deadineAt(o.date) - now;
    if (remaining > 0) {
      const less12 = remaining < 12 * 3600000;
      return (
        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap font-medium ${less12 ? "text-amber" : "text-ink-2"}`}>
          <Timer size={14} className={less12 ? "text-amber" : ""} /> falta {fmtDuration(remaining)}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium text-danger">
        <AlertTriangle size={14} /> {fmtDuration(-remaining)} em atraso
      </span>
    );
  };

  const headerBtn = (o: Order) =>
    canMute ? (
      <button
        type="button"
        className={o.alertsDisabled ? "btn btn-ghost h-8 text-[12px] hover:!text-danger" : "btn btn-ghost h-8 text-[12px]"}
        title={o.alertsDisabled ? "Alertas desligados — clicar para reativar" : "Alertas ativos — clicar para desligar"}
        onClick={() => toggleAlerts.mutate({ id: o.id, disabled: !o.alertsDisabled })}
      >
        {o.alertsDisabled ? <BellOff size={14} /> : <BellRing size={14} />}
        {o.alertsDisabled ? "Alertas off" : "Alertas on"}
      </button>
    ) : null;

  return (
    <div>
      <PageHeader
        eyebrow="Vendas"
        title="Vendas Críticas"
        subtitle={`A contratação tem de chegar ao estado Control em até ${DEADLINE_DAYS} dias após a assinatura. Fora do prazo aplica-se uma penalidade de ${PENALTY}€ por venda.`}
      >
        <SearchBox value={q} onChange={setQ} placeholder="Nº, contrato, cliente, vendedor…" />
      </PageHeader>

      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-3">
        <Stat delay={0} label="Por tratar" value={pending.length} accent="var(--sky)" sub="ainda antes do Control" />
        <Stat delay={40} label="Críticas (fora de prazo)" value={critical.length} accent="var(--danger)" sub={`penalidade de ${PENALTY}€ cada`} />
        <Stat delay={80} label="Urgentes (< 12h)" value={urgent} accent="var(--amber)" sub="a acabar o prazo" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={tab} onChange={setTab} items={[
          { key: "tratar", label: "Vendas por Tratar", count: pending.length },
          { key: "criticas", label: "Vendas Críticas", count: critical.length },
        ]} />
        {tab === "criticas" && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[12px] text-ink-3">Mês</span>
            <MonthYearFilter value={month} onChange={setMonth} />
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        {orders.isLoading ? (
          <TableSkeleton cols={8} />
        ) : !list.length ? (
          <Empty title={tab === "tratar" ? "Sem vendas por tratar" : "Sem vendas críticas"} text={tab === "tratar" ? "Nenhuma venda está nos estados pré-Control (Prospeção, Pré-Venda, Backoffice)." : "Nenhuma venda ultrapassou os 3 dias de contratação."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="w-10" aria-label="Pronta a tratar" />
                  <th>Nº</th>
                  <th>Nº Contrato</th>
                  <th>Data</th>
                  <th>Cliente</th>
                  <th>Serviço</th>
                  <th>Vendedor</th>
                  <th>Estado</th>
                  <th>Observações</th>
                  <th>{tab === "tratar" ? "Prazo" : "Cronómetro"}</th>
                  <th>Penalidade</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {list.map((o) => {
                  const c = SALE_STATUS[o.status]?.color ?? "var(--ink-3)";
                  const penalized = tab === "criticas";
                  const muted = o.alertsDisabled;
                  const canToggleReady = privileged || (role === "vendedor" && me.data?.employeeId != null && me.data.employeeId === o.sellerId);
                  return (
                    <tr key={o.id} className={muted ? "opacity-60" : undefined}>
                      <td className="w-10">
                        <input
                          type="checkbox"
                          aria-label={`Marcar ${o.number} pronta a tratar`}
                          title={canToggleReady ? (o.ready ? "Venda marcada como tratável agora" : "Marcar venda como tratável agora (notifica administração)") : "Só o comercial desta venda a pode marcar"}
                          checked={o.ready}
                          disabled={!canToggleReady}
                          onChange={() => setReady.mutate({ id: o.id, ready: !o.ready })}
                          className="h-[18px] w-[18px] cursor-pointer accent-volt disabled:cursor-default disabled:opacity-40"
                        />
                      </td>
                      <td className="num text-[12.5px] text-ink-2">{o.number}</td>
                      <td className="num text-[12.5px] text-ink-2">{(o.details?.contractNumber as string) || "—"}</td>
                      <td className="num whitespace-nowrap text-[12.5px]">{fmtDate(o.date)}</td>
                      <td><div className="font-medium">{o.clientName}</div>{o.clientNif && <div className="num text-[11px] text-ink-3">{o.clientNif}</div>}</td>
                      <td className="text-[12.5px] text-ink-2">{o.service ?? "—"}</td>
                      <td className="text-ink-2">{o.sellerName ?? "—"}</td>
                      <td><Pill color={c}>{o.status}</Pill></td>
                      <td className="max-w-[240px] whitespace-normal text-[12.5px] text-ink-2">
                        {typeof o.details?.notes === "string" && (o.details.notes as string).trim() ? (o.details.notes as string) : <span className="text-ink-3">—</span>}
                      </td>
                      <td>{timerCell(o)}</td>
                      <td>{penalized ? <Pill tone="red" label={`−${PENALTY}€`} /> : <span className="text-ink-3">—</span>}</td>
                      <td className="w-40 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          {headerBtn(o)}
                          <Link href={`/venda/${o.id}`} className="btn btn-ghost h-8 text-[12px]">Abrir</Link>
                        </div>
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
