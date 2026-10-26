import { useState, useMemo, Fragment } from "react";
import { Plus, Trash2, Loader2, Calculator, Check, X, ChevronDown, ChevronUp, FileSpreadsheet } from "lucide-react";
import { PageHeader, Empty, Field, Tabs, Modal, Stat } from "../components/ui/kit";
import {
  useIncentives,
  useIncentive,
  useCreateIncentive,
  useUpdateIncentive,
  useRemoveIncentive,
  useIncentiveCalc,
  useSaveIncentiveCalc,
  useIncentiveCalcs,
  useRemoveIncentiveCalc,
} from "../queries/incentives";
import { useMe } from "../queries/me";
import { OLD_SUPPLIERS, DISTRICTS, POWERS_KVA } from "../../api/shared/client-forms";
import { errMsg, fmtEur, monthLabel, thisMonth } from "../lib/format";
import type { IncentivePillar, IncentiveRules } from "../../api/database/schema";

// ── Helpers ──

const SERVICES = ["LUZ", "GÁS", "DUAL", "SOLAR"];
const SEGMENTS = ["particular", "empresa"];
const VOLTAGES = ["BTN", "BTE", "MT"];

export default function IncentivosPage() {
  const me = useMe();
  const canEdit = me.data?.permissions?.incentivos?.edit ?? false;

  // List
  const { data: incentives, isLoading } = useIncentives();

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const { data: editData } = useIncentive(editId ?? 0);

  // Detail / calc
  const [detailId, setDetailId] = useState<number | null>(null);

  if (isLoading) {
    return <div className="p-5 lg:p-7"><div className="skeleton mb-8 h-14 w-72" /><div className="card"><div className="skeleton h-64 rounded-[14px]" /></div></div>;
  }

  return (
    <div className="p-5 lg:p-7">
      <PageHeader
        eyebrow="Pagamentos"
        title="Incentivos"
        subtitle="Incentivos comerciais com regras configuráveis."
      >
        {canEdit && (
          <button className="btn btn-primary" onClick={() => { setEditId(null); setShowForm(true); }}>
            <Plus size={15} /> Novo incentivo
          </button>
        )}
      </PageHeader>

      {detailId != null ? (
        <IncentiveDetail
          id={detailId}
          onBack={() => setDetailId(null)}
          canEdit={canEdit}
          onEdit={() => { setEditId(detailId); setShowForm(true); setDetailId(null); }}
        />
      ) : (
        <>
          {!incentives?.length ? (
            <div className="card"><Empty title="Ainda sem incentivos" text={canEdit ? "Crie o primeiro incentivo para começar." : "Ainda não há incentivos definidos."} /></div>
          ) : (
            <div className="space-y-3">
              {incentives.map((inc) => (
                <div key={inc.id} className="card rise flex items-center justify-between p-4 cursor-pointer" onClick={() => setDetailId(inc.id)}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-display text-[15px] font-semibold">{inc.name}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${inc.active ? "bg-volt/10 text-volt" : "bg-ink-2/10 text-ink-3"}`}>
                        {inc.active ? "Ativo" : "Inativo"}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[12px] text-ink-3">
                      {inc.startDate} → {inc.endDate}
                      {inc.description ? ` · ${inc.description.slice(0, 80)}${inc.description.length > 80 ? "…" : ""}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="rounded-full bg-ink-2/5 px-2.5 py-1 text-[11px] text-ink-2">
                      {inc.rules.pillars.length} {inc.rules.pillars.length === 1 ? "pilar" : "pilares"}
                    </span>
                    {canEdit && (
                      <button
                        className="btn btn-sm btn-ghost text-danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm("Remover este incentivo?")) removeInc.mutate(inc.id);
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {showForm && (
        <IncentiveForm
          data={editId ? editData : undefined}
          onClose={() => { setShowForm(false); setEditId(null); }}
          canEdit={canEdit}
        />
      )}
    </div>
  );
}

// ── Form ──

function IncentiveForm({ data, onClose, canEdit }: { data?: NonNullable<ReturnType<typeof useIncentive>["data"]>; onClose: () => void; canEdit: boolean }) {
  const create = useCreateIncentive();
  const update = useUpdateIncentive();
  const busy = create.isPending || update.isPending;
  const isEdit = !!data;

  const [name, setName] = useState(data?.name ?? "");
  const [description, setDescription] = useState(data?.description ?? "");
  const [startDate, setStartDate] = useState(data?.startDate ?? "");
  const [endDate, setEndDate] = useState(data?.endDate ?? "");
  const [active, setActive] = useState(data?.active ?? true);

  const [rules, setRules] = useState<IncentiveRules>(
    data?.rules ?? {
      eligibleServices: [],
      eligibleSuppliers: [],
      eligibleVoltages: [],
      eligiblePowers: [],
      eligibleSegments: [],
      excludeOffers: [],
      zbrDistricts: [],
      pillars: [],
    },
  );

  const save = async () => {
    const payload = { name, description: description || undefined, startDate, endDate, active, rules };
    if (isEdit) {
      await update.mutateAsync({ id: data!.id, ...payload });
    } else {
      await create.mutateAsync(payload);
    }
    onClose();
  };

  const toggleArr = (arr: string[], val: string) =>
    arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val];

  const addPillar = (type: "per_sale" | "tiered_mix") => {
    const p: IncentivePillar = type === "per_sale"
      ? { type: "per_sale", name: "", amount: 0, conditionKey: "", conditionValues: [] }
      : { type: "tiered_mix", name: "", percentageOf: "", percentageOfValues: [], baseRate: 0, tiers: [] };
    setRules({ ...rules, pillars: [...rules.pillars, p] });
  };

  const updatePillar = (idx: number, p: IncentivePillar) => {
    const next = [...rules.pillars];
    next[idx] = p;
    setRules({ ...rules, pillars: next });
  };

  const removePillar = (idx: number) => {
    setRules({ ...rules, pillars: rules.pillars.filter((_, i) => i !== idx) });
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? "Editar incentivo" : "Novo incentivo"} wide>
      <div className="space-y-5 max-h-[75vh] overflow-y-auto pr-1">
        {/* Basic info */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome"><input className="input h-10 w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Incentivo Verão 2026" /></Field>
          <div />
          <Field label="Data de início"><input className="input h-10 w-full" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
          <Field label="Data de fim"><input className="input h-10 w-full" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
          <Field label="Descrição"><textarea className="input w-full" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Opcional" /></Field>
          <Field label="Estado">
            <div className="flex items-center gap-3 mt-1">
              <label className="flex items-center gap-2 text-[13px] cursor-pointer">
                <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="checkbox" />
                Ativo
              </label>
            </div>
          </Field>
        </div>

        <hr className="border-line" />

        {/* Eligibility */}
        <div>
          <div className="font-display text-[15px] font-semibold mb-3">Critérios de elegibilidade</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <ChipGroup label="Serviços" options={SERVICES} selected={rules.eligibleServices} onChange={(v) => setRules({ ...rules, eligibleServices: toggleArr(rules.eligibleServices, v) })} />
            <ChipGroup label="Segmento" options={SEGMENTS} selected={rules.eligibleSegments} onChange={(v) => setRules({ ...rules, eligibleSegments: toggleArr(rules.eligibleSegments, v) })} />
            <ChipGroup label="Nível de tensão" options={VOLTAGES} selected={rules.eligibleVoltages} onChange={(v) => setRules({ ...rules, eligibleVoltages: toggleArr(rules.eligibleVoltages, v) })} />
            <ChipGroup label="Potência (kVA)" options={POWERS_KVA} selected={rules.eligiblePowers} onChange={(v) => setRules({ ...rules, eligiblePowers: toggleArr(rules.eligiblePowers, v) })} />
          </div>
          <div className="mt-3">
            <Field label="Antigos comercializadores elegíveis">
              <ChipGroup options={OLD_SUPPLIERS} selected={rules.eligibleSuppliers} onChange={(v) => setRules({ ...rules, eligibleSuppliers: toggleArr(rules.eligibleSuppliers, v) })} multiCol />
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Excluir ofertas (campanhas que não qualificam)">
              <input
                className="input h-10 w-full"
                placeholder='Separar por vírgula (ex.: "Plano Poupança Inteligente, Oferta X")'
                value={rules.excludeOffers.join(", ")}
                onChange={(e) => setRules({ ...rules, excludeOffers: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              />
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Distritos ZBR (zona baixo rácio) — os restantes são ZAR">
              <ChipGroup options={DISTRICTS} selected={rules.zbrDistricts} onChange={(v) => setRules({ ...rules, zbrDistricts: toggleArr(rules.zbrDistricts, v) })} multiCol />
            </Field>
          </div>
        </div>

        <hr className="border-line" />

        {/* Pillars */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="font-display text-[15px] font-semibold">Pilares</div>
            <div className="flex gap-2">
              <button className="btn btn-sm btn-outline" onClick={() => addPillar("per_sale")}><Plus size={13} /> Por venda</button>
              <button className="btn btn-sm btn-outline" onClick={() => addPillar("tiered_mix")}><Plus size={13} /> Mix escalonado</button>
            </div>
          </div>

          {rules.pillars.length === 0 && (
            <div className="rounded-[10px] border border-dashed border-line p-4 text-center text-[13px] text-ink-3">
              Nenhum pilar definido. Adicione um para começar.
            </div>
          )}

          {rules.pillars.map((p, i) => (
            <PillarEditor
              key={i}
              pillar={p}
              index={i}
              onChange={(upd) => updatePillar(i, upd)}
              onRemove={() => removePillar(i)}
            />
          ))}
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn btn-primary" onClick={save} disabled={busy || !name || !startDate || !endDate}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : isEdit ? "Guardar" : "Criar"}
        </button>
      </div>
    </Modal>
  );
}

/** Grupo de chips selecionáveis (multi). */
function ChipGroup({ label, options, selected, onChange, multiCol }: { label?: string; options: string[]; selected: string[]; onChange: (v: string) => void; multiCol?: boolean }) {
  return (
    <div>
      {label && <div className="text-[12px] font-medium text-ink-2 mb-1.5">{label}</div>}
      <div className={`flex flex-wrap gap-1.5 ${multiCol ? "" : ""}`}>
        {options.map((o) => (
          <button
            key={o}
            type="button"
            className={`rounded-full px-3 py-1 text-[12px] border transition-colors ${
              selected.includes(o)
                ? "bg-volt/10 border-volt text-volt"
                : "border-line text-ink-2 hover:border-ink-3"
            }`}
            onClick={() => onChange(o)}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Editor de um pilar individual. */
function PillarEditor({ pillar, index, onChange, onRemove }: { pillar: IncentivePillar; index: number; onChange: (p: IncentivePillar) => void; onRemove: () => void }) {
  return (
    <div className="rounded-[10px] border border-line p-4 mb-3">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="rounded bg-ink-2/5 px-2 py-0.5 text-[11px] font-medium text-ink-2">
            {pillar.type === "per_sale" ? "Valor por venda" : "Mix escalonado"}
          </span>
          <span className="text-[13px] font-medium">{pillar.name || `Pilar ${index + 1}`}</span>
        </div>
        <button className="btn btn-ghost text-danger p-1" onClick={onRemove}><Trash2 size={14} /></button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome do pilar">
          <input className="input h-10 w-full" value={pillar.name} onChange={(e) => onChange({ ...pillar, name: e.target.value })} placeholder="Ex.: Bónus Zona" />
        </Field>

        {pillar.type === "per_sale" ? (
          <>
            <Field label="Valor por venda (€)">
              <input className="input h-10 w-full" type="number" min="0" step="0.01" value={pillar.amount} onChange={(e) => onChange({ ...pillar, amount: parseFloat(e.target.value) || 0 })} />
            </Field>
            <Field label="Campo de condição">
              <select className="input h-10 w-full" value={pillar.conditionKey} onChange={(e) => onChange({ ...pillar, conditionKey: e.target.value })}>
                <option value="">—</option>
                <option value="zone">Zona (ZAR / ZBR)</option>
                <option value="oldSupplier">Antigo comercializador</option>
                <option value="service">Serviço</option>
              </select>
            </Field>
            <Field label="Valores da condição">
              <input
                className="input h-10 w-full"
                placeholder='Separar por vírgula (ex.: "ZAR, ZBR")'
                value={pillar.conditionValues.join(", ")}
                onChange={(e) => onChange({ ...pillar, conditionValues: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="% sobre vendas de">
              <select className="input h-10 w-full" value={pillar.percentageOf} onChange={(e) => onChange({ ...pillar, percentageOf: e.target.value })}>
                <option value="">—</option>
                <option value="oldSupplier">Antigo comercializador</option>
                <option value="zone">Zona</option>
              </select>
            </Field>
            <Field label="Valores alvo">
              <input
                className="input h-10 w-full"
                placeholder='Separar por vírgula (ex.: "EDP Comercial, SU Eletricidade, Entrada Direta")'
                value={pillar.percentageOfValues.join(", ")}
                onChange={(e) => onChange({ ...pillar, percentageOfValues: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              />
            </Field>
            <Field label="Taxa base (%)">
              <input className="input h-10 w-full" type="number" min="0" step="0.1" value={pillar.baseRate} onChange={(e) => onChange({ ...pillar, baseRate: parseFloat(e.target.value) || 0 })} />
            </Field>
            <div className="sm:col-span-2">
              <div className="text-[12px] font-medium text-ink-2 mb-2">Patamares</div>
              {(pillar.tiers ?? []).map((t, ti) => (
                <div key={ti} className="flex items-center gap-2 mb-2">
                  <input
                    className="input h-9 w-20"
                    type="number"
                    min="0" step="0.1"
                    placeholder="%"
                    value={t.pct}
                    onChange={(e) => {
                      const nt = [...(pillar.tiers ?? [])];
                      nt[ti] = { ...nt[ti], pct: parseFloat(e.target.value) || 0 };
                      onChange({ ...pillar, tiers: nt });
                    }}
                  />
                  <span className="text-[13px] text-ink-3">% →</span>
                  <input
                    className="input h-9 flex-1"
                    placeholder="Nome do patamar"
                    value={t.label}
                    onChange={(e) => {
                      const nt = [...(pillar.tiers ?? [])];
                      nt[ti] = { ...nt[ti], label: e.target.value };
                      onChange({ ...pillar, tiers: nt });
                    }}
                  />
                  <input
                    className="input h-9 w-24"
                    type="number" min="0" step="0.01"
                    placeholder="€ por venda"
                    value={t.amount}
                    onChange={(e) => {
                      const nt = [...(pillar.tiers ?? [])];
                      nt[ti] = { ...nt[ti], amount: parseFloat(e.target.value) || 0 };
                      onChange({ ...pillar, tiers: nt });
                    }}
                  />
                  <button
                    className="btn btn-ghost text-danger p-1"
                    onClick={() => onChange({ ...pillar, tiers: (pillar.tiers ?? []).filter((_, j) => j !== ti) })}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              <button
                className="btn btn-sm btn-outline"
                onClick={() => onChange({ ...pillar, tiers: [...(pillar.tiers ?? []), { pct: 0, label: "", amount: 0 }] })}
              >
                <Plus size={13} /> Patamar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Detail / Calculation View ──

function IncentiveDetail({ id, onBack, canEdit, onEdit }: { id: number; onBack: () => void; canEdit: boolean; onEdit: () => void }) {
  const { data: inc, isLoading } = useIncentive(id);
  const [calcMonth, setCalcMonth] = useState(thisMonth());
  const [showCalc, setShowCalc] = useState(false);
  const { data: calcData, isLoading: calcLoading, refetch: recalc } = useIncentiveCalc(id, showCalc ? calcMonth : "");
  const saveCalc = useSaveIncentiveCalc();
  const { data: savedCalcs } = useIncentiveCalcs(id);
  const removeCalc = useRemoveIncentiveCalc();

  // Staff list for employee names (comes from existing queries)
  const { data: me } = useMe();

  if (isLoading || !inc) return <div className="card"><div className="skeleton h-64 rounded-[14px]" /></div>;

  const rules = inc.rules;
  const currentCalc = savedCalcs?.find((c) => c.month === calcMonth);

  return (
    <div className="space-y-4">
      <button className="btn btn-ghost text-[13px]" onClick={onBack}>&larr; Voltar</button>

      <div className="card p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-display text-[18px] font-semibold">{inc.name}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${inc.active ? "bg-volt/10 text-volt" : "bg-ink-2/10 text-ink-3"}`}>
                {inc.active ? "Ativo" : "Inativo"}
              </span>
            </div>
            <div className="text-[13px] text-ink-3">{inc.startDate} → {inc.endDate}</div>
            {inc.description && <div className="mt-2 text-[13px] text-ink-2">{inc.description}</div>}
          </div>
          {canEdit && (
            <button className="btn btn-outline" onClick={onEdit}>Editar</button>
          )}
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-[10px] border border-line p-3">
            <div className="text-[11px] text-ink-3">Serviços</div>
            <div className="mt-1 text-[13px] font-medium">{rules.eligibleServices.length ? rules.eligibleServices.join(", ") : "Todos"}</div>
          </div>
          <div className="rounded-[10px] border border-line p-3">
            <div className="text-[11px] text-ink-3">Nível de tensão</div>
            <div className="mt-1 text-[13px] font-medium">{rules.eligibleVoltages.length ? rules.eligibleVoltages.join(", ") : "Todos"}</div>
          </div>
          <div className="rounded-[10px] border border-line p-3">
            <div className="text-[11px] text-ink-3">Comercializadores</div>
            <div className="mt-1 text-[13px] font-medium">{rules.eligibleSuppliers.length ? rules.eligibleSuppliers.join(", ") : "Todos"}</div>
          </div>
          <div className="rounded-[10px] border border-line p-3">
            <div className="text-[11px] text-ink-3">Pilares</div>
            <div className="mt-1 text-[13px] font-medium">{rules.pillars.length}</div>
          </div>
        </div>
      </div>

      {/* Calculation section */}
      <div className="card p-5">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="font-display text-[17px] font-semibold">Cálculo</div>
          <div className="flex items-center gap-3">
            <input className="input h-10 w-44" type="month" value={calcMonth} onChange={(e) => setCalcMonth(e.target.value)} />
            <button className="btn btn-primary" onClick={() => { setShowCalc(true); recalc(); }}>
              <Calculator size={15} /> Calcular
            </button>
          </div>
        </div>

        {showCalc && calcLoading && <div className="skeleton h-32 rounded-[10px]" />}

        {showCalc && calcData && (
          <>
            <div className="mb-3 text-[13px] text-ink-2">
              {calcData.rows.length} comerciais · {calcData.rows.reduce((s, r) => s + r.total, 0).toFixed(0)}€ total
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-ink-3">
                    <th className="pb-2 font-medium">Comercial</th>
                    <th className="pb-2 font-medium text-center">Total vendas</th>
                    <th className="pb-2 font-medium text-center">Elegíveis</th>
                    <th className="pb-2 font-medium text-center">Mix %</th>
                    <th className="pb-2 font-medium">Pilares</th>
                    <th className="pb-2 font-medium text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {calcData.rows.map((r) => (
                    <tr key={r.employeeId} className="border-b border-line/50">
                      <td className="py-2.5 font-medium">{r.employeeName}</td>
                      <td className="py-2.5 text-center">{r.totalSales}</td>
                      <td className="py-2.5 text-center">{r.eligibleSales}</td>
                      <td className="py-2.5 text-center">{r.mixPct}%</td>
                      <td className="py-2.5">
                        <div className="space-y-0.5">
                          {r.pillars.map((p, i) => (
                            <div key={i} className="text-[11px]">
                              <span className="text-ink-2">{p.name}:</span>{" "}
                              <span className="font-medium">{fmtEur(p.amount)}</span>
                              <span className="text-ink-3 ml-1">({p.detail})</span>
                            </div>
                          ))}
                          {!r.pillars.length && <span className="text-ink-3">—</span>}
                        </div>
                      </td>
                      <td className="py-2.5 text-right font-semibold text-volt">{fmtEur(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex justify-end gap-3">
              {currentCalc ? (
                <button
                  className="btn btn-ghost text-danger"
                  onClick={() => { if (confirm("Remover este cálculo?")) removeCalc.mutate(currentCalc.id); }}
                >
                  <Trash2 size={14} /> Remover
                </button>
              ) : null}
              <button
                className="btn btn-outline"
                onClick={() => saveCalc.mutate({ incentiveId: id, month: calcMonth, status: "draft", rows: calcData.rows })}
                disabled={saveCalc.isPending}
              >
                {saveCalc.isPending ? <Loader2 size={14} className="animate-spin" /> : "Guardar rascunho"}
              </button>
              {canEdit && (
                <button
                  className="btn btn-primary"
                  onClick={() => saveCalc.mutate({ incentiveId: id, month: calcMonth, status: "approved", rows: calcData.rows })}
                  disabled={saveCalc.isPending}
                >
                  <Check size={15} /> Aprovar
                </button>
              )}
            </div>
          </>
        )}

        {!showCalc && (
          <div className="rounded-[10px] border border-dashed border-line p-6 text-center text-[13px] text-ink-3">
            Escolha um mês e clique em Calcular para pré-visualizar os incentivos.
          </div>
        )}
      </div>

      {/* Saved calculations */}
      {savedCalcs && savedCalcs.length > 0 && (
        <div className="card p-5">
          <div className="font-display text-[17px] font-semibold mb-3">Cálculos guardados</div>
          <div className="space-y-2">
            {savedCalcs.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-[10px] border border-line p-3">
                <div className="flex items-center gap-3">
                  <span className="font-medium">{monthLabel(c.month)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    c.status === "approved" ? "bg-volt/10 text-volt" : "bg-ink-2/10 text-ink-3"
                  }`}>
                    {c.status === "approved" ? "Aprovado" : "Rascunho"}
                  </span>
                  <span className="text-[12px] text-ink-3">
                    {c.rows.reduce((s, r) => s + r.total, 0).toFixed(0)}€ · {c.rows.length} comerciais
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="btn btn-sm btn-ghost text-danger"
                    onClick={() => { if (confirm("Remover este cálculo?")) removeCalc.mutate(c.id); }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}