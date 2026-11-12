import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, Trash2, FileText, Loader2, ExternalLink, X } from "lucide-react";
import { orpc } from "../lib/api";
import { PageHeader, Empty, TableSkeleton, Tabs, Stat, SearchBox, Modal } from "../components/ui/kit";
import { errMsg, fmtDate } from "../lib/format";
import { BotaoEditar, EditProposta, type PropostaEditavel } from "./proposta-editar";

/** As duas origens de propostas guardadas: o simulador de campanhas e o Medem. */
const ABAS = [
  { key: "res-neg", label: "Propostas RES/NEG" },
  { key: "medem", label: "Propostas Medem" },
] as const;
type Aba = (typeof ABAS)[number]["key"];

/** Mostra euros no formato pt-PT. */
const eur = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"
    : "—";

/** Nome legível do cliente: cai para o NIF quando não há nome. */
const cliente = (nome: string | null, nif: string | null) => nome?.trim() || (nif ? `NIF ${nif}` : "(sem nome)");

export default function PropostasPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Aba>("res-neg");
  const [q, setQ] = useState("");
  const [toDelete, setToDelete] = useState<{ id: string; nome: string } | null>(null);
  const [preview, setPreview] = useState<{ id: string; nome: string } | null>(null);
  const [toEdit, setToEdit] = useState<PropostaEditavel | null>(null);

  const list = useQuery(orpc.propostas.list.queryOptions({ input: { source: tab } }));
  const rows = useMemo(() => list.data ?? [], [list.data]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) =>
      `${r.clientName ?? ""} ${r.clientNif ?? ""} ${r.authorName ?? ""} ${r.bestPlan ?? ""} ${r.segment ?? ""}`
        .toLowerCase()
        .includes(t),
    );
  }, [rows, q]);

  const remove = useMutation({
    ...orpc.propostas.remove.mutationOptions(),
    onSuccess: () => qc.invalidateQueries({ queryKey: orpc.propostas.key() }),
  });

  const comPdf = rows.filter((r) => r.hasPdf).length;
  const poupanca = rows.reduce((s, r) => s + (typeof r.saving === "number" ? r.saving : 0), 0);
  const autores = new Set(rows.map((r) => r.authorName)).size;

  return (
    <div>
      <PageHeader eyebrow="Comercial" title="Propostas">
        <span className="text-[12.5px] text-ink-3">
          Propostas guardadas quando o PDF é descarregado nos simuladores.
        </span>
      </PageHeader>

      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat delay={0} label="Propostas" value={rows.length} accent="var(--volt)" sub={tab === "medem" ? "no simulador Medem" : "no simulador RES/NEG"} />
        <Stat delay={40} label="Com PDF" value={comPdf} accent="var(--sky)" sub="podem ser re-descarregadas" />
        <Stat delay={80} label="Poupança acumulada" value={eur(poupanca)} accent="var(--amber)" sub="soma das propostas" />
        <Stat delay={120} label="Autores" value={autores} accent="var(--rose)" sub="propostas por pessoa" />
      </div>

      <div className="rise mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={tab} onChange={setTab} items={ABAS.map((a) => ({ key: a.key, label: a.label }))} />
        <div className="ml-auto min-w-0">
          <SearchBox value={q} onChange={setQ} placeholder="Cliente, NIF, plano ou comercial…" />
        </div>
      </div>

      <div className="card overflow-hidden">
        {list.isLoading ? (
          <TableSkeleton cols={6} />
        ) : list.isError ? (
          <Empty title="Não foi possível carregar" text={errMsg(list.error)} />
        ) : !filtered.length ? (
          <Empty
            title={rows.length ? "Nenhuma proposta corresponde ao filtro" : "Ainda não há propostas aqui"}
            text={
              rows.length
                ? "Limpa a pesquisa para ver todas."
                : tab === "medem"
                  ? "Descarrega um PDF no Simulador Medem e a proposta aparece nesta aba."
                  : "Descarrega um PDF no Simulador RES/NEG e a proposta aparece nesta aba."
            }
          />
        ) : (
          <div className="table-scroll">
            <table className="w-full">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Segmento</th>
                  <th>Plano</th>
                  <th className="text-right">Poupança</th>
                  <th>Comercial</th>
                  <th>Data</th>
                  <th className="w-[160px]"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium">{cliente(r.clientName, r.clientNif)}</span>
                        {!r.isOwn && <span className="shrink-0 rounded-full bg-sky/10 px-2 py-[1px] text-[11px] font-medium text-sky">equipa</span>}
                      </div>
                      {r.clientNif && <span className="num text-[11.5px] text-ink-3">{r.clientNif}</span>}
                    </td>
                    <td className="text-[12.5px] text-ink-2">{r.segment || "—"}</td>
                    <td className="truncate text-[12.5px] text-ink-2">{r.bestPlan || "—"}</td>
                    <td className="num text-right text-[12.5px]">{eur(r.saving)}</td>
                    <td className="truncate text-[12.5px] text-ink-3">{r.authorName || "—"}</td>
                    <td className="text-[12.5px] text-ink-3">{fmtDate(r.createdAt)}</td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <BotaoEditar
                          onClick={() =>
                            setToEdit({
                              id: r.id,
                              clientName: r.clientName,
                              clientNif: r.clientNif,
                              segment: r.segment,
                              bestPlan: r.bestPlan,
                              saving: r.saving,
                              source: r.source,
                            })
                          }
                        />
                        {r.hasPdf ? (
                          <>
                            <button
                              className="btn-icon"
                              aria-label="Pré-visualizar PDF"
                              title="Pré-visualizar"
                              onClick={() => setPreview({ id: r.id, nome: cliente(r.clientName, r.clientNif) })}
                            >
                              <Eye size={14} />
                            </button>
                            <a
                              className="btn-icon"
                              aria-label="Descarregar PDF"
                              title="Descarregar PDF"
                              href={`/api/simulador-propostas/${encodeURIComponent(r.id)}/pdf`}
                            >
                              <Download size={14} />
                            </a>
                          </>
                        ) : (
                          <span className="inline-flex h-8 items-center px-2 text-[11px] text-ink-3" title="Esta proposta não tem PDF guardado">
                            <FileText size={13} />
                          </span>
                        )}
                        <button
                          className="btn-icon text-danger"
                          aria-label="Eliminar"
                          title="Eliminar proposta"
                          onClick={() => setToDelete({ id: r.id, nome: cliente(r.clientName, r.clientNif) })}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={!!toDelete}
        onClose={() => !remove.isPending && setToDelete(null)}
        title="Eliminar esta proposta?"
      >
        <div className="text-[13.5px] text-ink-2">
          A proposta de <strong>{toDelete?.nome ?? "—"}</strong> e o PDF guardado vão ser apagados.
        </div>
        <p className="mt-3 text-[12.5px] text-danger">Esta ação não pode ser desfeita.</p>
        {remove.error && <p className="mt-2 text-[12.5px] text-danger">{errMsg(remove.error)}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={remove.isPending}
            onClick={() => setToDelete(null)}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={remove.isPending}
            onClick={async () => {
              if (!toDelete) return;
              try {
                await remove.mutateAsync({ id: toDelete.id });
                setToDelete(null);
              } catch {
                /* o erro aparece na propria janela */
              }
            }}
          >
            {remove.isPending ? <Loader2 size={14} className="animate-spin" /> : null} Eliminar
          </button>
        </div>
      </Modal>

      <EditProposta proposta={toEdit} onClose={() => setToEdit(null)} />

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-6" onClick={() => setPreview(null)}>
          <div
            className="flex h-full w-full max-w-[1000px] flex-col overflow-hidden rounded-[14px] bg-surface shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
              <FileText size={15} className="shrink-0 text-rose" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium">Proposta de {preview.nome}</div>
                <div className="text-[11.5px] text-ink-3">Pré-visualização</div>
              </div>
              <a
                className="btn btn-ghost h-8 px-3 text-[12.5px]"
                aria-label="Abrir num separador"
                title="Abrir num separador"
                href={`/api/simulador-propostas/${encodeURIComponent(preview.id)}/pdf?inline=1`}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={13} /> Abrir
              </a>
              <a
                className="btn btn-ghost h-8 px-3 text-[12.5px]"
                aria-label="Descarregar PDF"
                title="Descarregar"
                href={`/api/simulador-propostas/${encodeURIComponent(preview.id)}/pdf`}
              >
                <Download size={13} /> Descarregar
              </a>
              <button className="btn-icon" aria-label="Fechar" title="Fechar" onClick={() => setPreview(null)}>
                <X size={15} />
              </button>
            </div>
            <iframe
              className="min-h-0 flex-1 bg-bg"
              title={`Pré-visualização da proposta de ${preview.nome}`}
              src={`/api/simulador-propostas/${encodeURIComponent(preview.id)}/pdf?inline=1`}
            />
          </div>
        </div>
      )}
    </div>
  );
}
