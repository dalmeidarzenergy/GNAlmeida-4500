import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useCommissionCalc, useCommissionTables, useRemoveCommissionTable, useSaveCommissionTable } from "../queries/commission-tables";
import { PageHeader, Modal, Field, SubmitRow, Empty, ConfirmDelete, Pill } from "../components/ui/kit";
import { errMsg, fmtEur, today } from "../lib/format";

type Table = NonNullable<ReturnType<typeof useCommissionTables>["data"]>[number];

type ClientDraft = { min: string; max: string; luz: string; gas: string; dd: string; fe: string; pel: string };
type BandDraft = { min: string; max: string; commission: string };

const COLORS = ["#c6f432", "#f5a524", "#38bdf8", "#a78bfa", "#f472b6", "#34d399", "#fb7185", "#facc15"];

const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
const str = (v: number | null | undefined) => (v == null ? "" : String(v));
const eur = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(2).replace(".", ",")}€`);

const emptyClient = (): ClientDraft => ({ min: "", max: "", luz: "", gas: "", dd: "", fe: "", pel: "" });
const emptyBand = (): BandDraft => ({ min: "", max: "", commission: "" });

/** Colunas de serviço do escalão de clientes (cores da tabela da empresa). */
const CLIENT_COLS: { key: keyof ClientDraft; label: string; color: string }[] = [
  { key: "luz", label: "LUZ", color: "#2f8f4e" },
  { key: "gas", label: "GÁS", color: "#3d9ad9" },
  { key: "dd", label: "DD", color: "#e2622a" },
  { key: "fe", label: "FE", color: "#7cc4e8" },
  { key: "pel", label: "PEL", color: "#7cc4e8" },
];

/** Escalões por nº de clientes (mensal) → LUZ / GÁS / DD / FE / PEL. */
function ClientsEditor({ rows, onChange }: { rows: ClientDraft[]; onChange: (r: ClientDraft[]) => void }) {
  const setRow = (i: number, patch: Partial<ClientDraft>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => onChange([...rows, emptyClient()]);
  const del = (i: number) => onChange(rows.length === 1 ? [emptyClient()] : rows.filter((_, j) => j !== i));
  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <div className="font-display text-[14px] font-semibold">Escalões por nº de clientes (mensal)</div>
          <div className="text-[11.5px] text-ink-3">Valor de remuneração por serviço vendido, conforme os clientes angariados no mês. Deixa em branco o que não se aplica.</div>
        </div>
        <button type="button" className="btn btn-ghost shrink-0" onClick={add}><Plus size={14} /> Escalão</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[660px] border-collapse text-[12.5px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-ink-3">
              <th className="px-2 pb-2 font-medium">De</th>
              <th className="px-2 pb-2 font-medium">Até</th>
              {CLIENT_COLS.map((c) => (
                <th key={c.key} className="px-2 pb-2 font-medium" style={{ color: c.color }}>{c.label} (€)</th>
              ))}
              <th className="w-10 pb-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-line">
                <td className="px-1 py-2 align-top">
                  <input aria-label={`Clientes mínimo ${i + 1}`} className="input num" placeholder="0" value={r.min} onChange={(e) => setRow(i, { min: e.target.value })} />
                </td>
                <td className="px-1 py-2 align-top">
                  <input aria-label={`Clientes máximo ${i + 1}`} className="input num" placeholder="sem limite" value={r.max} onChange={(e) => setRow(i, { max: e.target.value })} />
                </td>
                {CLIENT_COLS.map((c) => (
                  <td key={c.key} className="px-1 py-2 align-top">
                    <input aria-label={`${c.label} escalão ${i + 1}`} className="input num" placeholder="€" value={r[c.key]} onChange={(e) => setRow(i, { [c.key]: e.target.value } as Partial<ClientDraft>)} />
                  </td>
                ))}
                <td className="px-1 py-2 align-top">
                  <button type="button" aria-label={`Remover escalão ${i + 1}`} className="btn-icon" onClick={() => del(i)}><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11.5px] text-ink-3">Deixa o “Até” vazio no último escalão (ex.: ≥ 40 clientes).</p>
    </div>
  );
}

/** Escalões genéricos: MEDEM (por pontos) e Solar (por painéis). */
function BandEditor({ title, hint, unit, rows, onChange }: { title: string; hint: string; unit: string; rows: BandDraft[]; onChange: (r: BandDraft[]) => void }) {
  const setRow = (i: number, patch: Partial<BandDraft>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => onChange([...rows, emptyBand()]);
  const del = (i: number) => onChange(rows.length === 1 ? [emptyBand()] : rows.filter((_, j) => j !== i));
  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <div className="font-display text-[14px] font-semibold">{title}</div>
          <div className="text-[11.5px] text-ink-3">{hint}</div>
        </div>
        <button type="button" className="btn btn-ghost shrink-0" onClick={add}><Plus size={14} /> Escalão</button>
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid gap-2 rounded-[10px] border border-line p-3 sm:grid-cols-12">
            <div className="sm:col-span-4">
              <input aria-label={`${title} mínimo ${i + 1}`} className="input num" placeholder={`De (${unit})`} value={r.min} onChange={(e) => setRow(i, { min: e.target.value })} />
            </div>
            <div className="sm:col-span-4">
              <input aria-label={`${title} máximo ${i + 1}`} className="input num" placeholder={`Até (${unit})`} value={r.max} onChange={(e) => setRow(i, { max: e.target.value })} />
            </div>
            <div className="sm:col-span-3">
              <input aria-label={`${title} comissão ${i + 1}`} className="input num" placeholder="Comissão €" value={r.commission} onChange={(e) => setRow(i, { commission: e.target.value })} />
            </div>
            <button type="button" aria-label={`Remover escalão ${i + 1}`} className="btn-icon sm:col-span-1" onClick={() => del(i)}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function TableForm({ initial, onClose }: { initial: Table | null; onClose: () => void }) {
  const save = useSaveCommissionTable();
  const remove = useRemoveCommissionTable();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [color, setColor] = useState(initial?.color ?? COLORS[0]);
  const [active, setActive] = useState(initial?.active ?? true);
  const [blockedSales, setBlockedSales] = useState(str(initial?.blockedSales));
  const [clientRows, setClientRows] = useState<ClientDraft[]>(
    initial?.clientRows.length
      ? initial.clientRows.map((r) => ({ min: str(r.min), max: str(r.max), luz: str(r.luz), gas: str(r.gas), dd: str(r.dd), fe: str(r.fe), pel: str(r.pel) }))
      : [emptyClient()],
  );
  const [medemRows, setMedemRows] = useState<BandDraft[]>(initial?.medemRows.length ? initial.medemRows.map((r) => ({ min: str(r.min), max: str(r.max), commission: str(r.commission) })) : [emptyBand()]);
  const [solarRows, setSolarRows] = useState<BandDraft[]>(initial?.solarRows.length ? initial.solarRows.map((r) => ({ min: str(r.min), max: str(r.max), commission: str(r.commission) })) : [emptyBand()]);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const p = {
          name,
          description: description || null,
          color,
          active,
          blockedSales: num(blockedSales) ?? 0,
          clientRows: clientRows.map((r) => ({ kind: "clients" as const, min: num(r.min), max: num(r.max), luz: num(r.luz), gas: num(r.gas), dd: num(r.dd), fe: num(r.fe), pel: num(r.pel) })),
          medemRows: medemRows.map((r) => ({ kind: "medem" as const, min: num(r.min), max: num(r.max), commission: num(r.commission) })),
          solarRows: solarRows.map((r) => ({ kind: "solar" as const, min: num(r.min), max: num(r.max), commission: num(r.commission) })),
        };
        try {
          if (initial) await save.update.mutateAsync({ ...p, id: initial.id });
          else await save.create.mutateAsync(p);
          onClose();
        } catch (err) {
          setError(errMsg(err));
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome da tabela" className="sm:col-span-2">
          <input aria-label="Nome da tabela" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Descrição" className="sm:col-span-2">
          <textarea aria-label="Descrição" className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Cor">
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button type="button" aria-label={`Cor ${c}`} key={c} onClick={() => setColor(c)} className={`h-8 w-8 rounded-full transition ${color === c ? "ring-2 ring-offset-2 ring-offset-surface" : "opacity-70 hover:opacity-100"}`} style={{ background: c, ["--tw-ring-color" as string]: c }} />
            ))}
          </div>
        </Field>
        <Field label="Estado">
          <label className="flex h-10 items-center gap-2.5 text-[13px]">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Tabela ativa
          </label>
        </Field>
        <Field label="Bloqueio de vendas (nº)" className="sm:col-span-2">
          <input aria-label="Bloqueio de vendas" className="input num" placeholder="0" value={blockedSales} onChange={(e) => setBlockedSales(e.target.value)} />
          <p className="mt-1.5 text-[11.5px] text-ink-3">
            Nº de vendas LUZ/Dual BTN em fornecimento que não são pagas em cada mês. O escalão é apurado pelo total de vendas, antes do bloqueio.
          </p>
        </Field>
      </div>

      <ClientsEditor rows={clientRows} onChange={setClientRows} />
      <BandEditor title="Escalões MEDEM" hint="Faixas por número de pontos." unit="pontos" rows={medemRows} onChange={setMedemRows} />
      <BandEditor title="Tabela Solar" hint="Faixas por quantidade de painéis solares." unit="painéis" rows={solarRows} onChange={setSolarRows} />

      <SubmitRow pending={save.isPending} onCancel={onClose} error={error} extra={initial && <ConfirmDelete pending={remove.isPending} onConfirm={async () => { await remove.mutateAsync({ id: initial.id }); onClose(); }} />} />
    </form>
  );
}

/** Cálculo de comissões de um mês, por vendedor. */
function CalcPanel() {
  const [month, setMonth] = useState(today().slice(0, 7));
  const calc = useCommissionCalc(month);
  const rows = calc.data?.sellers ?? [];
  const total = rows.reduce((s, r) => s + r.commission, 0);

  return (
    <div className="card mt-8 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <div className="font-display text-[15px] font-semibold">Cálculo de comissões</div>
          <div className="text-[11.5px] text-ink-3">Vendas LUZ/Dual BTN em fornecimento no mês. O escalão apura-se pelo total de vendas; o bloqueio da tabela reduz o nº de vendas pagas.</div>
        </div>
        <input aria-label="Mês" type="month" className="input num w-40" value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>
      {calc.isLoading ? (
        <div className="p-5"><div className="skeleton h-24 rounded-[12px]" /></div>
      ) : !rows.length ? (
        <Empty title="Sem vendas neste mês" text="Nenhum vendedor tem vendas LUZ/Dual BTN em fornecimento neste mês." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-3">
                <th className="px-5 py-3 font-medium">Vendedor</th>
                <th className="px-3 py-3 font-medium">Tabela</th>
                <th className="px-3 py-3 text-right font-medium">Vendas</th>
                <th className="px-3 py-3 text-right font-medium">Escalão</th>
                <th className="px-3 py-3 text-right font-medium">Bloqueio</th>
                <th className="px-3 py-3 text-right font-medium">Pagas</th>
                <th className="px-3 py-3 text-right font-medium">€/venda</th>
                <th className="px-3 py-3 text-right font-medium">Bruto</th>
                <th className="px-3 py-3 text-right font-medium">Chargeback</th>
                <th className="px-5 py-3 text-right font-medium">A pagar</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sellerId} className="border-b border-line last:border-0">
                  <td className="px-5 py-3 font-medium">{r.sellerName}</td>
                  <td className="px-3 py-3 text-ink-2">{r.tableName ?? <span className="text-danger">sem tabela</span>}</td>
                  <td className="num px-3 py-3 text-right">{r.sales}</td>
                  <td className="num px-3 py-3 text-right">{r.band ? `${r.band.min ?? 0}${r.band.max == null ? "+" : `–${r.band.max}`}` : "—"}</td>
                  <td className="num px-3 py-3 text-right text-ink-2">−{r.blocked}</td>
                  <td className="num px-3 py-3 text-right">{r.paidSales}</td>
                  <td className="num px-3 py-3 text-right">{fmtEur(r.unit ?? 0)}</td>
                  <td className="num px-3 py-3 text-right">{fmtEur(r.gross ?? 0)}</td>
                  <td className="num px-3 py-3 text-right text-danger">{r.chargebackValue ? `−${fmtEur(r.chargebackValue)}` : "—"}</td>
                  <td className="num px-5 py-3 text-right font-semibold">{fmtEur(r.commission)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line bg-surface-2/40">
                <td className="px-5 py-3 font-display font-semibold" colSpan={7}>Total</td>
                <td className="num px-3 py-3 text-right font-semibold">{fmtEur(calc.data?.totals.gross ?? 0)}</td>
                <td className="num px-3 py-3 text-right font-semibold text-danger">{calc.data?.totals.chargeback ? `−${fmtEur(calc.data.totals.chargeback)}` : "—"}</td>
                <td className="num px-5 py-3 text-right font-display text-[15px] font-semibold">{fmtEur(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

export default function CommissionTablesPage() {
  const tables = useCommissionTables();
  const [edit, setEdit] = useState<Table | null | "new">(null);
  const list = tables.data ?? [];

  return (
    <div>
      <PageHeader eyebrow="Recursos Humanos" title="Tabelas Comissionais">
        <button className="btn btn-primary" onClick={() => setEdit("new")}><Plus size={15} /> Nova tabela</button>
      </PageHeader>

      {tables.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-52 rounded-[14px]" />)}</div>
      ) : !list.length ? (
        <div className="card"><Empty title="Sem tabelas comissionais" text="Crie a primeira tabela de comissões com escalões de clientes, MEDEM e Solar." /></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((t, i) => (
            <button key={t.id} onClick={() => setEdit(t)} className="card rise group relative overflow-hidden p-5 text-left transition hover:border-ink-3" style={{ animationDelay: `${i * 40}ms` }}>
              <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-20 blur-2xl transition group-hover:opacity-40" style={{ background: t.color }} />
              <div className="flex items-start justify-between gap-2">
                <span className="h-2.5 w-8 rounded-full" style={{ background: t.color }} />
                <Pencil size={13} className="shrink-0 text-ink-3 opacity-0 transition group-hover:opacity-100" />
              </div>
              <div className="mt-4 font-display text-[17px] font-semibold">{t.name}</div>
              <div className="mt-1 line-clamp-1 text-[12.5px] text-ink-3">{t.description || "Sem descrição"}</div>
              {!t.active && <div className="mt-3"><Pill tone="muted">Inativa</Pill></div>}
              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
                <div>
                  <div className="text-[10.5px] uppercase tracking-wide text-ink-3">Clientes</div>
                  <div className="num text-[13px] font-semibold">{t.clientRows.length} escalões</div>
                </div>
                <div>
                  <div className="text-[10.5px] uppercase tracking-wide text-ink-3">MEDEM</div>
                  <div className="num text-[13px] font-semibold">{t.medemRows.length} escalões</div>
                </div>
                <div>
                  <div className="text-[10.5px] uppercase tracking-wide text-ink-3">Solar</div>
                  <div className="num text-[13px] font-semibold">{t.solarRows.length} faixas</div>
                </div>
              </div>
              <div className="mt-3 space-y-1 border-t border-line pt-3 text-[11.5px]">
                {t.clientRows.slice(0, 4).map((r, j) => (
                  <div key={j} className="flex items-center justify-between gap-2">
                    <span className="text-ink-3">{r.min ?? 0}{r.max == null ? "+" : `–${r.max}`}</span>
                    <span className="num text-ink-2">{eur(r.luz)} · {eur(r.gas)} · {eur(r.dd)} · {eur(r.fe)} · {eur(r.pel)}</span>
                  </div>
                ))}
              </div>
            </button>
          ))}
        </div>
      )}

      <CalcPanel />

      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit === "new" ? "Nova tabela comisional" : "Editar tabela comisional"} wide>
        {edit !== null && <TableForm key={edit === "new" ? "new" : edit.id} initial={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
      </Modal>
    </div>
  );
}
