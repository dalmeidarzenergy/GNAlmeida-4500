import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearch } from "wouter";
import { ArrowRight, CalendarClock, CheckCircle2, ClipboardList, FileText, MessageSquarePlus, Paperclip, Pencil, Plus, Trash2, Upload, UserPlus } from "lucide-react";
import { useAdvanceLead, useLead, useLeadDocuments, useLeadReports, useLeadReportsMutation, useLeads, useRemoveLead, useSaveLead } from "../queries/sales";
import { useEmployeeOptions } from "../queries/hr";
import { useMe } from "../queries/me";
import { PageHeader, Modal, Field, SubmitRow, SearchBox, Empty, TableSkeleton, Tabs, Stat, Pill, Pagination, Avatar } from "../components/ui/kit";
import { errMsg, fmtDate } from "../lib/format";
import { SERVICES, SERVICE_LABELS, fieldOptions, getSaleForm, withCustomSuppliers, type Details, type FieldDef } from "../../api/shared/client-forms";
import { CONCELHOS } from "../../api/shared/concelhos";
import { DynamicField } from "../components/sale-form";
import { useCustomSuppliers, useSupplierOverrides } from "../queries/suppliers";

type Lead = NonNullable<ReturnType<typeof useLeads>["data"]>[number];
type LeadFile = { id: number; name: string; path: string; size: number; kind: string; reportId?: number | null; createdAt: string | Date };

/** Estados de tratamento de uma lead (o último passo é o botão Avançar). */
const STAGES = [
  { key: "nova", label: "Nova", tone: "sky" },
  { key: "contacto", label: "Em contacto", tone: "amber" },
  { key: "proposta", label: "Proposta enviada", tone: "volt" },
  { key: "docs", label: "Documentação", tone: "amber" },
  { key: "negociacao", label: "Em negociação", tone: "green" },
] as const;
type Stage = (typeof STAGES)[number]["key"];
const stageOf = (s: string) => STAGES.find((x) => x.key === s) ?? STAGES[0];

/** Campos da venda que só fazem sentido depois de a venda existir. */
const SALE_ONLY = new Set([
  "saleStatus", "saleStatusGas", "vtvStatus", "vtvStatusGas", "koReason",
  "leedNumber", "leedCreatedAt", "leedStatus", "w2lCallDate", "contractNumber",
]);

const DOC_KINDS = [
  { key: "identificacao", label: "Identificação" },
  { key: "fatura", label: "Fatura" },
  { key: "contrato", label: "Contrato" },
  { key: "cpe", label: "CPE / CUI" },
  { key: "outro", label: "Outro" },
];

const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} kB`);

/** Data e hora do report — registada pelo servidor, não se escreve à mão. */
const fmtDateTime = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return `${date.toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric" })} às ${date.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}`;
};

/** Tipos de report à venda. */
const REPORT_KINDS = [
  { key: "atualizacao", label: "Atualização", tone: "sky", hint: "O que foi feito e o que falta no processo." },
  { key: "contacto", label: "Contacto", tone: "volt", hint: "Visita, chamada ou tentativa de contacto com o cliente." },
  { key: "problema", label: "Problema", tone: "red", hint: "Obstáculo que trava a venda." },
] as const;
type ReportKind = (typeof REPORT_KINDS)[number]["key"];
const reportKindOf = (k: string) => REPORT_KINDS.find((x) => x.key === k) ?? REPORT_KINDS[0];

/** Obstáculos que se sinalizam num report de problema. */
const PROBLEM_TYPES = [
  { key: "ko", label: "KO" },
  { key: "documento", label: "Falta de documento" },
  { key: "sem-resposta", label: "Cliente não responde" },
  { key: "dados", label: "Dados errados / incompletos" },
  { key: "outro", label: "Outro" },
] as const;
const problemOf = (k: string | null | undefined) => PROBLEM_TYPES.find((x) => x.key === k)?.label ?? null;

/** Campos da lead: o formulário do serviço escolhido, sem os campos da venda. */
function leadForm(service: string, custom: { name: string; scopes: string[] }[] | undefined, removed: string[], renamed: Record<string, string>) {
  return (getSaleForm(service) ?? [])
    .filter((f) => !SALE_ONLY.has(f.key))
    .map((f) => withCustomSuppliers(f, custom, removed, renamed));
}

const PAGE_SIZE = 20;

/* ------------------------------------------------------------------ *
 * Anexos da lead
 * ------------------------------------------------------------------ */

function LeadFiles({ leadId }: { leadId: number }) {
  const lead = useLead(leadId);
  const docs = useLeadDocuments();
  const [kind, setKind] = useState("identificacao");
  const [error, setError] = useState<string | null>(null);
  // Os anexos de um report vivem na mesma tabela mas mostram-se no report, não na ficha.
  const files = ((lead.data?.documents ?? []) as LeadFile[]).filter((d) => d.reportId == null).slice().sort((a, b) => b.id - a.id);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const content = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(new Error("Não foi possível ler o ficheiro."));
        fr.readAsDataURL(file);
      });
      await docs.upload.mutateAsync({ leadId, name: file.name, content, mime: file.type || null, kind: kind as "outro" });
    } catch (err) {
      setError(errMsg(err));
    }
  };

  return (
    <div className="rounded-[12px] border border-line bg-bg p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="label-mono block">Documentos</span>
          <p className="mt-1 text-[12px] text-ink-3">Ficha de cliente, fatura, CPE/CUI, contrato assinado… (máx. 12 MB por ficheiro)</p>
        </div>
        <div className="flex items-end gap-2">
          <Field label="Tipo">
            <select aria-label="Tipo de documento" className="input h-10 w-40" value={kind} onChange={(e) => setKind(e.target.value)}>
              {DOC_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          </Field>
          <label className="btn btn-ghost h-10 cursor-pointer">
            <Upload size={15} /> {docs.isPending ? "A enviar…" : "Anexar"}
            <input
              aria-label="Anexar documento"
              type="file"
              className="hidden"
              onChange={(e) => {
                void onPick(e.target.files?.[0]);
                e.currentTarget.value = "";
              }}
            />
          </label>
        </div>
      </div>
      {error && <p className="mb-2 rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</p>}
      {!files.length ? (
        <p className="rounded-[10px] border border-dashed border-line px-3 py-4 text-center text-[12.5px] text-ink-3">Sem documentos anexados.</p>
      ) : (
        <ul className="divide-y divide-line">
          {files.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-2">
              <FileText size={15} className="shrink-0 text-ink-3" />
              <div className="min-w-0 flex-1">
                <a href={d.path} target="_blank" rel="noreferrer" className="block truncate text-[13px] font-medium hover:text-volt">{d.name}</a>
                <div className="text-[11px] text-ink-3">
                  {DOC_KINDS.find((k) => k.key === d.kind)?.label ?? "Outro"} · {fmtSize(Number(d.size))} · {fmtDate(d.createdAt)}
                </div>
              </div>
              <button
                type="button"
                aria-label={`Remover ${d.name}`}
                className="btn-icon hover:!text-danger"
                onClick={async () => {
                  try {
                    await docs.remove.mutateAsync({ id: d.id });
                  } catch (err) {
                    setError(errMsg(err));
                  }
                }}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Reports à venda (feitos na lead, com data e hora automáticas)
 * ------------------------------------------------------------------ */

const REPORT_MAX_FILES = 10;

const REPORT_PLACEHOLDER: Record<ReportKind, string> = {
  atualizacao: "O que foi feito nesta visita ou chamada e o que falta para fechar a venda.",
  contacto: "Com quem falou, o que disse o cliente e o que ficou combinado.",
  problema: "O que está a travar a venda e o que é preciso para desbloquear.",
};

/** Formulário de um report: tipo, estado, texto, seguimento e anexos. */
function ReportForm({ lead, onDone, onCancel }: { lead: Lead; onDone: () => void; onCancel: () => void }) {
  const reports = useLeadReportsMutation();
  const [kind, setKind] = useState<ReportKind>("atualizacao");
  const [stage, setStage] = useState<Stage>((lead.stage as Stage) ?? "nova");
  const [moveStage, setMoveStage] = useState(true);
  const [problemType, setProblemType] = useState<(typeof PROBLEM_TYPES)[number]["key"]>("ko");
  const [note, setNote] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const meta = reportKindOf(kind);

  const pick = (list: FileList | null) => {
    if (!list?.length) return;
    const next = [...files, ...Array.from(list)];
    if (next.length > REPORT_MAX_FILES) {
      setError(`Máximo ${REPORT_MAX_FILES} ficheiros por report (máx. 12 MB cada).`);
      return;
    }
    setError(null);
    setFiles(next);
  };

  const submit = async () => {
    setError(null);
    if (note.trim().length < 3) return setError("Escreva o que foi feito ou o que falta.");
    try {
      const content = await Promise.all(
        files.map(async (f) => ({
          name: f.name,
          content: await new Promise<string>((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result));
            fr.onerror = () => reject(new Error("Não foi possível ler o ficheiro."));
            fr.readAsDataURL(f);
          }),
          mime: f.type || null,
          kind: "outro" as const,
        })),
      );
      await reports.create.mutateAsync({
        leadId: lead.id,
        kind,
        stage,
        problemType: kind === "problema" ? problemType : null,
        note: note.trim(),
        followUp: followUp || null,
        moveStage,
        files: content,
      });
      onDone();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-2">
        {REPORT_KINDS.map((k) => (
          <button
            key={k.key}
            type="button"
            aria-pressed={kind === k.key}
            className={`btn h-9 text-[12px] ${kind === k.key ? "btn-primary" : "btn-ghost"}`}
            onClick={() => {
              setKind(k.key);
              if (k.key === "problema") setMoveStage(false);
            }}
          >
            {k.label}
          </button>
        ))}
      </div>
      <p className="mb-4 text-[12px] text-ink-3">{meta.hint}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Estado da lead">
          <select aria-label="Estado da lead no report" className="input" value={stage} onChange={(e) => setStage(e.target.value as Stage)}>
            {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Próximo seguimento">
          <input aria-label="Próximo seguimento" className="input" type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
        </Field>
        {kind === "problema" && (
          <Field label="Tipo de problema">
            <select
              aria-label="Tipo de problema"
              className="input"
              value={problemType}
              onChange={(e) => setProblemType(e.target.value as (typeof PROBLEM_TYPES)[number]["key"])}
            >
              {PROBLEM_TYPES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </Field>
        )}
      </div>

      <label className="mt-3 flex items-center gap-2 text-[12.5px] text-ink-2">
        <input type="checkbox" aria-label="Atualizar o estado da lead" checked={moveStage} onChange={(e) => setMoveStage(e.target.checked)} />
        Passar a lead para o estado escolhido
      </label>

      <div className="mt-4">
        <Field label="Report *">
          <textarea
            aria-label="Report"
            className="input min-h-[120px]"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={REPORT_PLACEHOLDER[kind]}
          />
        </Field>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="label-mono">Anexos (máx. {REPORT_MAX_FILES})</span>
          <label className="btn btn-ghost h-9 cursor-pointer text-[12px]">
            <Paperclip size={13} /> Anexar
            <input
              aria-label="Anexos do report"
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                pick(e.target.files);
                e.currentTarget.value = "";
              }}
            />
          </label>
        </div>
        {files.length > 0 && (
          <ul className="divide-y divide-line rounded-[10px] border border-line">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-3 px-3 py-2">
                <FileText size={14} className="shrink-0 text-ink-3" />
                <span className="min-w-0 flex-1 truncate text-[12.5px]">{f.name}</span>
                <span className="num shrink-0 text-[11px] text-ink-3">{fmtSize(f.size)}</span>
                <button
                  type="button"
                  aria-label={`Remover ${f.name}`}
                  className="btn-icon hover:!text-danger"
                  onClick={() => setFiles(files.filter((_, x) => x !== i))}
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-ink-3">
        <CalendarClock size={13} /> A data e a hora são registadas automaticamente.
      </p>
      {error && <p className="mt-3 rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</p>}

      <div className="mt-5 flex justify-end gap-2 border-t border-line pt-4">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button type="button" className="btn btn-primary" disabled={reports.isPending} onClick={() => void submit()}>
          {reports.isPending ? "A guardar…" : "Registar report"}
        </button>
      </div>
    </div>
  );
}

/** Report a partir da linha da tabela. Quem só consulta vê o histórico. */
function ReportModal({ lead, canEdit, onClose }: { lead: Lead | null; canEdit: boolean; onClose: () => void }) {
  if (!lead) return null;
  if (!canEdit) {
    return (
      <Modal open onClose={onClose} title={`Reports — ${lead.name}`} size="wide">
        <LeadReports lead={lead} canEdit={false} />
      </Modal>
    );
  }
  return (
    <Modal open onClose={onClose} title={`Report — ${lead.name}`} size="wide">
      <ReportForm lead={lead} onDone={onClose} onCancel={onClose} />
    </Modal>
  );
}

/** Histórico de reports da lead, do mais recente para o mais antigo. */
function LeadReports({ lead, canEdit }: { lead: Lead; canEdit: boolean }) {
  const reports = useLeadReports(lead.id);
  const { remove } = useLeadReportsMutation();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = reports.data ?? [];

  return (
    <div className="rounded-[12px] border border-line bg-bg p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="label-mono flex items-center gap-1.5"><ClipboardList size={13} /> Reports</span>
          <p className="mt-1 text-[12px] text-ink-3">Cada visita, chamada ou atualização ao processo desta venda. A data e a hora ficam registadas.</p>
        </div>
        {canEdit && !open && (
          <button type="button" className="btn btn-ghost h-9 text-[12px]" onClick={() => setOpen(true)}>
            <MessageSquarePlus size={14} /> Novo report
          </button>
        )}
      </div>

      {open && canEdit && (
        <div className="mb-4 rounded-[10px] border border-volt/30 bg-volt/5 p-3">
          <ReportForm lead={lead} onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />
        </div>
      )}

      {error && <p className="mb-2 rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</p>}

      {reports.isLoading ? (
        <p className="text-[12.5px] text-ink-3">A carregar reports…</p>
      ) : !rows.length ? (
        <p className="rounded-[10px] border border-dashed border-line px-3 py-4 text-center text-[12.5px] text-ink-3">
          Sem reports. O primeiro report conta o que foi feito ao cliente.
        </p>
      ) : (
        <ol className="space-y-2.5">
          {rows.map((r) => {
            const k = reportKindOf(r.kind);
            const problem = problemOf(r.problemType);
            const docs = r.documents ?? [];
            return (
              <li key={r.id} className="rounded-[10px] border border-line bg-surface p-3">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <Pill label={k.label} tone={k.tone} />
                  <span className="text-[11.5px] text-ink-2">{stageOf(r.stage ?? "nova").label}</span>
                  {problem && <span className="text-[11.5px] text-danger">· {problem}</span>}
                  <span className="num ml-auto text-[11.5px] text-ink-3">{fmtDateTime(r.createdAt)}</span>
                </div>
                <p className="whitespace-pre-wrap text-[13px] text-ink">{r.note}</p>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-3">
                  <span className="font-medium text-ink-2">{r.authorName ?? "—"}</span>
                  {r.followUp && (
                    <span className="inline-flex items-center gap-1"><CalendarClock size={12} /> Seguimento: {fmtDate(r.followUp)}</span>
                  )}
                  {docs.map((d) => (
                    <a key={d.id} href={d.path} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-volt">
                      <Paperclip size={12} /> {d.name}
                    </a>
                  ))}
                  {canEdit && (
                    <button
                      type="button"
                      aria-label="Eliminar report"
                      className="btn-icon ml-auto hover:!text-danger"
                      onClick={async () => {
                        setError(null);
                        try {
                          await remove.mutateAsync({ id: r.id });
                        } catch (err) {
                          setError(errMsg(err));
                        }
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Ficha da lead (criar / editar)
 * ------------------------------------------------------------------ */

function LeadForm({ initial, onClose, canEdit }: { initial: Lead | null; onClose: () => void; canEdit: boolean }) {
  const me = useMe();
  const emps = useEmployeeOptions();
  const save = useSaveLead();
  const remove = useRemoveLead();
  const custom = useCustomSuppliers().data;
  const { removed, renamed } = useSupplierOverrides();
  const isAdmin = me.data?.role === "admin" || me.data?.role === "diretor";
  const [service, setService] = useState<string>(initial?.service ?? "LUZ");
  const [details, setDetails] = useState<Details>(() => {
    const d: Details = { ...(initial?.details ?? {}) };
    for (const f of leadForm(initial?.service ?? "LUZ", custom, removed, renamed)) {
      if (d[f.key] === undefined && f.kind === "select" && f.default) d[f.key] = f.default;
    }
    return d;
  });
  const [stage, setStage] = useState<Stage>((initial?.stage as Stage) ?? "nova");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [source, setSource] = useState(initial?.source ?? "");
  const [expectedClose, setExpectedClose] = useState(initial?.expectedClose ?? "");
  const [ownerId, setOwnerId] = useState<number | null>(initial?.ownerId ?? null);
  const [error, setError] = useState<string | null>(null);
  const managers = (emps.data ?? []).filter((x) => x.status === "ativo" || x.id === initial?.ownerId);
  const form = leadForm(service, custom, removed, renamed);

  const change = (key: string, v: string | boolean | null) => {
    const next = { ...details, [key]: v };
    // Ao mudar o distrito, limpa o concelho se não pertencer ao novo distrito.
    if (key === "district" && typeof v === "string" && v && typeof next.municipality === "string" && next.municipality && !(CONCELHOS[v] ?? []).includes(next.municipality)) {
      next.municipality = null;
    }
    setDetails(next);
  };

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if (!String(details.name ?? "").trim()) return setError("Indique o nome do cliente.");
        try {
          const payload = { service, details, stage, email: email.trim() || null, source: source.trim() || null, expectedClose: expectedClose || null, ownerId };
          if (initial) await save.update.mutateAsync({ ...payload, id: initial.id });
          else await save.create.mutateAsync(payload);
          onClose();
        } catch (err) {
          setError(errMsg(err));
        }
      }}
    >
      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <Field label="Serviço *">
          <select aria-label="Serviço" className="input" value={service} onChange={(e) => setService(e.target.value)}>
            {SERVICES.map((s) => <option key={s.label} value={s.label}>{s.label} — {s.hint}</option>)}
          </select>
        </Field>
        <Field label="Estado">
          <select aria-label="Estado da lead" className="input" value={stage} onChange={(e) => setStage(e.target.value as Stage)}>
            {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="E-mail">
          <input aria-label="E-mail" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cliente@exemplo.pt" />
        </Field>
        <Field label="Origem">
          <input aria-label="Origem" className="input" value={source} onChange={(e) => setSource(e.target.value)} placeholder="Rua, referência, telefone, site…" />
        </Field>
        <Field label="Data prevista de fecho">
          <input aria-label="Data prevista de fecho" className="input" type="date" value={expectedClose} onChange={(e) => setExpectedClose(e.target.value)} />
        </Field>
        {isAdmin ? (
          <Field label="Comercial responsável *">
            <select aria-label="Comercial responsável" className="input" value={ownerId ?? ""} required onChange={(e) => setOwnerId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Selecione o comercial…</option>
              {managers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
        ) : (
          <div className="text-[12.5px] text-ink-2">
            <span className="label-mono mb-1 block">Comercial responsável</span>
            {initial?.ownerName ?? "Atribuída a si"}
          </div>
        )}
      </div>

      <div className="mb-2 flex items-center justify-between">
        <span className="label-mono">Dados para a conversão da venda</span>
        <span className="text-[11.5px] text-ink-3">{service}</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {form.map((def: FieldDef) => (
          <DynamicField
            key={def.key}
            def={def.kind === "select" && def.optionsFrom ? { ...def, options: fieldOptions(def, details) } : def}
            value={details[def.key]}
            onChange={(v) => change(def.key, v)}
          />
        ))}
      </div>

      {initial ? <div className="mt-5"><LeadFiles leadId={initial.id} /></div> : (
        <p className="mt-5 rounded-[10px] border border-dashed border-line px-3 py-3 text-[12.5px] text-ink-3">
          Os documentos anexam-se depois de guardar a lead — abre a ficha e usa "Anexar".
        </p>
      )}
      {initial && <div className="mt-5"><LeadReports lead={initial} canEdit={canEdit} /></div>}

      <SubmitRow
        pending={save.isPending}
        onCancel={onClose}
        error={error}
        label={initial ? "Guardar" : "Criar lead"}
        extra={initial && canEdit && (
          <button
            type="button"
            className="text-[12px] text-ink-3 hover:text-danger"
            onClick={async () => {
              setError(null);
              try {
                await remove.mutateAsync({ id: initial.id });
                onClose();
              } catch (err) {
                setError(errMsg(err));
              }
            }}
          >
            Eliminar lead
          </button>
        )}
      />
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Avançar: converter em cliente + venda
 * ------------------------------------------------------------------ */

function AdvanceModal({ lead, onClose }: { lead: Lead | null; onClose: () => void }) {
  const advance = useAdvanceLead();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ clientId: number; saleId: number; number: string } | null>(null);

  if (!lead) return null;
  const docs = Number(lead.docCount ?? 0);
  return (
    <Modal open onClose={onClose} title={done ? "Lead avançada" : "Avançar lead para Clientes e Vendas"}>
      {done ? (
        <div>
          <div className="mb-4 flex items-start gap-3 rounded-[12px] border border-volt/30 bg-volt/5 px-4 py-3">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-volt" />
            <div className="text-[13px]">
              <p className="font-semibold text-ink">Cliente criado e venda {done.number} registada.</p>
              <p className="mt-1 text-ink-2">A lead saiu da lista. O cliente já aparece em Clientes e a venda em Vendas.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/clientes" className="btn btn-ghost">Ver em Clientes</Link>
            <Link href={`/venda/${done.saleId}`} className="btn btn-primary">Abrir a venda <ArrowRight size={15} /></Link>
          </div>
        </div>
      ) : (
        <div>
          <p className="text-[13.5px] text-ink-2">
            Vai criar o cliente <strong className="text-ink">{lead.name}</strong>
            {lead.nif ? <> (NIF {lead.nif})</> : null} e a venda <strong className="text-ink">{lead.service}</strong> com os dados desta ficha.
            Só depois de avançar é que aparece em Clientes e em Vendas.
          </p>
          <ul className="mt-4 space-y-1.5 text-[12.5px] text-ink-2">
            <li>· Serviço: <strong className="text-ink">{lead.service}</strong></li>
            <li>· Comercial: <strong className="text-ink">{lead.ownerName ?? "—"}</strong></li>
            <li>· Documentos anexados: <strong className="text-ink">{docs}</strong></li>
          </ul>
          {error && <p className="mt-4 rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</p>}
          <div className="mt-6 flex justify-end gap-2 border-t border-line pt-5">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={advance.isPending}
              onClick={async () => {
                setError(null);
                try {
                  const res = await advance.mutateAsync({ id: lead.id });
                  setDone(res);
                } catch (err) {
                  setError(errMsg(err));
                }
              }}
            >
              {advance.isPending ? "A avançar…" : "Avançar"} <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 * Página
 * ------------------------------------------------------------------ */

export default function ClientesATratarPage() {
  const me = useMe();
  const leads = useLeads();
  const canEdit = me.data?.permissions?.["clientes-a-tratar"]?.edit ?? false;
  const isAdmin = me.data?.role === "admin" || me.data?.role === "diretor";
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<"todas" | Stage>("todas");
  const [owner, setOwner] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<Lead | null | "new">(null);
  const [advancing, setAdvancing] = useState<Lead | null>(null);
  const [reporting, setReporting] = useState<Lead | null>(null);
  // Chegou de outro sítio com ?lead=<id>: abre logo a ficha dessa lead.
  const search = useSearch();
  const deepLead = Number(new URLSearchParams(search).get("lead") ?? 0);
  const deepDone = useRef(0);

  const all = leads.data ?? [];
  const list = useMemo(() => {
    const s = q.toLowerCase();
    return all
      .filter((l) => stage === "todas" || l.stage === stage)
      .filter((l) => owner == null || l.ownerId === owner)
      .filter((l) => !s || l.name.toLowerCase().includes(s) || (l.nif ?? "").includes(s) || (l.phone ?? "").replace(/\s/g, "").includes(s.replace(/\s/g, "")));
  }, [all, q, stage, owner]);

  useEffect(() => {
    if (!deepLead || deepDone.current === deepLead) return;
    const found = all.find((l) => l.id === deepLead);
    if (!found) return;
    deepDone.current = deepLead;
    setEdit(found);
  }, [deepLead, all]);

  const paged = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const count = (s: Stage) => all.filter((l) => l.stage === s).length;
  const staff = useEmployeeOptions().data ?? [];
  const owners = useMemo(() => {
    const ids = new Set(all.map((l) => l.ownerId).filter((x): x is number => x != null));
    return staff.filter((s) => ids.has(s.id));
  }, [all, staff]);

  return (
    <div>
      <PageHeader eyebrow="Vendas" title="Clientes a ser tratados" subtitle="Fichas em tratamento. Só passam a Clientes e Vendas quando carregas em Avançar.">
        {canEdit && <button className="btn btn-primary" onClick={() => setEdit("new")}><Plus size={15} /> Nova lead</button>}
      </PageHeader>

      <div className="rise mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat delay={0} label="Em tratamento" value={all.length} accent="var(--volt)" sub="leads nesta lista" />
        <Stat delay={60} label="Novas" value={count("nova")} accent="var(--sky)" sub="sem contacto feito" />
        <Stat delay={120} label="Em negociação" value={count("negociacao")} accent="#34d399" sub="prontas a avançar" />
        <Stat delay={180} label="Com documentos" value={all.filter((l) => Number(l.docCount) > 0).length} accent="var(--amber)" sub="com anexos" />
      </div>

      <div className="rise mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={stage} onChange={setStage} items={[
          { key: "todas" as const, label: "Todas", count: all.length },
          ...STAGES.map((s) => ({ key: s.key, label: s.label, count: count(s.key) })),
        ]} />
        <div className="ml-auto flex flex-wrap gap-2">
          {isAdmin && (
            <select aria-label="Comercial" className="input h-10 w-56" value={owner ?? ""} onChange={(e) => { setOwner(e.target.value ? Number(e.target.value) : null); setPage(1); }}>
              <option value="">Todos os comerciais</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Nome, NIF ou telemóvel…" />
        </div>
      </div>

      <div className="card overflow-hidden">
        {leads.isLoading ? <TableSkeleton cols={7} /> : leads.isError ? <Empty title="Não foi possível carregar" text={errMsg(leads.error)} /> : !list.length ? (
          <Empty
            title={all.length ? "Sem resultados" : "Sem clientes a ser tratados"}
            text={all.length ? "Nenhuma lead corresponde aos filtros." : "Cria uma lead com os dados da conversão e os documentos. Passa a cliente quando carregares em Avançar."}
            action={canEdit && !all.length ? <button className="btn btn-primary" onClick={() => setEdit("new")}><UserPlus size={15} /> Criar lead</button> : undefined}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Serviço</th>
                    <th>Estado</th>
                    <th>Comercial</th>
                    <th>Contacto</th>
                    <th className="text-right">Docs</th>
                    <th>Data prevista</th>
                    <th aria-label="Ações" />
                  </tr>
                </thead>
                <tbody>
                  {paged.map((l) => {
                    const st = stageOf(l.stage);
                    return (
                      <tr key={l.id} className={canEdit ? "cursor-pointer" : ""} onClick={() => canEdit && setEdit(l)}>
                        <td>
                          <div className="flex items-center gap-3">
                            <Avatar name={l.name} color="var(--sky)" />
                            <div>
                              <div className="font-medium">{l.name}</div>
                              <div className="text-[11.5px] text-ink-3">{l.nif ?? "sem NIF"} · {fmtDate(l.createdAt)}</div>
                            </div>
                          </div>
                        </td>
                        <td className="text-[12.5px] text-ink-2">{l.service}</td>
                        <td><Pill label={st.label} tone={st.tone} /></td>
                        <td className="text-ink-2">{l.ownerName ?? "—"}</td>
                        <td className="num text-[12.5px] text-ink-2">{l.phone ?? "—"}</td>
                        <td className="text-right">
                          <span className="inline-flex items-center gap-1 text-[12.5px] text-ink-2"><Paperclip size={13} />{Number(l.docCount ?? 0)}</span>
                        </td>
                        <td className="num text-[12.5px] text-ink-2">{fmtDate(l.expectedClose)}</td>
                        <td className="w-64 whitespace-nowrap text-right">
                          {canEdit && <span className="btn-icon"><Pencil size={14} /></span>}
                          <button
                            type="button"
                            title={canEdit ? "Registar um report desta lead" : "Ver os reports desta lead"}
                            className="btn btn-ghost ml-1 h-8 text-[12px]"
                            onClick={(e) => { e.stopPropagation(); setReporting(l); }}
                          >
                            Report <MessageSquarePlus size={13} />
                          </button>
                          {canEdit && (
                            <button
                              type="button"
                              className="btn btn-ghost ml-1 h-8 text-[12px]"
                              onClick={(e) => { e.stopPropagation(); setAdvancing(l); }}
                            >
                              Avançar <ArrowRight size={13} />
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

      <Modal
        open={edit !== null}
        onClose={() => setEdit(null)}
        title={edit === "new" ? "Nova lead" : `Lead — ${edit?.name ?? ""}`}
        size="xl"
      >
        {edit !== null && canEdit && <LeadForm initial={edit === "new" ? null : edit} onClose={() => setEdit(null)} canEdit={canEdit} />}
      </Modal>

      <AdvanceModal lead={advancing} onClose={() => setAdvancing(null)} />
      <ReportModal lead={reporting} canEdit={canEdit} onClose={() => setReporting(null)} />
    </div>
  );
}

/** Serviços disponíveis numa lead (mantém a ordem do simulador/vendas). */
export const LEAD_SERVICES = SERVICE_LABELS;
