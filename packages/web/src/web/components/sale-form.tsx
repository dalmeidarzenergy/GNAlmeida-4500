import { useState, Fragment } from "react";
import { ArrowLeft, Zap } from "lucide-react";
import { Field, SubmitRow, ConfirmDelete } from "./ui/kit";
import { useClients, useRemoveOrder, useSaveSale } from "../queries/sales";
import { useEmployeeOptions } from "../queries/hr";
import { useCampaigns, campaignState } from "../queries/campaigns";
import { errMsg } from "../lib/format";
import { StatusHistory } from "./status-history";
import { CAMPAIGN_FIELDS, SERVICES, SUPPLIER, clientTypeFromNif, fieldOptions, getSaleForm, validateDetails, type Details, type FieldDef } from "../../api/shared/client-forms";
import { CONCELHOS } from "../../api/shared/concelhos";

const IBER = "#4ade80";

export function DynamicField({ def, value, onChange }: { def: FieldDef; value: string | boolean | null | undefined; onChange: (v: string | boolean | null) => void }) {
  const label = def.label + (def.required ? " *" : "");
  const cls = def.full || def.kind === "textarea" ? "sm:col-span-2" : "";
  if (def.kind === "yesno") {
    return (
      <Field label={label} className={cls}>
        <div className="grid grid-cols-2 gap-2">
          {[true, false].map((b) => (
            <button
              type="button"
              key={String(b)}
              onClick={() => onChange(value === b ? null : b)}
              className={`h-10 rounded-[10px] border text-[13px] transition ${value === b ? (b ? "border-volt/50 bg-volt/10 text-volt" : "border-rose/50 bg-rose/10 text-rose") : "border-line text-ink-2 hover:text-ink"}`}
            >
              {b ? "Sim" : "Não"}
            </button>
          ))}
        </div>
      </Field>
    );
  }
  if (def.kind === "select") {
    return (
      <Field label={label} className={cls}>
        <select aria-label={def.label} className="input" value={(value as string) ?? ""} required={def.required} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">—</option>
          {typeof value === "string" && value && !def.options.includes(value) && <option value={value}>{value}</option>}
          {def.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </Field>
    );
  }
  if (def.kind === "textarea") {
    return (
      <Field label={label} className={cls}>
        <textarea aria-label={def.label} className="input h-auto min-h-[84px] py-2" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />
      </Field>
    );
  }
  const listId = def.suggestions ? `dl-${def.key}` : undefined;
  return (
    <Field label={label} className={cls}>
      <input
        aria-label={def.label}
        className={`input ${def.key === "nif" || def.key === "cpe" || def.key === "cui" || def.key === "contractNumber" ? "num" : ""}`}
        type={def.kind}
        value={(value as string) ?? ""}
        required={def.required}
        pattern={def.pattern}
        title={def.patternHint}
        placeholder={def.placeholder}
        list={listId}
        onChange={(e) => onChange(def.key === "cpe" || def.key === "cui" ? e.target.value.toUpperCase().replace(/\s/g, "") : e.target.value)}
      />
      {def.suggestions && <datalist id={listId}>{def.suggestions.map((o) => <option key={o} value={o}>{o}</option>)}</datalist>}
      {def.patternHint && <p className="mt-1 text-[11px] text-ink-3">{def.patternHint}</p>}
    </Field>
  );
}

function CampaignSelect({ label, current, list, onChange }: { label: string; current: string; list: { id: number; code: string; name: string | null }[]; onChange: (v: string | null) => void }) {
  return (
    <Field label={label}>
      <select aria-label={label} className="input" value={current} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Sem campanha</option>
        {current && !list.some((c) => c.code === current) && <option value={current}>{current}</option>}
        {list.map((c) => <option key={c.id} value={c.code}>{c.code}{c.name ? ` — ${c.name}` : ""}</option>)}
      </select>
    </Field>
  );
}

/** Caixa +AMIGO ao lado do campo de campanha (penaliza 62,5% do valor da luz na previsão). */
function AmigoCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Field label="+AMIGO" className="shrink-0">
      <div className="flex h-10 items-center gap-2">
        <input
          type="checkbox"
          aria-label="+AMIGO"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="h-[18px] w-[18px] accent-volt"
        />
        <span className="text-[13px] text-ink-2">Ativo</span>
      </div>
    </Field>
  );
}

function W2lCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Field label="W2L" className="shrink-0">
      <div className="flex h-10 items-center gap-2">
        <input
          type="checkbox"
          aria-label="W2L"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="h-[18px] w-[18px] accent-volt"
        />
        <span className="text-[13px] text-ink-2">Ativo</span>
      </div>
    </Field>
  );
}

function ServicePicker({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div>
      <p className="mb-4 text-[13.5px] text-ink-2">
        <span className="font-semibold text-ink">{SUPPLIER}</span> — qual o serviço a aderir?
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {SERVICES.map((s) => (
          <button
            type="button"
            key={s.label}
            onClick={() => onPick(s.label)}
            className="flex h-24 flex-col items-center justify-center gap-1 rounded-[14px] border border-line bg-bg transition hover:-translate-y-0.5"
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = IBER)}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "")}
          >
            <span className="font-display text-[16px] font-semibold tracking-wide">{s.label}</span>
            <span className="text-[11px] text-ink-3">{s.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export type SaleInitial = {
  id: number;
  service: string | null;
  details: Details | null;
  clientName: string;
  clientNif: string | null;
  clientPhone: string | null;
  sellerId: number | null;
  sellerName: string | null;
};

function initialValues(fields: FieldDef[], initial?: SaleInitial | null): Details {
  const d: Details = { ...initial?.details };
  if (initial) {
    d.name = initial.clientName;
    d.nif = initial.clientNif ?? "";
    d.contact = initial.clientPhone ?? "";
  }
  for (const f of fields) if (d[f.key] === undefined && f.kind === "select" && f.default) d[f.key] = f.default;
  return d;
}

/** Venda IBERDROLA: serviço → formulário completo da venda (inclui nome, NIF e contacto do cliente). */
export function SaleForm({ initial, onClose, isAdmin }: { initial?: SaleInitial | null; onClose: () => void; isAdmin: boolean }) {
  const emps = useEmployeeOptions();
  const clients = useClients();
  const campaigns = useCampaigns();
  const save = useSaveSale();
  const remove = useRemoveOrder();
  const [service, setService] = useState<string | null>(initial?.service ?? null);
  const [values, setValues] = useState<Details | null>(null);
  const [ownerId, setOwnerId] = useState<number | null>(initial?.sellerId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [known, setKnown] = useState<string | null>(null);

  if (!service) return <ServicePicker onPick={setService} />;
  const form = getSaleForm(service) ?? [];
  const d = values ?? initialValues(form, initial);
  const managers = (emps.data ?? []).filter((x) => x.status !== "inativo");
  // Campanhas ativas para este serviço e tipo de cliente (pelo NIF); a já escolhida mantém-se sempre.
  const nif = typeof d.nif === "string" && /^\d{9}$/.test(d.nif) ? d.nif : null;
  const campaignOptions = (key: string) => {
    const current = typeof d[key] === "string" ? (d[key] as string) : "";
    const services = CAMPAIGN_FIELDS[key](service);
    return {
      current,
      list: (campaigns.data ?? []).filter(
        (c) => c.code === current || (campaignState(c) === "ativa" && (!c.service || services.includes(c.service)) && (c.clientType === "todos" || !nif || c.clientType === clientTypeFromNif(nif))),
      ),
    };
  };

  const change = (key: string, v: string | boolean | null) => {
    const next = { ...d, [key]: v };
    // Ao mudar o distrito, limpa o concelho se não pertencer ao novo distrito.
    if (key === "district" && typeof v === "string" && v && typeof next.municipality === "string" && next.municipality && !(CONCELHOS[v] ?? []).includes(next.municipality)) next.municipality = null;
    // Novo registo: ao escrever um NIF já existente, preenche o nome, o contacto e o gestor.
    if (!initial && key === "nif" && typeof v === "string" && /^\d{9}$/.test(v)) {
      const c = clients.data?.find((x) => x.nif === v);
      if (c) {
        next.name = c.name;
        next.contact = c.phone ?? "";
        if (c.ownerId && !ownerId) setOwnerId(c.ownerId);
        setKnown(c.name);
      } else setKnown(null);
    }
    setValues(next);
  };

  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      setError(null);
      const msg = validateDetails(form, d);
      if (msg) return setError(msg);
      if (isAdmin && !ownerId) return setError("Atribua o gestor do cliente.");
      try {
        const payload = { service, details: d, ownerId };
        if (initial) await save.update.mutateAsync({ ...payload, id: initial.id });
        else await save.create.mutateAsync(payload);
        onClose();
      } catch (err) { setError(errMsg(err)); }
    }}>
      <div className="mb-5 flex items-center justify-between rounded-[12px] border px-4 py-3" style={{ borderColor: `color-mix(in srgb, ${IBER} 35%, transparent)`, background: `color-mix(in srgb, ${IBER} 6%, transparent)` }}>
        <span className="flex min-w-0 items-center gap-2 whitespace-nowrap text-[13px]">
          <Zap size={16} className="shrink-0" style={{ color: IBER }} />
          <strong>{SUPPLIER}</strong>
          <span className="text-ink-3">·</span>
          <span>{service}</span>
        </span>
        <button type="button" onClick={() => { setService(null); setValues(null); }} className="ml-3 flex shrink-0 items-center gap-1 text-[12px] text-ink-3 hover:text-ink">
          <ArrowLeft size={12} /> Alterar serviço
        </button>
      </div>
      {known && <p className="mb-4 rounded-[10px] border border-line bg-bg px-3 py-2 text-[12px] text-ink-2">Cliente já registado: <strong className="text-ink">{known}</strong>. A venda fica associada a esta ficha.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        {form.map((def) => {
          // O motivo do KO só aparece quando há um Estado VTV marcado como KO (luz e/ou gás).
          if (def.key === "koReason") {
            const luzKO = typeof d.vtvStatus === "string" && d.vtvStatus.startsWith("KO-");
            const gasKO = typeof d.vtvStatusGas === "string" && d.vtvStatusGas.startsWith("KO-");
            if (!luzKO && !gasKO) return null;
            return (
              <div key={def.key} className="sm:col-span-2">
                <DynamicField def={def} value={d[def.key]} onChange={(v) => change(def.key, v)} />
              </div>
            );
          }
          // A caixa W2L aparece ao lado do campo de Data de Assinatura. Quando
          // ativa, os campos da leed aparecem logo a seguir (antes dos campos seguintes).
          if (def.key === "signatureDate") {
            const w2lFields = form.filter(f => f.key === "leedNumber" || f.key === "leedCreatedAt" || f.key === "leedStatus" || f.key === "w2lCallDate");
            return (
              <Fragment key={def.key}>
                <div className="flex items-end gap-3">
                  <div className="min-w-0 flex-1">
                    <DynamicField def={def} value={d[def.key]} onChange={(v) => change(def.key, v)} />
                  </div>
                  <W2lCheckbox checked={d.w2l === true} onChange={(v) => change("w2l", v)} />
                </div>
                {d.w2l === true && w2lFields.map(f => (
                  <DynamicField key={f.key} def={f} value={d[f.key]} onChange={(v) => change(f.key, v)} />
                ))}
              </Fragment>
            );
          }
          // A caixa +AMIGO aparece ao lado do campo de campanha de eletricidade.
          if (def.key === "campaign") {
            return (
              <div key={def.key} className="flex items-end gap-3">
                <div className="min-w-0 flex-1">
                  {CAMPAIGN_FIELDS[def.key] && campaigns.data?.length ? (
                    <CampaignSelect label={def.label} {...campaignOptions(def.key)} onChange={(v) => change(def.key, v)} />
                  ) : (
                    <DynamicField def={def} value={d[def.key]} onChange={(v) => change(def.key, v)} />
                  )}
                </div>
                <AmigoCheckbox checked={d.amigo === true} onChange={(v) => change("amigo", v)} />
              </div>
            );
          }
          return CAMPAIGN_FIELDS[def.key] && campaigns.data?.length ? (
            <CampaignSelect key={def.key} label={def.label} {...campaignOptions(def.key)} onChange={(v) => change(def.key, v)} />
          ) : def.key.startsWith("leed") || def.key === "w2lCallDate" ? null : (
            <DynamicField key={def.key} def={def.kind === "select" && def.optionsFrom ? { ...def, options: fieldOptions(def, d) } : def} value={d[def.key]} onChange={(v) => change(def.key, v)} />
          );
        })}
        <div className="rounded-[12px] border border-line bg-bg p-4 sm:col-span-2">
          {isAdmin ? (
            <Field label="Gestor do cliente *">
              <select aria-label="Gestor do cliente" className="input" value={ownerId ?? ""} required onChange={(e) => setOwnerId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Selecione o gestor…</option>
                {managers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </Field>
          ) : (
            <div className="text-[12.5px] text-ink-2">
              <span className="label-mono mb-1 block">Gestor do cliente</span>
              {initial?.sellerName ?? "Atribuído automaticamente a si"}
            </div>
          )}
        </div>
      </div>
      {initial && <StatusHistory saleId={initial.id} isAdmin={isAdmin} dual={service === "DUAL"} />}
      <SubmitRow
        pending={save.isPending}
        onCancel={onClose}
        error={error}
        label={initial ? undefined : "Registar venda"}
        extra={initial && isAdmin && <ConfirmDelete pending={remove.isPending} onConfirm={async () => { await remove.mutateAsync({ id: initial.id }); onClose(); }} />}
      />
    </form>
  );
}
