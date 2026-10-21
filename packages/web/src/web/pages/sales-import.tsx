import { useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload, XCircle } from "lucide-react";
import { PageHeader, Empty, Field, Tabs, Stat, Progress } from "../components/ui/kit";
import { useMe } from "../queries/me";
import { useEmployeeOptions } from "../queries/hr";
import { useClients, useImportSales, useOrders } from "../queries/sales";
import { errMsg, fmtDate } from "../lib/format";
import { SERVICE_LABELS } from "../../api/shared/client-forms";
import { TARGETS, autoMap, toIsoDate, downloadTemplate, labelOf, prepareRow, readWorkbook, type Prepared, type Sheet } from "../lib/sale-import";

const CHUNK = 100;
const REQUIRED = ["name", "nif", "contact"];
type Result = { row: number; ok: boolean; error?: string; number?: string; newClient?: boolean; updated?: boolean };
/** Venda que a linha vai atualizar: uma venda já registada (mesmo CPE/CUI) ou uma linha anterior do ficheiro. */
type Match = { number?: string; line?: number; service: string | null } | null;

const todayLisbon = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" });
const contractKey = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, "").toUpperCase() : "");
const cell = (v: unknown) => (v == null ? "" : String(v));

export default function SalesImportPage() {
  const me = useMe();
  const emps = useEmployeeOptions();
  const clients = useClients();
  const orders = useOrders();
  const importer = useImportSales();
  const input = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [mapping, setMapping] = useState<(string | null)[]>([]);
  const [defaultService, setDefaultService] = useState("auto");
  const [defaultSellerId, setDefaultSellerId] = useState<number | null>(null);
  const [view, setView] = useState<"todas" | "ok" | "erros">("todas");
  const [readError, setReadError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const sheet = sheets[sheetIdx] as Sheet | undefined;
  const employees = useMemo(() => (emps.data ?? []).map((e) => ({ id: e.id, name: e.name, status: e.status })), [emps.data]);

  const prepared = useMemo<Prepared[]>(() => {
    if (!sheet) return [];
    const opts = { defaultService, defaultSellerId, employees, today: todayLisbon() };
    return sheet.rows.map((r, i) => prepareRow(r, mapping, sheet.lines[i], opts));
  }, [sheet, mapping, defaultService, defaultSellerId, employees]);

  /**
   * Para cada linha, a venda que vai ser atualizada, com as mesmas regras da importação: a mais recente com o mesmo CPE ou CUI,
   * exceto se as duas tiverem número de contrato e forem diferentes (aí é uma venda nova).
   */
  const matches = useMemo<Match[]>(() => {
    type Known = { number?: string; line?: number; service: string | null; contract: string };
    const byMeter = new Map<string, Known[]>();
    const add = (key: string, k: Known) => byMeter.set(key, [k, ...(byMeter.get(key) ?? [])]);
    const keysOf = (d: Record<string, unknown> | null | undefined) =>
      (["cpe", "cui"] as const).flatMap((k) => {
        const v = d?.[k];
        return typeof v === "string" && v ? [`${k}:${v}`] : [];
      });
    // A lista de vendas vem da mais recente para a mais antiga; juntam-se da mais antiga para a mais recente.
    for (const o of [...(orders.data ?? [])].reverse()) {
      for (const key of keysOf(o.details)) add(key, { number: o.number, service: o.service, contract: contractKey(o.details?.contractNumber) });
    }
    return prepared.map((p) => {
      const contract = contractKey(p.details.contractNumber);
      const keys = keysOf(p.details);
      let m: Known | null = null;
      for (const key of keys) m ??= (byMeter.get(key) ?? []).find((k) => !contract || !k.contract || k.contract === contract) ?? null;
      if (!p.error) {
        if (m) {
          // A venda atualizada fica com o contrato e os contadores desta linha.
          if (contract) m.contract = contract;
          if (!(m.service && p.serviceAuto)) m.service = p.service;
          for (const key of keys) if (!(byMeter.get(key) ?? []).includes(m)) add(key, m);
        } else {
          const k: Known = { line: p.row, service: p.service, contract };
          for (const key of keys) add(key, k);
        }
      }
      return m ? { number: m.number, line: m.line, service: m.service } : null;
    });
  }, [prepared, orders.data]);
  const matchOf = new Map(prepared.map((p, i) => [p.row, matches[i]]));

  const ok = prepared.filter((p) => !p.error);
  const updates = ok.filter((p) => matchOf.get(p.row)).length;
  const bad = prepared.filter((p) => p.error);
  const newClients = useMemo(() => {
    const known = new Set((clients.data ?? []).map((c) => c.nif));
    return new Set(ok.map((p) => String(p.details.nif ?? "")).filter((n) => n && !known.has(n))).size;
  }, [ok, clients.data]);

  const mapped = new Set(mapping.filter(Boolean));
  const missing = REQUIRED.filter((k) => !mapped.has(k));
  const shown = view === "ok" ? ok : view === "erros" ? bad : prepared;

  async function onFile(f: File | undefined) {
    if (!f) return;
    setReading(true);
    setReadError(null);
    setResults(null);
    try {
      const s = await readWorkbook(f);
      if (!s.length) throw new Error("O ficheiro não tem dados (é preciso uma linha de cabeçalho com os nomes das colunas).");
      // Abre a folha com mais colunas reconhecidas.
      const best = s.map((x, i) => [autoMap(x.headers).filter(Boolean).length, i]).sort((a, b) => b[0] - a[0])[0][1];
      setSheets(s);
      setSheetIdx(best);
      setMapping(autoMap(s[best].headers));
      setFileName(f.name);
      setView("todas");
    } catch (e) {
      setReadError(e instanceof Error ? e.message : "Não foi possível ler o ficheiro.");
    } finally {
      setReading(false);
      if (input.current) input.current.value = "";
    }
  }

  function pickSheet(i: number) {
    setSheetIdx(i);
    setMapping(autoMap(sheets[i].headers));
  }

  function setColumn(i: number, key: string | null) {
    setMapping((m) => m.map((k, j) => (j === i ? key : key && k === key ? null : k)));
  }

  async function runImport() {
    setImportError(null);
    const rows = ok.map((p) => ({
      row: p.row,
      service: p.service ?? "LUZ",
      details: p.details,
      sellerId: p.seller?.id ?? 0,
      statusDate: p.statusDate,
      serviceAuto: p.serviceAuto,
      sellerDefault: p.sellerDefault,
      defaulted: p.defaulted,
    }));
    const all: Result[] = [];
    setProgress({ done: 0, total: rows.length });
    try {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const res = await importer.mutateAsync({ rows: rows.slice(i, i + CHUNK) });
        all.push(...res);
        setProgress({ done: Math.min(i + CHUNK, rows.length), total: rows.length });
      }
    } catch (e) {
      setImportError(`A importação parou: ${errMsg(e)}. As linhas anteriores já foram importadas.`);
    }
    setResults(all);
    setProgress(null);
  }

  function reset() {
    setSheets([]);
    setMapping([]);
    setFileName("");
    setResults(null);
    setImportError(null);
  }

  if (me.data && me.data.role !== "admin") {
    return (
      <div>
        <PageHeader eyebrow="Vendas" title="Importar Excel" />
        <div className="card"><Empty title="Sem acesso" text="Só o administrador pode importar vendas." /></div>
      </div>
    );
  }

  const header = (
    <PageHeader eyebrow="Vendas" title="Importar Excel">
      <Link href="/vendas" className="btn"><ArrowLeft size={15} /> Voltar às vendas</Link>
      <button type="button" className="btn" onClick={() => downloadTemplate()}><Download size={15} /> Descarregar modelo</button>
    </PageHeader>
  );

  if (results) {
    const done = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    return (
      <div>
        {header}
        <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
          <Stat label="Vendas novas" value={done.filter((r) => !r.updated).length} accent="var(--volt)" sub="já aparecem em Vendas" />
          <Stat label="Vendas atualizadas" value={done.filter((r) => r.updated).length} accent="var(--amber)" sub="mesmo CPE / CUI" />
          <Stat label="Clientes novos" value={done.filter((r) => r.newClient).length} accent="var(--sky)" sub="já aparecem em Clientes" />
          <Stat label="Não importadas" value={failed.length + bad.length} accent="var(--danger)" sub="com erros" />
        </div>
        {importError && <div className="mb-4 rounded-[12px] border border-danger/30 bg-danger/5 px-4 py-3 text-[13px] text-danger">{importError}</div>}
        {failed.length > 0 && (
          <div className="card mb-4 overflow-hidden">
            <div className="border-b border-line px-5 py-3 text-[13px] font-semibold">Linhas recusadas na gravação</div>
            <table className="tbl">
              <thead><tr><th>Linha</th><th>Motivo</th></tr></thead>
              <tbody>{failed.map((r) => <tr key={r.row}><td className="num w-20">{r.row}</td><td className="text-danger">{r.error}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Link href="/vendas" className="btn btn-primary">Ver vendas</Link>
          <Link href="/clientes" className="btn">Ver clientes</Link>
          <button type="button" className="btn" onClick={reset}>Importar outro ficheiro</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {header}

      <div className="card mb-5 p-5">
        <input ref={input} type="file" aria-label="Ficheiro Excel" accept=".xlsx,.xls,.xlsm,.csv,.ods" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onFile(e.dataTransfer.files[0]);
          }}
          className="flex w-full flex-col items-center gap-2 rounded-[14px] border border-dashed border-line px-6 py-8 text-center transition hover:border-volt/50 hover:bg-volt/5"
        >
          {reading ? <Loader2 size={26} className="animate-spin text-volt" /> : fileName ? <FileSpreadsheet size={26} className="text-volt" /> : <Upload size={26} className="text-ink-3" />}
          <span className="text-[14px] font-medium">{fileName ? fileName : "Escolher ou arrastar o ficheiro Excel"}</span>
          <span className="text-[12px] text-ink-3">
            {fileName ? "Clique para escolher outro ficheiro" : "Cada linha é uma venda, com os dados do cliente na mesma linha · .xlsx, .xls ou .csv"}
          </span>
        </button>
        {readError && <p className="mt-3 text-[13px] text-danger">{readError}</p>}
        {!sheet && (
          <p className="mt-3 text-[12.5px] text-ink-3">
            Pode usar o seu próprio Excel (a app tenta reconhecer as colunas e pode acertá-las a seguir) ou descarregar o modelo, com as colunas e os valores aceites.
            Se já existir uma venda com o mesmo CPE ou CUI, essa venda é atualizada em vez de se criar outra, a não ser que o número de contrato seja diferente.
          </p>
        )}
      </div>

      {sheet && (
        <>
          <div className="card mb-5 p-5">
            <div className="mb-4 flex flex-wrap items-end gap-4">
              <div>
                <h3 className="text-[15px] font-semibold">1. Colunas</h3>
                <p className="text-[12.5px] text-ink-3">Confirme a que campo corresponde cada coluna do Excel. As colunas sem campo não são importadas.</p>
              </div>
              {sheets.length > 1 && (
                <Field label="Folha" className="ml-auto w-48">
                  <select aria-label="Folha do Excel" className="input" value={sheetIdx} onChange={(e) => pickSheet(Number(e.target.value))}>
                    {sheets.map((s, i) => <option key={s.name} value={i}>{s.name} ({s.rows.length})</option>)}
                  </select>
                </Field>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {sheet.headers.map((h, i) => {
                const first = sheet.rows.find((r) => cell(r[i]).trim())?.[i];
                const iso = mapping[i] === "signatureDate" || mapping[i] === "statusDate" ? toIsoDate(first) : null;
                const sample = iso && iso !== "inválida" ? fmtDate(iso) : first;
                return (
                  <div key={`${h}-${i}`} className={`rounded-[12px] border px-3 py-2.5 ${mapping[i] ? "border-volt/30 bg-volt/5" : "border-line"}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13px] font-medium" title={h}>{h}</span>
                      <span className="truncate text-[11px] text-ink-3" title={cell(sample)}>{cell(sample) || "vazia"}</span>
                    </div>
                    <select aria-label={`Campo da coluna ${h}`} className="input mt-1.5 h-9 text-[12.5px]" value={mapping[i] ?? ""} onChange={(e) => setColumn(i, e.target.value || null)}>
                      <option value="">— Não importar —</option>
                      {TARGETS.map((t) => <option key={t.key} value={t.key}>{t.label}{REQUIRED.includes(t.key) ? " *" : ""}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>
            {missing.length > 0 && (
              <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-amber">
                <AlertTriangle size={14} /> Falta indicar a coluna de: {missing.map(labelOf).join(", ")}.
              </p>
            )}

            <div className="mt-5 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
              <Field label={mapped.has("service") ? "Serviço quando a célula está vazia" : "Serviço das vendas"}>
                <select aria-label="Serviço por defeito" className="input" value={defaultService} onChange={(e) => setDefaultService(e.target.value)}>
                  <option value="auto">Detetar pelo CPE / CUI (CPE = LUZ, CUI = GÁS, os dois = DUAL)</option>
                  {SERVICE_LABELS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label={mapped.has("seller") ? "Vendedor quando a célula está vazia" : "Vendedor das vendas"}>
                <select aria-label="Vendedor por defeito" className="input" value={defaultSellerId ?? ""} onChange={(e) => setDefaultSellerId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">— Escolher —</option>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.name}{e.status === "inativo" ? " (inativo)" : ""}</option>)}
                </select>
              </Field>
            </div>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h3 className="text-[15px] font-semibold">2. Pré-visualização</h3>
            <Tabs value={view} onChange={setView} items={[
              { key: "todas", label: "Todas", count: prepared.length },
              { key: "ok", label: "Prontas", count: ok.length },
              { key: "erros", label: "Com erros", count: bad.length },
            ]} />
            <span className="ml-auto text-[12.5px] text-ink-3">
              {ok.length - updates} nova{ok.length - updates === 1 ? "" : "s"} · {updates} atualizada{updates === 1 ? "" : "s"} · {newClients} cliente{newClients === 1 ? "" : "s"} novo{newClients === 1 ? "" : "s"}
            </span>
          </div>

          <div className="card mb-5 overflow-hidden">
            {!shown.length ? (
              <Empty title={view === "erros" ? "Sem erros" : "Sem linhas"} text={view === "erros" ? "Todas as linhas estão prontas a importar." : "Nenhuma linha para mostrar."} />
            ) : (
              <div className="max-h-[520px] overflow-auto">
                <table className="tbl">
                  <thead className="sticky top-0 z-10 bg-surface">
                    <tr><th>Linha</th><th>Situação</th><th>Cliente</th><th>Serviço</th><th>Vendedor</th><th>Data</th><th>Estado</th><th>CPE / CUI</th></tr>
                  </thead>
                  <tbody>
                    {shown.slice(0, 500).map((p) => {
                      const m = matchOf.get(p.row);
                      const service = m && p.serviceAuto && m.service ? m.service : p.service;
                      return (
                      <tr key={p.row}>
                        <td className="num w-14 text-[12px] text-ink-3">{p.row}</td>
                        <td className="min-w-[200px] text-[12px]">
                          {p.error ? (
                            <span className="flex items-start gap-1.5 text-danger"><XCircle size={14} className="mt-px shrink-0" /> {p.error}</span>
                          ) : (
                            <span className="flex items-start gap-1.5 text-volt">
                              <CheckCircle2 size={14} className="mt-px shrink-0" />
                              {!m ? "Venda nova" : m.number ? `Atualiza ${m.number}` : `Atualiza a venda da linha ${m.line}`}
                            </span>
                          )}
                          {p.warning && <span className="mt-0.5 block text-[11px] text-amber">{p.warning}</span>}
                          {!p.error && !m && !p.details.signatureDate && <span className="mt-0.5 block text-[11px] text-amber">Sem data de assinatura: fica com a data de hoje.</span>}
                        </td>
                        <td><div className="font-medium">{cell(p.details.name) || "—"}</div><div className="num text-[11px] text-ink-3">{cell(p.details.nif)}</div></td>
                        <td className="text-[12.5px]">{service ?? "—"}</td>
                        <td className="text-[12.5px] text-ink-2">{m && p.sellerDefault ? "mantém o atual" : (p.seller?.name ?? p.sellerRaw) || "—"}</td>
                        <td className="num whitespace-nowrap text-[12.5px]">{typeof p.details.signatureDate === "string" && p.details.signatureDate !== "inválida" ? fmtDate(p.details.signatureDate) : m ? "mantém" : "hoje"}</td>
                        <td className="text-[12.5px]">{cell(p.details.saleStatus)}{p.statusDate && p.statusDate !== "inválida" && <div className="num text-[11px] text-ink-3">desde {fmtDate(p.statusDate)}</div>}</td>
                        <td className="num text-[11.5px] text-ink-2">{[p.details.cpe, p.details.cui].filter(Boolean).map(cell).join(" · ") || "—"}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
                {shown.length > 500 && <p className="px-5 py-3 text-[12px] text-ink-3">A mostrar as primeiras 500 linhas de {shown.length}.</p>}
              </div>
            )}
          </div>

          <div className="card flex flex-wrap items-center gap-4 p-5">
            <div className="min-w-[240px] flex-1 text-[13px]">
              {progress ? (
                <>
                  <div className="mb-2">A importar… {progress.done} de {progress.total}</div>
                  <Progress value={progress.total ? progress.done / progress.total : 0} />
                </>
              ) : (
                <span className="text-ink-2">
                  Vão ser criadas <strong className="text-ink">{ok.length - updates}</strong> vendas novas, atualizadas <strong className="text-ink">{updates}</strong> vendas já existentes (mesmo CPE/CUI e contrato) e criados <strong className="text-ink">{newClients}</strong> clientes novos.
                  {bad.length > 0 && <> As <strong className="text-danger">{bad.length}</strong> linhas com erros ficam de fora (corrija o Excel e volte a carregá-lo só com essas).</>}
                </span>
              )}
            </div>
            <button type="button" className="btn btn-primary" disabled={!ok.length || !!progress} onClick={runImport}>
              {progress ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Importar {ok.length} venda{ok.length === 1 ? "" : "s"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
