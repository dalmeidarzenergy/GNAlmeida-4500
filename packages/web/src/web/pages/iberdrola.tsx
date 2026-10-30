import { useMemo, useRef, useState } from "react";
import { FileSpreadsheet, Upload, Trash2, Loader2, Wallet, Undo2, Check, Download, Eye, Pencil, Scale, Unlock, ArrowLeftRight, Ban, CircleSlash, ShieldAlert } from "lucide-react";
import { PageHeader, Empty, Field, Tabs, Stat, Modal } from "../components/ui/kit";
import { useIberdrolaImports, useIberdrolaImport, useIberdrolaCalc, useSaveIberdrola, useRemoveIberdrola, useSetIberdrolaMonth, useIberdrolaForceCommissionsSet, useIberdrolaVncAdd, useIberdrolaVncRemove, useIberdrolaOverrideList, useIberdrolaOverrideCreate, useIberdrolaOverrideRemove, useIberdrolaStaffList, useIberdrolaTeams, useIberdrolaBlockAdd, useIberdrolaBlockRemove, useIberdrolaSwapQuote } from "../queries/iberdrola";
import { useRules, useRuleAssignments, useSaveRuleAssignments } from "../queries/rules";
import { useMe } from "../queries/me";
import { errMsg, fmtDate, fmtEur2, monthLabel, thisMonth } from "../lib/format";
import { authClient } from "../lib/auth";

/** Descarrega o ficheiro original (com auth via bearer token). */
async function downloadImport(id: number, filename: string) {
  const token = authClient.managedAuth.getToken();
  const res = await fetch(`${window.location.origin}/api/iberdrola/file/${id}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Erro ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = window.document.createElement("a");
  a.href = url;
  a.download = filename || `iberdrola-${id}.xlsx`;
  window.document.body.appendChild(a);
  a.click();
  window.document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Descarrega o PDF detalhado de um comercial (via Chrome headless no servidor). */
async function downloadPdf(month: string, employeeId: number) {
  const token = authClient.managedAuth.getToken();
  const res = await fetch(`${window.location.origin}/api/iberdrola/pdf/${month}/${employeeId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Erro ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = window.document.createElement("a");
  a.href = url;
  a.download = `Auto_Iberdrola_${month}.pdf`;
  window.document.body.appendChild(a);
  a.click();
  window.document.body.removeChild(a);
  URL.revokeObjectURL(url);
  // O servidor guarda também uma cópia na página Autos e devolve a etiqueta.
  const label = res.headers.get("X-Auto-Label");
  const dup = res.headers.get("X-Auto-Duplicate") === "1";
  return { label: label ? decodeURIComponent(label) : null, duplicate: dup };
}

/** Descarrega o Excel geral dos autos do mês (uma folha por comercial). */
async function downloadExcel(month: string) {
  const token = authClient.managedAuth.getToken();
  const res = await fetch(`${window.location.origin}/api/iberdrola/export-excel/${month}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Erro ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = window.document.createElement("a");
  a.href = url;
  a.download = `Auto_Iberdrola_${month}.xlsx`;
  window.document.body.appendChild(a);
  a.click();
  window.document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

type Tab = "historico" | "finais";

export default function IberdrolaPage() {
  const me = useMe();
  const [tab, setTab] = useState<Tab>("historico");
  const canEdit = me.data?.permissions?.["auto-iberdrola"]?.edit ?? false;

  return (
    <div className="p-5 lg:p-7">
      <PageHeader eyebrow="Pagamentos" title="Auto Iberdrola" subtitle="Excel exportado da Iberdrola com as vendas dos comerciais. Guarda o ficheiro no histórico e calcula os valores por comercial a partir das tabelas comissionais do CRM.">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { key: "historico" as const, label: "Histórico de Autos" },
            { key: "finais" as const, label: "Autos Finais" },
          ]}
        />
      </PageHeader>
      {tab === "historico" ? <Historico canEdit={canEdit} /> : <Finais />}
    </div>
  );
}

function Historico({ canEdit }: { canEdit: boolean }) {
  const imports = useIberdrolaImports();
  const save = useSaveIberdrola();
  const remove = useRemoveIberdrola();
  const moveMonth = useSetIberdrolaMonth();
  const input = useRef<HTMLInputElement>(null);
  const [month, setMonth] = useState(thisMonth());
  const [viewing, setViewing] = useState<number | null>(null);
  const [downloading, setDownloading] = useState<number | null>(null);

  async function onFile(f: File | undefined) {
    if (!f) return;
    try {
      await save.save.mutateAsync({ file: f, month });
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  async function onDownload(id: number, filename: string, downloadable: boolean) {
    if (!downloadable) {
      window.alert("Este ficheiro foi carregado antes de a app guardar o original, por isso já não é possível descarregá-lo. Carrega-o de novo para ficar guardado.");
      return;
    }
    setDownloading(id);
    try {
      await downloadImport(id, filename);
    } catch (e) {
      window.alert(`Não foi possível descarregar: ${errMsg(e)}`);
    } finally {
      setDownloading(null);
    }
  }

  const list = imports.data ?? [];

  return (
    <div>
      {!canEdit ? (
        <div className="card"><Empty title="Sem acesso" text="Só pode carregar ficheiros quem tem permissão de edição." /></div>
      ) : (
        <div className="card mb-6 overflow-hidden">
          <div className="flex flex-wrap items-end gap-4 px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="font-display text-[15px] font-semibold">Carregar Excel da Iberdrola</div>
              <div className="text-[11.5px] text-ink-3">O ficheiro tem as folhas <span className="text-ink">auto</span> (vendas), <span className="text-ink">chargeback</span> (baixas) e <span className="text-ink">Medem</span> (pontos).</div>
            </div>
            <Field label="Mês de referência">
              <input type="month" className="input num w-44" value={month} onChange={(e) => setMonth(e.target.value)} />
            </Field>
            <button type="button" className="btn btn-volt" disabled={save.isPending} onClick={() => input.current?.click()}>
              {save.isPending ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Carregar ficheiro
            </button>
            <input ref={input} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </div>
          {save.error && <div className="border-t border-line px-5 py-3 text-[12.5px] text-danger">{save.error}</div>}
        </div>
      )}

      {imports.isLoading ? (
        <div className="card p-5"><div className="skeleton h-32 rounded-[12px]" /></div>
      ) : !list.length ? (
        <div className="card"><Empty title="Sem ficheiros carregados" text="Carrega o Excel exportado da Iberdrola para começar." /></div>
      ) : (
        <div className="card overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <div className="font-display text-[15px] font-semibold">Histórico</div>
            <div className="text-[11.5px] text-ink-3">{list.length} ficheiro{list.length === 1 ? "" : "s"}</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="px-5 py-3 font-medium">FICHEIRO</th>
                  <th className="px-3 py-3 font-medium">MÊS</th>
                  <th className="px-3 py-3 text-right font-medium">AUTO</th>
                  <th className="px-3 py-3 text-right font-medium">CHARGEBACK</th>
                  <th className="px-3 py-3 text-right font-medium">MEDEM</th>
                  <th className="px-3 py-3 font-medium">CARREGADO POR</th>
                  <th className="px-3 py-3 font-medium">DATA</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <Row key={r.id} id={r.id} onOpen={setViewing} onDownload={() => onDownload(r.id, r.filename, r.downloadable)} downloading={downloading === r.id} filename={r.filename} month={r.month} auto={r.auto} chargeback={r.chargeback} medem={(r as any).medem ?? 0} uploadedBy={r.uploadedBy} createdAt={r.createdAt} canEdit={canEdit} onDelete={() => remove.mutateAsync({ id: r.id })} onSetMonth={(m) => moveMonth.mutate({ id: r.id, month: m })} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={viewing != null} onClose={() => setViewing(null)} title="Linhas do ficheiro" wide>
        {viewing != null && <ImportLines id={viewing} />}
      </Modal>
    </div>
  );
}

function Row(props: { id: number; onOpen: (id: number) => void; onDownload: () => void; downloading: boolean; filename: string; month: string; auto: number; chargeback: number; medem: number; uploadedBy: string; createdAt: Date; canEdit: boolean; onDelete: () => void; onSetMonth: (m: string) => void }) {
  const created = props.createdAt instanceof Date ? props.createdAt : new Date(props.createdAt);
  const [editing, setEditing] = useState(false);
  return (
    <tr className="border-b border-line last:border-0">
      <td className="px-5 py-3">
        <div className="flex items-center gap-1">
          <button type="button" className="flex items-center gap-2 text-left font-medium hover:text-volt" onClick={props.onDownload} title="Descarregar o Excel original">
            {props.downloading ? <Loader2 size={15} className="animate-spin text-volt" /> : <Download size={15} className="text-volt" />}
            {props.filename}
          </button>
          <button type="button" className="btn-icon" aria-label="Ver linhas" title="Ver linhas" onClick={() => props.onOpen(props.id)}>
            <Eye size={14} />
          </button>
        </div>
      </td>
      <td className="px-3 py-3 text-ink-2">
        {editing ? (
          <input
            type="month"
            autoFocus
            className="input num w-36"
            defaultValue={props.month}
            onBlur={(e) => { setEditing(false); if (e.target.value && e.target.value !== props.month) props.onSetMonth(e.target.value); }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
          />
        ) : (
          <button
            type="button"
            disabled={!props.canEdit}
            onClick={() => props.canEdit && setEditing(true)}
            className={`inline-flex items-center gap-1.5 rounded-[7px] px-1.5 py-0.5 ${props.canEdit ? "hover:bg-volt/10 hover:text-volt" : "cursor-default"}`}
            title={props.canEdit ? "Mudar o mês de pagamento" : undefined}
          >
            {monthLabel(props.month)}
            {props.canEdit && <Pencil size={11} className="opacity-50" />}
          </button>
        )}
      </td>
      <td className="num px-3 py-3 text-right">{props.auto}</td>
      <td className="num px-3 py-3 text-right text-ink-2">{props.chargeback}</td>
      <td className="num px-3 py-3 text-right text-ink-2">{props.medem}</td>
      <td className="px-3 py-3 text-ink-2">{props.uploadedBy}</td>
      <td className="px-3 py-3 text-ink-2">{fmtDate(created)}</td>
      <td className="px-5 py-3 text-right">
        {props.canEdit && <button type="button" className="btn-icon" aria-label="Apagar" onClick={props.onDelete}><Trash2 size={14} /></button>}
      </td>
    </tr>
  );
}

function ImportLines({ id }: { id: number }) {
  const data = useIberdrolaImport(id);
  if (data.isLoading) return <div className="skeleton h-40 rounded-[12px]" />;
  if (!data.data?.found) return <Empty title="Não encontrado" text="O ficheiro já não existe." />;
  const rows = data.data.rows;
  const auto = rows.filter((r) => r.sheet === "auto");
  const cb = rows.filter((r) => r.sheet === "chargeback");
  const medem = rows.filter((r) => r.sheet === "medem");
  const cols = useMemo(() => {
    const seen = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r.data)) seen.add(k);
    return [...seen];
  }, [rows]);

  function group(label: string, groupRows: typeof rows) {
    if (!groupRows.length) return null;
    return (
      <div className="mb-5">
        <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-ink-2">
          {label} <span className="num text-[11px] text-ink-3">{groupRows.length}</span>
        </div>
        <div className="max-h-[50vh] overflow-auto rounded-[10px] border border-line">
          <table className="w-full min-w-[900px] text-[12px]">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-line text-left">
                <th className="px-3 py-2 font-medium">ID venda</th>
                <th className="px-3 py-2 font-medium">Estado</th>
                {cols.slice(0, 18).map((c) => <th key={c} className="px-3 py-2 font-medium">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {groupRows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="num px-3 py-2 font-medium">{r.idVenda ?? "-"}</td>
                  <td className="px-3 py-2">{r.estado ?? "-"}</td>
                  {cols.slice(0, 18).map((c) => <td key={c} className="px-3 py-2 text-ink-2">{r.data[c] ?? ""}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div>
      {group("Folha auto", auto)}
      {group("Folha chargeback", cb)}
      {group("Folha Medem", medem)}
    </div>
  );
}

function Finais() {
  const [month, setMonth] = useState(thisMonth());
  const calc = useIberdrolaCalc(month);
  const teams = useIberdrolaTeams(month);
  const [selected, setSelected] = useState<number | null>(null);
  const [teamLeader, setTeamLeader] = useState<string>(""); // empty = todos

  const data = calc.data;
  const allPeople = data?.people ?? [];

  // Filtra por equipa se um líder estiver selecionado.
  const selectedTeam = teamLeader ? teams.data?.find((t) => String(t.id) === teamLeader) : null;
  const memberIds = selectedTeam ? new Set(selectedTeam.members.map((m) => m.employeeId)) : null;
  const people = memberIds ? allPeople.filter((p) => memberIds.has(p.employeeId)) : allPeople;
  const totals = {
    gross: Math.round(people.reduce((s, p) => s + p.gross, 0) * 100) / 100,
    chargeback: Math.round(people.reduce((s, p) => s + p.chargeback, 0) * 100) / 100,
    medemTotal: Math.round(people.reduce((s, p) => s + p.medemTotal, 0) * 100) / 100,
    due: Math.round(people.reduce((s, p) => s + p.due, 0) * 100) / 100,
  };

  return (
    <div>
      <div className="flex items-center gap-3">
        <Field label="Mês">
          <input type="month" className="input num w-44" value={month} onChange={(e) => { setMonth(e.target.value); setSelected(null); setTeamLeader(""); }} />
        </Field>
        <Field label="Chefe de equipa">
          <select className="input w-56" value={teamLeader} onChange={(e) => { setTeamLeader(e.target.value); setSelected(null); }}>
            <option value="">Todas as equipas</option>
            {(teams.data ?? []).map((t) => (
              <option key={t.id} value={String(t.id)}>{t.leaderName} — {t.name}</option>
            ))}
          </select>
        </Field>
        <button type="button" className="btn btn-ghost" onClick={() => downloadExcel(month).catch((e) => window.alert(errMsg(e)))} title="Exportar Excel geral (uma folha por comercial).">
          <Download size={15} /> Exportar Excel
        </button>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="A RECEBER" value={fmtEur2(totals.gross)} accent="var(--volt)" icon={<Wallet size={16} />} delay={0} />
        <Stat label="CHARGEBACK" value={fmtEur2(totals.chargeback)} accent="var(--danger)" icon={<Undo2 size={16} />} delay={60} />
        <Stat label="MEDEM" value={fmtEur2(totals.medemTotal)} accent="var(--amber)" icon={<Wallet size={16} />} delay={90} />
        <Stat label="TOTAL" value={fmtEur2(totals.due)} accent="var(--sky)" icon={<Check size={16} />} delay={120} />
      </div>

      {(data?.unmatchedAuto.length || data?.unmatchedChargeback.length || (data as any)?.unmatchedMedem?.length) ? (
        <div className="mt-4 rounded-[12px] border border-danger/30 bg-danger/5 px-4 py-3 text-[12.5px] text-danger">
          {data.unmatchedAuto.length > 0 && <div>{data.unmatchedAuto.length} vendas do Excel não têm comercial identificado no Excel (ID de venda: {data.unmatchedAuto.join(", ")}).</div>}
          {data.unmatchedChargeback.length > 0 && <div>{data.unmatchedChargeback.length} baixas do chargeback não têm comercial identificado no Excel (ID de venda: {data.unmatchedChargeback.join(", ")}).</div>}
          {(data as any).unmatchedMedem?.length > 0 && <div>{(data as any).unmatchedMedem.length} linhas de Medem não têm comercial identificado no Excel (ID de venda: {(data as any).unmatchedMedem.join(", ")}).</div>}
        </div>
      ) : null}

      <div className="mt-6 grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="card overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <div className="font-display text-[13px] font-semibold">Comerciais</div>
            <div className="text-[11px] text-ink-3">{people.length} com vendas{teamLeader && selectedTeam ? ` (equipa ${selectedTeam.name})` : ""} em {monthLabel(month)}</div>
          </div>
          {calc.isLoading ? (
            <div className="p-4"><div className="skeleton h-24 rounded-[12px]" /></div>
          ) : !people.length ? (
            <Empty title="Sem autos neste mês" text="Carrega um ficheiro Iberdrola neste mês para ver os cálculos." />
          ) : (
            <ul className="divide-y divide-line">
              {people.map((p) => (
                <li key={p.employeeId}>
                  <button type="button" onClick={() => setSelected(selected === p.employeeId ? null : p.employeeId)} className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-volt/5 ${selected === p.employeeId ? "bg-volt/10" : ""}`}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium">{p.employeeName}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-3">
                        {p.missingTable ? <span className="text-danger">sem tabela</span> : <span>{p.tableName}</span>}
                        <span>·</span>
                        <span>{p.salesCount} vendas</span>
                      </span>
                    </span>
                    <span className="num text-[12.5px] font-semibold">{fmtEur2(p.due)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <div className="font-display text-[15px] font-semibold">Detalhe</div>
            <div className="text-[11.5px] text-ink-3">Vendas de cada comercial e respetivos valores.</div>
          </div>
          {selected != null ? (
            <PersonDetail employeeId={selected} people={people} month={month} />
          ) : (
            <div className="p-6">{calc.isLoading ? <div className="skeleton h-40 rounded-[12px]" /> : <Empty title="Escolhe um comercial" text="Seleciona um comercial na lista para ver as vendas." />}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function PersonDetail({ employeeId, people, month }: { employeeId: number; people: NonNullable<ReturnType<typeof useIberdrolaCalc>["data"]>["people"]; month: string }) {
  const p = people.find((x) => x.employeeId === employeeId);
  const me = useMe();
  const canEdit = me.data?.permissions?.["regras"]?.edit ?? false;
  // Bloqueios de comissão: só admin e diretor, independentemente das permissões do módulo.
  const canBlock = me.data?.role === "admin" || me.data?.role === "diretor";
  const rules = useRules();
  const employeeIds = useMemo(() => [employeeId], [employeeId]);
  const assignments = useRuleAssignments(month, employeeIds);
  const saveAssignments = useSaveRuleAssignments();
  const setForce = useIberdrolaForceCommissionsSet();
  const vncAdd = useIberdrolaVncAdd();
  const vncRemove = useIberdrolaVncRemove();
  const [assigning, setAssigning] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());
  const [forceOpen, setForceOpen] = useState(false);
  const [vncOpen, setVncOpen] = useState(false);
  const [vncIdVenda, setVncIdVenda] = useState("");
  const [vncAmount, setVncAmount] = useState("");

  // Bloqueios de comissão (só admin/diretor).
  const blockAdd = useIberdrolaBlockAdd();
  const blockRemove = useIberdrolaBlockRemove();
  const [blockKind, setBlockKind] = useState<"total" | "parcial" | null>(null);
  const [blockMode, setBlockMode] = useState<"eur" | "pct">("eur");
  const [blockValue, setBlockValue] = useState("");
  const [blockNote, setBlockNote] = useState("");

  // Troca de venda
  const overrideList = useIberdrolaOverrideList(month);
  const overrideCreate = useIberdrolaOverrideCreate();
  const overrideRemove = useIberdrolaOverrideRemove();
  const [swapOpen, setSwapOpen] = useState(false);
  const [swapStep, setSwapStep] = useState<1 | 2 | 3>(1);
  // Tabela com que cada venda e paga no destino: "atual" ou "destino".
  const [swapPricing, setSwapPricing] = useState<Record<string, "atual" | "destino">>({});
  const [swapIds, setSwapIds] = useState<string[]>([]);
  const [swapSearch, setSwapSearch] = useState("");
  const [swapToId, setSwapToId] = useState<number | null>(null);
  const [swapDestSearch, setSwapDestSearch] = useState("");
  const [swapBusy, setSwapBusy] = useState(false);
  // Precos de cada venda selecionada pela tabela de origem e pela de destino.
  const swapQuote = useIberdrolaSwapQuote(month, employeeId, swapToId);
  const swapQuoteById = useMemo(() => {
    const m = new Map<string, { byFrom: number | null; byTo: number | null }>();
    for (const q of (swapQuote.data?.sales ?? [])) m.set(q.idVenda, { byFrom: q.byFrom, byTo: q.byTo });
    return m;
  }, [swapQuote.data]);

  const toggleSwapId = (id: string) =>
    setSwapIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // Destino da troca: TODOS os colaboradores, nao so os que ja tem vendas no mes.
  const staff = useIberdrolaStaffList(month);
  const otherEmployees = useMemo(() => {
    const fromStaff = (staff.data ?? []) as Array<{ employeeId: number; employeeName: string }>;
    const calcData = (people as Array<{ employeeId: number; employeeName: string }>);
    const list = fromStaff.length > 0 ? fromStaff : calcData;
    return list.filter((x) => x.employeeId !== employeeId).sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  }, [staff.data, people, employeeId]);

  const currentSales = useMemo(() => {
    if (!p) return [];
    // Todas as vendas do comercial no mes, mesmo as bloqueadas pelo objetivo,
    // senao nao seria possivel trocar uma venda que ainda nao esta a ser paga.
    const all = (p as { allSaleIds?: string[] }).allSaleIds ?? [];
    const ids = new Set(all.length > 0 ? all : p.lines.map((l) => l.idVenda));
    return [...ids].sort();
  }, [p]);
  if (!p) return <div className="p-6"><Empty title="Sem dados" text="Não foi possível encontrar este comercial." /></div>;

  const manualRules = (rules.data ?? []).filter((r) => r.type === "manual");
  const assignedIds = new Set((assignments.data ?? []).map((a) => a.ruleId));
  const blockRows = ((p as { blocks?: { id: number; kind: string; mode: string; value: number; cut: number; note: string | null }[] }).blocks ?? []);

  function medemTable(title: string, person: typeof p) {
    const lines = (person as any).medemLines as Array<{ idVenda: string; pontos: number; commission: number; total: number }> | undefined;
    if (!lines || !lines.length) return null;
    const sumPontos = lines.reduce((t, l) => t + l.pontos, 0);
    const sumTotal = lines.reduce((t, l) => t + l.total, 0);
    return (
      <div className="mb-5">
        <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-2">{title}</div>
        <div className="overflow-x-auto rounded-[10px] border border-line">
          <table className="w-full min-w-[480px] text-[12.5px]">
            <thead className="bg-surface">
              <tr className="border-b border-line text-left">
                <th className="px-3 py-2 font-medium">ID venda</th>
                <th className="px-3 py-2 text-right font-medium">Pontos</th>
                <th className="px-3 py-2 text-right font-medium">Comissão (€/pto)</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="num px-3 py-2 font-medium">{l.idVenda}</td>
                  <td className="num px-3 py-2 text-right">{l.pontos}</td>
                  <td className="num px-3 py-2 text-right text-ink-2">{fmtEur2(l.commission)}</td>
                  <td className="num px-3 py-2 text-right font-semibold">{fmtEur2(l.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line bg-surface text-[12px] text-ink-2">
                <td className="px-3 py-2 font-medium">{lines.length} linha{lines.length === 1 ? "" : "s"}</td>
                <td className="num px-3 py-2 text-right">{sumPontos}</td>
                <td className="num px-3 py-2 text-right">—</td>
                <td className="num px-3 py-2 text-right font-semibold text-ink">{fmtEur2(sumTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  }

  function lineTable(title: string, lines: typeof p.lines) {
    if (!lines.length) return null;
    const sum = (f: (l: typeof lines[number]) => number) => lines.reduce((t, l) => t + f(l), 0);
    return (
      <div className="mb-5">
        <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-2">{title}</div>
        <div className="overflow-x-auto rounded-[10px] border border-line">
          <table className="w-full min-w-[680px] text-[12.5px]">
            <thead className="bg-surface">
              <tr className="border-b border-line text-left">
                <th className="px-3 py-2 font-medium">ID venda</th>
                <th className="px-3 py-2 font-medium">Serviço</th>
                <th className="px-3 py-2 text-right font-medium">Base</th>
                <th className="px-3 py-2 text-right font-medium">Déb. Direto</th>
                <th className="px-3 py-2 text-right font-medium">Fat. Eletrónica</th>
                <th className="px-3 py-2 text-right font-medium">PEL</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="num px-3 py-2 font-medium">{l.idVenda}</td>
                  <td className="px-3 py-2">{l.service}</td>
                  <td className="num px-3 py-2 text-right">{l.base ? fmtEur2(l.base) : "-"}</td>
                  <td className="num px-3 py-2 text-right text-ink-2">{l.dd ? fmtEur2(l.dd) : "-"}</td>
                  <td className="num px-3 py-2 text-right text-ink-2">{l.fe ? fmtEur2(l.fe) : "-"}</td>
                  <td className="num px-3 py-2 text-right text-ink-2">{l.pel ? fmtEur2(l.pel) : "-"}</td>
                  <td className="num px-3 py-2 text-right font-semibold">{fmtEur2(l.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line bg-surface text-[12px] text-ink-2">
                <td className="px-3 py-2 font-medium" colSpan={2}>{lines.length} linha{lines.length === 1 ? "" : "s"}</td>
                <td className="num px-3 py-2 text-right">{fmtEur2(sum((l) => l.base))}</td>
                <td className="num px-3 py-2 text-right">{fmtEur2(sum((l) => l.dd))}</td>
                <td className="num px-3 py-2 text-right">{fmtEur2(sum((l) => l.fe))}</td>
                <td className="num px-3 py-2 text-right">{fmtEur2(sum((l) => l.pel))}</td>
                <td className="num px-3 py-2 text-right font-semibold text-ink">{fmtEur2(sum((l) => l.total))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="p-5">
      {canBlock && blockRows.length > 0 && (
        <div className="mb-4 rounded-[10px] border border-rose/40 bg-rose/10 px-4 py-3">
          <div className="flex items-center gap-2 text-[12.5px] font-semibold text-rose">
            <ShieldAlert size={14} /> Comissão bloqueada
            <span className="rounded-full bg-rose/20 px-2 py-[1px] text-[10.5px] font-medium uppercase tracking-wide">Visível só para admin/diretor</span>
          </div>
          <div className="mt-2 grid gap-1.5">
            {blockRows.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
                <span className="font-medium text-ink">{b.kind === "total" ? "Bloqueio total" : "Bloqueio parcial"}</span>
                <span className="num">
                  {b.kind === "total"
                    ? `tudo a 0,00 € (corte de ${fmtEur2(b.cut)})`
                    : `${b.mode === "pct" ? `${b.value}%` : fmtEur2(b.value)} → corte de ${fmtEur2(b.cut)}`}
                </span>
                {b.note && <span className="text-ink-3">· {b.note}</span>}
                <button
                  type="button"
                  className="ml-auto shrink-0 rounded-[6px] p-1 text-ink-2 hover:bg-rose/20 hover:text-rose"
                  disabled={blockRemove.isPending}
                  onClick={() => blockRemove.mutateAsync({ id: b.id })}
                  title="Remover este bloqueio"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[11px] text-ink-3">O bloqueio não aparece no PDF nem no Excel entregues ao comercial.</div>
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="font-display text-[15px] font-semibold">{p.employeeName}</div>
            {canEdit && manualRules.length > 0 && (
              <button type="button" className="btn btn-volt px-2.5 py-1 text-[12px]" onClick={() => { setPendingIds(new Set(assignedIds)); setAssigning(true); }}>
                <Scale size={13} /> Atribuir
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                className={p.forceCommissionsPct > 0 ? "btn btn-volt px-2.5 py-1 text-[12px]" : "btn btn-ghost px-2.5 py-1 text-[12px]"}
                disabled={setForce.isPending}
                onClick={() => setForceOpen(true)}
                title={p.forceCommissionsPct > 0 ? `Comissões desbloqueadas a ${p.forceCommissionsPct}% — clique para alterar ou voltar ao objetivo.` : "Pagar comissões sem atingir o objetivo (a partir do 2.º escalão)."}
              >
                <Unlock size={13} /> {p.forceCommissionsPct > 0 ? `Comissões ${p.forceCommissionsPct}%` : "Desbloquear comissões"}
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                className="btn btn-ghost px-2.5 py-1 text-[12px]"
                onClick={() => { setVncIdVenda(""); setVncAmount(""); setVncOpen(true); }}
                title="Acrescentar uma penalidade VNC (multa ligada ao ID da venda)."
              >
                <Trash2 size={13} /> Acrescentar VNC
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                className="btn btn-ghost px-2.5 py-1 text-[12px]"
                onClick={() => { setSwapStep(1); setSwapSearch(""); setSwapIds([]); setSwapToId(null); setSwapDestSearch(""); setSwapPricing({}); setSwapOpen(true); }}
                title="Transferir uma venda deste comercial para outro."
              >
                <ArrowLeftRight size={13} /> Trocar venda
              </button>
            )}
            {canBlock && (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-[8px] border border-rose/40 bg-rose/10 px-2.5 py-1 text-[12px] font-medium text-rose hover:bg-rose/20"
                onClick={() => { setBlockValue(""); setBlockNote(""); setBlockMode("eur"); setBlockKind("total"); }}
                title="Bloqueia TODO o comissionamento deste colaborador neste mês (tudo a 0 €). Não aparece no PDF nem no Excel do comercial."
              >
                <Ban size={13} /> Bloqueio total
              </button>
            )}
            {canBlock && (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-[8px] border border-amber/40 bg-amber/10 px-2.5 py-1 text-[12px] font-medium text-amber hover:bg-amber/20"
                onClick={() => { setBlockValue(""); setBlockNote(""); setBlockMode("eur"); setBlockKind("parcial"); }}
                title="Bloqueia apenas o valor (€) ou a percentagem que indicares."
              >
                <CircleSlash size={13} /> Bloqueio parcial
              </button>
            )}
          </div>
          <div className="text-[11.5px] text-ink-3">{p.tableName ?? "Sem tabela comisional"}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-ghost px-2.5 py-1 text-[12px]"
            onClick={() =>
              downloadPdf(month, employeeId)
                .then((r) => {
                  if (r?.duplicate) window.alert(`O PDF de ${r.label ?? ""} já estava guardado na página Autos.`);
                })
                .catch((e) => window.alert(errMsg(e)))
            }
            title="Descarregar PDF detalhado deste comercial. Fica também guardado na página Autos."
          >
            <Download size={13} /> PDF
          </button>
          <Stat label="Escalão" value={String(p.bandSales)} accent="var(--amber)" />
          <Stat label="Vendas" value={String(p.salesCount)} accent="var(--sky)" />
          <Stat label="Devido" value={fmtEur2(p.due)} accent="var(--volt)" />
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <MiniStat label="Luz" value={String(p.luzCount)} />
        <MiniStat label="Gás" value={String(p.gasCount)} />
        <MiniStat label="Tabela" value={p.missingTable ? "—" : (p.tableName ?? "—")} />
        <MiniStat label="Base (luz+gás)" value={fmtEur2(p.baseAmount)} />
        <MiniStat label="Serviços" value={fmtEur2(p.svcAmount)} />
      </div>

      <div className="mb-5">
        <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-2">Escalão atingido</div>
        <div className="overflow-x-auto rounded-[10px] border border-line">
          <table className="w-full min-w-[560px] text-[12.5px]">
            <thead className="bg-surface">
              <tr className="border-b border-line text-left">
                <th className="px-3 py-2 font-medium">Item da tabela</th>
                <th className="px-3 py-2 text-right font-medium">Valor do escalão</th>
                <th className="px-3 py-2 text-right font-medium">Qtd. marcada</th>
                <th className="px-3 py-2 text-right font-medium">Total pago</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-line">
                <td className="px-3 py-2">Luz (base)</td>
                <td className="num px-3 py-2 text-right">{p.unit ? fmtEur2(p.unit.luz) : "-"}</td>
                <td className="num px-3 py-2 text-right">{p.luzCount}</td>
                <td className="num px-3 py-2 text-right font-semibold">{fmtEur2(p.unit ? p.unit.luz * p.luzCount : 0)}</td>
              </tr>
              <tr className="border-b border-line">
                <td className="px-3 py-2">Gás (base)</td>
                <td className="num px-3 py-2 text-right">{p.unit ? fmtEur2(p.unit.gas) : "-"}</td>
                <td className="num px-3 py-2 text-right">{p.gasCount}</td>
                <td className="num px-3 py-2 text-right font-semibold">{fmtEur2(p.unit ? p.unit.gas * p.gasCount : 0)}</td>
              </tr>
              {[
                { label: "Débito Direto", unit: p.unit?.dd ?? 0, qty: p.ddCount },
                { label: "Fatura Eletrónica", unit: p.unit?.fe ?? 0, qty: p.feCount },
                { label: "PEL", unit: p.unit?.pel ?? 0, qty: p.pelCount },
              ].map((r) => (
                <tr key={r.label} className="border-b border-line last:border-0">
                  <td className="px-3 py-2">{r.label}</td>
                  <td className="num px-3 py-2 text-right">{fmtEur2(r.unit)}</td>
                  <td className="num px-3 py-2 text-right">{r.qty}</td>
                  <td className="num px-3 py-2 text-right font-semibold">{fmtEur2(r.unit * r.qty)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line bg-surface text-[12px] text-ink-2">
                <td className="px-3 py-2 font-medium" colSpan={3}>Total a receber</td>
                <td className="num px-3 py-2 text-right font-semibold text-ink">{fmtEur2(p.gross)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {p.ruleEffects.length > 0 && (
        <div className="mb-5">
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-2">Regras aplicadas</div>
          <div className="overflow-x-auto rounded-[10px] border border-line">
            <table className="w-full min-w-[420px] text-[12.5px]">
              <thead className="bg-surface">
                <tr className="border-b border-line text-left">
                  <th className="px-3 py-2 font-medium">Regra</th>
                  <th className="px-3 py-2 font-medium">Tipo</th>
                  <th className="px-3 py-2 text-right font-medium">Valor</th>
                </tr>
              </thead>
              <tbody>
                {p.ruleEffects.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2 text-ink-2">{r.type === "auto" ? "Automática" : r.type === "unlock" ? "Desbloqueio" : r.type === "vnc" ? "VNC" : "Manual"}</td>
                    <td className={`num px-3 py-2 text-right font-semibold ${r.amount < 0 ? "text-rose" : ""}`}>{r.amount < 0 ? "−" : "+"}{fmtEur2(Math.abs(r.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {p.vncs.length > 0 && (
        <div className="mb-5">
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-2">Penalidades VNC</div>
          <div className="overflow-x-auto rounded-[10px] border border-line">
            <table className="w-full min-w-[420px] text-[12.5px]">
              <thead className="bg-surface">
                <tr className="border-b border-line text-left">
                  <th className="px-3 py-2 font-medium">ID venda</th>
                  <th className="px-3 py-2 text-right font-medium">Penalidade</th>
                  <th className="px-3 py-2 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {p.vncs.map((v) => (
                  <tr key={v.id} className="border-b border-line last:border-0">
                    <td className="num px-3 py-2 font-medium">{v.idVenda}</td>
                    <td className="num px-3 py-2 text-right font-semibold text-rose">−{fmtEur2(v.amount)}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="btn btn-ghost px-2 py-1 text-[11.5px] text-ink-2"
                        disabled={vncRemove.isPending}
                        onClick={() => vncRemove.mutateAsync({ id: v.id })}
                        title="Remover penalidade"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(p.overridesOut.length > 0 || p.overridesIn.length > 0) && (
        <div className="mb-5">
          <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-ink-2">Trocas de venda {canEdit && <span className="text-[11px] font-normal normal-case tracking-normal text-ink-3">(clica no ✕ para anular)</span>}</div>
          <div className="rounded-[10px] border border-line divide-y divide-line">
            {p.overridesOut.map((o) => (
              <div key={`out-${o.idVenda}`} className="flex items-center gap-2 px-3 py-2 text-[12.5px]">
                <ArrowLeftRight size={13} className="text-amber shrink-0" />
                <span className="num font-medium">{o.idVenda}</span>
                <span className="text-ink-2">→</span>
                <span>{o.toName}</span>
                <span className="text-[11px] text-ink-3">(cedida)</span>
                {canEdit && (
                  <button type="button" className="ml-auto shrink-0 rounded-[6px] p-1 text-ink-2 hover:bg-rose/10 hover:text-rose" disabled={overrideRemove.isPending} onClick={() => { const ov = (overrideList.data ?? []).find((x: { idVenda: string }) => x.idVenda === o.idVenda); if (ov) overrideRemove.mutateAsync({ id: ov.id }); }} title="Anular troca"><Trash2 size={12} /></button>
                )}
              </div>
            ))}
            {p.overridesIn.map((o) => (
              <div key={`in-${o.idVenda}`} className="flex items-center gap-2 px-3 py-2 text-[12.5px]">
                <ArrowLeftRight size={13} className="text-volt shrink-0" />
                <span className="num font-medium">{o.idVenda}</span>
                <span className="text-ink-2">←</span>
                <span>{o.fromName}</span>
                <span className="text-[11px] text-ink-3">(recebida)</span>
                {canEdit && (
                  <button type="button" className="ml-auto shrink-0 rounded-[6px] p-1 text-ink-2 hover:bg-rose/10 hover:text-rose" disabled={overrideRemove.isPending} onClick={() => { const ov = (overrideList.data ?? []).find((x: { idVenda: string }) => x.idVenda === o.idVenda); if (ov) overrideRemove.mutateAsync({ id: ov.id }); }} title="Anular troca"><Trash2 size={12} /></button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {lineTable("Vendas", p.lines)}
      {lineTable("Chargeback", p.chargebackLines)}
      {medemTable("Medem", p)}

      {(p as any).ceLines?.length > 0 && (
        <div className="mb-5">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-2">Comissão de chefe de equipa (CE)</div>
            <div className="text-[12px] font-semibold text-amber">{(p as any).ceBandSales} vendas BTN · escalão {fmtEur2((p as any).ceUnit?.luz ?? 0)} / {fmtEur2((p as any).ceUnit?.gas ?? 0)}</div>
          </div>
          <div className="overflow-x-auto rounded-[10px] border border-line">
            <table className="w-full min-w-[680px] text-[12.5px]">
              <thead className="bg-surface">
                <tr className="border-b border-line text-left">
                  <th className="px-3 py-2 font-medium">ID venda</th>
                  <th className="px-3 py-2 font-medium">Serviço</th>
                  <th className="px-3 py-2 text-right font-medium">Base</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {(p as any).ceLines.map((l: any, i: number) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="num px-3 py-2 font-medium">{l.idVenda}</td>
                    <td className="px-3 py-2">{l.service}</td>
                    <td className="num px-3 py-2 text-right">{l.base ? fmtEur2(l.base) : "-"}</td>
                    <td className="num px-3 py-2 text-right font-semibold">{fmtEur2(l.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-surface text-[12px] text-ink-2">
                  <td className="px-3 py-2 font-medium" colSpan={3}>Total CE</td>
                  <td className="num px-3 py-2 text-right font-semibold text-ink">{fmtEur2((p as any).ceGross)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <Modal open={assigning} onClose={() => setAssigning(false)} title={`Atribuir regras — ${monthLabel(month)}`}>
        <div className="grid gap-3">
          {manualRules.length === 0 ? (
            <Empty title="Sem regras manuais" text="Cria regras manuais na página Regras para as poderes atribuir." />
          ) : (
            manualRules.map((r) => (
              <label key={r.id} className="flex items-center gap-3 rounded-[10px] border border-line bg-surface px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={pendingIds.has(r.id)}
                  onChange={(e) => {
                    const next = new Set(pendingIds);
                    if (e.target.checked) next.add(r.id);
                    else next.delete(r.id);
                    setPendingIds(next);
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">{r.name}</span>
                  {r.description && <span className="block text-[11.5px] text-ink-3">{r.description}</span>}
                </span>
                <span className="num text-[12.5px] text-ink-2">
                  {r.effectType === "percent" ? `${r.effectValue > 0 ? "+" : ""}${Math.round(r.effectValue * 100)}%` : `${r.effectValue > 0 ? "+" : ""}${r.effectValue}€`}
                </span>
              </label>
            ))
          )}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" className="btn btn-ghost" onClick={() => setAssigning(false)}>Cancelar</button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saveAssignments.isPending}
              onClick={async () => {
                await saveAssignments.mutateAsync({ employeeId, month, ruleIds: [...pendingIds] });
                setAssigning(false);
              }}
            >
              {saveAssignments.isPending && <Loader2 size={15} className="animate-spin" />} Guardar
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={forceOpen} onClose={() => setForceOpen(false)} title="Desbloquear comissões">
        <div className="text-[12.5px] text-ink-2">
          Ao desbloquear, o comercial passa a receber a partir do <span className="font-semibold text-ink">2.º escalão</span> da tabela. Escolhe a percentagem do valor total a pagar.
        </div>
        <div className="mt-4 grid gap-2">
          {[25, 50, 75, 100].map((pct) => (
            <button
              key={pct}
              type="button"
              className={`flex items-center justify-between rounded-[10px] border px-3 py-2.5 text-left transition-colors ${p.forceCommissionsPct === pct ? "border-volt bg-volt/10" : "border-line bg-surface hover:bg-volt/5"}`}
              disabled={setForce.isPending}
              onClick={async () => {
                await setForce.mutateAsync({ employeeId, pct });
                setForceOpen(false);
              }}
            >
              <span className="text-[13px] font-medium">Pagar {pct}%</span>
              <span className="num text-[12px] text-ink-2">{p.gross > 0 ? fmtEur2(p.gross * pct / 100) : "—"}</span>
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between gap-2 pt-2">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={setForce.isPending}
            onClick={async () => {
              await setForce.mutateAsync({ employeeId, pct: 0 });
              setForceOpen(false);
            }}
          >
            <Undo2 size={14} /> Voltar ao objetivo
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setForceOpen(false)}>Cancelar</button>
        </div>
      </Modal>

      <Modal open={vncOpen} onClose={() => setVncOpen(false)} title="Acrescentar VNC">
        <div className="text-[12.5px] text-ink-2">Regista uma penalidade VNC (multa) que será subtraída ao total do comercial. Indica o ID da venda que a originou e o valor.</div>
        <div className="mt-4 grid gap-3">
          <Field label="ID da venda">
            <input
              className="input num"
              value={vncIdVenda}
              onChange={(e) => setVncIdVenda(e.target.value)}
              placeholder="Ex.: V123"
              autoFocus
            />
          </Field>
          <Field label="Valor da penalidade (€)">
            <input
              className="input num"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={vncAmount}
              onChange={(e) => setVncAmount(e.target.value)}
              placeholder="0.00"
            />
          </Field>
          {vncAdd.error && <div className="text-[12px] text-danger">{errMsg(vncAdd.error)}</div>}
        </div>
        <div className="mt-4 flex items-center justify-end gap-2 pt-1">
          <button type="button" className="btn btn-ghost" onClick={() => setVncOpen(false)}>Cancelar</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={vncAdd.isPending || !vncIdVenda.trim() || !(parseFloat(vncAmount) > 0)}
            onClick={async () => {
              const amount = parseFloat(vncAmount);
              if (!vncIdVenda.trim() || !(amount > 0)) return;
              await vncAdd.mutateAsync({ month, employeeId, idVenda: vncIdVenda.trim(), amount });
              setVncOpen(false);
            }}
          >
            {vncAdd.isPending && <Loader2 size={15} className="animate-spin" />} Guardar
          </button>
        </div>
      </Modal>

      <Modal open={blockKind !== null} onClose={() => setBlockKind(null)} title={blockKind === "total" ? "Bloqueio total de comissao" : "Bloqueio parcial de comissao"}>
        <div className="text-[12.5px] text-ink-2">
          {blockKind === "total"
            ? "O comissionamento deste colaborador neste mes vai a 0,00 EUR. O bloqueio nao aparece no PDF nem no Excel entregues ao comercial."
            : "Corta apenas o valor ou a percentagem que indicares ao total deste mes. O bloqueio nao aparece no PDF nem no Excel entregues ao comercial."}
        </div>
        {blockKind === "parcial" && (
          <div className="mt-4 grid gap-3">
            <Field label="Tipo de corte">
              <div className="flex gap-2">
                <button type="button" className={blockMode === "eur" ? "btn btn-volt px-3 py-1 text-[12px]" : "btn btn-ghost px-3 py-1 text-[12px]"} onClick={() => setBlockMode("eur")}>Valor (EUR)</button>
                <button type="button" className={blockMode === "pct" ? "btn btn-volt px-3 py-1 text-[12px]" : "btn btn-ghost px-3 py-1 text-[12px]"} onClick={() => setBlockMode("pct")}>Percentagem (%)</button>
              </div>
            </Field>
            <Field label={blockMode === "eur" ? "Valor a bloquear (EUR)" : "Percentagem a bloquear (%)"}>
              <input
                className="input num"
                type="number"
                inputMode="decimal"
                min="0"
                max={blockMode === "pct" ? 100 : undefined}
                step="0.01"
                value={blockValue}
                onChange={(e) => setBlockValue(e.target.value)}
                placeholder={blockMode === "eur" ? "0.00" : "0"}
                autoFocus
              />
            </Field>
          </div>
        )}
        <div className="mt-3">
          <Field label="Nota interna (opcional)">
            <input className="input" maxLength={300} value={blockNote} onChange={(e) => setBlockNote(e.target.value)} placeholder="Ex.: incumprimento de condicoes" />
          </Field>
        </div>
        {blockAdd.error && <div className="mt-3 text-[12px] text-danger">{errMsg(blockAdd.error)}</div>}
        <div className="mt-4 flex items-center justify-end gap-2 pt-1">
          <button type="button" className="btn btn-ghost" onClick={() => setBlockKind(null)}>Cancelar</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={blockAdd.isPending || (blockKind === "parcial" && !(parseFloat(blockValue) > 0))}
            onClick={async () => {
              if (blockKind === null) return;
              const value = blockKind === "parcial" ? parseFloat(blockValue) : 0;
              if (blockKind === "parcial" && !(value > 0)) return;
              await blockAdd.mutateAsync({ month, employeeId, kind: blockKind, mode: blockMode, value, note: blockNote.trim() || undefined });
              setBlockKind(null);
            }}
          >
            {blockAdd.isPending && <Loader2 size={15} className="animate-spin" />} Aplicar bloqueio
          </button>
        </div>
      </Modal>

      <Modal open={swapOpen} onClose={() => setSwapOpen(false)} title="Trocar venda">
        {swapStep === 1 ? (
          <>
            <div className="text-[12.5px] text-ink-2">Seleciona a venda (ou várias) que queres transferir para outro comercial.</div>
            <Field label="Pesquisar ID de venda" className="mt-3">
              <input
                className="input num"
                value={swapSearch}
                onChange={(e) => setSwapSearch(e.target.value)}
                placeholder="Ex.: V0"
                autoFocus
              />
            </Field>
            {(() => {
              const filtered = currentSales.filter((id) => !swapSearch || id.toLowerCase().includes(swapSearch.toLowerCase()));
              const allSelected = filtered.length > 0 && filtered.every((id) => swapIds.includes(id));
              return (
                <>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      className="text-[11.5px] font-medium text-volt hover:underline"
                      onClick={() =>
                        setSwapIds((prev) => {
                          const set = new Set(prev);
                          if (allSelected) for (const id of filtered) set.delete(id);
                          else for (const id of filtered) set.add(id);
                          return [...set];
                        })
                      }
                    >
                      {allSelected ? "Desmarcar todos" : "Selecionar todos"}
                    </button>
                    <span className="text-[11.5px] text-ink-3">{swapIds.length} selecionada(s)</span>
                  </div>
                  <div className="mt-2 max-h-[280px] overflow-y-auto rounded-[10px] border border-line">
                    {filtered.length === 0 ? (
                      <div className="px-3 py-4 text-center text-[12.5px] text-ink-3">Nenhuma venda encontrada.</div>
                    ) : (
                      filtered.map((id) => {
                        const on = swapIds.includes(id);
                        return (
                          <button
                            key={id}
                            type="button"
                            className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-[12.5px] hover:bg-volt/5 ${on ? "bg-volt/10 border-l-2 border-l-volt" : "border-l-2 border-l-transparent"}`}
                            onClick={() => toggleSwapId(id)}
                          >
                            <span
                              className={`flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[4px] border ${on ? "border-volt bg-volt text-black" : "border-line"}`}
                            >
                              {on && <Check size={11} strokeWidth={3} />}
                            </span>
                            <span className="num font-medium">{id}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </>
              );
            })()}
            <div className="mt-4 flex items-center justify-between gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setSwapOpen(false)}>Cancelar</button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={swapIds.length === 0}
                onClick={() => { setSwapStep(2); setSwapToId(null); setSwapDestSearch(""); }}
              >
                Seguinte{swapIds.length > 1 ? ` (${swapIds.length})` : ""}
              </button>
            </div>
          </>
        ) : swapStep === 2 ? (
          <>
            <div className="text-[12.5px] text-ink-2">
              {swapIds.length === 1 ? (
                <>
                  Venda <span className="num font-semibold text-ink">{swapIds[0]}</span> → escolhe o comercial de destino.
                </>
              ) : (
                <>
                  <span className="font-semibold text-ink">{swapIds.length} vendas</span> → escolhe o comercial de destino.
                </>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {swapIds.map((id) => (
                <span key={id} className="num rounded-[6px] border border-line bg-surface px-2 py-0.5 text-[11px]">{id}</span>
              ))}
            </div>
            <Field label="Pesquisar comercial" className="mt-3">
              <input
                className="input"
                value={swapDestSearch}
                onChange={(e) => setSwapDestSearch(e.target.value)}
                placeholder="Escreve o nome..."
                autoFocus
              />
            </Field>
            <div className="mt-3 max-h-[300px] overflow-y-auto rounded-[10px] border border-line">
              {otherEmployees.filter((x) => !swapDestSearch || x.employeeName.toLowerCase().includes(swapDestSearch.toLowerCase())).length === 0 ? (
                <div className="px-3 py-4 text-center text-[12.5px] text-ink-3">Nenhum comercial encontrado.</div>
              ) : (
                otherEmployees.filter((x) => !swapDestSearch || x.employeeName.toLowerCase().includes(swapDestSearch.toLowerCase())).map((emp) => (
                  <button
                    key={emp.employeeId}
                    type="button"
                    className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-[12.5px] hover:bg-volt/5 ${swapToId === emp.employeeId ? "bg-volt/10 border-l-2 border-l-volt" : "border-l-2 border-l-transparent"}`}
                    onClick={() => setSwapToId(emp.employeeId)}
                  >
                    <span className="font-medium">{emp.employeeName}</span>
                  </button>
                ))
              )}
            </div>
            {overrideCreate.error && <div className="mt-2 text-[12px] text-danger">{errMsg(overrideCreate.error)}</div>}
            <div className="mt-4 flex items-center justify-between gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setSwapStep(1)}>← Voltar</button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!swapToId}
                onClick={() => {
                  if (!swapToId) return;
                  setSwapPricing(() => {
                    const next: Record<string, "atual" | "destino"> = {};
                    for (const id of swapIds) next[id] = "destino";
                    return next;
                  });
                  setSwapStep(3);
                }}
              >
                Seguinte{swapIds.length > 1 ? ` (${swapIds.length})` : ""}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="text-[12.5px] text-ink-2">
              Escolhe por que tabela cada venda e paga no destino. A venda passa sempre para o
              destino; isto so decide os valores com que e paga.
            </div>
            <div className="mt-3 max-h-[340px] overflow-y-auto rounded-[10px] border border-line">
              {swapIds.map((id) => {
                const q = swapQuoteById.get(id);
                const cur = swapPricing[id] ?? "destino";
                const fmt = (v: number | null | undefined) =>
                  v == null ? "sem tabela" : fmtEur2(v);
                return (
                  <div key={id} className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0">
                    <span className="num w-16 shrink-0 text-[12.5px] font-medium">{id}</span>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        className={
                          cur === "atual"
                            ? "rounded-[8px] border border-volt bg-volt/15 px-2.5 py-1 text-[11.5px] font-medium text-volt"
                            : "rounded-[8px] border border-line px-2.5 py-1 text-[11.5px] text-ink-2 hover:bg-volt/5"
                        }
                        onClick={() => setSwapPricing((prev) => ({ ...prev, [id]: "atual" }))}
                      >
                        Tabela do atual — {fmt(q?.byFrom)}
                      </button>
                      <button
                        type="button"
                        className={
                          cur === "destino"
                            ? "rounded-[8px] border border-volt bg-volt/15 px-2.5 py-1 text-[11.5px] font-medium text-volt"
                            : "rounded-[8px] border border-line px-2.5 py-1 text-[11.5px] text-ink-2 hover:bg-volt/5"
                        }
                        onClick={() => setSwapPricing((prev) => ({ ...prev, [id]: "destino" }))}
                      >
                        Tabela do destino — {fmt(q?.byTo)}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {swapQuote.isLoading && <div className="mt-2 text-[11.5px] text-ink-3">A calcular valores…</div>}
            {overrideCreate.error && <div className="mt-2 text-[12px] text-danger">{errMsg(overrideCreate.error)}</div>}
            <div className="mt-4 flex items-center justify-between gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setSwapStep(2)}>← Voltar</button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={swapBusy}
                onClick={async () => {
                  setSwapBusy(true);
                  try {
                    for (const id of swapIds) {
                      await overrideCreate.mutateAsync({
                        month,
                        idVenda: id,
                        fromEmployeeId: employeeId,
                        toEmployeeId: swapToId!,
                        pricingTable: swapPricing[id] ?? "destino",
                      });
                    }
                    setSwapIds([]);
                    setSwapOpen(false);
                  } finally {
                    setSwapBusy(false);
                  }
                }}
              >
                {swapBusy && <Loader2 size={15} className="animate-spin" />} Confirmar {swapIds.length > 1 ? `troca (${swapIds.length})` : "troca"}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] border border-line bg-surface px-3 py-2">
      <div className="text-[10.5px] uppercase tracking-wide text-ink-3">{label}</div>
      <div className="num text-[13px] font-semibold">{value}</div>
    </div>
  );
}
