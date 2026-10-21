import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { base } from "../__core/app";
import { auth } from "../auth";
import { db } from "../database";
import { userRoles } from "../database/schema";

export type Role = "admin" | "diretor" | "rh" | "backoffice" | "coordenador" | "chefe" | "vendedor";

async function resolveRole(userId: string) {
  const [existing] = await db.select().from(userRoles).where(eq(userRoles.userId, userId));
  if (existing) return existing;
  // Novo utilizador sem perfil definido: fica como Gestor Comercial (o admin ajusta depois em Utilizadores).
  const [created] = await db.insert(userRoles).values({ userId, role: "vendedor" }).onConflictDoNothing().returning();
  if (created) return created;
  const [again] = await db.select().from(userRoles).where(eq(userRoles.userId, userId));
  return again;
}

/** Protected procedures — `context.user`, `context.role`, `context.employeeId`. */
export const authed = base.use(async ({ context, next }) => {
  const session = await auth.api.getSession({ headers: context.headers });
  if (!session) throw new ORPCError("UNAUTHORIZED");
  const r = await resolveRole(session.user.id);
  return next({
    context: {
      user: session.user,
      session: session.session,
      role: r.role as Role,
      employeeId: r.employeeId ?? null,
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

export const adminOnly = requireRoles("admin");
export const hrAccess = requireRoles("admin", "rh");
/** Vendas e clientes: leitura para admin, chefe e gestor comercial; escrita só admin/rh (ver `salesAccess.write`). */
export const salesAccess = requireRoles("admin", "rh", "chefe", "vendedor");
/** Só admin e RH editam clientes, vendas e campanhas; chefes e gestores comerciais só leem. */
export const salesWrite = requireRoles("admin", "rh");
