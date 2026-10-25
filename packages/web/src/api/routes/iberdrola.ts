import { z } from "zod";
import { asc, eq, inArray, lt, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildIberdrolaPdf } from "./iberdrola-pdf";
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
  iberdrolaOverrides,
  vncPenalties,
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

type IberdrolaMedemLine = {
  idVenda: string;
  clientName: string | null;
  pontos: number;
  commission: number;
  total: number;
};

type IberdrolaPerson = {
  employeeId: number;
  employeeName: string;
  tableName: string | null;
  missingTable: boolean;
  forceCommissionsPct: number;
  bandSales: number;
  salesCount: number;
  /** Todas as vendas do comercial no mes (mesmo as bloqueadas pelo objetivo), para a troca de venda. */
  allSaleIds: string[];
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
  /** Linhas Medem (Total Pontos × comissão do escalão). */
  medemLines: IberdrolaMedemLine[];
  medemPontos: number;
  medemTotal: number;
  chargebackLines: IberdrolaLine[];
  /** Regras aplicadas a este comercial no mês, com o valor de cada uma. */
  ruleEffects: { id: number; name: string; type: string; amount: number }[];
  /** Penalidades VNC registadas manualmente neste mês. */
  vncs: { id: number; idVenda: string; amount: number }[];
  /** Vendas que foram transferidas para outro comercial (troca de venda). */
  overridesOut: { idVenda: string; toName: string }[];
  /** Vendas que foram recebidas de outro comercial (troca de venda). */
  overridesIn: { idVenda: string; fromName: string }[];
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
async function buildCalc(m: string, opts: { skipPrevChargeback?: boolean } = {}) {
  const imports = await db.select({ id: iberdrolaImports.id }).from(iberdrolaImports).where(eq(iberdrolaImports.month, m));
  const importIds = imports.map((i) => i.id);

  if (!importIds.length) {
    return { month: m, unmatchedAuto: [] as string[], unmatchedChargeback: [] as string[], unmatchedMedem: [] as string[], people: [] as IberdrolaPerson[], totals: { gross: 0, chargeback: 0, due: 0, missingTable: 0, medemTotal: 0 } };
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
    .select({ id: employees.id, name: employees.name, nif: employees.nif, commissionTableId: employees.commissionTableId, forceCommissionsPct: employees.forceCommissionsPct })
    .from(employees);
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const staffByName = new Map(staff.map((s) => [normText(s.name), s.id] as const));
  const staffByNif = new Map(
    staff.filter((s) => s.nif && s.nif.trim() !== "").map((s) => [normText(s.nif!), s.id] as const),
  );

  // Linhas do Excel → entradas comissionáveis (auto "Em Fornecimento") e baixas (chargeback).
  const autoEntries: IberdrolaEntry[] = [];
  const cbEntries: IberdrolaEntry[] = [];
  const medemLines: { idVenda: string; employeeId: number | null; clientName: string | null; pontos: number; excel: Record<string, unknown> }[] = [];
  const unmatchedAuto: string[] = [];
  const unmatchedChargeback: string[] = [];
  const unmatchedMedem: string[] = [];

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
    } else if (r.sheet === "chargeback") {
      if (employeeId != null) cbEntries.push(entry);
      else unmatchedChargeback.push(idVenda);
    } else if (r.sheet === "medem") {
      const rawPontos = colVal(data, "total pontos");
      const pontosNum = typeof rawPontos === "number" ? rawPontos : parseFloat(String(rawPontos ?? "").replace(",", "."));
      const pontos = Number.isFinite(pontosNum) ? pontosNum : 0;
      if (employeeId != null) {
        medemLines.push({ idVenda, employeeId, clientName, pontos, excel: data });
      } else {
        unmatchedMedem.push(idVenda);
      }
    }
  }

  const cTables = await db.select().from(commissionTables);
  const cRows = await db.select().from(commissionRows).orderBy(asc(commissionRows.position));
  const assignments = await db.select().from(employeeTables);

  // Penalidades VNC do mês, por comercial.
  const vncs = await db.select().from(vncPenalties).where(eq(vncPenalties.month, m));
  const vncsByEmployee = new Map<number, { id: number; idVenda: string; amount: number }[]>();
  for (const v of vncs) {
    const arr = vncsByEmployee.get(v.employeeId) ?? [];
    arr.push({ id: v.id, idVenda: v.idVenda, amount: v.amount });
    vncsByEmployee.set(v.employeeId, arr);
  }

  // Overrides (troca de venda): reatribui vendas de um comercial para outro no mês.
  const overrides = await db.select().from(iberdrolaOverrides).where(eq(iberdrolaOverrides.month, m));
  const overridesOut = new Map<number, { idVenda: string; toName: string }[]>();
  const overridesIn = new Map<number, { idVenda: string; fromName: string }[]>();
  for (const ov of overrides) {
    for (const e of autoEntries) {
      if (e.idVenda === ov.idVenda && e.employeeId === ov.fromEmployeeId) e.employeeId = ov.toEmployeeId;
    }
    for (const e of cbEntries) {
      if (e.idVenda === ov.idVenda && e.employeeId === ov.fromEmployeeId) e.employeeId = ov.toEmployeeId;
    }
    for (const e of medemLines) {
      if (e.idVenda === ov.idVenda && e.employeeId === ov.fromEmployeeId) e.employeeId = ov.toEmployeeId;
    }
    const toEmp = staffById.get(ov.toEmployeeId);
    const fromEmp = staffById.get(ov.fromEmployeeId);
    const outArr = overridesOut.get(ov.fromEmployeeId) ?? [];
    outArr.push({ idVenda: ov.idVenda, toName: toEmp?.name ?? `#${ov.toEmployeeId}` });
    overridesOut.set(ov.fromEmployeeId, outArr);
    const inArr = overridesIn.get(ov.toEmployeeId) ?? [];
    inArr.push({ idVenda: ov.idVenda, fromName: fromEmp?.name ?? `#${ov.fromEmployeeId}` });
    overridesIn.set(ov.toEmployeeId, inArr);
  }

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
  // Comerciais que só aparecem no chargeback ou medem.
  for (const e of cbEntries) {
    if (e.employeeId == null) continue;
    if (!bySeller.has(e.employeeId)) bySeller.set(e.employeeId, []);
  }
  for (const e of medemLines) {
    if (e.employeeId == null) continue;
    if (!bySeller.has(e.employeeId)) bySeller.set(e.employeeId, []);
  }

  // --- Chargeback reconstruído dos autos anteriores ---
  // A Iberdrola envia apenas o ID da venda (não vem FE/DD); o valor pago
  // (base + DD + FE + PEL, do escalão desse mês) está no auto onde a venda foi paga.
  // Mapa "idVenda|serviço" → linha paga no auto anterior e o comercial que a recebeu.
  const prevPaid = new Map<string, { employeeId: number; base: number; dd: number; fe: number; pel: number; total: number; clientName: string | null }>();
  if (!opts.skipPrevChargeback) {
    const prevMonths = await db
      .select({ month: iberdrolaImports.month })
      .from(iberdrolaImports)
      .where(lt(iberdrolaImports.month, m))
      .groupBy(iberdrolaImports.month)
      .orderBy(asc(iberdrolaImports.month));
    for (const { month: pm } of prevMonths) {
      const pc = await buildCalc(pm, { skipPrevChargeback: true });
      for (const person of pc.people) {
        for (const l of person.lines) {
          prevPaid.set(`${l.idVenda}|${l.service}`, {
            employeeId: person.employeeId,
            base: l.base,
            dd: l.dd,
            fe: l.fe,
            pel: l.pel,
            total: l.total,
            clientName: l.clientName,
          });
        }
      }
    }
  }

  // Distribui o chargeback ao comercial que recebeu a venda no auto anterior;
  // o que não for encontrado fica para o cálculo com o escalão do mês corrente (fallback).
  const prevCbBySeller = new Map<number, IberdrolaLine[]>();
  const resolvedCbKeys = new Set<string>();
  for (const e of cbEntries) {
    if (e.employeeId == null) continue;
    for (const energy of e.energies) {
      const service = energy === "gas" ? "Gás" : "Luz";
      const key = `${e.idVenda}|${service}`;
      if (resolvedCbKeys.has(key)) continue;
      const prev = prevPaid.get(key);
      if (!prev) continue;
      resolvedCbKeys.add(key);
      const arr = prevCbBySeller.get(prev.employeeId) ?? [];
      arr.push({ idVenda: e.idVenda, clientName: prev.clientName, service, base: prev.base, dd: prev.dd, fe: prev.fe, pel: prev.pel, total: prev.total });
      prevCbBySeller.set(prev.employeeId, arr);
    }
  }
  // Comerciais que só aparecem no chargeback (pagador de um auto anterior sem venda no mês corrente).
  for (const pid of prevCbBySeller.keys()) {
    if (!bySeller.has(pid)) bySeller.set(pid, []);
  }

  const people: IberdrolaPerson[] = [];

  for (const [sellerId, mine] of bySeller) {
    const emp = staffById.get(sellerId);
    if (!emp) continue;

    // Todas as tabelas ativas do comercial no mês (default + assignments).
    const activeTableIds = new Set<number>();
    if (emp.commissionTableId) activeTableIds.add(emp.commissionTableId);
    for (const x of assignments) {
      if (x.employeeId !== sellerId || x.kind !== "commission" || !x.commissionTableId) continue;
      if (x.startDate <= `${m}-31` && (x.endDate == null || x.endDate >= `${m}-01`)) {
        activeTableIds.add(x.commissionTableId);
      }
    }
    const empTables = cTables.filter((t) => activeTableIds.has(t.id));
    const resTable = empTables.find((t) => t.regime === "RES+BTN NEG") ?? null;
    const medemTable = empTables.find((t) => t.regime === "MEDEM") ?? null;
    const solarTable = empTables.find((t) => t.regime === "SOLAR") ?? null;

    const tableNames = empTables.map((t) => t.name).filter(Boolean);
    const base: IberdrolaPerson = {
      employeeId: sellerId,
      employeeName: emp.name,
      tableName: tableNames.length > 0 ? tableNames.join(" + ") : null,
      missingTable: empTables.length === 0,
      forceCommissionsPct: emp.forceCommissionsPct ?? 0,
      bandSales: 0,
      salesCount: mine.length,
      allSaleIds: mine.map((e) => e.idVenda),
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
      vncs: [],
      overridesOut: [],
      overridesIn: [],
      medemLines: [],
      medemPontos: 0,
      medemTotal: 0,
    };

    if (empTables.length === 0) {
      people.push(base);
      continue;
    }

    // ── RES+BTN NEG ──
    let band: Band | null = null;
    let resBands: typeof bands = [];
    const sortedBands: Band[] = [];
    let bandIdx = -1;
    let forced = emp.forceCommissionsPct > 0;
    let paidEntries = mine; // fallback: todas pagas
    let lines: IberdrolaLine[] = [];
    let cbLines: IberdrolaLine[] = [];

    if (resTable) {
      resBands = cRows.filter((r) => r.tableId === resTable.id && r.kind === "clients");
      // Vendas BTN com potência < 3,45 contam para o escalão mas não são pagas.
      const lowPower = new Set(
        mine
          .filter((e) => e.hasBTN && (cellNum(colVal(e.excel, "potencia")) ?? 99) < 3.45)
          .map((e) => e.idVenda),
      );
      const bandSales = mine.filter((e) => e.hasBTN).length;
      const sBands = [...resBands].sort((a, b) => (a.min ?? 0) - (b.min ?? 0));
      const pool = forced ? sBands.slice(1) : resBands;
      band =
        pool.find((b) => bandSales >= (b.min ?? 0) && (b.max == null || bandSales <= b.max)) ??
        [...pool.filter((b) => b.max == null && bandSales >= (b.min ?? 0))].pop() ??
        (forced ? (pool[0] ?? null) : null);
      bandIdx = band ? sBands.indexOf(band) : -1;

      // Bloqueio de vendas (objetivo) + baixa potência.
      const blocked = forced ? 0 : (resTable?.blockedSales ?? 0);
      const commissionable = mine.filter((e) => !lowPower.has(e.idVenda));
      paidEntries = commissionable.slice(Math.min(blocked, commissionable.length));

      lines = paidEntries.flatMap((e) => split(e, band));

      // Chargeback: vendas resolvidas no auto anterior + fallback com escalão corrente.
      const cbMine = cbEntries.filter((e) => e.employeeId === sellerId);
      const cbFallback = cbMine.flatMap((e) =>
        e.energies
          .filter((energy) => !resolvedCbKeys.has(`${e.idVenda}|${energy === "gas" ? "Gás" : "Luz"}`))
          .map((energy) => ({ ...e, energies: [energy] as ("luz" | "gas")[] })),
      );
      cbLines = [...(prevCbBySeller.get(sellerId) ?? []), ...cbFallback.flatMap((e) => split(e, band))];
    }

    // ── MEDEM ──
    let medemTotal = 0;
    let medemResult: IberdrolaMedemLine[] = [];
    let medemPontos = 0;
    if (medemTable) {
      const personMedem = medemLines.filter((e) => e.employeeId === sellerId);
      medemPontos = personMedem.reduce((t, e) => t + e.pontos, 0);
      const medemBands = cRows.filter((r) => r.tableId === medemTable.id && r.kind === "medem");
      const sMedemBands = [...medemBands].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      // Escalão Medem = mesma posição que o escalão de clientes da RES.
      const mBand = (bandIdx >= 0 && bandIdx < sMedemBands.length) ? sMedemBands[bandIdx] : null;
      const mComm = mBand?.commission ?? 0;
      medemResult = personMedem.map((e) => ({
        idVenda: e.idVenda,
        clientName: e.clientName,
        pontos: e.pontos,
        commission: mComm,
        total: round2(e.pontos * mComm),
      }));
      medemTotal = round2(medemResult.reduce((t, l) => t + l.total, 0));
    }

    // ── SOLAR ── (placeholder, a implementar quando houver folha Solar)
    // if (solarTable) { ... }

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

    // Desbloqueio de comissões: reduz o total bruto à % escolhida e fica discriminado nas regras.
    if (forced && emp.forceCommissionsPct < 100) {
      const reduction = round2(gross * (1 - emp.forceCommissionsPct / 100));
      if (reduction > 0) {
        ruleEffects.push({ id: 0, name: `Desbloqueio comissões ${emp.forceCommissionsPct}%`, type: "unlock", amount: -reduction });
      }
    }

    // Penalidades VNC: subtraídas ao total; ficam discriminadas nas regras.
    const personVncs = vncsByEmployee.get(sellerId) ?? [];
    for (const v of personVncs) {
      if (v.amount > 0) ruleEffects.push({ id: v.id, name: `VNC ${v.idVenda}`, type: "vnc", amount: -v.amount });
    }

    const rulesDelta = round2(ruleEffects.reduce((t, e) => t + e.amount, 0));

    people.push({
      ...base,
      bandSales: resTable ? mine.filter((e) => e.hasBTN).length : 0,
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
      allSaleIds: mine.map((e) => e.idVenda),
      unit: band ? { luz: band.luz ?? 0, gas: band.gas ?? 0, dd: band.dd ?? 0, fe: band.fe ?? 0, pel: band.pel ?? 0 } : null,
      gross,
      chargeback,
      due: round2(gross - chargeback + rulesDelta + medemTotal),
      lines,
      chargebackLines: cbLines,
      ruleEffects,
      vncs: personVncs,
      overridesOut: overridesOut.get(sellerId) ?? [],
      overridesIn: overridesIn.get(sellerId) ?? [],
      medemLines: medemResult,
      medemPontos,
      medemTotal,
    });
  }

  people.sort((a, b) => a.employeeName.localeCompare(b.employeeName));

  return {
    month: m,
    unmatchedAuto,
    unmatchedChargeback,
    unmatchedMedem,
    people,
    totals: {
      gross: round2(people.reduce((s, p) => s + p.gross, 0)),
      chargeback: round2(people.reduce((s, p) => s + p.chargeback, 0)),
      due: round2(people.reduce((s, p) => s + p.due, 0)),
      missingTable: people.filter((p) => p.missingTable).length,
      medemTotal: round2(people.reduce((s, p) => s + p.medemTotal, 0)),
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

    const map = new Map<string, { auto: number; chargeback: number; medem: number }>();
    for (const c of counts) {
      const e = map.get(String(c.importId)) ?? { auto: 0, chargeback: 0, medem: 0 };
      if (c.sheet === "auto") e.auto = Number(c.count);
      else if (c.sheet === "chargeback") e.chargeback = Number(c.count);
      else if (c.sheet === "medem") e.medem = Number(c.count);
      map.set(String(c.importId), e);
    }

    return imports.map((i) => ({ ...i, auto: map.get(String(i.id))?.auto ?? 0, chargeback: map.get(String(i.id))?.chargeback ?? 0, medem: map.get(String(i.id))?.medem ?? 0, downloadable: !!i.path }));
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

  /** Define o desbloqueio de comissões de um comercial: 0 (objetivo) ou 25/50/75/100 (% do 2.º escalão). */
  forceCommissionsSet: requireEdit("auto-iberdrola")
    .input(z.object({ employeeId: z.number().int().positive(), pct: z.number().int().refine((v) => [0, 25, 50, 75, 100].includes(v), "Percentagem inválida.") }))
    .handler(async ({ input }) => {
      const [emp] = await db.select({ id: employees.id }).from(employees).where(eq(employees.id, input.employeeId));
      if (!emp) return { found: false as const, forceCommissionsPct: 0 };
      await db.update(employees).set({ forceCommissionsPct: input.pct }).where(eq(employees.id, input.employeeId));
      return { found: true as const, employeeId: input.employeeId, forceCommissionsPct: input.pct };
    }),

  /** Adiciona uma penalidade VNC a um comercial num mês. */
  vncAdd: requireEdit("auto-iberdrola")
    .input(z.object({ month, employeeId: z.number().int().positive(), idVenda: z.string().trim().min(1), amount: z.number().positive() }))
    .handler(async ({ input }) => {
      const [emp] = await db.select({ id: employees.id }).from(employees).where(eq(employees.id, input.employeeId));
      if (!emp) return { found: false as const };
      const [row] = await db.insert(vncPenalties).values({ month: input.month, employeeId: input.employeeId, idVenda: input.idVenda, amount: input.amount }).returning();
      return { found: true as const, vnc: { id: row.id, idVenda: row.idVenda, amount: row.amount } };
    }),

  /** Remove uma penalidade VNC. */
  vncRemove: requireEdit("auto-iberdrola")
    .input(z.object({ id: z.number().int().positive() }))
    .handler(async ({ input }) => {
      await db.delete(vncPenalties).where(eq(vncPenalties.id, input.id));
      return { removed: true };
    }),

  /** Lista todos os colaboradores, para escolher o destino de uma troca de venda. */
  staffList: requireView("auto-iberdrola")
    .input(z.object({ month: z.string().optional() }))
    .handler(async () => {
      const rows = await db.select({ id: employees.id, name: employees.name }).from(employees);
      return rows
        .map((r) => ({ employeeId: r.id, employeeName: r.name }))
        .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
    }),

  /** Lista as trocas de venda (overrides) do mês. */
  overrideList: requireView("auto-iberdrola")
    .input(z.object({ month }))
    .handler(async ({ input }) => {
      const rows = await db.select().from(iberdrolaOverrides).where(eq(iberdrolaOverrides.month, input.month));
      const staff = await db.select({ id: employees.id, name: employees.name }).from(employees);
      const names = new Map(staff.map((s) => [s.id, s.name]));
      return rows.map((r) => ({
        id: r.id,
        idVenda: r.idVenda,
        fromEmployeeId: r.fromEmployeeId,
        fromName: names.get(r.fromEmployeeId) ?? `#${r.fromEmployeeId}`,
        toEmployeeId: r.toEmployeeId,
        toName: names.get(r.toEmployeeId) ?? `#${r.toEmployeeId}`,
      }));
    }),

  /** Troca uma venda de um comercial para outro no mês. */
  overrideCreate: requireEdit("auto-iberdrola")
    .input(z.object({ month, idVenda: z.string().trim().min(1), fromEmployeeId: z.number().int().positive(), toEmployeeId: z.number().int().positive() }))
    .handler(async ({ input }) => {
      if (input.fromEmployeeId === input.toEmployeeId) return { error: "Origem e destino são iguais." as const };
      const [row] = await db.insert(iberdrolaOverrides).values(input).returning();
      return { created: row };
    }),

  /** Remove uma troca de venda (desfaz). */
  overrideRemove: requireEdit("auto-iberdrola")
    .input(z.object({ id: z.number().int().positive() }))
    .handler(async ({ input }) => {
      await db.delete(iberdrolaOverrides).where(eq(iberdrolaOverrides.id, input.id));
      return { removed: true };
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
  sheet: "auto" | "chargeback" | "medem",
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
  const out: { sheet: "auto" | "chargeback" | "medem"; rowIndex: number; idVenda: string | null; estado: string | null; data: Record<string, string | null> }[] = [];
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

    const rows: { sheet: "auto" | "chargeback" | "medem"; rowIndex: number; idVenda: string | null; estado: string | null; data: Record<string, string | null> }[] = [];
    for (const want of ["auto", "chargeback", "medem"] as const) {
      const sn = sheetName(want);
      if (sn) rows.push(...parseSheet(wb, XLSX, sn, want));
    }
    if (!rows.length) return c.json({ error: "Não foram encontradas as folhas 'auto'/'chargeback'/'medem' neste ficheiro. neste ficheiro." }, 422);

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

  // Exportar Excel geral dos autos do mês (uma folha por comercial).
  app.get("/api/iberdrola/export-excel/:month", async (c) => {
    const ctx = await resolveCtx(c.req.raw.headers);
    if (!ctx) return c.json({ error: "Sem sessão" }, 401);
    if (!ctx.permissions["auto-iberdrola"]?.view) return c.json({ error: "Sem permissão" }, 403);

    const m = decodeURIComponent(c.req.param("month"));
    if (!/^\d{4}-\d{2}$/.test(m)) return c.json({ error: "Mês inválido" }, 400);

    const calc = await buildCalc(m);
    if (!calc.people.length) return c.json({ error: "Sem autos neste mês" }, 404);

    const XLSX = (await import("xlsx")) as unknown as {
      utils: { aoa_to_sheet: (data: unknown[][]) => unknown; book_new: () => unknown; book_append_sheet: (wb: unknown, ws: unknown, name: string) => void };
      write: (wb: unknown, opts: unknown) => Buffer;
    };

    const wb = XLSX.utils.book_new();
    const maxSheetLen = 31;

    for (const p of calc.people) {
      const rows: unknown[][] = [];

      rows.push([p.employeeName]);
      rows.push([`Tabela: ${p.tableName ?? "Sem tabela"}`, "", `Mês: ${m}`]);
      rows.push(["Escalão", String(p.bandSales), "", "Gross", `${p.gross.toFixed(2)} €`, "", "Devido", `${p.due.toFixed(2)} €`]);
      rows.push(["Vendas", String(p.salesCount), "", "Chargeback", `${p.chargeback.toFixed(2)} €`]);
      rows.push([]);

      rows.push(["--- ESCALÃO ATINGIDO ---"]);
      rows.push(["Item", "Valor unitário", "Qtd", "Total"]);
      if (p.unit) {
        rows.push(["Luz", `${p.unit.luz.toFixed(2)} €`, p.luzCount, `${(p.unit.luz * p.luzCount).toFixed(2)} €`]);
        rows.push(["Gás", `${p.unit.gas.toFixed(2)} €`, p.gasCount, `${(p.unit.gas * p.gasCount).toFixed(2)} €`]);
        if (p.ddCount > 0) rows.push(["Débito Direto", `${p.unit.dd.toFixed(2)} €`, p.ddCount, `${(p.unit.dd * p.ddCount).toFixed(2)} €`]);
        if (p.feCount > 0) rows.push(["Fatura Eletrónica", `${p.unit.fe.toFixed(2)} €`, p.feCount, `${(p.unit.fe * p.feCount).toFixed(2)} €`]);
        if (p.pelCount > 0) rows.push(["PEL", `${p.unit.pel.toFixed(2)} €`, p.pelCount, `${(p.unit.pel * p.pelCount).toFixed(2)} €`]);
      } else {
        rows.push(["(sem escalão)"]);
      }
      rows.push([]);

      if (p.ruleEffects.length > 0) {
        rows.push(["--- REGRAS APLICADAS ---"]);
        rows.push(["Regra", "Tipo", "Valor"]);
        for (const r of p.ruleEffects) {
          const tipo = r.type === "auto" ? "Automática" : r.type === "unlock" ? "Desbloqueio" : r.type === "vnc" ? "VNC" : "Manual";
          rows.push([r.name, tipo, `${r.amount.toFixed(2)} €`]);
        }
        rows.push([]);
      }

      if (p.vncs.length > 0) {
        rows.push(["--- PENALIDADES VNC ---"]);
        rows.push(["ID Venda", "Valor"]);
        for (const v of p.vncs) rows.push([v.idVenda, `${v.amount.toFixed(2)} €`]);
        rows.push([]);
      }

      if (p.overridesOut.length > 0 || p.overridesIn.length > 0) {
        rows.push(["--- TROCAS DE VENDA ---"]);
        rows.push(["ID Venda", "Direção", "Comercial"]);
        for (const o of p.overridesOut) rows.push([o.idVenda, "Cedida →", o.toName]);
        for (const o of p.overridesIn) rows.push([o.idVenda, "← Recebida", o.fromName]);
        rows.push([]);
      }

      rows.push(["--- VENDAS ---"]);
      rows.push(["ID venda", "Serviço", "Base (€)", "Déb. Direto", "Fat. Eletrónica", "PEL", "Total"]);
      for (const l of p.lines) {
        rows.push([l.idVenda, l.service, l.base.toFixed(2), (l.dd || ""), (l.fe || ""), (l.pel || ""), l.total.toFixed(2)]);
      }
      const baseSum = p.lines.reduce((s, l) => s + l.base, 0);
      const ddSum = p.lines.reduce((s, l) => s + l.dd, 0);
      const feSum = p.lines.reduce((s, l) => s + l.fe, 0);
      const pelSum = p.lines.reduce((s, l) => s + l.pel, 0);
      const totalSum = p.lines.reduce((s, l) => s + l.total, 0);
      rows.push(["TOTAL", `${p.lines.length} linhas`, baseSum.toFixed(2), ddSum.toFixed(2), feSum.toFixed(2), pelSum.toFixed(2), totalSum.toFixed(2)]);
      rows.push([]);

      if (p.chargebackLines.length > 0) {
        rows.push(["--- CHARGEBACK ---"]);
        rows.push(["ID venda", "Serviço", "Base (€)", "Déb. Direto", "Fat. Eletrónica", "PEL", "Total"]);
        for (const l of p.chargebackLines) {
          rows.push([l.idVenda, l.service, l.base.toFixed(2), (l.dd || ""), (l.fe || ""), (l.pel || ""), l.total.toFixed(2)]);
        }
        const cbSum = p.chargebackLines.reduce((s, l) => s + l.total, 0);
        rows.push(["TOTAL", `${p.chargebackLines.length} linhas`, "", "", "", "", cbSum.toFixed(2)]);
      }

      if (p.medemLines && p.medemLines.length > 0) {
        rows.push([]);
        rows.push(["--- MEDEM ---"]);
        rows.push(["ID venda", "Pontos", "Comissão (€/ponto)", "Total"]);
        for (const l of p.medemLines) {
          rows.push([l.idVenda, l.pontos, l.commission.toFixed(2), l.total.toFixed(2)]);
        }
        rows.push(["TOTAL", `${p.medemLines.length} linhas`, "", p.medemTotal.toFixed(2)]);
      }

      const ws = XLSX.utils.aoa_to_sheet(rows);
      const sheetName = p.employeeName.slice(0, maxSheetLen).replace(/[\\/*?:[\]]/g, "_");
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    return new Response(buf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`Auto_Iberdrola_${m}.xlsx`)}`,
      },
    });
  });

  // PDF detalhado por comercial (design bonito, via HTML → Chrome headless).
  app.get("/api/iberdrola/pdf/:month/:employeeId", async (c) => {
    const ctx = await resolveCtx(c.req.raw.headers);
    if (!ctx) return c.json({ error: "Sem sessão" }, 401);
    if (!ctx.permissions["auto-iberdrola"]?.view) return c.json({ error: "Sem permissão" }, 403);

    const m = decodeURIComponent(c.req.param("month"));
    if (!/^\d{4}-\d{2}$/.test(m)) return c.json({ error: "Mês inválido" }, 400);
    const empId = Number(decodeURIComponent(c.req.param("employeeId")));
    if (!Number.isInteger(empId) || empId <= 0) return c.json({ error: "Funcionário inválido" }, 400);

    const calc = await buildCalc(m);
    const p = calc.people.find((x) => x.employeeId === empId);
    if (!p) return c.json({ error: "Comercial sem autos neste mês" }, 404);

    let pdfBuf: Buffer;
    try {
      pdfBuf = buildIberdrolaPdf(p, m);
    } catch {
      return c.json({ error: "Erro ao gerar o PDF." }, 500);
    }

    const safeName = p.employeeName.replace(/[^a-zA-Z0-9À-ÿ\-_ ]/g, "").replace(/\s+/g, "_").slice(0, 40) || "comercial";
    return new Response(pdfBuf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(`Auto_Iberdrola_${safeName}_${m}.pdf`)}`,
      },
    });
  });
}

export { buildCalc };
