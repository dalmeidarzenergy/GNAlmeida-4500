import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, FileSpreadsheet } from "lucide-react";
import { Link } from "wouter";
import { useOrders, useRemoveOrders, useSetOrderStatus } from "../queries/sales";
import { ConfirmDeleteModal, RowBox, SelectAllBox, SelectionBar, useSelection } from "../components/bulk-select";
import { useMe } from "../queries/me";
import { PageHeader, Modal, SearchBox, Empty, TableSkeleton, Tabs, Stat, Pagination } from "../components/ui/kit";
import { SALE_STATUS } from "../lib/labels";
import { errMsg, fmtDate } from "../lib/format";
import { SALE_STATUS as STATUS_LIST } from "../../api/shared/client-forms";
import { SaleForm } from "../components/sale-form";
import { MonthYearFilter } from "../components/month-year-filter";
import { EmployeeFilter } from "../components/employee-filter";
import { TeamFilter, useTeamIds, useTeamMatcher } from "../components/team-filter";
import { ServiceFilter } from "../components/service-filter";
import { SERVICE_LABELS } from "../../api/shared/client-forms";

type Order = NonNullable<ReturnType<typeof useOrders>["data"]>[number];

/** Agrupamento dos estados da venda para os separadores e indicadores. */
const GROUPS = {
  curso: ["Prospeção", "Pré-Venda", "Control", "Backoffice", "Pedido de Fornecimento"],
  fornecimento: ["Em Fornecimento"],
  baixa: ["Pedido de Baixa", "Baixa"],
  anulado: ["Anulado"],
} as const;
type Group = keyof typeof GROUPS;
const inGroup = (g: Group, status: string) => (GROUPS[g] as readonly string[]).includes(status);

const statusColor = (s: string) => SALE_STATUS[s]?.color ?? "var(--ink-3)";

const gasStatus = (o: Order) => {
  const v = o.details?.saleStatusGas;
  return typeof v === "string" && v ? v : "Prospeção";
};

function StatusSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string }) {
  const c = statusColor(value);
  return (
    <div className="flex items-center gap-1.5">
      {label && <span className="w-7 text-[10.5px] uppercase tracking-wide text-ink-3">{label}</span>}
      <select
        aria-label={label ? `Estado da venda ${label}` : "Estado da venda"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="cursor-pointer appearance-none rounded-full border bg-transparent px-2.5 py-[3px] text-[11.5px] font-medium outline-none"
        style={{ color: c, borderColor: `color-mix(in srgb, ${c} 30%, transparent)`, background: `color-mix(in srgb, ${c} 9%, transparent)` }}
      >
        {!STATUS_LIST.includes(value) && <option value={value} className="bg-surface text-ink">{value}</option>}
        {STATUS_LIST.map((s) => <option key={s} value={s} className="bg-surface text-ink">{s}</option>)}
      </select>
    </div>
  );
}

const PAGE_SIZE = 20;

export default function SalesPage() {
  const me = useMe();
  const orders = useOrders();
  const ordersError: unknown = orders.error;
  const setStatus = useSetOrderStatus();
  const isAdmin = me.data?.role === "admin";
  const write = me.data?.role === "admin" || me.data?.role === "rh";
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"todas" | Group>("todas");
  const [month, setMonth] = useState("");
  const [seller, setSeller] = useState<number | null>(null);
  const [team, setTeam] = useState<number | null>(null);
  const teamIds = useTeamIds(team, month || undefined);
  const inTeam = useTeamMatcher(team);
  const [services, setServices] = useState<string[]>(SERVICE_LABELS);
  const [edit, setEdit] = useState<Order | null | "new">(null);
  const [page, setPage] = useState(1);

  const scoped = useMemo(
    () => (orders.data ?? []).filter((o) => (!month || o.date.startsWith(month)) && (seller == null || o.sellerId === seller) && (inTeam == null || inTeam(o.sellerId, o.date)) && services.includes(o.service ?? "")),
    [orders.data, month, seller, services, inTeam],
  );
  const list = useMemo(() => {
    const s = q.toLowerCase();
    return scoped.filter(
      (o) =>
        (tab === "todas" || inGroup(tab, o.status)) &&
        (!s || o.number.toLowerCase().includes(s) || o.clientName.toLowerCase().includes(s) || (o.sellerName ?? "").toLowerCase().includes(s) || (o.clientNif ?? "").includes(s) || (o.service ?? "").toLowerCase().includes(s)),
    );
  }, [scoped, q, tab]);
  useEffect(() => setPage(1), [q, tab, month, seller, team, services]);
  const paged = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const cnt = (g: "todas" | Group) => scoped.filter((o) => g === "todas" || inGroup(g, o.status)).length;
  const listIds = useMemo(() => paged.map((o) => o.id), [paged]);
  const sel = useSelection(listIds);
  const removeMany = useRemoveOrders();
  const [toDelete, setToDelete] = useState<Order[] | null>(null);

  if (orders.error) {
    return (
      <div>
        <PageHeader eyebrow="Vendas" title="Vendas" />
        <div className="card"><Empty title="Sem acesso" text={errMsg(orders.error)} /></div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader eyebrow="Vendas" title="Vendas">
        {isAdmin && <Link href="/vendas/importar" className="btn"><FileSpreadsheet size={15} /> Importar Excel</Link>}
        {write && <button className="btn btn-primary" onClick={() => setEdit("new")}><Plus size={15} /> Nova venda</button>}
      </PageHeader>

      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat delay={0} label="Em Fornecimento" value={cnt("fornecimento")} accent="var(--volt)" sub="vendas ativas" />
        <Stat delay={40} label="Em curso" value={cnt("curso")} accent="var(--sky)" sub="prospeção até pedido de fornecimento" />
        <Stat delay={80} label="Baixas" value={cnt("baixa")} accent="var(--amber)" sub="pedido de baixa e baixa" />
        <Stat delay={120} label="Anuladas" value={cnt("anulado")} accent="var(--danger)" sub="vendas anuladas" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={tab} onChange={setTab} items={[
          { key: "todas", label: "Todas", count: cnt("todas") },
          { key: "curso", label: "Em curso", count: cnt("curso") },
          { key: "fornecimento", label: "Em Fornecimento", count: cnt("fornecimento") },
          { key: "baixa", label: "Baixas", count: cnt("baixa") },
          { key: "anulado", label: "Anuladas", count: cnt("anulado") },
        ]} />
        <div className="ml-auto flex flex-wrap gap-2">
          <ServiceFilter value={services} onChange={setServices} />
          {isAdmin && <TeamFilter value={team} onChange={setTeam} />}
          {isAdmin && <EmployeeFilter month={month} value={seller} onChange={setSeller} onlyIds={teamIds} />}
          <MonthYearFilter value={month} onChange={setMonth} allowAll />
          <SearchBox value={q} onChange={setQ} placeholder="Nº, cliente, NIF, vendedor…" />
        </div>
      </div>

      {isAdmin && <SelectionBar count={sel.selected.length} total={paged.length} noun={["venda", "vendas"]} onClear={sel.clear} onDelete={() => setToDelete(list.filter((o) => sel.has(o.id)))} />}
      <div className="card overflow-hidden">
        {orders.isLoading ? <TableSkeleton cols={6} /> : orders.isError ? <Empty title="Não foi possível carregar" text={errMsg(ordersError)} /> : !list.length ? (
          <Empty title="Sem vendas" text="Nenhuma venda corresponde aos filtros." action={write && <button className="btn btn-primary" onClick={() => setEdit("new")}><Plus size={15} /> Nova venda</button>} />
        ) : (
          <>
            <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr>{isAdmin && <th className="w-10"><SelectAllBox label="Selecionar todas as vendas" checked={sel.all} indeterminate={sel.some} onChange={sel.toggleAll} /></th>}<th>Nº</th><th>Data</th><th>Cliente</th><th>Serviço</th><th>Vendedor</th><th>Estado da venda</th><th aria-label="Ações" /></tr></thead>
              <tbody>
                {paged.map((o) => (
                  <tr key={o.id} className={sel.has(o.id) ? "bg-volt/5" : undefined}>
                    {isAdmin && <td className="w-10"><RowBox label={`Selecionar ${o.number}`} checked={sel.has(o.id)} onChange={() => sel.toggle(o.id)} /></td>}
                    <td className="num text-[12.5px] text-ink-2">{o.number}</td>
                    <td className="num whitespace-nowrap text-[12.5px]">{fmtDate(o.date)}</td>
                    <td><div className="font-medium">{o.clientName}</div>{o.clientNif && <div className="num text-[11px] text-ink-3">{o.clientNif}</div>}</td>
                    <td className="text-[12.5px] text-ink-2">{[o.supplier, o.service].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="text-ink-2">{o.sellerName ?? "—"}</td>
                    <td>
                      {o.service === "DUAL" ? (
                        <div className="flex flex-col gap-1">
                          <StatusSelect label="Luz" value={o.status} onChange={(v) => setStatus.mutate({ id: o.id, status: v })} />
                          <StatusSelect label="Gás" value={gasStatus(o)} onChange={(v) => setStatus.mutate({ id: o.id, status: v, energy: "gas" })} />
                        </div>
                      ) : (
                        <StatusSelect value={o.status} onChange={(v) => setStatus.mutate({ id: o.id, status: v })} />
                      )}
                    </td>
                    <td className="w-20 whitespace-nowrap">
                      {write && <button aria-label="Editar venda" className="btn-icon" onClick={() => setEdit(o)}><Pencil size={14} /></button>}
                      {isAdmin && <button aria-label={`Eliminar ${o.number}`} className="btn-icon hover:!text-danger" onClick={() => setToDelete([o])}><Trash2 size={14} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
            <Pagination page={page} total={list.length} pageSize={PAGE_SIZE} onChange={setPage} />
          </>
        )}
      </div>

      <ConfirmDeleteModal
        open={toDelete !== null}
        title={toDelete?.length === 1 ? `Eliminar a venda ${toDelete[0].number}?` : `Eliminar ${toDelete?.length ?? 0} vendas?`}
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          const ids = (toDelete ?? []).map((o) => o.id);
          await removeMany.mutateAsync({ ids });
          sel.clear();
        }}
      >
        {toDelete?.length === 1 ? (
          <>A venda <strong className="text-ink">{toDelete[0].number}</strong> de <strong className="text-ink">{toDelete[0].clientName}</strong> e o seu histórico de estados vão ser eliminados. O cliente mantém-se.</>
        ) : (
          <>As <strong className="text-ink">{toDelete?.length}</strong> vendas selecionadas e o seu histórico de estados vão ser eliminados. Os clientes mantêm-se.</>
        )}
      </ConfirmDeleteModal>

      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit === "new" ? "Nova venda" : `Venda ${edit?.number ?? ""}`}>
        {edit !== null && write && <SaleForm key={edit === "new" ? "new" : edit.id} initial={edit === "new" ? null : edit} onClose={() => setEdit(null)} isAdmin={isAdmin} />}
      </Modal>
    </div>
  );
}
