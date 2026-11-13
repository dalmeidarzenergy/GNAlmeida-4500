/**
 * Página "Frota": os veículos da empresa.
 *
 * Ainda não há tabela de viaturas na base de dados — esta é a base da secção.
 * Fica com os filtros de estado e de mês já montados (iguais aos da Gestão de
 * Empresa) e a lista pronta a encher quando a tabela existir.
 */
import { useMemo, useState } from "react";
import { CarFront, AlertTriangle, Fuel, Gauge, Search } from "lucide-react";
import { PageHeader, Stat, Empty, Tabs } from "../components/ui/kit";

/** Estados possíveis de uma viatura. */
type VehState = "ativo" | "manutencao" | "inativo";

type Vehicle = {
  id: number;
  plate: string;
  model: string;
  driver: string | null;
  km: number;
  fuel: string;
  since: string;
  status: VehState;
};

function pad(v: number) {
  return v < 10 ? "0" + v : "" + v;
}

function todayLisbon() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" });
}

/** "2026-11" -> "Novembro 2026" */
function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  const names = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  return names[Number(m) - 1] + " " + y;
}

function parseYM(ym: string) {
  const [yy, mm] = ym.split("-");
  return { y: Number(yy), m: Number(mm) };
}

/** Janela rolante de meses, do mais recente para o mais antigo. */
function monthOptions(count: number) {
  const { y, m } = parseYM(todayLisbon().slice(0, 7));
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(y, m - 1 - i, 1);
    out.push(d.getFullYear() + "-" + pad(d.getMonth() + 1));
  }
  return out;
}

export default function FrotaPage() {
  const months = useMemo(() => monthOptions(24), []);
  const [month, setMonth] = useState(() => todayLisbon().slice(0, 7));
  const [state, setState] = useState<VehState | "todos">("ativo");
  const [q, setQ] = useState("");

  /** Sem tabela de viaturas na BD, a lista começa vazia. */
  const vehicles: Vehicle[] = [];

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return vehicles.filter(
      (v) =>
        (state === "todos" || v.status === state) &&
        (!s || v.plate.toLowerCase().includes(s) || v.model.toLowerCase().includes(s) || (v.driver ?? "").toLowerCase().includes(s)),
    );
  }, [vehicles, state, q]);

  const count = (f: VehState | "todos") => vehicles.filter((v) => f === "todos" || v.status === f).length;

  const stateChip = (s: VehState) => {
    const map: Record<VehState, { label: string; cls: string }> = {
      ativo: { label: "ativo", cls: "border-volt/40 bg-volt/10 text-volt" },
      manutencao: { label: "em manutenção", cls: "border-amber/40 bg-amber/10 text-amber" },
      inativo: { label: "inativo", cls: "border-line bg-surface-2 text-ink-3" },
    };
    const m = map[s];
    return <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${m.cls}`}>{m.label}</span>;
  };

  return (
    <>
      <PageHeader
        eyebrow="GESTÃO DE EMPRESA"
        title="Frota"
        subtitle="As viaturas da empresa: quem conduz, quantos quilómetros e em que estado. Filtra por estado e por mês de referência."
      />

      <div className="card rise mb-5 flex flex-wrap items-end gap-3 p-4">
        <label className="flex flex-col gap-1">
          <span className="label-mono">Mês de referência</span>
          <select className="input w-52" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Mês de referência">
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
                {m === todayLisbon().slice(0, 7) ? " (atual)" : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="label-mono">Estado</span>
          <select className="input w-48" value={state} onChange={(e) => setState(e.target.value as VehState | "todos")} aria-label="Estado">
            <option value="ativo">Ativas</option>
            <option value="manutencao">Em manutenção</option>
            <option value="inativo">Inativas</option>
            <option value="todos">Todas</option>
          </select>
        </label>

        <label className="flex min-w-[180px] flex-1 flex-col gap-1">
          <span className="label-mono">Procurar</span>
          <span className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input className="input pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Matrícula, modelo ou condutor…" />
          </span>
        </label>

        <div className="pb-0.5">
          <Tabs value={state} onChange={(v) => setState(v)} items={[{ key: "todos" as const, label: "Todas", count: count("todos") }]} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Viaturas" value={count("todos")} sub={monthLabel(month)} icon={<CarFront size={15} />} delay={0} />
        <Stat label="Ativas" value={count("ativo")} sub="em circulação" icon={<Gauge size={15} />} accent="var(--sky)" delay={40} />
        <Stat label="Em manutenção" value={count("manutencao")} sub="paradas na oficina" icon={<AlertTriangle size={15} />} accent="var(--amber)" delay={80} />
        <Stat label="Inativas" value={count("inativo")} sub="fora de serviço" icon={<Fuel size={15} />} accent="var(--rose)" delay={120} />
      </div>

      <div className="card rise mt-6 overflow-hidden">
        {!list.length ? (
          <Empty
            title="Ainda sem viaturas registadas"
            text="A secção da frota está pronta a receber: matrícula, modelo, condutor, quilómetros e estado (ativa, em manutenção ou inativa). Diz o que queres guardar de cada viatura e eu acrescento a tabela."
          />
        ) : (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-left text-ink-3">
                <th className="label-mono px-4 py-3 font-normal">Viatura</th>
                <th className="label-mono px-4 py-3 font-normal">Condutor</th>
                <th className="label-mono px-4 py-3 font-normal">Quilómetros</th>
                <th className="label-mono px-4 py-3 font-normal">Combustível</th>
                <th className="label-mono px-4 py-3 font-normal">Desde</th>
                <th className="label-mono px-4 py-3 font-normal">Estado</th>
              </tr>
            </thead>
            <tbody>
              {list.map((v) => (
                <tr key={v.id} className="border-b border-line last:border-b-0 hover:bg-surface-2/60">
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{v.plate}</div>
                    <div className="text-[11.5px] text-ink-3">{v.model}</div>
                  </td>
                  <td className="px-4 py-2.5 text-ink-2">{v.driver ?? "Sem condutor"}</td>
                  <td className="num px-4 py-2.5 text-ink-2">{v.km.toLocaleString("pt-PT")}</td>
                  <td className="px-4 py-2.5 text-ink-2">{v.fuel}</td>
                  <td className="num px-4 py-2.5 text-ink-2">{v.since}</td>
                  <td className="px-4 py-2.5">{stateChip(v.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
