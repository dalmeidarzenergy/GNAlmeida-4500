import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PUBLIC_DIR } from "../lib/public-files";

type Person = {
  employeeName: string;
  tableName: string | null;
  bandSales: number;
  salesCount: number;
  luzCount: number;
  gasCount: number;
  ddCount: number;
  feCount: number;
  pelCount: number;
  baseAmount: number;
  svcAmount: number;
  unit: { luz: number; gas: number; dd: number; fe: number; pel: number } | null;
  gross: number;
  chargeback: number;
  due: number;
  lines: { idVenda: string; service: string; base: number; dd: number; fe: number; pel: number; total: number }[];
  chargebackLines: { idVenda: string; service: string; base: number; dd: number; fe: number; pel: number; total: number }[];
  ruleEffects: { name: string; type: string; amount: number }[];
  vncs: { idVenda: string; amount: number }[];
  overridesOut: { idVenda: string; toName: string }[];
  overridesIn: { idVenda: string; fromName: string }[];
};

const esc = (n: string) => n.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const eur = (n: number) => (n < 0 ? "−" : "") + "€" + Math.abs(n).toFixed(2);

export function buildIberdrolaPdf(p: Person, m: string): Buffer {
  const monthLabel = `${m.slice(5)}/${m.slice(0, 4)}`;

  let html = `<!DOCTYPE html><html lang="pt"><head><meta charset="utf-8"><title>${esc(p.employeeName)} — Auto Iberdrola ${monthLabel}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;500;600;700&family=Poppins:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Poppins', sans-serif; font-size: 9pt; background: #0c0e0d; color: #eef2ea; padding: 40px 48px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .num { font-family: 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums; }
  h1 { font-family: 'Sora', sans-serif; font-size: 22pt; font-weight: 600; letter-spacing: -0.02em; margin-bottom: 2px; }
  h2 { font-family: 'Sora', sans-serif; font-size: 11pt; font-weight: 500; letter-spacing: -0.01em; margin-bottom: 20px; color: #9aa39b; }
  .meta { display: flex; gap: 12px; margin-bottom: 28px; color: #9aa39b; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.08em; flex-wrap: wrap; }
  .meta span { background: #141715; border: 1px solid #262b27; border-radius: 8px; padding: 5px 12px; }
  .kpis { display: flex; gap: 10px; margin-bottom: 32px; flex-wrap: wrap; }
  .kpi { background: #141715; border: 1px solid #262b27; border-radius: 12px; padding: 14px 20px; min-width: 96px; }
  .kpi .label { font-size: 7pt; text-transform: uppercase; letter-spacing: 0.1em; color: #636b64; margin-bottom: 4px; }
  .kpi .value { font-family: 'JetBrains Mono', monospace; font-size: 15pt; font-weight: 600; }
  .kpi .value.v { color: #c6f432; } .kpi .value.s { color: #38bdf8; }
  section { margin-bottom: 22px; }
  .s-title { font-family: 'Sora', sans-serif; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.1em; color: #636b64; margin-bottom: 10px; border-bottom: 1px solid #262b27; padding-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
  th { background: #141715; text-align: left; padding: 7px 10px; font-weight: 500; color: #9aa39b; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid #262b27; }
  td { padding: 6px 10px; border-bottom: 1px solid #1b1f1c; }
  .r-num { text-align: right; }
  .t-pos { color: #c6f432; } .t-neg { color: #f05252; } .t-svc { color: #9aa39b; }
  .tfoot td { background: #141715; font-weight: 600; border-top: 1px solid #262b27; }
  .swap-out { color: #f5a524; } .swap-in { color: #c6f432; }
  .footer { margin-top: 36px; padding-top: 12px; border-top: 1px solid #262b27; font-size: 7pt; color: #636b64; display: flex; justify-content: space-between; }
  @page { size: A4; margin: 10mm; }
</style></head><body>
<h1>${esc(p.employeeName)}</h1>
<h2>${esc(p.tableName ?? "Sem tabela comisional")} &nbsp;·&nbsp; ${monthLabel}</h2>
<div class="meta">
  <span>Escalão ${p.bandSales}</span>
  <span>${p.salesCount} vendas</span>
  <span>${p.luzCount} luz / ${p.gasCount} gás</span>
</div>
<div class="kpis">
  <div class="kpi"><div class="label">Bruto</div><div class="value v">${eur(p.gross)}</div></div>
  <div class="kpi"><div class="label">Chargback</div><div class="value t-neg">${eur(p.chargeback)}</div></div>
  <div class="kpi"><div class="label">Devido</div><div class="value s">${eur(p.due)}</div></div>
  <div class="kpi"><div class="label">Base</div><div class="value">${eur(p.baseAmount)}</div></div>
  <div class="kpi"><div class="label">Serviços</div><div class="value">${eur(p.svcAmount)}</div></div>
  <div class="kpi"><div class="label">DD / FE / PEL</div><div class="value" style="font-size:12pt">${p.ddCount} / ${p.feCount} / ${p.pelCount}</div></div>
</div>`;

  // Escalão atingido
  html += `<section><div class="s-title">Escalão atingido</div><table><thead><tr><th>Item</th><th class="r-num">Valor unitário</th><th class="r-num">Qtd</th><th class="r-num">Total</th></tr></thead><tbody>`;
  if (p.unit) {
    html += `<tr><td>Luz</td><td class="num r-num">${eur(p.unit.luz)}</td><td class="num r-num">${p.luzCount}</td><td class="num r-num">${eur(p.unit.luz * p.luzCount)}</td></tr>`;
    html += `<tr><td>Gás</td><td class="num r-num">${eur(p.unit.gas)}</td><td class="num r-num">${p.gasCount}</td><td class="num r-num">${eur(p.unit.gas * p.gasCount)}</td></tr>`;
    if (p.ddCount > 0) html += `<tr><td>Débito Direto</td><td class="num r-num">${eur(p.unit.dd)}</td><td class="num r-num">${p.ddCount}</td><td class="num r-num">${eur(p.unit.dd * p.ddCount)}</td></tr>`;
    if (p.feCount > 0) html += `<tr><td>Fatura Eletrónica</td><td class="num r-num">${eur(p.unit.fe)}</td><td class="num r-num">${p.feCount}</td><td class="num r-num">${eur(p.unit.fe * p.feCount)}</td></tr>`;
    if (p.pelCount > 0) html += `<tr><td>PEL</td><td class="num r-num">${eur(p.unit.pel)}</td><td class="num r-num">${p.pelCount}</td><td class="num r-num">${eur(p.unit.pel * p.pelCount)}</td></tr>`;
  } else {
    html += `<tr><td colspan="4" class="r-num" style="color:#636b64">Sem escalão</td></tr>`;
  }
  html += `<tr class="tfoot"><td>Total a receber</td><td class="r-num" colspan="2">—</td><td class="num r-num">${eur(p.gross)}</td></tr></tbody></table></section>`;

  // Regras aplicadas
  if (p.ruleEffects.length > 0) {
    html += `<section><div class="s-title">Regras aplicadas</div><table><thead><tr><th>Regra</th><th>Tipo</th><th class="r-num">Valor</th></tr></thead><tbody>`;
    for (const r of p.ruleEffects) {
      const tipo = r.type === "auto" ? "Automática" : r.type === "unlock" ? "Desbloqueio" : r.type === "vnc" ? "VNC" : "Manual";
      const cls = r.amount < 0 ? "t-neg" : "t-pos";
      html += `<tr><td>${esc(r.name)}</td><td style="color:#9aa39b">${tipo}</td><td class="num r-num ${cls}">${eur(r.amount)}</td></tr>`;
    }
    html += `</tbody></table></section>`;
  }

  // Penalidades VNC
  if (p.vncs.length > 0) {
    html += `<section><div class="s-title">Penalidades VNC</div><table><thead><tr><th>ID venda</th><th class="r-num">Penalidade</th></tr></thead><tbody>`;
    for (const v of p.vncs) {
      html += `<tr><td class="num">${esc(v.idVenda)}</td><td class="num r-num t-neg">${eur(-v.amount)}</td></tr>`;
    }
    html += `</tbody></table></section>`;
  }

  // Trocas de venda
  if (p.overridesOut.length > 0 || p.overridesIn.length > 0) {
    html += `<section><div class="s-title">Trocas de venda</div><table><thead><tr><th>ID venda</th><th>Direção</th><th>Comercial</th></tr></thead><tbody>`;
    for (const o of p.overridesOut) html += `<tr><td class="num">${esc(o.idVenda)}</td><td class="swap-out">Cedida →</td><td>${esc(o.toName)}</td></tr>`;
    for (const o of p.overridesIn) html += `<tr><td class="num">${esc(o.idVenda)}</td><td class="swap-in">← Recebida</td><td>${esc(o.fromName)}</td></tr>`;
    html += `</tbody></table></section>`;
  }

  // Vendas
  html += `<section><div class="s-title">Vendas (${p.lines.length} linha${p.lines.length === 1 ? "" : "s"})</div>
<table><thead><tr><th>ID venda</th><th>Serviço</th><th class="r-num">Base</th><th class="r-num">DD</th><th class="r-num">FE</th><th class="r-num">PEL</th><th class="r-num">Total</th></tr></thead><tbody>`;
  for (const l of p.lines) {
    html += `<tr><td class="num">${esc(l.idVenda)}</td><td>${l.service}</td><td class="num r-num">${l.base ? eur(l.base) : "—"}</td><td class="num r-num t-svc">${l.dd ? eur(l.dd) : "—"}</td><td class="num r-num t-svc">${l.fe ? eur(l.fe) : "—"}</td><td class="num r-num t-svc">${l.pel ? eur(l.pel) : "—"}</td><td class="num r-num" style="font-weight:600">${eur(l.total)}</td></tr>`;
  }
  const baseS = p.lines.reduce((s, l) => s + l.base, 0);
  const ddS = p.lines.reduce((s, l) => s + l.dd, 0);
  const feS = p.lines.reduce((s, l) => s + l.fe, 0);
  const pelS = p.lines.reduce((s, l) => s + l.pel, 0);
  const totalS = p.lines.reduce((s, l) => s + l.total, 0);
  html += `<tr class="tfoot"><td>Total</td><td class="r-num">—</td><td class="num r-num">${eur(baseS)}</td><td class="num r-num">${eur(ddS)}</td><td class="num r-num">${eur(feS)}</td><td class="num r-num">${eur(pelS)}</td><td class="num r-num">${eur(totalS)}</td></tr></tbody></table></section>`;

  // Chargback
  if (p.chargebackLines.length > 0) {
    html += `<section><div class="s-title">Chargback (${p.chargebackLines.length} linha${p.chargebackLines.length === 1 ? "" : "s"})</div>
<table><thead><tr><th>ID venda</th><th>Serviço</th><th class="r-num">Base</th><th class="r-num">DD</th><th class="r-num">FE</th><th class="r-num">PEL</th><th class="r-num">Total</th></tr></thead><tbody>`;
    for (const l of p.chargebackLines) {
      html += `<tr><td class="num">${esc(l.idVenda)}</td><td>${l.service}</td><td class="num r-num">${l.base ? eur(l.base) : "—"}</td><td class="num r-num t-svc">${l.dd ? eur(l.dd) : "—"}</td><td class="num r-num t-svc">${l.fe ? eur(l.fe) : "—"}</td><td class="num r-num t-svc">${l.pel ? eur(l.pel) : "—"}</td><td class="num r-num t-neg">${eur(l.total)}</td></tr>`;
    }
    const cbS = p.chargebackLines.reduce((s, l) => s + l.total, 0);
    html += `<tr class="tfoot"><td>Total</td><td class="r-num">—</td><td class="r-num" colspan="4">—</td><td class="num r-num t-neg">${eur(cbS)}</td></tr></tbody></table></section>`;
  }

  html += `<div class="footer"><span>GNAlmeida · Auto Iberdrola</span><span>Gerado em ${new Date().toLocaleDateString("pt-PT")}</span></div></body></html>`;

  // Escrever HTML e converter com Chrome headless
  const tmpDir = join(PUBLIC_DIR, "tmp");
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const htmlPath = join(tmpDir, `iberdrola-pdf-${ts}.html`);
  const pdfPath = join(tmpDir, `iberdrola-pdf-${ts}.pdf`);
  writeFileSync(htmlPath, html, "utf-8");

  try {
    execSync(
      `xvfb-run -a google-chrome --headless --disable-gpu --no-sandbox --hide-scrollbars --print-to-pdf="${pdfPath}" --no-pdf-header-footer --virtual-time-budget=10000 "file://${htmlPath}"`,
      { timeout: 30_000, encoding: "utf-8" },
    );
  } catch {
    try { unlinkSync(htmlPath); } catch { /* ignore */ }
    throw new Error("Erro ao converter para PDF.");
  }

  try { unlinkSync(htmlPath); } catch { /* ignore */ }

  const pdfBuf = readFileSync(pdfPath);
  try { unlinkSync(pdfPath); } catch { /* ignore */ }
  return pdfBuf;
}
