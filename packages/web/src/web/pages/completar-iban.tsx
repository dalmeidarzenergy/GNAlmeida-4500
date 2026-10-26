/**
 * Completar IBAN — encontra os dígitos em falta de um IBAN.
 *
 * O padrão escreve-se com "?" no lugar de cada dígito em falta. A app testa
 * todas as combinações de 0 a 9 e mostra só as que passam a validação oficial
 * (ISO 13616, mod 97). Tudo corre no browser: nada é enviado para o servidor.
 */
import { useMemo, useState } from "react";
import { Copy, Check, AlertTriangle, Loader2, Sparkles, Wand2 } from "lucide-react";
import { PageHeader } from "../components/ui/kit";
import { completeIban, checkPattern, group4, normalize } from "../lib/iban";

const EXAMPLE = "PT50 0035 ???? 0000 1234 5678 9";

/** Linha de resultado: IBAN monoespaçado + botão de copiar. */
function IbanRow({ iban }: { iban: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(iban.replace(/\s+/g, ""));
    } catch {
      // fallback para contextos sem clipboard API
      const ta = document.createElement("textarea");
      ta.value = iban.replace(/\s+/g, "");
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div className="flex items-center justify-between gap-3 rounded-[10px] border border-line bg-surface px-3 py-2">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[12.5px] tracking-tight">{iban}</code>
      <button
        type="button"
        onClick={copy}
        className="btn-icon shrink-0"
        title={copied ? "Copiado" : "Copiar"}
        aria-label={copied ? "Copiado" : "Copiar " + iban}
      >
        {copied ? <Check size={14} className="text-volt" /> : <Copy size={14} />}
      </button>
    </div>
  );
}

export default function CompletarIbanPage() {
  const [pattern, setPattern] = useState("");
  const [result, setResult] = useState<{ tested: number; valid: string[]; pattern: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const check = useMemo(() => checkPattern(pattern), [pattern]);
  const canRun = !check.error && check.holes > 0;

  const run = () => {
    if (!canRun) return;
    setBusy(true);
    // pequeno adiamento para o botão conseguir mostrar o estado "a gerar"
    setTimeout(() => {
      const r = completeIban(pattern);
      setResult({ ...r, pattern: normalize(pattern) });
      setBusy(false);
    }, 20);
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        eyebrow="Ferramentas"
        title="Completar IBAN"
        subtitle="Escreve o IBAN com “?” nos dígitos que faltam. A app testa todas as combinações e mostra só as que são válidas (ISO 13616)."
      />

      <div className="card rise p-5">
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-ink-2">IBAN com os dígitos em falta</span>
          <input
            className="input num font-mono uppercase tracking-tight"
            placeholder={EXAMPLE}
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            aria-label="IBAN com os dígitos em falta"
          />
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[11.5px] text-ink-3">
          <span>Exemplo: <button type="button" className="font-mono text-volt underline decoration-dotted" onClick={() => setPattern(EXAMPLE)}>{EXAMPLE}</button></span>
          {check.holes > 0 && !check.error && (
            <span className="num">· {check.holes} {check.holes === 1 ? "dígito" : "dígitos"} em falta → {new Intl.NumberFormat("pt-PT").format(10 ** check.holes)} combinações</span>
          )}
        </div>

        {check.error && (
          <div className="mt-3 flex items-start gap-2 rounded-[10px] border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
            <AlertTriangle size={14} className="mt-[1px] shrink-0" />
            <span>{check.error}</span>
          </div>
        )}
        {!check.error && check.warning && (
          <div className="mt-3 flex items-start gap-2 rounded-[10px] border border-amber/40 bg-amber/10 px-3 py-2 text-[12px] text-amber">
            <AlertTriangle size={14} className="mt-[1px] shrink-0" />
            <span>{check.warning}</span>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button className="btn btn-primary" onClick={run} disabled={!canRun || busy}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            Gerar combinações
          </button>
          {(pattern || result) && (
            <button
              className="btn btn-ghost"
              onClick={() => { setPattern(""); setResult(null); }}
              disabled={busy}
            >
              Limpar
            </button>
          )}
        </div>
      </div>

      {result && (
        <div className="card rise mt-5 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-volt/5 px-5 py-3">
            <div className="flex items-center gap-2 text-[12.5px] text-ink-2">
              <Wand2 size={14} className="text-volt" />
              <span className="num font-semibold text-ink">{new Intl.NumberFormat("pt-PT").format(result.tested)}</span>
              <span>testadas</span>
              <span className="text-ink-3">→</span>
              <span className="num font-semibold text-volt">
                {new Intl.NumberFormat("pt-PT").format(result.valid.length)}
              </span>
              <span>{result.valid.length === 1 ? "válida" : "válidas"}</span>
            </div>
            <code className="font-mono text-[11.5px] text-ink-3">{group4(result.pattern)}</code>
          </div>

          {result.valid.length === 0 ? (
            <div className="px-5 py-8 text-center text-[12.5px] text-ink-3">
              Nenhuma combinação é um IBAN válido. Confirma os dígitos que já lá estão.
            </div>
          ) : (
            <div className="max-h-[52vh] space-y-1.5 overflow-y-auto p-3">
              {(result.valid.map((b) => <IbanRow key={b} iban={b} />))}
            </div>
          )}
        </div>
      )}

      <p className="mt-4 text-[11.5px] text-ink-3">
        A validação segue a norma ISO 13616: move os 4 primeiros caracteres para o fim, converte as letras em números (A=10 … Z=35) e verifica que o resto da divisão por 97 é 1. O cálculo é feito por blocos, tudo no teu browser — nenhum IBAN sai daqui.
      </p>
    </div>
  );
}
