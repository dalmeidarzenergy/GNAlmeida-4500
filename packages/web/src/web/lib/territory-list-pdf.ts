import { jsPDF } from "jspdf";
import { fullRestMonths, TERRITORY_ROUTE_ORIGIN, type Territory } from "../../api/shared/territories";
import type { TerritoryFilters } from "./territory-filters";

const integer = new Intl.NumberFormat("pt-PT");
const decimal = new Intl.NumberFormat("pt-PT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat("pt-PT", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const month = new Intl.DateTimeFormat("pt-PT", { month: "long", timeZone: "UTC" });
const dash = "—";
const date = (iso: string) => iso.split("-").reverse().join("/");
const monthName = (m: string) => month.format(new Date(`2020-${m}-01T00:00:00Z`));
const num = (n: number | null) => n === null ? dash : integer.format(n);
const ink = "#132F37", teal = "#125568", muted = "#48616B", rule = "#CDDDE0";
const left = 14, right = 283, width = right - left;

function filterSummary(f: TerritoryFilters, canViewContracts: boolean) {
  const labels: string[] = [];
  const range = (min: string, max: string, format = (s: string) => s) => [min && `de ${format(min)}`, max && `até ${format(max)}`].filter(Boolean).join(" ");
  if (f.query.trim()) labels.push(`Pesquisa: «${f.query.trim()}»`);
  if (f.district) labels.push(`Distrito: ${f.district}`);
  if (f.municipality) labels.push(`Concelho: ${f.municipality}`);
  if (f.sweep === "missing") labels.push("Varrimento: sem data");
  if (f.sweep === "month") labels.push(`Varrimento: ${f.month ? monthName(f.month) : "todos os meses com data"}`);
  if (f.sweep === "range") labels.push(`Varrimento: ${range(f.from, f.to, date) || "com data"}`);
  if (f.restMin || f.restMax) labels.push(`Descanso (meses): ${range(f.restMin, f.restMax)}`);
  if (canViewContracts && (f.contractsMin || f.contractsMax)) labels.push(`Contratos: ${range(f.contractsMin, f.contractsMax)}`);
  if (f.distance === "no_route") labels.push("Distância: sem rota");
  if (f.distance === "range") labels.push(`Distância: ${range(f.kmMin, f.kmMax, (v) => `${decimal.format(Number(v))} km`) || "com rota"}`);
  return labels.length ? labels.join("  ·  ") : "Sem filtros ativos";
}

type ExportData = { rows: readonly Territory[]; filters: TerritoryFilters; canViewContracts: boolean; today: string };
type Column = { title: string; width: number; value: (row: Territory) => string; numeric?: boolean };

export function createTerritoryListPdf({ rows, filters, canViewContracts, today }: ExportData) {
  const doc = new jsPDF({ orientation: "landscape", format: "a4", unit: "mm", compress: true });
  doc.setProperties({ title: "Gestão de Territórios · Resultados da lista", author: "RZ Energy" });
  const years = [...new Set(rows.flatMap(({ populationYear }) => populationYear === null ? [] : [populationYear]))].sort((a, b) => a - b);
  const columns: Column[] = [
    { title: "Distrito", width: canViewContracts ? 32 : 48, value: (r) => r.district || dash },
    { title: "Concelho", width: canViewContracts ? 48 : 64, value: (r) => r.municipality || dash },
    { title: "Último varrimento", width: 31, value: (r) => r.lastSweep ? date(r.lastSweep) : dash },
    { title: "Mês do varrimento", width: 30, value: (r) => r.lastSweep ? monthName(r.lastSweep.slice(5, 7)) : dash },
  ];
  if (canViewContracts) columns.push({ title: "N.º contratos", width: 22, numeric: true, value: (r) => num(r.contracts) });
  columns.push(
    { title: "Descanso (meses)", width: 28, numeric: true, value: (r) => num(fullRestMonths(r.lastSweep, today)) },
    { title: "Distância", width: canViewContracts ? 24 : 28, numeric: true, value: (r) => r.distance.status === "ok"
      ? `${decimal.format(r.distance.meters / 1000)} km` : r.distance.status === "no_route" ? "Sem rota" : "Não encontrado" },
    { title: "População residente", width: canViewContracts ? 28 : 40, numeric: true, value: (r) => r.population === null ? dash
      : years.length > 1 && r.populationYear !== null ? `${num(r.population)} (${r.populationYear})` : num(r.population) },
  );
  if (canViewContracts) columns.push({ title: "Penetração", width: 26, numeric: true, value: (r) => r.penetrationRate === null ? dash : percent.format(r.penetrationRate) });
  const summary = `Filtros: ${filterSummary(filters, canViewContracts)}`;
  const count = `${num(rows.length)} ${rows.length === 1 ? "concelho" : "concelhos"}`;

  const font = (size: number, color: string, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(color);
  };
  let y = 0;
  function page(first: boolean) {
    if (!first) doc.addPage();
    doc.setFillColor(teal); doc.rect(0, 0, 297, 3, "F");
    font(8, teal, true); doc.text("RZ ENERGY  /  GESTÃO TERRITORIAL", left, 13);
    doc.text(`${count}  ·  ${date(today)}`, right, 13, { align: "right" });
    font(first ? 23 : 16, ink, true); doc.text("Gestão de Territórios", left, first ? 28 : 24);
    y = first ? 36 : 30;
    if (first) {
      font(9, muted);
      const lines: string[] = doc.splitTextToSize(summary, width);
      doc.text(lines, left, y, { lineHeightFactor: 1.2 });
      y += lines.length * 3.9 + 2;
    }
    doc.setFillColor(teal); doc.rect(left, y, width, 8, "F");
    font(8, "#FFFFFF", true);
    let x = left;
    for (const col of columns) {
      doc.text(col.title, col.numeric ? x + col.width - 2.5 : x + 2.5, y + 5.1, { align: col.numeric ? "right" : "left" });
      x += col.width;
    }
    y += 8;
  }
  page(true);
  rows.forEach((row, index) => {
    font(9, ink);
    const cells = columns.map((col) => doc.splitTextToSize(col.value(row), col.width - 5) as string[]);
    const height = Math.max(7.2, Math.max(...cells.map((cell) => cell.length)) * 3.75 + 3);
    if (y + height > 184) page(false);
    if (index % 2 === 1) { doc.setFillColor("#F0F6F7"); doc.rect(left, y, width, height, "F"); }
    font(9, ink);
    let x = left;
    columns.forEach((col, i) => {
      doc.text(cells[i], col.numeric ? x + col.width - 2.5 : x + 2.5, y + 4.7, { align: col.numeric ? "right" : "left", lineHeightFactor: 1.15 });
      x += col.width;
    });
    y += height;
    doc.setDrawColor(rule); doc.setLineWidth(0.15); doc.line(left, y, right, y);
  });

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(rule); doc.setLineWidth(0.25); doc.line(left, 189, right, 189);
    font(7.5, muted);
    doc.text(`Distâncias de ida até à sede desde ${TERRITORY_ROUTE_ORIGIN} (DGT / CAOP e OpenStreetMap).`, left, 194);
    const census = years.length ? `População: estimativas do INE (${years.join(", ")}).` : "População: estimativas do INE.";
    doc.text(`${census}${canViewContracts ? " Penetração: contratos em fornecimento ÷ população residente." : ""}`, left, 199);
    doc.text(`${i} / ${totalPages}`, right, 199, { align: "right" });
  }
  return doc;
}

export function downloadTerritoryListPdf(data: ExportData) {
  createTerritoryListPdf(data).save(`territorios-${data.today}.pdf`);
}