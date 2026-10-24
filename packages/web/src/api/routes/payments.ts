import { z } from "zod";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { requireView, requireEdit } from "../middleware/auth";
import { db } from "../database";
import { renderAutoPdf } from "../lib/auto-pdf";
import { writePublic } from "../lib/public-files";
import {
  clients,
  commissionRows,
  commissionTables,
  chiefRows,
  chiefTables,
  employeeTables,
  employees,
  payments,
  sales,
  saleStatusHistory,
  teamMemberships,
  teams,
} from "../database/schema";

const COUNTED_STATUS = "Em Fornecimento";

const month = z.string().regex(/^\d{4}-\d{2}$/, "Mês inválido.");

const rowInput = z.object({
  employeeId: z.number().int().positive("Escolha um funcionário."),
  month,
  kind: z.enum(["commission", "chief", "solar", "medem", "outro"]).default("commission"),
  amount: z.number().default(0),
  salesCount: z.number().min(0).default(0),
  paidOn: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."), z.literal(""), z.null()]).optional(),
  status: z.enum(["pago", "por_pagar"]).default("por_pagar"),
  pelQty: z.number().min(0).default(0),
  ddQty: z.number().min(0).default(0),
  feQty: z.number().min(0).default(0),
  extrasAmount: z.number().default(0),
  grossAmount: z.number().default(0),
  penaltyTiming: z.number().default(0),
  penaltyCampaign: z.number().default(0),
  kmDeduction: z.number().default(0),
  notes: z.string().trim().nullish(),
});

/** Normaliza a linha para gravação. */
const clean = (r: z.infer<typeof rowInput>) => ({
  employeeId: r.employeeId,
  month: r.month,
  kind: r.kind,
  amount: r.amount ?? 0,
  salesCount: r.salesCount ?? 0,
  paidOn: r.paidOn || null,
  status: r.paidOn ? "pago" : r.status === "pago" ? "pago" : "por_pagar",
  pelQty: r.pelQty ?? 0,
  ddQty: r.ddQty ?? 0,
  feQty: r.feQty ?? 0,
  extrasAmount: r.extrasAmount ?? 0,
  grossAmount: r.grossAmount ?? 0,
  penaltyTiming: r.penaltyTiming ?? 0,
  penaltyCampaign: r.penaltyCampaign ?? 0,
  kmDeduction: r.kmDeduction ?? 0,
  notes: r.notes || null,
});

/** Limites do mês. */
const bounds = (m: string) => {
  const from = `${m}-01`;
  const lastDay = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();
  const to = `${m}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
};

const yes = (v: unknown) => (typeof v === "string" ? v.toLowerCase() === "sim" : v === true);
/** Uma venda já resolvida para o cálculo. */
type Resolved = {
  saleId: number;
  number: string;
  clientName: string | null;
  service: string | null;
  campaign: string | null;
  luz: number;
  gas: number;
  extras: number;
  dd: boolean;
  fe: boolean;
  pel: boolean;
  total: number;
};

type DetailLine = {
  saleId: number;
  number: string;
  clientName: string | null;
  service: string;
  campaign: string | null;
  luz: number;
  gas: number;
  extras: number;
  penaltyHire: number;
  penaltyCampaign: number;
  total: number;
};

type PersonBlock = {
  employeeId: number;
  employeeName: string;
  role: "Comercial" | "Chefe de Equipa";
  roleKey: "vendedor" | "chefe";
  tableName: string | null;
  unit: number;
  bandSales: number;
  totalSales: number;
  luzCount: number;
  gasCount: number;
  pelQty: number;
  ddQty: number;
  feQty: number;
  extrasAmount: number;
  gross: number;
  chargeback: number;
  penaltyTiming: number;
  penaltyCampaign: number;
  kmDeduction: number;
  due: number;
  missingTable: boolean;
  lines: DetailLine[];
  chargebackLines: DetailLine[];
  notPaid: { number: string; service: string; status: string; value: number }[];
  team: { name: string; luz: number; gas: number }[];
};

type Breakdown = {
  month: string;
  from: string;
  to: string;
  people: PersonBlock[];
  totals: { due: number; gross: number; chargeback: number; extras: number; missingTable: number; pelQty: number; ddQty: number; feQty: number };
};

const SERVICE_LABEL: Record<string, string> = { LUZ: "Luz", "GÁS": "Gás", GAS: "Gás", DUAL: "Dual", SOLAR: "Solar" };

const serviceLabel = (s: string | null) => (s ? SERVICE_LABEL[s.toUpperCase()] ?? s : "-");

/** Nome de ficheiro seguro a partir do nome de uma pessoa. */
const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 40) || "comercial";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Numero de contrato da venda (campo details.contractNumber); "-" se faltar. */
const contract = (details: Record<string, unknown> | null) => {
  const v = details?.contractNumber;
  return typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" ? String(v) : "-";
};

/** Estado legível para a lista de vendas que não vêm a pagamento. */
const statusLabel = (s: string) => {
  const t = s.trim().toLowerCase();
  if (t === "baixa") return "Baixa";
  if (t === "manual") return "Manual";
  return s;
};

async function buildBreakdown(m: string): Promise<Breakdown> {
  const { from, to } = bounds(m);

  const hist = await db
    .select({
      saleId: saleStatusHistory.saleId,
      status: saleStatusHistory.status,
      on: saleStatusHistory.changedOn,
      sellerId: sales.sellerId,
      service: sales.service,
      details: sales.details,
      clientName: clients.name,
      energy: saleStatusHistory.energy,
    })
    .from(saleStatusHistory)
    .innerJoin(sales, eq(sales.id, saleStatusHistory.saleId))
    .leftJoin(clients, eq(clients.id, sales.clientId))
    .where(
      and(
        sql`${saleStatusHistory.status} in (${COUNTED_STATUS}, 'Baixa', 'Manual')`,
        sql`(
          (json_extract(${sales.details}, '$.voltageLevel') = 'BTN' AND ${sales.service} in ('LUZ', 'DUAL'))
          OR ${sales.service} = 'GÁS'
        )`,
      ),
    );

  /** Energia normalizada: "luz" | "gas". */
  const energy = (e: string | null) => (e === "gas" ? "gas" : "luz");
  const energyLabel = (k: "luz" | "gas") => (k === "gas" ? "Gás" : "Luz");

  type Entry = {
    sellerId: number | null;
    service: string | null;
    details: Record<string, unknown> | null;
    clientName: string | null;
    /** Por energia: quando entrou em fornecimento, e todas as baixas/manuais. */
    sup: Record<string, string | null>;
    baixa: Record<string, string[]>;
    manual: Record<string, string[]>;
  };

  const perSale = new Map<number, Entry>();
  for (const r of hist) {
    const e =
      perSale.get(r.saleId) ??
      ({
        sellerId: r.sellerId,
        service: r.service,
        details: r.details,
        clientName: r.clientName,
        sup: { luz: null, gas: null },
        baixa: { luz: [], gas: [] },
        manual: { luz: [], gas: [] },
      } as Entry);
    const k = energy(r.energy);
    if (r.status === COUNTED_STATUS) {
      if (!e.sup[k] || r.on < e.sup[k]!) e.sup[k] = r.on;
    } else if (r.status === "Baixa") {
      e.baixa[k].push(r.on);
    } else if (r.status === "Manual") {
      e.manual[k].push(r.on);
    }
    perSale.set(r.saleId, e);
  }

  /** Linha de uma venda numa energia concreta (Luz ou Gás). */
  type Lite = {
    saleId: number;
    number: string;
    service: string | null;
    details: Record<string, unknown> | null;
    clientName: string | null;
    /** Energia que esta linha representa. */
    energy: "luz" | "gas";
  };

  /** As energias que a venda realmente tem (LUZ -> luz; GÁS -> gas; DUAL -> ambas). */
  const energiesOf = (svc: string | null): ("luz" | "gas")[] => {
    const s = (svc ?? "").toUpperCase();
    if (s === "GÁS" || s === "GAS") return ["gas"];
    if (s === "DUAL") return ["luz", "gas"];
    return ["luz"];
  };

  const valid = new Map<number, Lite[]>();
  const chargeback = new Map<number, Lite[]>();
  const notPaid = new Map<number, { saleId: number; number: string; service: string | null; details: Record<string, unknown> | null; status: string; energy: "luz" | "gas" }[]>();

  for (const [saleId, e] of perSale) {
    if (e.sellerId == null) continue;
    const list = energiesOf(e.service);

    for (const k of list) {
      const lite: Lite = { saleId, number: contract(e.details), service: e.service, details: e.details, clientName: e.clientName, energy: k };
      const suppliedOn = e.sup[k];
      // Baixa DESTA energia, em qualquer momento (definitiva).
      const baixas = [...new Set(e.baixa[k])].sort();
      const firstBaixa = baixas[0] ?? null;
      const baixouAgora = baixas.some((d) => d >= from && d <= to);
      const manual = e.manual[k].some((d) => d >= from && d <= to);

      // Chargeback: ja tinha sido paga (em fornecimento antes deste mes) e a
      // baixa acontece dentro deste mes. Desconta-se no auto do mes da baixa.
      if (suppliedOn && suppliedOn < from && baixouAgora) {
        const l = chargeback.get(e.sellerId) ?? [];
        l.push(lite);
        chargeback.set(e.sellerId, l);
        continue;
      }

      // Vem a pagamento: entrou em fornecimento neste mes e ainda nao baixou.
      if (suppliedOn && suppliedOn >= from && suppliedOn <= to && !firstBaixa && !manual) {
        const l = valid.get(e.sellerId) ?? [];
        l.push(lite);
        valid.set(e.sellerId, l);
        continue;
      }

      // Tudo o resto: nao vem a pagamento.
      if (!suppliedOn || suppliedOn < from || suppliedOn > to || firstBaixa || manual) {
        const l = notPaid.get(e.sellerId) ?? [];
        const st = statusLabel(firstBaixa ? "Baixa" : e.manual[k].length ? "Manual" : "");
        l.push({ saleId, number: contract(e.details), service: e.service, details: e.details, status: st, energy: k });
        notPaid.set(e.sellerId, l);
      }
    }
  }

  const staff = await db
    .select({ id: employees.id, name: employees.name, isSeller: employees.isSeller, commissionTableId: employees.commissionTableId, chiefTableId: employees.chiefTableId })
    .from(employees);
  const cTables = await db.select().from(commissionTables);
  const cRows = await db.select().from(commissionRows).orderBy(asc(commissionRows.position));
  const kTables = await db.select().from(chiefTables);
  const kRows = await db.select().from(chiefRows).orderBy(asc(chiefRows.position));
  const assignments = await db.select().from(employeeTables);
  const memberships = await db.select().from(teamMemberships);
  const allTeams = await db.select({ id: teams.id, leaderId: teams.leaderId }).from(teams);

  const pick = <T extends { startDate: string; endDate: string | null }>(list: T[]) =>
    list
      .filter((a) => a.startDate <= to && (a.endDate == null || a.endDate >= from))
      .sort((x, y) => (x.startDate < y.startDate ? 1 : -1))[0];

  const teamOfChief = (chiefId: number) => {
    const led = allTeams.filter((t) => t.leaderId === chiefId).map((t) => t.id);
    const ids = new Set<number>([chiefId]);
    for (const m of memberships) {
      if (!led.includes(m.teamId)) continue;
      if (m.startDate > to || (m.endDate && m.endDate < from)) continue;
      ids.add(m.employeeId);
    }
    return ids;
  };

  const people: PersonBlock[] = [];

  type Band = { luz: number | null; gas: number | null; dd: number | null; fe: number | null; pel: number | null };

  const split = (e: Lite, band: Band | null): Resolved[] => {
    const d = e.details ?? {};
    const dd = yes(d.ddc);
    const fe = yes(d.fe);
    const pel = yes(d.pel);
    const extras = (dd ? band?.dd ?? 0 : 0) + (fe ? band?.fe ?? 0 : 0) + (pel ? band?.pel ?? 0 : 0);
    const luzCampaign = typeof d.campaign === "string" && d.campaign.trim() !== "" ? d.campaign : null;
    const gasCampaign = typeof d.campaignGas === "string" && d.campaignGas.trim() !== "" ? d.campaignGas : null;
    const base = { saleId: e.saleId, number: contract(d), clientName: e.clientName, extras, dd, fe, pel };
    // A energia vem da historia (venda+energia), nao do servico da venda:
    // numa DUAL a Luz e o Gas sao linhas independentes.
    if (e.energy === "gas") {
      return [{ ...base, service: "Gás", campaign: gasCampaign ?? luzCampaign, luz: 0, gas: band?.gas ?? 0, total: (band?.gas ?? 0) + extras }];
    }
    return [{ ...base, service: "Luz", campaign: luzCampaign, luz: band?.luz ?? 0, gas: 0, total: (band?.luz ?? 0) + extras }];
  };

  const toLine = (r: Resolved): DetailLine => ({
    saleId: r.saleId,
    number: r.number,
    clientName: r.clientName,
    service: serviceLabel(r.service),
    campaign: r.campaign,
    luz: r.luz,
    gas: r.gas,
    extras: r.extras,
    penaltyHire: 0,
    penaltyCampaign: 0,
    total: r.total,
  });

  const summarize = (lines: Resolved[], sales: Lite[]) => {
    const flag = (s: Lite, k: string) => yes((s.details ?? {})[k]);
    return {
      luzCount: lines.filter((i) => i.service === "Luz").length,
      gasCount: lines.filter((i) => i.service === "Gás").length,
      pelQty: sales.filter((s) => flag(s, "pel")).length,
      ddQty: sales.filter((s) => flag(s, "ddc")).length,
      feQty: sales.filter((s) => flag(s, "fe")).length,
      extrasAmount: round2(lines.reduce((s, i) => s + i.extras, 0)),
    };
  };

  // ---- Comerciais ----
  for (const s of staff) {
    if (!s.isSeller) continue;
    const mine = valid.get(s.id) ?? [];
    const cb = chargeback.get(s.id) ?? [];
    if (!mine.length && !cb.length) continue;

    const a = pick(assignments.filter((x) => x.employeeId === s.id && x.kind === "commission" && x.commissionTableId != null));
    const tableId = a?.commissionTableId ?? s.commissionTableId;
    const table = cTables.find((t) => t.id === tableId) ?? null;

    const base: PersonBlock = {
      employeeId: s.id,
      employeeName: s.name,
      role: "Comercial",
      roleKey: "vendedor",
      tableName: table?.name ?? null,
      unit: 0,
      bandSales: 0,
      totalSales: mine.length,
      luzCount: 0,
      gasCount: 0,
      pelQty: 0,
      ddQty: 0,
      feQty: 0,
      extrasAmount: 0,
      gross: 0,
      chargeback: 0,
      penaltyTiming: 0,
      penaltyCampaign: 0,
      kmDeduction: 0,
      due: 0,
      missingTable: !table,
      lines: [],
      chargebackLines: [],
      notPaid: (notPaid.get(s.id) ?? []).map((n) => ({ number: n.number, service: serviceLabel(n.service), status: n.status, value: 0 })),
      team: [],
    };

    if (!table) {
      people.push(base);
      continue;
    }

    const bands = cRows.filter((r) => r.tableId === table.id && r.kind === "clients");
    const bandSales = mine.filter((e) => e.energy === "luz").length;
    const band =
      bands.find((b) => bandSales >= (b.min ?? 0) && (b.max == null || bandSales <= b.max)) ??
      [...bands.filter((b) => b.max == null && bandSales >= (b.min ?? 0))].pop() ??
      null;

    const blocked = table.blockedSales ?? 0;
    const ordered = mine.slice();
    const paidSales = ordered.slice(Math.min(blocked, ordered.length));
    const resolved = paidSales.flatMap((e) => split(e, band));
    const cbResolved = cb.flatMap((e) => split(e, band));

    const gross = round2(resolved.reduce((sum, e) => sum + e.total, 0));
    const cbValue = round2(cbResolved.reduce((sum, e) => sum + e.total, 0));
    const sum = summarize(resolved, paidSales);

    people.push({
      ...base,
      unit: band?.luz ?? 0,
      bandSales,
      totalSales: resolved.length,
      ...sum,
      gross,
      chargeback: cbValue,
      due: round2(gross - cbValue),
      lines: resolved.map(toLine),
      chargebackLines: cbResolved.map(toLine),
      notPaid: (notPaid.get(s.id) ?? []).map((n) => {
        const tot = split({ saleId: n.saleId, number: n.number, service: n.service, details: n.details, clientName: null, energy: n.energy }, band).reduce((sum, l) => sum + l.total, 0);
        return { number: n.number, service: energyLabel(n.energy), status: n.status, value: round2(tot) };
      }),
    });
  }

  // ---- Chefes de equipa ----
  for (const s of staff) {
    const a = pick(assignments.filter((x) => x.employeeId === s.id && x.kind === "chief" && x.chiefTableId != null));
    const tableId = a?.chiefTableId ?? s.chiefTableId;
    if (tableId == null) continue;
    const table = kTables.find((t) => t.id === tableId) ?? null;
    if (!table) continue;

    const ids = teamOfChief(s.id);
    const teamSales: Lite[] = [];
    const teamMembers: { name: string; luz: number; gas: number }[] = [];
    for (const id of ids) {
      const list = valid.get(id) ?? [];
      teamSales.push(...list);
      const member = staff.find((x) => x.id === id);
      if (member) {
        teamMembers.push({
          name: id === s.id ? `${member.name} (chefe)` : member.name,
          luz: list.filter((e) => e.energy === "luz").length,
          gas: list.filter((e) => e.energy === "gas").length,
        });
      }
    }
    teamMembers.sort((x, y) => y.luz + y.gas - (x.luz + x.gas));

    const bandSales = teamSales.filter((e) => e.energy === "luz").length;
    const own = valid.get(s.id) ?? [];
    const ownSales = own.filter((e) => e.energy === "luz").length;
    if (!bandSales && !ownSales) continue;

    const bands = kRows.filter((r) => r.tableId === table.id && r.kind === "team");
    const band =
      bands.find((b) => bandSales >= (b.min ?? 0) && (b.max == null || bandSales <= b.max)) ??
      [...bands.filter((b) => b.max == null && bandSales >= (b.min ?? 0))].pop() ??
      null;

    const ownBands = kRows.filter((r) => r.tableId === table.id && r.kind === "own");
    const ownBand =
      ownBands.find((b) => ownSales >= (b.min ?? 0) && (b.max == null || ownSales <= b.max)) ??
      [...ownBands.filter((b) => b.max == null && ownSales >= (b.min ?? 0))].pop() ??
      null;

    const blocked = table.blockedSales ?? 0;
    const teamPaid = teamSales.slice(Math.min(blocked, teamSales.length));
    const resolved = teamPaid.flatMap((e) => split(e, band)).concat(own.flatMap((e) => split(e, ownBand)));

    let cbValue = 0;
    const cbResolved: Resolved[] = [];
    for (const id of ids) for (const e of chargeback.get(id) ?? []) cbResolved.push(...split(e, band));
    for (const e of chargeback.get(s.id) ?? []) cbResolved.push(...split(e, ownBand));
    cbValue = round2(cbResolved.reduce((sum, e) => sum + e.total, 0));

    const gross = round2(resolved.reduce((sum, e) => sum + e.total, 0));
    const sum = summarize(resolved, teamPaid.concat(own));

    people.push({
      employeeId: s.id,
      employeeName: s.name,
      role: "Chefe de Equipa",
      roleKey: "chefe",
      tableName: table.name,
      unit: band?.luz ?? 0,
      bandSales,
      totalSales: teamPaid.length + own.length,
      ...sum,
      gross,
      chargeback: cbValue,
      penaltyTiming: 0,
      penaltyCampaign: 0,
      kmDeduction: 0,
      due: round2(gross - cbValue),
      missingTable: false,
      lines: resolved.map(toLine),
      chargebackLines: cbResolved.map(toLine),
      notPaid: (notPaid.get(s.id) ?? []).map((n) => {
        const tot = split({ saleId: n.saleId, number: n.number, service: n.service, details: n.details, clientName: null, energy: n.energy }, ownBand ?? band).reduce((sum, l) => sum + l.total, 0);
        return { number: n.number, service: energyLabel(n.energy), status: n.status, value: round2(tot) };
      }),
      team: teamMembers,
    });
  }

  people.sort((a, b) => b.due - a.due);

  const totals = {
    due: round2(people.reduce((s, r) => s + r.due, 0)),
    gross: round2(people.reduce((s, r) => s + r.gross, 0)),
    chargeback: round2(people.reduce((s, r) => s + r.chargeback, 0)),
    extras: round2(people.reduce((s, r) => s + r.extrasAmount, 0)),
    missingTable: people.filter((r) => r.missingTable).length,
    pelQty: people.reduce((s, r) => s + r.pelQty, 0),
    ddQty: people.reduce((s, r) => s + r.ddQty, 0),
    feQty: people.reduce((s, r) => s + r.feQty, 0),
  };

  return { month: m, from, to, people, totals };
}

/** Aplica os valores manuais (penalizações, km, extras) por cima do cálculo automático. */
function applyOverrides(people: PersonBlock[], rows: {
  employeeId: number;
  grossAmount: number;
  extrasAmount: number;
  pelQty: number;
  ddQty: number;
  feQty: number;
  penaltyTiming: number;
  penaltyCampaign: number;
  kmDeduction: number;
}[]) {
  for (const p of people) {
    const o = rows.find((r) => r.employeeId === p.employeeId);
    if (!o) continue;
    if (o.grossAmount) p.gross = round2(o.grossAmount);
    if (o.extrasAmount) p.extrasAmount = round2(o.extrasAmount);
    if (o.pelQty) p.pelQty = o.pelQty;
    if (o.ddQty) p.ddQty = o.ddQty;
    if (o.feQty) p.feQty = o.feQty;
    p.penaltyTiming = round2(o.penaltyTiming || 0);
    p.penaltyCampaign = round2(o.penaltyCampaign || 0);
    p.kmDeduction = round2(o.kmDeduction || 0);
    p.due = round2(p.gross - p.chargeback - p.penaltyTiming - p.penaltyCampaign - p.kmDeduction);
  }
}

export const paymentsRoute = {
  list: requireView("pagamentos").handler(async () => {
    const rows = await db
      .select({
        id: payments.id,
        employeeId: payments.employeeId,
        employeeName: employees.name,
        month: payments.month,
        kind: payments.kind,
        amount: payments.amount,
        salesCount: payments.salesCount,
        paidOn: payments.paidOn,
        status: payments.status,
        pelQty: payments.pelQty,
        ddQty: payments.ddQty,
        feQty: payments.feQty,
        extrasAmount: payments.extrasAmount,
        grossAmount: payments.grossAmount,
        penaltyTiming: payments.penaltyTiming,
        penaltyCampaign: payments.penaltyCampaign,
        kmDeduction: payments.kmDeduction,
        pdfKey: payments.pdfKey,
        pdfName: payments.pdfName,
        notes: payments.notes,
      })
      .from(payments)
      .leftJoin(employees, eq(employees.id, payments.employeeId))
      .orderBy(desc(payments.month), asc(employees.name));
    return rows.map((r) => ({ ...r, employeeName: r.employeeName ?? "—" }));
  }),

  save: requireEdit("pagamentos")
    .input(rowInput.extend({ id: z.number().int().positive().optional() }))
    .handler(async ({ input }) => {
      const data = clean(input);
      if (input.id) {
        await db.update(payments).set(data).where(eq(payments.id, input.id));
        return { id: input.id };
      }
      const [row] = await db.insert(payments).values(data).returning({ id: payments.id });
      return { id: row.id };
    }),

  remove: requireEdit("pagamentos")
    .input(z.object({ id: z.number().int().positive() }))
    .handler(async ({ input }) => {
      await db.delete(payments).where(eq(payments.id, input.id));
      return { ok: true };
    }),

  /** Cálculo resumido (mantém o formato antigo: rows + totals). */
  calc: requireView("pagamentos")
    .input(z.object({ month }))
    .handler(async ({ input }) => {
      const b = await buildBreakdown(input.month);
      const saved = await db.select().from(payments).where(eq(payments.month, input.month));
      applyOverrides(b.people, saved);

      const rows = b.people.map((p) => ({
        employeeId: p.employeeId,
        employeeName: p.employeeName,
        role: p.roleKey,
        tableName: p.tableName,
        sales: p.totalSales,
        bandSales: p.bandSales,
        unit: p.unit,
        gross: p.gross,
        chargeback: p.chargeback,
        due: p.due,
        penaltyTiming: p.penaltyTiming,
        penaltyCampaign: p.penaltyCampaign,
        kmDeduction: p.kmDeduction,
        missingTable: p.missingTable,
        detail: { luz: p.luzCount, gas: p.gasCount, other: 0, chargebackSales: p.chargebackLines.length },
      }));

      const totals = {
        due: round2(rows.reduce((s, r) => s + r.due, 0)),
        gross: round2(rows.reduce((s, r) => s + r.gross, 0)),
        chargeback: round2(rows.reduce((s, r) => s + r.chargeback, 0)),
        missingTable: rows.filter((r) => r.missingTable).length,
      };
      return { month: input.month, from: b.from, to: b.to, rows, totals };
    }),

  /** Detalhe completo por pessoa/venda — usado no ecrã e no PDF. */
  breakdown: requireView("pagamentos")
    .input(z.object({ month }))
    .handler(async ({ input }) => {
      const b = await buildBreakdown(input.month);
      const saved = await db.select().from(payments).where(eq(payments.month, input.month));
      applyOverrides(b.people, saved);
      return b;
    }),

  /**
   * Detalhe de uma pessoa, calculado a partir do breakdown (com overrides aplicados).
   */
  autoDetail: requireView("pagamentos")
    .input(z.object({ month, employeeId: z.number().int().positive() }))
    .handler(async ({ input }) => {
      const b = await buildBreakdown(input.month);
      const saved = await db.select().from(payments).where(eq(payments.month, input.month));
      applyOverrides(b.people, saved);
      const person = b.people.find((p) => p.employeeId === input.employeeId);
      if (!person) return { found: false as const, person: null };
      const row = saved.find((r) => r.employeeId === input.employeeId) ?? null;
      return {
        found: true as const,
        person,
        saved: row
          ? {
              id: row.id,
              amount: row.amount,
              paidOn: row.paidOn,
              status: row.status,
              penaltyTiming: row.penaltyTiming,
              penaltyCampaign: row.penaltyCampaign,
              kmDeduction: row.kmDeduction,
              notes: row.notes,
            }
          : null,
      };
    }),

  /**
   * Gera o PDF do auto de pagamento do mês.
   * Com `employeeId` gera só esse comercial; sem ele gera um auto por comercial (todos).
   * Guarda o ficheiro em public/uploads/autos/ e devolve o URL.
   */
  autoPdf: requireView("pagamentos")
    .input(z.object({ month, employeeId: z.number().int().positive().optional() }))
    .handler(async ({ input }) => {
      const b = await buildBreakdown(input.month);
      const saved = await db.select().from(payments).where(eq(payments.month, input.month));
      applyOverrides(b.people, saved);

      const people = input.employeeId ? b.people.filter((p) => p.employeeId === input.employeeId) : b.people;
      if (input.employeeId && !people.length) {
        return { ok: false as const, reason: "Sem vendas a pagamento para este funcionário no mês.", url: null, name: null, count: 0 };
      }
      if (!people.length) {
        return { ok: false as const, reason: "Sem vendas a pagamento neste mês.", url: null, name: null, count: 0 };
      }

      const pdf = await renderAutoPdf({ month: b.month, people }, people);

      const stamp = new Date().toISOString().slice(0, 10);
      const base = input.employeeId
        ? `auto-${slug(people[0].employeeName)}-${b.month}-${stamp}${people.length > 1 ? "-todos" : ""}`
        : `auto-todos-${b.month}-${stamp}`;
      const name = `${base}.pdf`;
      const filename = `${Date.now()}-${crypto.randomUUID()}.pdf`;
      const url = writePublic("autos", filename, pdf);

      return { ok: true as const, url, name, count: people.length, reason: null };
    }),
};
