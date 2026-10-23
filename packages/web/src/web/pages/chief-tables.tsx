import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useChiefCalc, useChiefTables, useRemoveChiefTable, useSaveChiefTable } from "../queries/chief-tables";
import { PageHeader, Modal, Field, SubmitRow, Empty, ConfirmDelete, Pill } from "../components/ui/kit";
import { errMsg, fmtEur, today } from "../lib/format";

type Table = NonNullable<ReturnType<typeof useChiefTables>["data"]>[number];

type TeamDraft = { min: string; max: string; commission: string };
type OwnDraft = { min: string; max: string; luz: string; gas: string; dd: string; fe: string; pel: string };

const COLORS = ["#c6f432", "#f5a524", "#38bdf8", "#a78bfa", "#f472b6", "#34d399", "#fb7185", "#facc15"];

const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
const str = (v: number | null | undefined) => (v == null ? "" : String(v));

const emptyTeam = (): TeamDraft => ({ min: "", max: "", commission: "" });
const emptyOwn = (): OwnDraft => ({ min: "", max: "", luz: "", gas: "", dd: "", fe: "", pel: "" });

const OWN_COLS: { key: keyof OwnDraft; label: string; color: string }[] = [
  { key: "luz", label: "LUZ", color: "#2f8f4e" },
  { key: "gas", label: "GÁS", color: "#3d9ad9" },
  { key: "dd", label: "DD", color: "#e2622a" },
  { key: "fe", label: "FE", color: "#7cc4e8" },
  { key: "pel", label: "PEL", color: "#7cc4e8" },
];

/** Escalões por nº de vendas da EQUIPA → valor fixo (€). */
function TeamEditor({ rows, onChange }: { rows: TeamDraft[]; onChange: (r: TeamDraft[]) => void }) {
  const setRow = (i: number, patch: Partial<TeamDraft>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => onChange([...rows, emptyTeam()]);
  const del = (i: number) => onChange(rows.length === 1 ? [emptyTeam()] : rows.filter((_, j) => j !== i));
  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <div className="font-display text-[14px] font-semibold">Escalões por vendas da equipa (mensal)</div>
          <div className="text-[11.5px] text-ink-3">Só vendas LUZ/Dual BTN em fornecimento no mês contam para o escalão (não contam as que baixaram no próprio mês). O GÁS não conta para o escalão, mas é pago pelo valor GÁS do escalão atingido. As vendas do próprio chefe contam.</div>
        </div>
        <button type="button" className="btn btn-ghost shrink-0" onClick={add}><Plus size={14} /> Escalão</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-[12.5px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-ink-3">
              <th className="px-2 pb-2 font-medium">De</th>
              <th className="px-2 pb-2 font-medium">Até</th>
              <th className="px-2 pb-2 font-medium">Comissão (€)</th>
              <th className="w-10 pb-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-line">
                <td className="px-1 py-2 align-top"><input aria-label={`Equipa mínimo ${i + 1}`} className="input num" placeholder="0" value={r.min} onChange={(e) => setRow(i, { min: e.target.value })} /></td>
                <td className="px-1 py-2 align-top"><input aria-label={`Equipa máximo ${i + 1}`} className="input num" placeholder="sem limite" value={r.max} onChange={(e) => setRow(i, { max: e.target.value })} /></td>
                <td className="px-1 py-2 align-top"><input aria-label={`Equipa comissão ${i + 1}`} className="input num" placeholder="€" value={r.commission} onChange={(e) => setRow(i, { commission: e.target.value })} /></td>
                <td className="px-1 py-2 align-top"><button type="button" aria-label={`Remover escalão equipa ${i + 1}`} className="btn-icon" onClick={() => del(i)}><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Escalões das vendas PRÓPRIAS do chefe → LUZ / GÁS / DD / FE / PEL (igual à tabela de vendedor). */
function OwnEditor({ rows, onChange }: { rows: OwnDraft[]; onChange: (r: OwnDraft[]) => void }) {
  const setRow = (i: number, patch: Partial<OwnDraft>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => onChange([...rows, emptyOwn()]);
  const del = (i: number) => onChange(rows.length === 1 ? [emptyOwn()] : rows.filter((_, j) => j !== i));
  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <div className="font-display text-[14px] font-semibold">Escalões das vendas próprias do chefe</div>
          <div className="text-[11.5px] text-ink-3">Valor por serviço vendido, conforme as vendas do próprio chefe no mês. Igual à tabela de vendedor.</div>
        </div>
        <button type="button" className="btn btn-ghost shrink-0" onClick={add}><Plus size={14} /> Escalão</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[660px] border-collapse text-[12.5px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-ink-3">
              <th className="px-2 pb-2 font-medium">De</th>
              <th className="px-2 pb-2 font-medium">Até</th>
              {OWN_COLS.map((c) => (<th key={c.key} className="px-2 pb-2 font-medium" style={{ color: c.color }}>{c.label} (€)</th>))}
              <th className="w-10 pb-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-line">
                <td className="px-1 py-2 align-top"><input aria-label={`Próprias mínimo ${i + 1}`} className="input num" placeholder="0" value={r.min} onChange={(e) => setRow(i, { min: e.target.value })} /></td>
                <td className="px-1 py-2 align-top"><input aria-label={`Próprias máximo ${i + 1}`} className="input num" placeholder="sem limite" value={r.max} onChange={(e) => setRow(i, { max: e.target.value })} /></td>
                {OWN_COLS.map((c) => (
                  <td key={c.key} className="px-1 py-2 align-top"><input aria-label={`Próprias ${c.label} ${i + 1}`} className="input num" placeholder="€" value={r[c.key]} onChange={(e) => setRow(i, { [c.key]: e.target.value } as Partial<OwnDraft>)} /></td>
                ))}
                <td className="px-1 py-2 align-top"><button type="button" aria-label={`Remover escalão próprias ${i + 1}`} className="btn-icon" onClick={() => del(i)}><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TableForm({ initial, onClose }: { initial: Table | null; onClose: () => void }) {
  const save = useSaveChiefTable();
  const remove = useRemoveChiefTable();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [color, setColor] = useState(initial?.color ?? COLORS[0]);
  const [active, setActive] = useState(initial?.active ?? true);
  const [blockedSales, setBlockedSales] = useState(str(initial?.blockedSales));
  const [teamRows, setTeamRows] = useState<TeamDraft[]>(
    initial?.teamRows.length ? initial.teamRows.map((r) => ({ min: str(r.min), max: str(r.max), commission: str(r.commission) })) : [emptyTeam()],
  );
  const [ownRows, setOwnRows] = useState<OwnDraft[]>(
    initial?.ownRows.length
      ? initial.ownRows.map((r) => ({ min: str(r.min), max: str(r.max), luz: str(r.luz), gas: str(r.gas), dd: str(r.dd), fe: str(r.fe), pel: str(r.pel) }))
      : [emptyOwn()],
  );
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
          teamRows: teamRows.map((r) => ({ kind: "team" as const, min: num(r.min), max: num(r.max), commission: num(r.commission) })),
          ownRows: ownRows.map((r) => ({ kind: "own" as const, min: num(r.min), max: num(r.max), luz: num(r.luz), gas: num(r.gas), dd: num(r.dd), fe: num(r.fe), pel: num(r.pel) })),
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
        <Field label="Nome do escalão" className="sm:col-span-2">
          <input aria-label="Nome do escalão" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
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
            Escalão ativo
          </label>
        </Field>
        <Field label="Bloqueio de vendas (nº)" className="sm:col-span-2">
          <input aria-label="Bloqueio de vendas" className="input num" placeholder="0" value={blockedSales} onChange={(e) => setBlockedSales(e.target.value)} />
          <p className="mt-1.5 text-[11.5px] text-ink-3">Nº de vendas da equipa que não são pagas em cada mês. O escalão apura-se pelo total, antes do bloqueio.</p>
        </Field>
      </div>

      <TeamEditor rows={teamRows} onChange={setTeamRows} />
      <OwnEditor rows={ownRows} onChange={setOwnRows} />

      <SubmitRow pending={save.isPending} onCancel={onClose} error={error} extra={initial && <ConfirmDelete pending={remove.isPending} onConfirm={async () => { await remove.mutateAsync({ id: initial.id }); onClose(); }} />} />
    </form>
  );
}

/** Cálculo do escalão de chefe de equipa, por mês. */
function ChiefCalcPanel() {
  const [month, setMonth] = useState(today().slice(0, 7));
  const calc = useChiefCalc(month);
  const rows = calc.data?.chiefs ?? [];
  const total = rows.reduce((s, r) => s + r.commission, 0);

  return (
    <div className="card mt-8 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <div className="font-display text-[15px] font-semibold">Escalão de chefe de equipa</div>
          <div className="text-[11.5px] text-ink-3">O escalão de equipa apura-se pelas vendas LUZ/Dual BTN da equipa em fornecimento no mês (as do próprio chefe contam; o GÁS não conta). As vendas próprias do chefe são pagas por serviço, pelo escalão próprio.</div>
        </div>
        <input aria-label="Mês" type="month" className="input num w-40" value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>
      {calc.isLoading ? (
        <div className="p-5"><div className="skeleton h-24 rounded-[12px]" /></div>
      ) : !rows.length ? (
        <Empty title="Sem chefes com escalão neste mês" text="Nenhum chefe de equipa tem escalão aplicado e vendas no período." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-3">
                <th className="px-5 py-3 font-medium">Nome</th>
                <th className="px-3 py-3 font-medium">Perfil</th>
                <th className="px-3 py-3 font-medium">Escalão</th>
                <th className="px-3 py-3 text-right font-medium">Vendas equipa</th>
                <th className="px-3 py-3 text-right font-medium">Bloqueio</th>
                <th className="px-3 py-3 text-right font-medium">Pagas</th>
                <th className="px-3 py-3 text-right font-medium">Faixa equipa</th>
                <th className="px-3 py-3 text-right font-medium">Equipa</th>
                <th className="px-3 py-3 text-right font-medium">Próprias</th>
                <th className="px-3 py-3 text-right font-medium">Faixa próprias</th>
                <th className="px-5 py-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sellerId} className="border-b border-line last:border-0">
                  <td className="px-5 py-3 font-medium">{r.sellerName}</td>
                  <td className="px-3 py-3"><Pill tone="warn">Chefe</Pill></td>
                  <td className="px-3 py-3 text-ink-2">{r.tableName}</td>
                  <td className="num px-3 py-3 text-right">{r.teamSales}</td>
                  <td className="num px-3 py-3 text-right text-ink-2">−{r.blocked}</td>
                  <td className="num px-3 py-3 text-right">{r.paidSales}</td>
                  <td className="num px-3 py-3 text-right">{r.band ? `${r.band.min ?? 0}${r.band.max == null ? "+" : `–${r.band.max}`}` : "—"}</td>
                  <td className="num px-3 py-3 text-right">{fmtEur(r.teamCommission)}</td>
                  <td className="num px-3 py-3 text-right">{r.ownSales}</td>
                  <td className="num px-3 py-3 text-right">{r.ownBand ? `${r.ownBand.min ?? 0}${r.ownBand.max == null ? "+" : `–${r.ownBand.max}`}` : "—"}</td>
                  <td className="num px-5 py-3 text-right font-semibold">{fmtEur(r.ownCommission)}</td>
                  <td className="num px-5 py-3 text-right font-display font-semibold">{fmtEur(r.commission)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line bg-surface-2/40">
                <td className="px-5 py-3 font-display font-semibold" colSpan={10}>Total</td>
                <td className="num px-5 py-3 text-right font-display text-[15px] font-semibold">{fmtEur(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ChiefTablesPage() {
  const tables = useChiefTables();
  const [edit, setEdit] = useState<Table | null | "new">(null);
  const list = tables.data ?? [];

  return (
    <div>
      <PageHeader
        title="Escalões de Chefe de Equipa"
        subtitle="Escalões de remuneração para chefes de equipa: valor fixo por vendas da equipa e valor por venda própria."
      >
        <button className="btn btn-primary" onClick={() => setEdit("new")}><Plus size={15} /> Novo escalão</button>
      </PageHeader>

      {tables.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (<div key={i} className="card p-5"><div className="skeleton h-40 rounded-[12px]" /></div>))}
        </div>
      ) : !list.length ? (
        <div className="card"><Empty title="Sem escalões de chefe" text="Crie o primeiro escalão com as faixas de vendas da equipa e das vendas próprias." /></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((t) => (
            <div key={t.id} className="card p-5">
              <div className="h-1.5 w-10 rounded-full" style={{ background: t.color }} />
              <div className="mt-3 flex items-start justify-between gap-3">
                <div>
                  <div className="font-display text-[15px] font-semibold">{t.name}</div>
                  <div className="text-[12px] text-ink-3">{t.description || "Sem descrição"}</div>
                </div>
                <button aria-label={`Editar ${t.name}`} className="btn-icon shrink-0" onClick={() => setEdit(t)}><Pencil size={14} /></button>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3 text-center">
                <div><div className="label-mono">EQUIPA</div><div className="num font-display text-[15px] font-semibold">{t.teamRows.length} escalões</div></div>
                <div><div className="label-mono">PRÓPRIAS</div><div className="num font-display text-[15px] font-semibold">{t.ownRows.length} escalões</div></div>
              </div>
              {t.blockedSales > 0 && <div className="mt-3"><Pill tone="muted">Bloqueio: {t.blockedSales} vendas</Pill></div>}
              {!t.active && <div className="mt-3"><Pill tone="muted">Inativo</Pill></div>}
            </div>
          ))}
        </div>
      )}

      <ChiefCalcPanel />

      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit === "new" ? "Novo escalão de chefe" : "Editar escalão de chefe"} wide>
        {edit !== null && <TableForm initial={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
      </Modal>
    </div>
  );
}
