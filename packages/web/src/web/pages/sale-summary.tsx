import { useMemo } from "react";
import { ArrowLeft, Pencil } from "lucide-react";
import { useLocation, useParams } from "wouter";
import { useOrders } from "../queries/sales";
import { useMe } from "../queries/me";
import { PageHeader, Empty, TableSkeleton, Pill } from "../components/ui/kit";
import { SALE_STATUS } from "../lib/labels";
import { fmtDate } from "../lib/format";
import { getSaleForm, type Details } from "../../api/shared/client-forms";
import { SaleForm } from "../components/sale-form";
import { StatusHistory } from "../components/status-history";

type Order = NonNullable<ReturnType<typeof useOrders>["data"]>[number];

const MUTABLE_ROLES = new Set(["admin", "diretor", "backoffice"]);

function fmtValue(key: string, v: string | boolean | null): string {
  if (v == null || v === "") return "";
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (key === "signatureDate") return fmtDate(v);
  return String(v);
}

/** Resumo (só leitura) de todos os campos da venda, pela ordem do formulário. */
function ReadOnlySummary({ o }: { o: Order }) {
  const form = getSaleForm(o.service) ?? [];
  const d = (o.details ?? {}) as Details;
  const rows = form
    .map((f) => ({ key: f.key, label: f.label, value: fmtValue(f.key, d[f.key] ?? null) }))
    .filter((r) => r.value !== "");
  const statusColor = SALE_STATUS[o.status]?.color ?? "var(--ink-3)";

  return (
    <div className="grid gap-5">
      <div className="card p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Pill color={statusColor}>{o.status}</Pill>
          <span className="rounded-full border border-line px-2.5 py-[3px] text-[11.5px] font-medium text-ink-2">{[o.supplier, o.service].filter(Boolean).join(" · ") || "—"}</span>
          <span className="label-mono text-[11px] text-ink-3">{fmtDate(o.date)}</span>
        </div>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <div key={r.key} className="min-w-0">
              <dt className="label-mono mb-1 block text-[10.5px] text-ink-3">{r.label}</dt>
              <dd className="break-words text-[13.5px] text-ink">{r.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="card p-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="label-mono text-[11px] text-ink-3">Cliente</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-[13.5px]">
          <span className="font-medium text-ink">{o.clientName}</span>
          {o.clientNif && <span className="num text-ink-2">NIF {o.clientNif}</span>}
          {o.clientPhone && <span className="num text-ink-2">{o.clientPhone}</span>}
        </div>
        <div className="mt-2 text-[13px] text-ink-2">Vendedor: <span className="font-medium text-ink">{o.sellerName ?? "—"}</span></div>
      </div>

      <StatusHistory saleId={o.id} isAdmin={false} dual={o.service === "DUAL"} />
    </div>
  );
}

export default function SaleSummaryPage() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const id = Number(params?.id);
  const me = useMe();
  const orders = useOrders();

  const sale = useMemo(() => (orders.data ?? []).find((o) => o.id === id), [orders.data, id]);
  const mutable = MUTABLE_ROLES.has(me.data?.role ?? "");
  const isAdmin = me.data?.role === "admin";

  if (orders.isLoading || me.isLoading) {
    return <div><PageHeader eyebrow="Vendas" title="Resumo da venda" /><div className="card"><TableSkeleton cols={4} /></div></div>;
  }
  if (!sale) {
    return <div><PageHeader eyebrow="Vendas" title="Resumo da venda" /><div className="card"><Empty title="Venda não encontrada" text="Não tem acesso a esta venda ou ela já não existe." /></div></div>;
  }

  return (
    <div>
      <PageHeader eyebrow="Vendas" title={`Venda ${sale.number}`} subtitle={sale.clientName}>
        <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}><ArrowLeft size={15} /> Voltar</button>
      </PageHeader>

      {mutable ? (
        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-[13px] font-medium text-ink-2">Edição da venda <strong className="text-ink">{sale.number}</strong></span>
            {isAdmin && <Pill label="Administrador" tone="volt" />}
          </div>
          <SaleForm
            key={sale.id}
            initial={{
              id: sale.id,
              service: sale.service,
              details: sale.details ?? null,
              clientName: sale.clientName,
              clientNif: sale.clientNif ?? null,
              clientPhone: sale.clientPhone ?? null,
              sellerId: sale.sellerId ?? null,
              sellerName: sale.sellerName ?? null,
            }}
            onClose={() => navigate(-1)}
            isAdmin={isAdmin}
          />
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2 text-[12.5px] text-ink-3">
            <Pencil size={13} /> Só administradores, diretores e backoffice podem editar esta venda.
          </div>
          <ReadOnlySummary o={sale} />
        </>
      )}
    </div>
  );
}
