import { count, inArray, sql } from "drizzle-orm";
import { db } from "../database";
import { sales } from "../database/schema";
import { SALE_COUNTED } from "../shared/client-forms";
import { territoryParishCode } from "./territory-distance";

// Só os campos de localização da venda; nenhuma morada, nome ou outro dado do cliente.
const details = sql`case when json_valid(${sales.details}) then ${sales.details} else null end`;
const district = sql<unknown>`json_extract(${details}, '$.district')`;
const municipality = sql<unknown>`json_extract(${details}, '$.municipality')`;
const parish = sql<unknown>`json_extract(${details}, '$.city')`;

export async function territoryContractCounts() {
  const groups = await db.select({ district, municipality, parish, total: count() }).from(sales)
    .where(inArray(sales.status, SALE_COUNTED))
    .groupBy(district, municipality, parish);

  const totals = new Map<string, number>();
  for (const group of groups) {
    const { district, municipality, parish, total } = group;
    if (typeof district !== "string" || typeof municipality !== "string" || typeof parish !== "string") continue;
    const code = territoryParishCode({ district, municipality, parish });
    if (code) totals.set(code, (totals.get(code) ?? 0) + total);
  }
  return totals;
}