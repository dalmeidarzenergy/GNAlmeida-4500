import { useMemo, useState } from "react";
import { Plus, Pencil, Megaphone, FileText, Upload, X } from "lucide-react";
import { useCampaigns, useSaveCampaign, campaignState, type CampaignState } from "../queries/campaigns";
import { useMe } from "../queries/me";
import { PageHeader, Modal, Field, SubmitRow, SearchBox, Empty, TableSkeleton, Tabs, ConfirmDelete, Pill, Stat } from "../components/ui/kit";
import { errMsg, fmtDate } from "../lib/format";
import { client } from "../lib/api";
import { SERVICE_LABELS, SUPPLIER } from "../../api/shared/client-forms";

type Campaign = NonNullable<ReturnType<typeof useCampaigns>["data"]>[number];

const STATE: Record<CampaignState, { label: string; color: string }> = {
  ativa: { label: "Ativa", color: "var(--volt)" },
  agendada: { label: "Agendada", color: "var(--sky)" },
  terminada: { label: "Terminada", color: "var(--ink-3)" },
};
const CLIENT_TYPE: Record<string, string> = { todos: "Todos os clientes", particular: "Particulares", empresa: "Empresas" };

function period(c: Pick<Campaign, "startDate" | "endDate">) {
  if (!c.startDate && !c.endDate) return "Sem período definido";
  if (c.startDate && !c.endDate) return `Desde ${fmtDate(c.startDate)}`;
  if (!c.startDate) return `Até ${fmtDate(c.endDate)}`;
  return `${fmtDate(c.startDate)} → ${fmtDate(c.endDate)}`;
}

const MAX_PDF_MB = 20;

/** Anexo PDF da campanha: envia o ficheiro diretamente para o armazenamento e guarda a chave. */
function PdfField({ pdfKey, pdfName, url, onChange }: { pdfKey: string | null; pdfName: string | null; url: string | null; onChange: (key: string | null, name: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const href = localUrl ?? url;
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setErr(null);
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return setErr("Escolha um ficheiro PDF.");
    if (file.size > MAX_PDF_MB * 1024 * 1024) return setErr(`O PDF não pode ter mais de ${MAX_PDF_MB} MB.`);
    setBusy(true);
    try {
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      const { key } = await client.campaigns.pdfUpload({ content: base64 });
      setLocalUrl(URL.createObjectURL(file));
      onChange(key, file.name);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      {pdfKey ? (
        <div className="flex items-center gap-3 rounded-[10px] border border-line bg-bg px-3 py-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-rose/10 text-rose"><FileText size={15} /></span>
          <div className="min-w-0 flex-1">
            {href ? <a href={href} target="_blank" rel="noreferrer" className="block truncate text-[13px] font-medium hover:text-volt">{pdfName ?? "campanha.pdf"}</a> : <span className="block truncate text-[13px] font-medium">{pdfName}</span>}
            <span className="text-[11px] text-ink-3">PDF anexado</span>
          </div>
          <label className="btn btn-ghost h-8 cursor-pointer px-2.5 text-[12px]">
            <Upload size={13} /> Substituir
            <input type="file" aria-label="Anexar PDF" accept="application/pdf,.pdf" className="hidden" disabled={busy} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          <button type="button" aria-label="Remover PDF" className="btn-icon" onClick={() => { setLocalUrl(null); onChange(null, null); }}><X size={14} /></button>
        </div>
      ) : (
        <label className={`flex h-[72px] cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-dashed border-line text-[13px] text-ink-2 transition hover:border-ink-3 hover:text-ink ${busy ? "pointer-events-none opacity-60" : ""}`}>
          <Upload size={15} /> {busy ? "A enviar…" : "Anexar PDF"}
          <span className="text-[11px] text-ink-3">(até {MAX_PDF_MB} MB)</span>
          <input type="file" aria-label="Anexar PDF" accept="application/pdf,.pdf" className="hidden" disabled={busy} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
      )}
      {busy && pdfKey && <p className="mt-1 text-[11px] text-ink-3">A enviar…</p>}
      {err && <p className="mt-1 text-[11.5px] text-danger">{err}</p>}
    </div>
  );
}

function CampaignForm({ initial, onClose }: { initial: Campaign | null; onClose: () => void }) {
  const save = useSaveCampaign();
  const [f, setF] = useState({
    code: initial?.code ?? "",
    name: initial?.name ?? "",
    service: initial?.service ?? "",
    clientType: (initial?.clientType ?? "todos") as "todos" | "particular" | "empresa",
    startDate: initial?.startDate ?? "",
    endDate: initial?.endDate ?? "",
    active: initial?.active ?? true,
    description: initial?.description ?? "",
    pdfKey: initial?.pdfKey ?? null,
    pdfName: initial?.pdfName ?? null,
  });
  const [error, setError] = useState<string | null>(null);
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      setError(null);
      const payload = { ...f, service: f.service || null, startDate: f.startDate || null, endDate: f.endDate || null };
      try {
        if (initial) await save.update.mutateAsync({ ...payload, id: initial.id });
        else await save.create.mutateAsync(payload);
        onClose();
      } catch (err) { setError(errMsg(err)); }
    }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Código *">
          <input aria-label="Código" className="input num uppercase" value={f.code} placeholder="ex.: MENERGIA263" onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/\s/g, "") })} required />
          {initial && initial.code !== f.code && Number(initial.saleCount) > 0 && (
            <p className="mt-1 text-[11px] text-amber">As {initial.saleCount} vendas com {initial.code} passam para o novo código.</p>
          )}
        </Field>
        <Field label="Nome"><input aria-label="Nome" className="input" value={f.name} placeholder="ex.: Mais Energia" onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Serviço">
          <select aria-label="Serviço" className="input" value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })}>
            <option value="">Todos os serviços</option>
            {SERVICE_LABELS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Clientes">
          <select aria-label="Clientes" className="input" value={f.clientType} onChange={(e) => setF({ ...f, clientType: e.target.value as typeof f.clientType })}>
            {Object.entries(CLIENT_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Início"><input aria-label="Início" className="input" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
        <Field label="Fim"><input aria-label="Fim" className="input" type="date" value={f.endDate} min={f.startDate || undefined} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
        <Field label="Condições / descrição" className="sm:col-span-2">
          <textarea aria-label="Condições" className="input h-auto min-h-[96px] py-2" value={f.description} placeholder="Descontos, fidelização, tarifário, requisitos…" onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <Field label="PDF da campanha" className="sm:col-span-2">
          <PdfField
            pdfKey={f.pdfKey}
            pdfName={f.pdfName}
            url={initial && f.pdfKey === initial.pdfKey ? initial.pdfUrl : null}
            onChange={(pdfKey, pdfName) => setF({ ...f, pdfKey, pdfName })}
          />
        </Field>
        <Field label="Disponível para novas vendas" className="sm:col-span-2">
          <div className="grid grid-cols-2 gap-2">
            {[true, false].map((b) => (
              <button type="button" key={String(b)} onClick={() => setF({ ...f, active: b })}
                className={`h-10 rounded-[10px] border text-[13px] transition ${f.active === b ? (b ? "border-volt/50 bg-volt/10 text-volt" : "border-line bg-bg text-ink") : "border-line text-ink-2 hover:text-ink"}`}>
                {b ? "Sim" : "Não (terminada)"}
              </button>
            ))}
          </div>
        </Field>
      </div>
      <SubmitRow
        pending={save.isPending}
        onCancel={onClose}
        error={error}
        extra={initial && <ConfirmDelete pending={save.remove.isPending} onConfirm={async () => { await save.remove.mutateAsync({ id: initial.id }); onClose(); }} />}
      />
    </form>
  );
}

export default function CampaignsPage() {
  const me = useMe();
  const isAdmin = me.data?.role === "admin";
  const write = me.data?.role === "admin" || me.data?.role === "rh";
  const list = useCampaigns();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"todas" | CampaignState>("ativa");
  const [service, setService] = useState("todos");
  const [edit, setEdit] = useState<Campaign | null | "new">(null);

  const rows = useMemo(() => (list.data ?? []).map((c) => ({ ...c, state: campaignState(c) })), [list.data]);
  const filtered = useMemo(() => {
    const s = q.toLowerCase();
    return rows
      .filter((c) => tab === "todas" || c.state === tab)
      .filter((c) => service === "todos" || !c.service || c.service === service)
      .filter((c) => !s || c.code.toLowerCase().includes(s) || (c.name ?? "").toLowerCase().includes(s) || (c.description ?? "").toLowerCase().includes(s));
  }, [rows, q, tab, service]);
  const cnt = (k: CampaignState) => rows.filter((c) => c.state === k).length;
  const totalSales = rows.reduce((a, c) => a + Number(c.saleCount), 0);
  const top = [...rows].sort((a, b) => Number(b.saleCount) - Number(a.saleCount))[0];

  return (
    <div>
      <PageHeader eyebrow="Vendas" title="Campanhas">
        {write && <button className="btn btn-primary" onClick={() => setEdit("new")}><Plus size={15} /> Nova campanha</button>}
      </PageHeader>

      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat delay={0} label="Ativas" value={cnt("ativa")} accent="var(--volt)" sub="disponíveis para vender" />
        <Stat delay={40} label="Agendadas" value={cnt("agendada")} accent="var(--sky)" sub="começam mais tarde" />
        <Stat delay={80} label="Vendas com campanha" value={totalSales} accent="var(--amber)" sub={isAdmin ? "todas as vendas" : "as suas vendas"} />
        <Stat delay={120} label="Mais vendida" value={top && Number(top.saleCount) > 0 ? top.code : "—"} accent="var(--rose)" sub={top && Number(top.saleCount) > 0 ? `${top.saleCount} vendas` : "sem vendas"} />
      </div>

      <div className="rise mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={tab} onChange={setTab} items={[
          { key: "ativa", label: "Ativas", count: cnt("ativa") },
          { key: "agendada", label: "Agendadas", count: cnt("agendada") },
          { key: "terminada", label: "Terminadas", count: cnt("terminada") },
          { key: "todas", label: "Todas", count: rows.length },
        ]} />
        <Tabs value={service} onChange={setService} items={[{ key: "todos", label: "Todos" }, ...SERVICE_LABELS.map((s) => ({ key: s, label: s }))]} />
        <div className="ml-auto"><SearchBox value={q} onChange={setQ} placeholder="Código, nome, condições…" /></div>
      </div>

      <div className="card overflow-hidden">
        {list.isLoading ? <TableSkeleton cols={6} /> : list.isError ? <Empty title="Não foi possível carregar" text={errMsg(list.error)} /> : !filtered.length ? (
          <Empty
            title="Sem campanhas"
            text={rows.length ? "Nenhuma campanha corresponde aos filtros." : "Registe as campanhas IBERDROLA para as escolher nas vendas."}
            action={write && <button className="btn btn-primary" onClick={() => setEdit("new")}><Plus size={15} /> Nova campanha</button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Campanha</th><th>Serviço</th><th>Clientes</th><th>Período</th><th>PDF</th><th className="text-right">Vendas</th><th>Estado</th>{write && <th aria-label="Ações" />}</tr></thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className={write ? "cursor-pointer" : ""} onClick={() => write && setEdit(c)}>
                    <td className="max-w-[380px]" aria-label={c.code}>
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-volt/10 text-volt"><Megaphone size={15} /></span>
                        <div className="min-w-0">
                          <div className="num font-semibold tracking-wide">{c.code}</div>
                          {c.name && <div className="text-[12.5px] text-ink-2">{c.name}</div>}
                          {c.description && <div className="mt-0.5 line-clamp-2 text-[11.5px] text-ink-3">{c.description}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-[12.5px] text-ink-2">{SUPPLIER} · {c.service ?? "Todos"}</td>
                    <td className="text-[12.5px] text-ink-2">{CLIENT_TYPE[c.clientType] ?? c.clientType}</td>
                    <td className="num whitespace-nowrap text-[12.5px] text-ink-2">{period(c)}</td>
                    <td aria-label="PDF da campanha">
                      {c.pdfUrl ? (
                        <a href={c.pdfUrl} target="_blank" rel="noreferrer" title={c.pdfName ?? "PDF"} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1.5 rounded-full border border-rose/30 bg-rose/10 px-2.5 py-[3px] text-[11.5px] font-medium text-rose hover:bg-rose/20">
                          <FileText size={12} /> Abrir
                        </a>
                      ) : <span className="text-[12px] text-ink-3">—</span>}
                    </td>
                    <td className="num text-right">
                      {c.saleCount}
                      {Number(c.countedCount) > 0 && <div className="text-[11px] text-volt">{c.countedCount} em fornec.</div>}
                    </td>
                    <td><Pill label={STATE[c.state].label} color={STATE[c.state].color} /></td>
                    {write && <td className="w-10"><span className="btn-icon"><Pencil size={14} /></span></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit === "new" ? "Nova campanha" : `Campanha ${edit?.code ?? ""}`}>
        {edit !== null && <CampaignForm initial={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
      </Modal>
    </div>
  );
}
