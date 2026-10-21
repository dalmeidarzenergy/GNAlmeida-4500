const eur = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eur2 = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
const compact = new Intl.NumberFormat("pt-PT", { notation: "compact", maximumFractionDigits: 1 });

export const fmtEur = (n: number) => eur.format(n || 0);
export const fmtEur2 = (n: number) => eur2.format(n || 0);
export const fmtCompact = (n: number) => compact.format(n || 0);
export const fmtPct = (n: number) => `${Math.round((n || 0) * 100)}%`;

export function fmtDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d + (d.length === 10 ? "T00:00:00" : "")) : d;
  return date.toLocaleDateString("pt-PT", { day: "2-digit", month: "short", year: "numeric" });
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export function fmtMonth(key: string, withYear = false) {
  const [y, m] = key.split("-");
  return `${MONTHS[Number(m) - 1]}${withYear ? ` ${y}` : ""}`;
}
export function monthLabel(key: string) {
  const [y, m] = key.split("-");
  const names = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  return `${names[Number(m) - 1]} ${y}`;
}

export const today = () => new Date().toISOString().slice(0, 10);
export const thisMonth = () => new Date().toISOString().slice(0, 7);

export function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function tenure(hireDate: string) {
  const ms = Date.now() - new Date(hireDate + "T00:00:00").getTime();
  const months = Math.floor(ms / (30.44 * 86400000));
  if (months < 12) return `${months} ${months === 1 ? "mês" : "meses"}`;
  const y = Math.floor(months / 12);
  return `${y} ${y === 1 ? "ano" : "anos"}`;
}

export function errMsg(e: unknown) {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: string }).message);
  return "Ocorreu um erro";
}
