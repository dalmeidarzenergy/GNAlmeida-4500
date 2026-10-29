/**
 * Comercializadores (antigos comercializadores) e a sua normalização.
 *
 * Fonte única para: opções do formulário de venda, análise do antigo comercializador
 * (Relatórios e Análise MEDEM) e agrupamento de variantes do mesmo nome.
 */

/** Comercializadores de eletricidade (mercado livre/regulado). */
export const OLD_SUPPLIERS = [
  "Entrada Direta",
  "EDP Comercial",
  "SU Eletricidade",
  "Yes Energy",
  "Endesa",
  "Galp",
  "Goldenergy",
  "Iberdrola",
  "Repsol",
  "Plenitude",
  "Naturgy",
  "MEO Energia",
  "Luzboa",
  "Coopérnico",
  "G9 Energy",
  "Ylce",
  "Muon",
  "Acciona Energía",
  "Audax Renovables",
  "Axpo Iberia",
  "Elergone",
  "Ezuenergia",
  "Alfa Energia",
  "Ibelectra",
  "Portulogos Power",
  "Rolear",
];

/** Comercializadores de gás natural (GÁS/DUAL). */
export const OLD_GAS_SUPPLIERS = [
  "Entrada Direta",
  "Galp",
  "EDP Comercial",
  "Goldenergy",
  "Endesa",
  "Repsol",
  "Plenitude",
  "Naturgy",
  "Iberdrola",
  "Ylce",
  "Dourogás",
  "Comercializador de Último Recurso",
  "Portulogos Power",
  "Rolear",
];

/**
 * Agrupa variantes do mesmo comercializador (ex.: "Gold Energy", "Goldenergy",
 * "Gold Energy, S.A."). A ordem importa: o primeiro padrão que casa vence.
 */
const SUPPLIER_ALIASES: [RegExp, string][] = [
  [/gold\s*energy/, "Goldenergy"],
  [/portulogos/, "Portulogos Power"],
  [/\bedp\b/, "EDP Comercial"],
  [/endesa/, "Endesa"],
  [/galp/, "Galp"],
  [/entrada\s*dire(c)?ta/, "Entrada Direta"],
  [/\bsu\s*ele(c)?tricidade/, "SU Eletricidade"],
  [/yes\s*energy/, "Yes Energy"],
  [/ibelectra/, "Ibelectra"],
  [/iberdrola/, "Iberdrola"],
  [/repsol/, "Repsol"],
  [/meo/, "MEO Energia"],
  [/luzboa/, "Luzboa"],
  [/coop[eé]rnico/, "Coopérnico"],
  [/plenitude|eni\b/, "Plenitude"],
  [/muon/, "Muon"],
  [/ylce/, "Ylce"],
  [/g9/, "G9 Energy"],
  [/naturgy|gas\s*natural\s*fenosa/, "Naturgy"],
  [/acciona/, "Acciona Energía"],
  [/audax/, "Audax Renovables"],
  [/axpo/, "Axpo Iberia"],
  [/elergone/, "Elergone"],
  [/ezuenergia/, "Ezuenergia"],
  [/alfa\s*energia/, "Alfa Energia"],
  [/rolear/, "Rolear"],
  [/dourogas/, "Dourogás"],
];

/** Estados que não entram na análise do antigo comercializador. */
export const SUPPLIER_EXCLUDED_STATUS = ["Baixa", "Pedido de Baixa", "Anulado"];

/** Nome canónico do comercializador. Vazio → "Entrada Direta". */
export function normalizeSupplier(v: string | null | undefined): string {
  const raw = (v ?? "").trim();
  if (!raw) return "Entrada Direta";
  const k = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  for (const [re, name] of SUPPLIER_ALIASES) if (re.test(k)) return name;
  return raw;
}


/**
 * Âmbitos de um comercializador. Luz e gás têm listas separadas: quem acrescenta
 * um comercializador escolhe onde ele aparece.
 */
export const SUPPLIER_SCOPES = ["LUZ", "GAS"] as const;
export type SupplierScope = (typeof SUPPLIER_SCOPES)[number];

/** Rótulos para o formulário de gestão. */
export const SUPPLIER_SCOPE_LABELS: Record<SupplierScope, string> = {
  LUZ: "Eletricidade",
  GAS: "Gás",
};

/** Chave de comparação: minúsculas, sem acentos, sem pontuação nem sufixos societários. */
export function supplierKey(name: string): string {
  return name
    // strip diacritics: NFD splits "é" into "e" + combining acute, then drop
    // the combining marks (U+0300-U+036F). Written with explicit escapes so the
    // range survives editing.
    .normalize("NFD")
    .replace(/\̀-\ͯ/g, "")
    .toLowerCase()
    // drop common company suffixes so "Luzboa" and "Luzboa, Lda." compare equal.
    // Punctuation goes first, otherwise "Gold Energy, S.A." -> "goldenergysa"
    // while "Gold Energy" -> "goldenergy", and the duplicate check misses it.
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(s\s?a|lda|unipessoal)\b/g, " ")
    // collapse back to a bare alphanumeric key
    .replace(/[^a-z0-9]+/g, "");
}

/** Lista base de um âmbito, já sem acentos nem duplicados. */
export function baseSuppliers(scope: SupplierScope): string[] {
  return scope === "GAS" ? OLD_GAS_SUPPLIERS : OLD_SUPPLIERS;
}

/** Comercializador acrescentado pelo utilizador (lista guardada na base de dados). */
export type CustomSupplier = { name: string; scopes: string[] };

/**
 * Opções finais de um campo de comercializador: a lista base do âmbito mais os
 * comercializadores acrescentados pelo utilizador que se apliquem a esse âmbito.
 * A base vem primeiro, ordenada como está definida; os acrescentos vão no fim,
 * por ordem de criação, para a lista não "saltar" entre visitas.
 */
export function supplierOptions(
  scope: SupplierScope,
  custom: CustomSupplier[] | undefined,
  removed: string[] | undefined = undefined,
  renamed: Record<string, string> | undefined = undefined,
): string[] {
  const removedKeys = new Set((removed ?? []).map(supplierKey));
  const out: string[] = [];
  const seen = new Set<string>();

  for (const base of baseSuppliers(scope)) {
    const k = supplierKey(base);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    // Um nome escondido sai da lista; um renomeado entra com o novo nome.
    if (removedKeys.has(k)) continue;
    out.push(renamed?.[k] ?? base);
  }

  for (const c of custom ?? []) {
    if (!c.scopes?.includes(scope)) continue;
    const k = supplierKey(c.name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(c.name);
  }
  return out;
}
