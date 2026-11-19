/**
 * Simulador de potência a contratar (Apoio Comercial).
 *
 * O comercial escolhe os equipamentos da casa e as quantidades, indica os que
 * podem estar ligados em simultâneo e recebe a potência recomendada a contratar.
 * Nenhum campo pede watts: as potências típicas vivem em `lib/potencia.ts`.
 * Toda a lógica corre no browser e o PDF é gerado localmente (jsPDF).
 */
import { useMemo, useState } from "react";
import { Download, Plus, X, Zap, Loader2 } from "lucide-react";
import { PageHeader } from "../components/ui/kit";
import {
  EQUIPAMENTOS,
  ESCALOES,
  LIMIAR_TRIFASICO,
  MARGEM_DEFEITO,
  MARGEM_MAX,
  MARGEM_PASSO,
  POTENCIA_MAX,
  calcular,
  fmtEur,
  fmtKva,
  parsePreco,
  type ItemPotencia,
} from "../lib/potencia";
import { gerarPdfPotencia } from "../lib/potencia-pdf";

type Linha = ItemPotencia & { id: number };

let seq = 0;
const nova = (nome: string, qtd = 1): Linha => {
  const equipamento = EQUIPAMENTOS.find((e) => e.nome === nome) ?? { nome, watts: 0 };
  seq += 1;
  return { id: seq, nome: equipamento.nome, watts: equipamento.watts, qtd: Math.max(1, Math.round(qtd)), emUso: true };
};

/** Estado inicial: casa típica, com o forno na lista mas desligado. */
const INICIAIS = ["Frigorífico", "Iluminação LED", "TV e box", "Termoacumulador", "Máquina de lavar roupa"];
const inicial = (): Linha[] => [...INICIAIS.map((n) => nova(n)), { ...nova("Forno elétrico"), emUso: false }];

const VERDE = "#00A650";

export default function SimuladorPotenciaPage() {
  const [itens, setItens] = useState<Linha[]>(inicial);
  const [margem, setMargem] = useState(MARGEM_DEFEITO);
  const [preco, setPreco] = useState("");
  const [escolha, setEscolha] = useState(EQUIPAMENTOS[0]?.nome ?? "");
  const [qtdAdd, setQtdAdd] = useState(1);
  const [pdf, setPdf] = useState<"idle" | "a-gerar" | "erro">("idle");

  const res = useMemo(() => calcular(itens, margem), [itens, margem]);
  const precoDia = parsePreco(preco);
  const emUso = itens.filter((i) => i.emUso).length;

  const adicionar = (nome: string, qtd = 1) => setItens((l) => [...l, nova(nome, qtd)]);
  const remover = (id: number) => setItens((l) => l.filter((i) => i.id !== id));
  const alternar = (id: number) => setItens((l) => l.map((i) => (i.id === id ? { ...i, emUso: !i.emUso } : i)));
  const quantidade = (id: number, v: string) =>
    setItens((l) => l.map((i) => (i.id === id ? { ...i, qtd: Math.max(1, Math.min(99, Math.round(Number(v.replace(/\D/g, "")) || 1))) } : i)));

  const descarregar = async () => {
    setPdf("a-gerar");
    try {
      await gerarPdfPotencia({ itens, margem, resultado: res, precoDia });
      setPdf("idle");
    } catch {
      setPdf("erro");
    }
  };

  const avisos: string[] = [];
  if (res.semEscalao) avisos.push(`Acima de ${fmtKva(POTENCIA_MAX)} kVA é necessário contrato em média tensão ou avaliar o fornecimento com o operador.`);
  if (res.recomendada != null && res.recomendada >= LIMIAR_TRIFASICO) avisos.push(`A partir de ${fmtKva(LIMIAR_TRIFASICO)} kVA pode ser necessária ligação trifásica.`);
  if (res.excede) avisos.push("Atenção: o consumo simultâneo excede a potência.");

  const barra = res.utilizacao > 90 ? "var(--danger)" : VERDE;

  return (
    <div>
      <PageHeader
        eyebrow="Apoio Comercial"
        title="Simulador de potência"
        subtitle="Escolha os equipamentos da casa e o que pode estar ligado ao mesmo tempo. O resultado é a potência a contratar, já com margem de segurança."
      />

      <div className="grid items-start gap-4 md:grid-cols-[1.1fr_0.9fr]">
        {/* ------------------------------------------------------ Equipamentos */}
        <section className="card rise p-5">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 className="font-display text-[15px] font-semibold">Equipamentos</h2>
            <span className="text-[11.5px] text-ink-3">
              {itens.length} na lista · {emUso} em uso
            </span>
          </div>

          <div className="mb-4 flex flex-wrap gap-1.5">
            {EQUIPAMENTOS.map((e) => {
              const jaNaLista = itens.some((i) => i.nome === e.nome);
              return (
                <button
                  key={e.nome}
                  type="button"
                  onClick={() => adicionar(e.nome)}
                  title={jaNaLista ? "Já está na lista — acrescenta outra linha" : "Adicionar à lista"}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-[5px] text-[11.5px] transition hover:border-ink-3 ${
                    jaNaLista ? "border-line bg-surface-2 text-ink-2" : "border-line bg-bg text-ink"
                  }`}
                >
                  <Plus size={11} className="opacity-60" />
                  {e.nome}
                </button>
              );
            })}
          </div>

          <div className="mb-4 flex flex-wrap items-end gap-2 rounded-[12px] border border-line bg-bg p-2.5">
            <label className="min-w-0 flex-1">
              <span className="label-mono mb-1 block">Menu</span>
              <select className="input" value={escolha} onChange={(e) => setEscolha(e.target.value)} aria-label="Equipamento a adicionar">
                {EQUIPAMENTOS.map((e) => (
                  <option key={e.nome} value={e.nome}>
                    {e.nome}
                  </option>
                ))}
              </select>
            </label>
            <label className="w-[74px]">
              <span className="label-mono mb-1 block">Qtd.</span>
              <input
                className="input num text-center"
                type="number"
                min={1}
                max={99}
                value={qtdAdd}
                aria-label="Quantidade a adicionar"
                onChange={(e) => setQtdAdd(Math.max(1, Math.min(99, Math.round(Number(e.target.value) || 1))))}
              />
            </label>
            <button type="button" className="btn btn-ghost" onClick={() => adicionar(escolha, qtdAdd)}>
              <Plus size={15} /> Adicionar
            </button>
          </div>

          {itens.length === 0 ? (
            <p className="rounded-[12px] border border-dashed border-line py-8 text-center text-[12.5px] text-ink-3">
              Sem equipamentos. Use os botões acima para começar.
            </p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-[12px] border border-line">
              {itens.map((i) => (
                <li key={i.id} className={`flex items-center gap-3 px-3 py-2.5 transition ${i.emUso ? "" : "opacity-45"}`}>
                  <label className="flex shrink-0 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={i.emUso}
                      onChange={() => alternar(i.id)}
                      aria-label={`${i.nome} em uso`}
                      className="h-4 w-4 accent-[#00A650]"
                    />
                    <span className="label-mono">Em uso</span>
                  </label>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{i.nome}</span>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={i.qtd}
                    aria-label={`Quantidade de ${i.nome}`}
                    onChange={(e) => quantidade(i.id, e.target.value)}
                    className="input num h-8 w-14 shrink-0 px-1 text-center"
                  />
                  <button type="button" onClick={() => remover(i.id)} aria-label={`Remover ${i.nome}`} className="btn-icon shrink-0 hover:text-danger">
                    <X size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-3 text-[11.5px] text-ink-3">
            As potências típicas de cada equipamento já estão incluídas — não é preciso indicar watts.
          </p>
        </section>

        {/* ---------------------------------------------------------- Resultado */}
        <section className="card rise p-5 md:sticky md:top-4">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 className="font-display text-[15px] font-semibold">Resultado</h2>
            <span className="label-mono">{res.totalKva > 0 ? `${fmtKva(res.totalKva)} kVA em simultâneo` : "sem equipamentos"}</span>
          </div>

          <div className="rounded-[12px] border border-line bg-bg p-4">
            <div className="label-mono mb-1">Potência recomendada</div>
            <div className="flex items-end gap-2">
              <div className="font-display text-[38px] font-semibold leading-none" style={{ color: res.semEscalao ? "var(--danger)" : VERDE }}>
                {res.recomendada == null ? "> 20,7" : fmtKva(res.recomendada)}
              </div>
              <div className="pb-1 text-[13px] text-ink-2">kVA</div>
            </div>
            <div className="mt-2 text-[11.5px] text-ink-3">
              Necessidade estimada com margem: <span className="num text-ink-2">{fmtKva(Math.round(res.necessario * 100) / 100)} kVA</span>
            </div>

            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-[11px] text-ink-3">
                <span>Utilização do escalão</span>
                <span className="num">{Math.round(res.utilizacao)}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full transition-all" style={{ width: `${res.utilizacao}%`, background: barra }} />
              </div>
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="label-mono">Escalões (kVA)</span>
              {res.recomendada != null && <span className="text-[11px] text-ink-3">recomendado a âmbar</span>}
            </div>
            <div className="flex flex-wrap gap-1">
              {ESCALOES.map((e) => {
                const ativo = res.recomendada != null && Math.abs(e - res.recomendada) < 1e-9;
                const abaixo = res.recomendada != null && e < res.recomendada;
                return (
                  <span
                    key={e}
                    className={`num rounded-[7px] border px-2 py-[4px] text-[11px] transition ${
                      ativo ? "border-transparent font-semibold text-[#3d2a05]" : abaixo ? "border-line text-ink-3 opacity-45" : "border-line text-ink-2"
                    }`}
                    style={ativo ? { background: "var(--amber)" } : undefined}
                  >
                    {fmtKva(e)}
                  </span>
                );
              })}
            </div>
          </div>

          {avisos.length > 0 && (
            <div className="mt-4 space-y-2">
              {avisos.map((a) => (
                <p key={a} className="rounded-[10px] border border-amber/40 bg-amber/10 px-3 py-2 text-[11.5px] leading-snug text-amber">
                  {a}
                </p>
              ))}
            </div>
          )}

          <div className="mt-5">
            <div className="mb-1 flex items-center justify-between">
              <span className="label-mono">Margem de segurança</span>
              <span className="num text-[12.5px]">{margem}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={MARGEM_MAX}
              step={MARGEM_PASSO}
              value={margem}
              aria-label="Margem de segurança"
              onChange={(e) => setMargem(Number(e.target.value))}
              className="w-full accent-[#00A650]"
            />
            <div className="mt-0.5 flex justify-between text-[10.5px] text-ink-3">
              <span>0%</span>
              <span>30%</span>
            </div>
          </div>

          <div className="mt-4">
            <label className="label-mono mb-1 block">Preço da potência (€/dia)</label>
            <input
              className="input num"
              inputMode="decimal"
              placeholder="ex.: 0,35"
              value={preco}
              onChange={(e) => setPreco(e.target.value)}
              aria-label="Preço da potência em euros por dia"
            />
            {precoDia != null && res.recomendada != null && (
              <p className="mt-1.5 text-[11.5px] text-ink-2">
                Custo estimado da potência: <span className="num font-medium">{fmtEur(precoDia * 30)}</span>/mês (30 dias)
              </p>
            )}
          </div>

          <button type="button" className="btn btn-primary mt-5 w-full" onClick={descarregar} disabled={pdf === "a-gerar"}>
            {pdf === "a-gerar" ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            {pdf === "a-gerar" ? "A gerar PDF…" : "Descarregar PDF"}
          </button>
          {pdf === "erro" && <p className="mt-2 text-[11.5px] text-danger">Não foi possível gerar o PDF. Tente novamente.</p>}
        </section>
      </div>

      <p className="mt-4 flex items-start gap-1.5 text-[11.5px] text-ink-3">
        <Zap size={13} className="mt-[1px] shrink-0" />
        Valor estimativo e indicativo (1 kW considerado igual a 1 kVA). As condições finais devem ser confirmadas com o comercializador.
      </p>
    </div>
  );
}
