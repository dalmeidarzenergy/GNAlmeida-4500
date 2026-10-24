import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Caminho absoluto da pasta `public/` da app web.
 *
 * Resolvido a partir deste ficheiro (nao do cwd do processo): o servidor pode
 * ser arrancado da raiz do repo, de packages/web, ou por pm2, e o cwd muda.
 * Os ficheiros gerados em runtime (autos de pagamento, avatares, campanhas)
 * tem de cair sempre no mesmo sitio que o `__server.ts` serve.
 */
export const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../public");

/** Escreve um ficheiro em public/uploads/<subpasta> e devolve o URL publico. */
export function writePublic(subdir: string, filename: string, data: Uint8Array | string) {
  const dir = join(PUBLIC_DIR, "uploads", subdir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), data);
  return `/uploads/${subdir}/${encodeURIComponent(filename)}`;
}
