/**
 * Assinaturas de email (Definições > Assinaturas).
 *
 * Guarda tudo na tabela `company_settings` (chave -> JSON), para não precisar
 * de tabelas novas:
 *   - `assinaturas_template:<userId>` -> o modelo/estilo da assinatura daquele utilizador
 *   - `assinaturas_dados:<userId>`    -> os dados (nome, cargo, contactos, redes)
 *   - `assinaturas_logos`             -> a biblioteca de logos (partilhada por todos)
 *
 * O modelo e os dados são por utilizador: cada comercial cria a sua assinatura
 * e gravar a sua não pode mudar a de outra pessoa. A biblioteca de logos é da
 * empresa — o logo é sempre o mesmo, só muda quem o usa.
 */
import { eq } from "drizzle-orm";
import { db } from "../database";
import { companySettings } from "../database/schema";

/** Chave do modelo de assinatura de um utilizador. */
export const templateKey = (userId: string) => `assinaturas_template:${userId}`;
/** Chave dos dados de assinatura de um utilizador. */
export const dadosKey = (userId: string) => `assinaturas_dados:${userId}`;
/** Biblioteca de logos, partilhada pela empresa. */
export const LOGOS_KEY = "assinaturas_logos";

export async function settingsGet<T>(key: string): Promise<T | null> {
  const [row] = await db.select({ value: companySettings.value }).from(companySettings).where(eq(companySettings.key, key));
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export async function settingsSet(key: string, value: unknown): Promise<void> {
  const text = JSON.stringify(value);
  const [existing] = await db.select({ key: companySettings.key }).from(companySettings).where(eq(companySettings.key, key));
  if (existing) {
    await db.update(companySettings).set({ value: text, updatedAt: new Date() }).where(eq(companySettings.key, key));
  } else {
    await db.insert(companySettings).values({ key, value: text, updatedAt: new Date() });
  }
}
