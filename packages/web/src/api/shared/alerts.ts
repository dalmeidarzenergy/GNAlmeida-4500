/**
 * Lógica partilhada de Vendas Críticas e Estado VTV (alertas de contratação).
 * Módulo puro (sem dependências de servidor) — usado pela API (job de alertas,
 * notificações imediatas), pelo job scripts/alerts.ts e pelas páginas web.
 */

/** Dias para a venda chegar ao estado Control após a assinatura. */
export const ALERT_DEADLINE_DAYS = 3;

/** Estados antes do Control — a venda ainda está "por tratar". */
export const PRE_CONTROL = ["Prospeção", "Pré-Venda", "Backoffice"] as const;
export const isPreControl = (status: string | null | undefined) =>
  (PRE_CONTROL as readonly string[]).includes(status ?? "");

const DAY = 86400000;

/** Dias entre duas datas ISO (YYYY-MM-DD); positivo quando `b` é depois de `a`. */
export const dayDiff = (a: string, b: string) =>
  Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / DAY);

/** Chave "YYYY-MM" de uma data ISO (YYYY-MM-DD). */
export const monthKeyOf = (date: string | null | undefined) => (date ?? "").slice(0, 7);

/** true se `date` cai no mesmo mês que `today` (ambas ISO, YYYY-MM-DD). */
export const isSameMonth = (date: string | null | undefined, today: string) =>
  !!date && monthKeyOf(date) === monthKeyOf(today);

export const isKO = (s: string | null | undefined) => !!s && s.startsWith("KO-");
export const isGrave = (s: string | null | undefined) => !!s && (s.startsWith("KO-A") || s.startsWith("KO-B"));

/**
 * Venda "crítica": ainda não resolvida dentro do prazo de contratação.
 * - Anulada nunca é crítica.
 * - Se já chegou a Control, é crítica se demorou mais de `ALERT_DEADLINE_DAYS`.
 * - Senão, é crítica se já passou o prazo (data de assinatura + dias) sem Control.
 */
export const saleCritical = (date: string, status: string | null | undefined, ctrlOn: string | null | undefined, today: string) => {
  if (status === "Anulado") return false;
  if (ctrlOn) return dayDiff(date, ctrlOn) > ALERT_DEADLINE_DAYS;
  return dayDiff(date, today) >= ALERT_DEADLINE_DAYS;
};
