/**
 * Simulador de potência a contratar — dados e regras de cálculo.
 *
 * O utilizador escolhe os equipamentos e as quantidades; a potência em watts é
 * interna (nunca é pedida nem mostrada ao utilizador, nem no PDF). O resultado é
 * sempre um escalão normalizado de potência (kVA).
 */

export type Equipamento = { nome: string; watts: number };

/**
 * Potências típicas de cada equipamento, em watts.
 * É aqui que a RZ ajusta os valores ou acrescenta equipamentos novos.
 */
export const EQUIPAMENTOS: Equipamento[] = [
  { nome: "Frigorífico", watts: 150 },
  { nome: "Iluminação LED", watts: 100 },
  { nome: "TV e box", watts: 200 },
  { nome: "Termoacumulador", watts: 1500 },
  { nome: "Máquina de lavar roupa", watts: 2000 },
  { nome: "Máquina de lavar loiça", watts: 1800 },
  { nome: "Máquina de secar", watts: 2500 },
  { nome: "Forno elétrico", watts: 2000 },
  { nome: "Placa de indução", watts: 3500 },
  { nome: "Micro-ondas", watts: 1000 },
  { nome: "Chaleira", watts: 2000 },
  { nome: "Aspirador", watts: 1200 },
  { nome: "Ferro de engomar", watts: 2000 },
  { nome: "Secador de cabelo", watts: 1800 },
  { nome: "Radiador elétrico", watts: 1500 },
  { nome: "Ar condicionado", watts: 1200 },
  { nome: "Carregador de carro elétrico", watts: 3700 },
];

/** Escalões de potência normalizados (kVA). */
export const ESCALOES = [1.15, 2.3, 3.45, 4.6, 5.75, 6.9, 10.35, 13.8, 17.25, 20.7];

export const MARGEM_DEFEITO = 10;
export const MARGEM_MAX = 30;
export const MARGEM_PASSO = 5;

/** Escalão a partir do qual pode ser necessária ligação trifásica. */
export const LIMIAR_TRIFASICO = 10.35;

/** Maior escalão: acima dele já não há oferta normalizada. */
export const POTENCIA_MAX = 20.7;

export type ItemPotencia = { nome: string; watts: number; qtd: number; emUso: boolean };

export type Resultado = {
  /** Soma das potências das linhas em uso (W). */
  totalW: number;
  /**total das linhas em uso em kVA (1 kW = 1 kVA). */
  totalKva: number;
  /** Necessidade já com a margem de segurança aplicada (kVA). */
  necessario: number;
  /** Escalão normalizado a contratar; `null` quando nem o maior chega. */
  recomendada: number | null;
  /** Utilização do escalão recomendado (0-100 %). */
  utilizacao: number;
  /** Verdadeiro quando a necessidade passa do maior escalão. */
  semEscalao: boolean;
  /** Verdadeiro quando o consumo simultâneo passa a potência recomendada. */
  excede: boolean;
};

export function calcular(itens: ItemPotencia[], margem: number): Resultado {
  const totalW = itens.reduce((soma, i) => (i.emUso ? soma + i.watts * Math.max(1, Math.round(i.qtd)) : soma), 0);
  const totalKva = totalW / 1000;
  const necessario = totalKva * (1 + margem / 100);
  const recomendada = ESCALOES.find((e) => e >= necessario - 1e-9) ?? null;
  const utilizacao = recomendada ? Math.min(100, (totalKva / recomendada) * 100) : 100;
  return {
    totalW,
    totalKva,
    necessario,
    recomendada,
    utilizacao,
    semEscalao: recomendada == null,
    excede: recomendada != null && totalKva > recomendada + 1e-9,
  };
}

/** Potência em kVA com a vírgula portuguesa e sem zeros a mais (2,3 · 10,35 · 6,9). */
export function fmtKva(v: number): string {
  return v.toLocaleString("pt-PT", { maximumFractionDigits: 2 });
}

/** Euros com duas casas (1,23 €). */
export function fmtEur(v: number): string {
  return `${v.toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/** Aceita "1,25" e "1.25"; devolve `null` quando não há número válido. */
export function parsePreco(texto: string): number | null {
  const t = texto.trim().replace(/\s/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
