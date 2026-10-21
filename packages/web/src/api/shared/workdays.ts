/**
 * Dias úteis em Portugal: segunda a sexta, excluindo os feriados nacionais obrigatórios.
 * O sábado não é dia útil, mas as mudanças de estado feitas ao sábado contam (com a data desse dia).
 */

const pad = (n: number) => String(n).padStart(2, "0");
const isoUtc = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Domingo de Páscoa (algoritmo de Meeus/Butcher). */
function easter(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** Feriados nacionais obrigatórios (YYYY-MM-DD → nome). O Carnaval e os feriados municipais não contam. */
export function nationalHolidays(year: number): Map<string, string> {
  const e = easter(year);
  const rel = (n: number) => isoUtc(new Date(e.getTime() + n * 86400000));
  return new Map([
    [`${year}-01-01`, "Ano Novo"],
    [rel(-2), "Sexta-feira Santa"],
    [rel(0), "Páscoa"],
    [`${year}-04-25`, "Dia da Liberdade"],
    [`${year}-05-01`, "Dia do Trabalhador"],
    [rel(60), "Corpo de Deus"],
    [`${year}-06-10`, "Dia de Portugal"],
    [`${year}-08-15`, "Assunção de Nossa Senhora"],
    [`${year}-10-05`, "Implantação da República"],
    [`${year}-11-01`, "Todos os Santos"],
    [`${year}-12-01`, "Restauração da Independência"],
    [`${year}-12-08`, "Imaculada Conceição"],
    [`${year}-12-25`, "Natal"],
  ]);
}

/**
 * Dias úteis de um mês `YYYY-MM`, separados em decorridos (até `today` inclusive) e por trabalhar (depois de `today`).
 * Devolve também os feriados nacionais do mês que calham em dias de semana.
 */
export function monthWorkdays(month: string, today: string) {
  const y = Number(month.slice(0, 4));
  const mo = Number(month.slice(5, 7)) - 1;
  const hol = nationalHolidays(y);
  let total = 0;
  let elapsed = 0;
  const holidays: { date: string; name: string }[] = [];
  for (let d = new Date(Date.UTC(y, mo, 1)); d.getUTCMonth() === mo; d = new Date(d.getTime() + 86400000)) {
    const k = isoUtc(d);
    const wd = d.getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const h = hol.get(k);
    if (h) {
      holidays.push({ date: k, name: h });
      continue;
    }
    total++;
    if (k <= today) elapsed++;
  }
  return { total, elapsed, remaining: total - elapsed, holidays };
}
