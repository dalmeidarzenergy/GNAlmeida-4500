import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Loader2, Trash2, X } from "lucide-react";
import { Modal } from "./ui/kit";
import { errMsg } from "../lib/format";

/** Seleção de linhas de uma tabela. Só ficam selecionadas as linhas visíveis com os filtros atuais. */
export function useSelection(visibleIds: number[]) {
  const [sel, setSel] = useState<Set<number>>(() => new Set());
  const visible = useMemo(() => new Set(visibleIds), [visibleIds]);
  const selected = useMemo(() => [...sel].filter((id) => visible.has(id)), [sel, visible]);
  const all = visibleIds.length > 0 && selected.length === visibleIds.length;
  return {
    selected,
    has: (id: number) => sel.has(id) && visible.has(id),
    all,
    some: selected.length > 0 && !all,
    toggle: (id: number) =>
      setSel((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      }),
    toggleAll: () => setSel(all ? new Set() : new Set(visibleIds)),
    clear: () => setSel(new Set()),
  };
}

/** Caixa "selecionar todos" no cabeçalho, com estado intermédio quando só alguns estão selecionados. */
export function SelectAllBox({ checked, indeterminate, onChange, label }: { checked: boolean; indeterminate: boolean; onChange: () => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return <input ref={ref} type="checkbox" aria-label={label} className="h-4 w-4 cursor-pointer accent-[var(--volt)]" checked={checked} onChange={onChange} />;
}

export function RowBox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <input type="checkbox" aria-label={label} className="h-4 w-4 cursor-pointer accent-[var(--volt)]" checked={checked} onChange={onChange} onClick={(e) => e.stopPropagation()} />;
}

/** Barra com o número de selecionados e o botão para eliminar. */
export function SelectionBar({ count, total, noun, onClear, onDelete }: { count: number; total: number; noun: [string, string]; onClear: () => void; onDelete: () => void }) {
  if (!count) return null;
  return (
    <div className="rise mb-3 flex flex-wrap items-center gap-3 rounded-[12px] border border-volt/30 bg-volt/5 px-4 py-2.5 text-[13px]">
      <strong>{count}</strong>
      <span className="text-ink-2">
        {count === 1 ? noun[0] : noun[1]} selecionado{count === 1 ? "" : "s"} de {total}
      </span>
      <button type="button" className="flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink" onClick={onClear}>
        <X size={12} /> Limpar seleção
      </button>
      <button type="button" className="btn btn-danger ml-auto h-9" onClick={onDelete}>
        <Trash2 size={14} /> Eliminar {count === total && count > 1 ? "todos" : `${count}`}
      </button>
    </div>
  );
}

/** Janela de confirmação antes de eliminar (não pode ser desfeito). */
export function ConfirmDeleteModal({ open, title, children, onClose, onConfirm }: { open: boolean; title: string; children: ReactNode; onClose: () => void; onConfirm: () => Promise<unknown> }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) setError(null);
  }, [open]);
  return (
    <Modal open={open} onClose={() => !pending && onClose()} title={title}>
      <div className="text-[13.5px] text-ink-2">{children}</div>
      <p className="mt-3 text-[12.5px] text-danger">Esta ação não pode ser desfeita.</p>
      {error && <p className="mt-2 text-[12.5px] text-danger">{error}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={pending}>Cancelar</button>
        <button
          type="button"
          className="btn btn-danger"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            setError(null);
            try {
              await onConfirm();
              onClose();
            } catch (e) {
              setError(errMsg(e));
            } finally {
              setPending(false);
            }
          }}
        >
          {pending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Eliminar
        </button>
      </div>
    </Modal>
  );
}
