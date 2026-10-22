import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { base } from "../__core/app";
import { auth } from "../auth";
import { db } from "../database";
import { userRoles } from "../database/schema";
import { effectivePermissions, type ModuleKey, type Permissions, type Role } from "../permissions";

export type { Role, Permissions, ModuleKey };

async function resolveRole(userId: string) {
  const [existing] = await db.select().from(userRoles).where(eq(userRoles.userId, userId));
  if (existing) return existing;
  // Novo utilizador sem perfil definido: fica como Gestor Comercial (o admin ajusta depois em Utilizadores).
  const [created] = await db.insert(userRoles).values({ userId, role: "vendedor" }).onConflictDoNothing().returning();
  if (created) return created;
  const [again] = await db.select().from(userRoles).where(eq(userRoles.userId, userId));
  return again;
}

/** Protected procedures — `context.user`, `context.role`, `context.employeeId`, `context.permissions`. */
export const authed = base.use(async ({ context, next }) => {
  const session = await auth.api.getSession({ headers: context.headers });
  if (!session) throw new ORPCError("UNAUTHORIZED");
  const r = await resolveRole(session.user.id);
  const role = r.role as Role;
  return next({
    context: {
      user: session.user,
      session: session.session,
      role,
      employeeId: r.employeeId ?? null,
      permissions: effectivePermissions(role, r.permissions),
    },
  });
});

export const requireRoles = (...roles: Role[]) =>
  authed.use(async ({ context, next }) => {
    if (!roles.includes(context.role)) {
      throw new ORPCError("FORBIDDEN", { message: "Sem permissão para esta ação" });
    }
    return next();
  });

/** Exige que o utilizador veja o módulo (menu/página) indicado. */
export const requireView = (module: ModuleKey) =>
  authed.use(async ({ context, next }) => {
    if (!context.permissions[module]?.view) {
      throw new ORPCError("FORBIDDEN", { message: "Sem permissão para ver esta área" });
    }
    return next();
  });

/** Exige que o utilizador possa editar o módulo indicado. */
export const requireEdit = (module: ModuleKey) =>
  authed.use(async ({ context, next }) => {
    if (!context.permissions[module]?.edit) {
      throw new ORPCError("FORBIDDEN", { message: "Sem permissão para editar esta área" });
    }
    return next();
  });

// Os perfis continuam a reger o acesso a funcionalidades que dependem do âmbito de dados
// (gestão de utilizadores, agenda, relatórios). As restantes áreas usam `requireView`/`requireEdit`
// sobre as permissões efetivas de cada utilizador.
