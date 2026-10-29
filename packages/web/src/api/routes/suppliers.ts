import { z } from "zod";
import { eq, inArray, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { requireView, requireEdit } from "../middleware/auth";
import { db } from "../database";
import {
  suppliers as tbl,
  hiddenSuppliers as hiddenTbl,
  renamedSuppliers as renamedTbl,
  sales,
  employees,
} from "../database/schema";
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

/** Ids negativos identificam entradas de origem (não guardadas na base de dados). */
const BASE_ID_BASE = -1000;

/**
 * Devolve o nome de origem correspondente a um id negativo da lista.
 * Devolve sempre o nome original (sem as excecoes), para que o `update`/`remove`
 * possam comparar contra a chave guardada e limpar/atualizar a excecao certa.
 */
function originByNegativeId(id: number): string | null {
  const idx = BASE_ID_BASE - id;
  const hit = baseEntries()[idx];
  return hit ? hit.name : null;
}

/**
 * Junta as listas de origem (eletricidade/gás) com os comercializadores
 * acrescentados pelo utilizador. As de origem aparecem sempre, para que a
 * página mostre tudo o que existe desde o início.
 */
function baseEntries() {
  const seen = new Map<string, { name: string; scopes: string[] }>();
  for (const s of SUPPLIER_SCOPES) {
    for (const name of baseSuppliers(s)) {
      const key = supplierKey(name);
      if (!key) continue;
      const hit = seen.get(key);
      if (hit) {
        if (!hit.scopes.includes(s)) hit.scopes.push(s);
      } else {
        seen.set(key, { name, scopes: [s] });
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, "pt"));
}

/** Nomes de origem que o utilizador escondeu/renomeou, indexados pela chave normalizada. */
async function baseOverrides() {
  const hidden = new Set<string>();
  const renamed = new Map<string, string>();
  const hiddenRows = await db.select().from(hiddenTbl);
  for (const r of hiddenRows) hidden.add(r.normalized);
  const renamedRows = await db.select().from(renamedTbl);
  for (const r of renamedRows) renamed.set(r.normalized, r.name);
  return { hidden, renamed };
}

export const suppliersRoute = {
  /**
   * Lista TODOS os comercializadores: os de origem (eletricidade e gás) e os
   * acrescentados pelo utilizador. Cada linha traz `origin` para a interface
   * distinguir as duas coisas, e `createdByName` com quem a acrescentou.
   */
  list: requireView("comercializadores").handler(async () => {
    const rows = await db.select().from(tbl).orderBy(tbl.name);
    const authors = await authorNames(rows.map((r) => r.createdBy ?? ""));
    const { hidden, renamed } = await baseOverrides();
    const customKeys = new Set(rows.map((r) => r.normalized));

    const base = baseEntries()
      .filter((e) => !hidden.has(supplierKey(e.name)))
      .filter((e) => !customKeys.has(supplierKey(e.name)))
      .map((e, i) => {
        const key = supplierKey(e.name);
        return {
          id: BASE_ID_BASE - i,
          name: renamed.get(key) ?? e.name,
          scopes: e.scopes,
          createdAt: null as number | null,
          createdByName: null as string | null,
          usageCount: 0,
          origin: true as const,
        };
      });

    const custom = await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        name: r.name,
        scopes: r.scopes ?? [],
        createdAt: r.createdAt,
        createdByName: r.createdBy ? (authors.get(r.createdBy) ?? null) : null,
        usageCount: await usageCount(r.name),
        origin: false as const,
      })),
    );

    // Orçamento: a contagem de uso das origens é calculada só quando pedida.
    for (const b of base) b.usageCount = await usageCount(b.name);

    return {
      items: [...custom, ...base],
      removed: [...hidden],
      renamed: Object.fromEntries(renamed),
    };
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
   * Corrige o nome e/ou o âmbito. Aceita tanto os acrescentos (id > 0) como as
   * entradas de origem (id < 0), que são guardadas nas tabelas de exceções.
   * As vendas já gravadas Não são reescritas: são registos históricos.
   */
  update: requireEdit("comercializadores")
    .input(input.extend({ id: z.number() }))
    .handler(async ({ input }) => {
      if (input.id < 0) {
        const original = originByNegativeId(input.id);
        if (!original) throw new ORPCError("NOT_FOUND", { message: "Comercializador não encontrado." });
        const key = supplierKey(original);
        const newKey = supplierKey(input.name);
        if (newKey === key) {
          // Voltou ao nome original: a excecao deixa de ser precisa.
          await db.delete(renamedTbl).where(eq(renamedTbl.normalized, key));
        } else {
          await db
            .insert(renamedTbl)
            .values({ normalized: key, name: input.name })
            .onConflictDoUpdate({ target: renamedTbl.normalized, set: { name: input.name } });
        }
        return { ok: true, reusedIn: await usageCount(original) };
      }
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
      if (input.id < 0) {
        const original = await originByNegativeId(input.id);
        if (!original) throw new ORPCError("NOT_FOUND", { message: "Comercializador não encontrado." });
        const used = await usageCount(original);
        if (used > 0 && !input.force) {
          throw new ORPCError("CONFLICT", {
            message: `"${original}" está usado em ${used} venda${used === 1 ? "" : "s"}.`,
            data: { usageCount: used },
          });
        }
        const key = supplierKey(original);
        await db.insert(hiddenTbl).values({ normalized: key }).onConflictDoNothing();
        await db.delete(renamedTbl).where(eq(renamedTbl.normalized, key));
        return { ok: true, keptInSales: used };
      }
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
