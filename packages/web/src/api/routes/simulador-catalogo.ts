import { z } from "zod";
import { ORPCError } from "@orpc/server";
import { requireView, requireEdit } from "../middleware/auth";
import { simuladorStore } from "../lib/simulador-store";

export const SEGMENTS = ["lr", "ln", "lc", "gr", "gn"] as const;
export type Segment = (typeof SEGMENTS)[number];

const SEGMENT_LABELS: Record<string, string> = {
  lr: "Luz – Residencial",
  ln: "Luz – Negócios",
  lc: "Luz – Condomínios",
  gr: "Gás – Residencial",
  gn: "Gás – Negócios",
};

/** Numero com ponto decimal, aceita vazio -> 0. Limites generosos: e um preco
 *  unitario (€/kWh ou €/dia), nao um valor de fatura. */
const num = z.union([z.number(), z.string()]).transform((v, ctx) => {
  if (v === "" || v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  if (!Number.isFinite(n)) { ctx.addIssue({ code: "custom", message: "Valor numérico inválido." }); return z.NEVER; }
  if (n < 0 || n > 100000) { ctx.addIssue({ code: "custom", message: "Valor fora do intervalo." }); return z.NEVER; };
  return n;
});

const planInput = z.object({
  seg: z.enum(SEGMENTS),
  r: z.string().trim().min(1, "Indique o código do plano.").max(40).transform((s) => s.toUpperCase().replace(/\s+/g, "")),
  n: z.string().trim().max(160).nullable().optional(),
  f: z.string().trim().max(60).nullable().optional(),
  t: z.string().trim().max(400).nullable().optional(),
  bd: num,
  svc: z.boolean().default(false),
  fx: z.array(num).max(10).optional(),
  gf: z.array(num).max(4).optional(),
  ge: z.array(num).max(4).optional(),
  s: num.optional(),
  fv: num.optional(),
  v: num.optional(),
  ex: num.optional(),
  base: num.optional(),
  q: num.optional(),
  ini: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.").nullable().optional(),
  val: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.").nullable().optional(),
});

type Plan = Record<string, unknown> & { r?: string; n?: string; bd?: number; novo?: number };

async function readCatalog(): Promise<Record<string, unknown>> {
  const text = await simuladorStore.get();
  if (!text) throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Catálogo do simulador indisponível." });
  return JSON.parse(text);
}

/** Indice do plano pelo codigo, em qualquer segmento. */
function findPlan(cat: Record<string, unknown>, code: string): { seg: string; idx: number; plan: Plan } | null {
  for (const seg of SEGMENTS) {
    const arr = cat[seg];
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i] as Plan;
      if (p && String(p.r).toUpperCase() === code) return { seg, idx: i, plan: p };
    }
  }
  return null;
}

/** Resumo de um plano para a lista (so o que a tabela mostra). */
function summarize(seg: string, p: Plan) {
  const fx = Array.isArray(p.fx) ? (p.fx as unknown[]) : null;
  const gf = Array.isArray(p.gf) ? (p.gf as unknown[]) : null;
  const ge = Array.isArray(p.ge) ? (p.ge as unknown[]) : null;
  const hasGas = !!gf && !!ge;
  // Preco mais baixo entre potencia simples e energia simples, para se ver de
  // relance se o plano ja tem precos ou ainda esta todo a zeros.
  const cands: number[] = [];
  if (typeof p.s === "number") cands.push(p.s as number);
  if (typeof p.fv === "number") cands.push(p.fv as number);
  if (typeof p.v === "number") cands.push(p.v as number);
  if (fx) for (const x of fx) if (typeof x === "number") cands.push(x);
  if (gf) for (const x of gf) if (typeof x === "number") cands.push(x);
  if (ge) for (const x of ge) if (typeof x === "number") cands.push(x);
  const preenchido = cands.some((x) => x > 0);
  return {
    seg,
    segLabel: SEGMENT_LABELS[seg] ?? seg,
    r: String(p.r ?? ""),
    n: (p.n as string) ?? "",
    f: (p.f as string) ?? "",
    bd: Number(p.bd ?? 0),
    svc: !!p.svc,
    ini: (p.ini as string) ?? null,
    val: (p.val as string) ?? null,
    tipo: fx ? "luz" : hasGas ? "gas" : "outro",
    novo: !!p.novo,
    preenchido,
    idx: !!p.idx,
  };
}

export const simuladorCatalogo = {
  /** Lista os planos do catalogo do simulador. */
  list: requireView("catalogo-simulador").handler(async () => {
    const cat = await readCatalog();
    const out: ReturnType<typeof summarize>[] = [];
    for (const seg of SEGMENTS) {
      const arr = cat[seg];
      if (!Array.isArray(arr)) continue;
      for (const p of arr as Plan[]) if (p && p.r) out.push(summarize(seg, p));
    }
    return out.sort((a, b) => a.seg.localeCompare(b.seg) || a.r.localeCompare(b.r));
  }),

  /** Um plano em detalhe, com todos os campos de preco. */
  get: requireView("catalogo-simulador")
    .input(z.object({ r: z.string() }))
    .handler(async ({ input }) => {
      const cat = await readCatalog();
      const hit = findPlan(cat, input.r.toUpperCase());
      if (!hit) throw new ORPCError("NOT_FOUND", { message: "Plano não encontrado no catálogo." });
      return { seg: hit.seg, plan: hit.plan };
    }),

  /** Grava os precos de um plano. Ao gravar, o plano deixa de estar "novo" e
   *  passa a contar no simulador (desde que as datas o permitam). */
  save: requireEdit("catalogo-simulador")
    .input(planInput)
    .handler(async ({ input }) => {
      const cat = await readCatalog();
      const code = input.r;
      const existing = findPlan(cat, code);
      // Mudar de segmento move o plano de lista.
      if (existing && existing.seg !== input.seg) {
        const from = cat[existing.seg] as Plan[];
        from.splice(existing.idx, 1);
        if (!Array.isArray(cat[input.seg])) cat[input.seg] = [];
        (cat[input.seg] as Plan[]).push(existing.plan);
      } else if (!existing) {
        if (!Array.isArray(cat[input.seg])) cat[input.seg] = [];
        (cat[input.seg] as Plan[]).push({ r: code });
      }
      const hit = findPlan(cat, code);
      if (!hit) throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Não foi possível gravar o plano." });
      const p = hit.plan;
      p.r = code;
      p.n = input.n || code;
      if (input.f) p.f = input.f; else delete p.f;
      if (input.t) p.t = input.t; else delete p.t;
      p.bd = input.bd;
      if (input.svc) p.svc = 1; else delete p.svc;
      // Precos: gravar as listas quando existirem. Um 0 significa "sem preco
      // nesta potencia", por isso escrevemos o array tal como vem do formulario.
      const setArr = (key: string, arr?: number[]) => {
        if (!arr || !arr.length) return;
        p[key] = arr;
      };
      setArr("fx", input.fx);
      setArr("gf", input.gf);
      setArr("ge", input.ge);
      for (const key of ["s", "fv", "v", "ex", "base", "q"] as const) {
        const val = input[key];
        if (val === undefined) continue;
        if (val === 0) delete p[key];
        else p[key] = val;
      }
      if (input.ini) p.ini = input.ini; else delete p.ini;
      if (input.val) p.val = input.val; else delete p.val;
      // Ao completar os precos, o plano passa a valer no simulador. Os planos
      // criados pela sincronizacao do CRM nascem com val=1970-01-01 so para
      // ficarem escondidos enquanto estao a zeros; ao gravar precos essa
      // validade tem de sair, senao o simulador descarta o plano como
      // terminado. Nunca mexer em planos de origem (os que tem datas reais).
      if (p.novo) {
        if (p.val === "1970-01-01") delete p.val;
        if (p.ini === "1970-01-01") delete p.ini;
      }
      delete p.novo;
      await simuladorStore.set(JSON.stringify(cat));
      return { ok: true, seg: hit.seg, r: code };
    }),

  /** Elimina um plano do catalogo. */
  remove: requireEdit("catalogo-simulador")
    .input(z.object({ r: z.string() }))
    .handler(async ({ input }) => {
      const cat = await readCatalog();
      const hit = findPlan(cat, input.r.toUpperCase());
      if (!hit) throw new ORPCError("NOT_FOUND", { message: "Plano não encontrado no catálogo." });
      (cat[hit.seg] as Plan[]).splice(hit.idx, 1);
      await simuladorStore.set(JSON.stringify(cat));
      return { ok: true };
    }),
};
