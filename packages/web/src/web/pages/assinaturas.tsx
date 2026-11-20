/**
 * Definições > Assinaturas: criador de assinaturas de email.
 *
 * Sub-abas:
 *   - Assinatura: dados e estilo, com pre-visualizacao ao lado.
 *   - Logos: biblioteca de logos (os da app + os carregados aqui).
 *   - Codigo: HTML pronto a colar noutro cliente de email.
 *
 * A assinatura e guardada por utilizador (modelo + dados) e copiada para a
 * area de transferencia ja formatada, para colar no Outlook/Gmail.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Download, ImagePlus, Loader2, Palette, Plus, Trash2, Upload, X } from "lucide-react";
import { PageHeader, Empty, Tabs } from "../components/ui/kit";
import { assinaturaHtml, copiarFormatado, urlIcone } from "../lib/assinatura-html";
import {
  useAssinatura, useAssinaturaLogos, useLogoUpload, useLogoRemove, useAssinaturaSave,
} from "../queries/assinaturas";
import type { AssinaturaDados, AssinaturaLinha, AssinaturaLogo, AssinaturaRede, AssinaturaTemplate } from "../../api/routes/assinaturas";

type Aba = "assinatura" | "logos" | "codigo";

const LINHAS_BASE: AssinaturaLinha[] = [
  { tipo: "telefone", valor: "", href: "", ativo: true },
  { tipo: "movel", valor: "", href: "", ativo: true },
  { tipo: "email", valor: "", href: "", ativo: true },
  { tipo: "site", valor: "", href: "", ativo: true },
  { tipo: "morada", valor: "", href: "", ativo: true },
];

const REDES_BASE: AssinaturaRede[] = [
  { tipo: "linkedin", href: "", ativo: false },
  { tipo: "facebook", href: "", ativo: false },
  { tipo: "instagram", href: "", ativo: false },
  { tipo: "whatsapp", href: "", ativo: false },
];

const TIPOS: { key: AssinaturaLinha["tipo"]; label: string }[] = [
  { key: "telefone", label: "Telefone" },
  { key: "movel", label: "Telemóvel" },
  { key: "email", label: "Email" },
  { key: "site", label: "Site" },
  { key: "morada", label: "Morada" },
  { key: "extra", label: "Outro" },
];

/* Azul do exemplar + verde da barra das redes + as cores da marca. */
const CORES = ["#0da9ff", "#00402a", "#00A650", "#2f6b52", "#0f2a1d", "#f5a524", "#7c3aed", "#dc2626", "#374151"];

export default function AssinaturasPage() {
  const { data: guardado, isLoading } = useAssinatura();
  const logos = useAssinaturaLogos();
  const guardar = useAssinaturaSave();
  const upload = useLogoUpload();
  const removerLogo = useLogoRemove();

  const [aba, setAba] = useState<Aba>("assinatura");
  const [t, setT] = useState<AssinaturaTemplate | null>(null);
  const [d, setD] = useState<AssinaturaDados | null>(null);
  const [estado, setEstado] = useState<"ocioso" | "copiado" | "guardado">("ocioso");
  const [erro, setErro] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const prevRef = useRef<HTMLDivElement>(null);
  const [nomeLogo, setNomeLogo] = useState("");
  const [prevW, setPrevW] = useState(0);

  /* A assinatura tem largura fixa em pixeis (e a que se cola no email). Numa
   * janela mais estreita do que isso, encolhemos so a pre-visualizacao — o
   * HTML copiado mantem a largura verdadeira. */
  useEffect(() => {
    const el = prevRef.current;
    if (!el) return;
    const medir = () => setPrevW(el.clientWidth);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
    /* `aba` faz remontar a caixa; `isLoading`/`largura` trazem o elemento a
     * existencia so depois de os dados chegarem — sem eles a medicao ficava a
     * zero e a pre-visualizacao reflowava em vez de encolher. */
  }, [aba, isLoading, t?.largura]);

  useEffect(() => {
    if (!guardado) return;
    setT(guardado.template);
    setD({
      ...guardado.dados,
      /* Primeira visita: as linhas de contacto aparecem vazias, prontas a
       * preencher. Depois da primeira gravacao vale o que ficou gravado — mesmo
       * que o utilizador tenha apagado todas as linhas. */
      linhas: guardado.novo ? LINHAS_BASE : guardado.dados.linhas,
      redes: guardado.novo ? REDES_BASE : guardado.dados.redes,
    });
  }, [guardado]);

  /* Origem da app: o HTML da assinatura leva URLs completos, porque num email
   * um `/logos/...` relativo nao resolve para lado nenhum. */
  const base = typeof window === "undefined" ? "" : window.location.origin;
  const html = useMemo(() => (t && d ? assinaturaHtml(t, d, base) : ""), [t, d, base]);

  /* `zoom` (e nao `transform: scale`) porque encolhe tambem o espaco ocupado:
   * com transform a caixa ficava com a altura da assinatura em tamanho real e
   * sobrava um vazio por baixo. O -24 e o padding da caixa branca. */
  const escala = t && prevW > 0 && prevW - 24 < t.largura ? Math.max(0.4, (prevW - 24) / t.largura) : 1;

  if (isLoading || !t || !d) {
    return <div className="flex items-center gap-2 text-ink-3"><Loader2 size={16} className="animate-spin" /> A carregar a assinatura…</div>;
  }

  const mexer = (patch: Partial<AssinaturaTemplate>) => setT({ ...t, ...patch });
  const mexerDados = (patch: Partial<AssinaturaDados>) => setD({ ...d, ...patch });

  const mudarLinha = (i: number, patch: Partial<AssinaturaLinha>) =>
    mexerDados({ linhas: d.linhas.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const mudarRede = (i: number, patch: Partial<AssinaturaRede>) =>
    mexerDados({ redes: d.redes.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  /* Nome do ficheiro descarregado: "João Almeida" -> "joao-almeida.html".
   * O range dos acentos vai escrito com os caracteres literais (U+0300-U+036F),
   * como em `supplierKey`, para sobreviver a edicoes do ficheiro. */
  const arquivo = `${(d.nome || "assinatura")
    .normalize("NFD")
    .replace(/[\̀-\ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "assinatura"}.html`;

  const copiar = async () => {
    setErro(null);
    try {
      await copiarFormatado(html);
      setEstado("copiado");
      window.setTimeout(() => setEstado("ocioso"), 2200);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível copiar.");
    }
  };

  const gravar = async () => {
    setErro(null);
    try {
      await guardar.mutateAsync({ template: t, dados: d });
      setEstado("guardado");
      window.setTimeout(() => setEstado("ocioso"), 2200);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível guardar.");
    }
  };

  /* Um logo apagado nao pode continuar a ser o principal de ninguem: sai da
   * assinatura antes de o ficheiro desaparecer do servidor. */
  const apagarLogo = (src: string) => {
    if (t.logoPrincipal === src) mexer({ logoPrincipal: "" });
    if (t.logoSecundario === src) mexer({ logoSecundario: "" });
    removerLogo.mutate({ src });
  };

  /* Logo que a assinatura atual esta a usar, para marcar o cartao na galeria. */
  const emUso = t.logoPrincipal || t.logoSecundario;
  const emUsoRotulo = t.logoPrincipal && t.logoPrincipal === emUso ? "Principal" : "Secundário";

  const escolherLogo = (src: string, campo: "logoPrincipal" | "logoSecundario") =>
    mexer(campo === "logoPrincipal" ? { logoPrincipal: src } : { logoSecundario: src });

  const carregarLogo = async (file: File) => {
    setErro(null);
    const nome = nomeLogo.trim() || file.name.replace(/\.[a-z0-9]+$/i, "");
    const content = await new Promise<string>((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.onerror = () => rej(new Error("Não foi possível ler o ficheiro."));
      fr.readAsDataURL(file);
    });
    try {
      await upload.mutateAsync({ nome, content, mime: file.type });
      setNomeLogo("");
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar o logo.");
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Definições"
        title="Assinaturas"
        subtitle="Crie a assinatura de email com os dados e os logos que quiser e cole-a no Outlook ou no Gmail já formatada."
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Tabs
          value={aba}
          onChange={setAba}
          items={[
            { key: "assinatura", label: "Assinatura" },
            { key: "logos", label: "Logos", count: logos.data?.length },
            { key: "codigo", label: "Código" },
          ]}
        />
        <div className="ml-auto flex items-center gap-2">
          <button type="button" className="btn btn-ghost" onClick={gravar} disabled={guardar.isPending}>
            {guardar.isPending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            {estado === "guardado" ? "Guardado" : "Guardar"}
          </button>
          <button type="button" className="btn btn-primary" onClick={copiar}>
            {estado === "copiado" ? <Check size={15} /> : <Copy size={15} />}
            {estado === "copiado" ? "Copiada" : "Copiar formatada"}
          </button>
        </div>
      </div>

      {erro && <p className="mb-4 rounded-[10px] border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">{erro}</p>}

      {aba === "assinatura" && (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            {/* ------------------------------------------------ dados */}
            <section className="card rise p-5">
              <h2 className="font-display mb-4 text-[15px] font-semibold">Dados</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="label-mono mb-1 block">Nome</span>
                  <input className="input" value={d.nome} onChange={(e) => mexerDados({ nome: e.target.value })} placeholder="Diogo Almeida" aria-label="Nome na assinatura" />
                </label>
                <label className="block">
                  <span className="label-mono mb-1 block">Cargo</span>
                  <input className="input" value={d.cargo} onChange={(e) => mexerDados({ cargo: e.target.value })} placeholder="Coordenador Região Sul" aria-label="Cargo na assinatura" />
                </label>
              </div>

              <div className="mt-4 space-y-2">
                <span className="label-mono block">Linhas de contacto</span>
                {d.linhas.map((l, i) => (
                  /* Uma linha por contacto: em cima o tipo, o texto e o botao de
                   * remover; por baixo, a ligacao (opcional) a toda a largura.
                   * Lado a lado, os dois campos nao cabiam na coluna do editor e
                   * o texto ficava cortado. */
                  <div key={i} className={`grid grid-cols-[auto_104px_minmax(0,1fr)_auto] items-center gap-2 rounded-[10px] border border-line bg-bg p-2 ${l.ativo ? "" : "opacity-50"}`}>
                    <input type="checkbox" checked={l.ativo} onChange={() => mudarLinha(i, { ativo: !l.ativo })} aria-label="Mostrar linha" className="h-4 w-4 shrink-0 accent-[#00A650]" />
                    <select className="input h-8 min-w-0 px-2 text-[12px]" value={l.tipo} onChange={(e) => mudarLinha(i, { tipo: e.target.value as AssinaturaLinha["tipo"] })} aria-label="Tipo de linha">
                      {TIPOS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                    </select>
                    <input className="input h-8 min-w-0 text-[12px]" value={l.valor} onChange={(e) => mudarLinha(i, { valor: e.target.value })} placeholder="Texto a mostrar" aria-label="Valor da linha" />
                    <button type="button" className="btn-icon justify-self-end hover:text-danger" onClick={() => mexerDados({ linhas: d.linhas.filter((_, j) => j !== i) })} aria-label="Remover linha"><X size={14} /></button>
                    <input className="input col-span-4 h-7 min-w-0 text-[11.5px] text-ink-2" value={l.href} onChange={(e) => mudarLinha(i, { href: e.target.value })} placeholder="Ligação (opcional): tel:+351…, mailto:…, https://…" aria-label="Ligação da linha" />
                  </div>
                ))}
                <button type="button" className="btn btn-ghost" onClick={() => mexerDados({ linhas: [...d.linhas, { tipo: "extra", valor: "", href: "", ativo: true }] })}>
                  <Plus size={15} /> Acrescentar linha
                </button>
              </div>

              <label className="mt-4 block">
                <span className="label-mono mb-1 block">Nota de rodapé (opcional)</span>
                <textarea className="input min-h-[62px] resize-y text-[12.5px]" value={d.nota} onChange={(e) => mexerDados({ nota: e.target.value })} placeholder="Ex.: Soluções de energia para a sua casa e empresa." aria-label="Nota de rodapé" />
              </label>
            </section>

            {/* ------------------------------------------------ redes */}
            <section className="card rise p-5">
              <h2 className="font-display mb-4 text-[15px] font-semibold">Redes sociais</h2>
              <div className="space-y-2">
                {d.redes.map((r, i) => (
                  <div key={i} className={`flex items-center gap-2 rounded-[10px] border border-line bg-bg p-2 ${r.ativo ? "" : "opacity-50"}`}>
                    <input type="checkbox" checked={r.ativo} onChange={() => mudarRede(i, { ativo: !r.ativo })} aria-label={`Mostrar ${r.tipo}`} className="h-4 w-4 shrink-0 accent-[#00A650]" />
                    <span className="w-[86px] shrink-0 text-[12.5px] capitalize">{r.tipo}</span>
                    <input className="input h-8 min-w-0 flex-1 text-[12px]" value={r.href} onChange={(e) => mudarRede(i, { href: e.target.value })} placeholder="https://…" aria-label={`Ligação ${r.tipo}`} />
                  </div>
                ))}
              </div>
            </section>

            {/* ------------------------------------------------ logos */}
            <section className="card rise p-5">
              <h2 className="font-display mb-1 text-[15px] font-semibold">Logos</h2>
              <p className="mb-4 text-[11.5px] text-ink-3">Escolha o logo da marca e, se quiser, o segundo. Os logos ficam empilhados a esquerda, na largura do exemplar (145px).</p>
              {!logos.data?.length ? (
                <Empty title="Sem logos" text="Carregue o primeiro logo na aba Logos." />
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="label-mono mb-1 block">Logo principal</span>
                    <select className="input" value={t.logoPrincipal} onChange={(e) => mexer({ logoPrincipal: e.target.value })} aria-label="Logo principal">
                      <option value="">Sem logo (só texto)</option>
                      {logos.data.map((l: AssinaturaLogo) => <option key={l.src} value={l.src}>{l.nome}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="label-mono mb-1 block">Logo secundário</span>
                    <select className="input" value={t.logoSecundario} onChange={(e) => mexer({ logoSecundario: e.target.value })} aria-label="Logo secundário">
                      <option value="">Nenhum</option>
                      {logos.data.map((l: AssinaturaLogo) => <option key={l.src} value={l.src}>{l.nome}</option>)}
                    </select>
                  </label>
                </div>
              )}
              <button type="button" className="btn btn-ghost mt-4" onClick={() => setAba("logos")}>
                <ImagePlus size={15} /> Carregar outro logo
              </button>
            </section>

            {/* ------------------------------------------------ estilo */}
            <section className="card rise p-5">
              <h2 className="font-display mb-4 flex items-center gap-2 text-[15px] font-semibold"><Palette size={15} /> Estilo</h2>
              <div className="space-y-4">
                <div>
                  <span className="label-mono mb-2 block">Cor da linha e das ligações</span>
                  <div className="flex flex-wrap items-center gap-2">
                    {CORES.map((c) => (
                      <button key={c} type="button" onClick={() => mexer({ cor: c })} aria-label={`Cor ${c}`} className={`h-7 w-7 rounded-full border-2 transition ${t.cor.toLowerCase() === c.toLowerCase() ? "border-ink" : "border-transparent"}`} style={{ background: c }} />
                    ))}
                    <input type="color" value={t.cor} onChange={(e) => mexer({ cor: e.target.value })} aria-label="Cor personalizada" className="h-7 w-10 cursor-pointer rounded border border-line bg-transparent" />
                  </div>
                </div>
                <div>
                  <span className="label-mono mb-2 block">Cor dos ícones dos contactos</span>
                  <div className="flex flex-wrap items-center gap-2">
                    {CORES.map((c) => (
                      <button key={c} type="button" onClick={() => mexer({ corIcones: c })} aria-label={`Ícones ${c}`} className={`h-7 w-7 rounded-full border-2 transition ${t.corIcones.toLowerCase() === c.toLowerCase() ? "border-ink" : "border-transparent"}`} style={{ background: c }} />
                    ))}
                    <input type="color" value={t.corIcones} onChange={(e) => mexer({ corIcones: e.target.value })} aria-label="Cor de ícones personalizada" className="h-7 w-10 cursor-pointer rounded border border-line bg-transparent" />
                  </div>
                  {/* Os mesmos icones que saem na assinatura, na cor escolhida.
                      Sobre uma tira clara, porque a assinatura e vista em fundo
                      claro e uma cor escura perder-se-ia no cartao. */}
                  <div className="mt-3 flex flex-wrap items-center gap-3" aria-label="Ícones das linhas">
                    <span className="flex items-center gap-2 rounded-md border border-line bg-[#f1f3ef] px-2.5 py-1.5">
                      {TIPOS.filter((x) => x.key !== "extra").map((x) => (
                        <img key={x.key} src={urlIcone(x.key, t.corIcones, base)} alt="" width={15} height={15} className="h-[15px] w-[15px]" title={x.label} />
                      ))}
                    </span>
                    <span className="text-[11px] text-ink-3">telefone · email · site · morada</span>
                  </div>
                </div>
                <p className="text-[11.5px] text-ink-3">Os ícones das redes ficam sempre na barra verde-escura do exemplar.</p>
                <label className="flex items-center gap-2 text-[12.5px]">
                  <input type="checkbox" checked={t.mostrarIcones} onChange={() => mexer({ mostrarIcones: !t.mostrarIcones })} className="h-4 w-4 accent-[#00A650]" aria-label="Mostrar ícones" />
                  Mostrar ícones à esquerda de cada linha
                </label>
                <div>
                  <span className="label-mono mb-1 block">Largura: <span className="num">{t.largura}px</span></span>
                  <input type="range" min={462} max={760} step={2} value={t.largura} onChange={(e) => mexer({ largura: Number(e.target.value) })} aria-label="Largura da assinatura" className="w-full accent-[#00A650]" />
                </div>
              </div>
            </section>
          </div>

          {/* ------------------------------------------------ preview */}
          <section className="card rise p-5 xl:sticky xl:top-4">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <h2 className="font-display text-[15px] font-semibold">Pré-visualização</h2>
              <span className="label-mono">{t.largura}px</span>
            </div>
            <div ref={prevRef} className="overflow-hidden rounded-[12px] border border-line bg-white p-3">
              <div style={{ zoom: escala }} dangerouslySetInnerHTML={{ __html: html }} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="btn btn-primary" onClick={copiar}>
                {estado === "copiado" ? <Check size={15} /> : <Copy size={15} />} Copiar formatada
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  const blob = new Blob([html], { type: "text/html" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = arquivo;
                  a.click();
                  URL.revokeObjectURL(a.href);
                }}
              >
                <Download size={15} /> Descarregar HTML
              </button>
            </div>
            <p className="mt-3 text-[11.5px] text-ink-3">
              Cole no Outlook (Assinaturas) ou no Gmail (Definições → Assinatura) com <span className="font-medium">Ctrl+V</span>. O formato é mantido.
            </p>
          </section>
        </div>
      )}

      {aba === "logos" && (
        <div className="space-y-4">
          <section className="card rise p-5">
            <h2 className="font-display mb-1 text-[15px] font-semibold">Carregar um logo</h2>
            <p className="mb-4 text-[11.5px] text-ink-3">PNG, JPG, WEBP ou SVG até 3 MB. Fica guardado na biblioteca e disponível para qualquer assinatura.</p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-[180px] flex-1">
                <span className="label-mono mb-1 block">Nome do logo</span>
                <input className="input" value={nomeLogo} onChange={(e) => setNomeLogo(e.target.value)} placeholder="Ex.: Iberdrola" aria-label="Nome do logo" />
              </label>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void carregarLogo(f); }} />
              <button type="button" className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
                {upload.isPending ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Escolher ficheiro
              </button>
            </div>
          </section>

          {!logos.data?.length ? (
            <Empty title="Sem logos" text="Carregue o primeiro logo para começar." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {logos.data.map((l: AssinaturaLogo) => (
                <div key={l.src} className="card rise flex flex-col gap-3 p-4">
                  <div className="relative flex h-20 items-center justify-center rounded-[10px] border border-line bg-white p-3">
                    <img src={l.src} alt={l.nome} className="max-h-14 max-w-full object-contain" />
                    {emUso === l.src && (
                      <span className="absolute right-1.5 top-1.5 rounded-full bg-volt px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-black">{emUsoRotulo}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[12.5px] font-medium">{l.nome}</span>
                    {l.proprio && (
                      <button type="button" className="btn-icon shrink-0 hover:text-danger" aria-label={`Eliminar ${l.nome}`} onClick={() => apagarLogo(l.src)}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  <div className="mt-auto flex gap-2">
                    <button type="button" className="btn btn-ghost flex-1 text-[11.5px]" onClick={() => { escolherLogo(l.src, "logoPrincipal"); setAba("assinatura"); }}>Logo principal</button>
                    <button type="button" className="btn btn-ghost flex-1 text-[11.5px]" onClick={() => { escolherLogo(l.src, "logoSecundario"); setAba("assinatura"); }}>Logo secundário</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {aba === "codigo" && (
        <section className="card rise p-5">
          <h2 className="font-display mb-1 text-[15px] font-semibold">HTML da assinatura</h2>
          <p className="mb-4 text-[11.5px] text-ink-3">Para usar noutro cliente de email, ou para entregar a quem gere o sistema.</p>
          <textarea readOnly value={html} aria-label="HTML da assinatura" className="input num min-h-[420px] w-full resize-y font-mono text-[11.5px] leading-relaxed" />
          <button type="button" className="btn btn-ghost mt-3" onClick={() => void navigator.clipboard.writeText(html)}>
            <Copy size={15} /> Copiar HTML
          </button>
        </section>
      )}
    </div>
  );
}
