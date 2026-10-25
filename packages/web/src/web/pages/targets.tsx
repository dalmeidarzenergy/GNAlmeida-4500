import { useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, Trophy } from "lucide-react";
import { useSetTarget, useTargets } from "../queries/sales";
import { useMe } from "../queries/me";
import { TeamFilter, useTeamIds } from "../components/team-filter";
import { PageHeader, Avatar, Modal, Field, SubmitRow, Empty, Progress, Stat } from "../components/ui/kit";
import { errMsg, fmtPct, monthLabel, thisMonth } from "../lib/format";

type Row = NonNullable<ReturnType<typeof useTargets>["data"]>[number];

function shift(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function TargetForm({ row, month, onClose }: { row: Row; month: string; onClose: () => void }) {
  const set = useSetTarget();
  const [target, setTarget] = useState(row.target);
  const [error, setError] = useState<string | null>(null);
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      try { await set.mutateAsync({ sellerId: row.sellerId, month, target: Math.round(Number(target)), commissionRate: row.commissionRate }); onClose(); } catch (err) { setError(errMsg(err)); }
    }}>
      <Field label={`Meta de ${monthLabel(month)} (nº de vendas)`}><input aria-label="Meta (nº de vendas)" className="input num" type="number" min={0} step="1" value={target} onChange={(e) => setTarget(Number(e.target.value))} /></Field>
      <p className="mt-3 text-[12px] text-ink-3">Conta o número de vendas com estado <strong className="text-ink-2">Em Fornecimento</strong> no mês (pela data da venda).</p>
      <SubmitRow pending={set.isPending} onCancel={onClose} error={error} />
    </form>
  );
}

export default function TargetsPage() {
  const me = useMe();
  const [month, setMonth] = useState(thisMonth());
  const t = useTargets(month);
  const isAdmin = me.data?.role === "admin";
  const [edit, setEdit] = useState<Row | null>(null);
  const [team, setTeam] = useState<number | null>(null);
  const teamIds = useTeamIds(isAdmin ? team : null, month);
  const rows = [...(t.data ?? [])].filter((r) => teamIds == null || teamIds.includes(r.sellerId)).sort((a, b) => b.achieved - a.achieved);
  const totTarget = rows.reduce((s, r) => s + r.target, 0);
  const totAch = rows.reduce((s, r) => s + r.achieved, 0);

  return (
    <div>
      <PageHeader eyebrow="Vendas" title="Metas">
        {isAdmin && <TeamFilter value={team} onChange={setTeam} month={month} />}
        <div className="flex items-center gap-1 rounded-[11px] border border-line bg-surface p-1">
          <button className="btn-icon" onClick={() => setMonth(shift(month, -1))}><ChevronLeft size={16} /></button>
          <div className="min-w-[140px] text-center font-display text-[13.5px] font-semibold">{monthLabel(month)}</div>
          <button className="btn-icon" onClick={() => setMonth(shift(month, 1))}><ChevronRight size={16} /></button>
        </div>
      </PageHeader>

      {t.error ? <div className="card"><Empty title="Sem acesso" text={errMsg(t.error)} /></div> : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Stat delay={0} label="Meta total" value={`${totTarget} vendas`} />
            <Stat delay={40} label="Em Fornecimento" value={`${totAch} vendas`} accent="var(--volt)" sub={<Progress value={totTarget ? totAch / totTarget : 0} />} />
            <Stat delay={80} label="Cumprimento" value={totTarget ? fmtPct(totAch / totTarget) : "—"} accent={totAch >= totTarget && totTarget ? "var(--volt)" : "var(--amber)"} />
            <Stat delay={120} label="Faltam" value={`${Math.max(0, totTarget - totAch)} vendas`} accent="var(--sky)" sub="para a meta total" />
          </div>

          {t.isLoading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-48 rounded-[14px]" />)}</div>
          ) : !rows.length ? (
            <div className="card"><Empty title="Sem vendedores" text="Marque funcionários como vendedores na ficha de RH." /></div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {rows.map((r, i) => {
                const hit = r.target > 0 && r.achieved >= r.target;
                return (
                  <div key={r.sellerId} className={`card rise relative overflow-hidden p-5 ${hit ? "border-volt/40" : ""}`} style={{ animationDelay: `${i * 40}ms` }}>
                    {hit && <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-volt/20 blur-2xl" />}
                    <div className="relative flex items-center gap-3">
                      <Avatar name={r.sellerName} size={38} color={hit ? "var(--volt)" : "var(--ink-2)"} src={r.photoUrl} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 font-medium">{r.sellerName}{i === 0 && r.achieved > 0 && rows.length > 1 && <Trophy size={13} className="text-amber" />}</div>
                        <div className="text-[11.5px] text-ink-3">{r.target ? `faltam ${Math.max(0, r.target - r.achieved)}` : "sem meta definida"}</div>
                      </div>
                      {isAdmin && <button className="btn-icon" onClick={() => setEdit(r)}><Pencil size={14} /></button>}
                    </div>
                    <div className="relative mt-5 flex items-end justify-between">
                      <div>
                        <div className="label-mono">Em Fornecimento</div>
                        <div className="num mt-1 text-[22px] font-semibold">{r.achieved} <span className="text-[13px] font-normal text-ink-3">vendas</span></div>
                      </div>
                      <div className={`num text-[28px] font-semibold leading-none ${hit ? "text-volt" : r.progress > 0.7 ? "text-amber" : "text-ink-2"}`}>{r.target ? fmtPct(r.progress) : "—"}</div>
                    </div>
                    <div className="relative mt-3"><Progress value={r.progress} color={hit ? "var(--volt)" : "var(--amber)"} /></div>
                    <div className="relative mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-[12px]">
                      <div><div className="text-ink-3">Meta</div><div className="num mt-0.5">{r.target ? `${r.target} vendas` : "Sem meta"}</div></div>
                      <div className="text-right"><div className="text-ink-3">Realizado</div><div className="num mt-0.5 text-sky">{r.achieved} / {r.target || "—"}</div></div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={`Meta · ${edit?.sellerName ?? ""}`}>
        {edit && <TargetForm row={edit} month={month} onClose={() => setEdit(null)} />}
      </Modal>
    </div>
  );
}
