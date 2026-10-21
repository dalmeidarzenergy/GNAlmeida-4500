import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { authed, requireRoles } from "../middleware/auth";
import { db } from "../database";
import { account, user, userRoles, employees, session, calendars, calendarEvents, calendarAssignments } from "../database/schema";
import { ensurePersonalCalendar } from "./agenda";
import { teamMemberships } from "../database/schema";

export const me = authed.handler(async ({ context }) => {
  let employee = null;
  if (context.employeeId) {
    [employee] = await db.select().from(employees).where(eq(employees.id, context.employeeId));
  }
  return {
    id: context.user.id,
    name: context.user.name,
    email: context.user.email,
    image: context.user.image,
    role: context.role,
    employeeId: context.employeeId,
    employee: employee ?? null,
  };
});

export const users = {
  list: requireRoles("admin", "diretor", "backoffice").handler(async () => {
    return db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        createdAt: user.createdAt,
        role: userRoles.role,
        employeeId: userRoles.employeeId,
        employeeName: employees.name,
      })
      .from(user)
      .leftJoin(userRoles, eq(userRoles.userId, user.id))
      .leftJoin(employees, eq(employees.id, userRoles.employeeId))
      .orderBy(user.createdAt);
  }),
  update: requireRoles("admin", "diretor")
    .input(
      z.object({
        userId: z.string(),
        role: z.enum(["admin", "diretor", "rh", "backoffice", "coordenador", "chefe", "vendedor"]),
        name: z.string().min(1).optional(),
        email: z.string().email().optional(),
        employeeId: z.number().nullable(),
      }),
    )
    .handler(async ({ input }) => {
      if (input.role !== "admin") {
        const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(userRoles).where(and(eq(userRoles.role, "admin"), sql`${userRoles.userId} != ${input.userId}`));
        if (Number(n) === 0) throw new ORPCError("BAD_REQUEST", { message: "Tem de existir sempre pelo menos um administrador." });
      }
      if (input.email != null || input.name != null) {
        const [acc] = await db.select({ providerId: account.providerId }).from(account).where(eq(account.userId, input.userId));
        if (acc?.providerId !== "credential") throw new ORPCError("BAD_REQUEST", { message: "Não é possível alterar os dados de uma conta com início de sessão social." });
        await db.update(user).set({ ...(input.name != null ? { name: input.name } : {}), ...(input.email != null ? { email: input.email } : {}) }).where(eq(user.id, input.userId));
      }
      await db
        .insert(userRoles)
        .values({ userId: input.userId, role: input.role, employeeId: input.employeeId })
        .onConflictDoUpdate({
          target: userRoles.userId,
          set: { role: input.role, employeeId: input.employeeId },
        });
      // Garante o calendário pessoal do utilizador (equipa atual do funcionário ligado).
      if (input.employeeId != null) {
        const t = today();
        const [m] = await db
          .select({ teamId: teamMemberships.teamId })
          .from(teamMemberships)
          .where(and(eq(teamMemberships.employeeId, input.employeeId), sql`${teamMemberships.startDate} <= ${t}`, sql`(${teamMemberships.endDate} is null or ${teamMemberships.endDate} >= ${t})`));
        await ensurePersonalCalendar(input.userId, m?.teamId ?? null);
      }
      return { ok: true };
    }),

  /** Cria um utilizador com palavra-passe, perfil e ficha de funcionário. Só admin/diretor. */
  create: authed
    .input(
      z.object({
        name: z.string().min(1),
        email: z.string().email(),
        password: z.string().min(8),
        role: z.enum(["admin", "diretor", "rh", "backoffice", "coordenador", "chefe", "vendedor"]),
        employeeId: z.number().nullable().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      if (context.role !== "admin" && context.role !== "diretor" && context.role !== "backoffice") throw new ORPCError("FORBIDDEN", { message: "Sem permissão para criar utilizadores." });
      // Chefe de Equipa e Gestor Comercial precisam de ficha de funcionário.
      if ((input.role === "chefe" || input.role === "vendedor") && input.employeeId == null) {
        throw new ORPCError("BAD_REQUEST", { message: "Escolha a ficha de funcionário para este perfil." });
      }
      // Backoffice não pode criar Administradores nem Diretores.
      if (context.role === "backoffice" && (input.role === "admin" || input.role === "diretor")) {
        throw new ORPCError("FORBIDDEN", { message: "O Backoffice não pode criar Administradores nem Diretores." });
      }
      const [dup] = await db.select({ id: user.id }).from(user).where(eq(user.email, input.email));
      if (dup) throw new ORPCError("BAD_REQUEST", { message: "Já existe um utilizador com este email." });
      // Com o registo livre fechado, a conta é criada diretamente na base de dados (password cifrada como o better-auth).
      const { hashPassword } = await import("better-auth/crypto");
      const uid = crypto.randomUUID();
      const hashed = await hashPassword(input.password);
      await db.insert(user).values({ id: uid, name: input.name, email: input.email, emailVerified: false });
      await db.insert(account).values({ id: crypto.randomUUID(), accountId: uid, providerId: "credential", userId: uid, password: hashed });
      await db.insert(userRoles).values({ userId: uid, role: input.role, employeeId: input.employeeId ?? null }).onConflictDoNothing();
      if (input.employeeId != null) {
        const t = today();
        const [m] = await db
          .select({ teamId: teamMemberships.teamId })
          .from(teamMemberships)
          .where(and(eq(teamMemberships.employeeId, input.employeeId), sql`${teamMemberships.startDate} <= ${t}`, sql`(${teamMemberships.endDate} is null or ${teamMemberships.endDate} >= ${t})`));
        await ensurePersonalCalendar(uid, m?.teamId ?? null);
      }
      return { ok: true, id: uid };
    }),
  /** Elimina um utilizador: perde o acesso de imediato e o seu calendário pessoal e respetivos eventos são apagados. */
  remove: requireRoles("admin", "diretor")
    .input(z.object({ userId: z.string() }))
    .handler(async ({ input, context }) => {
      if (input.userId === context.user.id) throw new ORPCError("BAD_REQUEST", { message: "Não podes eliminar a tua própria conta." });
      const [target] = await db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, input.userId));
      if (!target) throw new ORPCError("NOT_FOUND", { message: "Utilizador não encontrado." });
      if (target.role === "admin") {
        const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(userRoles).where(and(eq(userRoles.role, "admin"), sql`${userRoles.userId} != ${input.userId}`));
        if (Number(n) === 0) throw new ORPCError("BAD_REQUEST", { message: "Tem de existir sempre pelo menos um administrador." });
      }
      await db.delete(calendarAssignments).where(eq(calendarAssignments.userId, input.userId));
      const myCals = await db.select({ id: calendars.id }).from(calendars).where(eq(calendars.userId, input.userId));
      for (const c of myCals) await db.delete(calendarEvents).where(eq(calendarEvents.calendarId, c.id));
      await db.delete(calendars).where(eq(calendars.userId, input.userId));
      await db.update(calendarEvents).set({ createdBy: null }).where(eq(calendarEvents.createdBy, input.userId));
      await db.update(calendarEvents).set({ updatedBy: null }).where(eq(calendarEvents.updatedBy, input.userId));
      await db.update(calendarAssignments).set({ assignedBy: null }).where(eq(calendarAssignments.assignedBy, input.userId));
      await db.delete(session).where(eq(session.userId, input.userId));
      await db.delete(account).where(eq(account.userId, input.userId));
      await db.delete(userRoles).where(eq(userRoles.userId, input.userId));
      await db.delete(user).where(eq(user.id, input.userId));
      return { ok: true };
    }),
};

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" });
