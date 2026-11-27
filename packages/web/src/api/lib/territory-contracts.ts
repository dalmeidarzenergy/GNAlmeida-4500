import { count, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../database";
import { employees, sales } from "../database/schema";
import { SALE_COUNTED } from "../shared/client-forms";
import { territoryMunicipality } from "../shared/territory-municipalities";

// Só os campos de localização da venda; nenhuma morada, nome ou outro dado do cliente.
const details = sql`case when json_valid(${sales.details}) then ${sales.details} else null end`;
const district = sql<unknown>`json_extract(${details}, '$.district')`;
const municipality = sql<unknown>`json_extract(${details}, '$.municipality')`;
const city = sql<unknown>`case when json_type(${details}, '$.city') = 'text' then json_extract(${details}, '$.city') else null end`;
const contractNumber = sql<string | null>`case when json_type(${details}, '$.contractNumber') in ('text', 'integer') then cast(json_extract(${details}, '$.contractNumber') as text) else null end`;

function saleMunicipalityCode(district: unknown, municipality: unknown) {
  if (typeof municipality !== "string" || (district != null && typeof district !== "string")) return undefined;
  return territoryMunicipality({ district: district ?? "", municipality })?.code;
}

export async function territoryContractCounts() {
  const groups = await db.select({ district, municipality, total: count() }).from(sales)
    .where(inArray(sales.status, SALE_COUNTED))
    .groupBy(district, municipality);

  const totals = new Map<string, number>();
  for (const group of groups) {
    const { district, municipality, total } = group;
    const code = saleMunicipalityCode(district, municipality);
    if (code) totals.set(code, (totals.get(code) ?? 0) + total);
  }
  return totals;
}

export async function territoryContractLocations(code: string) {
  const groups = await db.select({ district, municipality, city, total: count() }).from(sales)
    .where(inArray(sales.status, SALE_COUNTED)).groupBy(district, municipality, city);
  return groups.flatMap((group) => saleMunicipalityCode(group.district, group.municipality) === code
    ? [{ city: typeof group.city === "string" ? group.city : null, total: group.total }] : []);
}

export async function territoryContractDetails(code: string) {
  const rows = await db.select({
    id: sales.id, reference: sales.number, contractNumber, date: sales.date, status: sales.status,
    employeeId: sales.sellerId, employeeName: employees.name, district, municipality,
  }).from(sales).leftJoin(employees, eq(employees.id, sales.sellerId))
    .where(sql`json_type(${details}, '$.municipality') = 'text'`)
    .orderBy(desc(sales.date), desc(sales.id));

  return rows.flatMap(({ district, municipality, ...sale }) => saleMunicipalityCode(district, municipality) === code ? [sale] : []);
}