import { jsPDF } from "jspdf";
import type { TerritoryReport } from "../../api/lib/territory-report";
import { TERRITORY_ROUTE_ORIGIN, territoryToday } from "../../api/shared/territories";

const integer = new Intl.NumberFormat("pt-PT");
const percent = new Intl.NumberFormat("pt-PT", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const km = new Intl.NumberFormat("pt-PT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dash = "—";
const num = (n: number | null) => n === null ? dash : integer.format(n);
const pct = (n: number | null) => n === null ? dash : percent.format(n);
const dist = (n: number | null) => n === null ? dash : `${km.format(n / 1000)} km`;
const date = (s: string | null) => s ? s.split("-").reverse().join("/") : dash;
const ink = "#132F37", teal = "#125568", muted = "#48616B", light = "#E8F1F3", rule = "#CDDDE0";
const white = "#FFFFFF", width = 178, left = 16, bottom = 271;
const populationSource = "https://www.ine.pt/xurl/indx/0012918";

async function coatOfArms(code: string) {
  try {
    const res = await fetch(`/territory-arms/${code}.webp`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const img = await createImageBitmap(await res.blob());
    const canvas = document.createElement("canvas");
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) { img.close(); return null; }
    ctx.drawImage(img, 0, 0); img.close();
    return { data: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
  } catch { return null; }
}

type DataRow = { cells: string[]; strong?: boolean };

export function createTerritoryPdf(report: TerritoryReport, arms: Awaited<ReturnType<typeof coatOfArms>>, generated = territoryToday()) {
  const doc = new jsPDF({ orientation: "portrait", format: "a4", unit: "mm", compress: true });
  doc.setProperties({ title: `Ficha territorial · ${report.municipality}`, subject: "Gestão de Territórios", author: "RZ Energy" });
  const mapNums = new Map(report.parishes.map(({ code }, index) => [code, index + 1]));
  let y = 0;
  function font(size: number, color = ink, style = "normal") {
    doc.setFont("helvetica", style); doc.setFontSize(size); doc.setTextColor(color);
  }
  function caption(text: string, x: number, at: number) { font(8, muted, "bold"); doc.text(text, x, at); }
  function wrapped(text: string, max: number): string[] { return doc.splitTextToSize(text, max); }
  function textBlock(text: string, size = 9, color = muted) {
    font(size, color);
    const lines = wrapped(text, width);
    doc.text(lines, left, y);
    y += lines.length * size * 0.43 + 3;
  }
  function link(label: string, url: string, x: number, at: number, align: "left" | "center" = "left") {
    font(8, teal, "bold"); doc.textWithLink(label, x, at, { url, align });
  }
  function footnotes(kicker: string, notes: string[]) {
    font(8, muted);
    const height = notes.reduce((h, note) => h + wrapped(note, width).length * 8 * 0.43 + 3, 0);
    if (y + height > 276) page(kicker);
    for (const note of notes) textBlock(note, 8);
  }
  function page(kicker: string) {
    if (y) doc.addPage();
    doc.setFillColor(teal); doc.rect(0, 0, 210, 4, "F");
    caption("RZ ENERGY  /  GESTÃO TERRITORIAL", left, 14);
    font(8, muted); doc.text(kicker, 194, 14, { align: "right" });
    y = 29;
  }
  function section(title: string, note: string, headers: string[], widths: number[], rows: DataRow[], leftAligned = [0]) {
    function head(continued: boolean) {
      font(19, ink, "bold"); doc.text(title, left, y);
      y += 7;
      textBlock(continued ? `Continuação  ·  ${report.municipality}` : note);
      font(8, white, "bold");
      doc.setFillColor(teal); doc.rect(left, y - 0.8, width, 8, "F");
      let x = left;
      headers.forEach((header, i) => {
        const isLeft = leftAligned.includes(i);
        doc.text(header, isLeft ? x + 2 : x + widths[i] - 2, y + 4.5, { align: isLeft ? "left" : "right" });
        x += widths[i];
      });
      y += 7.2;
    }
    head(false);
    rows.forEach(({ cells, strong }, index) => {
      font(8.4, ink, strong ? "bold" : "normal");
      const columns = cells.map((value, i) => wrapped(value, widths[i] - 4));
      // A localidade pode ocupar várias linhas. Quando necessário, divide só essa célula.
      let offset = 0;
      const lines = Math.max(...columns.map((c) => c.length));
      while (offset < lines) {
        if (y + Math.min(lines - offset, 4) * 3.7 + 3.5 > bottom) { page(kicker); head(true); }
        font(8.4, ink, strong ? "bold" : "normal");
        const count = Math.min(lines - offset, Math.floor((bottom - y - 3.5) / 3.7));
        const h = count * 3.7 + 3.5;
        if (strong || index % 2 === 1) { doc.setFillColor(strong ? "#D8E9EC" : "#F3F7F8"); doc.rect(left, y, width, h, "F"); }
        let x = left;
        columns.forEach((column, i) => {
          const frag = column.slice(offset, offset + count);
          const isLeft = leftAligned.includes(i);
          if (frag.length) doc.text(frag, isLeft ? x + 2 : x + widths[i] - 2, y + 4.6, { align: isLeft ? "left" : "right", lineHeightFactor: 1.25 });
          x += widths[i];
        });
        doc.setDrawColor(rule); doc.setLineWidth(0.16); doc.line(left, y + h, 194, y + h);
        y += h; offset += count;
      }
    });
    y += 7;
  }
  let kicker = "01  /  ENQUADRAMENTO";
  page(kicker);
  font(28, ink, "bold"); doc.text(wrapped(report.municipality, 135), left, 36);
  const location = report.code.startsWith("3") || report.code.startsWith("4")
    ? `Ilha: ${report.districtOrIsland.replace(/^Ilha\s+/i, "")}` : `Distrito: ${report.districtOrIsland}`;
  font(10, muted); doc.text(`${report.code}  ·  ${location}`, left, 52);
  font(9, muted); doc.text(`Província histórica: ${report.province ?? dash}`, left, 58);
  if (arms) {
    const scale = 27 / Math.max(arms.width, arms.height);
    doc.addImage(arms.data, "PNG", 178 - arms.width * scale / 2, 23, arms.width * scale, arms.height * scale);
    if (report.arms) link("Brasão · ficha Commons", `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(report.arms.file)}`, 178, 55, "center");
  } else {
    font(8, muted); doc.text(["Brasão", "não disponível"], 178, 36, { align: "center" });
  }
  doc.setFillColor(light); doc.rect(left, 62, width, 25, "F");
  const metrics = [
    [report.populationYear ? `RESIDENTES EM ${report.populationYear}` : "RESIDENTES", num(report.population)],
    ["FREGUESIAS · CAOP 2025", `${report.parishes.length}`], ["DISTÂNCIA À SEDE", dist(report.meters)],
  ];
  metrics.forEach(([label, value], i) => {
    const x = left + 5 + i * 59;
    caption(label, x, 70); font(17, teal, "bold"); doc.text(value, x, 81);
  });
  caption("REGIÃO E SUB-REGIÃO ESTATÍSTICAS", left, 96);
  font(10); doc.text(`${report.nuts2}${report.nuts3 && report.nuts2 !== report.nuts3 ? `  /  ${report.nuts3}` : ""}`, left, 102);
  caption("ÚLTIMO VARRIMENTO", 151, 96);
  font(10); doc.text(date(report.lastSweep), 151, 102);

  caption("LIMITES E DIVISÃO ADMINISTRATIVA", left, 115);
  doc.setDrawColor(rule); doc.setFillColor("#F6F9FA"); doc.rect(left, 119, width, 128, "FD");
  const coords = report.parishes.flatMap((p) => p.rings.flat());
  // As coordenadas do catálogo têm a mesma escala nos dois eixos.
  const xmax = Math.max(1, ...coords.filter((_, i) => i % 2 === 0));
  const ymax = Math.max(1, ...coords.filter((_, i) => i % 2 === 1));
  const scale = Math.min(154 / xmax, 108 / ymax);
  const x0 = 105 - xmax * scale / 2, y0 = 183 - ymax * scale / 2;
  const fills = ["#C0DDE3", "#D5E8EB", "#ABCED7", "#E1ECEE", "#9CBDC8"];
  for (const [i, parish] of report.parishes.entries()) {
    doc.setFillColor(fills[i % fills.length]); doc.setDrawColor(teal); doc.setLineWidth(0.22);
    for (const ring of parish.rings) {
      doc.moveTo(x0 + ring[0] * scale, y0 + ring[1] * scale);
      for (let j = 2; j < ring.length; j += 2) doc.lineTo(x0 + ring[j] * scale, y0 + ring[j + 1] * scale);
      doc.close();
    }
    if (parish.rings.length) doc.fillStrokeEvenOdd();
  }
  const used: [number, number][] = [];
  const fontSize = report.parishes.length > 40 ? 5.5 : 7;
  const radius = report.parishes.length > 40 ? 2.15 : 2.55;
  for (const parish of report.parishes) {
    const x = x0 + parish.label[0] * scale, yy = y0 + parish.label[1] * scale;
    let dot: [number, number] = [x, yy];
    const fits = (a: number, b: number) => a >= 20 && a <= 190 && b >= 123 && b <= 243 && used.every(([c, d]) => Math.hypot(c-a, d-b) > 2 * radius + 0.45);
    if (!fits(x, yy)) {
      find: for (let r = 3; r <= 135; r += 2) {
        for (let k = 0; k < 16; k++) {
          const a = x + r * Math.cos(k * Math.PI / 8), b = yy + r * Math.sin(k * Math.PI / 8);
          if (fits(a, b)) { dot = [a, b]; break find; }
        }
      }
      doc.setDrawColor(muted); doc.setLineWidth(0.2); doc.line(x, yy, ...dot);
    }
    used.push(dot);
    doc.setFillColor(teal); doc.circle(...dot, radius, "F");
    font(fontSize, white, "bold"); doc.text(String(mapNums.get(parish.code)), dot[0], dot[1] + 0.78, { align: "center" });
  }
  y = 253;
  textBlock("Os números do mapa identificam as freguesias da tabela de localidades. Norte para cima; limites simplificados da CAOP 2025, DGT (CC BY 4.0).", 8);
  link("Fonte cartográfica: DGT / CAOP", "https://www.dgterritorio.gov.pt/cartografia/cartografia-tematica/caop", left, y);
  link("Estimativa municipal: INE / 0012918", populationSource, 71, y);
  link("Divisão provincial histórica", "https://diariodarepublica.pt/dr/detalhe/decreto-lei/27424-1936-331619", 133, y);
  if (arms && report.arms) {
    const { author, license, licenseUrl } = report.arms;
    y += 6;
    const credits = ["Brasão: miniatura redimensionada", author, license, (!author || !license) ? "créditos completos na ficha Commons" : null].filter(Boolean).join(" · ");
    textBlock(credits, 8);
    if (license && licenseUrl?.startsWith("https://")) link(`Licença do brasão: ${license}`, licenseUrl, left, y - 1);
  }

  kicker = "02  /  POPULAÇÃO";
  page(kicker);
  const sum = [0, 0, 0];
  const ageCells = (label: string, ages: number[]) => {
    const total = ages.reduce((a, b) => a + b, 0);
    return [label, ...ages.map((a) => total > 0 ? `${num(a)} (${pct(a / total)})` : num(a)), num(total)];
  };
  const ageRows = report.census.map(({ name, ages }) => {
    ages.forEach((value, i) => { sum[i] += value; });
    return { cells: ageCells(name, ages) };
  });
  section("População por idade", "INE, Censos 2021 (limites em vigor à data dos Censos). A percentagem de cada grupo é calculada sobre o total da respetiva linha; o arredondamento pode não somar 100%.",
    ["Freguesia em 2021", "0–24 anos", "25–64 anos", "65+ anos", "Total"], [69, 30, 30, 30, 19], [
      { cells: ageCells("Total do concelho em 2021", sum), strong: true }, ...ageRows,
    ]);
  if (y > 261) page(kicker);
  link("Fonte: INE / Censos 2021 e BGRI", "https://censos.ine.pt/xportal/xmain?xlang=pt&xpgid=censos21_produtos&xpid=CENSOS21", left, y);

  kicker = "03  /  LOCALIDADES E DISTÂNCIAS";
  page(kicker);
  const routes = report.parishes.flatMap(({ meters }) => meters === null ? [] : [meters]);
  const average = routes.length ? routes.reduce((a, b) => a + b, 0) / routes.length : null;
  section("Freguesias e localidades", `Distância de ida por estrada desde ${TERRITORY_ROUTE_ORIGIN}, até ao ponto rodoviário de referência da freguesia (CAOP 2025). «—» indica que não há rota rodoviária ou população comparável.`,
    ["N.º · Freguesia", "Localidades (INE, Censos 2021)", "Residentes¹", "Ida"], [61, 74, 21, 22], [
      ...report.parishes.map((p) => ({ cells: [`${mapNums.get(p.code)}  ${p.name}`, p.localities.join(", ") || dash, num(p.censusPopulation), dist(p.meters)] })),
      { cells: [`Média das freguesias com rota (${routes.length}/${report.parishes.length})`, "", "", dist(average)], strong: true },
    ], [0, 1]);
  footnotes(kicker, ["¹ Residentes dos Censos 2021, quando os limites são comparáveis. Os lugares estatísticos do INE foram associados à freguesia CAOP 2025 pelo centroide; a lista pode não incluir todas as aldeias. Distâncias: OpenStreetMap (ODbL), calculadas com OSRM."]);
  link("Fonte dos lugares: INE / BGRI 2021", "https://www.arcgis.com/home/item.html?id=13fc6be14da84434aaa2c3fdce3a5cd6", left, y);
  link("OpenStreetMap · direitos e atribuição", "https://www.openstreetmap.org/copyright", 128, y);

  if (report.penetration) {
    kicker = "04  /  PENETRAÇÃO";
    page(kicker);
    const { total, byParish, unassigned } = report.penetration;
    const censusPartial = report.parishes.some((p) => p.censusPopulation === null);
    section("Taxa de penetração", `Contratos «Em Fornecimento» ÷ população residente × 100. Total do concelho: estimativa INE${report.populationYear ? ` de ${report.populationYear}` : ""}. Freguesias: Censos 2021, apenas quando os limites são comparáveis.`,
      ["Território", "Ano INE", "Residentes", "Contratos", "Taxa"], [76, 20, 30, 23, 29], [
        { cells: ["Total do concelho", num(report.populationYear), num(report.population), num(total.contracts), pct(total.rate)], strong: true },
        ...report.parishes.map((parish, i) => ({ cells: [
          `${mapNums.get(parish.code)}  ${parish.name}`, parish.censusPopulation === null ? dash : "2021", num(parish.censusPopulation),
          num(byParish[i].contracts), pct(byParish[i].rate),
        ] })),
        { cells: ["Sem freguesia identificada", dash, dash, num(unassigned), dash], strong: true },
      ]);
    const notes = ["A venda é atribuída à freguesia só quando a Localidade registada coincide com um único nome de freguesia ou lugar estatístico no concelho. Contratos sem correspondência inequívoca contam apenas no total municipal."];
    if (censusPartial) notes.push("Freguesias novas ou com limites não comparáveis: sem população de referência e sem taxa. As taxas por freguesia não somam a taxa do concelho.");
    footnotes(kicker, notes);
    link("Fonte da estimativa: INE / indicador 0012918", populationSource, left, y);
  }
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i); doc.setDrawColor(rule); doc.setLineWidth(0.25); doc.line(left, 281, 194, 281);
    font(8, muted); doc.text(`FICHA TERRITORIAL  ·  ${report.municipality}  ·  ${date(generated)}`, left, 287);
    doc.text(`${i} / ${pageCount}`, 194, 287, { align: "right" });
  }
  return doc;
}

export async function downloadTerritoryPdf(report: TerritoryReport) {
  const img = report.arms ? await coatOfArms(report.code) : null;
  const slug = report.municipality.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  createTerritoryPdf(report, img).save(`ficha-territorial-${slug}-${report.code}.pdf`);
}
