import { z } from "zod";
import { asc, eq, and } from "drizzle-orm";
import { requireView, requireEdit } from "../middleware/auth";
import { db } from "../database";
import { rules, ruleAssignments } from "../database/schema";

const ruleInput = z.object({
  name: z.string().min(1, "Indique o nome da regra."),
  type: z.enum(["manual", "auto"]).default("manual"),
  description: z.string().nullable().optional(),
  sourceColumn: z.string().nullable().optional(),
  operator: z.enum([">", "<", ">=", "<=", "==", "!="]).nullable().optional(),
  compareValue: z.string().nullable().optional(),
  effectType: z.enum(["fixed_eur", "percent"]).default("fixed_eur"),
  effectValue: z.number().default(0),
  active: z.boolean().default(true),
});

export const rulesRoute = {
  list: requireView("regras").handler(async () => {
    const all = await db.select().from(rules).orderBy(asc(rules.name));
    return all;
  }),

  create: requireEdit("regras").input(ruleInput).handler(async ({ input }) => {
    const [rule] = await db.insert(rules).values(input).returning();
    return rule;
  }),

  update: requireEdit("regras").input(ruleInput.extend({ id: z.number() })).handler(async ({ input }) => {
    const { id, ...data } = input;
    await db.update(rules).set(data).where(eq(rules.id, id));
    return { ok: true };
  }),

  remove: requireEdit("regras")
    .input(z.object({ id: z.number() }))
    .handler(async ({ input }) => {
      await db.delete(rules).where(eq(rules.id, input.id));
      return { ok: true };
    }),

  assignments: {
    /** Lista as regras manuais atribuídas num mês a um grupo de funcionários. */
    list: requireView("regras")
      .input(z.object({ month: z.string(), employeeIds: z.array(z.number()).optional() }))
      .handler(async ({ input }) => {
        const rows = await db
          .select()
          .from(ruleAssignments)
          .where(eq(ruleAssignments.month, input.month))
          .orderBy(asc(ruleAssignments.employeeId));
        if (input.employeeIds?.length) {
          const ids = new Set(input.employeeIds);
          return rows.filter((r) => ids.has(r.employeeId));
        }
        return rows;
      }),

    /** Guarda as regras manuais atribuídas a um funcionário num mês. Passa os ids das regras. */
    save: requireEdit("regras")
      .input(
        z.object({
          employeeId: z.number(),
          month: z.string(),
          ruleIds: z.array(z.number()),
        }),
      )
      .handler(async ({ input }) => {
        await db
          .delete(ruleAssignments)
          .where(and(eq(ruleAssignments.employeeId, input.employeeId), eq(ruleAssignments.month, input.month)));
        if (input.ruleIds.length) {
          await db.insert(ruleAssignments).values(
            input.ruleIds.map((rid) => ({
              ruleId: rid,
              employeeId: input.employeeId,
              month: input.month,
            })),
          );
        }
        return { ok: true };
      }),
  },
};