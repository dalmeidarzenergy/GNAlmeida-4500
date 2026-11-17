import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, CalendarClock, ClipboardList, ExternalLink, MessageSquarePlus, Paperclip, Trash2, UserSearch, ArrowRight } from "lucide-react";
import { useAllLeadReports, useLeadReportsMutation } from "../queries/sales";
import { useMe } from "../queries/me";
import { useEmployeeOptions } from "../queries/hr";
import { PageHeader, Stat, Pill, Tabs, SearchBox, Empty, TableSkeleton, Avatar } from "../components/ui/kit";
import { errMsg, fmtDate } from "../lib/format";

type Row = NonNullable<ReturnType<typeof useAllLeadReports>["data"]>[number];

/** Estados de tratamento de uma lead (o mesmo vocabulário da ficha). */
const STAGES = [
  { key: "nova", label: "Nova", tone: "sky" },
  { key: "contacto", label: "Em contacto", tone: "amber" },
  { key: "proposta", label: "Proposta enviada", tone: "volt" },
  { key: "docs", label: "Documentação", tone: "amber" },
  { key: "negociacao", label: "Em negociação", tone: "green" },
] as const;
const stageOf = (s: string | null | undefined) => STAGES.find((x) => x.key === s) ?? STAGES[0];

const KINDS = [
  { key: "atualizacao", label: "Atualização", tone: "sky" },
  { key: "contacto", label: "Contacto", tone: "volt" },
  { key: "problema", label: "Problema", tone: "red" },
] as const;
type Kind = (typeof KINDS)[number]["key"];
const kindOf = (k: string) => KINDS.find((x) => x.key === k) ?? KINDS[0];

const PROBLEMS: Record<string, string> = {
  ko: "KO",
  documento: "Falta de documento",
  "sem-resposta": "Cliente não responde",
  dados: "Dados errados / incompletos",
  outro: "Outro",
};

const hhmm = (d: string | Date) => new Date(d).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });

/** Cabeçalho do dia: hoje, ontem, ou a data por extenso. */
function dayLabel(d: string | Date) {
  const date = new Date(d);
  const today = new Date();
  const iso = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  if (iso(date) === iso(today)) return "Hoje";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (iso(date) === iso(yesterday)) return "Ontem";
  return date.toLocaleDateString("pt-PT", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const PAGE = 40;

export default function ReportsVendaPage() {
  const me = useMe();
  const all = useAllLeadReports();
  const { remove } = useLeadReportsMutation();
  const [, navigate] = useLocation();
  const staff = useEmployeeOptions().data ?? [];
  const canEdit = me.data?.permissions?.["clientes-a-tratar"]?.edit ?? false;

  const [kind, setKind] = useState<"todos" | Kind>("todos");
  const [q, setQ] = useState("");
  const [owner, setOwner] = useState<number | null>(null);
  const [onlyFollow, setOnlyFollow] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [error, setError] = useState<string | null>(null);

  const rows = all.data ?? [];
  const today = todayISO();

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows
      .filter((r) => kind === "todos" || r.kind === kind)
      .filter((r) => owner == null || r.ownerId === owner)
      .filter((r) => !onlyFollow || (!!r.followUp && r.followUp < today))
      .filter(
        (r) =>
          !s ||
          r.note.toLowerCase().includes(s) ||
          (r.leadName ?? "").toLowerCase().includes(s) ||
          (r.authorName ?? "").toLowerCase().includes(s) ||
          (r.leadNif ?? "").includes(s),
      );
  }, [rows, kind, owner, onlyFollow, q, today]);

  const visible = list.slice(0, shown);

  /** Um bloco por dia, para ler como um registo. */
  const days = useMemo(() => {
    const out: { key: string; label: string; rows: Row[] }[] = [];
    for (const r of visible) {
      const key = new Date(r.createdAt).toDateString();
      const last = out[out.length - 1];
      if (last && last.key === key) last.rows.push(r);
      else out.push({ key, label: dayLabel(r.createdAt), rows: [r] });
    }
    return out;
  }, [visible]);

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const countKind = (k: Kind) => rows.filter((r) => r.kind === k).length;
  const late = rows.filter((r) => r.followUp && r.followUp < today).length;
  const owners = useMemo(() => {
    const ids = new Set(rows.map((r) => r.ownerId).filter((x): x is number => x != null));
    return staff.filter((s) => ids.has(s.id));
  }, [rows, staff]);

  const open = (r: Row) => {
    if (r.leadConvertedSaleId) navigate(`/venda/${r.leadConvertedSaleId}`);
    else navigate(`/clientes-a-tratar?lead=${r.leadId}`);
  };

  return (
    <div>
      <PageHeader
        eyebrow="Vendas"
        title="Reports à venda"
        subtitle="Tudo o que os comerciais registam nas leads: visitas, contactos, atualizações e problemas. Fica guardado com data, hora e autor."
      >
        <button className="btn btn-ghost" onClick={() => navigate("/clientes-a-tratar")}>
          <UserSearch size={15} /> Clientes a ser tratados
        </button>
      </PageHeader>

      <div className="rise mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat delay={0} label="Reports" value={rows.length} accent="var(--volt)" sub="no total" />
        <Stat delay={60} label="Últimos 7 dias" value={rows.filter((r) => new Date(r.createdAt) >= weekAgo).length} accent="var(--sky)" sub="registados esta semana" />
        <Stat delay={120} label="Problemas" value={countKind("problema")} accent="#fb7185" sub="obstáculos sinalizados" />
        <Stat delay={180} label="Seguimento atrasado" value={late} accent="var(--amber)" sub="data já passou" />
      </div>

      <div className="rise mb-4 flex flex-wrap items-center gap-3">
        <Tabs
          value={kind}
          onChange={(v) => {
            setKind(v);
            setShown(PAGE);
          }}
          items={[
            { key: "todos" as const, label: "Todos", count: rows.length },
            ...KINDS.map((k) => ({ key: k.key, label: k.label, count: countKind(k.key) })),
          ]}
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
            <input type="checkbox" aria-label="Só seguimentos atrasados" checked={onlyFollow} onChange={(e) => setOnlyFollow(e.target.checked)} />
            Só seguimentos atrasados
          </label>
          {owners.length > 1 && (
            <select
              aria-label="Comercial"
              className="input h-10 w-52"
              value={owner ?? ""}
              onChange={(e) => {
                setOwner(e.target.value ? Number(e.target.value) : null);
                setShown(PAGE);
              }}
            >
              <option value="">Todos os comerciais</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          <SearchBox
            value={q}
            onChange={(v) => {
              setQ(v);
              setShown(PAGE);
            }}
            placeholder="Cliente, NIF, nota ou autor…"
          />
        </div>
      </div>

      {error && <p className="mb-3 rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</p>}

      {all.isLoading ? (
        <div className="card overflow-hidden"><TableSkeleton cols={3} /></div>
      ) : all.isError ? (
        <Empty title="Não foi possível carregar" text={errMsg(all.error)} />
      ) : !list.length ? (
        <Empty
          title={rows.length ? "Sem resultados" : "Ainda não há reports"}
          text={
            rows.length
              ? "Nenhum report corresponde aos filtros."
              : "Os reports fazem-se na lead: abre Clientes a ser tratados, carrega em Report e fica tudo registado aqui."
          }
          action={
            !rows.length ? (
              <button className="btn btn-primary" onClick={() => navigate("/clientes-a-tratar")}>
                <MessageSquarePlus size={15} /> Ir para as leads
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-6">
          {days.map((day) => (
            <section key={day.key}>
              <div className="mb-2 flex items-center gap-3">
                <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-3">{day.label}</h2>
                <span className="num text-[11.5px] text-ink-3">{day.rows.length}</span>
                <span className="h-px flex-1 bg-line" />
              </div>
              <div className="space-y-2.5">
                {day.rows.map((r) => {
                  const k = kindOf(r.kind);
                  const st = stageOf(r.leadStage ?? r.stage);
                  const docs = r.documents ?? [];
                  const lateThis = !!r.followUp && r.followUp < today;
                  return (
                    <article key={r.id} className="rise card p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Pill label={k.label} tone={k.tone} />
                        {r.kind === "problema" && r.problemType && (
                          <span className="inline-flex items-center gap-1 text-[11.5px] text-danger">
                            <AlertTriangle size={12} /> {PROBLEMS[r.problemType] ?? r.problemType}
                          </span>
                        )}
                        <span className="text-[11.5px] text-ink-3">·</span>
                        <span className="text-[11.5px] text-ink-2">{st.label}</span>
                        <span className="num ml-auto shrink-0 text-[11.5px] text-ink-3">{hhmm(r.createdAt)}</span>
                      </div>

                      <button type="button" className="mt-2 flex items-center gap-2.5 text-left" onClick={() => open(r)} title="Abrir a ficha">
                        <Avatar name={r.leadName ?? "?"} color="var(--sky)" />
                        <span>
                          <span className="block text-[13.5px] font-semibold hover:text-volt">{r.leadName ?? `Lead ${r.leadId}`}</span>
                          <span className="block text-[11.5px] text-ink-3">
                            {r.leadService ?? "—"} · {r.leadNif ?? "sem NIF"} · Comercial: {r.ownerName ?? "—"}
                            {r.leadConvertedAt ? " · já em Clientes e Vendas" : ""}
                          </span>
                        </span>
                      </button>

                      <p className="mt-2.5 whitespace-pre-wrap text-[13px] text-ink">{r.note}</p>

                      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px] text-ink-3">
                        <span className="font-medium text-ink-2">{r.authorName ?? "—"}</span>
                        {r.followUp && (
                          <span className={`inline-flex items-center gap-1 ${lateThis ? "text-amber" : ""}`}>
                            <CalendarClock size={12} /> Seguimento: {fmtDate(r.followUp)}
                          </span>
                        )}
                        {docs.map((d) => (
                          <a key={d.id} href={d.path} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-volt">
                            <Paperclip size={12} /> {d.name}
                          </a>
                        ))}
                        <span className="ml-auto flex items-center gap-1">
                          <button type="button" className="btn btn-ghost h-7 px-2 text-[11.5px]" onClick={() => open(r)}>
                            {r.leadConvertedSaleId ? "Ver venda" : "Abrir lead"} <ExternalLink size={11} />
                          </button>
                          {canEdit && (
                            <button
                              type="button"
                              aria-label="Eliminar report"
                              className="btn-icon hover:!text-danger"
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
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}

          {list.length > shown && (
            <div className="flex justify-center">
              <button className="btn btn-ghost" onClick={() => setShown(shown + PAGE)}>
                <ClipboardList size={14} /> Mostrar mais {Math.min(PAGE, list.length - shown)} <ArrowRight size={14} className="rotate-90" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
