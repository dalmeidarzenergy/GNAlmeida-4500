/**
 * Icones das linhas da assinatura, tingidos com a cor escolhida.
 *
 * Os ficheiros em `public/logos/icones/` sao PNG com o desenho opaco e o fundo
 * transparente (29x29, traco fino). Para a assinatura sair na cor do utilizador,
 * o servidor troca o RGB de cada pixel pela cor pedida e deixa o alfa intacto —
 * o desenho e o mesmo, a cor muda.
 *
 * Porque no servidor e nao no browser: o HTML da assinatura vai para um cliente
 * de email, onde so um URL remoto funciona de forma fiavel (um `data:` URI e
 * cortado pelo Outlook e pelo Gmail). Assim cada cor e um URL, e o resultado
 * tem cache para nao andar a gerar a mesma imagem vezes sem conta.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PUBLIC_DIR } from "./public-files";

/** Tipos da assinatura -> ficheiro do icone (o movel usa o do telefone). */
export const ICONES: Record<string, string> = {
  telefone: "telefone",
  movel: "telefone",
  email: "email",
  site: "site",
  morada: "morada",
  extra: "extra",
};

/** Nome do ficheiro do icone de um tipo, ou null se o tipo nao tem icone. */
export function iconeDe(tipo: string): string | null {
  return ICONES[tipo] ?? null;
}

const cache = new Map<string, Uint8Array>();

/** Cor `#rrggbb` ou `#rgb` -> canais; null se nao for uma cor. */
function hex(cor: string) {
  let c = (cor || "").trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(c)) c = c[0]! + c[0]! + c[1]! + c[1]! + c[2]! + c[2]!;
  if (!/^[0-9a-fA-F]{6}$/.test(c)) return null;
  const n = parseInt(c, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * PNG do icone na cor pedida. Se o `sharp` nao estiver disponivel, devolve o
 * icone original (escuro) em vez de falhar — a assinatura fica com os icones,
 * so nao muda de cor.
 */
export async function iconePng(tipo: string, cor: string): Promise<Uint8Array | null> {
  const nome = iconeDe(tipo);
  if (!nome) return null;
  const rgb = hex(cor) ?? hex("#00402a")!;
  const chave = `${nome}:${rgb.r},${rgb.g},${rgb.b}`;
  const guardado = cache.get(chave);
  if (guardado) return guardado;

  let base: Uint8Array;
  try {
    base = readFileSync(join(PUBLIC_DIR, "logos", "icones", `${nome}.png`));
  } catch {
    return null;
  }

  let final: Uint8Array = base;
  try {
    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp(base).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const w = info.width;
    const h = info.height;

    // Alguns PNG (os que vieram do Figma, por exemplo) sao "negativos": fundo
    // branco opaco e o desenho vazado no alfa. Um icone normal tem os cantos
    // transparentes, por isso e por ai que se distingue — e inverte-se o alfa
    // para o desenho ficar opaco sobre fundo transparente.
    const cantos = [3, (w - 1) * 4 + 3, (h - 1) * w * 4 + 3, ((h - 1) * w + w - 1) * 4 + 3];
    const opacos = cantos.filter((i) => (data[i] ?? 0) > 128).length;
    if (opacos >= 3) {
      for (let i = 3; i < data.length; i += 4) data[i] = 255 - data[i]!;
    }

    for (let i = 0; i < data.length; i += 4) {
      data[i] = rgb.r;
      data[i + 1] = rgb.g;
      data[i + 2] = rgb.b;
    }
    final = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch (e) {
    console.error("[assinaturas] sem sharp para tingir o icone, a servir o original:", e);
  }

  cache.set(chave, final);
  return final;
}
