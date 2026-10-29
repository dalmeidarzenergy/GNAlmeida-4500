import { useMemo, useState } from "react";
import { Download, FileText, Trash2, Filter, Loader2 } from "lucide-react";
import { Empty, Field, Pagination, TableSkeleton } from "../components/ui/kit";
import { ConfirmDeleteModal } from "../components/bulk-select";
import { useIberdrolaPdfList, useIberdrolaPdfSellers, useIberdrolaPdfTeams, useIberdrolaPdfRemove } from "../queries/iberdrola";
import { useMe } from "../queries/me";
import { errMsg, fmtDate, monthLabel } from "../lib/format";
import { authClient } from "../lib/auth";

const PAGE_SIZE = 20;

/** Descarrega um PDF guardado na aba Autos, com o nome da etiqueta (ex.: Set26 - Daniel Nascimento). */
async function downloadSaved(id: number, label: string) {
  const token = authClient.managedAuth.getToken();
  const res = await fetch(`${window.location.origin}/api/iberdrola/autos/file/${id}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Erro ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = window.document.createElement("a");
  a.href = url;
  a.download = `${label}.pdf`;
  window.document.body.appendChild(a);
  a.click();
  window.document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function fmtSize(bytes: number) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Aba "Autos": PDFs guardados, com filtros por vendedor, por chefe e por data. */
export default function Autos() {
  const me = useMe();
  const canDelete = me.data?.role === "admin" || me.data?.role === "diretor";

  const [seller, setSeller] = useState<string>("");
  const [leader, setLeader] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [page, setPage] = useState(1);
  const [toRemove, setToRemove] = useState<{ id: number; label: string } | null>(null);

  const sellers = useIberdrolaPdfSellers();
  const teams = useIberdrolaPdfTeams();
  const remove = useIberdrolaPdfRemove();

  const input = useMemo(
    () => ({
      employeeId: seller ? Number(seller) : undefined,
      leaderId: leader ? Number(leader) : undefined,
      from: from || undefined,
      to: to || undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
    [seller, leader, from, to, page],
  );

  const list = useIberdrolaPdfList(input);
  const data = list.data;
  const items = data?.items ?? [];

  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Vendedor">
          <select className="input w-56" value={seller} onChange={(e) => reset(() => setSeller(e.target.value))}>
            <option value="">Todos os vendedores</option>
            {(sellers.data ?? []).map((s) => (
              <option key={s.employeeId} value={String(s.employeeId)}>
                {s.employeeName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Chefe de equipa">
          <select className="input w-56" value={leader} onChange={(e) => reset(() => setLeader(e.target.value))}>
            <option value="">Todos os chefes</option>
            {(teams.data ?? []).map((t) => (
              <option key={t.leaderId} value={String(t.leaderId)}>
                {t.leaderName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="De">
          <input type="month" className="input num w-40" value={from} onChange={(e) => reset(() => setFrom(e.target.value))} />
        </Field>
        <Field label="Até">
          <input type="month" className="input num w-40" value={to} onChange={(e) => reset(() => setTo(e.target.value))} />
        </Field>
        {(seller || leader || from || to) && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() =>
              reset(() => {
                setSeller("");
                setLeader("");
                setFrom("");
                setTo("");
              })
            }
          >
            <Filter size={14} /> Limpar filtros
          </button>
        )}
      </div>

      <div className="card mt-5 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <div className="font-display text-[15px] font-semibold">Autos guardados</div>
            <div className="text-[11.5px] text-ink-3">
              {data ? `${data.total} auto${data.total === 1 ? "" : "s"} guardado${data.total === 1 ? "" : "s"}` : "A carregar…"}
            </div>
          </div>
        </div>

        {list.isLoading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : !items.length ? (
          <Empty
            title="Sem autos guardados"
            text="Ao descarregar o PDF de um comercial em Autos Finais, fica aqui uma cópia com o nome do mês e do comercial."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[12.5px]">
              <thead className="bg-surface">
                <tr className="border-b border-line text-left">
                  <th className="px-4 py-2.5 font-medium">Auto</th>
                  <th className="px-4 py-2.5 font-medium">Comercial</th>
                  <th className="px-4 py-2.5 font-medium">Mês</th>
                  <th className="px-4 py-2.5 font-medium">Guardado por</th>
                  <th className="px-4 py-2.5 text-right font-medium">Tamanho</th>
                  <th className="px-4 py-2.5 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0 hover:bg-volt/5">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <FileText size={14} className="shrink-0 text-ink-3" />
                        <span className="font-medium">{r.label}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-2">{r.employeeName}</td>
                    <td className="px-4 py-3 text-ink-2">{monthLabel(r.month)}</td>
                    <td className="px-4 py-3 text-ink-2">
                      {r.uploadedBy}
                      <span className="ml-1.5 text-[11px] text-ink-3">{fmtDate(r.createdAt)}</span>
                    </td>
                    <td className="num px-4 py-3 text-right text-ink-2">{fmtSize(r.size)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          className="btn btn-ghost px-2.5 py-1 text-[12px]"
                          onClick={() => downloadSaved(r.id, r.label).catch((e) => window.alert(errMsg(e)))}
                          title="Descarregar este PDF."
                        >
                          <Download size={13} /> Descarregar
                        </button>
                        {canDelete && (
                          <button
                            type="button"
                            className="btn btn-ghost px-2 py-1 text-[11.5px] text-ink-2"
                            onClick={() => setToRemove({ id: r.id, label: r.label })}
                            title="Eliminar este PDF."
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.total > PAGE_SIZE && (
          <div className="border-t border-line px-5 py-3">
            <Pagination page={page} total={data.total} pageSize={PAGE_SIZE} onChange={setPage} />
          </div>
        )}

        {remove.isPending && (
          <div className="flex items-center gap-2 border-t border-line px-5 py-3 text-[12px] text-ink-2">
            <Loader2 size={13} className="animate-spin" /> A eliminar…
          </div>
        )}
      </div>

      <ConfirmDeleteModal
        open={toRemove !== null}
        title="Eliminar este auto?"
        onClose={() => setToRemove(null)}
        onConfirm={async () => {
          if (!toRemove) return;
          await remove.mutateAsync({ id: toRemove.id });
          list.refetch();
        }}
      >
        {toRemove ? `O PDF “${toRemove.label}” vai ser eliminado da aba Autos.` : null}
      </ConfirmDeleteModal>
    </div>
  );
}
