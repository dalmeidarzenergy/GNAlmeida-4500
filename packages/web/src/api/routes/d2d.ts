import type { Hono } from "hono";
import { eq, and, isNotNull, isNull, inArray } from "drizzle-orm";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { auth } from "../auth";
import { db } from "../database";
import {
  user,
  userRoles,
  employees,
  d2dShifts,
  d2dDoors,
  d2dEvents,
  d2dDailyReports,
  d2dDocuments,
  d2dMailbox,
  d2dGoals,
} from "../database/schema";
import type { Role } from "../middleware/auth";

/* ============================================================
 * Módulo Terreno D2D — pontos de acesso REST (Hono)
 * Contrato com a página d2d.html (ver o guia de integração).
 * ============================================================ */

const UPLOAD_DIR = resolve(import.meta.dirname, "../../../public/uploads/d2d");

const RES_CODES = ["ausente", "recusa", "lead", "voltar", "venda", "cliente", "nt"] as const;
type ResCode = (typeof RES_CODES)[number];

/** Perfis D2D: tudo o que não é vendedor vê a equipa (só leitura). */
function d2dRole(role: Role): "chefe" | "comercial" {
  return role === "vendedor" ? "comercial" : "chefe";
}

interface Ctx {
  userId: string;
  name: string;
  role: Role;
  employeeId: number | null;
}

async function resolveCtx(headers: Headers): Promise<Ctx | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  const [r] = await db.select().from(userRoles).where(eq(userRoles.userId, session.user.id));
  const role: Role = (r?.role ?? "vendedor") as Role;
  const name = session.user.name || session.user.email;
  return { userId: session.user.id, name, role, employeeId: r?.employeeId ?? null };
}

/** Timestamps em ms → Date (para gravar/ler a BD sem perder precisão). */
const ts = (ms: unknown): number | null => {
  const n = typeof ms === "number" ? ms : Number(ms);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/* ------------------------------------------------------------
 * Hierarquia (usa employees.managerId = parentId no D2D)
 * ------------------------------------------------------------ */

/** Todos os utilizadores ligados a funcionários, com o id do responsável. */
async function loadPeople() {
  const emps = await db.select({ id: employees.id, name: employees.name, email: employees.email, phone: employees.phone, managerId: employees.managerId, status: employees.status }).from(employees);
  const roles = await db.select({ userId: userRoles.userId, employeeId: userRoles.employeeId }).from(userRoles).where(isNotNull(userRoles.employeeId));
  const empToUser = new Map<number, string>();
  for (const r of roles) if (r.employeeId != null) empToUser.set(r.employeeId, r.userId);
  // Responsáveis (e outros funcionários) que tenham conta mas sem ligação direta via user_roles:
  // liga pelo email, para que a cadeia de superiores resolva corretamente.
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

/** Ids dos funcionários abaixo (recursivo) do funcionário dado. */
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

/* ------------------------------------------------------------
 * Construção dos objetos devolvidos à página
 * ------------------------------------------------------------ */

async function doorJson(d: typeof d2dDoors.$inferSelect): Promise<Record<string, unknown>> {
  const docs = await db
    .select({ id: d2dDocuments.id, name: d2dDocuments.name, type: d2dDocuments.type, size: d2dDocuments.size, createdAt: d2dDocuments.createdAt })
    .from(d2dDocuments)
    .where(and(eq(d2dDocuments.userId, d.userId), eq(d2dDocuments.portaT, d.t)));
  return {
    t: d.t,
    rua: d.rua,
    num: d.num,
    zona: d.zona ?? "",
    res: d.res,
    cli: d.cli ?? "",
    tel: d.tel ?? "",
    nota: d.nota ?? "",
    loc: d.lat != null && d.lng != null ? { lat: d.lat, lng: d.lng, acc: d.acc ?? null } : null,
    docs: docs.map((m) => ({ id: m.id, name: m.name, type: m.type, size: m.size, t: m.createdAt.getTime(), url: `/api/d2d/file/${encodeURIComponent(m.id)}` })),
    done: d.done ?? false,
  };
}

function shiftJson(s: typeof d2dShifts.$inferSelect): Record<string, unknown> {
  return {
    name: s.name,
    zone: s.zone,
    start: s.start,
    end: s.end ?? null,
    loc: s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : null,
  };
}

async function userState(userId: string): Promise<{ shift: Record<string, unknown> | null; doors: Record<string, unknown>[]; streets: string[]; history: Record<string, unknown>[] }> {
  const [shift] = await db.select().from(d2dShifts).where(eq(d2dShifts.userId, userId)).orderBy(d2dShifts.start).limit(1);
  // Só o turno aberto conta como "atual".
  const open = shift && shift.end == null ? shift : null;
  const doors = open ? await db.select().from(d2dDoors).where(eq(d2dDoors.shiftId, open.id)) : [];
  const streets = [...new Set(doors.map((d) => d.rua))];
  const history = await db
    .select()
    .from(d2dShifts)
    .where(eq(d2dShifts.userId, userId));
  const closed = history.filter((s) => s.end != null);
  const histJson: Record<string, unknown>[] = [];
  for (const s of closed.sort((a, b) => b.start - a.start)) {
    const hd = await db.select().from(d2dDoors).where(eq(d2dDoors.shiftId, s.id));
    const hstreets = [...new Set(hd.map((d) => d.rua))];
    histJson.push({ id: s.id, shift: shiftJson(s), doors: await Promise.all(hd.map(doorJson)), streets: hstreets });
  }
  return { shift: open ? shiftJson(open) : null, doors: await Promise.all(doors.map(doorJson)), streets, history: histJson };
}

/* ------------------------------------------------------------
 * Manipulação de eventos
 * ------------------------------------------------------------ */

async function applyEvent(userId: string, employeeId: number | null, tipo: string, dados: Record<string, unknown> | null) {
  const d = dados ?? {};
  if (tipo === "inicio") {
    const start = ts(d.start);
    if (start == null) return;
    // Fecha turnos abertos anteriores do mesmo utilizador.
    await db.update(d2dShifts).set({ end: start }).where(eq(d2dShifts.userId, userId));
    const loc = (d.loc as { lat?: number; lng?: number } | null) ?? null;
    await db.insert(d2dShifts).values({
      userId,
      employeeId,
      name: typeof d.name === "string" ? d.name : "Comercial",
      zone: typeof d.zone === "string" ? d.zone : "",
      start,
      end: null,
      lat: loc?.lat ?? null,
      lng: loc?.lng ?? null,
    });
  } else if (tipo === "porta") {
    const [shift] = await db.select().from(d2dShifts).where(eq(d2dShifts.userId, userId)).orderBy(d2dShifts.start).limit(1);
    if (!shift || shift.end != null) return; // sem turno aberto
    const loc = (d.loc as { lat?: number; lng?: number; acc?: number } | null) ?? null;
    const t = ts(d.t) ?? Date.now();
    await db.insert(d2dDoors).values({
      shiftId: shift.id,
      userId,
      t,
      rua: typeof d.rua === "string" ? d.rua : "",
      num: String(d.num ?? ""),
      zona: typeof d.zona === "string" ? d.zona : null,
      res: RES_CODES.includes(d.res as ResCode) ? (d.res as ResCode) : "ausente",
      cli: typeof d.cli === "string" ? d.cli : null,
      tel: typeof d.tel === "string" ? d.tel : null,
      nota: typeof d.nota === "string" ? d.nota : null,
      lat: loc?.lat ?? null,
      lng: loc?.lng ?? null,
      acc: loc?.acc ?? null,
    });
  } else if (tipo === "porta_editada") {
    const t = ts(d.t);
    if (t == null) return;
    const loc = (d.loc as { lat?: number; lng?: number; acc?: number } | null) ?? null;
    await db
      .update(d2dDoors)
      .set({
        rua: typeof d.rua === "string" ? d.rua : undefined,
        num: d.num != null ? String(d.num) : undefined,
        zona: typeof d.zona === "string" ? d.zona : undefined,
        res: RES_CODES.includes(d.res as ResCode) ? (d.res as ResCode) : undefined,
        cli: typeof d.cli === "string" ? d.cli : undefined,
        tel: typeof d.tel === "string" ? d.tel : undefined,
        nota: typeof d.nota === "string" ? d.nota : undefined,
        lat: loc?.lat ?? undefined,
        lng: loc?.lng ?? undefined,
        acc: loc?.acc ?? undefined,
        done: typeof d.done === "boolean" ? d.done : undefined,
      })
      .where(and(eq(d2dDoors.userId, userId), eq(d2dDoors.t, t)));
  } else if (tipo === "porta_apagada") {
    const t = ts(d.t);
    if (t == null) return;
    await db.delete(d2dDoors).where(and(eq(d2dDoors.userId, userId), eq(d2dDoors.t, t)));
  } else if (tipo === "fim") {
    const [shift] = await db.select().from(d2dShifts).where(eq(d2dShifts.userId, userId)).orderBy(d2dShifts.start).limit(1);
    if (!shift || shift.end != null) return;
    const end = ts(d.shift ? (d.shift as Record<string, unknown>).end : null) ?? Date.now();
    await db.update(d2dShifts).set({ end }).where(eq(d2dShifts.id, shift.id));
    await buildDailyReport(shift.id, userId, false);
  } else if (tipo === "alerta_fecho") {
    // registado apenas (o alerta push com a página fechada é tratado noutro ponto)
  }
}

/** Gera (ou regenera) o relatório diário de um turno fechado. */
async function buildDailyReport(shiftId: number, userId: string, autoClosed: boolean) {
  const [shift] = await db.select().from(d2dShifts).where(eq(d2dShifts.id, shiftId));
  if (!shift || shift.end == null) return;
  const doors = await db.select().from(d2dDoors).where(eq(d2dDoors.shiftId, shiftId));
  const resumo = { portas: doors.length, vendas: doors.filter((d) => d.res === "venda").length, interessados: doors.filter((d) => d.res === "lead" || d.res === "voltar").length };
  const data = new Date(shift.start).toISOString().slice(0, 10);
  await db
    .insert(d2dDailyReports)
    .values({
      shiftId,
      userId,
      data,
      zone: shift.zone,
      inicio: shift.start,
      fim: shift.end,
      resumo,
      relatorio: null,
      portas: (await Promise.all(doors.map(doorJson))) as unknown[],
      autoClosed,
    })
    .onConflictDoNothing();
}

/* ------------------------------------------------------------
 * Documentos
 * ------------------------------------------------------------ */

/* ------------------------------------------------------------
 * Registo das rotas no Hono app
 * ------------------------------------------------------------ */
export function d2d(app: Hono) {
  // Recebe eventos da página (fila, um de cada vez).
  app.post("/api/d2d", async (c) => {
    const ctx = await resolveCtx(c.req.raw.headers);
    if (!ctx) return c.json({ error: "Sem sessão" }, 401);
    const body = (await c.req.json().catch(() => null)) as { id?: string; tipo?: string; dados?: Record<string, unknown> } | null;
    if (!body?.tipo) return c.json({ error: "Evento inválido" }, 400);
    // id único evita repetidos
    if (body.id) {
      const [existing] = await db.select({ id: d2dEvents.id }).from(d2dEvents).where(eq(d2dEvents.id, body.id));
      if (existing) return c.json({ ok: true, dup: true }, 200);
    }
    await db.insert(d2dEvents).values({ id: body.id ?? crypto.randomUUID(), tipo: body.tipo, userId: ctx.userId, hora: Date.now(), dados: body.dados ?? null }).onConflictDoNothing();
    await applyEvent(ctx.userId, ctx.employeeId, body.tipo, body.dados ?? null);
    return c.json({ ok: true }, 201);
  });

  // Estado do próprio utilizador.
  app.get("/api/d2d/me", async (c) => {
    const ctx = await resolveCtx(c.req.raw.headers);
    if (!ctx) return c.json({ error: "Sem sessão" }, 401);
    return c.json(await userState(ctx.userId));
  });

  // Equipa do chefe autenticado (só leitura do que está abaixo dele).
  app.get("/api/d2d/equipa", async (c) => {
    const ctx = await resolveCtx(c.req.raw.headers);
    if (!ctx) return c.json({ error: "Sem sessão" }, 401);
    if (d2dRole(ctx.role) !== "chefe") return c.json({ error: "Sem permissão" }, 403);
    const { emps, empToUser } = await loadPeople();
    const scope = ctx.employeeId != null ? [ctx.employeeId, ...descendants(ctx.employeeId, emps)] : [];
    const result: Record<string, unknown>[] = [];
    for (const emp of emps) {
      if (emp.status === "inativo") continue;
      const uid = empToUser.get(emp.id);
      if (!uid) continue;
      // chefe vê-se a si próprio e quem está abaixo; admin/diretor veem todos.
      const isAdminish = ctx.role === "admin" || ctx.role === "diretor";
      if (!isAdminish && ctx.employeeId != null && !scope.includes(emp.id)) continue;
      const state = await userState(uid);
      const managerUid = emp.managerId != null ? empToUser.get(emp.managerId) ?? null : null;
      result.push({
        id: uid,
        name: emp.name,
        role: emp.id === ctx.employeeId ? d2dRole(ctx.role) : d2dRole((await resolveRoleOf(uid)) ?? "vendedor"),
        parentId: managerUid,
        contact: emp.email || emp.phone || "",
        ...state,
      });
    }
    return c.json(result);
  });

  // Superiores (cadeia acima) do utilizador autenticado — destinos possíveis de envio.
  app.get("/api/d2d/superiores", async (c) => {
    const ctx = await resolveCtx(c.req.raw.headers);
    if (!ctx) return c.json({ error: "Sem sessão" }, 401);
    return c.json(await superiorsOf(ctx.employeeId));
  });

  // Meta do dia (portas + vendas) aplicável ao utilizador autenticado.
  app.get("/api/d2d/meta", async (c) => {
    const ctx = await resolveCtx(c.req.raw.headers);
    if (!ctx) return c.json({ error: "Sem sessão" }, 401);
    return c.json(await todayGoalFor(ctx));
  });

  // Definir a meta do dia (só chefia).
  app.post("/api/d2d/meta", async (c) => {
    const ctx = await resolveCtx(c.req.raw.headers);
    if (!ctx) return c.json({ error: "Sem sessão" }, 401);
    if (d2dRole(ctx.role) !== "chefe") return c.json({ error: "Sem permissão" }, 403);
    const body = (await c.req.json().catch(() => null)) as { portas?: unknown; vendas?: unknown } | null;
    const portas = Number(body?.portas);
    const vendas = Number(body?.vendas);
    if (!Number.isInteger(portas) || !Number.isInteger(vendas) || portas < 0 || vendas < 0 || portas > 10000 || vendas > 10000) {
      return c.json({ error: "Valores inválidos." }, 422);
    }
    const data = todayD2D();
    const ownerId = ctx.employeeId; // null = global (admin/diretor)
    await db.delete(d2dGoals).where(and(eq(d2dGoals.data, data), ownerId == null ? isNull(d2dGoals.employeeId) : eq(d2dGoals.employeeId, ownerId)));
    await db.insert(d2dGoals).values({ employeeId: ownerId, data, portas, vendas });
    return c.json({ ok: true, portas, vendas });
  });

  // Caixa de documentos (recebidos / enviados).
  app.get("/api/d2d/caixa", async (c) => {
    const ctx = await resolveCtx(c.req.raw.headers);
    if (!ctx) return c.json({ error: "Sem sessão" }, 401);
    const items = await db
      .select({
        id: d2dMailbox.id,
        docId: d2dMailbox.docId,
        kind: d2dMailbox.kind,
        fromName: d2dMailbox.fromName,
        fromUserId: d2dMailbox.fromUserId,
        read: d2dMailbox.read,
        name: d2dDocuments.name,
        type: d2dDocuments.type,
        size: d2dDocuments.size,
        messageId: d2dDocuments.messageId,
        nota: d2dDocuments.nota,
        cli: d2dDocuments.cli,
        nif: d2dDocuments.nif,
        portaT: d2dDocuments.portaT,
        docUserId: d2dDocuments.userId,
        createdAt: d2dDocuments.createdAt,
      })
      .from(d2dMailbox)
      .innerJoin(d2dDocuments, eq(d2dMailbox.docId, d2dDocuments.id))
      .where(eq(d2dMailbox.userId, ctx.userId))
      .orderBy(d2dMailbox.createdAt);
    return c.json(
      items.map((i) => ({
        id: i.docId,
        messageId: i.messageId ?? null,
        kind: i.kind,
        name: i.name,
        type: i.type,
        size: i.size,
        t: i.createdAt.getTime(),
        url: `/api/d2d/file/${encodeURIComponent(i.docId)}`,
        from: { id: i.fromUserId ?? "", name: i.fromName ?? "" },
        nota: i.nota ?? "",
        cli: i.cli ?? "",
        nif: i.nif ?? "",
        porta: i.portaT != null ? { t: i.portaT, userId: i.docUserId } as const : null,
        read: i.read,
      })),
    );
  });

  // Upload de documento (multipart): anexo de porta ou envio da chefia.
  app.post("/api/d2d/documentos", async (c) => {
    const ctx = await resolveCtx(c.req.raw.headers);
    if (!ctx) return c.json({ error: "Sem sessão" }, 401);
    const form = await c.req.formData().catch(() => null);
    if (!form) return c.json({ error: "Corpo inválido" }, 400);
    const file = form.get("file") as File | null;
    if (!file) return c.json({ error: "Ficheiro em falta" }, 400);
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") return c.json({ error: "Só imagens e PDF" }, 422);
    if (file.size > 15 * 1048576) return c.json({ error: "Máximo 15 MB" }, 422);
    const id = typeof form.get("id") === "string" ? form.get("id") as string : crypto.randomUUID();
    const [dup] = await db.select({ id: d2dDocuments.id }).from(d2dDocuments).where(eq(d2dDocuments.id, id));
    if (dup) return c.json({ url: `/api/d2d/file/${encodeURIComponent(id)}` }, 200);
    const name = (form.get("nome") as string) || file.name || "documento";
    const ext = name.split(".").pop() || "bin";
    const filename = `${id.replace(/[^\w.-]/g, "")}.${ext}`;
    if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });
    writeFileSync(resolve(UPLOAD_DIR, filename), Buffer.from(await file.arrayBuffer()));
    const portaT = ts(form.get("porta_t"));
    let destinatario = (form.get("destinatario") as string) || null;
    const nota = (form.get("nota") as string) || null;
    const cli = (form.get("cli") as string) || null;
    const nif = (form.get("nif") as string) || null;
    const messageId = (form.get("message_id") as string) || null;
    // Um comercial envia para "chefe": resolve para o seu chefe direto (ficheiros vão para a caixa dele).
    if (destinatario === "chefe") {
      destinatario = await directManagerUserId(ctx.userId);
      if (!destinatario) return c.json({ error: "Sem chefe direto definido." }, 422);
    }
    // Envio à hierarquia: só podem ir para um superior (nunca para baixo).
    if (destinatario != null) {
      if (destinatario === "equipa") return c.json({ error: "O envio para a equipa foi descontinuado. Envia para um superior." }, 422);
      const sup = await superiorsOf(ctx.employeeId);
      if (!sup.some((s) => s.id === destinatario)) {
        return c.json({ error: "Só podes enviar para um superior na tua hierarquia." }, 422);
      }
    }
    await db.insert(d2dDocuments).values({
      id,
      userId: ctx.userId,
      portaT,
      name,
      type: file.type,
      size: file.size,
      path: filename,
      destinatario,
      nota,
      cli,
      nif,
      messageId,
    });
    // Caixa: anexo de porta → notifica os chefes acima; envio → destinatários (equipa, chefe direto ou pessoa).
    await fillMailbox(id, ctx, portaT, destinatario);
    return c.json({ url: `/api/d2d/file/${encodeURIComponent(id)}` }, 201);
  });

  // Servir o ficheiro de um documento, protegido por sessão.
  app.get("/api/d2d/file/:id", async (c) => {
    const ctx = await resolveCtx(c.req.raw.headers);
    if (!ctx) return c.json({ error: "Sem sessão" }, 401);
    const id = decodeURIComponent(c.req.param("id"));
    const [doc] = await db.select().from(d2dDocuments).where(eq(d2dDocuments.id, id));
    if (!doc) return c.notFound();
    // Permissão: dono, destinatário, ou chefe acima do dono.
    if (!(await canAccessDoc(ctx, doc.userId, doc.portaT, doc.destinatario))) return c.json({ error: "Sem permissão" }, 403);
    const buf = readFileSync(resolve(UPLOAD_DIR, doc.path));
    return new Response(buf as unknown as BodyInit, {
      headers: { "Content-Type": doc.type, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(doc.name)}` },
    });
  });

  // Marcar documentos como lidos.
  app.post("/api/d2d/lidos", async (c) => {
    const ctx = await resolveCtx(c.req.raw.headers);
    if (!ctx) return c.json({ error: "Sem sessão" }, 401);
    const body = (await c.req.json().catch(() => null)) as { ids?: string[] } | null;
    if (body?.ids?.length) {
      await db.update(d2dMailbox).set({ read: true }).where(inArray(d2dMailbox.docId, body.ids));
    }
    return c.json({ ok: true });
  });

  // Apagar uma mensagem da caixa (só a cópia do utilizador autenticado).
  app.delete("/api/d2d/caixa/:docId", async (c) => {
    const ctx = await resolveCtx(c.req.raw.headers);
    if (!ctx) return c.json({ error: "Sem sessão" }, 401);
    await db.delete(d2dMailbox).where(and(eq(d2dMailbox.userId, ctx.userId), eq(d2dMailbox.docId, decodeURIComponent(c.req.param("docId")))));
    return c.json({ ok: true });
  });
}

/* ------------------------------------------------------------
 * Helpers de permissão e caixa
 * ------------------------------------------------------------ */

async function resolveRoleOf(userId: string): Promise<Role | null> {
  const [r] = await db.select().from(userRoles).where(eq(userRoles.userId, userId));
  return (r?.role as Role) ?? null;
}

async function canAccessDoc(ctx: Ctx, ownerUserId: string, portaT: number | null, destinatario: string | null): Promise<boolean> {
  if (ctx.userId === ownerUserId) return true;
  if (destinatario != null) {
    // Envio à hierarquia: além do dono, só o destinatário (ou a equipa) acede.
    return destinatario === "equipa" || destinatario === ctx.userId;
  }
  // Anexo a porta (sem destinatário): chefes acima do dono podem ver.
  if (d2dRole(ctx.role) === "chefe") {
    const { emps, empToUser } = await loadPeople();
    const ownerEmp = [...empToUser.entries()].find(([, u]) => u === ownerUserId)?.[0];
    if (ownerEmp == null) return false;
    if (ctx.role === "admin" || ctx.role === "diretor") return true;
    if (ctx.employeeId != null) {
      const scope = descendants(ctx.employeeId, emps);
      if (scope.includes(ownerEmp)) return true;
    }
  }
  return false;
}

async function fillMailbox(docId: string, ctx: Ctx, portaT: number | null, destinatario: string | null) {
  if (destinatario != null) {
    // Envio da chefia.
    const targets = destinatario === "equipa" ? await teamTargetIds(ctx) : [destinatario];
    for (const t of targets) {
      await db.insert(d2dMailbox).values({ userId: t, docId, kind: "enviado", fromUserId: ctx.userId, fromName: ctx.name, read: false });
    }
    return;
  }
  if (portaT == null) return;
  // Anexo a porta: notifica os chefes acima do dono.
  const { emps, empToUser } = await loadPeople();
  const ownerEmp = [...empToUser.entries()].find(([, u]) => u === ctx.userId)?.[0];
  if (ownerEmp == null) return;
  for (const emp of emps) {
    if (emp.id === ownerEmp) continue;
    if (emp.managerId == null) continue;
    const chain = descendants(emp.id, emps);
    if (!chain.includes(ownerEmp)) continue;
    const chefUid = empToUser.get(emp.id);
    if (chefUid) await db.insert(d2dMailbox).values({ userId: chefUid, docId, kind: "venda", fromUserId: ctx.userId, fromName: ctx.name, read: false });
  }
}

async function teamTargetIds(ctx: Ctx): Promise<string[]> {
  const { emps, empToUser } = await loadPeople();
  if (ctx.employeeId == null) return [];
  const scope = descendants(ctx.employeeId, emps);
  return scope.map((id) => empToUser.get(id)).filter((x): x is string => x != null);
}

/** Id do utilizador do chefe direto (responsável na hierarquia) de um utilizador. */
async function directManagerUserId(userId: string): Promise<string | null> {
  const { emps, empToUser } = await loadPeople();
  const myEmp = [...empToUser.entries()].find(([, u]) => u === userId)?.[0];
  if (myEmp == null) return null;
  const emp = emps.find((e) => e.id === myEmp);
  const managerId = emp?.managerId;
  if (managerId == null) return null;
  return empToUser.get(managerId) ?? null;
}

/** Cadeia de superiores (do chefe direto até ao topo) de um funcionário. */
async function superiorsOf(employeeId: number | null): Promise<{ id: string; name: string }[]> {
  if (employeeId == null) return [];
  const { emps, empToUser } = await loadPeople();
  const byId = new Map(emps.map((e) => [e.id, e]));
  const out: { id: string; name: string }[] = [];
  const seen = new Set<number>();
  let cur = byId.get(employeeId);
  while (cur && cur.managerId != null && !seen.has(cur.managerId)) {
    seen.add(cur.managerId);
    const manager = byId.get(cur.managerId);
    if (!manager) break;
    const uid = empToUser.get(manager.id);
    if (uid) out.push({ id: uid, name: manager.name });
    cur = manager;
  }
  return out;
}

const todayD2D = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" });

/** Cadeia de funcionários (o próprio e os superiores) para resolver a meta do dia. */
async function goalChain(employeeId: number | null): Promise<number[]> {
  if (employeeId == null) return [];
  const { emps } = await loadPeople();
  const byId = new Map(emps.map((e) => [e.id, e]));
  const chain = [employeeId];
  const seen = new Set<number>([employeeId]);
  let cur = byId.get(employeeId);
  while (cur && cur.managerId != null && !seen.has(cur.managerId)) {
    seen.add(cur.managerId);
    chain.push(cur.managerId);
    cur = byId.get(cur.managerId);
  }
  return chain;
}

/** Meta do dia (portas + vendas) para o utilizador autenticado. */
async function todayGoalFor(ctx: Ctx): Promise<{ portas: number; vendas: number }> {
  const chain = await goalChain(ctx.employeeId);
  const data = todayD2D();
  const goals = await db.select().from(d2dGoals).where(eq(d2dGoals.data, data));
  // Mais próximo na cadeia ganha; global (employeeId null) é último recurso.
  const idx = new Map(chain.map((id, i) => [id, i]));
  const rank = (g: typeof goals[number]) => (g.employeeId == null ? 999 : (idx.get(g.employeeId) ?? 998));
  goals.sort((a, b) => rank(a) - rank(b));
  if (goals.length) return { portas: goals[0].portas, vendas: goals[0].vendas };
  return { portas: 40, vendas: 5 };
}
