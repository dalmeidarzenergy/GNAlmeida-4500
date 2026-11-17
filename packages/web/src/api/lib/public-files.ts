import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
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

/**
 * Apaga um ficheiro que tenha sido escrito por `writePublic`.
 *
 * Recebe o URL publico guardado na base de dados (`/uploads/leads/xxx.pdf`).
 * Nunca rebenta: se o ficheiro ja nao existir, o registo da base de dados sai
 * na mesma — o que interessa e nao deixar anexos orfaos em `public/`.
 */
export function removePublic(url: string | null | undefined) {
  if (!url) return;
  const rel = url.replace(/^\/uploads\//, "").split("?")[0];
  if (!rel || rel.startsWith("..")) return;
  try {
    unlinkSync(join(PUBLIC_DIR, "uploads", decodeURIComponent(rel)));
  } catch {
    /* ficheiro ja apagado */
  }
}
