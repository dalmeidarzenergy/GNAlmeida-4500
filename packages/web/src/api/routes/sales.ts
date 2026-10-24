import { z } from "zod";
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import {
  CORE_MAP,
  DEFAULT_SALE_STATUS,
  SALE_COUNTED,
  SALE_STATUS,
  SERVICE_LABELS,
  SUPPLIER,
  clientTypeFromNif,
  getSaleForm,
  validateDetails,
  type Details,
} from "../shared/client-forms";
import { requireView, requireEdit } from "../middleware/auth";
import { db } from "../database";
import { clients, employees, saleStatusHistory, sales as salesTbl, salesTargets, teamMemberships, teams, user } from "../database/schema";
import { localPhotoUrl } from "../lib/s3";
import { activeInMonth } from "../shared/hierarchy";

/** Cliente = só os dados principais: nome, telemóvel, NIF e gestor. */
const clientInput = z.object({
  name: z.string().trim().min(1, "Indique o nome do cliente."),
  phone: z.string().trim().min(1, "Indique o telemóvel do cliente."),
  nif: z.string().trim().regex(/^\d{9}$/, "O NIF tem de ter 9 dígitos."),
  ownerId: z.number().nullable().optional(),
});

const detailsSchema = z.record(z.string(), z.union([z.string(), z.boolean(), z.null()]));

/** Venda IBERDROLA: serviço + formulário completo (inclui nome/NIF/contacto do cliente). */
const saleFormInput = z.object({
  service: z.enum(SERVICE_LABELS as [string, ...string[]], { message: "Indique o serviço a aderir (LUZ, GÁS, DUAL ou SOLAR)." }),
  details: detailsSchema,
  /** Gestor do cliente / vendedor da venda (ignorado para vendedores: são sempre eles). */
  ownerId: z.number().nullable().optional(),
  /** Cliente já registado (opcional). Sem ele, procura-se pelo NIF ou cria-se um novo. */
  clientId: z.number().nullable().optional(),
});

/** Linha do Excel já convertida para os campos do formulário. */
const importRow = z.object({
  row: z.number(),
  service: saleFormInput.shape.service,
  details: detailsSchema,
  sellerId: z.number(),
  statusDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  /** Serviço detetado pelo CPE/CUI (não veio do Excel): numa venda existente mantém-se o serviço dela. */
  serviceAuto: z.boolean().optional(),
  /** Vendedor por defeito (não veio do Excel): numa venda existente mantém-se o vendedor dela. */
  sellerDefault: z.boolean().optional(),
  /** Campos preenchidos com o valor por defeito (não vieram do Excel): numa venda existente mantêm-se os valores dela. */
  defaulted: z.array(z.string()).optional(),
});

const contractKey = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, "").toUpperCase() : "");

/**
 * Venda já registada com o mesmo CPE (luz) ou CUI (gás), a mais recente.
 * Se as duas tiverem número de contrato e forem diferentes, não é a mesma venda (cria-se uma nova).
 */
async function findByMeter(details: Details) {
  const conds = [];
  if (typeof details.cpe === "string" && details.cpe) conds.push(sql`json_extract(${salesTbl.details}, '$.cpe') = ${details.cpe}`);
  if (typeof details.cui === "string" && details.cui) conds.push(sql`json_extract(${salesTbl.details}, '$.cui') = ${details.cui}`);
  if (!conds.length) return undefined;
  const rows = await db.select().from(salesTbl).where(sql.join(conds, sql` or `)).orderBy(desc(salesTbl.date), desc(salesTbl.id));
  const contract = contractKey(details.contractNumber);
  return rows.find((r) => {
    const other = contractKey(r.details?.contractNumber);
    return !contract || !other || contract === other;
  });
}

const saleStatus = z.enum(SALE_STATUS as [string, ...string[]], { message: "Estado da venda inválido." });
const countedSql = sql.join(SALE_COUNTED.map((s) => sql`${s}`), sql`, `);
const COUNTED = SALE_COUNTED;

type Ctx = { role: string; employeeId: number | null };
function scopeSeller(ctx: Ctx) {
  if (ctx.role === "vendedor") {
    if (!ctx.employeeId) throw new ORPCError("FORBIDDEN", { message: "A sua conta ainda não está associada a um vendedor. Peça ao administrador." });
    return ctx.employeeId;
  }
  return null;
}

/** Chefe de equipa: as vendas/clientes dele próprio e dos membros das equipas que chefia. */
async function scopeSellerIds(ctx: Ctx) {
  if (ctx.role === "chefe") {
    if (!ctx.employeeId) return [];
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" });
    const led = await db.select({ id: teams.id }).from(teams).where(eq(teams.leaderId, ctx.employeeId));
    const out = new Set<number>([ctx.employeeId]);
    for (const t of led) {
      const mem = await db
        .select({ id: teamMemberships.employeeId })
        .from(teamMemberships)
        .where(and(eq(teamMemberships.teamId, t.id), sql`${teamMemberships.startDate} <= ${today}`, sql`(${teamMemberships.endDate} is null or ${teamMemberships.endDate} >= ${today})`));
      for (const m of mem) out.add(m.id);
    }
    return [...out];
  }
  return null;
}

async function assertActiveEmployee(id: number | null) {
  if (id == null) return;
  const [e] = await db.select({ status: employees.status }).from(employees).where(eq(employees.id, id));
  if (!e || e.status === "inativo") throw new ORPCError("BAD_REQUEST", { message: "O gestor tem de ser um funcionário ativo." });
}

async function resolveOwner(ctx: Ctx, ownerId: number | null | undefined) {
  const own = scopeSeller(ctx);
  if (own) return own;
  if (!ownerId) throw new ORPCError("BAD_REQUEST", { message: "Atribua o gestor do cliente." });
  await assertActiveEmployee(ownerId);
  return ownerId;
}

async function assertNifFree(nif: string, exceptId?: number) {
  const [dup] = await db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.nif, nif));
  if (dup && dup.id !== exceptId) throw new ORPCError("BAD_REQUEST", { message: `Já existe um cliente com o NIF ${nif}: ${dup.name}.` });
}

async function nextNumber(date: string) {
  const year = date.slice(0, 4);
  const rows = await db.select({ number: salesTbl.number }).from(salesTbl).where(like(salesTbl.number, `VD-${year}-%`));
  const max = rows.reduce((m, r) => Math.max(m, Number(r.number.split("-")[2]) || 0), 0);
  return `VD-${year}-${String(max + 1).padStart(4, "0")}`;
}

/** Data de hoje em Lisboa (YYYY-MM-DD). */
const todayLisbon = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" });

/** Regista uma mudança de estado (só quando o estado muda de facto). */
async function logStatus(saleId: number, energy: "luz" | "gas", status: string | null | undefined, previous: string | null | undefined, userId: string) {
  if (!status || status === previous) return;
  await db.insert(saleStatusHistory).values({ saleId, energy, status, changedOn: todayLisbon(), changedBy: userId });
}
const gasStatus = (d: Details | null | undefined) => (typeof d?.saleStatusGas === "string" ? d.saleStatusGas : null);

/** Valida o formulário da venda e separa os dados do cliente (nome, NIF, contacto) dos dados da venda. */
function splitSaleForm(service: string, details: Details) {
  const form = getSaleForm(service);
  if (!form) throw new ORPCError("BAD_REQUEST", { message: "Serviço inválido." });
  const values: Details = { ...details };
  const err = validateDetails(form, values);
  if (err) throw new ORPCError("BAD_REQUEST", { message: err });
  const core: Record<string, string> = {};
  for (const k of Object.keys(CORE_MAP)) {
    core[k] = String(values[k] ?? "").trim();
    delete values[k];
  }
  const allowed = new Set(form.map((f) => f.key));
  for (const k of Object.keys(values)) if (!allowed.has(k)) delete values[k];
  const status = typeof values.saleStatus === "string" && SALE_STATUS.includes(values.saleStatus) ? values.saleStatus : DEFAULT_SALE_STATUS;
  values.saleStatus = status;
  if (service === "DUAL") {
    const g = values.saleStatusGas;
    values.saleStatusGas = typeof g === "string" && SALE_STATUS.includes(g) ? g : DEFAULT_SALE_STATUS;
  }
  const sig = values.signatureDate;
  const date = typeof sig === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sig) ? sig : new Date().toISOString().slice(0, 10);
  return { core: { name: core.name, nif: core.nif, phone: core.contact }, details: values, status, date };
}

/** Encontra (por id ou NIF) ou cria o cliente da venda e atualiza os dados principais. */
async function upsertSaleClient(ctx: Ctx, core: { name: string; nif: string; phone: string }, ownerId: number, clientId?: number | null) {
  let existing = clientId ? (await db.select().from(clients).where(eq(clients.id, clientId)))[0] : undefined;
  if (clientId && !existing) throw new ORPCError("BAD_REQUEST", { message: "Cliente não encontrado." });
  if (!existing) existing = (await db.select().from(clients).where(eq(clients.nif, core.nif)))[0];
  if (existing) {
    const own = scopeSeller(ctx);
    if (own && existing.ownerId && existing.ownerId !== own) {
      throw new ORPCError("FORBIDDEN", { message: `O cliente com o NIF ${core.nif} pertence a outro gestor.` });
    }
    if (existing.nif !== core.nif) await assertNifFree(core.nif, existing.id);
    await db
      .update(clients)
      .set({ ...core, type: clientTypeFromNif(core.nif), ownerId: existing.ownerId ?? ownerId })
      .where(eq(clients.id, existing.id));
    return existing.id;
  }
  const [row] = await db.insert(clients).values({ ...core, type: clientTypeFromNif(core.nif), ownerId }).returning();
  return row.id;
}

export const sales = {
  clients: {
    list: requireView("clientes").handler(async ({ context }) => {
      const own = scopeSeller(context);
      const teamScope = await scopeSellerIds(context);
      return db
        .select({
          id: clients.id,
          name: clients.name,
          type: clients.type,
          nif: clients.nif,
          phone: clients.phone,
          ownerId: clients.ownerId,
          ownerName: employees.name,
          createdAt: clients.createdAt,
          saleCount: sql<number>`(select count(*) from sales s where s.client_id = ${clients.id})`,
          activeCount: sql<number>`(select count(*) from sales s where s.client_id = ${clients.id} and s.status in (${countedSql}))`,
          lastSale: sql<string | null>`(select max(s.date) from sales s where s.client_id = ${clients.id})`,
          /** Meses (YYYY-MM) com vendas deste cliente e vendedores dessas vendas, para os filtros. */
          saleMonths: sql<string | null>`(select group_concat(distinct substr(s.date, 1, 7)) from sales s where s.client_id = ${clients.id})`,
          saleSellers: sql<string | null>`(select group_concat(distinct s.seller_id) from sales s where s.client_id = ${clients.id})`,
        })
        .from(clients)
        .leftJoin(employees, eq(employees.id, clients.ownerId))
        .where(own ? eq(clients.ownerId, own) : teamScope ? inArray(clients.ownerId, teamScope.length ? teamScope : [-1]) : undefined)
        .orderBy(clients.name);
    }),
    create: requireEdit("clientes").input(clientInput).handler(async ({ input, context }) => {
      const ownerId = await resolveOwner(context, input.ownerId);
      await assertNifFree(input.nif);
      const [row] = await db
        .insert(clients)
        .values({ name: input.name, phone: input.phone, nif: input.nif, type: clientTypeFromNif(input.nif), ownerId })
        .returning();
      return row;
    }),
    update: requireEdit("clientes").input(clientInput.extend({ id: z.number() })).handler(async ({ input, context }) => {
      const own = scopeSeller(context);
      const [c] = await db.select().from(clients).where(eq(clients.id, input.id));
      if (!c || (own && c.ownerId !== own)) throw new ORPCError("NOT_FOUND", { message: "Cliente não encontrado." });
      await assertNifFree(input.nif, input.id);
      const ownerId = own ? c.ownerId : await resolveOwner(context, input.ownerId);
      await db
        .update(clients)
        .set({ name: input.name, phone: input.phone, nif: input.nif, type: clientTypeFromNif(input.nif), ownerId })
        .where(eq(clients.id, input.id));
      return { ok: true };
    }),
    remove: requireEdit("clientes").input(z.object({ id: z.number() })).handler(async ({ input }) => {
      await db.delete(clients).where(eq(clients.id, input.id));
      return { ok: true };
    }),
    /** Elimina vários clientes de uma vez (as vendas destes clientes também são eliminadas). */
    removeMany: requireEdit("clientes").input(z.object({ ids: z.array(z.number()).min(1).max(2000) })).handler(async ({ input }) => {
      const ids = [...new Set(input.ids)];
      await db.delete(clients).where(inArray(clients.id, ids));
      return { ok: true, count: ids.length };
    }),
  },
  orders: {
    list: requireView("vendas").handler(async ({ context }) => {
      const sellerId = scopeSeller(context);
      const teamScope = await scopeSellerIds(context);
      return db
        .select({
          id: salesTbl.id,
          number: salesTbl.number,
          clientId: salesTbl.clientId,
          clientName: clients.name,
          clientNif: clients.nif,
          clientPhone: clients.phone,
          supplier: salesTbl.supplier,
          service: salesTbl.service,
          details: salesTbl.details,
          sellerId: salesTbl.sellerId,
          sellerName: employees.name,
          date: salesTbl.date,
          status: salesTbl.status,
        })
        .from(salesTbl)
        .innerJoin(clients, eq(clients.id, salesTbl.clientId))
        .leftJoin(employees, eq(employees.id, salesTbl.sellerId))
        .where(sellerId ? eq(salesTbl.sellerId, sellerId) : teamScope ? inArray(salesTbl.sellerId, teamScope.length ? teamScope : [-1]) : undefined)
        .orderBy(desc(salesTbl.date), desc(salesTbl.id));
    }),
    /** Nova venda IBERDROLA: grava o formulário completo; o cliente é reutilizado (id ou NIF) ou criado. */
    create: requireEdit("vendas").input(saleFormInput).handler(async ({ input, context }) => {
      const ownerId = await resolveOwner(context, input.ownerId);
      const { core, details, status, date } = splitSaleForm(input.service, input.details);
      const clientId = await upsertSaleClient(context, core, ownerId, input.clientId);
      const number = await nextNumber(date);
      const [row] = await db
        .insert(salesTbl)
        .values({ clientId, sellerId: ownerId, date, status, supplier: SUPPLIER, service: input.service, details, total: 0, number })
        .returning();
      await logStatus(row.id, "luz", status, null, context.user.id);
      if (input.service === "DUAL") await logStatus(row.id, "gas", gasStatus(details), null, context.user.id);
      return row;
    }),
    update: requireEdit("vendas").input(saleFormInput.extend({ id: z.number() })).handler(async ({ input, context }) => {
      const own = scopeSeller(context);
      const where = own ? and(eq(salesTbl.id, input.id), eq(salesTbl.sellerId, own)) : eq(salesTbl.id, input.id);
      const [existing] = await db.select().from(salesTbl).where(where);
      if (!existing) throw new ORPCError("NOT_FOUND", { message: "Venda não encontrada" });
      const ownerId = own ?? (await resolveOwner(context, input.ownerId));
      const { core, details, status, date } = splitSaleForm(input.service, input.details);
      // Os dados principais do cliente editados na venda atualizam a ficha do cliente.
      const [c] = await db.select().from(clients).where(eq(clients.id, existing.clientId));
      if (c) {
        if (c.nif !== core.nif) await assertNifFree(core.nif, c.id);
        await db.update(clients).set({ ...core, type: clientTypeFromNif(core.nif) }).where(eq(clients.id, c.id));
      }
      await db.update(salesTbl).set({ service: input.service, details, status, date, sellerId: ownerId }).where(eq(salesTbl.id, input.id));
      await logStatus(input.id, "luz", status, existing.status, context.user.id);
      if (input.service === "DUAL") await logStatus(input.id, "gas", gasStatus(details), gasStatus(existing.details), context.user.id);
      return { ok: true };
    }),
    setStatus: requireEdit("vendas")
      .input(z.object({ id: z.number(), status: saleStatus, energy: z.enum(["luz", "gas"]).optional() }))
      .handler(async ({ input, context }) => {
        const own = scopeSeller(context);
        const where = own ? and(eq(salesTbl.id, input.id), eq(salesTbl.sellerId, own)) : eq(salesTbl.id, input.id);
        const [sale] = await db.select({ details: salesTbl.details, service: salesTbl.service, status: salesTbl.status }).from(salesTbl).where(where);
        if (!sale) throw new ORPCError("NOT_FOUND", { message: "Venda não encontrada" });
        if (input.energy === "gas") {
          if (sale.service !== "DUAL") throw new ORPCError("BAD_REQUEST", { message: "Só as vendas DUAL têm estado do gás." });
          await db.update(salesTbl).set({ details: { ...sale.details, saleStatusGas: input.status } }).where(where);
          await logStatus(input.id, "gas", input.status, gasStatus(sale.details), context.user.id);
          return { ok: true };
        }
        await db.update(salesTbl).set({ status: input.status, details: { ...sale.details, saleStatus: input.status } }).where(where);
        await logStatus(input.id, "luz", input.status, sale.status, context.user.id);
        return { ok: true };
      }),
    /** Histórico de estados de uma venda (mais recente primeiro). */
    history: requireView("vendas").input(z.object({ id: z.number() })).handler(async ({ input, context }) => {
      const own = scopeSeller(context);
      const [sale] = await db.select({ id: salesTbl.id }).from(salesTbl).where(own ? and(eq(salesTbl.id, input.id), eq(salesTbl.sellerId, own)) : eq(salesTbl.id, input.id));
      if (!sale) throw new ORPCError("NOT_FOUND", { message: "Venda não encontrada" });
      return db
        .select({ id: saleStatusHistory.id, energy: saleStatusHistory.energy, status: saleStatusHistory.status, changedOn: saleStatusHistory.changedOn, changedBy: saleStatusHistory.changedBy, userName: user.name })
        .from(saleStatusHistory)
        .leftJoin(user, eq(user.id, saleStatusHistory.changedBy))
        .where(eq(saleStatusHistory.saleId, input.id))
        .orderBy(desc(saleStatusHistory.changedOn), desc(saleStatusHistory.id));
    }),
    /** Corrige a data de uma mudança de estado (só admin), por ex. quando o estado foi atualizado com atraso. */
    setHistoryDate: requireEdit("vendas")
      .input(z.object({ id: z.number(), changedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.") }))
      .handler(async ({ input }) => {
        if (input.changedOn > todayLisbon()) throw new ORPCError("BAD_REQUEST", { message: "A data não pode ser no futuro." });
        await db.update(saleStatusHistory).set({ changedOn: input.changedOn }).where(eq(saleStatusHistory.id, input.id));
        return { ok: true };
      }),
    remove: requireEdit("vendas").input(z.object({ id: z.number() })).handler(async ({ input }) => {
      await db.delete(salesTbl).where(eq(salesTbl.id, input.id));
      return { ok: true };
    }),
    /**
     * Importação do Excel (só admin), em blocos de até 200 linhas.
     * Se já existir uma venda com o mesmo CPE ou CUI (e sem número de contrato diferente), essa venda é atualizada com os dados do Excel; senão cria-se uma venda nova.
     * O cliente é o que já existe com o mesmo NIF (sem alterar os dados) ou é criado.
     */
    importMany: requireEdit("vendas").input(z.object({ rows: z.array(importRow).min(1).max(200) })).handler(async ({ input, context }) => {
      const sellerIds = new Set((await db.select({ id: employees.id }).from(employees)).map((e) => e.id));
      const counters = new Map<string, number>();
      const today = todayLisbon();
      const results: { row: number; ok: boolean; error?: string; number?: string; newClient?: boolean; updated?: boolean }[] = [];
      for (const r of input.rows) {
        try {
          if (!sellerIds.has(r.sellerId)) throw new ORPCError("BAD_REQUEST", { message: "Vendedor não encontrado." });
          if (r.statusDate && r.statusDate > today) throw new ORPCError("BAD_REQUEST", { message: "A data do estado não pode ser no futuro." });
          const existing = await findByMeter(r.details);
          const service = existing && r.serviceAuto && existing.service ? existing.service : r.service;
          // Numa venda existente, os valores do Excel substituem os atuais; o que não veio no Excel mantém-se.
          let raw: Details = r.details;
          if (existing) {
            const defaulted = new Set(r.defaulted ?? []);
            raw = { ...existing.details };
            for (const [k, v] of Object.entries(r.details)) if (!(defaulted.has(k) && raw[k] != null && raw[k] !== "")) raw[k] = v;
          }
          const { core, details, status, date: formDate } = splitSaleForm(service, raw);
          const date = existing && !details.signatureDate ? existing.date : formDate;
          const [found] = await db.select({ id: clients.id }).from(clients).where(eq(clients.nif, core.nif));
          const clientId = found?.id ?? (await db.insert(clients).values({ ...core, type: clientTypeFromNif(core.nif), ownerId: r.sellerId }).returning())[0].id;

          if (existing) {
            const sellerId = r.sellerDefault && existing.sellerId ? existing.sellerId : r.sellerId;
            await db.update(salesTbl).set({ clientId, sellerId, date, status, service, details }).where(eq(salesTbl.id, existing.id));
            const changedOn = r.statusDate ?? today;
            if (status !== existing.status) await db.insert(saleStatusHistory).values({ saleId: existing.id, energy: "luz", status, changedOn, changedBy: context.user.id });
            const g = gasStatus(details);
            if (service === "DUAL" && g && g !== gasStatus(existing.details)) {
              await db.insert(saleStatusHistory).values({ saleId: existing.id, energy: "gas", status: g, changedOn, changedBy: context.user.id });
            }
            results.push({ row: r.row, ok: true, number: existing.number, newClient: !found, updated: true });
            continue;
          }

          const year = date.slice(0, 4);
          if (!counters.has(year)) counters.set(year, Number((await nextNumber(date)).split("-")[2]) - 1);
          const n = (counters.get(year) ?? 0) + 1;
          counters.set(year, n);
          const number = `VD-${year}-${String(n).padStart(4, "0")}`;
          const [row] = await db
            .insert(salesTbl)
            .values({ clientId, sellerId: r.sellerId, date, status, supplier: SUPPLIER, service, details, total: 0, number })
            .returning();
          // Sem data do estado no Excel, usa-se a data da venda e a entrada fica marcada como estimada.
          const changedOn = r.statusDate ?? date;
          const changedBy = r.statusDate ? context.user.id : "importado";
          await db.insert(saleStatusHistory).values({ saleId: row.id, energy: "luz", status, changedOn, changedBy });
          const g = gasStatus(details);
          if (service === "DUAL" && g) await db.insert(saleStatusHistory).values({ saleId: row.id, energy: "gas", status: g, changedOn, changedBy });
          results.push({ row: r.row, ok: true, number, newClient: !found, updated: false });
        } catch (e) {
          results.push({ row: r.row, ok: false, error: e instanceof Error ? e.message : "Erro desconhecido." });
        }
      }
      return results;
    }),
    /** Elimina várias vendas de uma vez (o cliente mantém-se). */
    removeMany: requireEdit("vendas").input(z.object({ ids: z.array(z.number()).min(1).max(2000) })).handler(async ({ input }) => {
      const ids = [...new Set(input.ids)];
      await db.delete(salesTbl).where(inArray(salesTbl.id, ids));
      return { ok: true, count: ids.length };
    }),
  },
  targets: {
    list: requireView("metas").input(z.object({ month: z.string() })).handler(async ({ input, context }) => {
      const own = scopeSeller(context);
      const sellers = await db
        .select()
        .from(employees)
        .where(own ? eq(employees.id, own) : undefined)
        .orderBy(employees.name)
        .then((rows) => (own ? rows : rows.filter((e) => activeInMonth(e, input.month))));
      const targets = await db.select().from(salesTargets).where(eq(salesTargets.month, input.month));
      const achieved = await db
        .select({ sellerId: salesTbl.sellerId, n: sql<number>`count(*)` })
        .from(salesTbl)
        .where(and(like(salesTbl.date, `${input.month}%`), inArray(salesTbl.status, COUNTED)))
        .groupBy(salesTbl.sellerId);
      return Promise.all(sellers.map(async (s) => {
        const t = targets.find((x) => x.sellerId === s.id)?.target ?? 0;
        const a = achieved.find((x) => x.sellerId === s.id);
        // Meta = nº de vendas "Em Fornecimento" no mês.
        const total = Number(a?.n ?? 0);
        return {
          sellerId: s.id,
          sellerName: s.name,
          photoUrl: localPhotoUrl(s.photoKey),
          commissionRate: s.commissionRate,
          target: t,
          achieved: total,
          orders: Number(a?.n ?? 0),
          progress: t > 0 ? total / t : 0,
          commission: (total * s.commissionRate) / 100,
        };
      }));
    }),
    set: requireEdit("metas")
      .input(z.object({ sellerId: z.number(), month: z.string(), target: z.number().min(0), commissionRate: z.number().min(0).max(100) }))
      .handler(async ({ input }) => {
        const [existing] = await db
          .select()
          .from(salesTargets)
          .where(and(eq(salesTargets.sellerId, input.sellerId), eq(salesTargets.month, input.month)));
        if (existing) {
          await db.update(salesTargets).set({ target: input.target }).where(eq(salesTargets.id, existing.id));
        } else {
          await db.insert(salesTargets).values({ sellerId: input.sellerId, month: input.month, target: input.target });
        }
        await db.update(employees).set({ commissionRate: input.commissionRate }).where(eq(employees.id, input.sellerId));
        return { ok: true };
      }),
  },
};
