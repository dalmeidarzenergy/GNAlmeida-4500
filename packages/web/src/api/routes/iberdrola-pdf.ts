import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
  medemLines: { idVenda: string; pontos: number; commission: number; total: number }[];
  medemPontos: number;
  medemTotal: number;
};

const esc = (n: string) =>
  n.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const eur = (n: number) => (n < 0 ? "−" : "") + "€" + Math.abs(n).toFixed(2);

// --- Logos embutidos em base64 (não depende de rede nem de ficheiros no servidor) ---
const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), "assets");
let logoCache: { iberdrola: string; rzenergy: string } | null = null;
function logos() {
  if (logoCache) return logoCache;
  const read = (f: string) => {
    try {
      return "data:image/png;base64," + readFileSync(join(ASSETS_DIR, f)).toString("base64");
    } catch {
      return "";
    }
  };
  logoCache = { iberdrola: read("iberdrola-colaborador.png"), rzenergy: read("rzenergy.png") };
  return logoCache;
}

export function buildIberdrolaPdf(p: Person, m: string): Buffer {
  const monthLabel = `${m.slice(5)}/${m.slice(0, 4)}`;
  const L = logos();

  let html = `<!DOCTYPE html><html lang="pt"><head><meta charset="utf-8"><title>${esc(p.employeeName)} — Auto Iberdrola ${monthLabel}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=Poppins:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Poppins', sans-serif; font-size: 9pt; background: #ffffff; color: #1c2320; padding: 34px 40px 30px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .num { font-family: 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums; }

  /* ---- Cabecalho com os dois logotipos ---- */
  .head { display: flex; align-items: center; justify-content: space-between; gap: 20px;
          padding-bottom: 14px; border-bottom: 3px solid #6fbe45; margin-bottom: 22px; }
  .head .rz { height: 34px; }
  .head .iber { height: 40px; }
  .head .spacer { flex: 1; }

  h1 { font-family: 'Sora', sans-serif; font-size: 21pt; font-weight: 600; letter-spacing: -0.02em; color: #121715; margin-bottom: 2px; }
  h2 { font-family: 'Sora', sans-serif; font-size: 11pt; font-weight: 500; letter-spacing: -0.01em; margin-bottom: 20px; color: #5d6b62; }
  .meta { display: flex; gap: 10px; margin-bottom: 24px; color: #4c5850; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.08em; flex-wrap: wrap; }
  .meta span { background: #f2f6ef; border: 1px solid #dde6d8; border-radius: 8px; padding: 5px 12px; }

  .kpis { display: flex; gap: 10px; margin-bottom: 28px; flex-wrap: wrap; }
  .kpi { background: #f8faf7; border: 1px solid #e2e9dd; border-radius: 12px; padding: 13px 18px; min-width: 104px; }
  .kpi .label { font-size: 7pt; text-transform: uppercase; letter-spacing: 0.1em; color: #7a867e; margin-bottom: 4px; }
  .kpi .value { font-family: 'JetBrains Mono', monospace; font-size: 15pt; font-weight: 600; color: #121715; }
  .kpi .value.v { color: #3f8f1f; } .kpi .value.s { color: #0d7ea8; }

  section { margin-bottom: 20px; }
  .s-title { font-family: 'Sora', sans-serif; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.1em; color: #5d6b62; margin-bottom: 9px; border-bottom: 1px solid #e2e9dd; padding-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
  th { background: #f2f6ef; text-align: left; padding: 7px 10px; font-weight: 600; color: #4c5850; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid #dde6d8; }
  td { padding: 6px 10px; border-bottom: 1px solid #eef2ec; color: #1c2320; }
  .r-num { text-align: right; }
  .t-pos { color: #3f8f1f; font-weight: 600; } .t-neg { color: #c0392b; } .t-svc { color: #5d6b62; }
  .tfoot td { background: #f2f6ef; font-weight: 600; border-top: 1px solid #dde6d8; }
  .footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #e2e9dd; font-size: 7pt; color: #7a867e; display: flex; justify-content: space-between; }
  @page { size: A4; margin: 10mm; }
</style></head><body>
<div class="head">
  ${L.rzenergy ? `<img class="rz" src="${L.rzenergy}" alt="RZENERGY">` : `<span style="font-family:'Sora';font-weight:700;font-size:14pt">RZENERGY</span>`}
  <div class="spacer"></div>
  ${L.iberdrola ? `<img class="iber" src="${L.iberdrola}" alt="Iberdrola - Colaborador Oficial">` : ""}
</div>
<h1>${esc(p.employeeName)}</h1>
<h2>${esc(p.tableName ?? "Sem tabela comisional")} &nbsp;·&nbsp; ${monthLabel}</h2>
<div class="meta">
  <span>Nº de Venda para Escalão: ${p.bandSales}</span>
  <span>${p.salesCount} vendas</span>
  <span>${p.luzCount} luz / ${p.gasCount} gás</span>
</div>
<div class="kpis">
  <div class="kpi"><div class="label">Bruto</div><div class="value v">${eur(p.gross)}</div></div>
  <div class="kpi"><div class="label">Chargeback</div><div class="value t-neg">${eur(p.chargeback)}</div></div>
  <div class="kpi"><div class="label">A Pagar</div><div class="value s">${eur(p.due)}</div></div>
  <div class="kpi"><div class="label">Luz + Gás</div><div class="value">${eur(p.baseAmount)}</div></div>
  <div class="kpi"><div class="label">Serviços</div><div class="value">${eur(p.svcAmount)}</div></div>
  <div class="kpi"><div class="label">DD / FE / PEL</div><div class="value" style="font-size:12pt">${p.ddCount} / ${p.feCount} / ${p.pelCount}</div></div>
</div>`;

  html += `<section><div class="s-title">Nº de Venda para Escalão</div><table><thead><tr><th>Item</th><th class="r-num">Valor unitário</th><th class="r-num">Qtd</th><th class="r-num">Total</th></tr></thead><tbody>`;
  if (p.unit) {
    html += `<tr><td>Luz</td><td class="num r-num">${eur(p.unit.luz)}</td><td class="num r-num">${p.luzCount}</td><td class="num r-num">${eur(p.unit.luz * p.luzCount)}</td></tr>`;
    html += `<tr><td>Gás</td><td class="num r-num">${eur(p.unit.gas)}</td><td class="num r-num">${p.gasCount}</td><td class="num r-num">${eur(p.unit.gas * p.gasCount)}</td></tr>`;
    if (p.ddCount > 0) html += `<tr><td>Débito Direto</td><td class="num r-num">${eur(p.unit.dd)}</td><td class="num r-num">${p.ddCount}</td><td class="num r-num">${eur(p.unit.dd * p.ddCount)}</td></tr>`;
    if (p.feCount > 0) html += `<tr><td>Fatura Eletrónica</td><td class="num r-num">${eur(p.unit.fe)}</td><td class="num r-num">${p.feCount}</td><td class="num r-num">${eur(p.unit.fe * p.feCount)}</td></tr>`;
    if (p.pelCount > 0) html += `<tr><td>PEL</td><td class="num r-num">${eur(p.unit.pel)}</td><td class="num r-num">${p.pelCount}</td><td class="num r-num">${eur(p.unit.pel * p.pelCount)}</td></tr>`;
  } else {
    html += `<tr><td colspan="4" class="r-num" style="color:#7a867e">Sem escalão</td></tr>`;
  }
  html += `<tr class="tfoot"><td>Total a receber</td><td class="r-num" colspan="2">—</td><td class="num r-num">${eur(p.gross)}</td></tr></tbody></table></section>`;

  // Regras aplicadas
  if (p.ruleEffects.length > 0) {
    html += `<section><div class="s-title">Regras aplicadas</div><table><thead><tr><th>Regra</th><th>Tipo</th><th class="r-num">Valor</th></tr></thead><tbody>`;
    for (const r of p.ruleEffects) {
      const tipo = r.type === "auto" ? "Automática" : r.type === "unlock" ? "Desbloqueio" : r.type === "vnc" ? "VNC" : "Manual";
      const cls = r.amount < 0 ? "t-neg" : "t-pos";
      html += `<tr><td>${esc(r.name)}</td><td style="color:#5d6b62">${tipo}</td><td class="num r-num ${cls}">${eur(r.amount)}</td></tr>`;
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

  // Vendas
  html += `<section><div class="s-title">Vendas (${p.lines.length} linha${p.lines.length === 1 ? "" : "s"})</div>
<table><thead><tr><th>ID venda</th><th>Serviço</th><th class="r-num">Luz + Gás</th><th class="r-num">DD</th><th class="r-num">FE</th><th class="r-num">PEL</th><th class="r-num">Total</th></tr></thead><tbody>`;
  for (const l of p.lines) {
    html += `<tr><td class="num">${esc(l.idVenda)}</td><td>${l.service}</td><td class="num r-num">${l.base ? eur(l.base) : "—"}</td><td class="num r-num t-svc">${l.dd ? eur(l.dd) : "—"}</td><td class="num r-num t-svc">${l.fe ? eur(l.fe) : "—"}</td><td class="num r-num t-svc">${l.pel ? eur(l.pel) : "—"}</td><td class="num r-num" style="font-weight:600">${eur(l.total)}</td></tr>`;
  }
  const baseS = p.lines.reduce((s, l) => s + l.base, 0);
  const ddS = p.lines.reduce((s, l) => s + l.dd, 0);
  const feS = p.lines.reduce((s, l) => s + l.fe, 0);
  const pelS = p.lines.reduce((s, l) => s + l.pel, 0);
  const totalS = p.lines.reduce((s, l) => s + l.total, 0);
  html += `<tr class="tfoot"><td>Total</td><td class="r-num">—</td><td class="num r-num">${eur(baseS)}</td><td class="num r-num">${eur(ddS)}</td><td class="num r-num">${eur(feS)}</td><td class="num r-num">${eur(pelS)}</td><td class="num r-num">${eur(totalS)}</td></tr></tbody></table></section>`;

  // Medem
  if (p.medemLines && p.medemLines.length > 0) {
    html += `<section><div class="s-title">Medem — ${p.medemPontos} pontos · ${eur(p.medemTotal)} (${p.medemLines.length} linha${p.medemLines.length === 1 ? "" : "s"})</div>
<table><thead><tr><th>ID venda</th><th class="r-num">Pontos</th><th class="r-num">Comissão (€/pto)</th><th class="r-num">Total</th></tr></thead><tbody>`;
    for (const l of p.medemLines) {
      html += `<tr><td class="num">${esc(l.idVenda)}</td><td class="num r-num">${l.pontos}</td><td class="num r-num t-svc">${eur(l.commission)}</td><td class="num r-num" style="font-weight:600">${eur(l.total)}</td></tr>`;
    }
    html += `<tr class="tfoot"><td>Total</td><td class="num r-num">${p.medemPontos}</td><td class="r-num">—</td><td class="num r-num">${eur(p.medemTotal)}</td></tr></tbody></table></section>`;
  }

  // Chargeback
  if (p.chargebackLines.length > 0) {
    html += `<section><div class="s-title">Chargeback (${p.chargebackLines.length} linha${p.chargebackLines.length === 1 ? "" : "s"})</div>
<table><thead><tr><th>ID venda</th><th>Serviço</th><th class="r-num">Luz + Gás</th><th class="r-num">DD</th><th class="r-num">FE</th><th class="r-num">PEL</th><th class="r-num">Total</th></tr></thead><tbody>`;
    for (const l of p.chargebackLines) {
      html += `<tr><td class="num">${esc(l.idVenda)}</td><td>${l.service}</td><td class="num r-num">${l.base ? eur(l.base) : "—"}</td><td class="num r-num t-svc">${l.dd ? eur(l.dd) : "—"}</td><td class="num r-num t-svc">${l.fe ? eur(l.fe) : "—"}</td><td class="num r-num t-svc">${l.pel ? eur(l.pel) : "—"}</td><td class="num r-num t-neg">${eur(l.total)}</td></tr>`;
    }
    const cbS = p.chargebackLines.reduce((s, l) => s + l.total, 0);
    html += `<tr class="tfoot"><td>Total</td><td class="r-num">—</td><td class="r-num" colspan="4">—</td><td class="num r-num t-neg">${eur(cbS)}</td></tr></tbody></table></section>`;
  }

  html += `<div class="footer"><span>RZENERGY · Colaborador Oficial Iberdrola · Auto Iberdrola</span><span>Gerado em ${new Date().toLocaleDateString("pt-PT")}</span></div></body></html>`;

  // Escrever HTML e converter com Chrome headless
  const tmpDir = join(PUBLIC_DIR, "tmp");
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const htmlPath = join(tmpDir, `iberdrola-pdf-${ts}.html`);
  const pdfPath = join(tmpDir, `iberdrola-pdf-${ts}.pdf`);
  writeFileSync(htmlPath, html, "utf-8");

  // Chrome headless "novo" não precisa de X server. Tenta primeiro sem xvfb-run;
  // se o binário não existir, testa chrome/chromium. Nunca exige xvfb (não instalado no WSL).
  const candidates = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"];
  let lastErr: unknown = null;
  let ok = false;

  for (const bin of candidates) {
    const cmd = `${bin} --headless --disable-gpu --no-sandbox --hide-scrollbars --run-all-compositor-stages-before-draw --print-to-pdf="${pdfPath}" --no-pdf-header-footer --virtual-time-budget=10000 "file://${htmlPath}"`;
    try {
      execSync(cmd, { timeout: 30_000, encoding: "utf-8", stdio: "pipe" });
      if (existsSync(pdfPath) && readFileSync(pdfPath).length > 0) {
        ok = true;
        break;
      }
    } catch (e) {
      lastErr = e;
    }
  }

  if (!ok) {
    try { unlinkSync(htmlPath); } catch { /* ignore */ }
    throw new Error(`Erro ao converter para PDF (Chrome indisponível). ${lastErr instanceof Error ? lastErr.message : ""}`);
  }

  try { unlinkSync(htmlPath); } catch { /* ignore */ }

  const pdfBuf = readFileSync(pdfPath);
  try { unlinkSync(pdfPath); } catch { /* ignore */ }
  return pdfBuf;
}
