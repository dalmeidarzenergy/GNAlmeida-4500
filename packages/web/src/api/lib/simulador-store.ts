import { db } from "../database";
import { simuladorCatalog } from "../database/schema";
import { eq } from "drizzle-orm";

const CATALOG_KEY = "rz_catalogo";

/** Store para o backend campanhas.mjs: lê/guarda o catálogo na BD do site. */
export const simuladorStore = {
  get: async (): Promise<string | null> => {
    const [row] = await db.select({ value: simuladorCatalog.value }).from(simuladorCatalog).where(eq(simuladorCatalog.key, CATALOG_KEY));
    return row?.value ?? null;
  },
  set: async (texto: string): Promise<void> => {
    await db.delete(simuladorCatalog).where(eq(simuladorCatalog.key, CATALOG_KEY));
    await db.insert(simuladorCatalog).values({ key: CATALOG_KEY, value: texto });
  },
};