import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtCompact, fmtEur, fmtMonth } from "../lib/format";

const axis = { stroke: "#636b64", fontSize: 11, fontFamily: "JetBrains Mono", tickLine: false, axisLine: false } as const;

function TipBox({ active, payload, label, money = true, labelFmt }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[10px] border border-line bg-[#0f1210]/95 px-3 py-2 shadow-xl backdrop-blur">
      <div className="label-mono mb-1">{labelFmt ? labelFmt(label) : label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="num flex items-center gap-2 text-[12.5px]">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.payload?.color }} />
          {money ? fmtEur(p.value) : p.value}
        </div>
      ))}
    </div>
  );
}

export function TrendChart({ data, dataKey = "total", height = 260, color = "#c6f432", money = true }: { data: any[]; dataKey?: string; height?: number; color?: string; money?: boolean }) {
  const id = `g-${dataKey}-${color.replace("#", "")}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 10, right: 6, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#1f2420" vertical={false} />
        <XAxis dataKey="month" {...axis} tickFormatter={(m) => fmtMonth(m)} />
        <YAxis {...axis} tickFormatter={(v) => (money ? fmtCompact(v) : v)} width={48} allowDecimals={false} />
        <Tooltip content={<TipBox money={money} labelFmt={(m: string) => fmtMonth(m, true)} />} cursor={{ stroke: "#3a403b" }} />
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2.2} fill={`url(#${id})`} dot={false} activeDot={{ r: 4, fill: color, stroke: "#0c0e0d", strokeWidth: 2 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function BarsChart({ data, dataKey, xKey, height = 260, color = "#c6f432", money = true }: { data: any[]; dataKey: string; xKey: string; height?: number; color?: string; money?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 10, right: 6, left: -8, bottom: 0 }}>
        <CartesianGrid stroke="#1f2420" vertical={false} />
        <XAxis dataKey={xKey} {...axis} tickFormatter={(m) => (/^\d{4}-\d{2}$/.test(m) ? fmtMonth(m) : String(m).split(" ")[0])} />
        <YAxis {...axis} tickFormatter={(v) => (money ? fmtCompact(v) : v)} width={48} allowDecimals={false} />
        <Tooltip content={<TipBox money={money} labelFmt={(m: string) => (/^\d{4}-\d{2}$/.test(m) ? fmtMonth(m, true) : m)} />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
        <Bar dataKey={dataKey} radius={[6, 6, 0, 0]} maxBarSize={38}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.color ?? color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Donut({ data, height = 220, money = false }: { data: { name: string; value: number; color: string }[]; height?: number; money?: boolean }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="68%" outerRadius="94%" paddingAngle={2} stroke="none">
            {data.map((d, i) => (
              <Cell key={i} fill={d.color} />
            ))}
          </Pie>
          <Tooltip content={<TipBox money={money} labelFmt={() => ""} />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <div className="num text-[26px] font-semibold">{money ? fmtCompact(total) : total}</div>
        <div className="label-mono">total</div>
      </div>
    </div>
  );
}

function EvolutionTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  return (
    <div className="rounded-[10px] border border-line bg-[#0f1210]/95 px-3 py-2 shadow-xl backdrop-blur">
      <div className="label-mono mb-1">{label}</div>
      {payload.map((x: any) => (
        <div key={x.dataKey} className="num flex items-center gap-2 text-[12.5px]">
          <span className="h-2 w-2 rounded-full" style={{ background: x.color }} />
          <span className="text-ink-2">{x.name}</span>
          <span className="ml-auto pl-3 font-semibold">{x.value}</span>
        </div>
      ))}
      {p?.rate != null && <div className="num mt-1 text-[11.5px] text-ink-3">Taxa: {Math.round(p.rate * 100)}%</div>}
    </div>
  );
}

/** Vendas inseridas (barras) e em fornecimento (linha) por período. */
export function EvolutionChart({ data, height = 320, cumulative = false }: { data: { label: string; inserted: number; supplied: number; cumInserted: number; cumSupplied: number; rate: number | null }[]; height?: number; cumulative?: boolean }) {
  const ins = cumulative ? "cumInserted" : "inserted";
  const sup = cumulative ? "cumSupplied" : "supplied";
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 10, right: 6, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id="g-evo-sup" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c6f432" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#c6f432" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#1f2420" vertical={false} />
        <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={14} />
        <YAxis {...axis} width={40} allowDecimals={false} />
        <Tooltip content={<EvolutionTip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
        {cumulative ? (
          <Area type="linear" name="Inseridas" dataKey={ins} stroke="#38bdf8" strokeWidth={2} fill="rgba(56,189,248,0.10)" dot={false} />
        ) : (
          <Bar name="Inseridas" dataKey={ins} fill="#38bdf8" fillOpacity={0.55} radius={[5, 5, 0, 0]} maxBarSize={34} />
        )}
        {cumulative ? (
          <Area type="linear" name="Em Fornecimento" dataKey={sup} stroke="#c6f432" strokeWidth={2.4} fill="url(#g-evo-sup)" dot={false} />
        ) : (
          <Line type="linear" name="Em Fornecimento" dataKey={sup} stroke="#c6f432" strokeWidth={2.4} dot={{ r: 3, fill: "#c6f432", stroke: "#0c0e0d", strokeWidth: 1.5 }} activeDot={{ r: 5 }} />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
