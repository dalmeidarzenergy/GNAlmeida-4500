import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { requireView, requireEdit } from "../middleware/auth";
import { db } from "../database";
import { candidates, departments, jobOpenings } from "../database/schema";

const jobInput = z.object({
  title: z.string().min(1),
  departmentId: z.number().nullable(),
  location: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  status: z.enum(["aberta", "pausada", "fechada"]).default("aberta"),
});

const stage = z.enum(["candidatura", "triagem", "entrevista", "proposta", "contratado", "rejeitado"]);

const candidateInput = z.object({
  jobId: z.number(),
  name: z.string().min(1),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  stage: stage.default("candidatura"),
  rating: z.number().int().min(1).max(5).default(3),
  notes: z.string().nullable().optional(),
});

export const recruitment = {
  jobs: {
    list: requireView("recrutamento").handler(async () => {
      return db
        .select({
          id: jobOpenings.id,
          title: jobOpenings.title,
          departmentId: jobOpenings.departmentId,
          departmentName: departments.name,
          location: jobOpenings.location,
          description: jobOpenings.description,
          status: jobOpenings.status,
          createdAt: jobOpenings.createdAt,
          candidateCount: sql<number>`(select count(*) from candidates c where c.job_id = ${jobOpenings.id})`,
        })
        .from(jobOpenings)
        .leftJoin(departments, eq(departments.id, jobOpenings.departmentId))
        .orderBy(desc(jobOpenings.createdAt));
    }),
    create: requireEdit("recrutamento").input(jobInput).handler(async ({ input }) => {
      const [row] = await db.insert(jobOpenings).values(input).returning();
      return row;
    }),
    update: requireEdit("recrutamento").input(jobInput.extend({ id: z.number() })).handler(async ({ input }) => {
      const { id, ...data } = input;
      await db.update(jobOpenings).set(data).where(eq(jobOpenings.id, id));
      return { ok: true };
    }),
    remove: requireEdit("recrutamento").input(z.object({ id: z.number() })).handler(async ({ input }) => {
      await db.delete(jobOpenings).where(eq(jobOpenings.id, input.id));
      return { ok: true };
    }),
  },
  candidates: {
    list: requireView("recrutamento").handler(async () => {
      return db
        .select({
          id: candidates.id,
          jobId: candidates.jobId,
          jobTitle: jobOpenings.title,
          name: candidates.name,
          email: candidates.email,
          phone: candidates.phone,
          stage: candidates.stage,
          rating: candidates.rating,
          notes: candidates.notes,
          createdAt: candidates.createdAt,
        })
        .from(candidates)
        .innerJoin(jobOpenings, eq(jobOpenings.id, candidates.jobId))
        .orderBy(desc(candidates.createdAt));
    }),
    create: requireEdit("recrutamento").input(candidateInput).handler(async ({ input }) => {
      const [row] = await db.insert(candidates).values(input).returning();
      return row;
    }),
    update: requireEdit("recrutamento").input(candidateInput.extend({ id: z.number() })).handler(async ({ input }) => {
      const { id, ...data } = input;
      await db.update(candidates).set(data).where(eq(candidates.id, id));
      return { ok: true };
    }),
    move: requireEdit("recrutamento").input(z.object({ id: z.number(), stage })).handler(async ({ input }) => {
      await db.update(candidates).set({ stage: input.stage }).where(eq(candidates.id, input.id));
      return { ok: true };
    }),
    remove: requireEdit("recrutamento").input(z.object({ id: z.number() })).handler(async ({ input }) => {
      await db.delete(candidates).where(eq(candidates.id, input.id));
      return { ok: true };
    }),
  },
};
