/**
 * Notificações internas (sino) — criação com deduplicação por slot.
 * Partilhado entre o job scripts/alerts.ts (via bun:sqlite) e as rotas oRPC.
 * As rotas usam `notifySaleImmediate` (entrada imediata em crítico/KO) e
 * `notifyAdminsSaleReady` (colaborador marcou a venda como tratável agora).
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../database";
import { notifications, sales as salesTbl, saleStatusHistory, userRoles, user, clients } from "../database/schema";
import { dayDiff, isKO, isSameMonth, saleCritical } from "../shared/alerts";

export const todayLisbon = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" });

type Recipient = { userId: string; name: string | null; email: string | null };

/** Utilizadores ligados a um funcionário (via user_roles.employee_id). */
async function usersForEmployee(employeeId: number | null): Promise<Recipient[]> {
  if (employeeId == null) return [];
  return db
    .select({ userId: userRoles.userId, name: user.name, email: user.email })
    .from(userRoles)
    .innerJoin(user, eq(user.id, userRoles.userId))
    .where(eq(userRoles.employeeId, employeeId));
}

/** Utilizadores com um dos perfis indicados (ex.: admin/diretor). */
async function usersForRoles(roles: string[]): Promise<Recipient[]> {
  return db
    .select({ userId: userRoles.userId, name: user.name, email: user.email })
    .from(userRoles)
    .innerJoin(user, eq(user.id, userRoles.userId))
    .where(inArray(userRoles.role, roles));
}

async function insertNotifications(
  recips: Recipient[],
  data: { title: string; body: string; url: string; type: string; slot: string; saleId: number | null },
) {
  for (const u of recips) {
    const [existing] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.slot, data.slot), eq(notifications.userId, u.userId)));
    if (existing) continue;
    await db.insert(notifications).values({
      userId: u.userId,
      title: data.title,
      body: data.body,
      url: data.url,
      type: data.type,
      slot: data.slot,
      saleId: data.saleId,
      read: false,
    });
  }
}

/**
 * Chamado sempre que uma venda muda de estado / é editada: se ficou crítica
 * (fora do prazo de contratação) ou com Estado VTV KO, notifica o comercial dela
 * de imediato (sem esperar pela ronda de 2x/dia). Deduplicado por dia e motivo.
 */
export async function notifySaleImmediate(saleId: number) {
  const [sale] = await db
    .select({
      id: salesTbl.id,
      number: salesTbl.number,
      date: salesTbl.date,
      status: salesTbl.status,
      service: salesTbl.service,
      details: salesTbl.details,
      sellerId: salesTbl.sellerId,
      alertsDisabled: salesTbl.alertsDisabled,
      clientName: clients.name,
    })
    .from(salesTbl)
    .leftJoin(clients, eq(clients.id, salesTbl.clientId))
    .where(eq(salesTbl.id, saleId));
  if (!sale || sale.alertsDisabled) return;

  const [ctrl] = await db
    .select({ changedOn: saleStatusHistory.changedOn })
    .from(saleStatusHistory)
    .where(and(eq(saleStatusHistory.saleId, saleId), eq(saleStatusHistory.energy, "luz"), eq(saleStatusHistory.status, "Control")))
    .orderBy(saleStatusHistory.changedOn)
    .limit(1);
  const ctrlOn = ctrl?.changedOn ?? null;
  const today = todayLisbon();
  // Só notificamos vendas do mês corrente; as de meses anteriores não geram alertas.
  if (!isSameMonth(sale.date, today)) return;
  const client = sale.clientName ?? "cliente";

  const critical = saleCritical(sale.date, sale.status, ctrlOn, today);
  const vtv = [typeof sale.details?.vtvStatus === "string" ? sale.details.vtvStatus : null, typeof sale.details?.vtvStatusGas === "string" ? sale.details.vtvStatusGas : null];
  const koStatuses = vtv.filter((s): s is string => isKO(s));

  const recips = await usersForEmployee(sale.sellerId);
  if (!recips.length) return;

  if (critical) {
    const dias = dayDiff(sale.date, ctrlOn ?? today);
    await insertNotifications(recips, {
      title: `⚠️ Venda ${sale.number} crítica`,
      body: `${client} — contratação fora do prazo (${dias} dias). Penalidade de 10€.`,
      url: "/vendas-criticas",
      type: "vendas-criticas",
      slot: `${today}-imediato-critico-${saleId}`,
      saleId,
    });
  }

  if (koStatuses.length) {
    await insertNotifications(recips, {
      title: `⚠️ Venda ${sale.number} com VTV KO`,
      body: `${client} — Estado VTV ${koStatuses.join(" · ")}.`,
      url: "/estado-vtv",
      type: "estado-vtv",
      slot: `${today}-imediato-ko-${saleId}`,
      saleId,
    });
  }
}

/**
 * Chamado quando o colaborador marca a venda como "tratável agora" (caixa de
 * verificação). Notifica os administradores/diretores.
 */
export async function notifyAdminsSaleReady(saleId: number, sellerName: string | null) {
  const [sale] = await db
    .select({ number: salesTbl.number, clientName: clients.name })
    .from(salesTbl)
    .leftJoin(clients, eq(clients.id, salesTbl.clientId))
    .where(eq(salesTbl.id, saleId));
  if (!sale) return;
  const recips = await usersForRoles(["admin", "diretor"]);
  if (!recips.length) return;
  await insertNotifications(recips, {
    title: `✔️ Venda ${sale.number} pronta a tratar`,
    body: `${sellerName ?? "Um comercial"} marcou a venda de ${sale.clientName ?? "cliente"} como tratável agora.`,
    url: "/vendas-criticas",
    type: "pronta-a-tratar",
    slot: `${todayLisbon()}-pronto-${saleId}`,
    saleId,
  });
}
