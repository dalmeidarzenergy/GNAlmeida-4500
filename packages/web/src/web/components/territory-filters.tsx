import { useMemo, useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import type { Territory } from "../../api/shared/territories";
import type { TerritoryFilters as Filters } from "../lib/territory-filters";
import { Field } from "./ui/kit";

const monthFormat = new Intl.DateTimeFormat("pt-PT", { month: "long", timeZone: "UTC" });
const months = Array.from({ length: 12 }, (_, i) => [String(i + 1).padStart(2, "0"), monthFormat.format(new Date(Date.UTC(2020, i, 1)))]);
const collator = new Intl.Collator("pt-PT");
const options = (items: string[]) => [...new Set(items.filter(Boolean))].sort(collator.compare);

export function TerritoryFilters({ rows, filters: f, change, clear, canViewContracts, active, error }: {
  rows: Territory[]; filters: Filters; change: (key: keyof Filters, value: string) => void; clear: () => void;
  canViewContracts: boolean; active: boolean; error?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const districts = useMemo(() => options(rows.map((row) => row.district)), [rows]);
  const municipalities = useMemo(() => options(rows.filter((row) => !f.district || row.district === f.district).map((row) => row.municipality)), [rows, f.district]);
  const advancedActive = !!(f.sweep || f.restMin || f.restMax || f.distance || (canViewContracts && (f.contractsMin || f.contractsMax)));
  const numeric = (label: string, key: keyof Filters, step: string = "1") => (
    <Field label={label}><input className="input w-full min-w-0" type="number" min="0" step={step} value={f[key]} onChange={(e) => change(key, e.target.value)} /></Field>
  );
  return <div aria-label="Filtros de territórios" role="region" className="border-t border-line px-4 py-4 sm:px-5">
    <div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
      <Field label="Pesquisar por localização">
        <span className="relative block">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden="true" />
          <input type="search" className="input w-full pl-9" placeholder="Pesquisar distrito ou concelho…" value={f.query} onChange={(e) => change("query", e.target.value)} />
        </span>
      </Field>
      <Field label="Distrito">
        <select className="input w-full" aria-label="Distrito" value={f.district} onChange={(e) => change("district", e.target.value)}>
          <option value="">Todos os distritos</option>
          {districts.map((district) => <option key={district}>{district}</option>)}
        </select>
      </Field>
      <Field label="Concelho">
        <select className="input w-full" aria-label="Concelho" value={f.municipality} onChange={(e) => change("municipality", e.target.value)}>
          <option value="">Todos os concelhos</option>
          {municipalities.map((municipality) => <option key={municipality}>{municipality}</option>)}
        </select>
      </Field>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-ghost" aria-expanded={expanded} aria-controls="territory-advanced-filters" onClick={() => setExpanded((value) => !value)}>
          <SlidersHorizontal size={15} aria-hidden="true" /> Filtros avançados{advancedActive && <span className="text-[11px] text-ink-2">· Ativos</span>}
        </button>
        <button type="button" className="btn btn-ghost" disabled={!active} onClick={clear}>Limpar filtros</button>
      </div>
    </div>
    <div id="territory-advanced-filters" hidden={!expanded} className="mt-4 rounded-lg border border-line bg-surface-2/50 p-3 sm:p-4">
      <div className="grid gap-x-5 gap-y-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-2">
          <Field label="Último varrimento">
            <select className="input w-full" aria-label="Último varrimento" value={f.sweep} onChange={(e) => change("sweep", e.target.value)}>
              <option value="">Qualquer data</option><option value="month">Por mês</option><option value="range">Intervalo de datas</option><option value="missing">Sem data</option>
            </select>
          </Field>
          {f.sweep === "month" && <Field label="Mês do último varrimento">
            <select className="input w-full capitalize" aria-label="Mês do último varrimento" value={f.month} onChange={(e) => change("month", e.target.value)}>
              <option value="">Todos os meses com data</option>{months.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>}
          {f.sweep === "range" && <div className="grid grid-cols-2 gap-2">
            <Field label="Data inicial"><input type="date" className="input w-full min-w-0" value={f.from} onChange={(e) => change("from", e.target.value)} /></Field>
            <Field label="Data final"><input type="date" className="input w-full min-w-0" value={f.to} onChange={(e) => change("to", e.target.value)} /></Field>
          </div>}
        </div>
        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-xs font-medium text-ink-2">Meses de descanso</legend>
          <div className="grid grid-cols-2 gap-2">{numeric("Descanso mínimo", "restMin")}{numeric("Descanso máximo", "restMax")}</div>
        </fieldset>
        {canViewContracts && <fieldset className="min-w-0">
          <legend className="mb-1.5 text-xs font-medium text-ink-2">Contratos em fornecimento</legend>
          <div className="grid grid-cols-2 gap-2">{numeric("Contratos mín.", "contractsMin")}{numeric("Contratos máx.", "contractsMax")}</div>
        </fieldset>}
        <div className="space-y-2">
          <Field label="Distância à sede">
            <select className="input w-full" aria-label="Distância à sede" value={f.distance} onChange={(e) => change("distance", e.target.value)}>
              <option value="">Todas as distâncias</option><option value="range">Intervalo em km</option><option value="no_route">Sem rota</option>
            </select>
          </Field>
          {f.distance === "range" && <div className="grid grid-cols-2 gap-2">{numeric("KM mínimo", "kmMin", "0.1")}{numeric("KM máximo", "kmMax", "0.1")}</div>}
        </div>
      </div>
    </div>
    {error && <p className="mt-3 text-xs text-danger" role="alert">{error}</p>}
  </div>;
}