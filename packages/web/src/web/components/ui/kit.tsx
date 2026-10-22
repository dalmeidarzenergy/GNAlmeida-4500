import { useEffect, useState, type ReactNode } from "react";
import { X, Search, Loader2 } from "lucide-react";
import { initials } from "../../lib/format";

export function PageHeader({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="rise mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="label-mono mb-2 flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-volt shadow-[0_0_10px_var(--volt)]" />
          {eyebrow}
        </div>
        <h1 className="text-[30px] font-semibold leading-none">{title}</h1>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-[3px] text-[11.5px] font-medium"
      style={{ color, borderColor: `color-mix(in srgb, ${color} 30%, transparent)`, background: `color-mix(in srgb, ${color} 9%, transparent)` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

export function Avatar({ name, color, size = 32, src }: { name: string; color?: string; size?: number; src?: string | null }) {
  const c = color ?? "var(--volt)";
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      <img
        src={src}
        alt={name}
        loading="lazy"
        onError={() => setFailed(true)}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size, border: `1px solid color-mix(in srgb, ${c} 40%, transparent)` }}
      />
    );
  }
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-display text-[11px] font-semibold"
      style={{ width: size, height: size, color: c, background: `color-mix(in srgb, ${c} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 28%, transparent)` }}
    >
      {initials(name)}
    </span>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[8vh] animate-in fade-in duration-150">
      <button type="button" aria-label="Fechar" tabIndex={-1} className="fixed inset-0 cursor-default backdrop-blur-sm" style={{ background: "var(--overlay-bg)" }} onClick={onClose} />
      <section aria-label={title} className={`card relative w-full ${wide ? "max-w-3xl" : "max-w-lg"} border-line bg-surface p-0 shadow-2xl animate-in zoom-in-95 duration-150`}>
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h3 className="text-[17px] font-semibold">{title}</h3>
          <button className="btn-icon" onClick={onClose} aria-label="Fechar">
            <X size={16} />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </section>
    </div>
  );
}

export function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-[12px] font-medium text-ink-2">{label}</span>
      {children}
    </label>
  );
}

export function SubmitRow({ pending, onCancel, label = "Guardar", error, extra }: { pending: boolean; onCancel: () => void; label?: string; error?: string | null; extra?: ReactNode }) {
  return (
    <div className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-5">
      <div className="min-w-0 flex-1 text-[12.5px] text-danger">{error}{extra}</div>
      <div className="flex gap-2">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primary min-w-[110px]" disabled={pending}>
          {pending ? <Loader2 size={15} className="animate-spin" /> : label}
        </button>
      </div>
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder = "Pesquisar…" }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative">
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
      <input aria-label={placeholder} className="input w-64 pl-9" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

export function Stat({ label, value, sub, accent, icon, delay = 0 }: { label: string; value: ReactNode; sub?: ReactNode; accent?: string; icon?: ReactNode; delay?: number }) {
  return (
    <div className="card rise relative overflow-hidden p-5" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-start justify-between">
        <div className="label-mono">{label}</div>
        {icon && <div style={{ color: accent ?? "var(--ink-3)" }}>{icon}</div>}
      </div>
      <div className="num mt-4 text-[28px] font-semibold leading-none tracking-tight" style={{ color: accent }}>
        {value}
      </div>
      {sub && <div className="mt-2.5 text-[12px] text-ink-2">{sub}</div>}
    </div>
  );
}

export function Empty({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 h-10 w-10 rounded-full border border-dashed border-ink-3" />
      <div className="font-display text-[15px] font-semibold">{title}</div>
      {text && <p className="mt-1 max-w-sm text-[13px] text-ink-2">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-3 p-5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: cols }).map((_, j) => (
            <div key={j} className="skeleton h-5 flex-1" style={{ opacity: 1 - i * 0.12 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { key: T; label: string; count?: number }[] }) {
  return (
    <div className="inline-flex rounded-[11px] border border-line bg-surface p-1">
      {items.map((it) => (
        <button
          key={it.key}
          onClick={() => onChange(it.key)}
          className={`flex h-8 items-center gap-2 rounded-lg px-3 text-[12.5px] font-medium transition ${value === it.key ? "bg-surface-2 text-ink shadow-[inset_0_0_0_1px_var(--line)]" : "text-ink-2 hover:text-ink"}`}
        >
          {it.label}
          {it.count !== undefined && <span className={`num text-[11px] ${value === it.key ? "text-volt" : "text-ink-3"}`}>{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function ConfirmDelete({ onConfirm, pending, label = "Eliminar" }: { onConfirm: () => void; pending?: boolean; label?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button type="button" className="btn btn-danger h-9" disabled={pending} onClick={() => (armed ? onConfirm() : setArmed(true))}>
      {pending ? <Loader2 size={14} className="animate-spin" /> : armed ? "Confirmar?" : label}
    </button>
  );
}

export function Progress({ value, color = "var(--volt)" }: { value: number; color?: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${v * 100}%`, background: color, boxShadow: v >= 1 ? `0 0 12px ${color}` : undefined }} />
    </div>
  );
}

export function Pagination({ page, total, pageSize, onChange }: { page: number; total: number; pageSize: number; onChange: (p: number) => void }) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  if (last <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const pages: (number | "...")[] = [];
  if (last <= 7) { for (let i = 1; i <= last; i++) pages.push(i); }
  else if (page <= 4) { pages.push(1, 2, 3, 4, 5, "...", last); }
  else if (page >= last - 3) { pages.push(1, "...", last - 4, last - 3, last - 2, last - 1, last); }
  else { pages.push(1, "...", page - 1, page, page + 1, "...", last); }
  return (
    <div className="flex items-center justify-between border-t border-line px-4 py-3">
      <span className="text-[12.5px] text-ink-3">{from}–{to} de {total}</span>
      <div className="flex items-center gap-1">
        <button className="btn-icon" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Anterior"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg></button>
        {pages.map((p, i) => p === "..." ? <span key={i} className="w-7 text-center text-[12px] text-ink-3">…</span> : <button key={i} className={`btn-icon h-7 w-7 text-[12px] font-medium ${p === page ? "bg-volt/15 text-volt" : "text-ink-3 hover:text-ink"}`} onClick={() => onChange(p)}>{p}</button>)}
        <button className="btn-icon" disabled={page >= last} onClick={() => onChange(page + 1)} aria-label="Seguinte"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></button>
      </div>
    </div>
  );
}