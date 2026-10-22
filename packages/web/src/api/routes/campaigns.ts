import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { adminOnly, salesAccess, salesWrite } from "../middleware/auth";
import { db } from "../database";
import { campaigns as tbl } from "../database/schema";
import { SALE_COUNTED, SERVICE_LABELS } from "../shared/client-forms";
import { deleteObject, localCampaignPdfUrl } from "../lib/s3";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.").nullable().optional();
const input = z.object({
  code: z.string().trim().min(1, "Indique o código da campanha.").max(40).transform((s) => s.toUpperCase().replace(/\s+/g, "")),
  name: z.string().trim().nullable().optional(),
  service: z.enum(SERVICE_LABELS as [string, ...string[]]).nullable().optional(),
  clientType: z.enum(["todos", "particular", "empresa"]).default("todos"),
  startDate: date,
  endDate: date,
  active: z.boolean().default(true),
  description: z.string().trim().nullable().optional(),
  pdfKey: z.string().regex(/^campaigns\/[\w.-]+\.pdf$/, "Ficheiro inválido.").nullable().optional(),
  pdfName: z.string().trim().max(200).nullable().optional(),
});

const counted = sql.join(SALE_COUNTED.map((s) => sql`${s}`), sql`, `);
const clean = (i: z.infer<typeof input>) => {
  if (i.startDate && i.endDate && i.endDate < i.startDate) throw new ORPCError("BAD_REQUEST", { message: "A data de fim não pode ser anterior à data de início." });
  return { ...i, name: i.name || null, service: i.service ?? null, startDate: i.startDate || null, endDate: i.endDate || null, description: i.description || null, pdfKey: i.pdfKey || null, pdfName: i.pdfKey ? i.pdfName || "campanha.pdf" : null };
};

async function assertCodeFree(code: string, exceptId?: number) {
  const [dup] = await db.select({ id: tbl.id }).from(tbl).where(eq(tbl.code, code));
  if (dup && dup.id !== exceptId) throw new ORPCError("BAD_REQUEST", { message: `Já existe uma campanha com o código ${code}.` });
}

export const campaigns = {
  /** Todas as campanhas, com o nº de vendas (vendedores: só as suas) que usam cada código. */
  list: salesAccess.handler(async ({ context }) => {
    if (context.role === "vendedor" && !context.employeeId) throw new ORPCError("FORBIDDEN", { message: "A sua conta ainda não está associada a um vendedor. Peça ao administrador." });
    const seller = context.role === "vendedor" ? sql` and s.seller_id = ${context.employeeId}` : sql``;
    const match = sql`(json_extract(s.details, '$.campaign') = ${tbl.code} or json_extract(s.details, '$.campaignGas') = ${tbl.code})${seller}`;
    const rows = await db
      .select({
        id: tbl.id,
        code: tbl.code,
        name: tbl.name,
        service: tbl.service,
        clientType: tbl.clientType,
        startDate: tbl.startDate,
        endDate: tbl.endDate,
        active: tbl.active,
        description: tbl.description,
        pdfKey: tbl.pdfKey,
        pdfName: tbl.pdfName,
        saleCount: sql<number>`(select count(*) from sales s where ${match})`,
        countedCount: sql<number>`(select count(*) from sales s where ${match} and s.status in (${counted}))`,
        lastSale: sql<string | null>`(select max(s.date) from sales s where ${match})`,
      })
      .from(tbl)
      .orderBy(tbl.code);
    return Promise.all(rows.map(async (r) => ({ ...r, pdfUrl: r.pdfKey ? localCampaignPdfUrl(r.pdfKey) : null })));
  }),
  /** Guarda o PDF da campanha localmente em public/uploads/campaigns/. */
  pdfUpload: adminOnly
    .input(z.object({ content: z.string() }))
    .handler(async ({ input }) => {
      if (!input.content.startsWith("data:application/pdf;base64,")) throw new ORPCError("BAD_REQUEST", { message: "Formato inválido." });
      const key = `campaigns/${Date.now()}-${crypto.randomUUID()}.pdf`;
      const dir = "public/uploads/campaigns";
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(`${dir}/${key.replace("campaigns/", "")}`, Buffer.from(input.content.slice(28), "base64"));
      return { key };
    }),
  create: salesWrite.input(input).handler(async ({ input }) => {
    const v = clean(input);
    await assertCodeFree(v.code);
    const [row] = await db.insert(tbl).values(v).returning();
    return row;
  }),
  update: salesWrite.input(input.extend({ id: z.number() })).handler(async ({ input }) => {
    const { id, ...rest } = input;
    const v = clean(rest);
    const [old] = await db.select().from(tbl).where(eq(tbl.id, id));
    if (!old) throw new ORPCError("NOT_FOUND", { message: "Campanha não encontrada." });
    await assertCodeFree(v.code, id);
    await db.update(tbl).set(v).where(eq(tbl.id, id));
    if (old.pdfKey && old.pdfKey !== v.pdfKey) await deleteObject(old.pdfKey);
    // Se o código mudou, as vendas que usavam o código antigo passam a usar o novo.
    if (old.code !== v.code) {
      for (const key of ["$.campaign", "$.campaignGas"]) {
        await db.run(sql`update sales set details = json_set(details, ${key}, ${v.code}) where json_extract(details, ${key}) = ${old.code}`);
      }
    }
    return { ok: true };
  }),
  remove: salesWrite.input(z.object({ id: z.number() })).handler(async ({ input }) => {
    const [old] = await db.select({ pdfKey: tbl.pdfKey }).from(tbl).where(eq(tbl.id, input.id));
    await db.delete(tbl).where(eq(tbl.id, input.id));
    await deleteObject(old?.pdfKey);
    return { ok: true };
  }),
};
