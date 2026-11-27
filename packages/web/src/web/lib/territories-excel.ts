import { normalizeTerritoryText, TERRITORY_COLUMNS, TERRITORY_IMPORT_LIMIT, TERRITORY_ROUTE_ORIGIN, territoryInput, type TerritoryInput } from "../../api/shared/territories";

const headerKey = (text: unknown) => normalizeTerritoryText(String(text ?? "")).replace(/[^a-z0-9]/g, "");
const headers = [
  ["distrito"], ["concelho", "municipio"], ["freguesia"], ["aldeia", "localidade"],
  ["dataultimovarrimento", "datadoultimovarrimento"],
];
const empty = (value: unknown) => value == null || (typeof value === "string" && !value.trim());
const iso = (year: number, month: number, day: number) => [String(year).padStart(4, "0"), String(month).padStart(2, "0"), String(day).padStart(2, "0")].join("-");

export async function readTerritoryExcel(file: File) {
  if (!/\.(xlsx|xls)$/i.test(file.name)) throw new Error("Seleciona um ficheiro Excel (.xlsx ou .xls).");
  if (file.size > 5 * 1024 * 1024) throw new Error("O ficheiro excede o limite de 5 MB.");
  const XLSX = await import("xlsx");
  let workbook;
  try {
    workbook = XLSX.read(await file.arrayBuffer(), { type: "array", dense: true, sheetRows: TERRITORY_IMPORT_LIMIT + 26, WTF: false });
  } catch {
    throw new Error("Não foi possível ler o ficheiro Excel. Verifica se está protegido ou danificado.");
  }
  const date1904 = !!workbook.Workbook?.WBProps?.date1904;

  function dateValue(value: unknown): string | null {
    if (empty(value)) return null;
    if (typeof value === "number") {
      const parsed = XLSX.SSF.parse_date_code(value, { date1904 });
      return parsed ? iso(parsed.y, parsed.m, parsed.d) : "inválida";
    }
    if (typeof value !== "string") return "inválida";
    const date = value.trim();
    const dayFirst = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(date);
    const yearFirst = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(date);
    if (dayFirst) return iso(+dayFirst[3], +dayFirst[2], +dayFirst[1]);
    if (yearFirst) return iso(+yearFirst[1], +yearFirst[2], +yearFirst[3]);
    return "inválida";
  }

  for (const sheet of workbook.SheetNames) {
    const ws = workbook.Sheets[sheet];
    if (!ws?.["!ref"]) continue;
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const data = ws["!data"];
    const cell = (row: number, col: number): unknown => col < 0 ? undefined : (data?.[row]?.[col] ?? ws[XLSX.utils.encode_cell({ r: row, c: col })])?.v;
    for (let header = range.s.r; header <= Math.min(range.e.r, range.s.r + 24); header++) {
      const names = Array.from({ length: Math.min(range.e.c - range.s.c + 1, 256) }, (_, i) => headerKey(cell(header, range.s.c + i)));
      const idx = headers.map((variants) => {
        const offset = names.findIndex((name) => variants.includes(name));
        return offset < 0 ? -1 : range.s.c + offset;
      });
      if ([0, 1, 2, 4].some((i) => idx[i] < 0)) continue;
      // !fullref preserva o fim real da folha quando a leitura foi limitada.
      const end = XLSX.utils.decode_range(ws["!fullref"] ?? ws["!ref"]).e.r;
      if (end - header > TERRITORY_IMPORT_LIMIT) throw new Error(`Limite de ${TERRITORY_IMPORT_LIMIT} linhas por importação. Divide a folha em ficheiros menores, incluindo o cabeçalho em cada um.`);
      const rows: TerritoryInput[] = [];
      const errors: string[] = [];
      for (let row = header + 1; row <= end; row++) {
        const [district, municipality, parish, village, date] = idx.map((col) => cell(row, col));
        if ([district, municipality, parish, village, date].every(empty)) continue;
        const parsed = territoryInput.safeParse({
          district: String(district ?? ""), municipality: String(municipality ?? ""), parish: String(parish ?? ""), village: String(village ?? ""),
          lastSweep: dateValue(date),
        });
        if (parsed.success) rows.push(parsed.data);
        else errors.push(`Linha ${row + 1}: ${parsed.error.issues.map((issue) => issue.message).join(" ")}`);
      }
      if (!rows.length && !errors.length) throw new Error("O ficheiro tem cabeçalho, mas não contém registos.");
      return { rows, errors, sheet };
    }
  }
  throw new Error("Não encontrei os cabeçalhos Distrito, Concelho, Freguesia e Data último varrimento. Usa o modelo Excel para confirmar os nomes.");
}

export async function downloadTerritoryTemplate() {
  const XLSX = await import("xlsx");
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([[...TERRITORY_COLUMNS]]);
  sheet["!cols"] = [18, 22, 24, 22, 25, 25, 16, 18, 12].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(book, sheet, "Territórios");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["Como preencher"], ["Uma linha por localização. Distrito, Concelho e Freguesia são obrigatórios."],
    ["Aldeia e a data do último varrimento podem ficar em branco. Usa uma data Excel ou DD/MM/AAAA."],
    ["O CRM calcula Mês último varrimento, Nº contratos, Meses descanso e KM. Deixa essas colunas em branco."],
    ["Nº contratos: total do histórico de Vendas em «Em Fornecimento» na freguesia. Valores no Excel são ignorados."],
    [`KM: distância de ida, de carro, desde ${TERRITORY_ROUTE_ORIGIN} até à freguesia.`],
    ["As localizações que já existem não são atualizadas pela importação. Para as alterar, usa Editar no CRM."],
  ]), "Instruções");
  book.Sheets["Instruções"]["!cols"] = [{ wch: 115 }];
  XLSX.writeFile(book, "modelo-territorios.xlsx");
}
