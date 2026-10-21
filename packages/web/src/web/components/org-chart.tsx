import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Crown } from "lucide-react";
import { Avatar, Empty } from "./ui/kit";

type Node = {
  id: number;
  name: string;
  managerId: number | null;
  positionTitle: string | null;
  departmentName: string | null;
  departmentColor: string | null;
  status: string;
  photoUrl?: string | null;
};

function Card<T extends Node>({ e, isTop, count, open, onToggle, onSelect }: { e: T; isTop: boolean; count: number; open: boolean; onToggle: () => void; onSelect: (e: T) => void }) {
  const color = e.departmentColor ?? "var(--ink-3)";
  return (
    <div className={`relative inline-flex flex-col items-center ${e.status === "inativo" ? "opacity-50" : ""}`}>
      <button
        type="button"
        onClick={() => onSelect(e)}
        className={`w-52 rounded-[12px] border bg-surface px-3 py-2.5 text-left transition hover:border-ink-3 ${isTop ? "border-volt/50" : "border-line"}`}
        style={{ borderTopColor: color, borderTopWidth: 2 }}
      >
        <div className="flex items-center gap-2.5">
          <Avatar name={e.name} size={30} color={e.departmentColor ?? undefined} src={e.photoUrl} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 truncate text-[12.5px] font-medium">
              {isTop && <Crown size={11} className="shrink-0 text-volt" />}
              <span className="truncate">{e.name}</span>
            </div>
            <div className="truncate text-[11px] text-ink-3">{e.positionTitle ?? "Sem cargo"}</div>
          </div>
        </div>
        <div className="mt-1.5 truncate text-[10.5px]" style={{ color }}>{e.departmentName ?? "Sem departamento"}</div>
      </button>
      {count > 0 && (
        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? "Recolher subordinados" : "Expandir subordinados"}
          className="num absolute -bottom-2.5 z-10 flex h-5 items-center gap-0.5 rounded-full border border-line bg-bg px-1.5 text-[10px] text-ink-2 hover:text-ink"
        >
          {count}
          {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        </button>
      )}
    </div>
  );
}

export function OrgChart<T extends Node>({ employees, loading, onSelect }: { employees: T[]; loading?: boolean; onSelect: (e: T) => void }) {
  const [closed, setClosed] = useState<Set<number>>(new Set());
  const children = useMemo(() => {
    const m = new Map<number, T[]>();
    for (const e of employees) {
      if (e.managerId == null) continue;
      const arr = m.get(e.managerId) ?? [];
      arr.push(e);
      m.set(e.managerId, arr);
    }
    return m;
  }, [employees]);
  const roots = employees.filter((e) => e.managerId == null);
  const top = roots[0];
  const orphans = roots.slice(1);

  const toggle = (id: number) =>
    setClosed((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const render = (e: T, depth: number, seen: Set<number>): React.ReactNode => {
    if (seen.has(e.id)) return null;
    const next = new Set(seen).add(e.id);
    const kids = children.get(e.id) ?? [];
    const open = !closed.has(e.id);
    return (
      <li key={e.id}>
        <Card e={e} isTop={depth === 0} count={kids.length} open={open} onToggle={() => toggle(e.id)} onSelect={onSelect} />
        {open && kids.length > 0 && <ul>{kids.map((k) => render(k, depth + 1, next))}</ul>}
      </li>
    );
  };

  if (loading) return <div className="skeleton h-80 rounded-[14px]" />;
  if (!employees.length) return <div className="card"><Empty title="Sem funcionários" text="Adicione funcionários para construir o organigrama." /></div>;

  return (
    <div className="rise space-y-4">
      <div className="card overflow-x-auto p-6">
        <ul className="org-tree mx-auto w-max">{top && render(top, 0, new Set())}</ul>
      </div>
      {orphans.length > 0 && (
        <div className="card p-5">
          <div className="label-mono mb-3 text-amber">Sem responsável — fora da hierarquia</div>
          <div className="flex flex-wrap items-start gap-6 overflow-x-auto">
            {orphans.map((o) => <ul key={o.id} className="org-tree w-max">{render(o, 1, new Set())}</ul>)}
          </div>
        </div>
      )}
    </div>
  );
}
