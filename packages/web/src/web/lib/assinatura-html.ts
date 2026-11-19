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

/** Icones dos contactos. Glifos de texto (nao webfonts: os clientes de email
 *  nao carregam fontes externas e o icone desaparecia). */
export const LINHA_ICONE: Record<string, string> = {
  telefone: "✆",
  movel: "✆",
  email: "✉",
  site: "◍",
  morada: "◉",
  extra: "•",
};

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
function linhaTabela(l: AssinaturaLinha, t: AssinaturaTemplate) {
  const valor = valorLinha(l);
  if (!valor) return "";
  const cor = corValor(l, t);
  const conteudo = l.href
    ? `<a href="${esc(l.href)}" style="color:${cor};text-decoration:underline;">${esc(valor)}</a>`
    : `<span style="color:${cor};">${esc(valor)}</span>`;
  const icone = t.mostrarIcones
    ? `<td width="46" valign="top" style="width:46px;padding:0 0 8px;font-family:${LETRA};font-size:13px;line-height:15px;color:${t.corIcones};">${LINHA_ICONE[l.tipo] ?? "•"}</td>`
    : "";
  return `<tr>${icone}<td valign="top" style="padding:0 0 8px;font-family:${LETRA};font-size:12px;line-height:15px;">${conteudo}</td></tr>`;
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
const LOGO_GAP = 12;

/** Assinatura completa em HTML de email. */
export function assinaturaHtml(t: AssinaturaTemplate, d: AssinaturaDados) {
  const colDir = Math.max(320, t.largura - COL_LOGOS);

  const logos = [t.logoPrincipal, t.logoSecundario]
    .filter(Boolean)
    .map(
      (src, i) =>
        `<img src="${esc(src)}" alt="" width="${COL_LOGOS}" style="display:block;width:${COL_LOGOS}px;max-width:100%;height:auto;max-height:${LOGO_MAX_H}px;border:0;${i ? `margin:${LOGO_GAP}px 0 0;` : "margin:0;"}" />`,
    )
    .join("");
  /* Sem logo escolhido, a coluna mostra o nome da marca em texto. */
  const marca = logos
    ? logos
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

  const linhas = d.linhas.map((l) => linhaTabela(l, t)).join("");
  const nota = d.nota
    ? `<div style="font-family:${LETRA};font-size:10.5px;color:#6b7280;line-height:15px;padding:10px 0 0;">${esc(d.nota)}</div>`
    : "";

  /* A linha horizontal vai de fora a fora da coluna do texto (no exemplar
   * ocupa os 431px todos) e fica 8px acima do topo do nome. */
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${t.largura}" style="border-collapse:collapse;width:${t.largura}px;max-width:100%;">
  <tr>
    <td width="${COL_LOGOS}" valign="top" style="width:${COL_LOGOS}px;padding:0;vertical-align:top;">${marca}</td>
    <td width="26" style="width:26px;padding:0;">&nbsp;</td>
    <td width="${colDir - 26}" valign="top" style="width:${colDir - 26}px;padding:0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;">
        <tr><td style="padding:0 0 8px;font-family:${LETRA};font-size:1px;line-height:1px;color:${t.cor || AZUL};"><div style="border-top:1px solid ${t.cor || AZUL};font-size:1px;line-height:1px;">&nbsp;</div></td></tr>
        <tr><td style="padding:0 0 10px;">${identidade}</td></tr>
        <tr><td style="padding:0 0 16px;"><div style="border-top:1px solid ${t.cor || AZUL};font-size:1px;line-height:1px;">&nbsp;</div></td></tr>
        <tr><td style="padding:0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tbody>${linhas}</tbody></table></td></tr>
        ${nota ? `<tr><td style="padding:0;">${nota}</td></tr>` : ""}
      </table>
    </td>
  </tr>
</table>`;
}

/**
 * Copia a assinatura para a area de transferencia ja formatada, para colar
 * no Outlook/Gmail a manter o formato.
 *
 * O navegador normal so aceita HTML no evento `copy`; por isso montamos um
 * contentor fora do ecra, selecionamos-no e disparamos `document.execCommand`.
 */
export async function copiarFormatado(html: string): Promise<void> {
  const holder = document.createElement("div");
  holder.contentEditable = "true";
  holder.style.position = "fixed";
  holder.style.left = "-9999px";
  holder.style.top = "0";
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
    if (!ok) await navigator.clipboard.writeText(holder.innerText);
  } finally {
    document.body.removeChild(holder);
  }
}
