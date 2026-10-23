import { SALE_COUNTED, SERVICE_LABELS } from "../shared/client-forms";
import { z } from "zod";
import { and, eq, gte, inArray, lte, notInArray, sql } from "drizzle-orm";
import { authed } from "../middleware/auth";
import { db } from "../database";
import { absences, candidates, clients, departments, employees, jobOpenings, sales, saleStatusHistory, salesTargets, teamMemberships, teams } from "../database/schema";
import { localWithPhotos } from "../lib/s3";
import { activeInMonth } from "../shared/hierarchy";
import { monthWorkdays } from "../shared/workdays";
import { matchesPlace } from "../shared/concelhos";

const FORECAST_COUNTED = ["Em Fornecimento", "Control", "Em Processo", "Prospeção", "Pedido", "Pendente", "Lead", "Não Contactado", "Agendado", "Orçamento Enviado", "Negociação", "Fechado", "Contrato Enviado", "Em Instalação", "Ativado"];
const FORECAST_EXCLUDED = ["Baixa", "Pedido de Baixa", "Anulado"];
const COUNTED = SALE_COUNTED;

/** Por defeito, os painéis, rankings e gráficos só contabilizam vendas LUZ e DUAL. */
const DEFAULT_SERVICES = ["LUZ", "DUAL"];
const servicesInput = z.array(z.enum(SERVICE_LABELS as [string, ...string[]])).min(1).optional();

/**
 * Vendedor(es) a filtrar: um id, uma equipa ou todos (null).
 * Numa equipa, cada venda conta para a equipa onde o vendedor estava na data da venda; o chefe conta sempre.
 */
type SellerScope = number | { teamId: number; leaderId: number | null } | null;

/** A venda pertence à equipa: é do chefe ou o vendedor era membro na data da venda. */
function inTeamAtSaleDate(teamId: number, leaderId: number | null) {
  return sql`(${sales.sellerId} = ${leaderId ?? -1} or exists (select 1 from team_memberships tm where tm.team_id = ${teamId} and tm.employee_id = ${sales.sellerId} and tm.start_date <= ${sales.date} and (tm.end_date is null or tm.end_date >= ${sales.date})))`;
}

function sellerWhere(scope: SellerScope) {
  if (scope == null) return undefined;
  if (typeof scope === "number") return eq(sales.sellerId, scope);
  return inTeamAtSaleDate(scope.teamId, scope.leaderId);
}

/** Ids de quem esteve na equipa em algum dia entre `from` e `to` (o chefe incluído). Usado nas metas. */
async function teamIdsInPeriod(scope: { teamId: number; leaderId: number | null }, from: string, to: string) {
  const m = await db
    .select({ id: teamMemberships.employeeId })
    .from(teamMemberships)
    .where(and(eq(teamMemberships.teamId, scope.teamId), lte(teamMemberships.startDate, to), sql`(${teamMemberships.endDate} is null or ${teamMemberships.endDate} >= ${from})`));
  return [...new Set([scope.leaderId, ...m.map((x) => x.id)].filter((x): x is number => x != null))];
}

/** Admin: funcionário escolhido; senão, a equipa escolhida; senão, todos. Vendedor: só o próprio. */
async function resolveScope(context: { role: string; employeeId?: number | null }, sellerId?: number | null, teamId?: number | null): Promise<SellerScope> {
  if (context.role === "vendedor") return context.employeeId ?? -1;
  if (context.role === "chefe") {
    if (!context.employeeId) return -1;
    const led = await db.select({ id: teams.id }).from(teams).where(eq(teams.leaderId, context.employeeId));
    if (!led.length) return context.employeeId;
    return { teamId: led[0].id, leaderId: context.employeeId };
  }
  if (sellerId) return sellerId;
  if (teamId) {
    const [t] = await db.select({ leaderId: teams.leaderId }).from(teams).where(eq(teams.id, teamId));
    return { teamId, leaderId: t?.leaderId ?? null };
  }
  return null;
}

/** Últimos `n` meses (YYYY-MM) até `end` inclusive (por defeito, o mês atual). */
function monthKeys(n: number, end?: string) {
  const out: string[] = [];
  const d = end ? new Date(Number(end.slice(0, 4)), Number(end.slice(5, 7)) - 1, 1) : new Date();
  d.setDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** Todas as chaves de mês (YYYY-MM) entre `start` e `end`, inclusive. */
function monthRangeKeys(start: string, end: string) {
  const out: string[] = [];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  const ey = Number(end.slice(0, 4));
  const em = Number(end.slice(5, 7));
  while ((y < ey || (y === ey && m <= em)) && out.length < 600) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** Agrupa variantes do mesmo comercializador (ex.: "Gold Energy" e "Goldenergy"). */
const SUPPLIER_ALIASES: [RegExp, string][] = [
  [/gold\s*energy/, "Goldenergy"],
  [/\bedp\b/, "EDP Comercial"],
  [/endesa/, "Endesa"],
  [/galp/, "Galp"],
  [/entrada\s*dire(c)?ta/, "Entrada Direta"],
  [/\bsu\s*ele(c)?tricidade/, "SU Eletricidade"],
  [/yes\s*energy/, "Yes Energy"],
  [/ibelectra/, "Ibelectra"],
  [/iberdrola/, "Iberdrola"],
  [/repsol/, "Repsol"],
  [/meo/, "MEO Energia"],
  [/luzboa/, "Luzboa"],
  [/coop[eé]rnico/, "Coopérnico"],
  [/plenitude|eni\b/, "Plenitude"],
  [/muon/, "Muon"],
  [/ylce/, "Ylce"],
  [/g9/, "G9 Energy"],
];
/** Estados que não entram na análise do antigo comercializador. */
const SUPPLIER_EXCLUDED = ["Baixa", "Pedido de Baixa", "Anulado"];

function normalizeSupplier(v: string | null) {
  const raw = (v ?? "").trim();
  if (!raw) return "Entrada Direta";
  const k = raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  for (const [re, name] of SUPPLIER_ALIASES) if (re.test(k)) return name;
  return raw;
}

/** Filtro de local da venda: distrito e/ou concelho (opcionais). */
type PlaceFilter = { district?: string | null; municipality?: string | null };

async function salesReport(months: number, sellerId: SellerScope, end?: string, services: string[] = DEFAULT_SERVICES, place: PlaceFilter = {}) {
  const sellerCond = sellerWhere(sellerId);
  // months = 0 → "todos os meses": desde a primeira venda no âmbito até ao mês escolhido.
  let keys: string[];
  if (months === 0) {
    const endKey = monthKeys(1, end)[0];
    const [first] = await db.select({ d: sql<string | null>`min(${sales.date})` }).from(sales).where(sellerCond);
    keys = monthRangeKeys((first?.d ?? `${endKey}-01`).slice(0, 7), endKey);
  } else {
    keys = monthKeys(months, end);
  }
  const from = `${keys[0]}-01`;
  const to = `${keys.at(-1)}-31`;
  const rows = await db
    .select({
      id: sales.id,
      date: sales.date,
      total: sales.total,
      status: sales.status,
      sellerId: sales.sellerId,
      sellerName: employees.name,
      sellerPhoto: employees.photoKey,
      clientId: sales.clientId,
      clientName: clients.name,
      service: sales.service,
      oldSupplier: sql<string | null>`json_extract(${sales.details}, '$.oldSupplier')`,
      ddc: sql<number | null>`json_extract(${sales.details}, '$.ddc')`,
      fe: sql<number | null>`json_extract(${sales.details}, '$.fe')`,
      svc: sql<number | null>`json_extract(${sales.details}, '$.pel')`,
      consent: sql<number | null>`json_extract(${sales.details}, '$.consent')`,
      district: sql<string | null>`json_extract(${sales.details}, '$.district')`,
      municipality: sql<string | null>`json_extract(${sales.details}, '$.municipality')`,
    })
    .from(sales)
    .innerJoin(clients, eq(clients.id, sales.clientId))
    .leftJoin(employees, eq(employees.id, sales.sellerId))
    .where(and(gte(sales.date, from), lte(sales.date, to), sellerCond, inArray(sales.service, services)))
    .then((list) => (place.district || place.municipality ? list.filter((r) => matchesPlace(r, place.district, place.municipality)) : list));
  const counted = rows.filter((r) => COUNTED.includes(r.status));
  const byMonth = keys.map((k) => {
    const m = counted.filter((r) => r.date.startsWith(k));
    return { month: k, total: m.reduce((s, r) => s + r.total, 0), orders: m.length };
  });
  const sellerMap = new Map<string, { name: string; photoKey: string | null; total: number; orders: number }>();
  const clientMap = new Map<number, { name: string; total: number; orders: number }>();
  const districtMap = new Map<string, number>();
  const concelhoMap = new Map<string, number>();
  for (const r of counted) {
    const sk = r.sellerName ?? "Sem vendedor";
    const s = sellerMap.get(sk) ?? { name: sk, photoKey: r.sellerPhoto, total: 0, orders: 0 };
    s.total += r.total;
    s.orders++;
    sellerMap.set(sk, s);
    const c = clientMap.get(r.clientId) ?? { name: r.clientName, total: 0, orders: 0 };
    c.total += r.total;
    c.orders++;
    clientMap.set(r.clientId, c);
    districtMap.set(r.district?.trim() || "Sem distrito", (districtMap.get(r.district?.trim() || "Sem distrito") ?? 0) + 1);
    concelhoMap.set(r.municipality?.trim() || "Sem concelho", (concelhoMap.get(r.municipality?.trim() || "Sem concelho") ?? 0) + 1);
  }
  const statusMap: Record<string, { count: number; total: number }> = {};
  for (const r of rows) {
    statusMap[r.status] ??= { count: 0, total: 0 };
    statusMap[r.status].count++;
    statusMap[r.status].total += r.total;
  }
  // Antigo comercializador (LUZ, DUAL e GÁS): vendas do período em todos os estados, exceto Baixa, Pedido de Baixa e Anulado.
  const supMap = new Map<string, { name: string; count: number; counted: number }>();
  for (const r of rows) {
    if (r.service !== "LUZ" && r.service !== "DUAL" && r.service !== "GÁS") continue;
    if (SUPPLIER_EXCLUDED.includes(r.status)) continue;
    const name = normalizeSupplier(r.oldSupplier);
    const x = supMap.get(name) ?? { name, count: 0, counted: 0 };
    x.count++;
    if (COUNTED.includes(r.status)) x.counted++;
    supMap.set(name, x);
  }
  const supTotal = [...supMap.values()].reduce((n, x) => n + x.count, 0);
  const total = counted.reduce((s, r) => s + r.total, 0);
  return {
    quality: await saleQuality(rows, end),
    byOldSupplier: [...supMap.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).map((x) => ({ ...x, share: supTotal ? x.count / supTotal : 0 })),
    byTeam: await teamRanking(counted, end),
    byMonth,
    bySeller: localWithPhotos([...sellerMap.values()].sort((a, b) => b.orders - a.orders)),
    topClients: [...clientMap.values()].sort((a, b) => b.orders - a.orders).slice(0, 8),
    byDistrict: [...districtMap.entries()].map(([name, orders]) => ({ name, orders })).sort((a, b) => b.orders - a.orders || a.name.localeCompare(b.name)),
    byConcelho: [...concelhoMap.entries()].map(([name, orders]) => ({ name, orders })).sort((a, b) => b.orders - a.orders || a.name.localeCompare(b.name)),
    byStatus: Object.entries(statusMap).map(([status, v]) => ({ status, ...v })),
    total,
    orders: counted.length,
    avgTicket: counted.length ? total / counted.length : 0,
  };
}

/** Percentagem de vendas com `value` num campo SIM/NÃO, sobre as vendas que têm esse campo respondido. */
function yesNoRate(rows: { [k: string]: unknown }[], key: string, value: 0 | 1) {
  const answered = rows.filter((r) => r[key] === 0 || r[key] === 1 || r[key] === "0" || r[key] === "1");
  const hits = answered.filter((r) => Number(r[key]) === value).length;
  return { hits, base: answered.length, rate: answered.length ? hits / answered.length : null };
}

/** Data ISO + `n` meses (o dia é ajustado ao fim do mês quando não existe, ex.: 30/11 + 3 → 28/02). */
function addMonthsIso(d: string, n: number) {
  const [y, m, day] = d.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, last));
  return t.toISOString().slice(0, 10);
}

/**
 * Chargeback e baixas, sobre as vendas registadas no período (com os filtros aplicados), pelo estado principal (luz):
 * - Chargeback: das vendas que chegaram a "Em Fornecimento", as que passaram a "Baixa" até 3 meses depois da primeira entrada em fornecimento.
 * - Baixas: das vendas registadas, as que estão ou estiveram em "Baixa". "Pedido de Baixa" não conta em nenhuma.
 */
async function churn(rows: { id: number; status: string }[], periodEnd?: string) {
  const ids = rows.map((r) => r.id);
  const hist = ids.length
    ? await db
        .select({ saleId: saleStatusHistory.saleId, status: saleStatusHistory.status, on: saleStatusHistory.changedOn })
        .from(saleStatusHistory)
        .where(and(inArray(saleStatusHistory.saleId, ids), eq(saleStatusHistory.energy, "luz"), inArray(saleStatusHistory.status, ["Em Fornecimento", "Baixa"])))
    : [];
  // Limite da janela de maturing: fim do período do relatório, ou hoje se não definido.
  const cutoff = periodEnd ? `${periodEnd}-31` : new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" });
  let supplied = 0;
  let chargeback = 0;
  let maturing = 0;
  let baixas = 0;
  for (const r of rows) {
    const h = hist.filter((x) => x.saleId === r.id);
    const baixaDates = h.filter((x) => x.status === "Baixa").map((x) => x.on);
    if (r.status === "Baixa" || baixaDates.length) baixas++;
    const first = h.filter((x) => x.status === "Em Fornecimento").map((x) => x.on).sort()[0];
    if (!first) continue;
    supplied++;
    const limit = addMonthsIso(first, 3);
    if (baixaDates.some((d) => d >= first && d <= limit)) chargeback++;
    else if (limit > cutoff) maturing++;
  }
  return {
    chargeback: { hits: chargeback, base: supplied, maturing, rate: supplied ? chargeback / supplied : null },
    baixas: { hits: baixas, base: rows.length, rate: rows.length ? baixas / rows.length : null },
  };
}

/**
 * Indicadores de qualidade sobre as vendas registadas no período (com os filtros aplicados),
 * excluindo as anuladas: taxa de DDC e de FE (SIM), taxa de Robinson (Consentimento = NÃO),
 * média de dias entre a data da venda e a primeira passagem a "Control", chargeback e baixas.
 */
const PEL_EXCLUDED = ["Baixa", "Pedido de Baixa", "Anulado"];

async function saleQuality(allRows: { id: number; date: string; status: string; ddc: unknown; fe: unknown; svc: unknown; consent: unknown }[], periodEnd?: string) {
  const rows = allRows.filter((r) => r.status !== "Anulado");
  const ids = rows.map((r) => r.id);
  const control = ids.length
    ? await db
        .select({ saleId: saleStatusHistory.saleId, on: sql<string>`min(${saleStatusHistory.changedOn})` })
        .from(saleStatusHistory)
        .where(and(inArray(saleStatusHistory.saleId, ids), eq(saleStatusHistory.status, "Control"), eq(saleStatusHistory.energy, "luz")))
        .groupBy(saleStatusHistory.saleId)
    : [];
  const byId = new Map(rows.map((r) => [r.id, r.date]));
  const days = control
    .map((c) => {
      const d = byId.get(c.saleId);
      return d ? Math.max(0, Math.round((Date.parse(`${c.on}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86400000)) : null;
    })
    .filter((x): x is number => x != null);
  const pelRows = allRows.filter((r) => !PEL_EXCLUDED.includes(r.status));
  return {
    registered: rows.length,
    ddc: yesNoRate(rows, "ddc", 1),
    fe: yesNoRate(rows, "fe", 1),
    pel: yesNoRate(pelRows, "svc", 1),
    robinson: yesNoRate(rows, "consent", 0),
    contractDays: days.length ? days.reduce((a, b) => a + b, 0) / days.length : null,
    contractBase: days.length,
    ...(await churn(rows, periodEnd)),
  };
}

/**
 * Ranking dos chefes de equipa: vendas contabilizadas do chefe e dos membros.
 * Cada venda conta para a equipa onde o vendedor estava na data da venda.
 */
async function teamRanking(counted: { sellerId: number | null; date: string }[], end?: string) {
  const list = await db
    .select({ id: teams.id, name: teams.name, color: teams.color, leaderId: teams.leaderId, leaderName: employees.name, photoKey: employees.photoKey })
    .from(teams)
    .leftJoin(employees, eq(employees.id, teams.leaderId));
  if (!list.length) return [];
  const members = await db.select().from(teamMemberships);
  // Conta os elementos de cada equipa no fim do período escolhido (fim do mês `end`).
  const asOf = end ? `${end}-31` : new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" });
  const rows = list.map((t) => {
    const mine = members.filter((m) => m.teamId === t.id);
    const memberCount = new Set(mine.filter((m) => m.startDate <= asOf && (m.endDate == null || m.endDate >= asOf)).map((m) => m.employeeId)).size;
    const orders = counted.filter(
      (r) => r.sellerId != null && (r.sellerId === t.leaderId || mine.some((m) => m.employeeId === r.sellerId && m.startDate <= r.date && (m.endDate == null || m.endDate >= r.date))),
    ).length;
    return { teamId: t.id, teamName: t.name, color: t.color, name: t.leaderName ?? "Sem chefe", photoKey: t.photoKey, memberCount, orders };
  });
  // Só entram equipas com vendas em fornecimento no período.
  return localWithPhotos(rows.filter((t) => t.orders > 0).sort((a, b) => b.orders - a.orders || a.teamName.localeCompare(b.teamName)));
}

/**
 * Relatório de RH. Com `month`, os funcionários contados são os que estiveram ativos nesse mês
 * (pela data de admissão e de inativação), as contratações vão até esse mês e as ausências são as desse mês.
 */
async function hrReport(month?: string) {
  const emps = await db
    .select({
      id: employees.id,
      status: employees.status,
      salary: employees.salary,
      hireDate: employees.hireDate,
      terminationDate: employees.terminationDate,
      departmentName: departments.name,
      departmentColor: departments.color,
    })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId));
  const active = month ? emps.filter((e) => activeInMonth(e, month)) : emps.filter((e) => e.status !== "inativo");
  const deptMap = new Map<string, { name: string; color: string; count: number; payroll: number }>();
  for (const e of active) {
    const k = e.departmentName ?? "Sem departamento";
    const d = deptMap.get(k) ?? { name: k, color: e.departmentColor ?? "#6b7280", count: 0, payroll: 0 };
    d.count++;
    d.payroll += e.salary;
    deptMap.set(k, d);
  }
  const year = new Date().getFullYear().toString();
  const abs = await db.select().from(absences).where(sql`substr(${absences.startDate},1,4) = ${year}`);
  const absMap: Record<string, number> = {};
  const absScope = month
    ? await db.select().from(absences).where(sql`substr(${absences.startDate},1,7) = ${month}`)
    : abs;
  for (const a of absScope.filter((a) => a.status === "aprovado")) absMap[a.type] = (absMap[a.type] ?? 0) + a.days;
  const keys = monthKeys(12, month);
  const hires = keys.map((k) => ({ month: k, count: emps.filter((e) => e.hireDate.startsWith(k)).length }));
  const exits = keys.map((k) => ({ month: k, count: emps.filter((e) => e.status === "inativo" && e.terminationDate?.startsWith(k)).length }));
  const today = new Date().toISOString().slice(0, 10);
  const outToday = abs.filter((a) => a.status === "aprovado" && a.startDate <= today && a.endDate >= today).length;
  const [{ openJobs }] = await db
    .select({ openJobs: sql<number>`count(*)` })
    .from(jobOpenings)
    .where(eq(jobOpenings.status, "aberta"));
  const [{ pipeline }] = await db
    .select({ pipeline: sql<number>`count(*)` })
    .from(candidates)
    .where(inArray(candidates.stage, ["candidatura", "triagem", "entrevista", "proposta"]));
  return {
    headcount: active.length,
    payroll: active.reduce((s, e) => s + e.salary, 0),
    byDepartment: [...deptMap.values()].sort((a, b) => b.count - a.count),
    absencesByType: Object.entries(absMap).map(([type, days]) => ({ type, days })),
    hires,
    exits,
    exitsInMonth: month ? (exits.find((x) => x.month === month)?.count ?? 0) : 0,
    hiresInMonth: month ? (hires.find((x) => x.month === month)?.count ?? 0) : 0,
    missingTermination: emps.filter((e) => e.status === "inativo" && !e.terminationDate).length,
    outToday,
    pendingAbsences: abs.filter((a) => a.status === "pendente").length,
    openJobs: Number(openJobs),
    pipeline: Number(pipeline),
  };
}

/* ---------- Evolução (diária, semanal, mensal) ---------- */

const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (s: string) => new Date(`${s}T00:00:00Z`);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const ddmm = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

type Bucket = { key: string; label: string; from: string; to: string };

/**
 * Períodos do gráfico de evolução, ancorados no mês escolhido:
 * diária = todos os dias do mês; semanal = 12 semanas (seg–dom) até ao fim do mês; mensal = 12 meses até ao mês.
 * No mês atual, o fim é hoje.
 */
function evolutionBuckets(granularity: "dia" | "semana" | "mes", month: string): Bucket[] {
  const today = iso(new Date());
  const first = utc(`${month}-01`);
  const last = addDays(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1)), -1);
  const end = iso(last) > today && `${month}-01` <= today ? utc(today) : last;
  if (granularity === "dia") {
    const out: Bucket[] = [];
    for (let d = first; d <= end; d = addDays(d, 1)) out.push({ key: iso(d), label: ddmm(d), from: iso(d), to: iso(d) });
    return out;
  }
  if (granularity === "semana") {
    const monday = addDays(end, -((end.getUTCDay() + 6) % 7));
    const out: Bucket[] = [];
    for (let i = 11; i >= 0; i--) {
      const a = addDays(monday, -7 * i);
      const b = addDays(a, 6);
      out.push({ key: iso(a), label: `${ddmm(a)}–${ddmm(b)}`, from: iso(a), to: iso(b) });
    }
    return out;
  }
  return monthKeys(12, month).map((k) => ({ key: k, label: `${MONTHS_PT[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`, from: `${k}-01`, to: `${k}-31` }));
}

/**
 * Datas em que as vendas passaram a "Em Fornecimento" (última entrada nesse estado, energia principal),
 * entre `from` e `to`. Só conta vendas que continuam em fornecimento; o vendedor/equipa e o tipo aplicam-se à venda.
 */
async function suppliedOn(from: string, to: string, scope: SellerScope, services: string[]) {
  const rows = await db
    .select({ on: sql<string>`max(${saleStatusHistory.changedOn})` })
    .from(saleStatusHistory)
    .innerJoin(sales, eq(sales.id, saleStatusHistory.saleId))
    .where(and(eq(saleStatusHistory.energy, "luz"), inArray(saleStatusHistory.status, COUNTED), notInArray(sales.status, FORECAST_EXCLUDED), sellerWhere(scope), inArray(sales.service, services)))
    .groupBy(saleStatusHistory.saleId);
  return rows.map((r) => r.on).filter((d) => d >= from && d <= to);
}

async function evolutionReport(granularity: "dia" | "semana" | "mes" | "todos", month: string, sellerId: SellerScope, services: string[] = DEFAULT_SERVICES) {
  let buckets: Bucket[];
  if (granularity === "todos") {
    // Todos os meses: desde a primeira venda no âmbito até ao mês escolhido.
    const [first] = await db.select({ d: sql<string | null>`min(${sales.date})` }).from(sales).where(sellerWhere(sellerId));
    buckets = monthRangeKeys((first?.d ?? `${month}-01`).slice(0, 7), month).map((k) => ({ key: k, label: `${MONTHS_PT[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`, from: `${k}-01`, to: `${k}-31` }));
  } else {
    buckets = evolutionBuckets(granularity, month);
  }
  const from = buckets[0].from;
  const to = buckets.at(-1)!.to;
  const rows = await db
    .select({ date: sales.date })
    .from(sales)
    .where(and(gte(sales.date, from), lte(sales.date, to), sellerWhere(sellerId), inArray(sales.service, services)));
  const supRows = await suppliedOn(from, to, sellerId, services);
  let cumIns = 0;
  let cumSup = 0;
  const series = buckets.map((b) => {
    const inserted = rows.filter((r) => r.date >= b.from && r.date <= b.to).length;
    const supplied = supRows.filter((d) => d >= b.from && d <= b.to).length;
    cumIns += inserted;
    cumSup += supplied;
    return { ...b, inserted, supplied, rate: inserted ? supplied / inserted : null, cumInserted: cumIns, cumSupplied: cumSup };
  });
  // Ritmo do mês escolhido (independente da granularidade): média por dia útil e previsão de fecho.
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" });
  const wd = monthWorkdays(month, today);
  const [{ n: mInsN }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(sales)
    .where(and(gte(sales.date, `${month}-01`), lte(sales.date, `${month}-31`), sellerWhere(sellerId), inArray(sales.service, services), notInArray(sales.status, FORECAST_EXCLUDED)));
  const mIns = Number(mInsN);
  const mSup = (await suppliedOn(`${month}-01`, `${month}-31`, sellerId, services)).length;
  const avgIns = wd.elapsed ? mIns / wd.elapsed : 0;
  const avgSup = wd.elapsed ? mSup / wd.elapsed : 0;
  const pace = {
    month,
    workdays: wd.total,
    elapsed: wd.elapsed,
    remaining: wd.remaining,
    holidays: wd.holidays,
    inserted: mIns,
    supplied: mSup,
    avgInserted: avgIns,
    avgSupplied: avgSup,
    forecastInserted: Math.round(mIns + avgIns * wd.remaining),
    forecastSupplied: Math.round(mSup + avgSup * wd.remaining),
  };
  const best = series.reduce<(typeof series)[number] | null>((m, x) => (x.inserted > (m?.inserted ?? 0) ? x : m), null);
  return {
    granularity,
    from,
    to,
    series,
    inserted: cumIns,
    supplied: cumSup,
    rate: cumIns ? cumSup / cumIns : null,
    avgInserted: series.length ? cumIns / series.length : 0,
    avgSupplied: series.length ? cumSup / series.length : 0,
    best: best ? { label: best.label, inserted: best.inserted } : null,
    pace,
  };
}

/** Metas a somar: as do vendedor, as de quem esteve na equipa nesse mês, ou todas. */
async function targetWhere(scope: SellerScope, month: string) {
  if (scope == null) return undefined;
  if (typeof scope === "number") return eq(salesTargets.sellerId, scope);
  const ids = await teamIdsInPeriod(scope, `${month}-01`, `${month}-31`);
  return ids.length ? inArray(salesTargets.sellerId, ids) : sql`0`;
}

export const reports = {
  evolution: authed
    .input(z.object({ granularity: z.enum(["dia", "semana", "mes", "todos"]), month: z.string().regex(/^\d{4}-\d{2}$/), sellerId: z.number().nullable().optional(), teamId: z.number().nullable().optional(), services: servicesInput }))
    .handler(async ({ input, context }) => {
      if (context.role === "rh") return null;
      return evolutionReport(input.granularity, input.month, await resolveScope(context, input.sellerId, input.teamId), input.services);
    }),
  dashboard: authed.input(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional(), months: z.number().int().min(0).max(240).optional(), sellerId: z.number().nullable().optional(), teamId: z.number().nullable().optional(), services: servicesInput }).optional()).handler(async ({ input, context }) => {
    const month = input?.month ?? new Date().toISOString().slice(0, 7);
    const showSales = context.role !== "rh";
    const showHr = context.role !== "vendedor";
    let salesData = null;
    let monthData = null;
    let target = 0;
    if (showSales) {
      const sellerId = await resolveScope(context, input?.sellerId, input?.teamId);
      salesData = await salesReport(input?.months ?? 6, sellerId, month, input?.services);
      monthData = await salesReport(1, sellerId, month, input?.services);
      const t = await db
        .select({ total: sql<number>`coalesce(sum(${salesTargets.target}),0)` })
        .from(salesTargets)
        .where(and(eq(salesTargets.month, month), await targetWhere(sellerId, month)));
      target = Number(t[0]?.total ?? 0);
    }
    // Contagem de vendas "Em Fornecimento" (as metas são por número de vendas).
    const monthTotal = salesData?.byMonth.find((m) => m.month === month)?.orders ?? 0;
    const prevMonth = salesData?.byMonth.at(-2)?.orders ?? 0;
    return {
      role: context.role,
      month,
      sales: salesData && monthData ? { ...salesData, monthTotal, prevMonth, target, month: monthData } : null,
      hr: showHr ? await hrReport() : null,
    };
  }),
  sales: authed
    .input(
      z.object({
        months: z.number().int().min(0).max(240),
        month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
        sellerId: z.number().nullable().optional(),
        teamId: z.number().nullable().optional(),
        services: servicesInput,
        district: z.string().max(80).nullable().optional(),
        municipality: z.string().max(80).nullable().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      if (context.role === "rh") return null;
      return salesReport(input.months, await resolveScope(context, input.sellerId, input.teamId), input.month, input.services, { district: input.district, municipality: input.municipality });
    }),
  hr: authed.input(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }).optional()).handler(async ({ input, context }) => {
    if (context.role === "vendedor") return null;
    return hrReport(input?.month);
  }),
  compare: authed
    .input(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional(), months: z.number().int().min(0).max(240).optional(), sellerId: z.number().nullable().optional(), teamId: z.number().nullable().optional(), services: servicesInput }))
    .handler(async ({ input, context }) => {
      if (context.role === "rh") return null;
      const scope = await resolveScope(context, input.sellerId, input.teamId);
      const month = input.month ?? new Date().toISOString().slice(0, 7);
      const months = input.months ?? 1;
      const svc = input.services;

      const summarize = async (key: string) => {
        const r = await salesReport(1, scope, key, svc);
        const registered = r.byStatus.reduce((s, x) => s + x.count, 0);
        return {
          key,
          orders: r.orders,
          registered,
          total: r.total,
          avgTicket: r.avgTicket,
          success: registered ? r.orders / registered : null,
          quality: r.quality,
        };
      };

      const [ref, prev, lastYear] = await Promise.all([summarize(month), summarize(shiftMonthKey(month, -1)), summarize(shiftMonthKey(month, -12))]);

      // Ano vs ano: meses de janeiro até ao mês escolhido, no ano atual e no anterior.
      const mIdx = Number(month.slice(5, 7));
      const prevYearKey = `${Number(month.slice(0, 4)) - 1}-${month.slice(5, 7)}`;
      const [curYear, prevYear] = await Promise.all([salesReport(mIdx, scope, month, svc), salesReport(mIdx, scope, prevYearKey, svc)]);

      // Equipas, vendedores, comercializador, local: mês a mês (mesmo período dos filtros de Vendas).
      const period = await salesReport(months, scope, month, svc);

      return {
        months: { ref, prev, lastYear },
        years: {
          current: { year: month.slice(0, 4), byMonth: curYear.byMonth, total: curYear.total, orders: curYear.orders, avgTicket: curYear.avgTicket },
          previous: { year: String(Number(month.slice(0, 4)) - 1), byMonth: prevYear.byMonth, total: prevYear.total, orders: prevYear.orders, avgTicket: prevYear.avgTicket },
        },
        teams: period.byTeam,
        sellers: period.bySeller,
        suppliers: period.byOldSupplier,
        statuses: period.byStatus,
        districts: period.byDistrict,
        concelhos: period.byConcelho,
      };
    }),
};

/** Desloca uma chave de mês `YYYY-MM` em `n` meses (positivo ou negativo). */
function shiftMonthKey(key: string, n: number) {
  const d = new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
