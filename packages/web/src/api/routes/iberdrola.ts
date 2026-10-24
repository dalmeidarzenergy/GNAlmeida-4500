import { z } from "zod";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { requireView, requireEdit } from "../middleware/auth";
import { db } from "../database";
import {
  clients,
  commissionRows,
  commissionTables,
  employeeTables,
  employees,
  iberdrolaImports,
  iberdrolaRows,
  sales,
} from "../database/schema";

const month = z.string().regex(/^\d{4}-\d{2}$/, "Mês inválido.");

const rowInput = z.object({
  sheet: z.enum(["auto", "chargback"]),
  rowIndex: z.number().int().nonnegative(),
  idVenda: z.string().nullish(),
  estado: z.string().nullish(),
  data: z.record(z.string(), z.union([z.string(), z.null()])),
});

const saveInput = z.object({
  filename: z.string().trim().min(1, "Nome de ficheiro em falta."),
  month,
  rows: z.array(rowInput).min(1, "O ficheiro não tem linhas."),
});

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const yes = (v: unknown) => (typeof v === "string" ? v.toLowerCase() === "sim" : v === true);

const SERVICE_LABEL: Record<string, string> = { LUZ: "Luz", "GÁS": "Gás", GAS: "Gás", DUAL: "Dual", SOLAR: "Solar" };
const serviceLabel = (s: string | null) => (s ? SERVICE_LABEL[s.toUpperCase()] ?? s : "-");

const energiesOf = (svc: string | null): ("luz" | "gas")[] => {
  const s = (svc ?? "").toUpperCase();
  if (s === "GÁS" || s === "GAS") return ["gas"];
  if (s === "DUAL") return ["luz", "gas"];
  return ["luz"];
};

/** Número de contrato (details.contractNumber) normalizado para texto; "-" se faltar. */
const contract = (details: Record<string, unknown> | null) => {
  const v = details?.contractNumber;
  return typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" ? String(v) : "-";
};

type IberdrolaLine = {
  idVenda: string;
  number: string;
  service: string;
  clientName: string | null;
  luz: number;
  gas: number;
  extras: number;
  total: number;
};

type IberdrolaPerson = {
  employeeId: number;
  employeeName: string;
  tableName: string | null;
  missingTable: boolean;
  bandSales: number;
  salesCount: number;
  luzCount: number;
  gasCount: number;
  extrasAmount: number;
  gross: number;
  chargeback: number;
  due: number;
  lines: IberdrolaLine[];
  chargebackLines: IberdrolaLine[];
};

type LiteSale = {
  id: number;
  sellerId: number | null;
  service: string | null;
  details: Record<string, unknown> | null;
  number: string;
  clientName: string | null;
};

type Band = { luz: number | null; gas: number | null; dd: number | null; fe: number | null; pel: number | null };

/** Constrói o "Auto Final" do mês a partir dos ficheiros Iberdrola carregados nesse mês. */
async function buildCalc(m: string) {
  const imports = await db.select({ id: iberdrolaImports.id }).from(iberdrolaImports).where(eq(iberdrolaImports.month, m));
  const importIds = imports.map((i) => i.id);

  if (!importIds.length) {
    return { month: m, unmatchedAuto: [] as string[], unmatchedChargeback: [] as string[], people: [] as IberdrolaPerson[], totals: { gross: 0, chargeback: 0, due: 0, missingTable: 0 } };
  }

  const rows = await db.select().from(iberdrolaRows).where(inArray(iberdrolaRows.importId, importIds));

  // Só as vendas "Em Fornecimento" da folha `auto` entram no auto; a folha `chargback` é deduzida.
  const autoIds = new Set<string>();
  const cbIds = new Set<string>();
  for (const r of rows) {
    if (!r.idVenda) continue;
    if (r.sheet === "auto" && r.estado === "Em Fornecimento") autoIds.add(r.idVenda);
    else if (r.sheet === "chargback") cbIds.add(r.idVenda);
  }

  // Liga ao comercial pelo ID de venda (número de contrato), não por nome/NIF.
  const allSales = await db
    .select({
      id: sales.id,
      sellerId: sales.sellerId,
      service: sales.service,
      details: sales.details,
      number: sales.number,
      clientName: clients.name,
    })
    .from(sales)
    .leftJoin(clients, eq(clients.id, sales.clientId));

  const byContract = new Map<string, LiteSale>();
  for (const s of allSales) {
    const c = contract(s.details);
    if (c !== "-") byContract.set(c, s);
  }

  const match = (ids: Set<string>) => {
    const found: LiteSale[] = [];
    const missing: string[] = [];
    for (const id of ids) {
      const s = byContract.get(id);
      if (s && s.sellerId != null) found.push(s);
      else missing.push(id);
    }
    return { found, missing };
  };

  const auto = match(autoIds);
  const cb = match(cbIds);

  const cTables = await db.select().from(commissionTables);
  const cRows = await db.select().from(commissionRows).orderBy(asc(commissionRows.position));
  const assignments = await db.select().from(employeeTables);

  const pick = <T extends { startDate: string; endDate: string | null }>(list: T[], from: string, to: string) =>
    list.filter((a) => a.startDate <= to && (a.endDate == null || a.endDate >= from)).sort((x, y) => (x.startDate < y.startDate ? 1 : -1))[0];

  const split = (s: LiteSale, band: Band | null): IberdrolaLine[] => {
    const d = s.details ?? {};
    const dd = yes(d.ddc);
    const fe = yes(d.fe);
    const pel = yes(d.pel);
    const extras = (dd ? band?.dd ?? 0 : 0) + (fe ? band?.fe ?? 0 : 0) + (pel ? band?.pel ?? 0 : 0);
    const base = { idVenda: contract(s.details), number: s.number, clientName: s.clientName, extras };
    return energiesOf(s.service).map((energy) =>
      energy === "gas"
        ? { ...base, service: "Gás", luz: 0, gas: band?.gas ?? 0, total: round2((band?.gas ?? 0) + extras) }
        : { ...base, service: "Luz", luz: band?.luz ?? 0, gas: 0, total: round2((band?.luz ?? 0) + extras) },
    );
  };

  // Agrupa as vendas por comercial.
  const bySeller = new Map<number, LiteSale[]>();
  const group = (list: LiteSale[]) => {
    for (const s of list) {
      const arr = bySeller.get(s.sellerId!) ?? [];
      arr.push(s);
      bySeller.set(s.sellerId!, arr);
    }
  };
  group(auto.found);

  // Comerciais que só aparecem no chargback (sem vendas no mês).
  for (const s of cb.found) {
    if (!bySeller.has(s.sellerId!)) bySeller.set(s.sellerId!, []);
  }

  const staff = await db.select({ id: employees.id, name: employees.name, commissionTableId: employees.commissionTableId }).from(employees);
  const staffById = new Map(staff.map((s) => [s.id, s]));

  const people: IberdrolaPerson[] = [];

  for (const [sellerId, mine] of bySeller) {
    const emp = staffById.get(sellerId);
    if (!emp) continue;

    const a = pick(
      assignments.filter((x) => x.employeeId === sellerId && x.kind === "commission" && x.commissionTableId != null),
      `${m}-01`,
      `${m}-31`,
    );
    const tableId = a?.commissionTableId ?? emp.commissionTableId;
    const table = cTables.find((t) => t.id === tableId) ?? null;

    const base: IberdrolaPerson = {
      employeeId: sellerId,
      employeeName: emp.name,
      tableName: table?.name ?? null,
      missingTable: !table,
      bandSales: 0,
      salesCount: mine.length,
      luzCount: 0,
      gasCount: 0,
      extrasAmount: 0,
      gross: 0,
      chargeback: 0,
      due: 0,
      lines: [],
      chargebackLines: [],
    };

    if (!table) {
      people.push(base);
      continue;
    }

    const bands = cRows.filter((r) => r.tableId === table.id && r.kind === "clients");
    const luzLines = mine.flatMap((s) => energiesOf(s.service).filter((e) => e === "luz"));
    const bandSales = luzLines.length;
    const band =
      bands.find((b) => bandSales >= (b.min ?? 0) && (b.max == null || bandSales <= b.max)) ??
      [...bands.filter((b) => b.max == null && bandSales >= (b.min ?? 0))].pop() ??
      null;

    const lines = mine.flatMap((s) => split(s, band));
    const cbMine = cb.found.filter((s) => s.sellerId === sellerId);
    const cbLines = cbMine.flatMap((s) => split(s, band));

    const gross = round2(lines.reduce((sum, l) => sum + l.total, 0));
    const chargeback = round2(cbLines.reduce((sum, l) => sum + l.total, 0));

    people.push({
      ...base,
      bandSales,
      luzCount: lines.filter((l) => l.service === "Luz").length,
      gasCount: lines.filter((l) => l.service === "Gás").length,
      extrasAmount: round2(lines.reduce((sum, l) => sum + l.extras, 0)),
      gross,
      chargeback,
      due: round2(gross - chargeback),
      lines,
      chargebackLines: cbLines,
    });
  }

  people.sort((a, b) => a.employeeName.localeCompare(b.employeeName));

  return {
    month: m,
    unmatchedAuto: auto.missing,
    unmatchedChargeback: cb.missing,
    people,
    totals: {
      gross: round2(people.reduce((s, p) => s + p.gross, 0)),
      chargeback: round2(people.reduce((s, p) => s + p.chargeback, 0)),
      due: round2(people.reduce((s, p) => s + p.due, 0)),
      missingTable: people.filter((p) => p.missingTable).length,
    },
  };
}

export const iberdrolaRoute = {
  /** Lista de ficheiros carregados (histórico). */
  list: requireView("auto-iberdrola").handler(async () => {
    const imports = await db.select({ id: iberdrolaImports.id, filename: iberdrolaImports.filename, month: iberdrolaImports.month, uploadedBy: iberdrolaImports.uploadedBy, createdAt: iberdrolaImports.createdAt }).from(iberdrolaImports).orderBy(asc(iberdrolaImports.createdAt));
    if (!imports.length) return [];

    const counts = await db
      .select({
        importId: iberdrolaRows.importId,
        sheet: iberdrolaRows.sheet,
        count: sql<number>`count(*)`.as("count"),
      })
      .from(iberdrolaRows)
      .where(inArray(iberdrolaRows.importId, imports.map((i) => i.id)))
      .groupBy(iberdrolaRows.importId, iberdrolaRows.sheet);

    const map = new Map<string, { auto: number; chargback: number }>();
    for (const c of counts) {
      const e = map.get(String(c.importId)) ?? { auto: 0, chargback: 0 };
      if (c.sheet === "auto") e.auto = Number(c.count);
      else e.chargback = Number(c.count);
      map.set(String(c.importId), e);
    }

    return imports.map((i) => ({ ...i, auto: map.get(String(i.id))?.auto ?? 0, chargback: map.get(String(i.id))?.chargback ?? 0 }));
  }),

  /** Linhas de um ficheiro carregado. */
  get: requireView("auto-iberdrola")
    .input(z.object({ id: z.number().int().positive() }))
    .handler(async ({ input }) => {
      const [imp] = await db.select().from(iberdrolaImports).where(eq(iberdrolaImports.id, input.id));
      if (!imp) return { found: false as const, import: null, rows: [] };
      const rows = await db.select().from(iberdrolaRows).where(eq(iberdrolaRows.importId, input.id)).orderBy(asc(iberdrolaRows.rowIndex));
      return { found: true as const, import: imp, rows };
    }),

  /** Guarda um ficheiro Iberdrola (folhas `auto` e `chargback`) no histórico. */
  save: requireEdit("auto-iberdrola")
    .input(saveInput)
    .handler(async ({ context, input }) => {
      const [imp] = await db
        .insert(iberdrolaImports)
        .values({ filename: input.filename, month: input.month, uploadedBy: context.user.name || context.user.email })
        .returning({ id: iberdrolaImports.id });

      if (input.rows.length) {
        await db.insert(iberdrolaRows).values(input.rows.map((r) => ({ importId: imp.id, sheet: r.sheet, rowIndex: r.rowIndex, idVenda: r.idVenda ?? null, estado: r.estado ?? null, data: r.data })));
      }
      return { id: imp.id };
    }),

  /** Remove um ficheiro do histórico (e as suas linhas). */
  remove: requireEdit("auto-iberdrola")
    .input(z.object({ id: z.number().int().positive() }))
    .handler(async ({ input }) => {
      await db.delete(iberdrolaImports).where(eq(iberdrolaImports.id, input.id));
      return { ok: true };
    }),

  /** "Autos Finais": cálculo por comercial a partir dos ficheiros do mês. */
  calc: requireView("auto-iberdrola")
    .input(z.object({ month }))
    .handler(async ({ input }) => buildCalc(input.month)),
};
