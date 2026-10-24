/**
 * Leitura do Excel exportado da Iberdrola (pagamento dos comerciais).
 * O ficheiro tem duas folhas — `auto` (vendas que entram no auto) e `chargback` (baixas a deduzir).
 * Devolve as linhas normalizadas (coluna → valor como texto) para guardar e calcular.
 */

import type { Sheet } from "./sale-import";

/** Converte um valor de célula para texto (null/undefined → ""). */
const cell = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "number") return String(v);
  return String(v).trim();
};

/** Lê todas as folhas do ficheiro (mesma regra do import de vendas). */
async function readSheets(file: File): Promise<Sheet[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  const filled = (r: unknown[]) => r.filter((c) => c != null && String(c).trim() !== "").length;
  return wb.SheetNames.map((name): Sheet => {
    const ws = wb.Sheets[name];
    const first = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]).s.r + 1 : 1;
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });
    const hi = aoa.findIndex((r) => filled(r) >= 2);
    if (hi < 0) return { name, headers: [], rows: [], lines: [] };
    const width = Math.max(...aoa.slice(hi).map((r) => r.length));
    const headers = Array.from({ length: width }, (_, i) => String(aoa[hi][i] ?? "").trim() || `Coluna ${i + 1}`);
    const rows: unknown[][] = [];
    const lines: number[] = [];
    aoa.slice(hi + 1).forEach((r, i) => {
      if (!filled(r)) return;
      rows.push(r);
      lines.push(first + hi + 1 + i);
    });
    return { name, headers, rows, lines };
  }).filter((s) => s.headers.length);
}

export type IberdrolaRow = {
  sheet: "auto" | "chargback";
  rowIndex: number;
  idVenda: string | null;
  estado: string | null;
  data: Record<string, string | null>;
};

const col = (headers: string[], row: unknown[], name: string) => {
  const i = headers.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
  return i >= 0 ? cell(row[i]) : "";
};

const normalize = (name: string) => name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

function colByNorm(headers: string[], row: unknown[], normName: string) {
  const i = headers.findIndex((h) => normalize(h) === normName);
  return i >= 0 ? cell(row[i]) : "";
}

/** Normaliza as folhas `auto` e `chargback` para o formato do servidor. */
export async function readIberdrola(file: File): Promise<{ filename: string; rows: IberdrolaRow[] }> {
  const sheets = await readSheets(file);
  const rows: IberdrolaRow[] = [];

  const pick = (name: "auto" | "chargback") => {
    // Encontra a folha cujo nome, normalizado, contém o nome esperado.
    const s = sheets.find((x) => normalize(x.name).includes(name)) ?? sheets.find((x) => normalize(x.name).startsWith(name));
    return s;
  };

  for (const sheetName of ["auto", "chargback"] as const) {
    const s = pick(sheetName);
    if (!s) continue;
    for (let r = 0; r < s.rows.length; r++) {
      const row = s.rows[r];
      const data: Record<string, string | null> = {};
      s.headers.forEach((h, i) => {
        data[h] = row[i] == null ? null : cell(row[i]);
      });
      // "ID de venda" pode vir com acentos/variações; usa a normalização.
      const idVenda = colByNorm(s.headers, row, "id de venda") || col(s.headers, row, "ID de venda");
      const estado = colByNorm(s.headers, row, "estado") || col(s.headers, row, "Estado");
      rows.push({
        sheet: sheetName,
        rowIndex: s.lines[r],
        idVenda: idVenda || null,
        estado: estado || null,
        data,
      });
    }
  }

  if (!rows.length) throw new Error("O ficheiro não tem folhas reconhecidas (`auto` / `chargback`).");

  return { filename: file.name, rows };
}
