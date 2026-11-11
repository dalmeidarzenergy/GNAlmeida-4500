import { z } from "zod";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { requireView } from "../middleware/auth";
import { db } from "../database";
import { employees, simuladorPropostas, user, userRoles } from "../database/schema";

const SOURCES = ["res-neg", "medem"] as const;

/** IDs dos utilizadores abaixo do utilizador atual na hierarquia (recursivo).
 *  Serve para um chefe ver as propostas da sua equipa, como no simulador. */
async function subordinateUserIds(employeeId: number | null): Promise<string[]> {
  if (employeeId == null) return [];
  const emps = await db
    .select({ id: employees.id, email: employees.email, managerId: employees.managerId })
    .from(employees);
  const roles = await db
    .select({ userId: userRoles.userId, employeeId: userRoles.employeeId })
    .from(userRoles)
    .where(isNotNull(userRoles.employeeId));
  const empToUser = new Map<number, string>();
  for (const r of roles) if (r.employeeId != null) empToUser.set(r.employeeId, r.userId);
  const us = await db.select({ id: user.id, email: user.email }).from(user);
  const emailToUser = new Map<string, string>();
  for (const u of us) if (u.email) emailToUser.set(u.email.toLowerCase(), u.id);
  for (const e of emps) {
    if (empToUser.has(e.id)) continue;
    const uid = emailToUser.get(e.email.toLowerCase());
    if (uid) empToUser.set(e.id, uid);
  }

  const byManager = new Map<number, number[]>();
  for (const e of emps) {
    if (e.managerId == null) continue;
    const arr = byManager.get(e.managerId) ?? [];
    arr.push(e.id);
    byManager.set(e.managerId, arr);
  }
  const descIds: number[] = [];
  const stack = [employeeId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const child of byManager.get(cur) ?? []) {
      descIds.push(child);
      stack.push(child);
    }
  }
  const out: string[] = [];
  for (const id of descIds) {
    const uid = empToUser.get(id);
    if (uid) out.push(uid);
  }
  return out;
}

export const propostas = {
  /** Lista as propostas. `source` separa as de RES/NEG das do Medem. */
  list: requireView("propostas")
    .input(z.object({ source: z.enum(SOURCES).optional() }).optional())
    .handler(async ({ input, context }) => {
      const source = input?.source;
      const ctx = context as { user: { id: string }; role: string; employeeId: number | null };
      const porUser = (uid: string) =>
        source
          ? and(eq(simuladorPropostas.userId, uid), eq(simuladorPropostas.source, source))
          : eq(simuladorPropostas.userId, uid);
      const porTodos = source ? eq(simuladorPropostas.source, source) : undefined;

      const campos = {
        id: simuladorPropostas.id,
        userId: simuladorPropostas.userId,
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
      };

      const sup = ctx.role === "admin" || ctx.role === "diretor";
      let rows: {
        id: string;
        userId: string;
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
      }[];
      if (sup) {
        rows = await db
          .select(campos)
          .from(simuladorPropostas)
          .where(porTodos)
          .orderBy(desc(simuladorPropostas.createdAt))
          .limit(200);
      } else {
        const subs = await subordinateUserIds(ctx.employeeId);
        const ids = [ctx.user.id, ...subs];
        const acc: typeof rows = [];
        for (const uid of ids) {
          const r = await db
            .select(campos)
            .from(simuladorPropostas)
            .where(porUser(uid))
            .orderBy(desc(simuladorPropostas.createdAt))
            .limit(200);
          acc.push(...r);
        }
        acc.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        rows = acc.slice(0, 200);
      }

      const listaIds = rows.map((r) => r.id as string);
      const comPdf = new Set<string>();
      if (listaIds.length) {
        const rs = await db
          .select({ id: simuladorPropostas.id, nome: simuladorPropostas.pdfName })
          .from(simuladorPropostas)
          .where(inArray(simuladorPropostas.id, listaIds));
        for (const r of rs) if (r.nome) comPdf.add(r.id);
      }

      return rows.map((r) => ({
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
        isOwn: r.userId === ctx.user.id,
      }));
    }),

  /** Apaga uma proposta. Pode apagar quem a criou, um chefe da equipa, ou admin/diretor. */
  remove: requireView("propostas")
    .input(z.object({ id: z.string().min(1) }))
    .handler(async ({ input, context }) => {
      const ctx = context as { user: { id: string }; role: string; employeeId: number | null };
      const [p] = await db
        .select({ userId: simuladorPropostas.userId })
        .from(simuladorPropostas)
        .where(eq(simuladorPropostas.id, input.id));
      if (!p) throw new ORPCError("NOT_FOUND", { message: "Proposta não encontrada" });

      let pode = ctx.role === "admin" || ctx.role === "diretor" || p.userId === ctx.user.id;
      if (!pode) {
        const subs = await subordinateUserIds(ctx.employeeId);
        pode = subs.includes(p.userId);
      }
      if (!pode) throw new ORPCError("FORBIDDEN", { message: "Só podes apagar as tuas propostas" });

      await db.delete(simuladorPropostas).where(eq(simuladorPropostas.id, input.id));
      return { ok: true };
    }),
};
