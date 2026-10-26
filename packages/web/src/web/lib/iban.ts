/**
 * Cálculo do IBAN (ISO 13616, mod 97).
 *
 * A validação oficial não cabe num inteiro de 64 bits (o número resultante tem
 * dezenas de dígitos), por isso o resto é calculado por blocos, digito a digito,
 * mantendo sempre um resto < 97.
 */

/** Letras -> número: A=10 … Z=35. Dígitos passam inalterados. */
const charValue = (c: string) => {
  const code = c.charCodeAt(0);
  if (code >= 48 && code <= 57) return c; // 0-9
  return String(code - 55); // A=65 -> 10
};

/**
 * Resto mod 97 de uma string numérica, por blocos.
 * Acumula 2-3 dígitos de cada vez e reduz logo a seguir, para nunca
 * ultrapassar o intervalo seguro dos inteiros em JS.
 */
export function mod97(numeric: string): number {
  let rest = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    const chunk = String(rest) + numeric.slice(i, i + 7);
    rest = Number(chunk) % 97;
  }
  return rest;
}

/** Remove espaços e passa a maiúsculas. */
export const normalize = (s: string) => s.replace(/\s+/g, "").toUpperCase();

/** Reformata em grupos de 4 caracteres. */
export const group4 = (s: string) => s.replace(/(.{4})/g, "$1 ").trim();

/**
 * Valida um IBAN completo (ISO 13616).
 * 1. move os 4 primeiros caracteres para o fim;
 * 2. converte letras em números (A=10 … Z=35);
 * 3. calcula o resto mod 97;
 * 4. é válido quando o resto é 1.
 */
export function isValidIban(iban: string): boolean {
  const s = normalize(iban);
  if (s.length < 4) return false;
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  const numeric = [...rearranged].map(charValue).join("");
  return mod97(numeric) === 1;
}

/** Comprimentos oficiais por país (subconjunto dos que a empresa usa). */
const IBAN_LENGTH: Record<string, number> = { PT: 25, ES: 24, FR: 27, DE: 22, IT: 27, NL: 18, BE: 16, LU: 20, GB: 22, IE: 22 };

/**
 * Gera todas as combinações para os "?" do padrão e devolve as válidas.
 * Devolve também quantas foram testadas, para o resumo.
 */
export function completeIban(pattern: string): { tested: number; valid: string[] } {
  const p = normalize(pattern);
  const holes = [...p].filter((c) => c === "?").length;
  if (holes === 0) return { tested: 0, valid: [] };

  const tested = 10 ** holes;
  const valid: string[] = [];
  const chars = [...p];

  for (let n = 0; n < tested; n++) {
    // dígitos do número n, alinhados à direita nos buracos
    const digits = String(n).padStart(holes, "0");
    let d = 0;
    for (let i = 0; i < chars.length; i++) {
      if (chars[i] !== "?") continue;
      chars[i] = digits[d++];
    }
    const candidate = chars.join("");
    if (isValidIban(candidate)) valid.push(group4(candidate));
    // repõe os buracos para a próxima iteração
    for (let i = 0; i < chars.length; i++) if (p[i] === "?") chars[i] = "?";
  }

  return { tested, valid };
}

/** Análise do padrão escrito: erros e avisos a mostrar antes de gerar. */
export type PatternCheck = { error: string | null; warning: string | null; holes: number };

export function checkPattern(raw: string): PatternCheck {
  const p = normalize(raw);
  const holes = [...p].filter((c) => c === "?").length;

  if (!p) return { error: null, warning: null, holes: 0 };
  if (holes === 0) return { error: "Marca os dígitos em falta com \"?\".", warning: null, holes: 0 };
  if (holes > 5) return { error: "Máximo de 5 dígitos em falta. Tens " + holes + ".", warning: null, holes };
  if (!/^[A-Z]{2}[0-9]{2}/.test(p)) return { error: "O IBAN deve começar por 2 letras do país e 2 dígitos de controlo (ex.: PT50).", warning: null, holes };
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9?]*$/.test(p)) return { error: "O IBAN só pode ter letras, dígitos e \"?\".", warning: null, holes };

  const cc = p.slice(0, 2);
  const expected = IBAN_LENGTH[cc];
  const warning = expected && p.length !== expected ? "Começa por " + cc + " mas tem " + p.length + " caracteres; o normal são " + expected + "." : null;
  return { error: null, warning, holes };
}
