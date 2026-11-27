import { count, inArray, sql } from "drizzle-orm";
import { db } from "../database";
import { sales } from "../database/schema";
import { SALE_COUNTED } from "../shared/client-forms";
import { territoryMunicipality } from "../shared/territory-municipalities";

// Só os campos de localização da venda; nenhuma morada, nome ou outro dado do cliente.
const details = sql`case when json_valid(${sales.details}) then ${sales.details} else null end`;
const district = sql<unknown>`json_extract(${details}, '$.district')`;
const municipality = sql<unknown>`json_extract(${details}, '$.municipality')`;

export async function territoryContractCounts() {
  const groups = await db.select({ district, municipality, total: count() }).from(sales)
    .where(inArray(sales.status, SALE_COUNTED))
    .groupBy(district, municipality);

  const totals = new Map<string, number>();
  for (const group of groups) {
    const { district, municipality, total } = group;
    if (typeof municipality !== "string" || (district != null && typeof district !== "string")) continue;
    const code = territoryMunicipality({ district: district ?? "", municipality })?.code;
    if (code) totals.set(code, (totals.get(code) ?? 0) + total);
  }
  return totals;
}