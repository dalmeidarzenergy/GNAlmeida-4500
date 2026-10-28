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
