/**
 * Página "Frota": viaturas, cartões frota e documentos anexados.
 *
 * Três separadores — Viaturas, Cartões frota e Documentos. Cada viatura e cada
 * cartão tem os seus documentos (livrete, seguro, inspeção, contrato, fatura…),
 * carregados para `public/uploads/fleet` e servidos em `/uploads/fleet/…`.
 *
 * Filtros por estado (ativo / manutenção / inativo) e por mês de referência:
 * o mês olha para a data de entrada da viatura (createdAt), para se ver o que já
 * existia na frota nesse mês.
 */
import { useMemo, useState } from "react";
import {
  CarFront, Plus, Search, Pencil, FileText, Upload, Trash2, Fuel, Gauge, AlertTriangle, Paperclip, CreditCard,
} from "lucide-react";
import { PageHeader, Stat, Empty, Tabs, Modal, Field, SubmitRow, ConfirmDelete } from "../components/ui/kit";
import { errMsg } from "../lib/format";
import { useMe } from "../queries/me";
import {
  useVehicles, useFleetCards, useFleetDrivers,
  useSaveVehicle, useRemoveVehicle, useSaveCard, useRemoveCard,
  useUploadFleetDoc, useRemoveFleetDoc,
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

type Vehicle = NonNullable<ReturnType<typeof useVehicles>["data"]>[number];
type Card = NonNullable<ReturnType<typeof useFleetCards>["data"]>[number];
type Doc = { id: number; kind: string; name: string; path: string; size: number; expiresOn: string | null; vehicleId: number | null; cardId: number | null };

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

function UploadForm({
  vehicleId, cardId, onDone,
}: {
  vehicleId?: number; cardId?: number; onDone: () => void;
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
  const [area, setArea] = useState<"viaturas" | "cartoes" | "documentos">("viaturas");
  const [state, setState] = useState<"ativo" | "manutencao" | "inativo" | "todos">("ativo");
  const [q, setQ] = useState("");

  const [editVehicle, setEditVehicle] = useState<Vehicle | null | "new">(null);
  const [editCard, setEditCard] = useState<Card | null | "new">(null);
  const [docsFor, setDocsFor] = useState<{ kind: "vehicle" | "card"; id: number; label: string } | null>(null);
  const [uploadFor, setUploadFor] = useState<{ vehicleId?: number; cardId?: number; label: string } | null>(null);

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

  const allDocs = useMemo<(Doc & { owner: string })[]>(() => {
    const out: (Doc & { owner: string })[] = [];
    for (const v of vlist) for (const d of v.documents) out.push({ ...(d as Doc), owner: v.plate });
    for (const c of clist) for (const d of c.documents) out.push({ ...(d as Doc), owner: c.provider + " " + c.number });
    return out.sort((a, b) => b.id - a.id);
  }, [vlist, clist]);

  const docRows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return allDocs.filter((d) => !s || d.name.toLowerCase().includes(s) || d.owner.toLowerCase().includes(s));
  }, [allDocs, q]);

  return (
    <>
      <PageHeader
        eyebrow="GESTÃO DE EMPRESA"
        title="Frota"
        subtitle="Viaturas, cartões frota e os documentos de cada um. Filtra por estado e por mês de referência."
      >
        {canEdit && (
          <div className="flex gap-2">
            <button className="btn btn-ghost" onClick={() => setEditCard("new")}>
              <CreditCard size={15} /> Novo cartão
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

        {area !== "documentos" && (
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
        )}

        <label className="flex min-w-[180px] flex-1 flex-col gap-1">
          <span className="label-mono">Procurar</span>
          <span className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input className="input pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder={area === "viaturas" ? "Matrícula, modelo ou condutor…" : area === "cartoes" ? "Fornecedor, número ou titular…" : "Documento ou dono…"} />
          </span>
        </label>

        <div className="pb-0.5">
          <Tabs
            value={area}
            onChange={setArea}
            items={[
              { key: "viaturas" as const, label: "Viaturas", count: countVehicle(state) },
              { key: "cartoes" as const, label: "Cartões frota", count: cardRows.length },
              { key: "documentos" as const, label: "Documentos", count: docRows.length },
            ]}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Viaturas" value={countVehicle("todos")} sub={monthLabel(month)} icon={<CarFront size={15} />} delay={0} />
        <Stat label="Ativas" value={countVehicle("ativo")} sub="em circulação" icon={<Gauge size={15} />} accent="var(--sky)" delay={40} />
        <Stat label="Em manutenção" value={countVehicle("manutencao")} sub="paradas na oficina" icon={<AlertTriangle size={15} />} accent="var(--amber)" delay={80} />
        <Stat label="Cartões frota" value={clist.length} sub={clist.filter((c) => c.status === "ativo").length + " ativos"} icon={<Fuel size={15} />} accent="var(--rose)" delay={120} />
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

      <Modal open={docsFor !== null} onClose={() => setDocsFor(null)} title={"Documentos — " + (docsFor?.label ?? "")} wide>
        {docsFor && (
          <div className="space-y-4">
            <DocList
              canEdit={canEdit}
              docs={(docsFor.kind === "vehicle"
                ? vlist.find((v) => v.id === docsFor.id)?.documents
                : clist.find((c) => c.id === docsFor.id)?.documents) as Doc[] ?? []}
              onRemove={(id) => removeDoc.mutate({ id })}
            />
            {canEdit && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => { setUploadFor(docsFor.kind === "vehicle" ? { vehicleId: docsFor.id, label: docsFor.label } : { cardId: docsFor.id, label: docsFor.label }); setDocsFor(null); }}
              >
                <Upload size={14} /> Anexar documento
              </button>
            )}
          </div>
        )}
      </Modal>

      <Modal open={uploadFor !== null} onClose={() => setUploadFor(null)} title={"Anexar documento — " + (uploadFor?.label ?? "")}>
        {uploadFor && <UploadForm vehicleId={uploadFor.vehicleId} cardId={uploadFor.cardId} onDone={() => setUploadFor(null)} />}
      </Modal>
    </>
  );
}
