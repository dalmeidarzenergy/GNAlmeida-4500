import { z } from "zod";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { requireView, requireEdit } from "../middleware/auth";
import { db } from "../database";
import { renderAutoPdf } from "../lib/auto-pdf";
import { writePublic } from "../lib/public-files";
import {
  chiefRows,
  chiefTables,
  clients,
  commissionRows,
  commissionTables,
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

/** Diferença em meses corridos entre duas strings YYYY-MM. */
const deltaMonths = (a: string, b: string) => {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
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
  forceCommissions: boolean;
  lines: DetailLine[];
  chargebackLines: DetailLine[];
  notPaid: { number: string; service: string; status: string; value: number }[];
  transit: { number: string; service: string; status: string; signedOn: string | null; value: number }[];
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
  // 6 meses antes do início do mês — janela suficiente para chargeback (3 meses)
  // e para capturar fornecementos que ainda interessam ao cálculo.
  const [fy, fm] = from.split("-").map(Number);
  const cutoff = new Date(fy, fm - 7, 1).toISOString().slice(0, 10);

  const hist = await db
    .select({
      saleId: saleStatusHistory.saleId,
      status: saleStatusHistory.status,
      on: saleStatusHistory.changedOn,
      sellerId: sales.sellerId,
      service: sales.service,
      details: sales.details,
      signedOn: sales.date,
      clientName: clients.name,
      energy: saleStatusHistory.energy,
    })
    .from(saleStatusHistory)
    .innerJoin(sales, eq(sales.id, saleStatusHistory.saleId))
    .leftJoin(clients, eq(clients.id, sales.clientId))
    .where(
      and(
        sql`${saleStatusHistory.status} in (${COUNTED_STATUS}, 'Baixa', 'Manual', 'Anulado', 'Prospeção', 'Pré-Venda', 'Backoffice', 'Control', 'Pedido de Fornecimento', 'Pedido de Baixa')`,
        sql`(
          (json_extract(${sales.details}, '$.voltageLevel') = 'BTN' AND ${sales.service} in ('LUZ', 'DUAL'))
          OR ${sales.service} = 'GÁS'
        )`,
        sql`${saleStatusHistory.changedOn} >= ${cutoff} AND ${saleStatusHistory.changedOn} <= ${to}`,
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
    /** Anuladas por energia — nunca pagam nem dao chargeback. */
    anulado: Record<string, string[]>;
    /** Data de assinatura da venda. */
    signedOn: string | null;
    /** Todos os estados com a data, por energia (para vendas em transito). */
    hist: Record<string, { status: string; on: string }[]>;
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
        anulado: { luz: [], gas: [] },
        signedOn: r.signedOn,
        hist: { luz: [], gas: [] },
      } as Entry);
    const k = energy(r.energy);
    e.hist[k].push({ status: r.status, on: r.on });
    if (r.status === COUNTED_STATUS) {
      if (!e.sup[k] || r.on < e.sup[k]!) e.sup[k] = r.on;
    } else if (r.status === "Baixa") {
      e.baixa[k].push(r.on);
    } else if (r.status === "Manual") {
      e.manual[k].push(r.on);
    } else if (r.status === "Anulado") {
      e.anulado[k].push(r.on);
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
  type TransitLine = { saleId: number; number: string; service: string | null; details: Record<string, unknown> | null; status: string; signedOn: string | null; energy: "luz" | "gas" };
  const inTransit = new Map<number, TransitLine[]>();
  const notPaid = new Map<number, { saleId: number; number: string; service: string | null; details: Record<string, unknown> | null; status: string; energy: "luz" | "gas" }[]>();

  /** Estados que ainda nao chegaram a fornecimento — a venda transita de mes em mes. */
  const TRANSIT = new Set(["Prospeção", "Pré-Venda", "Backoffice", "Control", "Pedido de Fornecimento", "Pedido de Baixa"]);

  for (const [saleId, e] of perSale) {
    if (e.sellerId == null) continue;
    const list = energiesOf(e.service);

    for (const k of list) {
      const lite: Lite = { saleId, number: contract(e.details), service: e.service, details: e.details, clientName: e.clientName, energy: k };
      const suppliedOn = e.sup[k];
      // Baixa/Anulado DESTA energia, em qualquer momento (definitivas).
      const baixas = [...new Set(e.baixa[k])].sort();
      const anulados = [...new Set(e.anulado[k])].sort();
      const firstBaixa = baixas[0] ?? null;
      const firstAnulado = anulados[0] ?? null;
      const baixouAgora = baixas.some((d) => d >= from && d <= to);
      const anulouAgora = anulados.some((d) => d >= from && d <= to);
      const manual = e.manual[k].some((d) => d >= from && d <= to);

      // Mes de fornecimento — para saber se baixou, anulou ou teve Manual no proprio mes.
      const sm = suppliedOn ? suppliedOn.slice(0, 7) : "";
      const smB = sm ? bounds(sm) : null;
      const baixaNoMesSup = smB ? baixas.some((d) => d >= smB.from && d <= smB.to) : false;
      const manualNoMesSup = smB ? e.manual[k].some((d) => d >= smB.from && d <= smB.to) : false;

      // Chargeback: ja tinha sido paga (fornecimento antes deste mes, sem Baixa
      // nem Manual no mes de fornecimento) e a baixa acontece dentro deste mes.
      // So pode ser descontada se foi mesmo paga e dentro dos 3 meses de
      // chargeback (ate 3 meses depois do mes de fornecimento).
      const foiPaga = suppliedOn && suppliedOn < from && !baixaNoMesSup && !manualNoMesSup;
      const dentroChargeback = sm ? deltaMonths(sm, m) <= 3 : false;

      // Anulada e definitiva: nunca paga nem da chargeback.
      if (firstAnulado) continue;

      if (foiPaga && baixouAgora && dentroChargeback) {
        const l = chargeback.get(e.sellerId) ?? [];
        l.push(lite);
        chargeback.set(e.sellerId, l);
        continue;
      }

      // Vem a pagamento: entrou em fornecimento neste mes e nao tem Baixa nem
      // Manual no proprio mes de fornecimento. Baixa num mes futuro nao impede
      // o pagamento — sera tratada como chargeback nesse mes.
      if (suppliedOn && suppliedOn >= from && suppliedOn <= to && !baixaNoMesSup && !manual) {
        const l = valid.get(e.sellerId) ?? [];
        l.push(lite);
        valid.set(e.sellerId, l);
        continue;
      }

      // Nao vem a pagamento: so aparece com movimento NESTE mes.
      // - Baixa neste mes: aparece no mes da baixa e nunca mais (definitiva).
      // - Anulado neste mes: idem — nunca paga nem da chargeback.
      // - Manual (ou outro estado != "Em Fornecimento") neste mes: aparece agora e
      //   continua a arrastar nos meses seguintes ate dar baixa.
      // Estados que ocorreram em meses futuros nao aparecem neste mes.
      const baixouNeste = baixas.some((d) => d >= from && d <= to);
      const anulouNeste = anulados.some((d) => d >= from && d <= to);
      const manualNeste = e.manual[k].some((d) => d >= from && d <= to);
      if (baixouNeste || anulouNeste || (manualNeste && !firstBaixa && !firstAnulado)) {
        const l = notPaid.get(e.sellerId) ?? [];
        const st = statusLabel(baixouNeste ? "Baixa" : anulouNeste ? "Anulado" : "Manual");
        l.push({ saleId, number: contract(e.details), service: e.service, details: e.details, status: st, energy: k });
        notPaid.set(e.sellerId, l);
        continue;
      }

      // Vendas em transito: desde o mes da assinatura (ou do primeiro estado) ate
      // chegarem a fornecimento. Sem pe até ao mes seguinte— a venda aparece em
      // todos os meses enquanto o estado atual continuar a ser um estado de transito.
      if (!suppliedOn && !firstBaixa && !firstAnulado) {
        const evts = [...e.hist[k]].sort((a, b) => a.on.localeCompare(b.on));
        const actual = evts.length ? evts[evts.length - 1].status : "";
        const startMonth = (e.signedOn ?? evts[0]?.on ?? "").slice(0, 7);
        if (startMonth && startMonth <= m && TRANSIT.has(actual)) {
          const l = inTransit.get(e.sellerId) ?? [];
          l.push({ saleId, number: contract(e.details), service: e.service, details: e.details, status: actual, signedOn: e.signedOn, energy: k });
          inTransit.set(e.sellerId, l);
        }
      }
    }
  }

  const staff = await db
    .select({ id: employees.id, name: employees.name, commissionTableId: employees.commissionTableId, forceCommissions: employees.forceCommissions })
    .from(employees);
  const cTables = await db.select().from(commissionTables);
  const cRows = await db.select().from(commissionRows).orderBy(asc(commissionRows.position));
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
    const mine = valid.get(s.id) ?? [];
    const cb = chargeback.get(s.id) ?? [];

    const a = pick(assignments.filter((x) => x.employeeId === s.id && x.kind === "commission" && x.commissionTableId != null));
    const tableId = a?.commissionTableId ?? s.commissionTableId;
    const table = cTables.find((t) => t.id === tableId) ?? null;

    // Tabela Base (chefe de equipa): as vendas dos membros da equipa somam-se às dele
    // e são comissionadas ao chefe. Com o pisco desligado, as vendas da equipa não contam.
    const teamMembers: { name: string; luz: number; gas: number }[] = [];
    if (table?.isBase) {
      const memberIds = [...teamOfChief(s.id)].filter((id) => id !== s.id);
      for (const id of memberIds) {
        const list = valid.get(id) ?? [];
        const listChb = chargeback.get(id) ?? [];
        if (!list.length && !listChb.length) continue;
        mine.push(...list);
        cb.push(...listChb);
        const member = staff.find((x) => x.id === id);
        teamMembers.push({
          name: member ? member.name : `#${id}`,
          luz: list.filter((e) => e.energy === "luz").length,
          gas: list.filter((e) => e.energy === "gas").length,
        });
      }
      teamMembers.sort((x, y) => y.luz + y.gas - (x.luz + x.gas));
    }

    if (!mine.length && !cb.length) continue;

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
      forceCommissions: s.forceCommissions ?? false,
      lines: [],
      chargebackLines: [],
      notPaid: (notPaid.get(s.id) ?? []).map((n) => ({ number: n.number, service: serviceLabel(n.service), status: n.status, value: 0 })),
      transit: [],
      team: teamMembers,
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

    const blocked = (s.forceCommissions) ? 0 : (table.blockedSales ?? 0);
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
        // Baixa e Anulado sao definitivos — nao apresentam valor.
        const noValue = n.status === "Baixa" || n.status === "Anulado";
        return { number: n.number, service: energyLabel(n.energy), status: n.status, value: noValue ? 0 : round2(tot) };
      }),
      transit: (inTransit.get(s.id) ?? []).map((t) => {
        const tot = split({ saleId: t.saleId, number: t.number, service: t.service, details: t.details, clientName: null, energy: t.energy }, band).reduce((sum, l) => sum + l.total, 0);
        return { number: t.number, service: energyLabel(t.energy), status: t.status, signedOn: t.signedOn, value: round2(tot) };
      }),
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
        forceCommissions: p.forceCommissions,
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
   * Previsão de Pagamentos: valores calculados a partir das vendas do CRM
   * (mesma fórmula do Auto Iberdrola) + quadro de desbloqueio de comissões.
   *
   * Desbloqueio (igual para todos, ignora o pagamento forçado):
   * - objetivo = 1.º escalão que PAGA comissão (> 0 €) da tabela atribuída
   *   (a faixa de 0 € é o estado bloqueado, não o objetivo);
   * - escalão apurado pelas vendas BTN (Luz/Dual) que entraram em fornecimento no mês;
   * - equipas: o objetivo vem da tabela CE atribuída ao chefe (grupo team-leader);
   * - "registadas" = todas as vendas do mês menos as que estão em Baixa ou Anuladas.
   */
  previsao: requireView("pagamentos")
    .input(z.object({ month }))
    .handler(async ({ input }) => {
      const b = await buildBreakdown(input.month);

      // Dados de tabelas: o objetivo minimo vem SEMPRE da tabela atribuida.
      const staff = await db
        .select({ id: employees.id, name: employees.name, commissionTableId: employees.commissionTableId })
        .from(employees);
      const cTables = await db.select().from(commissionTables);
      const cRows = await db.select().from(commissionRows).orderBy(asc(commissionRows.position));
      const assignments = await db.select().from(employeeTables);
      const chiefTablesRows = await db.select().from(chiefTables);
      const chiefRowsRows = await db.select().from(chiefRows).orderBy(asc(chiefRows.position));
      const allTeams = await db.select().from(teams);
      const memberships = await db.select().from(teamMemberships);

      // ── As duas tabelas de uma pessoa, resolvidas em separado pelo TIPO de tabela (regime): ──
      // 1) RES+BTN NEG -> tabela de VENDAS PROPRIAS (o alvo do quadro por comercial);
      // 2) CE          -> tabela de EQUIPA (escalao apurado pelas vendas do conjunto).
      // MEDEM e SOLAR nunca entram em nenhum dos dois quadros.
      const CE = "CE";
      const OWN = "RES+BTN NEG";

      const activeAssigns = (employeeId) =>
        assignments
          .filter((x) => x.employeeId === employeeId && x.kind === "commission" && x.commissionTableId != null)
          .filter((x) => x.startDate <= b.to && (x.endDate == null || x.endDate >= b.from))
          .sort((x, y) => (x.startDate === y.startDate ? y.id - x.id : x.startDate < y.startDate ? 1 : -1));

      /**
       * Tabelas atribuidas a uma pessoa, do regime indicado. Para alem do historico
       * (employee_tables), aceita a tabela principal do funcionario.
       * O regime e o criterio: e o que o ecra de Tabelas Comissionais pede ao criar
       * a tabela (RES+BTN NEG / MEDEM / SOLAR / CE).
       */
      const tablesOfRegime = (employeeId, fallbackTableId, regime) => {
        const ids = [];
        for (const a of activeAssigns(employeeId)) ids.push(a.commissionTableId);
        if (fallbackTableId != null) ids.push(fallbackTableId);
        return ids
          .map((id) => cTables.find((x) => x.id === id))
          .filter((t) => t != null && t.regime === regime && t.active);
      };

      /** Tabela de vendas proprias: a primeira tabela RES+BTN NEG atribuida no mes. */
      const commissionTableOf = (employeeId, fallback) => tablesOfRegime(employeeId, fallback, OWN)[0] ?? null;

      /**
       * Tabela CE (chefe de equipa): a tabela de regime CE atribuida ao lider.
       * Os escaloes destas tabelas vivem em commission_rows (kind="clients",
       * coluna LUZ = €/venda) — o chief_rows continua a ser aceite como fallback.
       */
      const chiefTableOf = (employeeId, fallback) => {
        const own = tablesOfRegime(employeeId, fallback, CE)[0];
        if (own) return own;
        return null;
      };

      /**
       * 1.o escalao que PAGA comissao de uma tabela comissional (kind=clients).
       * O escalao 0-29 com comissoes a 0 e a faixa "bloqueado", nao o objetivo:
       * o objetivo e o primeiro escalao com comissao > 0 (ex.: 30 no Daniel).
       */
      const firstCommissionMin = (tableId) => {
        const bands = cRows
          .filter((r) => r.tableId === tableId && r.kind === "clients")
          .sort((x, y) => (x.min ?? 0) - (y.min ?? 0));
        const paid = bands.find((r) => (r.luz ?? 0) > 0 || (r.gas ?? 0) > 0);
        return paid?.min ?? 0;
      };

      /** 1.o escalao que paga da tabela CE do modulo antigo (chief_rows, kind="team"). */
      const firstChiefMin = (tableId) => {
        const bands = chiefRowsRows
          .filter((r) => r.tableId === tableId && r.kind === "team")
          .sort((x, y) => (x.min ?? 0) - (y.min ?? 0));
        const paid = bands.find((r) => (r.commission ?? 0) > 0);
        return paid?.min ?? 0;
      };

      /**
       * Objetivo de uma equipa — o 1.o escalao que paga da tabela CE:
       * - tabela CE criada em Tabelas Comissionais (regime="CE") -> escaloes de
       *   cliente no LUZ/GAS, apurados pelas vendas da equipa;
       * - chief_table do modulo antigo -> escaloes de equipa (kind="team").
       */
      const chiefObjectiveMin = (table) => {
        if (!table) return 0;
        const own = firstChiefMin(table.id);
        if (own > 0) return own;
        return firstCommissionMin(table.id);
      };

      // ── Fornecimento: vendas BTN (Luz/Dual) ASSINADAS no mes e que entraram em
      //    fornecimento no mes. Uma venda assinada em janeiro e fornecida em
      //    fevereiro nao conta em nenhum dos dois meses. MEDEM nunca conta. ──
      const suppliedHist = await db
        .select({ saleId: saleStatusHistory.saleId, sellerId: sales.sellerId })
        .from(saleStatusHistory)
        .innerJoin(sales, eq(sales.id, saleStatusHistory.saleId))
        .where(
          and(
            eq(saleStatusHistory.status, "Em Fornecimento"),
            sql`${saleStatusHistory.changedOn} >= ${b.from} AND ${saleStatusHistory.changedOn} <= ${b.to}`,
            sql`${sales.date} >= ${b.from} AND ${sales.date} <= ${b.to}`,
            sql`json_extract(${sales.details}, '$.voltageLevel') = 'BTN' AND ${sales.service} in ('LUZ','DUAL')`,
          ),
        );

      const suppliedBySeller = new Map();
      const suppliedIds = new Set();
      for (const r of suppliedHist) {
        if (r.sellerId == null || suppliedIds.has(r.saleId)) continue;
        suppliedIds.add(r.saleId);
        suppliedBySeller.set(r.sellerId, (suppliedBySeller.get(r.sellerId) ?? 0) + 1);
      }

      // ── Registadas: vendas do mes, excepto Baixa/Anulado ──
      const registeredRows = await db
        .select({ sellerId: sales.sellerId })
        .from(sales)
        .where(
          and(
            sql`${sales.date} >= ${b.from} AND ${sales.date} <= ${b.to}`,
            sql`${sales.status} not in ('Baixa','Anulado')`,
          ),
        );

      const registeredBySeller = new Map();
      for (const r of registeredRows) {
        if (r.sellerId == null) continue;
        registeredBySeller.set(r.sellerId, (registeredBySeller.get(r.sellerId) ?? 0) + 1);
      }

      // Contagens por pessoa (independentes da tabela): a equipa soma as vendas de
      // todos os seus membros, mesmo os que nao tem tabela propria atribuida.
      const counts = staff.map((s) => ({
        employeeId: s.id,
        name: s.name,
        fornecimento: suppliedBySeller.get(s.id) ?? 0,
        registadas: registeredBySeller.get(s.id) ?? 0,
      }));

      // ── Por comercial: so entra quem tem tabela de vendas proprias (RES+BTN NEG)
      //    atribuida no mes. Um chefe tem DUAS tabelas (comercial e CE) e elas
      //    entram em quadros diferentes: aqui usa-se sempre a comercial.
      const sellerRows = staff
        .filter((s) => commissionTableOf(s.id, s.commissionTableId) != null)
        .map((s) => {
          const supplied = suppliedBySeller.get(s.id) ?? 0;
          const regs = registeredBySeller.get(s.id) ?? 0;
          // A tabela e o objetivo valem mesmo sem vendas no mes (aparece a 0).
          const table = commissionTableOf(s.id, s.commissionTableId);
          const min = table ? firstCommissionMin(table.id) : 0;
          const isChief = allTeams.some((t) => t.leaderId === s.id);
          return {
            employeeId: s.id,
            name: s.name,
            tableName: table?.name ?? null,
            isChief,
            bandMin: min,
            fornecimento: supplied,
            faltamFornecimento: Math.max(0, min - supplied),
            registadas: regs,
            faltamRegistadas: Math.max(0, min - regs),
            desbloqueado: min > 0 && supplied >= min,
          };
        })
        .filter((x) => x != null)
        .sort((a, z) => z.faltamFornecimento - a.faltamFornecimento || z.registadas - a.registadas);

      // ── Equipas: objetivo vem da tabela CE atribuida ao chefe da equipa ──
      const teamRows = allTeams
        .map((t) => {
          const ids = new Set([t.leaderId]);
          for (const m of memberships) {
            if (m.teamId !== t.id) continue;
            if (m.startDate > b.to || (m.endDate != null && m.endDate < b.from)) continue;
            ids.add(m.employeeId);
          }
          const mine = counts.filter((r) => ids.has(r.employeeId));
          const leaderName = staff.find((s) => s.id === t.leaderId)?.name ?? `#${t.leaderId}`;
          const table = chiefTableOf(t.leaderId, t.id);
          const min = chiefObjectiveMin(table);
          const fornecimento = mine.reduce((s, r) => s + r.fornecimento, 0);
          const registadas = mine.reduce((s, r) => s + r.registadas, 0);
          // Sem tabela CE atribuida, a equipa nao tem objetivo definido.
          if (!table || min <= 0) return null;
          return {
            teamId: t.id,
            teamName: t.name,
            name: leaderName,
            leaderId: t.leaderId,
            tableName: table.name,
            bandMin: min,
            fornecimento,
            faltamFornecimento: Math.max(0, min - fornecimento),
            registadas,
            faltamRegistadas: Math.max(0, min - registadas),
            desbloqueado: min > 0 && fornecimento >= min,
          };
        })
        .filter((x) => x != null)
        .sort((a, z) => z.faltamFornecimento - a.faltamFornecimento || z.registadas - a.registadas);

      return { month: b.month, from: b.from, to: b.to, people: b.people, totals: b.totals, unlock: { sellers: sellerRows, teams: teamRows } };
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

  /** Liga/desliga o pagamento forçado de comissões de um comercial (ignora o bloqueio da tabela). */
  forceCommissionsToggle: requireEdit("pagamentos")
    .input(z.object({ employeeId: z.number().int().positive() }))
    .handler(async ({ input }) => {
      const [emp] = await db.select({ forceCommissions: employees.forceCommissions }).from(employees).where(eq(employees.id, input.employeeId));
      if (!emp) return { found: false as const, forceCommissions: false };
      const next = !emp.forceCommissions;
      await db.update(employees).set({ forceCommissions: next }).where(eq(employees.id, input.employeeId));
      return { found: true as const, employeeId: input.employeeId, forceCommissions: next };
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
