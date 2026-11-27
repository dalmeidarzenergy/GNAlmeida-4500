import { z } from "zod";
import municipalities from "../data/territory-municipality-distances.json";
import fallback from "../data/territory-municipality-population.json";

const indicator = "0012918";
// Sem Dim1: o INE devolve o ano mais recente. T/T seleciona os totais de sexo e idade.
const url = `https://www.ine.pt/ine/json_indicador/pindica.jsp?op=2&varcd=${indicator}&lang=PT&Dim3=T&Dim4=T`;
const codes = new Set(municipalities.rows.map(([code]) => String(code)));
const day = 24 * 60 * 60 * 1000;
const release = z.tuple([z.object({
  IndicadorCod: z.literal(indicator),
  UltimoPref: z.string().regex(/^[0-9]{4}$/),
  DataUltimoAtualizacao: z.iso.date(),
  Dados: z.record(z.string(), z.array(z.object({
    geocod: z.string(), dim_3: z.string(), dim_4: z.string(), valor: z.unknown(),
  }))),
})]);

type PopulationSnapshot = {
  year: number;
  updatedAt: string;
  nationalTotal: number;
  byMunicipality: Readonly<Record<string, number | undefined>>;
};

export function parseInePopulation(payload: unknown): PopulationSnapshot {
  const [{ UltimoPref, DataUltimoAtualizacao, Dados }] = release.parse(payload);
  const rows = Dados[UltimoPref];
  if (!rows) throw new Error("Ano de referência em falta.");
  const byMunicipality: Record<string, number> = {};
  let nationalTotal: number | undefined;
  let sum = 0;

  for (const { geocod, dim_3, dim_4, valor } of rows) {
    const code = /^[0-9A-Z]{3}[0-9]{4}$/.test(geocod) ? geocod.slice(-4) : null;
    if (geocod !== "PT" && code === null) continue; // Regiões e outros agregados.
    const value = typeof valor === "string" && /^[0-9]+$/.test(valor) ? Number(valor) : NaN;
    if (dim_3 !== "T" || dim_4 !== "T" || !Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Total de população inválido: ${geocod}`);
    }
    if (code === null) {
      if (nationalTotal !== undefined) throw new Error("Total nacional duplicado.");
      nationalTotal = value;
    } else {
      if (!codes.has(code) || byMunicipality[code] !== undefined) throw new Error(`Código municipal inválido ou duplicado: ${code}`);
      byMunicipality[code] = value;
      sum += value;
    }
  }

  if (Object.keys(byMunicipality).length !== codes.size || nationalTotal !== sum) {
    throw new Error("A população por concelho não coincide com o total nacional.");
  }
  return { year: Number(UltimoPref), updatedAt: DataUltimoAtualizacao, nationalTotal, byMunicipality };
}

async function loadInePopulation(): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`INE HTTP ${response.status}`);
  return response.json();
}

export function createPopulationCache(load = loadInePopulation, now = Date.now) {
  let snapshot: PopulationSnapshot = fallback;
  let nextCheckAt = -Infinity;
  let pending: Promise<void> | undefined;

  function refresh() {
    if (pending || now() < nextCheckAt) return pending;
    nextCheckAt = now() + day;
    pending = Promise.resolve().then(load).then(parseInePopulation).then((latest) => {
      if (latest.year > snapshot.year || (latest.year === snapshot.year && latest.updatedAt >= snapshot.updatedAt)) {
        snapshot = latest;
      }
    }).catch((error: unknown) => {
      console.warn("[territory-population] A manter a última população validada do INE:", error instanceof Error ? error.message : String(error));
    }).finally(() => { pending = undefined; });
    return pending;
  }

  return {
    refresh,
    get() {
      // Atualiza em segundo plano: a lista não depende da disponibilidade do INE.
      void refresh();
      return snapshot;
    },
  };
}

export const territoryPopulation = createPopulationCache();