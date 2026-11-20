/**
 * Gera a assinatura de email em HTML de tabela estilo email (Outlook/Gmail).
 *
 * As medidas e as cores saem do exemplar da RZ Energy (ver
 * `shots/medidas-exemplar.md`): coluna dos logos com 145px, coluna do texto com
 * 431px, nome em 23px, cargo em 13.5px e contactos em 12px, tudo em Arial.
 *
 * O HTML usa tabelas e estilos inline porque o Outlook descarta <style>,
 * flexbox e grid. A pre-visualizacao na pagina e este mesmo HTML dentro de uma
 * caixa branca, por isso o que se ve e o que sai.
 */
import type { AssinaturaDados, AssinaturaLinha, AssinaturaRede, AssinaturaTemplate } from "../../api/routes/assinaturas";

/** Icones dos contactos. Sao imagens servidas pelo servidor em
 *  `/api/assinaturas/icone/<tipo>/<cor>`: um PNG tingido com a cor escolhida,
 *  porque nem o Outlook nem o Gmail aceitam webfonts nem recolorir por CSS. */
export const LINHA_ICONE: Record<string, string> = {
  telefone: "telefone",
  movel: "movel",
  email: "email",
  site: "site",
  morada: "morada",
  extra: "extra",
};

/** URL do icone de um tipo, na cor pedida. `base` e a origem da app (o cliente
 *  de email precisa do endereco completo).
 *
 *  A cor vai no caminho em 6 digitos: `#abc` e expandido para `aabbcc` e uma cor
 *  vazia ou invalida cai no verde da casa, senao o URL apontava para um icone
 *  que nao existe e a assinatura ficava com um espaco vazio. */
export function urlIcone(tipo: string, cor: string, base = "") {
  const nome = LINHA_ICONE[tipo] ?? "extra";
  return `${base}/api/assinaturas/icone/${nome}/${corHex6(cor) ?? "00402a"}`;
}

/** Cor normalizada em 6 digitos (sem `#`), ou null se nao for uma cor. */
export function corHex6(cor: string): string | null {
  const c = (cor || "").trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{6}$/.test(c)) return c;
  if (/^[0-9a-f]{3}$/.test(c)) return c[0]! + c[0]! + c[1]! + c[1]! + c[2]! + c[2]!;
  return null;
}

/** Junta a origem aos caminhos relativos (`/logos/...`), que num email nao
 *  resolvem para lado nenhum. */
export function urlAbsoluta(src: string, base = "") {
  if (!src) return "";
  if (/^(https?:|data:)/i.test(src)) return src;
  return `${base}${src.startsWith("/") ? "" : "/"}${src}`;
}

/** Simbolos das redes, no mesmo espirito: texto, nao imagem. */
export const REDE_LABEL: Record<string, string> = {
  linkedin: "in",
  facebook: "f",
  instagram: "◎",
  whatsapp: "✆",
  youtube: "▶",
};

/** Cor de fundo dos icones e da barra das redes, como no exemplar. */
const BARRA = "#00402a";
/** Cor por omissao da linha horizontal e dos links (a do exemplar). */
const AZUL = "#0da9ff";
/** Tinta do nome e do cargo. */
const TINTA = "#111827";
/** Cor dos contactos com link (telefone e email), como no exemplar. */
const MORENO = "#3f3a36";
/** Cor do site no exemplar. */
const VINHO = "#7a3b52";
/** Cor da morada (texto simples). */
const CINZA = "#374151";
/** Tipo de letra de todas as linhas. */
const LETRA = "Arial,Helvetica,sans-serif";

export function esc(v: string) {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Texto visivel de uma linha (vazio quando a linha esta desligada ou sem valor). */
export function valorLinha(l: AssinaturaLinha) {
  return l.ativo ? l.valor.trim() : "";
}

/**
 * Cor do contacto, a imitar o exemplar: telefone e email em moreno escuro,
 * site em vinho, morada em cinza e o resto na cor da linha escolhida.
 */
function corValor(l: AssinaturaLinha, t: AssinaturaTemplate) {
  if (l.tipo === "telefone" || l.tipo === "movel" || l.tipo === "email") return MORENO;
  if (l.tipo === "site") return VINHO;
  if (l.tipo === "morada") return CINZA;
  return t.cor;
}
/** Uma linha de contacto: icone a esquerda (opcional) e o valor a direita. */
function linhaTabela(l: AssinaturaLinha, t: AssinaturaTemplate, base: string) {
  const valor = valorLinha(l);
  if (!valor) return "";
  const cor = corValor(l, t);
  const conteudo = l.href
    ? `<a href="${esc(l.href)}" style="color:${cor};text-decoration:underline;">${esc(valor)}</a>`
    : `<span style="color:${cor};">${esc(valor)}</span>`;
  /* O icone e uma imagem: `width`/`height` em atributo (para o Outlook, que
   * ignora o tamanho do CSS) e o CSS a repetir o mesmo. */
  const icone = t.mostrarIcones
    ? `<td width="${COL_ICONE}" valign="top" style="width:${COL_ICONE}px;padding:1px 0 8px;"><img src="${esc(urlIcone(l.tipo, t.corIcones, base))}" alt="" width="${ICONE}" height="${ICONE}" style="display:block;width:${ICONE}px;height:${ICONE}px;border:0;background:transparent;" /></td>`
    : "";
  return `<tr>${icone}<td valign="top" style="padding:0 0 8px;font-family:${LETRA};font-size:12px;line-height:15px;">${conteudo}</td></tr>`;
}

/**
 * Linha horizontal de separacao.
 *
 * Nao pode ser `border-top` num `<div>`: o Outlook descarta-a. Uma celula de
 * tabela com `bgcolor` e 1px de altura e o que se ve em todos os clientes.
 */
function divisor(cor: string) {
  return `<tr><td height="1" bgcolor="${cor}" style="height:1px;line-height:1px;font-size:1px;background-color:${cor};">&nbsp;</td></tr>`;
}

/** Barra verde-escura com os icones das redes, como no exemplar. */
function blocoRedes(d: AssinaturaDados, t: AssinaturaTemplate) {
  const ativas = d.redes.filter((r) => r.ativo && r.href.trim());
  if (!ativas.length) return "";
  const celulas = ativas
    .map(
      (r: AssinaturaRede) =>
        `<td style="padding:0;"><a href="${esc(r.href)}" style="display:block;width:24px;height:24px;background:${BARRA};color:#ffffff;font-family:${LETRA};font-size:12px;font-weight:bold;line-height:24px;text-align:center;text-decoration:none;">${REDE_LABEL[r.tipo] ?? "•"}</a></td>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>${celulas}</tr></table>`;
}

/** Largura da coluna dos logos: a marca do exemplar ocupa 118 de 431px. */
const COL_LOGOS = 145;
/** Altura maxima de um logo, para o principal nao dominar a assinatura. */
const LOGO_MAX_H = 46;
/** Espaco entre um logo e o seguinte. */
const LOGO_GAP = 14;
/** Largura da coluna do icone e tamanho do proprio icone. */
const COL_ICONE = 42;
const ICONE = 14;

/** Assinatura completa em HTML de email. */
export function assinaturaHtml(t: AssinaturaTemplate, d: AssinaturaDados, base = "") {
  const colDir = Math.max(320, t.largura - COL_LOGOS);

  /* Cada logo vai no seu <tr> com o espaco em `padding` da celula: `margin`
   * num <img> e ignorada pelo Outlook, e os logos ficavam colados. */
  const srcs = [t.logoPrincipal, t.logoSecundario].filter(Boolean);
  const logos = srcs
    .map(
      (src, i) =>
        `<tr><td style="padding:${i ? LOGO_GAP : 0}px 0 0;"><img src="${esc(urlAbsoluta(src, base))}" alt="" width="${COL_LOGOS}" style="display:block;width:${COL_LOGOS}px;max-width:100%;height:auto;max-height:${LOGO_MAX_H}px;border:0;background:transparent;" /></td></tr>`,
    )
    .join("");
  /* Sem logo escolhido, a coluna mostra o nome da marca em texto. */
  const marca = logos
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${logos}</table>`
    : `<div style="font-family:${LETRA};font-size:19px;font-weight:bold;color:${TINTA};letter-spacing:0.04em;line-height:24px;">${esc(t.marca || d.nomeEmpresa)}</div>`;

  /* Nome e cargo numa celula e os icones das redes na celula ao lado, como no
   * exemplar (barra curta junto ao nome). So aparece quando ha redes ativas. */
  const nome = d.nome
    ? `<div style="font-family:${LETRA};font-size:23px;font-weight:bold;color:${TINTA};line-height:27px;">${esc(d.nome)}</div>`
    : "";
  const cargo = d.cargo
    ? `<div style="font-family:${LETRA};font-size:13.5px;color:${TINTA};line-height:18px;">${esc(d.cargo)}</div>`
    : "";
  const redesAoNome = blocoRedes(d, t);
  const identidade = redesAoNome
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr><td valign="top" style="padding:2px 0 0;">${nome}${cargo}</td><td width="14" style="width:14px;padding:0;">&nbsp;</td><td valign="top" style="padding:0;">${redesAoNome}</td></tr></table>`
    : nome + cargo;

  const linhas = d.linhas.map((l) => linhaTabela(l, t, base)).join("");
  const nota = d.nota
    ? `<div style="font-family:${LETRA};font-size:10.5px;color:#6b7280;line-height:15px;padding:10px 0 0;">${esc(d.nota)}</div>`
    : "";

  /* Duas linhas horizontais, como no exemplar: uma acima do nome e outra
   * imediatamente por baixo do cargo, a separar a identificacao dos contactos.
   * Vao de fora a fora da coluna do texto (os 431px do exemplar).
   *
   * `background:transparent` e a cor de tinta explicitas: a assinatura cola-se
   * dentro do corpo do email e tem de deixar ver o fundo do cliente (claro ou
   * escuro). Sem isto, herda o que estiver a volta. */
  const corLinha = t.cor || AZUL;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${t.largura}" bgcolor="transparent" style="border-collapse:collapse;background:transparent;background-color:transparent;width:${t.largura}px;max-width:100%;font-family:${LETRA};font-size:12px;color:${TINTA};">
  <tr>
    <td width="${COL_LOGOS}" valign="top" style="width:${COL_LOGOS}px;padding:0;vertical-align:top;">${marca}</td>
    <td width="26" style="width:26px;padding:0;">&nbsp;</td>
    <td width="${colDir - 26}" valign="top" style="width:${colDir - 26}px;padding:0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;">
        ${divisor(corLinha)}
        <tr><td style="padding:8px 0 12px;">${identidade}</td></tr>
        ${divisor(corLinha)}
        <tr><td style="padding:16px 0 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tbody>${linhas}</tbody></table></td></tr>
        ${nota ? `<tr><td style="padding:0;">${nota}</td></tr>` : ""}
      </table>
    </td>
  </tr>
</table>`;
}

/** Texto simples equivalente, para os clientes que colam so texto. */
function textoSimples(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|tr|table)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Copia a assinatura para a area de transferencia ja formatada, para colar
 * no Outlook/Gmail a manter o formato.
 *
 * Importante: o HTML e escrito no clipboard **tal e qual**. O caminho antigo
 * (selecionar um div e `execCommand("copy")`) passava pelo serializador do
 * navegador, que cola ao elemento raiz os estilos herdados da pagina — no tema
 * escuro da app isso metia `background-color: rgb(12,14,13)` e `color: rgb(238,
 * 242, 234)` na assinatura, e o resultado aparecia com um bloco escuro em vez
 * de fundo transparente. Como a assinatura assenta dentro do corpo do email,
 * o fundo tem de ser o do cliente.
 *
 * Ordem: `navigator.clipboard.write` com `ClipboardItem` (copia exata, sem
 * serializador) e, se o navegador nao souber, `execCommand` num contentor fora
 * do ecra com fundo/cor/fonte **explicitos** — o serializer copia o estilo
 * computado do elemento copiado, por isso um contentor com `background:
 * transparent` faz com que ele deixe de ir buscar o fundo escuro da app.
 */
export async function copiarFormatado(html: string): Promise<void> {
  const texto = textoSimples(html);

  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([texto], { type: "text/plain" }),
        }),
      ]);
      return;
    }
  } catch {
    /* segue para o execCommand */
  }

  /* Recurso: contentor invisivel que corta a heranca do tema da app. O iframe
   * nao serve — o Chrome recusa `execCommand("copy")` dentro dele. */
  const holder = document.createElement("div");
  holder.contentEditable = "true";
  holder.style.cssText =
    "position:fixed;left:-9999px;top:0;background:transparent;background-color:transparent;color:#111827;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:400;font-style:normal;line-height:normal;letter-spacing:normal;text-align:left;text-transform:none;";
  holder.innerHTML = html;
  document.body.appendChild(holder);
  try {
    const range = document.createRange();
    range.selectNodeContents(holder);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const ok = document.execCommand("copy");
    sel?.removeAllRanges();
    if (!ok) await navigator.clipboard.writeText(texto);
  } finally {
    document.body.removeChild(holder);
    window.focus();
  }
}
