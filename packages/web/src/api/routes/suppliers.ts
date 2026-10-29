import { z } from "zod";
import { eq, inArray, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { requireView, requireEdit } from "../middleware/auth";
import { db } from "../database";
import { suppliers as tbl, sales, employees } from "../database/schema";
import { user } from "../database/auth-schema";
import { SUPPLIER_SCOPES, supplierKey, baseSuppliers } from "../shared/suppliers";

const scopeEnum = z.enum(SUPPLIER_SCOPES as unknown as [string, ...string[]]);

const input = z.object({
  name: z.string().trim().min(2, "Indique o nome do comercializador.").max(80, "O nome é demasiado longo."),
  scopes: z.array(scopeEnum).min(1, "Escolha pelo menos uma energia (eletricidade ou gás)."),
});

/** Todas as vendas guardam o antigo comercializador dentro de `details`. */
const SUPPLIER_DETAIL_KEYS = ["oldSupplier", "oldSupplierGas"];

/**
 * Nome de quem acrescentou cada comercializador.
 *
 * `createdBy` é o id da conta (tabela `user`). O nome do funcionário é mais
 * legível do que o nome da conta, por isso procura-se o funcionário com o mesmo
 * email; sem funcionário correspondente usa-se o nome da conta e, em último
 * recurso, o email. Contas já removidas devolvem null.
 */
async function authorNames(ids: string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter(Boolean))];
  const out = new Map<string, string>();
  if (!wanted.length) return out;
  const accounts = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(inArray(user.id, wanted));
  const emails = accounts.map((a) => a.email.toLowerCase());
  const staff = emails.length ? await db.select({ name: employees.name, email: employees.email }).from(employees).where(inArray(sql`lower(${employees.email})`, emails)) : [];
  const byEmail = new Map(staff.map((s) => [s.email.toLowerCase(), s.name]));
  for (const a of accounts) {
    const name = byEmail.get(a.email.toLowerCase()) ?? a.name ?? "";
    if (name) out.set(a.id, name);
  }
  return out;
}

/**
 * Quantas vendas usam este comercializador. Compara pela forma normalizada para
 * apanhar também as variantes gravadas à mão ("Gold Energy", "Goldenergy").
 * Feito em JS de propósito: a comparação normalizada em SQL seria frágil.
 */
async function usageCount(name: string): Promise<number> {
  const key = supplierKey(name);
  const rows = await db
    .select({ details: sales.details })
    .from(sales);
  let n = 0;
  for (const r of rows) {
    const d = (r.details ?? {}) as Record<string, unknown>;
    for (const k of SUPPLIER_DETAIL_KEYS) {
      const v = d[k];
      if (typeof v === "string" && v.trim() && supplierKey(v) === key) {
        n++;
        break;
      }
    }
  }
  return n;
}

/** Impede duplicados da lista base e entre âmbitos que se sobreponham. */
async function assertNameFree(name: string, scopes: string[], exceptId?: number) {
  const key = supplierKey(name);
  if (!key) throw new ORPCError("BAD_REQUEST", { message: "Nome inválido." });

  for (const scope of scopes) {
    const clash = baseSuppliers(scope as "LUZ" | "GAS").find((b) => supplierKey(b) === key);
    if (clash) {
      throw new ORPCError("BAD_REQUEST", {
        message: `"${clash}" já existe na lista de ${scope === "GAS" ? "gás" : "eletricidade"}.`,
      });
    }
  }

  const rows = await db.select().from(tbl);
  for (const r of rows) {
    if (exceptId && r.id === exceptId) continue;
    if (r.normalized !== key) continue;
    const overlap = (r.scopes ?? []).filter((s) => scopes.includes(s));
    if (overlap.length) {
      const where = overlap.map((s) => (s === "GAS" ? "no gás" : "na eletricidade")).join(" e ");
      throw new ORPCError("BAD_REQUEST", {
        message: `Já existe um comercializador com esse nome (${r.name}) ${where}.`,
      });
    }
  }
}

export const suppliersRoute = {
  /**
   * Lista os comercializadores acrescentados pelo utilizador.
   * O formulário de venda junta esta lista às listas base do âmbito.
   */
  list: requireView("comercializadores").handler(async () => {
    const rows = await db.select().from(tbl).orderBy(tbl.name);
    const authors = await authorNames(rows.map((r) => r.createdBy ?? ""));
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        name: r.name,
        scopes: r.scopes ?? [],
        createdAt: r.createdAt,
        createdByName: r.createdBy ? (authors.get(r.createdBy) ?? null) : null,
        usageCount: await usageCount(r.name),
      })),
    );
  }),

  create: requireEdit("comercializadores").input(input).handler(async ({ input, context }) => {
    await assertNameFree(input.name, input.scopes);
    const [row] = await db
      .insert(tbl)
      .values({
        name: input.name,
        scopes: input.scopes,
        normalized: supplierKey(input.name),
        createdBy: context.user?.id ?? null,
      })
      .returning();
    return { ...row, usageCount: 0 };
  }),

  /**
   * Corrige o nome e/ou o âmbito. As vendas já gravadas Não são reescritas:
   * são registos históricos e o relatório agrupa por nome normalizado.
   */
  update: requireEdit("comercializadores")
    .input(input.extend({ id: z.number() }))
    .handler(async ({ input }) => {
      const [old] = await db.select().from(tbl).where(eq(tbl.id, input.id));
      if (!old) throw new ORPCError("NOT_FOUND", { message: "Comercializador não encontrado." });
      await assertNameFree(input.name, input.scopes, input.id);
      await db
        .update(tbl)
        .set({ name: input.name, scopes: input.scopes, normalized: supplierKey(input.name) })
        .where(eq(tbl.id, input.id));
      return { ok: true, reusedIn: await usageCount(old.name) };
    }),

  /**
   * Remove. Se estiver usado em vendas, só remove com `force` — o aviso da
   * interface explica que as vendas mantêm o nome (não são alteradas).
   */
  remove: requireEdit("comercializadores")
    .input(z.object({ id: z.number(), force: z.boolean().default(false) }))
    .handler(async ({ input }) => {
      const [old] = await db.select().from(tbl).where(eq(tbl.id, input.id));
      if (!old) throw new ORPCError("NOT_FOUND", { message: "Comercializador não encontrado." });
      const used = await usageCount(old.name);
      if (used > 0 && !input.force) {
        throw new ORPCError("CONFLICT", {
          message: `"${old.name}" está usado em ${used} venda${used === 1 ? "" : "s"}.`,
          data: { usageCount: used },
        });
      }
      await db.delete(tbl).where(eq(tbl.id, input.id));
      return { ok: true, keptInSales: used };
    }),

  /** Quantas vendas usam cada nome, para o aviso antes de remover. */
  usage: requireView("comercializadores")
    .input(z.object({ name: z.string() }))
    .handler(async ({ input }) => ({ name: input.name, count: await usageCount(input.name) })),
};
