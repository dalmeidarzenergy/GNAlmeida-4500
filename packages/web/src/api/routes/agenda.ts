import { ORPCError } from "@orpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../database";
import { calendarAssignments, calendarEvents, calendars, teamMemberships, teams, user } from "../database/schema";
import { authed, type Role } from "../middleware/auth";

type Ctx = { user: { id: string }; role: Role; employeeId: number | null };

/** Papéis com acesso total à agenda. */
const FULL: Role[] = ["admin", "diretor"];
/** Papéis que veem apenas calendários atribuídos. */
const ASSIGNED: Role[] = ["backoffice", "rh"];

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" });

/** Equipas que um funcionário chefia (é leader). */
async function ledTeamIds(employeeId: number) {
  const rows = await db.select({ id: teams.id }).from(teams).where(eq(teams.leaderId, employeeId));
  return rows.map((r) => r.id);
}

/** Equipas que um funcionário coordena. */
async function coordinatedTeamIds(employeeId: number) {
  const rows = await db.select({ id: teams.id }).from(teams).where(eq(teams.coordinatorId, employeeId));
  return rows.map((r) => r.id);
}

/** Membros atuais de um conjunto de equipas. */
async function memberEmployeeIds(teamIds: number[]) {
  if (!teamIds.length) return [];
  const t = today();
  const rows = await db
    .select({ id: teamMemberships.employeeId })
    .from(teamMemberships)
    .where(and(inArray(teamMemberships.teamId, teamIds), sql`${teamMemberships.startDate} <= ${t}`, sql`(${teamMemberships.endDate} is null or ${teamMemberships.endDate} >= ${t})`));
  return rows.map((r) => r.id);
}

/**
 * Ids dos calendários que este utilizador pode VER na agenda, conforme o seu perfil.
 * Devolve `null` para acesso total (admin/diretor). Devolve lista (possivelmente vazia) nos restantes.
 */
export async function visibleCalendarIds(ctx: Ctx): Promise<number[] | null> {
  const role = ctx.role;
  if (FULL.includes(role)) return null;

  const myEmployee = ctx.employeeId;

  if (role === "vendedor") {
    // Apenas o calendário pessoal, mesmo que em Equipas conste como chefe.
    const mine = await db.select({ id: calendars.id }).from(calendars).where(eq(calendars.userId, ctx.user.id));
    return mine.map((c) => c.id);
  }

  if (role === "chefe") {
    if (myEmployee == null) return [];
    const tIds = await ledTeamIds(myEmployee);
    const empIds = await memberEmployeeIds(tIds);
    empIds.push(myEmployee);
    return calendarIdsFor(tIds, empIds, ctx.user.id);
  }

  if (role === "coordenador") {
    if (myEmployee == null) return [];
    const tIds = await coordinatedTeamIds(myEmployee);
    const empIds = await memberEmployeeIds(tIds);
    // inclui também os chefes dessas equipas (têm calendário pessoal ligado à equipa)
    const leaders = await db.select({ id: teams.leaderId }).from(teams).where(inArray(teams.id, tIds.length ? tIds : [-1]));
    for (const l of leaders) if (l.id != null) empIds.push(l.id);
    empIds.push(myEmployee);
    return calendarIdsFor(tIds, empIds, ctx.user.id);
  }

  if (ASSIGNED.includes(role)) {
    const assigns = await db.select().from(calendarAssignments).where(eq(calendarAssignments.userId, ctx.user.id));
    const tIds = assigns.filter((a) => a.teamId != null).map((a) => a.teamId!) ;
    const empIds = assigns.filter((a) => a.employeeId != null).map((a) => a.employeeId!);
    const memberIds = await memberEmployeeIds(tIds);
    const leaders = tIds.length ? await db.select({ id: teams.leaderId }).from(teams).where(inArray(teams.id, tIds)) : [];
    for (const l of leaders) if (l.id != null) empIds.push(l.id);
    for (const m of memberIds) empIds.push(m);
    if (myEmployee != null) empIds.push(myEmployee);
    return calendarIdsFor(tIds, empIds, ctx.user.id);
  }

  return [];
}

/** Calendários: os de equipa das equipas dadas + os pessoais dos funcionários dados + o pessoal do próprio utilizador. */
async function calendarIdsFor(teamIds: number[], employeeIds: number[], selfUserId: string): Promise<number[]> {
  const out = new Set<number>();
  if (teamIds.length) {
    const teamCals = await db.select({ id: calendars.id }).from(calendars).where(and(eq(calendars.type, "equipa"), inArray(calendars.teamId, teamIds)));
    for (const c of teamCals) out.add(c.id);
    // pessoais cuja equipa de inserção é uma destas equipas
    const persByTeam = await db.select({ id: calendars.id }).from(calendars).where(and(eq(calendars.type, "pessoal"), inArray(calendars.teamId, teamIds)));
    for (const c of persByTeam) out.add(c.id);
  }
  if (employeeIds.length) {
    const userIds = await db.select({ id: user.id }).from(user).where(inArray(user.id, await userIdsForEmployees(employeeIds)));
    if (userIds.length) {
      const pers = await db.select({ id: calendars.id }).from(calendars).where(and(eq(calendars.type, "pessoal"), inArray(calendars.userId, userIds.map((u) => u.id))));
      for (const c of pers) out.add(c.id);
    }
  }
  const mine = await db.select({ id: calendars.id }).from(calendars).where(eq(calendars.userId, selfUserId));
  for (const c of mine) out.add(c.id);
  return [...out];
}

/** user_ids ligados a estes funcionários (via user_roles). */
async function userIdsForEmployees(employeeIds: number[]): Promise<string[]> {
  if (!employeeIds.length) return [];
  const { userRoles } = await import("../database/schema");
  const rows = await db.select({ userId: userRoles.userId }).from(userRoles).where(inArray(userRoles.employeeId, employeeIds));
  return rows.map((r) => r.userId);
}

/** Pode este utilizador ESCREVER (criar/editar) eventos neste calendário? */
async function canWriteCalendar(ctx: Ctx, calendarId: number): Promise<boolean> {
  if (FULL.includes(ctx.role)) return true;
  const visible = await visibleCalendarIds(ctx);
  if (visible == null) return true;
  return visible.includes(calendarId);
}

/** Garante que existe um calendário pessoal para um utilizador; cria se não existir. */
export async function ensurePersonalCalendar(userId: string, teamId: number | null) {
  const [existing] = await db.select().from(calendars).where(and(eq(calendars.userId, userId), eq(calendars.type, "pessoal")));
  if (existing) return existing;
  let color = "#c6f432";
  if (teamId) {
    const [t] = await db.select({ color: teams.color }).from(teams).where(eq(teams.id, teamId));
    if (t) color = t.color;
  }
  const [c] = await db.insert(calendars).values({ type: "pessoal", userId, teamId, color }).returning();
  return c;
}

/** Garante que existe um calendário de equipa. */
export async function ensureTeamCalendar(teamId: number) {
  const [existing] = await db.select().from(calendars).where(and(eq(calendars.teamId, teamId), eq(calendars.type, "equipa")));
  if (existing) return existing;
  const [t] = await db.select({ color: teams.color }).from(teams).where(eq(teams.id, teamId));
  const [c] = await db.insert(calendars).values({ type: "equipa", teamId, color: t?.color ?? "#c6f432" }).returning();
  return c;
}

/**
 * Passa o calendário pessoal de um funcionário para a hierarquia da nova equipa (os eventos seguem com ele).
 * Se não houver utilizador ligado a esse funcionário, não faz nada.
 */
export async function syncPersonalCalendarTeam(employeeId: number, teamId: number | null) {
  const { userRoles } = await import("../database/schema");
  const linked = await db.select({ userId: userRoles.userId }).from(userRoles).where(eq(userRoles.employeeId, employeeId));
  let color = "#c6f432";
  if (teamId != null) {
    const [t] = await db.select({ color: teams.color }).from(teams).where(eq(teams.id, teamId));
    if (t) color = t.color;
  }
  for (const l of linked) {
    await ensurePersonalCalendar(l.userId, teamId);
    await db.update(calendars).set({ teamId, color }).where(and(eq(calendars.userId, l.userId), eq(calendars.type, "pessoal")));
  }
}

const eventInput = z.object({
  title: z.string().min(1).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  clientName: z.string().max(200).nullable().optional(),
});

export const agenda = {
  /** Calendários visíveis + equipas e pessoas para os filtros. */
  calendars: authed.handler(async ({ context }) => {
    const visible = await visibleCalendarIds(context);
    const list = await db
      .select({
        id: calendars.id,
        type: calendars.type,
        teamId: calendars.teamId,
        color: calendars.color,
        active: calendars.active,
        ownerUserId: calendars.userId,
        ownerName: sql<string | null>`(select name from user where id = ${calendars.userId})`,
        teamName: sql<string | null>`(select name from teams where id = ${calendars.teamId})`,
      })
      .from(calendars);
    const filtered = visible == null ? list : list.filter((c) => visible.includes(c.id));
    return filtered;
  }),

  /** Eventos dos calendários visíveis, num intervalo de datas. */
  events: authed.input(z.object({ from: z.string(), to: z.string(), calendarIds: z.array(z.number()).optional() })).handler(async ({ input, context }) => {
    const visible = await visibleCalendarIds(context);
    let ids = visible;
    if (input.calendarIds?.length) {
      // só permite filtrar dentro dos que já pode ver
      ids = visible == null ? input.calendarIds : input.calendarIds.filter((id) => visible.includes(id));
    }
    const rows = await db
      .select({
        id: calendarEvents.id,
        calendarId: calendarEvents.calendarId,
        title: calendarEvents.title,
        date: calendarEvents.date,
        startTime: calendarEvents.startTime,
        endTime: calendarEvents.endTime,
        notes: calendarEvents.notes,
        clientName: calendarEvents.clientName,
        createdBy: calendarEvents.createdBy,
        updatedBy: calendarEvents.updatedBy,
        createdByName: sql<string | null>`(select name from user where id = ${calendarEvents.createdBy})`,
        updatedByName: sql<string | null>`(select name from user where id = ${calendarEvents.updatedBy})`,
      })
      .from(calendarEvents)
      .where(and(sql`${calendarEvents.date} >= ${input.from}`, sql`${calendarEvents.date} <= ${input.to}`));
    return ids == null ? rows : rows.filter((r) => ids!.includes(r.calendarId));
  }),

  create: authed.input(eventInput.extend({ calendarId: z.number() })).handler(async ({ input, context }) => {
    if (!(await canWriteCalendar(context, input.calendarId))) throw new ORPCError("FORBIDDEN", { message: "Sem permissão para escrever neste calendário." });
    const [ev] = await db
      .insert(calendarEvents)
      .values({ ...input, endTime: input.endTime ?? null, notes: input.notes ?? null, clientName: input.clientName ?? null, createdBy: context.user.id, updatedBy: context.user.id })
      .returning();
    return ev;
  }),

  update: authed.input(eventInput.extend({ id: z.number() })).handler(async ({ input, context }) => {
    const [ev] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, input.id));
    if (!ev) throw new ORPCError("NOT_FOUND", { message: "Evento não encontrado." });
    if (!(await canWriteCalendar(context, ev.calendarId))) throw new ORPCError("FORBIDDEN", { message: "Sem permissão para editar este evento." });
    await db
      .update(calendarEvents)
      .set({ title: input.title, date: input.date, startTime: input.startTime, endTime: input.endTime ?? null, notes: input.notes ?? null, clientName: input.clientName ?? null, updatedBy: context.user.id, updatedAt: new Date() })
      .where(eq(calendarEvents.id, input.id));
    return { ok: true };
  }),

  remove: authed.input(z.object({ id: z.number() })).handler(async ({ input, context }) => {
    const [ev] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, input.id));
    if (!ev) throw new ORPCError("NOT_FOUND", { message: "Evento não encontrado." });
    // Gestor Comercial só apaga os que ele próprio criou.
    if (context.role === "vendedor" && ev.createdBy !== context.user.id) throw new ORPCError("FORBIDDEN", { message: "Só pode apagar os eventos que criou." });
    if (!(await canWriteCalendar(context, ev.calendarId))) throw new ORPCError("FORBIDDEN", { message: "Sem permissão para apagar este evento." });
    await db.delete(calendarEvents).where(eq(calendarEvents.id, input.id));
    return { ok: true };
  }),

  /** Atribuições de calendários (Backoffice/RH). Ler: o próprio ou admin/diretor. Alterar: só admin/diretor. */
  assignments: {
    list: authed.input(z.object({ userId: z.string() })).handler(async ({ input, context }) => {
      if (!FULL.includes(context.role) && input.userId !== context.user.id) throw new ORPCError("FORBIDDEN");
      return db
        .select({
          id: calendarAssignments.id,
          teamId: calendarAssignments.teamId,
          employeeId: calendarAssignments.employeeId,
          teamName: sql<string | null>`(select name from teams where id = ${calendarAssignments.teamId})`,
          employeeName: sql<string | null>`(select name from employees where id = ${calendarAssignments.employeeId})`,
        })
        .from(calendarAssignments)
        .where(eq(calendarAssignments.userId, input.userId));
    }),
    set: authed
      .input(z.object({ userId: z.string(), teamIds: z.array(z.number()), employeeIds: z.array(z.number()) }))
      .handler(async ({ input, context }) => {
        if (!FULL.includes(context.role)) throw new ORPCError("FORBIDDEN", { message: "Só o Administrador e o Diretor podem alterar atribuições." });
        await db.delete(calendarAssignments).where(eq(calendarAssignments.userId, input.userId));
        for (const teamId of new Set(input.teamIds)) await db.insert(calendarAssignments).values({ userId: input.userId, teamId, assignedBy: context.user.id });
        for (const employeeId of new Set(input.employeeIds)) await db.insert(calendarAssignments).values({ userId: input.userId, employeeId, assignedBy: context.user.id });
        return { ok: true };
      }),
  },
};
