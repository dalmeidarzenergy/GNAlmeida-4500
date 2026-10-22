import { db } from "../database";
import { simuladorCatalog } from "../database/schema";
import { eq } from "drizzle-orm";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CATALOG_KEY = "rz_catalogo";

/** Store para o backend campanhas.mjs: lê/guarda o catálogo na BD do site.
 *  Na primeira leitura, se a BD estiver vazia, semeia com o campanhas.json estático. */
export const simuladorStore = {
  get: async (): Promise<string | null> => {
    const [row] = await db.select({ value: simuladorCatalog.value }).from(simuladorCatalog).where(eq(simuladorCatalog.key, CATALOG_KEY));
    if (row?.value) return row.value;
    // Seed: ler o ficheiro estático campanhas.json
    try {
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const seedPath = join(__dirname, "..", "..", "..", "public", "campanhas.json");
      if (existsSync(seedPath)) {
        const seed = readFileSync(seedPath, "utf-8");
        await db.delete(simuladorCatalog).where(eq(simuladorCatalog.key, CATALOG_KEY));
        await db.insert(simuladorCatalog).values({ key: CATALOG_KEY, value: seed });
        return seed;
      }
    } catch { /* fallback: DB vazia, sem seed */ }
    return null;
  },
  set: async (texto: string): Promise<void> => {
    await db.delete(simuladorCatalog).where(eq(simuladorCatalog.key, CATALOG_KEY));
    await db.insert(simuladorCatalog).values({ key: CATALOG_KEY, value: texto });
  },
};