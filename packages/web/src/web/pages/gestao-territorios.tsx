import { useMemo, useRef, useState, type FormEvent } from "react";
import { ChevronLeft, ChevronRight, Download, FileUp, Loader2, Pencil, Plus, Search } from "lucide-react";
import { Empty, Field, Modal, PageHeader, SubmitRow } from "../components/ui/kit";
import { useMe } from "../queries/me";
import { useTerritories, useTerritoryMutations } from "../queries/territories";
import { downloadTerritoryTemplate, readTerritoryExcel } from "../lib/territories-excel";
import { fullRestMonths, normalizeTerritoryText, TERRITORY_COLUMNS, TERRITORY_ROUTE_ORIGIN, territoryInput, territoryKey, territoryToday, type Territory, type TerritoryInput } from "../../api/shared/territories";

const PAGE_SIZE = 25;
const locations = [["district", "Distrito"], ["municipality", "Concelho"], ["parish", "Freguesia"], ["village", "Aldeia"]] as const;
const monthFormat = new Intl.DateTimeFormat("pt-PT", { month: "long", timeZone: "UTC" });
const dayFormat = new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const intFormat = new Intl.NumberFormat("pt-PT");
const kmFormat = new Intl.NumberFormat("pt-PT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const message = (error: unknown, fallback: string) => error instanceof Error && error.message ? error.message : fallback;
type ExcelImport = Awaited<ReturnType<typeof readTerritoryExcel>>;

function TerritoryForm({ row, onClose, onSave }: { row: Territory | null; onClose: () => void; onSave: (row: TerritoryInput) => Promise<void> }) {
  const [fields, setFields] = useState(() => ({ district: row?.district ?? "", municipality: row?.municipality ?? "", parish: row?.parish ?? "", village: row?.village ?? "", lastSweep: row?.lastSweep ?? "", contracts: String(row?.contracts ?? 0) }));
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const change = (key: keyof typeof fields, value: string) => setFields((prev) => ({ ...prev, [key]: value }));

  async function save(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    const parsed = territoryInput.safeParse({ ...fields, lastSweep: fields.lastSweep || null, contracts: Number(fields.contracts) });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message); return; }
    setSaving(true);
    setError(undefined);
    try { await onSave(parsed.data); onClose(); }
    catch (error) { setError(message(error, "Não foi possível guardar o território.")); }
    finally { setSaving(false); }
  }

  return (
    <Modal open onClose={() => { if (!saving) onClose(); }} title={row ? "Editar território" : "Novo território"}>
      <form onSubmit={save}>
        <div className="grid gap-4 sm:grid-cols-2">
          {locations.map(([key, label], index) => (
            <Field label={key === "village" ? "Aldeia (opcional)" : label} key={key}>
              <input className="input w-full" required={key !== "village"} maxLength={120} autoFocus={index === 0} value={fields[key]} onChange={(e) => change(key, e.target.value)} />
            </Field>
          ))}
          <Field label="Data do último varrimento">
            <input type="date" className="input w-full" min="1900-01-01" max={territoryToday()} value={fields.lastSweep} onChange={(e) => change("lastSweep", e.target.value)} />
          </Field>
          <Field label="Nº de contratos">
            <input type="number" className="input w-full" min={0} max={999999999} step={1} required value={fields.contracts} onChange={(e) => change("contracts", e.target.value)} />
          </Field>
        </div>
        <p className="mt-4 text-xs text-ink-2">O mês do último varrimento e os meses de descanso são calculados a partir da data. Podes deixá-la em branco se ainda não houve varrimento.</p>
        {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
        <SubmitRow pending={saving} onCancel={() => { if (!saving) onClose(); }} />
      </form>
    </Modal>
  );
}

function DistanceCell({ distance }: { distance: Territory["distance"] }) {
  if (distance.status === "ok") return <td className="num whitespace-nowrap px-3 py-3 text-right" title={`Distância de ida por estrada desde ${TERRITORY_ROUTE_ORIGIN}`}>{kmFormat.format(distance.meters / 1000)} km</td>;
  const label = distance.status === "no_route" ? "Sem rota" : "Não encontrada";
  return <td className="whitespace-nowrap px-3 py-3 text-right text-ink-2" title={distance.status === "no_route" ? "Sem percurso exclusivamente por estrada até à freguesia." : "Freguesia não reconhecida. Confirma o distrito, o concelho e o nome oficial."}>{label}</td>;
}

function Territories({ editable }: { editable: boolean }) {
  const list = useTerritories();
  const { create, update, importRows } = useTerritoryMutations();
  const fileInput = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<Territory | null | undefined>();
  const [readingFile, setReadingFile] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  const [excel, setExcel] = useState<(ExcelImport & { filename: string })>();
  const [importError, setImportError] = useState<string>();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const today = territoryToday();
  const filtered = useMemo(() => {
    const q = normalizeTerritoryText(query);
    return (list.data ?? []).filter((row) => normalizeTerritoryText(locations.map(([key]) => row[key]).join(" ")).includes(q));
  }, [list.data, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * PAGE_SIZE;
  const shown = filtered.slice(start, start + PAGE_SIZE);
  const preview = useMemo(() => {
    if (!excel) return null;
    const seen = new Set((list.data ?? []).map(territoryKey));
    const fresh = excel.rows.filter((row) => {
      const key = territoryKey(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { fresh, skipped: excel.rows.length - fresh.length };
  }, [excel, list.data]);

  async function readFile(file?: File) {
    if (!file) return;
    setNotice(undefined);
    setImportError(undefined);
    setReadingFile(true);
    try { setExcel({ ...(await readTerritoryExcel(file)), filename: file.name }); }
    catch (error) { setNotice({ text: message(error, "Não foi possível ler o ficheiro."), error: true }); }
    finally { setReadingFile(false); }
  }

  async function confirmImport(e: FormEvent) {
    e.preventDefault();
    if (!excel || !preview?.fresh.length || excel.errors.length || importRows.isPending) return;
    setImportError(undefined);
    try {
      const result = await importRows.mutateAsync(preview.fresh);
      setExcel(undefined);
      setQuery("");
      setPage(1);
      setNotice({ text: `Importação concluída: ${result.inserted} adicionados, ${result.skipped + preview.skipped} duplicados ignorados.` });
    } catch (error) { setImportError(message(error, "Não foi possível concluir a importação.")); }
  }

  async function downloadTemplate() {
    setTemplateBusy(true);
    try { await downloadTerritoryTemplate(); }
    catch { setNotice({ text: "Não foi possível descarregar o modelo Excel.", error: true }); }
    finally { setTemplateBusy(false); }
  }

  return (
    <>
      <PageHeader eyebrow="Gestão de Empresa" title="Gestão de Territórios" subtitle="Regista os varrimentos por localidade e acompanha os contratos e os meses de descanso.">
        {editable && <>
          <button type="button" className="btn btn-ghost" onClick={downloadTemplate} disabled={templateBusy}><Download size={16} aria-hidden="true" /> Modelo Excel</button>
          <button type="button" className="btn btn-ghost" onClick={() => fileInput.current?.click()} disabled={readingFile || !list.isSuccess}>
            {readingFile ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <FileUp size={16} aria-hidden="true" />} Importar Excel
          </button>
          <input ref={fileInput} type="file" aria-label="Ficheiro Excel" accept=".xlsx,.xls" hidden onChange={(e) => { void readFile(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} />
          <button type="button" className="btn btn-primary" onClick={() => setEditing(null)}><Plus size={16} aria-hidden="true" /> Novo território</button>
        </>}
      </PageHeader>
      {notice && <p role={notice.error ? "alert" : "status"} className={`mb-4 rounded-lg border border-line bg-surface px-4 py-3 text-sm ${notice.error ? "text-danger" : "text-ink"}`}>{notice.text}</p>}
      <section aria-labelledby="territory-records" className="card min-w-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
          <div>
            <h2 id="territory-records" className="text-[16px] font-semibold">Registos de territórios</h2>
            <p className="mt-1 text-xs text-ink-2">Descanso em meses completos desde o último varrimento.</p>
            <p className="mt-1 text-xs text-ink-2">KM de ida, de carro, desde {TERRITORY_ROUTE_ORIGIN} até à freguesia.</p>
          </div>
          <label className="relative w-full sm:w-72">
            <span className="sr-only">Pesquisar por localização</span>
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden="true" />
            <input type="search" className="input w-full pl-9" placeholder="Pesquisar por localização…" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} />
          </label>
        </div>
        {list.isPending ? <div className="skeleton mx-4 mb-4 h-32 rounded-xl" aria-label="A carregar territórios" /> : list.isError ? (
          <Empty title="Não foi possível carregar os territórios" action={<button className="btn btn-ghost" onClick={() => void list.refetch()}>Tentar novamente</button>} />
        ) : (
          <>
            <div className="overflow-x-auto" role="region" aria-label="Tabela de territórios" tabIndex={0}>
              <table className="w-full min-w-[935px] text-left text-[12.5px]">
                <thead className="border-y border-line bg-surface-2 text-ink-2"><tr>
                  {TERRITORY_COLUMNS.map((label, i) => <th scope="col" key={label} className={`px-3 py-3 font-medium ${i >= 6 ? "text-right" : ""}`}>{label}</th>)}
                  {editable && <th scope="col" className="px-3 py-3"><span className="sr-only">Ações</span></th>}
                </tr></thead>
                <tbody>
                  {shown.map((row) => {
                    const date = row.lastSweep ? new Date(`${row.lastSweep}T00:00:00Z`) : null;
                    const rest = fullRestMonths(row.lastSweep, today);
                    return <tr key={row.id} className="border-b border-line last:border-b-0 hover:bg-surface-2/60">
                      {locations.map(([key]) => <td key={key} className="max-w-52 break-words px-3 py-3">{row[key] || "—"}</td>)}
                      <td className="whitespace-nowrap px-3 py-3">{date ? dayFormat.format(date) : "—"}</td>
                      <td className="px-3 py-3 capitalize">{date ? monthFormat.format(date) : "—"}</td>
                      <td className="num px-3 py-3 text-right">{intFormat.format(row.contracts)}</td>
                      <td className="num px-3 py-3 text-right">{rest === null ? "—" : intFormat.format(rest)}</td>
                      <DistanceCell distance={row.distance} />
                      {editable && <td className="px-3 py-2 text-right"><button type="button" className="btn-icon" aria-label={`Editar ${row.village || row.parish}`} title="Editar território" onClick={() => setEditing(row)}><Pencil size={15} aria-hidden="true" /></button></td>}
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
            {!shown.length && <Empty title={query.trim() ? "Sem resultados" : "Ainda não há territórios registados"} text={query.trim() ? "Experimenta pesquisar por outra localização." : editable ? "Cria o primeiro território ou importa uma folha Excel." : undefined} />}
            {filtered.length > 0 && <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-xs text-ink-2">
              <span>{start + 1}–{start + shown.length} de {filtered.length}</span>
              {pageCount > 1 && <div className="flex items-center gap-2">
                <button type="button" className="btn-icon" aria-label="Página anterior" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></button>
                <span>{currentPage} / {pageCount}</span>
                <button type="button" className="btn-icon" aria-label="Página seguinte" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></button>
              </div>}
            </div>}
            <p className="border-t border-line px-4 py-3 text-[11px] text-ink-2">
              Distâncias aproximadas. Fontes: <a className="underline" href="https://www.dgterritorio.gov.pt/atividades/cartografia/cartografia-tematica/caop" target="_blank" rel="noreferrer">CAOP 2025 · DGT</a> e <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© contribuidores do OpenStreetMap</a>.
            </p>
          </>
        )}
      </section>
      {editable && editing !== undefined && <TerritoryForm row={editing} onClose={() => setEditing(undefined)} onSave={async (data) => {
        if (editing) await update.mutateAsync({ id: editing.id, data });
        else { await create.mutateAsync(data); setQuery(""); setPage(1); }
        setNotice({ text: editing ? "Território atualizado." : "Território criado." });
      }} />}
      {editable && excel && preview && <Modal open size="wide" title="Pré-visualizar importação" onClose={() => { if (!importRows.isPending) setExcel(undefined); }}>
        <form onSubmit={confirmImport}>
          <p className="break-words text-sm text-ink">{excel.filename} · Folha «{excel.sheet}»</p>
          <p className="mt-2 text-xs text-ink-2">{preview.fresh.length} novos, {preview.skipped} duplicados e {excel.errors.length} com erro. Os duplicados são ignorados sem alterar os registos existentes.</p>
          {excel.errors.length > 0 && <div role="alert" className="mt-4 rounded-lg border border-line p-3 text-sm text-danger">
            <p className="font-medium">Corrige as linhas no Excel e volta a importar. Nenhum registo foi gravado.</p>
            <ul className="mt-2 list-disc space-y-1 pl-4">{excel.errors.slice(0, 15).map((error) => <li key={error}>{error}</li>)}</ul>
            {excel.errors.length > 15 && <p className="mt-2">E mais {excel.errors.length - 15} linhas com problemas.</p>}
          </div>}
          {preview.fresh.length > 0 && <ul className="mt-4 divide-y divide-line rounded-lg border border-line text-sm">
            {preview.fresh.slice(0, 6).map((row) => <li key={territoryKey(row)} className="flex flex-wrap justify-between gap-x-3 gap-y-1 px-3 py-2">
              <span className="min-w-0 break-words">{locations.map(([key]) => row[key]).filter(Boolean).join(" / ")}</span>
              <span className="text-xs text-ink-2">{row.lastSweep ? dayFormat.format(new Date(`${row.lastSweep}T00:00:00Z`)) : "Sem data"} · {row.contracts} contratos</span>
            </li>)}
            {preview.fresh.length > 6 && <li className="px-3 py-2 text-xs text-ink-2">E mais {preview.fresh.length - 6} registos.</li>}
          </ul>}
          {importError && <p role="alert" className="mt-4 text-sm text-danger">{importError}</p>}
          <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-line pt-4">
            <button type="button" className="btn btn-ghost" disabled={importRows.isPending} onClick={() => setExcel(undefined)}>Fechar</button>
            <button type="submit" className="btn btn-primary" disabled={importRows.isPending || !preview.fresh.length || !!excel.errors.length}>
              {importRows.isPending ? "A importar…" : "Confirmar importação"}
            </button>
          </div>
        </form>
      </Modal>}
    </>
  );
}

export default function GestaoTerritoriosPage() {
  const me = useMe();
  if (me.isLoading) return <div className="skeleton h-64 rounded-[14px]" />;
  const permission = me.data?.permissions?.["gestao-territorios"];
  if (!permission?.view) return <PageHeader title="Gestão de Territórios" subtitle="Não tens acesso a esta página." />;
  return <Territories editable={permission.edit && !permission.readOnly} />;
}
