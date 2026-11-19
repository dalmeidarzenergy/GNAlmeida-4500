/**
 * Gera a assinatura de email em HTML de tabela estilo email (Outlook/Gmail).
 *
 * O HTML usa tabelas e estilos inline porque o Outlook descarta <style>,
 * flexbox e grid. Tudo o que se vê na pré-visualização sai daqui — a
 * pré-visualização na página é o mesmo HTML dentro de uma caixa.
 */
import type { AssinaturaDados, AssinaturaLinha, AssinaturaRede, AssinaturaTemplate } from "../../api/routes/assinaturas";

export const LINHA_ICONE: Record<string, string> = {
  telefone: "☎",
  movel: "☎",
  email: "✉",
  site: "◉",
  morada: "▲",
  extra: "•",
};

export const REDE_LABEL: Record<string, string> = {
  linkedin: "in",
  facebook: "f",
  instagram: "◉",
  whatsapp: "✆",
  youtube: "▶",
};

export function esc(v: string) {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Texto visivel de uma linha (vazio quando a linha esta desligada ou sem valor). */
export function valorLinha(l: AssinaturaLinha) {
  return l.ativo ? l.valor.trim() : "";
}

function linhaTabela(l: AssinaturaLinha, t: AssinaturaTemplate) {
  const valor = valorLinha(l);
  if (!valor) return "";
  const conteudo = l.href
    ? `<a href="${esc(l.href)}" style="color:#1f2937;text-decoration:underline;">${esc(valor)}</a>`
    : `<span style="color:#1f2937;">${esc(valor)}</span>`;
  const icone = t.mostrarIcones
    ? `<td width="26" valign="top" style="width:26px;padding:0 8px 6px 0;font-size:13px;line-height:20px;color:${t.corIcones};">${LINHA_ICONE[l.tipo] ?? "•"}</td>`
    : "";
  return `<tr>${icone}<td valign="top" style="padding:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;">${conteudo}</td></tr>`;
}

function blocoRedes(d: AssinaturaDados, t: AssinaturaTemplate) {
  const ativas = d.redes.filter((r) => r.ativo && r.href.trim());
  if (!ativas.length) return "";
  const celulas = ativas
    .map(
      (r: AssinaturaRede) =>
        `<td style="padding:0 4px 0 0;"><a href="${esc(r.href)}" style="display:inline-block;width:26px;height:26px;background:${t.corIcones};color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;line-height:26px;text-align:center;text-decoration:none;border-radius:4px;">${REDE_LABEL[r.tipo] ?? "•"}</a></td>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>${celulas}</tr></table>`;
}

/** Assinatura completa em HTML de email. */
export function assinaturaHtml(t: AssinaturaTemplate, d: AssinaturaDados) {
  const L = t.largura;
  const colEsq = Math.round(L * 0.3);
  const colDir = L - colEsq;

  const logos = [t.logoPrincipal, t.logoSecundario]
    .filter(Boolean)
    .map((src) => `<img src="${esc(src)}" alt="" style="display:block;max-width:${colEsq - 8}px;height:auto;margin:0 0 10px;border:0;" />`)
    .join("");
  const marca = logos
    ? logos
    : `<div style="font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:bold;color:${t.corTexto};letter-spacing:0.04em;">${esc(t.marca || d.nomeEmpresa)}</div>`;

  const nome = d.nome
    ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:bold;color:${t.corTexto};line-height:22px;">${esc(d.nome)}</div>`
    : "";
  const cargo = d.cargo
    ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#374151;line-height:19px;padding-top:2px;">${esc(d.cargo)}</div>`
    : "";

  const linhas = d.linhas.map((l) => linhaTabela(l, t)).join("");
  const redes = blocoRedes(d, t);
  const nota = d.nota
    ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:10.5px;color:#6b7280;line-height:15px;padding-top:10px;max-width:${colDir - 24}px;">${esc(d.nota)}</div>`
    : "";

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${L}" style="border-collapse:collapse;width:${L}px;max-width:100%;">
  <tr>
    <td width="${colEsq}" valign="top" style="width:${colEsq}px;padding:0 18px 0 0;">${marca}</td>
    <td width="${colDir}" valign="top" style="width:${colDir}px;padding:0;border-left:1px solid ${t.cor}33;">
      <div style="padding:0 0 12px 18px;">${nome}${cargo}</div>
      <div style="border-top:1px solid ${t.cor};margin:0 0 12px 18px;"></div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-left:18px;"><tbody>${linhas}</tbody></table>
      ${redes ? `<div style="padding:12px 0 0 18px;">${redes}</div>` : ""}
      ${nota}
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
