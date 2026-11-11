import type { Hono } from "hono";
import { eq, and, inArray, isNotNull, desc } from "drizzle-orm";
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

    // Filtro por origem: "res-neg" (campanhas) ou "medem" (BTE/MT).
    // Sem parâmetro devolve tudo, para não partir chamadas antigas.
    const src = c.req.query("source");
    const source = src === "medem" || src === "res-neg" ? src : null;
    // A lista não precisa do base64 do PDF (é pesado): devolvemos só hasPdf.
    const campos = {
      id: simuladorPropostas.id,
      authorName: simuladorPropostas.authorName,
      clientName: simuladorPropostas.clientName,
      clientNif: simuladorPropostas.clientNif,
      segment: simuladorPropostas.segment,
      bestPlan: simuladorPropostas.bestPlan,
      saving: simuladorPropostas.saving,
      source: simuladorPropostas.source,
      pdfName: simuladorPropostas.pdfName,
      data: simuladorPropostas.data,
      createdAt: simuladorPropostas.createdAt,
      userId: simuladorPropostas.userId,
    };

    // Vê se é chefe (tem subordinados).
    const subs = await subordinateUserIds(ctx);
    const sup = ctx.role === "admin" || ctx.role === "diretor";

    const where = (uid: string) => {
      const porUser = eq(simuladorPropostas.userId, uid);
      return source ? and(porUser, eq(simuladorPropostas.source, source)) : porUser;
    };

    let rows: {
      id: string;
      authorName: string;
      clientName: string | null;
      clientNif: string | null;
      segment: string | null;
      bestPlan: string | null;
      saving: number | null;
      source: string;
      pdfName: string | null;
      data: unknown;
      createdAt: Date;
      userId: string;
    }[];
    if (sup) {
      // Admin/diretor vê tudo.
      rows = await db
        .select(campos)
        .from(simuladorPropostas)
        .where(source ? eq(simuladorPropostas.source, source) : undefined)
        .orderBy(desc(simuladorPropostas.createdAt))
        .limit(200);
    } else if (subs.length > 0) {
      // Chefe: vê as suas + as dos subordinados.
      const allIds = [ctx.userId, ...subs];
      const acc: typeof rows = [];
      for (const uid of allIds) {
        const r = await db
          .select(campos)
          .from(simuladorPropostas)
          .where(where(uid))
          .orderBy(desc(simuladorPropostas.createdAt))
          .limit(200);
        acc.push(...r);
      }
      acc.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      rows = acc.slice(0, 200);
    } else {
      // Vendedor: só as suas.
      rows = await db
        .select(campos)
        .from(simuladorPropostas)
        .where(where(ctx.userId))
        .orderBy(desc(simuladorPropostas.createdAt))
        .limit(200);
    }

    // Quais destas propostas têm PDF guardado (uma consulta só).
    const ids = rows.map((r) => r.id);
    const comPdf = new Set<string>();
    if (ids.length) {
      const rs = await db
        .select({ id: simuladorPropostas.id, pdf: simuladorPropostas.pdfName })
        .from(simuladorPropostas)
        .where(inArray(simuladorPropostas.id, ids));
      for (const r of rs) if (r.pdf) comPdf.add(r.id);
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
        source: r.source,
        pdfName: r.pdfName,
        hasPdf: comPdf.has(r.id),
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
      source: body.source === "medem" ? "medem" : "res-neg",
      pdfBase64: typeof body.pdfBase64 === "string" ? body.pdfBase64 : null,
      pdfName: body.pdfName != null ? String(body.pdfName).slice(0, 200) : null,
    };

    // O simulador pode enviar a proposta e o PDF em dois pedidos quase
    // simultaneos. Um INSERT simples rebentava com UNIQUE constraint; o upsert
    // resolve a corrida e deixa o segundo pedido atualizar o registo.
    await db
      .insert(simuladorPropostas)
      .values(values)
      .onConflictDoUpdate({ target: simuladorPropostas.id, set: values });
    return c.json({ ok: true, created: !(existing && existing.length > 0) });
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

  // GET /api/simulador-propostas/:id/pdf — devolve o PDF guardado da proposta.
  // Mesmas regras de visibilidade: dono, chefe da equipa, ou admin/diretor.
  app.get("/api/simulador-propostas/:id/pdf", async (c) => {
    const ctx = await resolveCtx(c.req.raw.headers);
    if (!ctx) return c.json({ error: "Sem sessão" }, 401);
    const id = c.req.param("id");
    const [p] = await db
      .select({ userId: simuladorPropostas.userId, pdfBase64: simuladorPropostas.pdfBase64, pdfName: simuladorPropostas.pdfName })
      .from(simuladorPropostas)
      .where(eq(simuladorPropostas.id, id));
    if (!p) return c.json({ error: "Não encontrada" }, 404);

    let pode = p.userId === ctx.userId || ctx.role === "admin" || ctx.role === "diretor";
    if (!pode) {
      const subs = await subordinateUserIds(ctx);
      pode = subs.includes(p.userId);
    }
    if (!pode) return c.json({ error: "Sem permissão" }, 403);
    if (!p.pdfBase64) return c.json({ error: "Sem PDF guardado" }, 404);

    const bytes = Buffer.from(p.pdfBase64, "base64");
    const nome = (p.pdfName || `proposta-${id}.pdf`).replace(/["\\\r\n]/g, "");
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${nome}"`,
        "Content-Length": String(bytes.length),
        "Cache-Control": "no-store",
      },
    });
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