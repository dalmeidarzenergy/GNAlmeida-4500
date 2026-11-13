/**
 * Página "Frota".
 *
 * Cinco separadores:
 *  - Viaturas     — a ficha de cada viatura (matrícula, condutor, km, estado).
 *  - Quilómetros  — o histórico de leituras de km por viatura. A quilometragem
 *                   da viatura acompanha sempre a leitura mais recente; a coluna
 *                   "Diferença" mostra os km feitos entre duas leituras.
 *  - Manutenções  — revisões, óleo, pneus, inspeção e reparações, com oficina,
 *                   custo e o aviso da próxima intervenção (aos km ou na data).
 *  - Cartões frota— cartões de combustível e a viatura/titular de cada um.
 *  - Documentos   — todos os anexos, de viaturas, cartões e manutenções.
 *
 * Os ficheiros ficam em `public/uploads/fleet` e são servidos em `/uploads/fleet/…`.
 * Filtros por estado e por mês de referência: o mês olha para a data de entrada
 * da viatura (createdAt), para se ver o que já existia na frota nesse mês.
 */
import { useMemo, useState } from "react";
import {
  CarFront, Plus, Search, Pencil, FileText, Upload, Trash2, Fuel, Gauge, AlertTriangle, Paperclip, CreditCard, Wrench, History, CalendarClock,
} from "lucide-react";
import { PageHeader, Stat, Empty, Tabs, Modal, Field, SubmitRow, ConfirmDelete } from "../components/ui/kit";
import { errMsg } from "../lib/format";
import { useMe } from "../queries/me";
import {
  useVehicles, useFleetCards, useFleetDrivers,
  useSaveVehicle, useRemoveVehicle, useSaveCard, useRemoveCard,
  useUploadFleetDoc, useRemoveFleetDoc, useFleetDocs,
  useReadings, useAddReading, useRemoveReading,
  useSaveMaintenance, useRemoveMaintenance,
} from "../queries/fleet";

const VEHICLE_STATUS = [
  { key: "ativo", label: "Ativas", chip: "ativo", cls: "border-volt/40 bg-volt/10 text-volt" },
  { key: "manutencao", label: "Em manutenção", chip: "em manutenção", cls: "border-amber/40 bg-amber/10 text-amber" },
  { key: "inativo", label: "Inativas", chip: "inativa", cls: "border-line bg-surface-2 text-ink-3" },
] as const;

const DOC_KINDS = [
  { key: "livrete", label: "Livrete" },
  { key: "seguro", label: "Seguro" },
  { key: "inspecao", label: "Inspeção" },
  { key: "contrato", label: "Contrato" },
  { key: "fatura", label: "Fatura" },
  { key: "outro", label: "Outro" },
] as const;

const FUELS = ["Diesel", "Gasolina", "Elétrico", "Híbrido", "GPL", "Outro"];

const MAINT_KINDS = [
  { key: "revisao", label: "Revisão" },
  { key: "oleo", label: "Mudança de óleo" },
  { key: "pneus", label: "Pneus" },
  { key: "inspecao", label: "Inspeção" },
  { key: "reparacao", label: "Reparação" },
  { key: "outro", label: "Outro" },
] as const;

const MAINT_STATUS = [
  { key: "agendada", label: "Agendada", cls: "border-sky/40 bg-sky/10 text-sky" },
  { key: "em_curso", label: "Em curso", cls: "border-amber/40 bg-amber/10 text-amber" },
  { key: "concluida", label: "Concluída", cls: "border-volt/40 bg-volt/10 text-volt" },
] as const;

const READ_SOURCES = [
  { key: "manual", label: "Manual" },
  { key: "inspecao", label: "Inspeção" },
  { key: "manutencao", label: "Manutenção" },
  { key: "importacao", label: "Importação" },
] as const;

type Maint = {
  id: number; vehicleId: number; kind: string; status: string;
  scheduledOn: string | null; doneOn: string | null; km: number | null;
  nextKm: number | null; nextOn: string | null; workshop: string | null;
  cost: number; paidBy: string | null; description: string | null; notes: string | null;
};

type Vehicle = NonNullable<ReturnType<typeof useVehicles>["data"]>[number];
type Card = NonNullable<ReturnType<typeof useFleetCards>["data"]>[number];
type Doc = { id: number; kind: string; name: string; path: string; size: number; expiresOn: string | null; vehicleId: number | null; cardId: number | null; maintenanceId: number | null };

function pad(v: number) {
  return v < 10 ? "0" + v : "" + v;
}

function todayLisbon() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" });
}

function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  const names = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  return names[Number(m) - 1] + " " + y;
}

function parseYM(ym: string) {
  const [yy, mm] = ym.split("-");
  return { y: Number(yy), m: Number(mm) };
}

function monthOptions(count: number) {
  const { y, m } = parseYM(todayLisbon().slice(0, 7));
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(y, m - 1 - i, 1);
    out.push(d.getFullYear() + "-" + pad(d.getMonth() + 1));
  }
  return out;
}

/** Data (timestamp ms ou Date) -> "YYYY-MM" no fuso de Lisboa. */
function monthOf(v: unknown) {
  if (v == null) return "";
  const d = v instanceof Date ? v : new Date(typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : String(v));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" }).slice(0, 7);
}

function fmtDate(v: unknown) {
  if (v == null) return "—";
  const d = v instanceof Date ? v : new Date(typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : String(v));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" });
}

function fmtSize(n: number) {
  if (!n) return "—";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

function StateChip({ status }: { status: string }) {
  const m = VEHICLE_STATUS.find((s) => s.key === status) ?? VEHICLE_STATUS[0];
  return <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${m.cls}`}>{m.chip}</span>;
}

/* ------------------------------------------------------------------ viatura */

function VehicleForm({ initial, onClose }: { initial: Vehicle | null; onClose: () => void }) {
  const save = useSaveVehicle();
  const remove = useRemoveVehicle();
  const drivers = useFleetDrivers();
  const [f, setF] = useState({
    plate: initial?.plate ?? "",
    brand: initial?.brand ?? "",
    model: initial?.model ?? "",
    year: initial?.year != null ? String(initial.year) : "",
    fuel: initial?.fuel ?? "Diesel",
    km: initial?.km != null ? String(initial.km) : "0",
    employeeId: initial?.employeeId != null ? String(initial.employeeId) : "",
    status: (initial?.status ?? "ativo") as "ativo" | "manutencao" | "inativo",
    notes: initial?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          const payload = {
            plate: f.plate,
            brand: f.brand || null,
            model: f.model || null,
            year: f.year ? Number(f.year) : null,
            fuel: f.fuel || null,
            km: Number(f.km || 0),
            employeeId: f.employeeId ? Number(f.employeeId) : null,
            status: f.status,
            notes: f.notes || null,
          };
          if (initial) await save.update.mutateAsync({ ...payload, id: initial.id });
          else await save.create.mutateAsync(payload);
          onClose();
        } catch (err) {
          setError(errMsg(err));
        }
      }}
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Matrícula">
            <input aria-label="Matrícula" className="input uppercase" value={f.plate} onChange={(e) => set("plate", e.target.value)} placeholder="AA-00-AA" required />
          </Field>
          <Field label="Estado">
            <select aria-label="Estado" className="input" value={f.status} onChange={(e) => set("status", e.target.value)}>
              {VEHICLE_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="Marca">
            <input aria-label="Marca" className="input" value={f.brand} onChange={(e) => set("brand", e.target.value)} />
          </Field>
          <Field label="Modelo">
            <input aria-label="Modelo" className="input" value={f.model} onChange={(e) => set("model", e.target.value)} />
          </Field>
          <Field label="Ano">
            <input aria-label="Ano" className="input" type="number" min={1950} max={2100} value={f.year} onChange={(e) => set("year", e.target.value)} />
          </Field>
          <Field label="Combustível">
            <select aria-label="Combustível" className="input" value={f.fuel} onChange={(e) => set("fuel", e.target.value)}>
              {FUELS.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </Field>
          <Field label="Quilómetros">
            <input aria-label="Quilómetros" className="input" type="number" min={0} value={f.km} onChange={(e) => set("km", e.target.value)} />
          </Field>
          <Field label="Condutor">
            <select aria-label="Condutor" className="input" value={f.employeeId} onChange={(e) => set("employeeId", e.target.value)}>
              <option value="">Sem condutor</option>
              {drivers.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Notas">
          <textarea aria-label="Notas" className="input" rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      </div>
      <SubmitRow
        pending={save.isPending}
        onCancel={onClose}
        error={error}
        extra={initial && (
          <ConfirmDelete
            pending={remove.isPending}
            title="Eliminar esta viatura?"
            description="Os documentos anexados a esta viatura também são eliminados. Os cartões frota associados ficam sem viatura."
            onConfirm={async () => { await remove.mutateAsync({ id: initial.id }); onClose(); }}
          />
        )}
      />
    </form>
  );
}

/* -------------------------------------------------------------------- cartão */

function CardForm({ initial, onClose }: { initial: Card | null; onClose: () => void }) {
  const save = useSaveCard();
  const remove = useRemoveCard();
  const drivers = useFleetDrivers();
  const vehicles = useVehicles();
  const [f, setF] = useState({
    provider: initial?.provider ?? "",
    number: initial?.number ?? "",
    pin: initial?.pin ?? "",
    vehicleId: initial?.vehicleId != null ? String(initial.vehicleId) : "",
    employeeId: initial?.employeeId != null ? String(initial.employeeId) : "",
    monthlyLimit: initial?.monthlyLimit != null ? String(initial.monthlyLimit) : "0",
    startDate: initial?.startDate ?? "",
    endDate: initial?.endDate ?? "",
    status: (initial?.status ?? "ativo") as "ativo" | "inativo",
    notes: initial?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          const payload = {
            provider: f.provider,
            number: f.number,
            pin: f.pin || null,
            vehicleId: f.vehicleId ? Number(f.vehicleId) : null,
            employeeId: f.employeeId ? Number(f.employeeId) : null,
            monthlyLimit: Number(f.monthlyLimit || 0),
            startDate: f.startDate || null,
            endDate: f.endDate || null,
            status: f.status,
            notes: f.notes || null,
          };
          if (initial) await save.update.mutateAsync({ ...payload, id: initial.id });
          else await save.create.mutateAsync(payload);
          onClose();
        } catch (err) {
          setError(errMsg(err));
        }
      }}
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Fornecedor">
            <input aria-label="Fornecedor" className="input" value={f.provider} onChange={(e) => set("provider", e.target.value)} placeholder="Galp, Repsol, Via Verde…" required />
          </Field>
          <Field label="Número do cartão">
            <input aria-label="Número do cartão" className="input" value={f.number} onChange={(e) => set("number", e.target.value)} required />
          </Field>
          <Field label="PIN">
            <input aria-label="PIN" className="input" value={f.pin} onChange={(e) => set("pin", e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Limite mensal (€)">
            <input aria-label="Limite mensal" className="input" type="number" min={0} step="0.01" value={f.monthlyLimit} onChange={(e) => set("monthlyLimit", e.target.value)} />
          </Field>
          <Field label="Viatura">
            <select aria-label="Viatura" className="input" value={f.vehicleId} onChange={(e) => set("vehicleId", e.target.value)}>
              <option value="">Sem viatura</option>
              {vehicles.data?.map((v) => <option key={v.id} value={v.id}>{v.plate}{v.model ? " · " + v.model : ""}</option>)}
            </select>
          </Field>
          <Field label="Titular">
            <select aria-label="Titular" className="input" value={f.employeeId} onChange={(e) => set("employeeId", e.target.value)}>
              <option value="">Sem titular</option>
              {drivers.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Atribuído em">
            <input aria-label="Atribuído em" className="input" type="date" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} />
          </Field>
          <Field label="Devolvido em">
            <input aria-label="Devolvido em" className="input" type="date" value={f.endDate} onChange={(e) => set("endDate", e.target.value)} />
          </Field>
        </div>
        <Field label="Estado">
          <select aria-label="Estado do cartão" className="input" value={f.status} onChange={(e) => set("status", e.target.value)}>
            <option value="ativo">Ativo</option>
            <option value="inativo">Inativo</option>
          </select>
        </Field>
        <Field label="Notas">
          <textarea aria-label="Notas do cartão" className="input" rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      </div>
      <SubmitRow
        pending={save.isPending}
        onCancel={onClose}
        error={error}
        extra={initial && (
          <ConfirmDelete
            pending={remove.isPending}
            title="Eliminar este cartão frota?"
            description="Os documentos anexados ao cartão também são eliminados."
            onConfirm={async () => { await remove.mutateAsync({ id: initial.id }); onClose(); }}
          />
        )}
      />
    </form>
  );
}

/* ------------------------------------------------------------------ anexos */

function DocList({
  docs, onRemove, canEdit,
}: {
  docs: Doc[]; onRemove: (id: number) => void; canEdit: boolean;
}) {
  if (!docs.length) return <div className="text-[12px] text-ink-3">Sem documentos anexados.</div>;
  return (
    <ul className="divide-y divide-line rounded-[10px] border border-line">
      {docs.map((d) => (
        <li key={d.id} className="flex items-center gap-3 px-3 py-2">
          <FileText size={14} className="shrink-0 text-ink-3" />
          <a href={d.path} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-[12.5px] hover:text-volt">
            {d.name}
          </a>
          <span className="shrink-0 text-[11px] text-ink-3">{DOC_KINDS.find((k) => k.key === d.kind)?.label ?? "Outro"}</span>
          <span className="num w-16 shrink-0 text-right text-[11px] text-ink-3">{fmtSize(d.size)}</span>
          {d.expiresOn && <span className="num shrink-0 text-[11px] text-ink-3">val. {d.expiresOn}</span>}
          {canEdit && (
            <button type="button" className="shrink-0 text-ink-3 hover:text-danger" aria-label="Apagar documento" onClick={() => onRemove(d.id)}>
              <Trash2 size={13} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------- quilómetros */

function ReadingForm({ vehicleId, onDone }: { vehicleId: number; onDone: () => void }) {
  const add = useAddReading();
  const drivers = useFleetDrivers();
  const [recordedOn, setRecordedOn] = useState(() => todayLisbon());
  const [km, setKm] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [source, setSource] = useState("manual");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await add.mutateAsync({
            vehicleId,
            recordedOn,
            km: Number(km || 0),
            employeeId: employeeId ? Number(employeeId) : null,
            source: source as "manual" | "inspecao" | "manutencao" | "importacao",
            notes: notes || null,
          });
          onDone();
        } catch (err) {
          setError(errMsg(err));
        }
      }}
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Data da leitura">
            <input aria-label="Data da leitura" className="input" type="date" value={recordedOn} onChange={(e) => setRecordedOn(e.target.value)} required />
          </Field>
          <Field label="Quilómetros">
            <input aria-label="Quilómetros da leitura" className="input" type="number" min={0} value={km} onChange={(e) => setKm(e.target.value)} placeholder="Ex.: 45650" required />
          </Field>
          <Field label="Registado por">
            <select aria-label="Registado por" className="input" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">—</option>
              {drivers.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Origem">
            <select aria-label="Origem da leitura" className="input" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="manual">Manual</option>
              <option value="inspecao">Inspeção</option>
              <option value="manutencao">Manutenção</option>
              <option value="importacao">Importação</option>
            </select>
          </Field>
        </div>
        <Field label="Notas">
          <textarea aria-label="Notas da leitura" className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <SubmitRow pending={add.isPending} onCancel={onDone} label="Registar" error={error} />
    </form>
  );
}

function ReadingHistory({ vehicleId, canEdit }: { vehicleId: number; canEdit: boolean }) {
  const readings = useReadings(vehicleId);
  const remove = useRemoveReading();
  const rows = readings.data ?? [];
  if (readings.isLoading) return <div className="text-[12.5px] text-ink-3">A carregar…</div>;
  if (!rows.length) return <div className="text-[12.5px] text-ink-3">Ainda sem registos de quilómetros.</div>;
  return (
    <div className="overflow-x-auto rounded-[10px] border border-line">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="border-b border-line text-left text-ink-3">
            <th className="label-mono px-3 py-2 font-normal">Data</th>
            <th className="label-mono px-3 py-2 font-normal">Km</th>
            <th className="label-mono px-3 py-2 font-normal">Diferença</th>
            <th className="label-mono px-3 py-2 font-normal">Registado por</th>
            <th className="label-mono px-3 py-2 font-normal">Origem</th>
            <th className="px-3 py-2"><span className="sr-only">Ações</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const prev = rows[i + 1];
            const diff = prev ? r.km - prev.km : null;
            return (
              <tr key={r.id} className="border-b border-line last:border-b-0">
                <td className="num px-3 py-2">{r.recordedOn}</td>
                <td className="num px-3 py-2 font-medium">{r.km.toLocaleString("pt-PT")}</td>
                <td className="num px-3 py-2 text-ink-3">{diff == null ? "—" : (diff > 0 ? "+" : "") + diff.toLocaleString("pt-PT")}</td>
                <td className="px-3 py-2 text-ink-2">{r.employeeName ?? "—"}</td>
                <td className="px-3 py-2 text-ink-3">{READ_SOURCES.find((s) => s.key === r.source)?.label ?? "Manual"}</td>
                <td className="px-3 py-2 text-right">
                  {canEdit && (
                    <button type="button" className="text-ink-3 hover:text-danger" aria-label="Apagar leitura" onClick={() => remove.mutate({ id: r.id })}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------------------------------------- manutenções */

function MaintenanceForm({ initial, onDone }: { initial: Maint | null; onDone: () => void }) {
  const save = useSaveMaintenance();
  const remove = useRemoveMaintenance();
  const vehicles = useVehicles();
  const [f, setF] = useState({
    vehicleId: initial?.vehicleId != null ? String(initial.vehicleId) : "",
    kind: initial?.kind ?? "revisao",
    status: initial?.status ?? "agendada",
    scheduledOn: initial?.scheduledOn ?? todayLisbon(),
    doneOn: initial?.doneOn ?? "",
    km: initial?.km != null ? String(initial.km) : "",
    nextKm: initial?.nextKm != null ? String(initial.nextKm) : "",
    nextOn: initial?.nextOn ?? "",
    workshop: initial?.workshop ?? "",
    cost: initial?.cost != null ? String(initial.cost) : "0",
    paidBy: initial?.paidBy ?? "",
    description: initial?.description ?? "",
    notes: initial?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if (!f.vehicleId) return setError("Escolha a viatura.");
        try {
          const payload = {
            vehicleId: Number(f.vehicleId),
            kind: f.kind as "revisao" | "pneus" | "inspecao" | "reparacao" | "oleo" | "outro",
            status: f.status as "agendada" | "em_curso" | "concluida",
            scheduledOn: f.scheduledOn || null,
            doneOn: f.doneOn || null,
            km: f.km ? Number(f.km) : null,
            nextKm: f.nextKm ? Number(f.nextKm) : null,
            nextOn: f.nextOn || null,
            workshop: f.workshop || null,
            cost: Number(f.cost || 0),
            paidBy: f.paidBy || null,
            description: f.description || null,
            notes: f.notes || null,
          };
          if (initial) await save.update.mutateAsync({ ...payload, id: initial.id });
          else await save.create.mutateAsync(payload);
          onDone();
        } catch (err) {
          setError(errMsg(err));
        }
      }}
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {!initial && (
            <Field label="Viatura">
              <select aria-label="Viatura da manutenção" className="input" value={f.vehicleId} onChange={(e) => set("vehicleId", e.target.value)} required>
                <option value="">Escolher…</option>
                {vehicles.data?.map((v) => <option key={v.id} value={v.id}>{v.plate}{v.model ? " · " + v.model : ""}</option>)}
              </select>
            </Field>
          )}
          <Field label="Tipo">
            <select aria-label="Tipo de manutenção" className="input" value={f.kind} onChange={(e) => set("kind", e.target.value)}>
              {MAINT_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          </Field>
          <Field label="Estado">
            <select aria-label="Estado da manutenção" className="input" value={f.status} onChange={(e) => set("status", e.target.value)}>
              {MAINT_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </Field>
          <Field label={f.status === "concluida" ? "Concluída em" : "Marcada para"}>
            <input aria-label="Data agendada" className="input" type="date" value={f.scheduledOn} onChange={(e) => set("scheduledOn", e.target.value)} />
          </Field>
          <Field label="Ficou pronta em">
            <input aria-label="Data de conclusão" className="input" type="date" value={f.doneOn} onChange={(e) => set("doneOn", e.target.value)} />
          </Field>
          <Field label="Km à entrada">
            <input aria-label="Km à entrada" className="input" type="number" min={0} value={f.km} onChange={(e) => set("km", e.target.value)} />
          </Field>
          <Field label="Oficina">
            <input aria-label="Oficina" className="input" value={f.workshop} onChange={(e) => set("workshop", e.target.value)} />
          </Field>
          <Field label="Custo (€)">
            <input aria-label="Custo" className="input" type="number" min={0} step="0.01" value={f.cost} onChange={(e) => set("cost", e.target.value)} />
          </Field>
          <Field label="Pago por">
            <input aria-label="Pago por" className="input" value={f.paidBy} onChange={(e) => set("paidBy", e.target.value)} placeholder="Empresa, cartão frota…" />
          </Field>
        </div>
        <div className="rounded-[10px] border border-line bg-bg/40 p-3">
          <div className="label-mono mb-2">Próxima intervenção</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Aos km">
              <input aria-label="Próxima aos km" className="input" type="number" min={0} value={f.nextKm} onChange={(e) => set("nextKm", e.target.value)} placeholder="Ex.: 60000" />
            </Field>
            <Field label="Ou na data">
              <input aria-label="Próxima na data" className="input" type="date" value={f.nextOn} onChange={(e) => set("nextOn", e.target.value)} />
            </Field>
          </div>
        </div>
        <Field label="Descrição">
          <textarea aria-label="Descrição" className="input" rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <Field label="Notas">
          <textarea aria-label="Notas da manutenção" className="input" rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      </div>
      <SubmitRow
        pending={save.isPending}
        onCancel={onDone}
        error={error}
        extra={initial && (
          <ConfirmDelete
            pending={remove.isPending}
            title="Eliminar esta manutenção?"
            description="Os documentos anexados a esta manutenção também são eliminados."
            onConfirm={async () => { await remove.mutateAsync({ id: initial.id }); onDone(); }}
          />
        )}
      />
    </form>
  );
}

function UploadForm({
  vehicleId, cardId, maintenanceId, onDone,
}: {
  vehicleId?: number; cardId?: number; maintenanceId?: number; onDone: () => void;
}) {
  const upload = useUploadFleetDoc();
  const [kind, setKind] = useState<string>("livrete");
  const [expiresOn, setExpiresOn] = useState("");
  const [name, setName] = useState("");
  const [content, setContent] = useState<string>("");
  const [mime, setMime] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const read = (file: File) => {
    if (file.size > 12 * 1024 * 1024) return setError("Ficheiro demasiado grande (máximo 12 MB).");
    const r = new FileReader();
    r.onload = () => {
      setContent(String(r.result ?? ""));
      setName(file.name);
      setMime(file.type || "application/octet-stream");
      setError(null);
    };
    r.readAsDataURL(file);
  };

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if (!content) return setError("Escolha um ficheiro.");
        try {
          await upload.mutateAsync({
            vehicleId: vehicleId ?? null,
            cardId: cardId ?? null,
            maintenanceId: maintenanceId ?? null,
            kind: kind as "livrete" | "seguro" | "inspecao" | "contrato" | "fatura" | "outro",
            name: name || "documento",
            content,
            mime,
            expiresOn: expiresOn || null,
          });
          onDone();
        } catch (err) {
          setError(errMsg(err));
        }
      }}
    >
      <div className="space-y-4">
        <Field label="Ficheiro (PDF, imagem, Word…)">
          <input
            aria-label="Ficheiro"
            className="input pt-2"
            type="file"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); }}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tipo">
            <select aria-label="Tipo de documento" className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
              {DOC_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          </Field>
          <Field label="Validade (opcional)">
            <input aria-label="Validade" className="input" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
          </Field>
        </div>
        {name && <div className="text-[12px] text-ink-3">Anexar: <span className="text-ink-2">{name}</span></div>}
      </div>
      <SubmitRow pending={upload.isPending} onCancel={onDone} label="Anexar" error={error} />
    </form>
  );
}

/* ------------------------------------------------------------------- página */

export default function FrotaPage() {
  const me = useMe();
  const vehicles = useVehicles();
  const cards = useFleetCards();
  const removeDoc = useRemoveFleetDoc();

  const canEdit = me.data?.permissions?.frota?.edit ?? (me.data?.role === "admin" || me.data?.role === "diretor");

  const months = useMemo(() => monthOptions(24), []);
  const [month, setMonth] = useState(() => todayLisbon().slice(0, 7));
  const [area, setArea] = useState<"viaturas" | "km" | "manutencoes" | "cartoes" | "documentos">("viaturas");
  const [state, setState] = useState<"ativo" | "manutencao" | "inativo" | "todos">("ativo");
  const [mState, setMState] = useState<"agendada" | "em_curso" | "concluida" | "todas">("todas");
  const [q, setQ] = useState("");

  const [editVehicle, setEditVehicle] = useState<Vehicle | null | "new">(null);
  const [editCard, setEditCard] = useState<Card | null | "new">(null);
  const [editMaint, setEditMaint] = useState<Maint | null | "new">(null);
  const [readingFor, setReadingFor] = useState<{ id: number; label: string } | null>(null);
  const [docsFor, setDocsFor] = useState<{ kind: "vehicle" | "card" | "maint"; id: number; label: string } | null>(null);
  const [uploadFor, setUploadFor] = useState<{ vehicleId?: number; cardId?: number; maintenanceId?: number; label: string } | null>(null);

  const vlist = vehicles.data ?? [];
  const clist = cards.data ?? [];

  const vehicleRows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return vlist.filter(
      (v) =>
        monthOf(v.createdAt) <= month &&
        (state === "todos" || v.status === state) &&
        (!s || v.plate.toLowerCase().includes(s) || (v.model ?? "").toLowerCase().includes(s) || (v.brand ?? "").toLowerCase().includes(s) || (v.driverName ?? "").toLowerCase().includes(s)),
    );
  }, [vlist, state, q, month]);

  const countVehicle = (f: string) => vlist.filter((v) => monthOf(v.createdAt) <= month && (f === "todos" || v.status === f)).length;

  const cardRows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return clist.filter(
      (c) =>
        (state === "todos" || (state === "inativo" ? c.status === "inativo" : c.status === "ativo")) &&
        (!s || c.provider.toLowerCase().includes(s) || c.number.toLowerCase().includes(s) || (c.plate ?? "").toLowerCase().includes(s) || (c.holderName ?? "").toLowerCase().includes(s)),
    );
  }, [clist, state, q]);

  const fleetDocs = useFleetDocs();
  const docsAll = fleetDocs.data ?? [];

  const allDocs = useMemo<(Doc & { owner: string; ownerKind: "vehicle" | "card" | "maint" })[]>(() => {
    const plates = new Map<number, string>();
    const maintOwner = new Map<number, string>();
    for (const v of vlist) {
      plates.set(v.id, v.plate);
      for (const m of v.maintenance) {
        maintOwner.set(m.id, v.plate + " · " + (MAINT_KINDS.find((k) => k.key === m.kind)?.label ?? "Manutenção"));
      }
    }
    const cardsById = new Map(clist.map((c) => [c.id, c] as const));
    const out: (Doc & { owner: string; ownerKind: "vehicle" | "card" | "maint" })[] = [];
    for (const d of docsAll as unknown as Doc[]) {
      if (d.maintenanceId != null) {
        out.push({ ...d, owner: maintOwner.get(d.maintenanceId) ?? "Manutenção", ownerKind: "maint" });
      } else if (d.cardId != null) {
        const c = cardsById.get(d.cardId);
        out.push({ ...d, owner: c ? c.provider + " " + c.number : "Cartão frota", ownerKind: "card" });
      } else if (d.vehicleId != null) {
        out.push({ ...d, owner: plates.get(d.vehicleId) ?? "Viatura", ownerKind: "vehicle" });
      }
    }
    return out.sort((a, b) => b.id - a.id);
  }, [docsAll, vlist, clist]);

  const docRows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return allDocs.filter((d) => !s || d.name.toLowerCase().includes(s) || d.owner.toLowerCase().includes(s));
  }, [allDocs, q]);

  /** Leitura mais recente de cada viatura — a fila do separador Km. */
  const kmRows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return vlist
      .filter((v) => !s || v.plate.toLowerCase().includes(s) || (v.model ?? "").toLowerCase().includes(s) || (v.driverName ?? "").toLowerCase().includes(s))
      .map((v) => {
        const rs = [...v.readings].sort((a, b) => b.recordedOn.localeCompare(a.recordedOn) || b.id - a.id);
        const last = rs[0];
        const prev = rs[1];
        return {
          v,
          last,
          diff: last && prev ? last.km - prev.km : null,
          count: rs.length,
          stale: !last || last.recordedOn < month + "-01",
        };
      })
      .sort((a, b) => (a.last?.km ?? -1) - (b.last?.km ?? -1));
  }, [vlist, q, month]);

  /** Todas as manutenções com a matrícula, ordenadas da mais recente. */
  const maintAll = useMemo(() => {
    const out: (Maint & { plate: string; model: string | null })[] = [];
    for (const v of vlist) for (const m of v.maintenance) out.push({ ...(m as Maint), plate: v.plate, model: v.model });
    return out.sort((a, b) => (b.scheduledOn ?? "").localeCompare(a.scheduledOn ?? "") || b.id - a.id);
  }, [vlist]);

  const maintRows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return maintAll.filter(
      (m) =>
        (mState === "todas" || m.status === mState) &&
        (!s || m.plate.toLowerCase().includes(s) || (m.workshop ?? "").toLowerCase().includes(s) || (MAINT_KINDS.find((k) => k.key === m.kind)?.label ?? "").toLowerCase().includes(s)),
    );
  }, [maintAll, q, mState]);

  const abertas = maintAll.filter((m) => m.status !== "concluida");
  const custoTotal = maintAll.filter((m) => m.status === "concluida").reduce((a, m) => a + m.cost, 0);
  const kmTotal = vlist.reduce((a, v) => a + v.km, 0);
  const semLeitura = vlist.filter((v) => !v.readings.length).length;
  const readingsMonth = vlist.reduce((a, v) => a + v.readings.filter((r) => r.recordedOn.startsWith(month)).length, 0);
  const lastRead = vlist.flatMap((v) => v.readings.map((r) => r.recordedOn)).sort().pop() ?? null;

  return (
    <>
      <PageHeader
        eyebrow="GESTÃO DE EMPRESA"
        title="Frota"
        subtitle="Viaturas, quilómetros, manutenções, cartões frota e documentos de cada uma. Filtra por estado e por mês de referência."
      >
        {canEdit && (
          <div className="flex gap-2">
            <button className="btn btn-ghost" onClick={() => setEditCard("new")}>
              <CreditCard size={15} /> Novo cartão
            </button>
            <button className="btn btn-ghost" onClick={() => setEditMaint("new")}>
              <Wrench size={15} /> Nova manutenção
            </button>
            <button className="btn btn-primary" onClick={() => setEditVehicle("new")}>
              <Plus size={15} /> Nova viatura
            </button>
          </div>
        )}
      </PageHeader>

      <div className="card rise mb-5 flex flex-wrap items-end gap-3 p-4">
        <label className="flex flex-col gap-1">
          <span className="label-mono">Mês de referência</span>
          <select className="input w-52" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Mês de referência">
            {months.map((m) => (
              <option key={m} value={m}>{monthLabel(m)}{m === todayLisbon().slice(0, 7) ? " (atual)" : ""}</option>
            ))}
          </select>
        </label>

        {area === "manutencoes" ? (
          <label className="flex flex-col gap-1">
            <span className="label-mono">Estado</span>
            <select className="input w-48" value={mState} onChange={(e) => setMState(e.target.value as typeof mState)} aria-label="Estado da manutenção">
              <option value="todas">Todas</option>
              <option value="agendada">Agendadas</option>
              <option value="em_curso">Em curso</option>
              <option value="concluida">Concluídas</option>
            </select>
          </label>
        ) : area === "viaturas" || area === "cartoes" ? (
          <label className="flex flex-col gap-1">
            <span className="label-mono">Estado</span>
            <select className="input w-48" value={state} onChange={(e) => setState(e.target.value as typeof state)} aria-label="Estado">
              {area === "viaturas" ? (
                <>
                  <option value="ativo">Ativas</option>
                  <option value="manutencao">Em manutenção</option>
                  <option value="inativo">Inativas</option>
                  <option value="todos">Todas</option>
                </>
              ) : (
                <>
                  <option value="ativo">Ativos</option>
                  <option value="inativo">Inativos</option>
                  <option value="todos">Todos</option>
                </>
              )}
            </select>
          </label>
        ) : null}

        <label className="flex min-w-[180px] flex-1 flex-col gap-1">
          <span className="label-mono">Procurar</span>
          <span className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input className="input pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder={area === "viaturas" || area === "km" ? "Matrícula, modelo ou condutor…" : area === "manutencoes" ? "Viatura, oficina ou tipo…" : area === "cartoes" ? "Fornecedor, número ou titular…" : "Documento ou dono…"} />
          </span>
        </label>

        <div className="pb-0.5">
          <Tabs
            value={area}
            onChange={setArea}
            items={[
              { key: "viaturas" as const, label: "Viaturas", count: countVehicle(state) },
              { key: "km" as const, label: "Quilómetros", count: kmRows.length },
              { key: "manutencoes" as const, label: "Manutenções", count: maintRows.length },
              { key: "cartoes" as const, label: "Cartões frota", count: cardRows.length },
              { key: "documentos" as const, label: "Documentos", count: docRows.length },
            ]}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {area === "km" ? (
          <>
            <Stat label="Km na frota" value={kmTotal.toLocaleString("pt-PT")} sub={vlist.length + " viaturas"} icon={<Gauge size={15} />} delay={0} />
            <Stat label="Leituras no mês" value={readingsMonth} sub={monthLabel(month)} icon={<History size={15} />} accent="var(--sky)" delay={40} />
            <Stat label="Sem leitura" value={semLeitura} sub="viaturas por registar" icon={<AlertTriangle size={15} />} accent="var(--amber)" delay={80} />
            <Stat label="Última leitura" value={lastRead ?? "—"} sub="registo mais recente" icon={<CalendarClock size={15} />} accent="var(--rose)" delay={120} />
          </>
        ) : area === "manutencoes" ? (
          <>
            <Stat label="Manutenções" value={maintAll.length} sub={abertas.length + " por concluir"} icon={<Wrench size={15} />} delay={0} />
            <Stat label="Agendadas" value={maintAll.filter((m) => m.status === "agendada").length} sub="à espera de ir à oficina" icon={<CalendarClock size={15} />} accent="var(--sky)" delay={40} />
            <Stat label="Em curso" value={maintAll.filter((m) => m.status === "em_curso").length} sub="na oficina" icon={<AlertTriangle size={15} />} accent="var(--amber)" delay={80} />
            <Stat label="Custo" value={custoTotal.toLocaleString("pt-PT", { style: "currency", currency: "EUR" })} sub="intervenções concluídas" icon={<Fuel size={15} />} accent="var(--rose)" delay={120} />
          </>
        ) : (
          <>
            <Stat label="Viaturas" value={countVehicle("todos")} sub={monthLabel(month)} icon={<CarFront size={15} />} delay={0} />
            <Stat label="Ativas" value={countVehicle("ativo")} sub="em circulação" icon={<Gauge size={15} />} accent="var(--sky)" delay={40} />
            <Stat label="Em manutenção" value={countVehicle("manutencao")} sub="paradas na oficina" icon={<AlertTriangle size={15} />} accent="var(--amber)" delay={80} />
            <Stat label="Cartões frota" value={clist.length} sub={clist.filter((c) => c.status === "ativo").length + " ativos"} icon={<Fuel size={15} />} accent="var(--rose)" delay={120} />
          </>
        )}
      </div>

      <div className="card rise mt-6 overflow-hidden">
        {vehicles.isLoading || cards.isLoading ? (
          <div className="px-6 py-16 text-center text-[13px] text-ink-3">A carregar…</div>
        ) : area === "viaturas" ? (
          !vehicleRows.length ? (
            <Empty
              title={vlist.length ? "Nenhuma viatura neste filtro" : "Ainda sem viaturas registadas"}
              text={vlist.length ? "Muda o mês ou o estado." : "Cria a primeira viatura com matrícula, modelo, condutor e quilómetros."}
              action={canEdit ? <button className="btn btn-primary" onClick={() => setEditVehicle("new")}><Plus size={15} /> Nova viatura</button> : undefined}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-line text-left text-ink-3">
                    <th className="label-mono px-4 py-3 font-normal">Viatura</th>
                    <th className="label-mono px-4 py-3 font-normal">Condutor</th>
                    <th className="label-mono px-4 py-3 font-normal">Quilómetros</th>
                    <th className="label-mono px-4 py-3 font-normal">Combustível</th>
                    <th className="label-mono px-4 py-3 font-normal">Docs</th>
                    <th className="label-mono px-4 py-3 font-normal">Estado</th>
                    <th className="px-4 py-3"><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {vehicleRows.map((v) => (
                    <tr key={v.id} className="border-b border-line last:border-b-0 hover:bg-surface-2/60">
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{v.plate}</div>
                        <div className="text-[11.5px] text-ink-3">{[v.brand, v.model, v.year].filter(Boolean).join(" ") || "—"}</div>
                      </td>
                      <td className="px-4 py-2.5 text-ink-2">{v.driverName ?? "Sem condutor"}</td>
                      <td className="num px-4 py-2.5 text-ink-2">{v.km.toLocaleString("pt-PT")}</td>
                      <td className="px-4 py-2.5 text-ink-2">{v.fuel ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <button type="button" className="inline-flex items-center gap-1 text-ink-2 hover:text-volt" onClick={() => setDocsFor({ kind: "vehicle", id: v.id, label: v.plate })}>
                          <Paperclip size={13} /> {v.documents.length}
                        </button>
                      </td>
                      <td className="px-4 py-2.5"><StateChip status={v.status} /></td>
                      <td className="px-4 py-2.5 text-right">
                        {canEdit && (
                          <div className="flex items-center justify-end gap-2">
                            <button type="button" title="Anexar documento" aria-label="Anexar documento" className="text-ink-3 hover:text-volt" onClick={() => setUploadFor({ vehicleId: v.id, label: v.plate })}>
                              <Upload size={14} />
                            </button>
                            <button type="button" title="Editar" aria-label="Editar viatura" className="text-ink-3 hover:text-ink" onClick={() => setEditVehicle(v)}>
                              <Pencil size={14} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : area === "km" ? (
          !kmRows.length ? (
            <Empty
              title={vlist.length ? "Nenhuma viatura nesta procura" : "Ainda sem viaturas registadas"}
              text={vlist.length ? "Limpa a procura para veres a frota toda." : "Regista primeiro uma viatura para lhe apontares os quilómetros."}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-line text-left text-ink-3">
                    <th className="label-mono px-4 py-3 font-normal">Viatura</th>
                    <th className="label-mono px-4 py-3 font-normal">Condutor</th>
                    <th className="label-mono px-4 py-3 font-normal">Última leitura</th>
                    <th className="label-mono px-4 py-3 font-normal">Km</th>
                    <th className="label-mono px-4 py-3 font-normal">Diferença</th>
                    <th className="label-mono px-4 py-3 font-normal">Registos</th>
                    <th className="px-4 py-3"><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {kmRows.map(({ v, last, diff, count, stale }) => (
                    <tr key={v.id} className="border-b border-line last:border-b-0 hover:bg-surface-2/60">
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{v.plate}</div>
                        <div className="text-[11.5px] text-ink-3">{[v.brand, v.model].filter(Boolean).join(" ") || "—"}</div>
                      </td>
                      <td className="px-4 py-2.5 text-ink-2">{v.driverName ?? "Sem condutor"}</td>
                      <td className="num px-4 py-2.5 text-ink-2">
                        {last ? last.recordedOn : <span className="text-amber">sem leituras</span>}
                        {stale && last && <span className="ml-2 rounded-full border border-amber/40 bg-amber/10 px-1.5 py-0.5 text-[10px] text-amber">atrasada</span>}
                      </td>
                      <td className="num px-4 py-2.5 font-medium">{(last ? last.km : v.km).toLocaleString("pt-PT")}</td>
                      <td className="num px-4 py-2.5 text-ink-3">{diff == null ? "—" : (diff > 0 ? "+" : "") + diff.toLocaleString("pt-PT")}</td>
                      <td className="num px-4 py-2.5 text-ink-3">{count}</td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-ink-2 hover:text-volt"
                          aria-label={"Registar quilómetros de " + v.plate}
                          onClick={() => setReadingFor({ id: v.id, label: v.plate })}
                        >
                          <Plus size={13} /> Registar km
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : area === "manutencoes" ? (
          !maintRows.length ? (
            <Empty
              title={maintAll.length ? "Nenhuma manutenção neste filtro" : "Ainda sem manutenções registadas"}
              text={maintAll.length ? "Muda o estado ou a procura." : "Marca a próxima revisão, inspeção ou mudança de óleo de uma viatura."}
              action={canEdit ? <button className="btn btn-primary" onClick={() => setEditMaint("new")}><Wrench size={15} /> Nova manutenção</button> : undefined}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-line text-left text-ink-3">
                    <th className="label-mono px-4 py-3 font-normal">Viatura</th>
                    <th className="label-mono px-4 py-3 font-normal">Intervenção</th>
                    <th className="label-mono px-4 py-3 font-normal">Estado</th>
                    <th className="label-mono px-4 py-3 font-normal">Marcada</th>
                    <th className="label-mono px-4 py-3 font-normal">Pronta</th>
                    <th className="label-mono px-4 py-3 font-normal">Km</th>
                    <th className="label-mono px-4 py-3 font-normal">Oficina</th>
                    <th className="label-mono px-4 py-3 font-normal">Custo</th>
                    <th className="label-mono px-4 py-3 font-normal">Docs</th>
                    <th className="px-4 py-3"><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {maintRows.map((m) => {
                    const st = MAINT_STATUS.find((x) => x.key === m.status) ?? MAINT_STATUS[0];
                    const nDocs = docsAll.filter((d) => d.maintenanceId === m.id).length;
                    const next = m.nextKm != null ? "próx. aos " + m.nextKm.toLocaleString("pt-PT") + " km" : m.nextOn ? "próx. em " + m.nextOn : "";
                    return (
                      <tr key={m.id} className="border-b border-line last:border-b-0 hover:bg-surface-2/60">
                        <td className="px-4 py-2.5">
                          <div className="font-medium">{m.plate}</div>
                          <div className="text-[11.5px] text-ink-3">{m.model ?? "—"}</div>
                        </td>
                        <td className="px-4 py-2.5 text-ink-2">
                          <div>{MAINT_KINDS.find((k) => k.key === m.kind)?.label ?? "Outro"}</div>
                          <div className="text-[11.5px] text-ink-3">{m.description || next || "—"}</div>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={"rounded-full border px-2 py-0.5 text-[10.5px] font-medium " + st.cls}>{st.label}</span>
                        </td>
                        <td className="num px-4 py-2.5 text-ink-3">{m.scheduledOn ?? "—"}</td>
                        <td className="num px-4 py-2.5 text-ink-3">{m.doneOn ?? "—"}</td>
                        <td className="num px-4 py-2.5 text-ink-2">{m.km != null ? m.km.toLocaleString("pt-PT") : "—"}</td>
                        <td className="px-4 py-2.5 text-ink-2">{m.workshop ?? "—"}</td>
                        <td className="num px-4 py-2.5 text-ink-2">{m.cost ? m.cost.toFixed(2) + " €" : "—"}</td>
                        <td className="px-4 py-2.5">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-ink-2 hover:text-volt"
                            aria-label={"Documentos da manutenção de " + m.plate}
                            onClick={() => setDocsFor({ kind: "maint", id: m.id, label: m.plate + " · " + (MAINT_KINDS.find((k) => k.key === m.kind)?.label ?? "Manutenção") })}
                          >
                            <Paperclip size={13} /> {nDocs}
                          </button>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {canEdit && (
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                title="Anexar documento"
                                aria-label="Anexar documento à manutenção"
                                className="text-ink-3 hover:text-volt"
                                onClick={() => setUploadFor({ maintenanceId: m.id, label: m.plate + " · " + (MAINT_KINDS.find((k) => k.key === m.kind)?.label ?? "Manutenção") })}
                              >
                                <Upload size={14} />
                              </button>
                              <button type="button" title="Editar" aria-label="Editar manutenção" className="text-ink-3 hover:text-ink" onClick={() => setEditMaint(m)}>
                                <Pencil size={14} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : area === "cartoes" ? (
          !cardRows.length ? (
            <Empty
              title={clist.length ? "Nenhum cartão neste filtro" : "Ainda sem cartões frota"}
              text={clist.length ? "Muda o estado ou a procura." : "Cria o primeiro cartão e liga-o a uma viatura e a um titular."}
              action={canEdit ? <button className="btn btn-primary" onClick={() => setEditCard("new")}><CreditCard size={15} /> Novo cartão</button> : undefined}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-line text-left text-ink-3">
                    <th className="label-mono px-4 py-3 font-normal">Cartão</th>
                    <th className="label-mono px-4 py-3 font-normal">Viatura</th>
                    <th className="label-mono px-4 py-3 font-normal">Titular</th>
                    <th className="label-mono px-4 py-3 font-normal">Limite/mês</th>
                    <th className="label-mono px-4 py-3 font-normal">Atribuição</th>
                    <th className="label-mono px-4 py-3 font-normal">Docs</th>
                    <th className="label-mono px-4 py-3 font-normal">Estado</th>
                    <th className="px-4 py-3"><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {cardRows.map((c) => (
                    <tr key={c.id} className="border-b border-line last:border-b-0 hover:bg-surface-2/60">
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{c.provider}</div>
                        <div className="num text-[11.5px] text-ink-3">{c.number}</div>
                      </td>
                      <td className="px-4 py-2.5 text-ink-2">{c.plate ?? "—"}</td>
                      <td className="px-4 py-2.5 text-ink-2">{c.holderName ?? "—"}</td>
                      <td className="num px-4 py-2.5 text-ink-2">{c.monthlyLimit ? c.monthlyLimit.toFixed(2) + " €" : "—"}</td>
                      <td className="num px-4 py-2.5 text-ink-3">{c.startDate ?? "—"}{c.endDate ? " → " + c.endDate : ""}</td>
                      <td className="px-4 py-2.5">
                        <button type="button" className="inline-flex items-center gap-1 text-ink-2 hover:text-volt" onClick={() => setDocsFor({ kind: "card", id: c.id, label: c.provider + " " + c.number })}>
                          <Paperclip size={13} /> {c.documents.length}
                        </button>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${c.status === "ativo" ? "border-volt/40 bg-volt/10 text-volt" : "border-line bg-surface-2 text-ink-3"}`}>{c.status === "ativo" ? "ativo" : "inativo"}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {canEdit && (
                          <div className="flex items-center justify-end gap-2">
                            <button type="button" title="Anexar documento" aria-label="Anexar documento ao cartão" className="text-ink-3 hover:text-volt" onClick={() => setUploadFor({ cardId: c.id, label: c.provider + " " + c.number })}>
                              <Upload size={14} />
                            </button>
                            <button type="button" title="Editar" aria-label="Editar cartão" className="text-ink-3 hover:text-ink" onClick={() => setEditCard(c)}>
                              <Pencil size={14} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : !docRows.length ? (
          <Empty title="Sem documentos" text="Anexa documentos a uma viatura ou a um cartão frota: livrete, seguro, inspeção, contrato ou fatura." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-left text-ink-3">
                  <th className="label-mono px-4 py-3 font-normal">Documento</th>
                  <th className="label-mono px-4 py-3 font-normal">Pertence a</th>
                  <th className="label-mono px-4 py-3 font-normal">Tipo</th>
                  <th className="label-mono px-4 py-3 font-normal">Tamanho</th>
                  <th className="label-mono px-4 py-3 font-normal">Validade</th>
                  <th className="px-4 py-3"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {docRows.map((d) => (
                  <tr key={d.id + "-" + d.owner} className="border-b border-line last:border-b-0 hover:bg-surface-2/60">
                    <td className="px-4 py-2.5">
                      <a href={d.path} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium hover:text-volt">
                        <FileText size={13} className="text-ink-3" /> {d.name}
                      </a>
                    </td>
                    <td className="px-4 py-2.5 text-ink-2">{d.owner}</td>
                    <td className="px-4 py-2.5 text-ink-2">{DOC_KINDS.find((k) => k.key === d.kind)?.label ?? "Outro"}</td>
                    <td className="num px-4 py-2.5 text-ink-3">{fmtSize(d.size)}</td>
                    <td className="num px-4 py-2.5 text-ink-3">{d.expiresOn ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right">
                      {canEdit && (
                        <button type="button" className="text-ink-3 hover:text-danger" aria-label="Apagar documento" onClick={() => removeDoc.mutate({ id: d.id })}>
                          <Trash2 size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={editVehicle !== null} onClose={() => setEditVehicle(null)} title={editVehicle === "new" ? "Nova viatura" : "Editar viatura"} wide>
        {editVehicle !== null && <VehicleForm initial={editVehicle === "new" ? null : editVehicle} onClose={() => setEditVehicle(null)} />}
      </Modal>

      <Modal open={editCard !== null} onClose={() => setEditCard(null)} title={editCard === "new" ? "Novo cartão frota" : "Editar cartão frota"} wide>
        {editCard !== null && <CardForm initial={editCard === "new" ? null : editCard} onClose={() => setEditCard(null)} />}
      </Modal>

      <Modal open={readingFor !== null} onClose={() => setReadingFor(null)} title={"Quilómetros — " + (readingFor?.label ?? "")} wide>
        {readingFor && (
          <div className="space-y-5">
            <ReadingForm vehicleId={readingFor.id} onDone={() => setReadingFor(null)} />
            <div>
              <div className="label-mono mb-2">Histórico de leituras</div>
              <ReadingHistory vehicleId={readingFor.id} canEdit={canEdit} />
            </div>
          </div>
        )}
      </Modal>

      <Modal open={editMaint !== null} onClose={() => setEditMaint(null)} title={editMaint === "new" ? "Nova manutenção" : "Editar manutenção"} wide>
        {editMaint !== null && <MaintenanceForm initial={editMaint === "new" ? null : editMaint} onDone={() => setEditMaint(null)} />}
      </Modal>

      <Modal open={docsFor !== null} onClose={() => setDocsFor(null)} title={"Documentos — " + (docsFor?.label ?? "")} wide>
        {docsFor && (
          <div className="space-y-4">
            <DocList
              canEdit={canEdit}
              docs={(docsFor.kind === "vehicle"
                ? vlist.find((v) => v.id === docsFor.id)?.documents
                : docsFor.kind === "card"
                  ? clist.find((c) => c.id === docsFor.id)?.documents
                  : docsAll.filter((d) => d.maintenanceId === docsFor.id)) as unknown as Doc[] ?? []}
              onRemove={(id) => removeDoc.mutate({ id })}
            />
            {canEdit && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  if (docsFor.kind === "vehicle") setUploadFor({ vehicleId: docsFor.id, label: docsFor.label });
                  else if (docsFor.kind === "card") setUploadFor({ cardId: docsFor.id, label: docsFor.label });
                  else setUploadFor({ maintenanceId: docsFor.id, label: docsFor.label });
                  setDocsFor(null);
                }}
              >
                <Upload size={14} /> Anexar documento
              </button>
            )}
          </div>
        )}
      </Modal>

      <Modal open={uploadFor !== null} onClose={() => setUploadFor(null)} title={"Anexar documento — " + (uploadFor?.label ?? "")}>
        {uploadFor && <UploadForm vehicleId={uploadFor.vehicleId} cardId={uploadFor.cardId} maintenanceId={uploadFor.maintenanceId} onDone={() => setUploadFor(null)} />}
      </Modal>
    </>
  );
}
