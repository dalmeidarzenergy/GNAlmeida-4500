import { z } from "zod";
import { asc, eq, inArray, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { auth } from "../auth";
import { requireView, requireEdit, type Role } from "../middleware/auth";
import { db } from "../database";
import { PUBLIC_DIR } from "../lib/public-files";
import {
  clients,
  commissionRows,
  commissionTables,
  employeeTables,
  employees,
  iberdrolaImports,
  iberdrolaRows,
  sales,
  userRoles,
} from "../database/schema";
import { effectivePermissions, type Permissions } from "../permissions";

export const UPLOAD_DIR = join(PUBLIC_DIR, "uploads", "iberdrola");

/** Valor pago por cada serviço adicional aderido na venda. */
export const SERVICE_PRICE = { dd: 5, fe: 7.5, mgi: 8.5 } as const;

const month = z.string().regex(/^\d{4}-\d{2}$/, "Mês inválido.");

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
  clientName: string | null;
  service: string;
  base: number;
  dd: number;
  fe: number;
  mgi: number;
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
  ddCount: number;
  feCount: number;
  mgiCount: number;
  baseAmount: number;
  ddAmount: number;
  feAmount: number;
  mgiAmount: number;
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

type Band = { luz: number | null; gas: number | null; dd: number | null; fe: number | null; mgi: number | null };

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

  /**
   * Divide uma venda nas suas linhas de auto. Valor base = escalão da tabela comisional
   * (luz/gás); cada serviço aderido na venda (débito direto, fatura eletrónica, PEL) paga
   * o seu próprio valor fixo, uma vez por venda, independentemente do tipo de venda.
   */
  const split = (s: LiteSale, band: Band | null): IberdrolaLine[] => {
    const d = s.details ?? {};
    const svc = {
      dd: yes(d.ddc) ? SERVICE_PRICE.dd : 0,
      fe: yes(d.fe) ? SERVICE_PRICE.fe : 0,
      mgi: yes(d.mgi ?? d.pel) ? SERVICE_PRICE.mgi : 0,
    };
    const svcTotal = round2(svc.dd + svc.fe + svc.mgi);
    const idVenda = contract(s.details);
    return energiesOf(s.service).map((energy) => {
      const base = round2(energy === "gas" ? band?.gas ?? 0 : band?.luz ?? 0);
      return {
        idVenda,
        clientName: s.clientName,
        service: energy === "gas" ? "Gás" : "Luz",
        base,
        ...svc,
        total: round2(base + svcTotal),
      };
    });
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
      ddCount: 0,
      feCount: 0,
      mgiCount: 0,
      baseAmount: 0,
      ddAmount: 0,
      feAmount: 0,
      mgiAmount: 0,
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

    const sum = (l: IberdrolaLine[], f: (x: IberdrolaLine) => number) => round2(l.reduce((t, x) => t + f(x), 0));

    people.push({
      ...base,
      bandSales,
      luzCount: lines.filter((l) => l.service === "Luz").length,
      gasCount: lines.filter((l) => l.service === "Gás").length,
      ddCount: sum(lines, (l) => (l.dd ? 1 : 0)),
      feCount: sum(lines, (l) => (l.fe ? 1 : 0)),
      mgiCount: sum(lines, (l) => (l.mgi ? 1 : 0)),
      baseAmount: sum(lines, (l) => l.base),
      ddAmount: sum(lines, (l) => l.dd),
      feAmount: sum(lines, (l) => l.fe),
      mgiAmount: sum(lines, (l) => l.mgi),
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
  /** Valores por serviço usados no cálculo. */
  services: requireView("auto-iberdrola").handler(async () => SERVICE_PRICE),

  /** Lista de ficheiros carregados (histórico). */
  list: requireView("auto-iberdrola").handler(async () => {
    const imports = await db.select({ id: iberdrolaImports.id, filename: iberdrolaImports.filename, month: iberdrolaImports.month, uploadedBy: iberdrolaImports.uploadedBy, createdAt: iberdrolaImports.createdAt, path: iberdrolaImports.path }).from(iberdrolaImports).orderBy(asc(iberdrolaImports.createdAt));
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

    return imports.map((i) => ({ ...i, auto: map.get(String(i.id))?.auto ?? 0, chargback: map.get(String(i.id))?.chargback ?? 0, downloadable: !!i.path }));
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

  /** Muda o mês de pagamento a que um ficheiro pertence. */
  setMonth: requireEdit("auto-iberdrola")
    .input(z.object({ id: z.number().int().positive(), month }))
    .handler(async ({ input }) => {
      await db.update(iberdrolaImports).set({ month: input.month }).where(eq(iberdrolaImports.id, input.id));
      return { ok: true };
    }),

  /** Remove um ficheiro do histórico (e as suas linhas). */
  remove: requireEdit("auto-iberdrola")
    .input(z.object({ id: z.number().int().positive() }))
    .handler(async ({ input }) => {
      const [imp] = await db.select({ path: iberdrolaImports.path }).from(iberdrolaImports).where(eq(iberdrolaImports.id, input.id));
      await db.delete(iberdrolaImports).where(eq(iberdrolaImports.id, input.id));
      if (imp?.path) {
        try {
          unlinkSync(join(UPLOAD_DIR, imp.path));
        } catch {
          /* ficheiro já não existe */
        }
      }
      return { ok: true };
    }),

  /** "Autos Finais": cálculo por comercial a partir dos ficheiros do mês. */
  calc: requireView("auto-iberdrola")
    .input(z.object({ month }))
    .handler(async ({ input }) => buildCalc(input.month)),
};

/* ------------------------------------------------------------
 * Upload e download do ficheiro original (Hono, multipart).
 * O ficheiro é guardado em disco em public/uploads/iberdrola/ e
 * servido em /api/iberdrola/file/:id para descarregar.
 * ------------------------------------------------------------ */

interface Ctx {
  userId: string;
  name: string;
  role: Role;
  permissions: Permissions;
}

async function resolveCtx(headers: Headers): Promise<Ctx | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  const [r] = await db.select().from(userRoles).where(eq(userRoles.userId, session.user.id));
  const role: Role = (r?.role ?? "vendedor") as Role;
  return {
    userId: session.user.id,
    name: session.user.name || session.user.email,
    role,
    permissions: effectivePermissions(role, r?.permissions ?? null),
  };
}

/** Normaliza texto para localizar as colunas "ID de venda" e "Estado". */
const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
const cell = (v: unknown): string => (v == null ? "" : typeof v === "number" ? String(v) : String(v).trim());

/** Lê uma folha do workbook e devolve as linhas normalizadas. */
function parseSheet(
  wb: { Sheets: Record<string, unknown> },
  XLSX: { utils: { sheet_to_json: (ws: unknown, opts: Record<string, unknown>) => unknown[][] } },
  sheetName: string,
  sheet: "auto" | "chargback",
) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  const filled = (r: unknown[]) => r.filter((x) => x != null && String(x).trim() !== "").length;
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
  const hi = aoa.findIndex((r) => filled(r) >= 2);
  if (hi < 0) return [];
  const headers = aoa[hi] as unknown[];
  const idIdx = headers.findIndex((h) => norm(cell(h)) === "id de venda");
  const estIdx = headers.findIndex((h) => norm(cell(h)) === "estado");
  const out: { sheet: "auto" | "chargback"; rowIndex: number; idVenda: string | null; estado: string | null; data: Record<string, string | null> }[] = [];
  aoa.slice(hi + 1).forEach((r, i) => {
    if (!filled(r)) return;
    const data: Record<string, string | null> = {};
    headers.forEach((h, j) => {
      data[cell(h)] = r[j] == null ? null : cell(r[j]);
    });
    const idV = idIdx >= 0 ? cell(r[idIdx]) : "";
    const est = estIdx >= 0 ? cell(r[estIdx]) : "";
    out.push({ sheet, rowIndex: i + hi + 2, idVenda: idV || null, estado: est || null, data });
  });
  return out;
}

export function iberdrolaRoutes(app: Hono) {
  // Carregar um ficheiro Iberdrola (multipart: file + month).
  app.post("/api/iberdrola/upload", async (c) => {
    const ctx = await resolveCtx(c.req.raw.headers);
    if (!ctx) return c.json({ error: "Sem sessão" }, 401);
    if (!ctx.permissions["auto-iberdrola"]?.edit) return c.json({ error: "Sem permissão para carregar ficheiros" }, 403);

    const form = await c.req.formData().catch(() => null);
    if (!form) return c.json({ error: "Corpo inválido" }, 400);
    const file = form.get("file") as File | null;
    if (!file) return c.json({ error: "Ficheiro em falta" }, 400);
    const m = (form.get("month") as string) || "";
    if (!/^\d{4}-\d{2}$/.test(m)) return c.json({ error: "Escolhe o mês a que este auto pertence." }, 400);

    const buf = Buffer.from(await file.arrayBuffer());
    if (!buf.length) return c.json({ error: "Ficheiro vazio" }, 422);

    let wb: { SheetNames: string[]; Sheets: Record<string, unknown> };
    let XLSX: { utils: { sheet_to_json: (ws: unknown, opts: Record<string, unknown>) => unknown[][] } };
    try {
      XLSX = (await import("xlsx")) as unknown as typeof XLSX;
      wb = XLSX.read(buf, { type: "buffer", cellDates: false }) as unknown as typeof wb;
    } catch {
      return c.json({ error: "Não foi possível ler o ficheiro. Confirma que é um Excel (.xlsx/.xls)." }, 422);
    }

    const sheetName = (want: string) => wb.SheetNames.find((n) => norm(n).includes(want));

    const rows: { sheet: "auto" | "chargback"; rowIndex: number; idVenda: string | null; estado: string | null; data: Record<string, string | null> }[] = [];
    for (const want of ["auto", "chargback"] as const) {
      const sn = sheetName(want);
      if (sn) rows.push(...parseSheet(wb, XLSX, sn, want));
    }
    if (!rows.length) return c.json({ error: "Não foram encontradas as folhas 'auto'/'chargback' neste ficheiro." }, 422);

    // Guarda o ficheiro original em disco para poder ser descarregado mais tarde.
    if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });
    const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(-80) || "auto.xlsx";
    const storedName = `${Date.now()}-${crypto.randomUUID()}-${safeName}`;
    writeFileSync(join(UPLOAD_DIR, storedName), buf);

    const [imp] = await db
      .insert(iberdrolaImports)
      .values({ filename: file.name || safeName, month: m, path: storedName, uploadedBy: ctx.name })
      .returning({ id: iberdrolaImports.id });

    await db.insert(iberdrolaRows).values(
      rows.map((r) => ({ importId: imp.id, sheet: r.sheet, rowIndex: r.rowIndex, idVenda: r.idVenda, estado: r.estado, data: r.data })),
    );

    return c.json({ id: imp.id, rows: rows.length }, 201);
  });

  // Descarregar o ficheiro original.
  app.get("/api/iberdrola/file/:id", async (c) => {
    const ctx = await resolveCtx(c.req.raw.headers);
    if (!ctx) return c.json({ error: "Sem sessão" }, 401);
    if (!ctx.permissions["auto-iberdrola"]?.view) return c.json({ error: "Sem permissão" }, 403);

    const id = Number(decodeURIComponent(c.req.param("id")));
    if (!Number.isInteger(id) || id <= 0) return c.notFound();
    const [imp] = await db.select().from(iberdrolaImports).where(eq(iberdrolaImports.id, id));
    if (!imp || !imp.path) return c.json({ error: "O ficheiro original não foi guardado para este registo." }, 404);

    let buf: Buffer;
    try {
      buf = readFileSync(join(UPLOAD_DIR, imp.path));
    } catch {
      return c.json({ error: "O ficheiro já não existe no servidor." }, 404);
    }
    const ext = (imp.filename.split(".").pop() || "xlsx").toLowerCase();
    const type = ext === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    return new Response(buf as unknown as BodyInit, {
      headers: {
        "Content-Type": type,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(imp.filename)}`,
      },
    });
  });
}
