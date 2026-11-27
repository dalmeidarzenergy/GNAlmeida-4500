import { calculatePlan, formatPlanMoney as money, formatPlanNumber as number, isPlanLoss, parseAmount, planFields, planSummary, type MonthlyPlan } from "./plano-mensal";

const BLUE = "#1B5F7E";
const TINT = "#DCECF5";
const INK = "#182A36";
const MUTED = "#4C626F";
const profitColor = (amount: number) => isPlanLoss(amount) ? "#A1232C" : "#176343";
const pdfText = (text: string) => text.replace(/\s+/g, " ").trim();

async function loadLogo(path: string) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Não foi possível carregar ${path}`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function exportPlanPdf(plan: MonthlyPlan) {
  const [{ jsPDF }, rzLogo, iberdrolaLogo] = await Promise.all([
    import("jspdf"),
    loadLogo("/logos/rzenergy.png"),
    loadLogo("/logos/iberdrola-colaborador.png"),
  ]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", lineHeight: 1.2 });
  const margin = 14;
  const right = doc.internal.pageSize.getWidth() - margin;
  const width = right - margin;
  const bottom = doc.internal.pageSize.getHeight() - margin - 7;
  const columns = [width - 222, 22, 25, 24, 29, 34, 32, 28, 28];
  const data = calculatePlan(plan);
  const logos = [
    { image: iberdrolaLogo, alias: "iberdrola", width: 53 },
    { image: rzLogo, alias: "rzenergy", width: 39 },
  ].map((logo) => {
    const size = doc.getImageProperties(logo.image);
    return { ...logo, height: logo.width * size.height / size.width };
  });
  let y = margin;

  doc.setProperties({ title: "Plano Mensal", subject: "Simulação de vendas, comissões e lucro D2D" });

  function pageHeader(continued = false) {
    let x = right;
    for (const logo of logos) {
      x -= logo.width;
      doc.addImage(logo.image, "PNG", x, y + 8.5 - logo.height / 2, logo.width, logo.height, logo.alias, "FAST");
      x -= 8;
    }
    doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(BLUE);
    doc.text("GESTÃO DE EMPRESA", margin, y + 3);
    doc.setFontSize(continued ? 17 : 23).setTextColor(INK);
    doc.text("Plano Mensal", margin, y + (continued ? 12 : 15));
    y += continued ? 19 : 20;
    if (!continued) {
      doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(MUTED);
      doc.text("Simulação de vendas, comissões e lucro da equipa D2D", margin, y + 2);
      y += 12;
    }
  }

  function newPage() {
    doc.addPage();
    y = margin;
    pageHeader(true);
  }

  function tableHeader() {
    doc.setFont("helvetica", "bold").setFontSize(8).setTextColor("#FFFFFF");
    doc.setFillColor(BLUE).rect(margin, y, width, 12, "F");
    let x = margin;
    planFields.forEach(([, label], i) => {
      const lines: string[] = doc.splitTextToSize(label, columns[i] - 6);
      doc.text(lines, i === 0 ? x + 3 : x + columns[i] - 3, y + (lines.length === 1 ? 7 : 5.5), { align: i === 0 ? "left" : "right" });
      x += columns[i];
    });
    y += 12;
  }

  function tableRow(values: string[], { total = false, shaded = false, profit }: { total?: boolean; shaded?: boolean; profit?: number } = {}) {
    doc.setFont("helvetica", total ? "bold" : "normal").setFontSize(9);
    const cells: string[][] = values.map((value, i) => doc.splitTextToSize(pdfText(value), columns[i] - 6));
    const height = 5 + Math.max(1, ...cells.map((lines) => lines.length)) * 4;
    if (y + height > bottom) {
      newPage();
      tableHeader();
      doc.setFont("helvetica", total ? "bold" : "normal").setFontSize(9);
    }
    if (total || shaded) doc.setFillColor(total ? TINT : "#F4F8FA").rect(margin, y, width, height, "F");
    let x = margin;
    cells.forEach((lines, i) => {
      doc.setTextColor(i === 8 && profit !== undefined ? profitColor(profit) : INK);
      if (lines.length) doc.text(lines, i === 0 ? x + 3 : x + columns[i] - 3, y + 5.6, { align: i === 0 ? "left" : "right" });
      x += columns[i];
    });
    y += height;
  }

  pageHeader();
  tableHeader();
  plan.rows.forEach((row, i) => {
    const { daily, sales, commission, payout, d2d, revenue, profit } = data.rows[i];
    tableRow([row.name.trim() || `Colaborador ${i + 1}`, number(parseAmount(row.days)), number(daily), number(sales), money(commission), money(payout), money(d2d), money(revenue), money(profit)], { shaded: i % 2 === 1, profit });
  });
  if (!plan.rows.length) tableRow(["Sem colaboradores"]);
  const { daily, sales, commission, payout, d2d, revenue, profit } = data.totals;
  tableRow(["TOTAL", "", number(daily), number(sales), money(commission), money(payout), money(d2d), money(revenue), money(profit)], { total: true, profit });

  const summary = planSummary(data, plan.deductVat);
  const gap = 6;
  const cardWidth = (width - 3 * gap) / 4;
  doc.setFont("helvetica", "bold").setFontSize(13);
  const values: string[][] = summary.map(({ value }) => doc.splitTextToSize(pdfText(value), cardWidth - 8));
  const cardHeights = [0, 4].map((start) => 15 + Math.max(...values.slice(start, start + 4).map((lines) => lines.length)) * 5.5);
  if (y + 19 + gap + cardHeights[0] + cardHeights[1] > bottom) newPage();
  else y += 9;
  doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(INK);
  doc.text("Resumo mensal", margin, y + 5);
  y += 10;

  summary.forEach(({ label, result }, i) => {
    const x = margin + (i % 4) * (cardWidth + gap);
    const top = y + (i >= 4 ? cardHeights[0] + gap : 0);
    doc.setFillColor(result === undefined ? "#F4F8FA" : TINT).rect(x, top, cardWidth, cardHeights[Math.floor(i / 4)], "F");
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(MUTED);
    doc.text(pdfText(label), x + 4, top + 6);
    doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(result === undefined ? INK : profitColor(result));
    doc.text(values[i], x + 4, top + 14);
  });

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setDrawColor(TINT).line(margin, bottom + 3, right, bottom + 3);
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(MUTED);
    doc.text("RZ Energy · Plano Mensal", margin, bottom + 8);
    doc.text(`${page} / ${pages}`, right, bottom + 8, { align: "right" });
  }

  await doc.save("plano-mensal.pdf", { returnPromise: true });
}