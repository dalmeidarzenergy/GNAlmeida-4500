import { eq } from "drizzle-orm";
import { db } from "../database";
import { campaigns as tbl } from "../database/schema";

export interface CatalogStore {
  get(): Promise<string | null>;
  set(texto: string): Promise<void>;
}

export type CrmCampaign = {
  code: string;
  name: string | null;
  service: string | null;
  clientType: string;
  startDate: string | null;
  endDate: string | null;
  active: boolean;
};

const SEGMENTS = ["lr", "ln", "lc", "gr", "gn"] as const;
type Segment = (typeof SEGMENTS)[number];

/** Segmento do catalogo a partir do servico + tipo de cliente do CRM. */
export function segmentFor(service: string | null, clientType: string): Segment | null {
  if (service !== "LUZ" && service !== "GÁS") return null;
  if (service === "GÁS") return clientType === "empresa" ? "gn" : "gr";
  if (clientType === "empresa") return "ln";
  if (clientType === "condominio") return "lc";
  return "lr";
}

/** Codigo normalizado: maiusculas, so letras e digitos. "MCASAGAS268-DUAL" -> "MCASAGAS268DUAL".
 *  Para comparar tambem ignoramos o sufixo DUAL, tratado em matchKey(). */
export function normCode(code: string): string {
  return String(code || "").toUpperCase().trim().replace(/[^A-Z0-9]/g, "");
}

/** Chave de comparacao: normaliza e remove o sufixo DUAL, para os quase-coincidentes
 *  (CRM "MCASAGAS268-DUAL" vs catalogo "MCASAGAS268") passarem a coincidir. */
export function matchKey(code: string): string {
  return normCode(code).replace(/DUAL$/, "");
}

function activeState(c: CrmCampaign): { ini?: string; val?: string } {
  if (!c.active) return { val: "1970-01-01" };
  return { ini: c.startDate ?? undefined, val: c.endDate ?? undefined };
}

export async function syncCatalogWith(store: CatalogStore): Promise<{ created: string[]; removed: string[] }> {
  const rows = await db
    .select({ code: tbl.code, name: tbl.name, service: tbl.service, clientType: tbl.clientType, startDate: tbl.startDate, endDate: tbl.endDate, active: tbl.active })
    .from(tbl);
  const text = await store.get();
  if (!text) return { created: [], removed: [] };
  const catalog = JSON.parse(text);
  const created: string[] = [];
  const removed: string[] = [];

  // 1) Planos existentes: atualizar datas quando o codigo coincide.
  const byKey = new Map<string, { seg: Segment; plan: any }>();
  for (const seg of SEGMENTS) {
    if (!Array.isArray(catalog[seg])) continue;
    for (const plan of catalog[seg]) {
      if (plan && plan.r) byKey.set(matchKey(plan.r), { seg, plan });
    }
  }

  let changed = false;
  for (const c of rows as CrmCampaign[]) {
    const hit = byKey.get(matchKey(c.code));
    if (!hit) continue;
    // Plano criado automaticamente e ainda sem precos: fica inativo ate alguem
    // o completar na app de campanhas. Nao lhe tocamos nas datas.
    if (hit.plan.novo) continue;
    const { ini, val } = activeState(c);
    if (hit.plan.ini !== ini || hit.plan.val !== val) {
      if (ini === undefined) delete hit.plan.ini;
      else hit.plan.ini = ini;
      if (val === undefined) delete hit.plan.val;
      else hit.plan.val = val;
      changed = true;
    }
  }

  // 2) Campanhas do CRM sem plano no catalogo: criar um plano novo.
  for (const c of rows as CrmCampaign[]) {
    if (byKey.has(matchKey(c.code))) continue;
    const seg = segmentFor(c.service, c.clientType);
    if (!seg) continue;
    if (!Array.isArray(catalog[seg])) catalog[seg] = [];
    const model = catalog[seg].find((p: any) => p && p.r) as any | undefined;
    if (!model) continue;
    const plan: any = JSON.parse(JSON.stringify(model));
    // Precos a zeros: o utilizador preenche na app.
    if (Array.isArray(plan.fx)) plan.fx = plan.fx.map(() => 0);
    if (Array.isArray(plan.gf)) plan.gf = plan.gf.map(() => 0);
    if (Array.isArray(plan.ge)) plan.ge = plan.ge.map(() => 0);
    if (typeof plan.s === "number") plan.s = 0;
    if (typeof plan.fv === "number") plan.fv = 0;
    if (typeof plan.v === "number") plan.v = 0;
    if (typeof plan.q === "number") plan.q = 0;
    if (typeof plan.base === "number") plan.base = 0;
    if (typeof plan.ex === "number") plan.ex = 0;
    plan.r = c.code;
    plan.n = c.name || c.code;
    // Plano novo entra INATIVO (precos a zeros). Se ficasse ativo, apareceria como
    // "a mais barata" no simulador com y1 ~ 0. O utilizador preenche os precos e
    // ativa-o na app de campanhas; a sincronizacao seguinte respeita essa escolha.
    plan.novo = 1;
    plan.val = "1970-01-01";
    delete plan.ini;
    catalog[seg].push(plan);
    byKey.set(matchKey(c.code), { seg, plan });
    created.push(c.code);
    changed = true;
  }

  // 3) Planos que nasceram de uma campanha e cuja campanha ja nao existe: saem do
  //    catalogo. So toca em planos marcados `novo` — os planos de origem nunca sao
  //    removidos, nem que nao tenham campanha no CRM (decisao do utilizador).
  const liveCodes = new Set((rows as CrmCampaign[]).map((c) => matchKey(c.code)));
  for (const seg of SEGMENTS) {
    const arr = catalog[seg];
    if (!Array.isArray(arr)) continue;
    for (let i = arr.length - 1; i >= 0; i--) {
      const plan = arr[i];
      if (!plan || !plan.novo || !plan.r) continue;
      if (liveCodes.has(matchKey(plan.r))) continue;
      arr.splice(i, 1);
      removed.push(plan.r);
      changed = true;
    }
  }

  if (changed) await store.set(JSON.stringify(catalog));
  return { created, removed };
}
