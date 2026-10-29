import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Plug, Zap, Flame, Trash2 } from "lucide-react";
import { useCustomSuppliers } from "../queries/suppliers";
import { orpc, client } from "../lib/api";
import { useMe } from "../queries/me";
import { PageHeader, Modal, Field, SubmitRow, SearchBox, Empty, TableSkeleton, Tabs, Stat, Pagination } from "../components/ui/kit";
import { ConfirmDeleteModal } from "../components/bulk-select";
import { errMsg } from "../lib/format";
import { OLD_SUPPLIERS, OLD_GAS_SUPPLIERS, SUPPLIER_SCOPE_LABELS } from "../../api/shared/suppliers";

type Custom = NonNullable<ReturnType<typeof useCustomSuppliers>["data"]>[number];
/** Verdadeiro nas linhas que vem das listas de origem (nao da base de dados). */
const isOrigin = (r: Custom) => (r as { origin?: boolean }).origin === true;
const SCOPES = ["LUZ", "GAS"] as const;
type Scope = (typeof SCOPES)[number];
/** Linhas por pagina nas tabelas desta pagina. */
const PAGE_SIZE = 20;

/** Etiqueta das energias de um comercializador, tal como aparece na lista. */
function scopeLabel(scopes: string[]) {
  if (scopes.includes("LUZ") && scopes.includes("GAS")) return "Eletricidade e gás";
  if (scopes.includes("GAS")) return "Gás";
  return "Eletricidade";
}

/** O servidor recusa remover (409) quando o comercializador já está usado em vendas. */
function conflictCount(e: unknown): number | null {
  const d = (e as { data?: { usageCount?: unknown } } | null)?.data;
  const n = d?.usageCount;
  return typeof n === "number" && n > 0 ? n : null;
}

function ScopePicker({ value, onChange }: { value: Scope[]; onChange: (v: Scope[]) => void }) {
  const toggle = (s: Scope) => onChange(value.includes(s) ? value.filter((x) => x !== s) : [...value, s]);
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {SCOPES.map((s) => {
        const on = value.includes(s);
        const Icon = s === "GAS" ? Flame : Zap;
        return (
          <button
            type="button"
            key={s}
            aria-pressed={on}
            onClick={() => toggle(s)}
            className={`flex h-11 items-center gap-2 rounded-[10px] border px-3 text-[13px] transition ${
              on ? "border-volt/50 bg-volt/10 text-volt" : "border-line text-ink-2 hover:text-ink"
            }`}
          >
            <Icon size={14} /> {SUPPLIER_SCOPE_LABELS[s]}
          </button>
        );
      })}
    </div>
  );
}

function SupplierForm({ initial, onClose }: { initial: Custom | null; onClose: () => void }) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: orpc.suppliersRoute.key() });
  const create = useMutation({ ...orpc.suppliersRoute.create.mutationOptions(), onSuccess: invalidate });
  const update = useMutation({ ...orpc.suppliersRoute.update.mutationOptions(), onSuccess: invalidate });
  const remove = useMutation({ ...orpc.suppliersRoute.remove.mutationOptions(), onSuccess: invalidate });

  const [name, setName] = useState(initial?.name ?? "");
  const [scopes, setScopes] = useState<Scope[]>((initial?.scopes as Scope[]) ?? ["LUZ"]);
  const [error, setError] = useState<string | null>(null);
  /** Confirmacao de remocao. `null` = fechada; numero = quantas vendas usam o nome. */
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Indique o nome do comercializador.");
    if (!scopes.length) return setError("Escolha pelo menos uma energia (eletricidade ou gás).");
    try {
      if (initial) await update.mutateAsync({ id: initial.id, name: name.trim(), scopes });
      else await create.mutateAsync({ name: name.trim(), scopes });
      onClose();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const doRemove = async () => {
    setError(null);
    try {
      await remove.mutateAsync({ id: initial!.id, force: true });
      onClose();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  /** Pergunta ao servidor quantas vendas usam o nome antes de mostrar o aviso. */
  const askRemove = async () => {
    setError(null);
    try {
      const { count } = await client.suppliersRoute.usage({ name: initial!.name });
      setConfirmRemove(count);
    } catch {
      setConfirmRemove(initial!.usageCount ?? 0);
    }
  };

  const used = confirmRemove ?? initial?.usageCount ?? 0;

  // Se a remocao falhar por conflito, abre o aviso em vez de so mostrar o erro.
  const onRemove = () => {
    const n = conflictCount(remove.error);
    if (n !== null) setConfirmRemove(n);
    void doRemove();
  };

  return (
    <form onSubmit={submit}>
      <div className="grid gap-4">
        <Field label="Nome do comercializador *">
          <input
            aria-label="Nome do comercializador"
            className="input"
            value={name}
            placeholder="ex.: Nova Energia"
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
          <p className="mt-1 text-[11px] text-ink-3">Aparece no campo "Antigo Comercializador" em todas as vendas da empresa.</p>
        </Field>

        <Field label="Onde deve aparecer *">
          <ScopePicker value={scopes} onChange={setScopes} />
          <p className="mt-1 text-[11px] text-ink-3">As listas de eletricidade e de gás são separadas.</p>
        </Field>
      </div>

      {initial && confirmRemove === null && (
        <div className="mt-4 rounded-[10px] border border-line bg-bg px-3 py-3 text-[12.5px] text-ink-2">
          {used > 0 ? (
            <>Está usado em <strong className="text-ink">{used}</strong> venda{used === 1 ? "" : "s"}. Pode removê-lo da lista — essas vendas mantêm o nome tal como foi registado.</>
          ) : (
            <>Ainda não foi usado em nenhuma venda.</>
          )}
        </div>
      )}

      {initial && confirmRemove !== null && (
        <div className="mt-4 rounded-[10px] border border-danger/40 bg-danger/10 px-3 py-3">
          <p className="text-[12.5px] text-danger">
            {used > 0
              ? `Remover "${initial.name}" da lista? As ${used} venda${used === 1 ? "" : "s"} que o usam não são alteradas.`
              : `Remover "${initial.name}" da lista?`}
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn btn-danger h-9" disabled={remove.isPending} onClick={onRemove}>
              {remove.isPending ? "A remover…" : "Remover"}
            </button>
            <button type="button" className="btn btn-ghost h-9" onClick={() => setConfirmRemove(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      <SubmitRow
        pending={create.isPending || update.isPending}
        onCancel={onClose}
        error={error}
        extra={
          initial && confirmRemove === null ? (
            <button type="button" className="btn btn-danger" onClick={() => void askRemove()}>
              Remover
            </button>
          ) : undefined
        }
      />
    </form>
  );
}

export default function SuppliersPage() {
  const me = useMe();
  const qc = useQueryClient();
  const write = ["admin", "diretor", "rh"].includes(me.data?.role ?? "");
  const list = useCustomSuppliers();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"todos" | Scope>("todos");
  const [edit, setEdit] = useState<Custom | null | "new">(null);

  const rows = list.data ?? [];
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows
      .filter((r) => tab === "todos" || r.scopes.includes(tab))
      .filter((r) => !s || r.name.toLowerCase().includes(s));
  }, [rows, q, tab]);

  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [q, tab]);
  // Se uma remocao esvaziar a ultima pagina, recua para a anterior.
  const lastPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => {
    if (page > lastPage) setPage(lastPage);
  }, [page, lastPage]);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  /** Remove uma origem/custom sem abrir o modal de edicao (o clique na linha abre-o). */
  const removeRow = useMutation({
    ...orpc.suppliersRoute.remove.mutationOptions(),
    onSuccess: () => qc.invalidateQueries({ queryKey: orpc.suppliersRoute.key() }),
  });
  /** Comercializador a confirmar na janela de eliminacao. */
  const [toDelete, setToDelete] = useState<Custom | null>(null);

  const cnt = (s: Scope) => rows.filter((r) => r.scopes.includes(s)).length;

  return (
    <div>
      <PageHeader eyebrow="Definições" title="Comercializadores">
        {write && <button className="btn btn-primary" onClick={() => setEdit("new")}><Plus size={15} /> Novo comercializador</button>}
      </PageHeader>

      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat delay={0} label="Acrescentados" value={rows.length} accent="var(--volt)" sub="à lista de comercializadores" />
        <Stat delay={40} label="Eletricidade" value={OLD_SUPPLIERS.length + cnt("LUZ")} accent="var(--sky)" sub={`${OLD_SUPPLIERS.length} de origem`} />
        <Stat delay={80} label="Gás" value={OLD_GAS_SUPPLIERS.length + cnt("GAS")} accent="var(--amber)" sub={`${OLD_GAS_SUPPLIERS.length} de origem`} />
        <Stat delay={120} label="Em uso em vendas" value={rows.reduce((a, r) => a + Number(r.usageCount ?? 0), 0)} accent="var(--rose)" sub="vendas que os referem" />
      </div>

      <div className="rise mb-4 flex flex-wrap items-center gap-3">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { key: "todos", label: "Todos", count: rows.length },
            { key: "LUZ", label: "Eletricidade", count: cnt("LUZ") },
            { key: "GAS", label: "Gás", count: cnt("GAS") },
          ]}
        />
        <div className="ml-auto min-w-0"><SearchBox value={q} onChange={setQ} placeholder="Nome do comercializador…" /></div>
      </div>

      <div className="card overflow-hidden">
        {list.isLoading ? (
          <TableSkeleton cols={3} />
        ) : list.isError ? (
          <Empty title="Não foi possível carregar" text={errMsg(list.error)} />
        ) : !filtered.length ? (
          <Empty
            title="Sem comercializadores acrescentados"
            text={
              rows.length
                ? "Nenhum comercializador corresponde ao filtro."
                : "Acrescente aqui os comercializadores que não constam da lista. Ficam guardados para todas as vendas da empresa."
            }
            action={write && <button className="btn btn-primary" onClick={() => setEdit("new")}><Plus size={15} /> Novo comercializador</button>}
          />
        ) : (
          <div className="table-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Comercializador</th>
                  <th>Onde aparece</th>
                  <th className="text-right">Usado em</th>
                  {write && <th aria-label="Ações" className="w-24 text-right" />}
                </tr>
              </thead>
              <tbody>
                {paged.map((r) => (
                  <tr key={r.id} className={write ? "cursor-pointer" : ""} onClick={() => write && setEdit(r)}>
                    <td className="max-w-[360px]">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-volt/10 text-volt"><Plug size={15} /></span>
                        <div className="min-w-0">
                          <div className="truncate font-medium">{r.name}</div>
                          <div className="text-[11.5px] text-ink-3">
                            {isOrigin(r)
                              ? "comercializador de origem"
                              : r.createdByName
                                ? `acrescentado por ${r.createdByName}`
                                : "acrescentado pela equipa"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-[12.5px] text-ink-2">{scopeLabel(r.scopes)}</td>
                    <td className="num text-right text-[12.5px]">
                      {Number(r.usageCount) > 0 ? r.usageCount : <span className="text-ink-3">—</span>}
                    </td>
                    {write && (
                      <td className="w-24 whitespace-nowrap">
                        <span className="btn-icon" title="Editar"><Pencil size={14} /></span>
                        <button
                          type="button"
                          title="Eliminar"
                          aria-label={`Eliminar ${r.name}`}
                          className="btn-icon hover:!text-danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            setToDelete(r);
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!list.isLoading && !list.isError && filtered.length > PAGE_SIZE && (
          <Pagination page={page} total={filtered.length} pageSize={PAGE_SIZE} onChange={setPage} />
        )}
      </div>

      <ConfirmDeleteModal
        open={toDelete !== null}
        title={toDelete ? `Eliminar "${toDelete.name}"?` : "Eliminar comercializador?"}
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          await removeRow.mutateAsync({ id: toDelete!.id, force: true });
        }}
      >
        {toDelete && Number(toDelete.usageCount) > 0 ? (
          <>
            <strong className="text-ink">{toDelete.name}</strong> está usado em{" "}
            <strong className="text-ink">{toDelete.usageCount}</strong> venda{Number(toDelete.usageCount) === 1 ? "" : "s"}. Vai desaparecer da lista
            de comercializadores e do campo "Antigo Comercializador" nas vendas novas. As vendas já registadas mantêm o nome tal como foi gravado.
          </>
        ) : (
          <>
            <strong className="text-ink">{toDelete?.name}</strong> vai desaparecer da lista de comercializadores e do campo "Antigo Comercializador" em todas
            as vendas.
          </>
        )}
      </ConfirmDeleteModal>

      <p className="mt-4 text-[12px] text-ink-3">
        As listas de origem ({OLD_SUPPLIERS.length} de eletricidade e {OLD_GAS_SUPPLIERS.length} de gás) já existem na aplicação.
        Os comercializadores que acrescentar aqui ficam disponíveis no campo "Antigo Comercializador" de todas as vendas.
      </p>

      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit && edit !== "new" ? `Editar ${isOrigin(edit) ? "comercializador" : "comercializador"}` : "Novo comercializador"}>
        <SupplierForm initial={edit && edit !== "new" ? edit : null} onClose={() => setEdit(null)} />
      </Modal>
    </div>
  );
}
