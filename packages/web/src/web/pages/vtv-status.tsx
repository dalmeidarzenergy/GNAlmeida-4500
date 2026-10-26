import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ShieldAlert, BellOff, BellRing } from "lucide-react";
import { Link } from "wouter";
import { useOrders, useToggleAlerts, useSetReady } from "../queries/sales";
import { useMe } from "../queries/me";
import { PageHeader, SearchBox, Empty, TableSkeleton, Tabs, Stat, Pill, Pagination } from "../components/ui/kit";
import { MonthYearFilter } from "../components/month-year-filter";
import { SALE_STATUS } from "../lib/labels";
import { errMsg, fmtDate, thisMonth } from "../lib/format";

type Order = NonNullable<ReturnType<typeof useOrders>["data"]>[number];

type VtvEntry = { energy: string; status: string };

const isKO = (s: string) => s.startsWith("KO-");
const isGrave = (s: string) => s.startsWith("KO-A") || s.startsWith("KO-B");
const isDone = (status: string) => status === "Control" || status === "Anulado";

function vtvEntries(o: Order): VtvEntry[] {
  const out: VtvEntry[] = [];
  const luz = o.details?.vtvStatus;
  if (typeof luz === "string" && luz) out.push({ energy: o.service === "DUAL" ? "Luz" : "VTV", status: luz });
  if (o.service === "DUAL") {
    const gas = o.details?.vtvStatusGas;
    if (typeof gas === "string" && gas) out.push({ energy: "Gás", status: gas });
  }
  return out;
}

const vtvColor = (s: string) =>
  isGrave(s) ? "var(--danger)" : isKO(s) ? "#fb7185" : s === "Pendente" ? "var(--amber)" : "var(--volt)";

type Tab = "pendentes" | "ko";

const PAGE_SIZE = 20;
const MUTABLE_ROLES = new Set(["admin", "diretor", "backoffice"]);

export default function VtvStatusPage() {
  const me = useMe();
  const orders = useOrders();
  const toggleAlerts = useToggleAlerts();
  const setReady = useSetReady();
  const [tab, setTab] = useState<Tab>("pendentes");
  const [q, setQ] = useState("");
  const [month, setMonth] = useState(thisMonth());
  const [page, setPage] = useState(1);

  const role = me.data?.role ?? "";
  const canMute = MUTABLE_ROLES.has(role);

  const relevant = useMemo(
    () =>
      (orders.data ?? [])
        .filter((o) => {
          const entries = vtvEntries(o);
          const grave = entries.some((e) => isGrave(e.status));
          const nonOk = entries.some((e) => e.status !== "OK");
          if (!nonOk) return false;
          // KO-A / KO-B aparecem sempre (mesmo Control/Anulado); os restantes só enquanto a venda não está Control/Anulado.
          if (grave) return true;
          return !isDone(o.status);
        })
        .map((o) => ({ o, entries: vtvEntries(o) })),
    [orders.data],
  );

  const pendentes = relevant.filter(({ entries }) => entries.some((e) => e.status === "Pendente") && !entries.some((e) => isKO(e.status)));
  const ko = relevant.filter(({ o, entries }) => entries.some((e) => isKO(e.status)) && (!month || o.date.startsWith(month)));
  // KO-A/KO-B (gravíssimos) só são assinalados no mês selecionado (por defeito, o mês atual).
  const graves = relevant.filter(({ o, entries }) => entries.some((e) => isGrave(e.status)) && (!month || o.date.startsWith(month)));

  const list = useMemo(() => {
    const src = tab === "pendentes" ? pendentes : ko;
    const s = q.toLowerCase();
    return src.filter(
      ({ o }) =>
        !s ||
        o.number.toLowerCase().includes(s) ||
        o.clientName.toLowerCase().includes(s) ||
        (o.sellerName ?? "").toLowerCase().includes(s) ||
        (o.details?.contractNumber as string | undefined)?.toLowerCase().includes(s),
    );
  }, [tab, pendentes, ko, q]);

  useEffect(() => setPage(1), [q, tab, month]);
  const paged = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (orders.error) {
    return (
      <div>
        <PageHeader eyebrow="Vendas" title="Estado VTV" />
        <div className="card"><Empty title="Sem acesso" text={errMsg(orders.error)} /></div>
      </div>
    );
  }

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
        title="Estado VTV"
        subtitle="Vendas cujo Estado VTV não está OK. Os estados KO-A e KO-B são gravíssimos, ficam assinalados a vermelho e não desaparecem mesmo após Control/Anulado — mas apenas no mês selecionado (por defeito, o mês atual)."
      >
        <SearchBox value={q} onChange={setQ} placeholder="Nº, contrato, cliente, vendedor…" />
      </PageHeader>

      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-3">
        <Stat delay={0} label="Estados Pendentes" value={pendentes.length} accent="var(--amber)" sub="a aguardar validação VTV" />
        <Stat delay={40} label="Estados KO" value={ko.length} accent="var(--danger)" sub="com indicação do motivo" />
        <Stat delay={80} label="Gravíssimos (KO-A / KO-B)" value={graves.length} accent="var(--danger)" sub="exigem intervenção imediata" />
      </div>

      {graves.length > 0 && (
        <div className="mb-5 flex items-center gap-3 rounded-[12px] border px-4 py-3" style={{ borderColor: "color-mix(in srgb, var(--danger) 45%, transparent)", background: "color-mix(in srgb, var(--danger) 10%, transparent)" }}>
          <AlertTriangle size={18} className="shrink-0 text-danger" />
          <span className="text-[13px] font-medium text-danger">
            Atenção: {graves.length} venda(s) com estado <strong>KO-A</strong> ou <strong>KO-B</strong> (gravíssimo). Tratar com prioridade máxima.
          </span>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={tab} onChange={setTab} items={[
          { key: "pendentes", label: "Estados Pendentes", count: pendentes.length },
          { key: "ko", label: "Estados KO", count: ko.length },
        ]} />
        {tab === "ko" && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[12px] text-ink-3">Mês</span>
            <MonthYearFilter value={month} onChange={setMonth} />
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        {orders.isLoading ? (
          <TableSkeleton cols={11} />
        ) : !list.length ? (
          <Empty title={tab === "pendentes" ? "Sem estados pendentes" : "Sem estados KO"} text={tab === "pendentes" ? "Nenhuma venda tem Estado VTV pendente." : "Nenhuma venda tem Estado VTV em KO."} />
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
                  <th>Estado da venda</th>
                  <th>Estado VTV</th>
                  <th>Motivo</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {paged.map(({ o, entries }) => {
                  const grave = entries.some((e) => isGrave(e.status));
                  const c = SALE_STATUS[o.status]?.color ?? "var(--ink-3)";
                  const muted = o.alertsDisabled;
                  const canToggleReady = canMute || (role === "vendedor" && me.data?.employeeId != null && me.data.employeeId === o.sellerId);
                  return (
                    <tr key={o.id} className={muted ? "opacity-60" : undefined} style={grave ? { background: "color-mix(in srgb, var(--danger) 10%, transparent)", boxShadow: "inset 3px 0 0 var(--danger)" } : undefined}>
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
                      <td>
                        <div className="flex flex-col gap-1">
                          {entries.map((e) => (
                            <span key={e.energy} className="flex items-center gap-1.5">
                              <span className="w-8 text-[10.5px] uppercase tracking-wide text-ink-3">{e.energy}</span>
                              <Pill color={vtvColor(e.status)}>{e.status}</Pill>
                              {isGrave(e.status) && <ShieldAlert size={14} className="text-danger" />}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="max-w-[260px] whitespace-normal">
                        {entries.some((e) => isKO(e.status)) ? (
                          <div className="text-[12.5px] text-ink-2">
                            {(typeof o.details?.koReason === "string" && (o.details.koReason as string).trim()) || "—"}
                          </div>
                        ) : (
                          <span className="text-[12.5px] text-ink-3">A aguardar validação</span>
                        )}
                      </td>
                      <td className="w-40 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          {headerBtn(o)}
                          <Link href={`/venda/${o.id}?from=/estado-vtv`} className="btn btn-ghost h-8 text-[12px]">Abrir</Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} total={list.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </div>
    </div>
  );
}
