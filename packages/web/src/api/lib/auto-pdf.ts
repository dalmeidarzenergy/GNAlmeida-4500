import PDFDocument from "pdfkit";

export type PdfLine = {
  saleId: number;
  number: string;
  clientName: string | null;
  service: string;
  campaign: string | null;
  luz: number;
  gas: number;
  extras: number;
  penaltyHire: number;
  penaltyCampaign: number;
  total: number;
};

export type PdfPerson = {
  employeeId: number;
  employeeName: string;
  role: string;
  tableName: string | null;
  unit: number;
  bandSales: number;
  totalSales: number;
  luzCount: number;
  gasCount: number;
  pelQty: number;
  ddQty: number;
  feQty: number;
  extrasAmount: number;
  gross: number;
  chargeback: number;
  penaltyTiming: number;
  penaltyCampaign: number;
  kmDeduction: number;
  due: number;
  missingTable: boolean;
  lines: PdfLine[];
  chargebackLines: PdfLine[];
  notPaid: { number: string; service: string; status: string; value: number }[];
  transit: { number: string; service: string; status: string; signedOn: string | null; value: number }[];
  team: { name: string; luz: number; gas: number }[];
};

export type PdfBreakdown = {
  month: string;
  people: PdfPerson[];
};

const GREEN = "#1c5d4c";
const GREEN_SOFT = "#e3efea";
const INK = "#182320";
const MUTED = "#5c6b66";
const LINE = "#d5dedb";

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** 1234.5 -> "1234,50 €" */
export function eur(n: number) {
  const v = (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
  const [int, dec] = v.split(".");
  const parts: string[] = [];
  let rest = int.replace("-", "");
  while (rest.length > 3) {
    parts.unshift(rest.slice(-3));
    rest = rest.slice(0, -3);
  }
  parts.unshift(rest);
  const sign = n < 0 ? "-" : "";
  return `${sign}${parts.join(".")},${dec} €`;
}

function timeNow() {
  const dt = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()}`;
}

/** Nome do ficheiro fonte: "auto agosto.xlsx" para 2026-08. */
function sourceFile(month: string) {
  return `auto ${monthLong(month)}.xlsx`;
}

function monthLong(m: string) {
  const idx = Number(m.slice(5, 7)) - 1;
  return MONTHS[idx] ?? m;
}

const A4 = { w: 595.28, h: 841.89 };
const M = 34;
const CW = A4.w - M * 2;

/** Desenha uma faixa de título de secção e devolve o Y seguinte. */
function sectionTitle(doc: PDFKit.PDFDocument, label: string) {
  const y = doc.y;
  doc.rect(M, y, CW, 17).fill(GREEN);
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#ffffff");
  doc.text(label, M + 5, y + 5, { width: CW - 10, lineBreak: false });
  doc.fillColor(INK);
  doc.y = y + 21;
}

/** Tabela de linhas de venda. */
function salesTable(
  doc: PDFKit.PDFDocument,
  cols: { label: string; w: number; align?: "left" | "right" }[],
  rows: string[][],
  zebra = true,
) {
  const drawHead = () => {
    const y = doc.y;
    doc.rect(M, y, CW, 15).fill(GREEN_SOFT);
    let x = M + 4;
    doc.font("Helvetica-Bold").fontSize(7.6).fillColor(GREEN);
    for (const c of cols) {
      doc.text(c.label, x, y + 4, { width: c.w - 6, align: c.align ?? "left", lineBreak: false });
      x += c.w;
    }
    doc.fillColor(INK);
    doc.y = y + 15;
  };

  drawHead();
  rows.forEach((r, i) => {
    const h = 14;
    if (doc.y + h > A4.h - 60) {
      doc.addPage();
      drawHead();
    }
    const y = doc.y;
    if (zebra && i % 2 === 1) doc.rect(M, y, CW, h).fill("#f7faf9");
    let x = M + 4;
    doc.font("Helvetica").fontSize(7.8).fillColor(INK);
    for (let c = 0; c < cols.length; c++) {
      const col = cols[c];
      const isLast = c === cols.length - 1;
      doc.font(isLast ? "Helvetica-Bold" : "Helvetica");
      doc.text(r[c] ?? "", x, y + 3.5, { width: col.w - 6, align: col.align ?? "left", lineBreak: false, ellipsis: true });
      x += col.w;
    }
    doc.moveTo(M, y + h).lineTo(M + CW, y + h).lineWidth(0.4).strokeColor(LINE).stroke();
    doc.fillColor(INK);
    doc.y = y + h;
  });
}

/** Bloco de uma pessoa. */
function personBlock(doc: PDFKit.PDFDocument, p: PdfPerson, month: string) {
  doc.addPage();
  const m = month.split("-");

  doc.font("Helvetica-Bold").fontSize(14).fillColor(INK);
  doc.text(`Auto Iberdrola - ${p.employeeName}`, M, M, { width: CW });
  doc.font("Helvetica").fontSize(8).fillColor(MUTED);
  doc.text(
    `${p.role} | ${p.tableName ?? "tabela em falta"} | Ficheiro: ${sourceFile(month)} | ${timeNow()}`,
    M,
    doc.y + 1,
    { width: CW },
  );
  if (p.unit) {
    doc.font("Helvetica")
      .fontSize(7.4)
      .fillColor(MUTED)
      .text(`Escalão: ${eur(p.unit)} por venda luz/dual · Mês: ${m[1]}/${m[0]}`, M, doc.y + 1, { width: CW });
  }
  doc.moveDown(0.6);

  // ---- Resumo ----
  sectionTitle(doc, "Resumo");
  const rows: [string, string][] = [
    ["Total a pagar", eur(p.due)],
    ["Vendas a pagamento", `${p.totalSales} (${p.luzCount} luz, ${p.gasCount} gás)`],
    ["Extras", `${p.pelQty} PEL PLUS, ${p.ddQty} débito direto, ${p.feQty} FE (${eur(p.extrasAmount)})`],
    ["Total luz", eur(p.lines.reduce((s, l) => s + l.luz, 0))],
    ["Total gás", eur(p.lines.reduce((s, l) => s + l.gas, 0))],
    ["Subtotal sem descontos", eur(p.gross)],
    ["Chargeback a descontar", p.chargeback ? `-${eur(p.chargeback)}` : "-"],
    ["Penalização de timing", p.penaltyTiming ? `-${eur(p.penaltyTiming)}` : "-"],
    ["Penalização de campanha", p.penaltyCampaign ? `-${eur(p.penaltyCampaign)}` : "-"],
  ];
  for (let i = 0; i < rows.length; i++) {
    const y = doc.y;
    if (i % 2 === 1) doc.rect(M, y, CW, 15).fill("#f7faf9");
    doc.font("Helvetica").fontSize(8.2).fillColor(MUTED);
    doc.text(rows[i][0], M + 5, y + 4, { width: CW * 0.62, lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(8.2).fillColor(INK);
    doc.text(rows[i][1], M + CW * 0.62, y + 4, { width: CW * 0.38 - 5, align: "right", lineBreak: false });
    doc.y = y + 15;
  }
  doc.moveDown(0.9);

  // ---- Vendas a pagamento ----
  const cols = [
    { label: "Nº contrato", w: 68 },
    { label: "Tipo", w: 40 },
    { label: "Campanha", w: 90 },
    { label: "Luz", w: 56, align: "right" as const },
    { label: "Gás", w: 56, align: "right" as const },
    { label: "Extras", w: 60, align: "right" as const },
    { label: "Pen. contratação", w: 70, align: "right" as const },
    { label: "Penal. camp.", w: 60, align: "right" as const },
    { label: "Total", w: 57, align: "right" as const },
  ];
  sectionTitle(doc, "A pagamento (EM FORNECIMENTO)");
  const body = p.lines.map((l) => [
    l.number,
    l.service,
    l.campaign ?? "-",
    l.luz ? eur(l.luz) : "-",
    l.gas ? eur(l.gas) : "-",
    l.extras ? eur(l.extras) : "-",
    l.penaltyHire ? `-${eur(l.penaltyHire)}` : "-",
    l.penaltyCampaign ? `-${eur(l.penaltyCampaign)}` : "-",
    eur(l.total),
  ]);
  body.push([
    "Subtotal",
    "",
    "",
    eur(p.lines.reduce((s, l) => s + l.luz, 0)),
    eur(p.lines.reduce((s, l) => s + l.gas, 0)),
    eur(p.lines.reduce((s, l) => s + l.extras, 0)),
    p.lines.reduce((s, l) => s + l.penaltyHire, 0) ? `-${eur(p.lines.reduce((s, l) => s + l.penaltyHire, 0))}` : "-",
    p.lines.reduce((s, l) => s + l.penaltyCampaign, 0) ? `-${eur(p.lines.reduce((s, l) => s + l.penaltyCampaign, 0))}` : "-",
    eur(p.lines.reduce((s, l) => s + l.total, 0)),
  ]);
  salesTable(doc, cols, body, false);
  doc.moveDown(0.4);

  // Total a pagar em destaque
  const ty = doc.y;
  doc.rect(M, ty, CW, 18).fill(GREEN_SOFT);
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(GREEN);
  doc.text("Total a pagar", M + 5, ty + 5, { width: CW * 0.6, lineBreak: false });
  doc.text(eur(p.due), M + CW * 0.6, ty + 5, { width: CW * 0.4 - 5, align: "right", lineBreak: false });
  doc.fillColor(INK);
  doc.y = ty + 24;

  // ---- Chargeback ----
  if (p.chargebackLines.length) {
    doc.moveDown(0.4);
    sectionTitle(doc, "Chargeback (a descontar)");
    const cbCols = [
      { label: "Nº contrato", w: 120 },
      { label: "Tipo", w: 90 },
      { label: "Campanha", w: 160 },
      { label: "Valor a descontar", w: 157, align: "right" as const },
    ];
    salesTable(
      doc,
      cbCols,
      p.chargebackLines.map((l) => [l.number, l.service, l.campaign ?? "-", `-${eur(l.total)}`]),
    );
    doc.moveDown(0.4);
  }

  // ---- Vendas em trânsito ----
  if (p.transit.length) {
    doc.moveDown(0.3);
    sectionTitle(doc, "Vendas em trânsito (pré-venda a pedido de fornecimento)");
    const trCols = [
      { label: "Nº contrato", w: 140 },
      { label: "Tipo", w: 80 },
      { label: "Estado atual", w: 130 },
      { label: "Assinatura", w: 80 },
      { label: "Valor se passar", w: 97, align: "right" as const },
    ];
    salesTable(
      doc,
      trCols,
      p.transit.map((n) => [n.number, n.service, n.status, n.signedOn ? n.signedOn.slice(0, 7) : "-", n.value ? eur(n.value) : "-"]),
    );
    doc.moveDown(0.4);
  }

  // ---- Não vem a pagamento ----
  if (p.notPaid.length) {
    doc.moveDown(0.3);
    sectionTitle(doc, "Não vem a pagamento (estado diferente de EM FORNECIMENTO)");
    const npCols = [
      { label: "Nº contrato", w: 190 },
      { label: "Tipo", w: 100 },
      { label: "Estado", w: 100 },
      { label: "Valor indicativo se passar", w: 137, align: "right" as const },
    ];
    salesTable(
      doc,
      npCols,
      p.notPaid.map((n) => [n.number, n.service, n.status, n.value ? eur(n.value) : "-"]),
    );
    doc.moveDown(0.4);
  }

  // ---- Equipa (só chefes) ----
  if (p.team.length) {
    doc.moveDown(0.3);
    sectionTitle(doc, "Equipa (comissão de chefe)");
    const tCols = [
      { label: "Pessoa", w: 300 },
      { label: "Vendas luz", w: 125, align: "right" as const },
      { label: "Vendas gás", w: 102, align: "right" as const },
    ];
    const tRows = p.team.map((t) => [t.name, String(t.luz), String(t.gas)]);
    tRows.push([
      "Total da equipa",
      String(p.team.reduce((s, t) => s + t.luz, 0)),
      String(p.team.reduce((s, t) => s + t.gas, 0)),
    ]);
    salesTable(doc, tCols, tRows);
  }
}

/** Gera o PDF. `people` vazio -> auto de todos; senão, um auto por Comercial. */
export async function renderAutoPdf(b: PdfBreakdown, people: PdfPerson[]): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margins: { top: M, bottom: M, left: M, right: M }, autoFirstPage: true, bufferPages: true });
  doc.info.Title = `Auto Iberdrola ${b.month}`;
  doc.info.Author = "GNAlmeida CRM";

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  if (!people.length) {
    doc.font("Helvetica-Bold").fontSize(15).fillColor(INK);
    doc.text("Autos de Pagamento", { align: "center" });
    doc.font("Helvetica").fontSize(10).fillColor(MUTED);
    doc.text(`Sem valores a pagar em ${monthLong(b.month)} de ${b.month.slice(0, 4)}.`, { align: "center" });
    doc.end();
    return done;
  }

  for (const p of people) personBlock(doc, p, b.month);

  doc.end();
  return done;
}
