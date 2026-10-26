import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useCommissionTables, useRemoveCommissionTable, useSaveCommissionTable } from "../queries/commission-tables";
import { PageHeader, Modal, Field, SubmitRow, Empty, ConfirmDelete, Pill, Tabs } from "../components/ui/kit";
import { COMMISSION_GROUP_OPTIONS, type CommissionGroup } from "../../api/shared/commission-groups";
import { errMsg } from "../lib/format";

type Table = NonNullable<ReturnType<typeof useCommissionTables>["data"]>[number];

type GroupKey = CommissionGroup;
const GROUPS = COMMISSION_GROUP_OPTIONS;

type ClientDraft = { min: string; max: string; luz: string; gas: string; dd: string; fe: string; pel: string };
type BandDraft = { min: string; max: string; commission: string };

const COLORS = ["#206a9f", "#f5a524", "#38bdf8", "#a78bfa", "#f472b6", "#34d399", "#fb7185", "#facc15"];

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

/** Separadores internos do formulário (aspeto igual ao Tabs, mas independentes do menu). */
function SubTabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { key: T; label: string }[] }) {
  return (
    <div className="mb-1 mt-3 inline-flex rounded-[11px] border border-line bg-surface p-1">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          onClick={() => onChange(it.key)}
          className={`flex h-8 items-center gap-2 rounded-lg px-3 text-[12.5px] font-medium transition ${value === it.key ? "bg-surface-2 text-ink shadow-[inset_0_0_0_1px_var(--line)]" : "text-ink-2 hover:text-ink"}`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** Escalões de comissão de NEGÓCIO (MEDEM): faixa de clientes → € por ponto, sem luz/gás/dd/fe/pel. */
function BusinessEditor({ rows, onChange }: { rows: BandDraft[]; onChange: (r: BandDraft[]) => void }) {
  const setRow = (i: number, patch: Partial<BandDraft>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => onChange([...rows, emptyBand()]);
  const del = (i: number) => onChange(rows.length === 1 ? [emptyBand()] : rows.filter((_, j) => j !== i));
  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <div className="font-display text-[14px] font-semibold">Escalões por nº de clientes (negócio)</div>
          <div className="text-[11.5px] text-ink-3">Comissão de negócio por ponto, conforme os clientes angariados no mês. Sem valores de Luz, Gás, DD, FE ou PEL.</div>
        </div>
        <button type="button" className="btn btn-ghost shrink-0" onClick={add}><Plus size={14} /> Escalão</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[660px] border-collapse text-[12.5px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-ink-3">
              <th className="px-2 pb-2 font-medium">De</th>
              <th className="px-2 pb-2 font-medium">Até</th>
              <th className="px-2 pb-2 font-medium">Comissão Negócio €/Ponto</th>
              <th className="w-10 pb-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-line">
                <td className="px-1 py-2 align-top">
                  <input aria-label={`Negócio mínimo ${i + 1}`} className="input num" placeholder="0" value={r.min} onChange={(e) => setRow(i, { min: e.target.value })} />
                </td>
                <td className="px-1 py-2 align-top">
                  <input aria-label={`Negócio máximo ${i + 1}`} className="input num" placeholder="sem limite" value={r.max} onChange={(e) => setRow(i, { max: e.target.value })} />
                </td>
                <td className="px-1 py-2 align-top">
                  <input aria-label={`Comissão negócio ${i + 1}`} className="input num" placeholder="€/ponto" value={r.commission} onChange={(e) => setRow(i, { commission: e.target.value })} />
                </td>
                <td className="px-1 py-2 align-top">
                  <button type="button" aria-label={`Remover escalão negócio ${i + 1}`} className="btn-icon" onClick={() => del(i)}><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11.5px] text-ink-3">Deixa o "Até" vazio no último escalão.</p>
    </div>
  );
}

/** Escalões por nº de clientes (mensal) → LUZ / GÁS / DD / FE / PEL (ou só LUZ/GÁS para CE). */
function ClientsEditor({ rows, onChange, hint, cols = CLIENT_COLS }: { rows: ClientDraft[]; onChange: (r: ClientDraft[]) => void; hint?: string; cols?: { key: keyof ClientDraft; label: string; color: string }[] }) {
  const setRow = (i: number, patch: Partial<ClientDraft>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => onChange([...rows, emptyClient()]);
  const del = (i: number) => onChange(rows.length === 1 ? [emptyClient()] : rows.filter((_, j) => j !== i));
  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <div className="font-display text-[14px] font-semibold">Escalões por nº de clientes (mensal)</div>
          <div className="text-[11.5px] text-ink-3">{hint ?? "Valor de remuneração por serviço vendido, conforme os clientes angariados no mês. Deixa em branco o que não se aplica."}</div>
        </div>
        <button type="button" className="btn btn-ghost shrink-0" onClick={add}><Plus size={14} /> Escalão</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[660px] border-collapse text-[12.5px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-ink-3">
              <th className="px-2 pb-2 font-medium">De</th>
              <th className="px-2 pb-2 font-medium">Até</th>
              {cols.map((c) => (
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
                {cols.map((c) => (
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

/** Tabela Solar: cada quantidade exata de painéis tem o seu preço (não é de X a Y). */
function SolarEditor({ rows, onChange }: { rows: BandDraft[]; onChange: (r: BandDraft[]) => void }) {
  const setRow = (i: number, patch: Partial<BandDraft>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => onChange([...rows, emptyBand()]);
  const del = (i: number) => onChange(rows.length === 1 ? [emptyBand()] : rows.filter((_, j) => j !== i));
  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <div className="font-display text-[14px] font-semibold">Tabela Solar</div>
          <div className="text-[11.5px] text-ink-3">Preço por quantidade exata de painéis solares (ex.: 2 painéis = 95€, 3 painéis = 125€).</div>
        </div>
        <button type="button" className="btn btn-ghost shrink-0" onClick={add}><Plus size={14} /> Escalão</button>
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid gap-2 rounded-[10px] border border-line p-3 sm:grid-cols-12">
            <div className="sm:col-span-5">
              <input aria-label={`Solar painéis ${i + 1}`} className="input num" placeholder="Nº de painéis" value={r.min} onChange={(e) => setRow(i, { min: e.target.value })} />
            </div>
            <div className="sm:col-span-6">
              <input aria-label={`Solar comissão ${i + 1}`} className="input num" placeholder="Comissão €" value={r.commission} onChange={(e) => setRow(i, { commission: e.target.value })} />
            </div>
            <button type="button" aria-label={`Remover escalão solar ${i + 1}`} className="btn-icon sm:col-span-1" onClick={() => del(i)}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function TableForm({ initial, group, regime, onClose }: { initial: Table | null; group: GroupKey; regime: string; onClose: () => void }) {
  const save = useSaveCommissionTable();
  const remove = useRemoveCommissionTable();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [color, setColor] = useState(initial?.color ?? COLORS[0]);
  const [active, setActive] = useState(initial?.active ?? true);
  const [isBase, setIsBase] = useState(initial?.isBase ?? false);
  const [blockedSales, setBlockedSales] = useState(str(initial?.blockedSales));
  const [kind, setKind] = useState(initial?.regime ?? regime);
  const [medemTab, setMedemTab] = useState<"comercial" | "pontos">("pontos");
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
          group,
          regime: kind,
          blockedSales: num(blockedSales) ?? 0,
          isBase,
          clientRows: clientRows.map((r) => ({ kind: "clients" as const, min: num(r.min), max: num(r.max), luz: num(r.luz), gas: num(r.gas), dd: num(r.dd), fe: num(r.fe), pel: num(r.pel) })),
          medemRows: medemRows.map((r) => ({ kind: "medem" as const, min: num(r.min), max: num(r.max), commission: num(r.commission) })),
          solarRows: solarRows.map((r) => ({ kind: "solar" as const, min: num(r.min), max: null, commission: num(r.commission) })),
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
        <Field label="Tipo de tabela">
          <select aria-label="Tipo de tabela" className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="RES+BTN NEG">RES+BTN NEG</option>
            <option value="MEDEM">MEDEM</option>
            <option value="SOLAR">SOLAR</option>
            <option value="CE">CE</option>
          </select>
        </Field>
        <Field label="Estado">
          <label className="flex h-10 items-center gap-2.5 text-[13px]">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Tabela ativa
          </label>
        </Field>
        {group === "parceiro" && (
          <Field label="Tabela Base">
            <label className="flex h-10 items-center gap-2.5 text-[13px]">
              <input type="checkbox" checked={isBase} onChange={(e) => setIsBase(e.target.checked)} />
              Tabela Base
            </label>
            <p className="mt-1 text-[11.5px] text-ink-3">As vendas dos membros da equipa somam-se às do chefe e são comissionadas com esta tabela.</p>
          </Field>
        )}
        <Field label="Bloqueio de vendas (nº)" className="sm:col-span-2">
          <input aria-label="Bloqueio de vendas" className="input num" placeholder="0" value={blockedSales} onChange={(e) => setBlockedSales(e.target.value)} />
          <p className="mt-1.5 text-[11.5px] text-ink-3">
            Só vendas LUZ/Dual BTN em fornecimento contam para o escalão. Nº de vendas que não são pagas em cada mês; o escalão apura-se pelo total, antes do bloqueio. O GÁS não conta para o escalão, mas é pago pelo valor GÁS do escalão atingido.
          </p>
        </Field>
      </div>

      {(kind === "RES+BTN NEG" || kind === "CE") && (
        <ClientsEditor
          rows={clientRows}
          onChange={setClientRows}
          cols={kind === "CE" ? CLIENT_COLS.slice(0, 2) : undefined}
          hint={kind === "CE" ? "Escalão apurado pela soma das vendas BTN em fornecimento de toda a equipa do chefe (incluindo as dele). Remunera por venda LUZ e GÁS do escalão atingido." : undefined}
        />
      )}

      {kind === "MEDEM" && (
        <>
          <div className="mt-6">
            <div className="font-display text-[14px] font-semibold">Escalões MEDEM</div>
            <div className="text-[11.5px] text-ink-3">Esta tabela tem duas partes. Escolhe qual queres preencher.</div>
          </div>
          <SubTabs value={medemTab} onChange={setMedemTab} items={[{ key: "negocio", label: "Escalões de negócio (€/ponto)" }, { key: "pontos", label: "Escalões por pontos" }]} />
          {medemTab === "negocio" ? (
            <BusinessEditor rows={medemRows} onChange={setMedemRows} />
          ) : (
            <BandEditor title="Escalões por pontos" hint="Faixas por número de pontos." unit="pontos" rows={medemRows} onChange={setMedemRows} />
          )}
        </>
      )}

      {kind === "SOLAR" && <SolarEditor rows={solarRows} onChange={setSolarRows} />}

      <SubmitRow pending={save.isPending} onCancel={onClose} error={error} extra={initial && <ConfirmDelete pending={remove.isPending} onConfirm={async () => { await remove.mutateAsync({ id: initial.id }); onClose(); }} />} />
    </form>
  );
}


export default function CommissionTablesPage() {
  const tables = useCommissionTables();
  const [group, setGroup] = useState<GroupKey>("gestor-comercial");
  const [edit, setEdit] = useState<Table | null | "new">(null);
  const [pick, setPick] = useState(false);
  const [regime, setRegime] = useState<string>("RES+BTN NEG");
  const list = tables.data ?? [];

  const counts = Object.fromEntries(GROUPS.map((g) => [g.key, list.filter((t) => t.group === g.key).length])) as Record<GroupKey, number>;
  const shown = list.filter((t) => t.group === group);

  return (
    <div>
      <PageHeader eyebrow="Recursos Humanos" title="Tabelas Comissionais" subtitle="Cada tabela comisional pertence a um grupo comercial. Escolhe o grupo para ver as suas tabelas.">
        <button className="btn btn-primary" onClick={() => setPick(true)}><Plus size={15} /> Nova tabela</button>
      </PageHeader>

      <div className="mb-5">
        <Tabs
          value={group}
          onChange={setGroup}
          items={GROUPS.map((g) => ({ key: g.key, label: g.label, count: counts[g.key] }))}
        />
      </div>

      {tables.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-52 rounded-[14px]" />)}</div>
      ) : !shown.length ? (
        <div className="card"><Empty title="Sem tabelas neste grupo" text="Cria a primeira tabela deste grupo com o botão Nova tabela." /></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((t, i) => (
            <button key={t.id} onClick={() => setEdit(t)} className="card rise group relative overflow-hidden p-5 text-left transition hover:border-ink-3" style={{ animationDelay: `${i * 40}ms` }}>
              <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-20 blur-2xl transition group-hover:opacity-40" style={{ background: t.color }} />
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-8 rounded-full" style={{ background: t.color }} />
                  {t.regime && <Pill tone="muted">{t.regime}</Pill>}
                </div>
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
                  <div className="num text-[13px] font-semibold">{t.solarRows.length} preços</div>
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

      <Modal open={pick} onClose={() => setPick(false)} title="Nova tabela comisional">
        <p className="mb-4 text-[12.5px] text-ink-2">Que tipo de tabela é?</p>
        <div className="grid gap-3">
          {[
            { regime: "RES+BTN NEG", hint: "Residencial e BTN Negócio" },
            { regime: "MEDEM", hint: "Por número de pontos" },
            { regime: "SOLAR", hint: "Por quantidade de painéis" },
            { regime: "CE", hint: "Chefe de equipa — escalão pela equipa" },
          ].map((o) => (
            <button
              key={o.regime}
              type="button"
              onClick={() => { setPick(false); setEdit("new"); setRegime(o.regime); }}
              className="flex w-full items-center justify-between gap-3 rounded-[11px] border border-line px-4 py-3 text-left transition hover:border-volt hover:bg-volt/5"
            >
              <span>
                <span className="block text-[13.5px] font-semibold">{o.regime}</span>
                <span className="block text-[11.5px] text-ink-3">{o.hint}</span>
              </span>
              <Plus size={15} className="shrink-0 text-volt" />
            </button>
          ))}
        </div>
      </Modal>

      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit === "new" ? "Nova tabela comisional" : "Editar tabela comisional"} wide>
        {edit !== null && <TableForm key={edit === "new" ? "new" : edit.id} initial={edit === "new" ? null : edit} group={group} regime={regime} onClose={() => setEdit(null)} />}
      </Modal>
    </div>
  );
}
