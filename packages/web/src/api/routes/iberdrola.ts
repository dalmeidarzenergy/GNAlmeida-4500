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
  commissionRows,
  commissionTables,
  employeeTables,
  employees,
  iberdrolaImports,
  iberdrolaRows,
  ruleAssignments,
  rules,
  userRoles,
} from "../database/schema";
import { effectivePermissions, type Permissions } from "../permissions";

export const UPLOAD_DIR = join(PUBLIC_DIR, "uploads", "iberdrola");

const month = z.string().regex(/^\d{4}-\d{2}$/, "Mês inválido.");

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const yes = (v: unknown) => (typeof v === "string" ? v.toLowerCase() === "sim" : v === true);

/** Normaliza texto para ligar o comercial do Excel ao funcionário e localizar colunas. */
const normText = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

type IberdrolaLine = {
  idVenda: string;
  clientName: string | null;
  service: string;
  base: number;
  dd: number;
  fe: number;
  pel: number;
  total: number;
};

type IberdrolaPerson = {
  employeeId: number;
  employeeName: string;
  tableName: string | null;
  missingTable: boolean;
  forceCommissions: boolean;
  bandSales: number;
  salesCount: number;
  luzCount: number;
  gasCount: number;
  ddCount: number;
  feCount: number;
  pelCount: number;
  baseAmount: number;
  ddAmount: number;
  feAmount: number;
  pelAmount: number;
  svcAmount: number;
  /** Valores unitários do escalão atingido (o que a tabela comisional paga por item). */
  unit: { luz: number; gas: number; dd: number; fe: number; pel: number } | null;
  gross: number;
  chargeback: number;
  due: number;
  lines: IberdrolaLine[];
  chargebackLines: IberdrolaLine[];
  /** Regras aplicadas a este comercial no mês, com o valor de cada uma. */
  ruleEffects: { id: number; name: string; type: string; amount: number }[];
};

type IberdrolaEntry = {
  idVenda: string;
  employeeId: number | null;
  clientName: string | null;
  /** Energias desta entrada, derivadas do Excel: BTN → luz, BP → gás. */
  energies: ("luz" | "gas")[];
  /** True quando a "Nivel de tensão" é BTN (conta para o escalão). */
  hasBTN: boolean;
  excel: Record<string, unknown>;
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

  /** Devolve o valor de uma coluna do Excel pelo nome (ignora maiúsculas/acentos). */
  const colVal = (data: Record<string, unknown>, name: string): unknown => {
    const key = Object.keys(data).find((k) => normText(k) === normText(name));
    return key != null ? data[key] : null;
  };
  const strOf = (v: unknown): string | null => {
    const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
    return s === "" ? null : s;
  };

  // Funcionários: ligam o comercial do Excel por "NIF Comercial" ou "Comercial" (nome).
  // Não é usada qualquer ligação à aba Vendas.
  const staff = await db
    .select({ id: employees.id, name: employees.name, nif: employees.nif, commissionTableId: employees.commissionTableId, forceCommissions: employees.forceCommissions })
    .from(employees);
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const staffByName = new Map(staff.map((s) => [normText(s.name), s.id] as const));
  const staffByNif = new Map(
    staff.filter((s) => s.nif && s.nif.trim() !== "").map((s) => [normText(s.nif!), s.id] as const),
  );

  // Linhas do Excel → entradas comissionáveis (auto "Em Fornecimento") e baixas (chargback).
  const autoEntries: IberdrolaEntry[] = [];
  const cbEntries: IberdrolaEntry[] = [];
  const unmatchedAuto: string[] = [];
  const unmatchedChargeback: string[] = [];

  for (const r of rows) {
    if (!r.idVenda) continue;
    const idVenda = String(r.idVenda).trim();
    const data = (r.data ?? {}) as Record<string, unknown>;

    // Energias derivadas do Excel: "Nivel de tensão" = BTN → luz; "Nivel de pressão" = BP → gás.
    const nivelTensao = normText(strOf(colVal(data, "nivel de tensao")) ?? "").toUpperCase();
    const nivelPressao = normText(strOf(colVal(data, "nivel de pressao")) ?? "").toUpperCase();
    const hasBTN = nivelTensao === "BTN";
    const hasBP = nivelPressao === "BP";
    const energies: ("luz" | "gas")[] = [];
    if (hasBTN) energies.push("luz");
    if (hasBP) energies.push("gas");
    if (!energies.length) energies.push("luz");

    const nif = normText(strOf(colVal(data, "nif comercial")) ?? "");
    const nome = normText(strOf(colVal(data, "comercial")) ?? "");
    const employeeId = (nif && staffByNif.get(nif)) || (nome && staffByName.get(nome)) || null;

    const clientName =
      strOf(colVal(data, "cliente")) ?? strOf(colVal(data, "titular")) ?? strOf(colVal(data, "nome do cliente"));

    const entry: IberdrolaEntry = { idVenda, employeeId, clientName, energies, hasBTN, excel: data };

    if (r.sheet === "auto") {
      if (r.estado === "Em Fornecimento") {
        if (employeeId != null) autoEntries.push(entry);
        else unmatchedAuto.push(idVenda);
      }
    } else if (r.sheet === "chargback") {
      if (employeeId != null) cbEntries.push(entry);
      else unmatchedChargeback.push(idVenda);
    }
  }

  const cTables = await db.select().from(commissionTables);
  const cRows = await db.select().from(commissionRows).orderBy(asc(commissionRows.position));
  const assignments = await db.select().from(employeeTables);

  // Regras de pagamento: automáticas (todas) e manuais atribuídas neste mês.
  const allRules = await db.select().from(rules);
  const activeRules = allRules.filter((r) => r.active);
  const autoRules = activeRules.filter((r) => r.type === "auto");
  const manualRules = activeRules.filter((r) => r.type === "manual");
  const monthAssignments = await db.select().from(ruleAssignments).where(eq(ruleAssignments.month, m));
  const assignedByEmployee = new Map<number, Set<number>>();
  for (const a of monthAssignments) {
    const s = assignedByEmployee.get(a.employeeId) ?? new Set<number>();
    s.add(a.ruleId);
    assignedByEmployee.set(a.employeeId, s);
  }

  const cellNum = (v: unknown): number | null => {
    const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };
  /** Avalia a condição de uma regra automática sobre uma linha do Excel. */
  const matchesCondition = (rule: (typeof allRules)[number], excel: Record<string, unknown>): boolean => {
    if (!rule.sourceColumn || !rule.operator) return false;
    const key = Object.keys(excel).find((k) => normText(k) === normText(rule.sourceColumn!));
    if (key == null) return false;
    const raw = excel[key];
    const cmp = rule.compareValue ?? "";
    const op = rule.operator;
    if (op === "startsWith") return normText(String(raw ?? "")).startsWith(normText(cmp));
    if (op === "contains") return normText(String(raw ?? "")).includes(normText(cmp));
    if (op === "==") return String(raw ?? "") === String(cmp);
    if (op === "!=") return String(raw ?? "") !== String(cmp);
    const a = cellNum(raw);
    const b = cellNum(cmp);
    if (a == null || b == null) return false;
    if (op === ">") return a > b;
    if (op === "<") return a < b;
    if (op === ">=") return a >= b;
    if (op === "<=") return a <= b;
    return false;
  };

  const pick = <T extends { startDate: string; endDate: string | null }>(list: T[], from: string, to: string) =>
    list.filter((a) => a.startDate <= to && (a.endDate == null || a.endDate >= from)).sort((x, y) => (x.startDate < y.startDate ? 1 : -1))[0];

  /** Divide uma entrada (linha do Excel) nas suas linhas de auto. DD/FE/PEL são lidos do Excel. */
  const split = (entry: IberdrolaEntry, band: Band | null): IberdrolaLine[] => {
    const excelRow = entry.excel;
    // "Método de Pagamento" = "Débito Directo"/"Débito Direto" → DD; "FE"/"Fatura Eletronica" = "SIM" → FE; "PEL" = "SIM" (ou "PEL PLUS") → PEL.
    const metodo = normText(strOf(colVal(excelRow, "metodo de pagamento")) ?? "");
    const hasDD = metodo.includes("debito");
    const hasFE = yes(colVal(excelRow, "fe")) || yes(colVal(excelRow, "fatura eletronica"));
    const hasPEL = yes(colVal(excelRow, "pel")) || normText(strOf(colVal(excelRow, "pel plus")) ?? "") === "pel" || yes(colVal(excelRow, "pel plus"));

    const svc = {
      dd: hasDD ? band?.dd ?? 0 : 0,
      fe: hasFE ? band?.fe ?? 0 : 0,
      pel: hasPEL ? band?.pel ?? 0 : 0,
    };
    const svcTotal = round2(svc.dd + svc.fe + svc.pel);
    return entry.energies.map((energy, i) => {
      const base = round2(energy === "gas" ? band?.gas ?? 0 : band?.luz ?? 0);
      const svcLine = i === 0 ? svc : { dd: 0, fe: 0, pel: 0 };
      return {
        idVenda: entry.idVenda,
        clientName: entry.clientName,
        service: energy === "gas" ? "Gás" : "Luz",
        base,
        ...svcLine,
        total: round2(base + (i === 0 ? svcTotal : 0)),
      };
    });
  };

  // Agrupa as entradas por comercial.
  const bySeller = new Map<number, IberdrolaEntry[]>();
  for (const e of autoEntries) {
    if (e.employeeId == null) continue;
    const arr = bySeller.get(e.employeeId) ?? [];
    arr.push(e);
    bySeller.set(e.employeeId, arr);
  }
  // Comerciais que só aparecem no chargback.
  for (const e of cbEntries) {
    if (e.employeeId == null) continue;
    if (!bySeller.has(e.employeeId)) bySeller.set(e.employeeId, []);
  }

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
      forceCommissions: emp.forceCommissions ?? false,
      bandSales: 0,
      salesCount: mine.length,
      luzCount: 0,
      gasCount: 0,
      ddCount: 0,
      feCount: 0,
      pelCount: 0,
      baseAmount: 0,
      ddAmount: 0,
      feAmount: 0,
      pelAmount: 0,
      svcAmount: 0,
      unit: null,
      gross: 0,
      chargeback: 0,
      due: 0,
      lines: [],
      chargebackLines: [],
      ruleEffects: [],
    };

    if (!table) {
      people.push(base);
      continue;
    }

    const bands = cRows.filter((r) => r.tableId === table.id && r.kind === "clients");
    // Escalão: só conta BTN (luz) em fornecimento; BP (gás) é comissionado mas não sobe o escalão.
    const bandSales = mine.filter((e) => e.hasBTN).length;
    const band =
      bands.find((b) => bandSales >= (b.min ?? 0) && (b.max == null || bandSales <= b.max)) ??
      [...bands.filter((b) => b.max == null && bandSales >= (b.min ?? 0))].pop() ??
      null;

    // Bloqueio de vendas (objetivo): as primeiras N vendas não são pagas, salvo
    // se o pagamento de comissões estiver forçado para este comercial.
    const blocked = emp.forceCommissions ? 0 : (table?.blockedSales ?? 0);
    const paidEntries = mine.slice(Math.min(blocked, mine.length));

    const lines = paidEntries.flatMap((e) => split(e, band));
    const cbMine = cbEntries.filter((e) => e.employeeId === sellerId);
    const cbLines = cbMine.flatMap((e) => split(e, band));

    const gross = round2(lines.reduce((sum, l) => sum + l.total, 0));
    const chargeback = round2(cbLines.reduce((sum, l) => sum + l.total, 0));

    const sum = (l: IberdrolaLine[], f: (x: IberdrolaLine) => number) => round2(l.reduce((t, x) => t + f(x), 0));
    const ddAmount = sum(lines, (l) => l.dd);
    const feAmount = sum(lines, (l) => l.fe);
    const pelAmount = sum(lines, (l) => l.pel);

    // --- Aplicação de regras de pagamento ---
    const ruleEffects: { id: number; name: string; type: string; amount: number }[] = [];

    // Automáticas: por cada venda paga que satisfaz a condição (coluna do Excel).
    for (const r of autoRules) {
      let total = 0;
      for (const e of paidEntries) {
        if (!matchesCondition(r, e.excel)) continue;
        const saleTotal = split(e, band).reduce((t, l) => t + l.total, 0);
        const amt = r.effectType === "percent" ? round2(r.effectValue * saleTotal) : r.effectValue;
        total = round2(total + amt);
      }
      if (total !== 0) ruleEffects.push({ id: r.id, name: r.name, type: "auto", amount: total });
    }

    // Manuais: atribuídas a este comercial no mês; aplicam-se ao total bruto.
    const assignedRuleIds = assignedByEmployee.get(sellerId);
    if (assignedRuleIds) {
      for (const r of manualRules) {
        if (!assignedRuleIds.has(r.id)) continue;
        const amt = r.effectType === "percent" ? round2(r.effectValue * gross) : r.effectValue;
        ruleEffects.push({ id: r.id, name: r.name, type: "manual", amount: amt });
      }
    }

    const rulesDelta = round2(ruleEffects.reduce((t, e) => t + e.amount, 0));

    people.push({
      ...base,
      bandSales,
      luzCount: lines.filter((l) => l.service === "Luz").length,
      gasCount: lines.filter((l) => l.service === "Gás").length,
      ddCount: sum(lines, (l) => (l.dd ? 1 : 0)),
      feCount: sum(lines, (l) => (l.fe ? 1 : 0)),
      pelCount: sum(lines, (l) => (l.pel ? 1 : 0)),
      baseAmount: sum(lines, (l) => l.base),
      ddAmount,
      feAmount,
      pelAmount,
      svcAmount: round2(ddAmount + feAmount + pelAmount),
      unit: band ? { luz: band.luz ?? 0, gas: band.gas ?? 0, dd: band.dd ?? 0, fe: band.fe ?? 0, pel: band.pel ?? 0 } : null,
      gross,
      chargeback,
      due: round2(gross - chargeback + rulesDelta),
      lines,
      chargebackLines: cbLines,
      ruleEffects,
    });
  }

  people.sort((a, b) => a.employeeName.localeCompare(b.employeeName));

  return {
    month: m,
    unmatchedAuto,
    unmatchedChargeback,
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

  /** Liga/desliga o pagamento forçado de comissões de um comercial (ignora o bloqueio da tabela). */
  forceCommissionsToggle: requireEdit("auto-iberdrola")
    .input(z.object({ employeeId: z.number().int().positive() }))
    .handler(async ({ input }) => {
      const [emp] = await db.select({ forceCommissions: employees.forceCommissions }).from(employees).where(eq(employees.id, input.employeeId));
      if (!emp) return { found: false as const, forceCommissions: false };
      const next = !emp.forceCommissions;
      await db.update(employees).set({ forceCommissions: next }).where(eq(employees.id, input.employeeId));
      return { found: true as const, employeeId: input.employeeId, forceCommissions: next };
    }),

  /** Resumo dos autos de um funcionário, por mês (para a ficha do funcionário). */
  employee: requireView("auto-iberdrola")
    .input(z.object({ employeeId: z.number() }))
    .handler(async ({ input }) => {
      const months = await db.select({ month: iberdrolaImports.month }).from(iberdrolaImports).groupBy(iberdrolaImports.month).orderBy(asc(iberdrolaImports.month));
      const out: { month: string; person: IberdrolaPerson | null }[] = [];
      for (const { month } of months) {
        const calc = await buildCalc(month);
        const person = calc.people.find((p) => p.employeeId === input.employeeId) ?? null;
        if (person) out.push({ month, person });
      }
      return out;
    }),
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
