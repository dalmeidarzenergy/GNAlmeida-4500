import type { Hono } from "hono";
import { eq, isNotNull, desc } from "drizzle-orm";
import { auth } from "../auth";
import { db } from "../database";
import { user, userRoles, employees, simuladorPropostas } from "../database/schema";

interface Ctx {
  userId: string;
  name: string;
  role: string;
  employeeId: number | null;
}

async function resolveCtx(headers: Headers): Promise<Ctx | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  const [r] = await db.select().from(userRoles).where(eq(userRoles.userId, session.user.id));
  const role = r?.role ?? "vendedor";
  const name = session.user.name || session.user.email;
  return { userId: session.user.id, name, role, employeeId: r?.employeeId ?? null };
}

/** Carrega hierarquia (employees + ligações a utilizadores). */
async function loadPeople() {
  const emps = await db
    .select({ id: employees.id, name: employees.name, email: employees.email, managerId: employees.managerId, status: employees.status })
    .from(employees);
  const roles = await db
    .select({ userId: userRoles.userId, employeeId: userRoles.employeeId })
    .from(userRoles)
    .where(isNotNull(userRoles.employeeId));
  const empToUser = new Map<number, string>();
  for (const r of roles) if (r.employeeId != null) empToUser.set(r.employeeId, r.userId);
  const users = await db.select({ id: user.id, email: user.email }).from(user);
  const emailToUser = new Map<string, string>();
  for (const u of users) if (u.email) emailToUser.set(u.email.toLowerCase(), u.id);
  for (const e of emps) {
    if (empToUser.has(e.id)) continue;
    const uid = emailToUser.get(e.email.toLowerCase());
    if (uid) empToUser.set(e.id, uid);
  }
  return { emps, empToUser };
}

/** IDs dos funcionários abaixo (recursivo) de um funcionário. */
function descendants(rootId: number, emps: { id: number; managerId: number | null }[]): number[] {
  const byManager = new Map<number, number[]>();
  for (const e of emps) {
    if (e.managerId == null) continue;
    const arr = byManager.get(e.managerId) ?? [];
    arr.push(e.id);
    byManager.set(e.managerId, arr);
  }
  const out: number[] = [];
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const child of byManager.get(cur) ?? []) {
      out.push(child);
      stack.push(child);
    }
  }
  return out;
}

/** Utilizadores que estão abaixo do utilizador autenticado na hierarquia. */
async function subordinateUserIds(ctx: Ctx): Promise<string[]> {
  if (ctx.employeeId == null) return [];
  const { emps, empToUser } = await loadPeople();
  const scope = descendants(ctx.employeeId, emps);
  // Inclui o próprio.
  const mine = empToUser.get(ctx.employeeId);
  const ids = mine ? [mine] : [];
  for (const eid of scope) {
    const uid = empToUser.get(eid);
    if (uid && !ids.includes(uid)) ids.push(uid);
  }
  return ids;
}

export function simulador(app: Hono) {
  // GET /api/simulador-propostas — devolve as propostas do utilizador e,
  // para chefes/superiores, as propostas da equipa abaixo com authorName.
  app.get("/api/simulador-propostas", async (c) => {
    const ctx = await resolveCtx(c.req.raw.headers);
    if (!ctx) return c.json({ error: "Sem sessão" }, 401);

    // Vê se é chefe (tem subordinados).
    const subs = await subordinateUserIds(ctx);
    const sup = ctx.role === "admin" || ctx.role === "diretor";

    let rows: (typeof simuladorPropostas.$inferSelect)[];
    if (sup) {
      // Admin/diretor vê tudo.
      rows = await db.select().from(simuladorPropostas).orderBy(desc(simuladorPropostas.createdAt)).limit(200);
    } else if (subs.length > 0) {
      // Chefe: vê as suas + as dos subordinados.
      const allIds = [ctx.userId, ...subs];
      rows = [];
      for (const uid of allIds) {
        const r = await db
          .select()
          .from(simuladorPropostas)
          .where(eq(simuladorPropostas.userId, uid))
          .orderBy(desc(simuladorPropostas.createdAt))
          .limit(200);
        rows.push(...r);
      }
      rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      rows = rows.slice(0, 200);
    } else {
      // Vendedor: só as suas.
      rows = await db
        .select()
        .from(simuladorPropostas)
        .where(eq(simuladorPropostas.userId, ctx.userId))
        .orderBy(desc(simuladorPropostas.createdAt))
        .limit(200);
    }

    return c.json(
      rows.map((r) => ({
        id: r.id,
        authorName: r.authorName,
        clientName: r.clientName,
        clientNif: r.clientNif,
        segment: r.segment,
        bestPlan: r.bestPlan,
        saving: r.saving,
        data: r.data,
        createdAt: r.createdAt.toISOString(),
        isOwn: r.userId === ctx.userId,
      })),
    );
  });

  // POST /api/simulador-propostas — guarda uma proposta.
  app.post("/api/simulador-propostas", async (c) => {
    const ctx = await resolveCtx(c.req.raw.headers);
    if (!ctx) return c.json({ error: "Sem sessão" }, 401);
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body?.id) return c.json({ error: "id em falta" }, 400);

    const [existing] = await db
      .select({ id: simuladorPropostas.id })
      .from(simuladorPropostas)
      .where(eq(simuladorPropostas.id, String(body.id)));

    const values = {
      id: String(body.id),
      userId: ctx.userId,
      authorName: ctx.name,
      employeeId: ctx.employeeId,
      clientName: body.clientName != null ? String(body.clientName).slice(0, 200) : null,
      clientNif: body.clientNif != null ? String(body.clientNif).slice(0, 20) : null,
      segment: body.segment != null ? String(body.segment).slice(0, 50) : null,
      bestPlan: body.bestPlan != null ? String(body.bestPlan).slice(0, 200) : null,
      saving: typeof body.saving === "number" ? body.saving : 0,
      data: (body.data as Record<string, unknown>) ?? {},
    };

    if (existing.length > 0) {
      await db.update(simuladorPropostas).set(values).where(eq(simuladorPropostas.id, String(body.id)));
      return c.json({ ok: true, created: false });
    }
    await db.insert(simuladorPropostas).values(values);
    return c.json({ ok: true, created: true });
  });

  // DELETE /api/simulador-propostas/:id — apaga uma proposta (só o dono ou admin).
  app.delete("/api/simulador-propostas/:id", async (c) => {
    const ctx = await resolveCtx(c.req.raw.headers);
    if (!ctx) return c.json({ error: "Sem sessão" }, 401);
    const id = c.req.param("id");
    const [p] = await db.select().from(simuladorPropostas).where(eq(simuladorPropostas.id, id));
    if (!p) return c.json({ error: "Não encontrada" }, 404);
    if (p.userId !== ctx.userId && ctx.role !== "admin" && ctx.role !== "diretor") {
      return c.json({ error: "Só podes apagar as tuas propostas" }, 403);
    }
    await db.delete(simuladorPropostas).where(eq(simuladorPropostas.id, id));
    return c.json({ ok: true });
  });

  // GET /api/me — endpoint REST para o simulador obter os dados do utilizador.
  app.get("/api/me", async (c) => {
    const ctx = await resolveCtx(c.req.raw.headers);
    if (!ctx) return c.json({ error: "Sem sessão" }, 401);
    let phone = "";
    if (ctx.employeeId) {
      const [emp] = await db.select({ phone: employees.phone }).from(employees).where(eq(employees.id, ctx.employeeId));
      phone = emp?.phone ?? "";
    }
    return c.json({ name: ctx.name, email: "", phone, role: ctx.role });
  });
}