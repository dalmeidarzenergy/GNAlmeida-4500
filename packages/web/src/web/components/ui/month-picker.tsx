import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronLeft, ChevronRight, X } from "lucide-react";

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const MESES_CURTO = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

const LARGURA_POP = 248;

/** "2026-10" -> "Outubro 2026". Devolve "" se a chave for invalida. */
export function monthLabelPt(key: string) {
  if (!key || !/^\d{4}-\d{2}$/.test(key)) return "";
  const [y, m] = key.split("-");
  const i = Number(m) - 1;
  if (i < 0 || i > 11) return "";
  return `${MESES[i]} ${y}`;
}

/** Chave do mes atual no formato "YYYY-MM". */
export function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function chave(ano: number, mes: number) {
  return `${ano}-${String(mes + 1).padStart(2, "0")}`;
}

type Props = {
  value: string;
  onChange: (v: string) => void;
  /** Permite limpar a selecao (mostra um botao de X). */
  clearable?: boolean;
  placeholder?: string;
  /** Nome acessivel, quando nao ha <label> a envolver. */
  "aria-label"?: string;
  className?: string;
};

/**
 * Seletor de mes em portugues.
 *
 * O <input type="month"> nativo mostra sempre os meses no idioma do browser
 * (em Chrome aparece "October 2026"), porque o atributo lang e ignorado nesse
 * widget. Este componente desenha a lista de meses em portugues e comporta-se
 * igual em qualquer browser. Visualmente segue o resto dos campos (.input).
 *
 * O painel e desenhado num portal para nao ficar cortado por contentores com
 * overflow-hidden (os cartoes da app usam-no). Assim fica sempre por cima.
 */
export function MonthPicker({ value, onChange, clearable = false, placeholder = "Escolher mês", "aria-label": ariaLabel, className = "" }: Props) {
  const [open, setOpen] = useState(false);
  const [vista, setVista] = useState<number>(() => Number((value || mesAtual()).slice(0, 4)));
  const [pos, setPos] = useState<{ top: number; left: number; largura: number; acima: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const painel = useRef<HTMLDivElement>(null);

  const calcularPos = useCallback(() => {
    const b = btn.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const alt = painel.current?.offsetHeight ?? 300;
    const espacoAbaixo = window.innerHeight - r.bottom;
    const acima = espacoAbaixo < alt + 12 && r.top > alt;
    // Alinha ao campo, mas sem sair do ecra pela direita.
    const left = Math.max(8, Math.min(r.left, window.innerWidth - LARGURA_POP - 8));
    setPos({ top: acima ? r.top - alt - 6 : r.bottom + 6, left, largura: LARGURA_POP, acima });
  }, []);

  // Reposiciona enquanto estiver aberto (scroll e resize).
  useLayoutEffect(() => {
    if (!open) return;
    calcularPos();
    const id = window.requestAnimationFrame(calcularPos);
    const h = () => calcularPos();
    window.addEventListener("scroll", h, true);
    window.addEventListener("resize", h);
    return () => {
      window.cancelAnimationFrame(id);
      window.removeEventListener("scroll", h, true);
      window.removeEventListener("resize", h);
    };
  }, [open, calcularPos]);

  // Fecha ao clicar fora (o painel esta no portal, por isso conta como dentro).
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btn.current?.contains(t) || painel.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  // Fecha com Escape.
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);

  // Ao abrir, mostra o ano do valor selecionado.
  useEffect(() => {
    if (open) setVista(Number((value || mesAtual()).slice(0, 4)));
  }, [open, value]);

  const texto = monthLabelPt(value);
  const atual = mesAtual();
  const anos = useMemo(() => {
    const a = new Date().getFullYear();
    // Uma decada para tras e um ano para a frente chega para os filtros da app.
    return Array.from({ length: 12 }, (_, i) => a + 1 - i);
  }, []);

  const escolher = (k: string) => {
    onChange(k);
    setOpen(false);
  };

  return (
    <div className={`relative ${className}`}>
      <button
        ref={btn}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="input flex w-full items-center justify-between gap-2 text-left"
      >
        <span className={`shrink-0 whitespace-nowrap ${texto ? "" : "text-ink-3"}`}>{texto || placeholder}</span>
        <span className="flex shrink-0 items-center gap-1">
          {clearable && value ? (
            <span
              role="button"
              tabIndex={0}
              aria-label="Limpar mês"
              className="flex h-5 w-5 items-center justify-center rounded text-ink-3 hover:bg-surface-2 hover:text-ink"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange("");
                }
              }}
            >
              <X size={13} />
            </span>
          ) : null}
          <Calendar size={14} className="text-ink-3" />
        </span>
      </button>

      {open && pos
        ? createPortal(
            <div
              ref={painel}
              role="dialog"
              aria-label="Escolher mês"
              style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.largura, zIndex: 80 }}
              className="rounded-[12px] border border-line bg-surface p-3 shadow-2xl"
            >
              <div className="mb-2 flex items-center justify-between">
                <button type="button" aria-label="Ano anterior" className="btn-icon h-7 w-7" onClick={() => setVista((a) => a - 1)}>
                  <ChevronLeft size={15} />
                </button>
                <span className="num text-[13px] font-semibold">{vista}</span>
                <button type="button" aria-label="Ano seguinte" className="btn-icon h-7 w-7" onClick={() => setVista((a) => a + 1)}>
                  <ChevronRight size={15} />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-1">
                {MESES_CURTO.map((m, i) => {
                  const k = chave(vista, i);
                  const sel = k === value;
                  const agora = k === atual;
                  return (
                    <button
                      key={m}
                      type="button"
                      aria-label={`${MESES[i]} ${vista}`}
                      aria-pressed={sel}
                      onClick={() => escolher(k)}
                      className={`h-8 rounded-lg text-[12.5px] transition ${
                        sel
                          ? "bg-volt font-semibold text-[#0c0e0d]"
                          : agora
                            ? "border border-volt/40 text-volt hover:bg-surface-2"
                            : "text-ink-2 hover:bg-surface-2 hover:text-ink"
                      }`}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>

              <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
                <button type="button" className="text-[12px] text-ink-3 transition hover:text-ink" onClick={() => escolher(atual)}>
                  Mês atual
                </button>
                {clearable && value ? (
                  <button type="button" className="text-[12px] text-ink-3 transition hover:text-ink" onClick={() => escolher("")}>
                    Limpar
                  </button>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
