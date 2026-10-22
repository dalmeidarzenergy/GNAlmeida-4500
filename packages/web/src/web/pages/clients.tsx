import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, FileSpreadsheet } from "lucide-react";
import { Link } from "wouter";
import { useClients, useRemoveClient, useRemoveClients, useSaveClient } from "../queries/sales";
import { ConfirmDeleteModal, RowBox, SelectAllBox, SelectionBar, useSelection } from "../components/bulk-select";
import { useEmployeeOptions } from "../queries/hr";
import { useMe } from "../queries/me";
import { PageHeader, Avatar, Modal, Field, SubmitRow, SearchBox, Empty, TableSkeleton, Tabs, ConfirmDelete, Pagination } from "../components/ui/kit";
import { errMsg, fmtDate } from "../lib/format";
import { clientTypeFromNif } from "../../api/shared/client-forms";
import { MonthYearFilter } from "../components/month-year-filter";
import { EmployeeFilter } from "../components/employee-filter";
import { TeamFilter, useTeamIds } from "../components/team-filter";

type Client = NonNullable<ReturnType<typeof useClients>["data"]>[number];

function ClientForm({ initial, onClose, isAdmin }: { initial: Client | null; onClose: () => void; isAdmin: boolean }) {
  const emps = useEmployeeOptions();
  const save = useSaveClient();
  const remove = useRemoveClient();
  const [f, setF] = useState({ name: initial?.name ?? "", phone: initial?.phone ?? "", nif: initial?.nif ?? "", ownerId: initial?.ownerId ?? (null as number | null) });
  const [error, setError] = useState<string | null>(null);
  const managers = (emps.data ?? []).filter((x) => x.status !== "inativo" || x.id === initial?.ownerId);
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      setError(null);
      if (!/^\d{9}$/.test(f.nif)) return setError("O NIF tem de ter 9 dígitos.");
      if (isAdmin && !f.ownerId) return setError("Atribua o gestor do cliente.");
      try {
        if (initial) await save.update.mutateAsync({ ...f, id: initial.id });
        else await save.create.mutateAsync(f);
        onClose();
      } catch (err) { setError(errMsg(err)); }
    }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome *" className="sm:col-span-2"><input aria-label="Nome" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
        <Field label="Telemóvel *"><input aria-label="Telemóvel" className="input num" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} required /></Field>
        <Field label="NIF *">
          <input aria-label="NIF" className="input num" inputMode="numeric" pattern="\d{9}" title="9 dígitos" value={f.nif} onChange={(e) => setF({ ...f, nif: e.target.value.replace(/\D/g, "").slice(0, 9) })} required />
          <p className="mt-1 text-[11px] text-ink-3">{f.nif.length === 9 ? (clientTypeFromNif(f.nif) === "empresa" ? "Empresa" : "Particular") : "9 dígitos"}</p>
        </Field>
        {isAdmin ? (
          <Field label="Gestor *" className="sm:col-span-2">
            <select aria-label="Gestor" className="input" value={f.ownerId ?? ""} required onChange={(e) => setF({ ...f, ownerId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Selecione o gestor…</option>
              {managers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
        ) : (
          <div className="text-[12.5px] text-ink-2 sm:col-span-2">
            <span className="label-mono mb-1 block">Gestor</span>
            {initial?.ownerName ?? "Atribuído automaticamente a si"}
          </div>
        )}
      </div>
      <SubmitRow pending={save.isPending} onCancel={onClose} error={error} extra={initial && isAdmin && <ConfirmDelete pending={remove.isPending} onConfirm={async () => { await remove.mutateAsync({ id: initial.id }); onClose(); }} />} />
    </form>
  );
}

const PAGE_SIZE = 20;

export default function ClientsPage() {
  const me = useMe();
  const clients = useClients();
  const isAdmin = me.data?.role === "admin";
  const write = me.data?.role === "admin" || me.data?.role === "rh";
  const [q, setQ] = useState("");
  const [type, setType] = useState<"todos" | "empresa" | "particular" | "meus">("todos");
  const [edit, setEdit] = useState<Client | null | "new">(null);
  const [month, setMonth] = useState("");
  const [emp, setEmp] = useState<number | null>(null);
  const [team, setTeam] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const teamIds = useTeamIds(team, month || undefined);
  const list = useMemo(() => {
    const s = q.toLowerCase();
    return (clients.data ?? [])
      .filter((c) => !month || (c.saleMonths ?? "").split(",").includes(month) || new Date(c.createdAt).toISOString().startsWith(month))
      .filter((c) => emp == null || c.ownerId === emp || (c.saleSellers ?? "").split(",").includes(String(emp)))
      .filter((c) => teamIds == null || (c.ownerId != null && teamIds.includes(c.ownerId)) || (c.saleSellers ?? "").split(",").some((x) => teamIds.includes(Number(x))))
      .filter((c) => (type === "todos" ? true : type === "meus" ? c.ownerId === me.data?.employeeId : clientTypeFromNif(c.nif) === type))
      .filter((c) => !s || c.name.toLowerCase().includes(s) || (c.nif ?? "").includes(s) || (c.phone ?? "").replace(/\s/g, "").includes(s.replace(/\s/g, "")));
  }, [clients.data, q, type, me.data, month, emp, teamIds]);
  useEffect(() => setPage(1), [q, type, month, emp, team]);
  const paged = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const listIds = useMemo(() => paged.map((c) => c.id), [paged]);
  const sel = useSelection(listIds);
  const removeMany = useRemoveClients();
  const [toDelete, setToDelete] = useState<Client[] | null>(null);
  const delSales = (toDelete ?? []).reduce((n, c) => n + Number(c.saleCount ?? 0), 0);
  const count = (t: "empresa" | "particular") => clients.data?.filter((c) => clientTypeFromNif(c.nif) === t).length;

  return (
    <div>
      <PageHeader eyebrow="Vendas" title="Clientes">
        {isAdmin && <Link href="/vendas/importar" className="btn"><FileSpreadsheet size={15} /> Importar Excel</Link>}
        {write && <button className="btn btn-primary" onClick={() => setEdit("new")}><Plus size={15} /> Novo cliente</button>}
      </PageHeader>
      <div className="rise mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={type} onChange={setType} items={[
          { key: "todos", label: "Todos", count: clients.data?.length },
          { key: "empresa", label: "Empresas", count: count("empresa") },
          { key: "particular", label: "Particulares", count: count("particular") },
          ...(me.data?.employeeId ? [{ key: "meus" as const, label: "Os meus" }] : []),
        ]} />
        <div className="ml-auto flex flex-wrap gap-2">
          {isAdmin && <TeamFilter value={team} onChange={setTeam} />}
          {isAdmin && <EmployeeFilter month={month} value={emp} onChange={setEmp} onlyIds={teamIds} />}
          <MonthYearFilter value={month} onChange={setMonth} allowAll />
          <SearchBox value={q} onChange={setQ} placeholder="Nome, NIF ou telemóvel…" />
        </div>
      </div>
      {isAdmin && <SelectionBar count={sel.selected.length} total={paged.length} noun={["cliente", "clientes"]} onClear={sel.clear} onDelete={() => setToDelete(paged.filter((c) => sel.has(c.id)))} />}
      <div className="card overflow-hidden">
        {clients.isLoading ? <TableSkeleton cols={6} /> : clients.isError ? <Empty title="Não foi possível carregar" text={errMsg(clients.error)} /> : !list.length ? (
          <Empty title="Sem clientes" action={write && <button className="btn btn-primary" onClick={() => setEdit("new")}><Plus size={15} /> Adicionar cliente</button>} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr>{isAdmin && <th className="w-10"><SelectAllBox label="Selecionar todos os clientes" checked={sel.all} indeterminate={sel.some} onChange={sel.toggleAll} /></th>}<th>Cliente</th><th>Telemóvel</th><th>NIF</th><th>Gestor</th><th className="text-right">Vendas</th><th>Última venda</th><th aria-label="Ações" /></tr></thead>
                <tbody>
                  {paged.map((c) => {
                    const t = clientTypeFromNif(c.nif);
                    return (
                      <tr key={c.id} className={`${write ? "cursor-pointer" : ""} ${sel.has(c.id) ? "bg-volt/5" : ""}`} onClick={() => write && setEdit(c)}>
                        {isAdmin && <td className="w-10"><RowBox label={`Selecionar ${c.name}`} checked={sel.has(c.id)} onChange={() => sel.toggle(c.id)} /></td>}
                        <td>
                          <div className="flex items-center gap-3">
                            <Avatar name={c.name} color={t === "empresa" ? "var(--sky)" : "var(--rose)"} />
                            <div>
                              <div className="font-medium">{c.name}</div>
                              <div className="text-[11.5px] text-ink-3">{t === "empresa" ? "Empresa" : "Particular"}</div>
                            </div>
                          </div>
                        </td>
                        <td className="num text-[12.5px] text-ink-2">{c.phone ?? "—"}</td>
                        <td className="num text-[12.5px] text-ink-2">{c.nif ?? "—"}</td>
                        <td className="text-ink-2">{c.ownerName ?? "—"}</td>
                        <td className="num text-right">{c.saleCount}{Number(c.activeCount) > 0 && <span className="ml-1 text-[11px] text-volt">({c.activeCount} ativ.)</span>}</td>
                        <td className="num text-[12.5px] text-ink-2">{fmtDate(c.lastSale)}</td>
                        <td className="w-20 whitespace-nowrap">
                          <span className="btn-icon"><Pencil size={14} /></span>
                          {isAdmin && (
                            <button aria-label={`Eliminar ${c.name}`} className="btn-icon hover:!text-danger" onClick={(e) => { e.stopPropagation(); setToDelete([c]); }}>
                              <Trash2 size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} total={list.length} pageSize={PAGE_SIZE} onChange={setPage} />
          </>
        )}
      </div>
      <ConfirmDeleteModal
        open={toDelete !== null}
        title={toDelete?.length === 1 ? `Eliminar ${toDelete[0].name}?` : `Eliminar ${toDelete?.length ?? 0} clientes?`}
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          await removeMany.mutateAsync({ ids: (toDelete ?? []).map((c) => c.id) });
          sel.clear();
        }}
      >
        {toDelete?.length === 1 ? <>O cliente <strong className="text-ink">{toDelete[0].name}</strong> vai ser eliminado.</> : <>Os <strong className="text-ink">{toDelete?.length}</strong> clientes selecionados vão ser eliminados.</>}
        {delSales > 0 ? (
          <p className="mt-2 rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-[12.5px] text-ink">
            Atenção: {delSales === 1 ? "a venda associada também é eliminada" : `as ${delSales} vendas associadas também são eliminadas`}.
          </p>
        ) : (
          <p className="mt-2 text-[12.5px]">Não há vendas associadas.</p>
        )}
      </ConfirmDeleteModal>
      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit === "new" ? "Novo cliente" : "Editar cliente"}>
        {edit !== null && write && <ClientForm initial={edit === "new" ? null : edit} onClose={() => setEdit(null)} isAdmin={isAdmin} />}
      </Modal>
    </div>
  );
}