import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

/**
 * Frota — viaturas da empresa, cartoes frota e documentos anexados.
 *
 * Fica num ficheiro separado de `schema.ts` porque a pagina da Frota cresceu
 * como uma area propria. Evita importar `employees` daqui: as relacoes para
 * funcionarios guardam so o id (sem FK) para nao criar um ciclo de imports
 * entre os dois modulos de schema.
 */

const createdAt = () =>
  integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

/** Viatura da frota. `status`: ativo | manutencao | inativo. */
export const vehicles = sqliteTable("vehicles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  plate: text("plate").notNull(),
  brand: text("brand"),
  model: text("model"),
  year: integer("year"),
  fuel: text("fuel"),
  km: integer("km").notNull().default(0),
  /** Funcionario que conduz a viatura (id de `employees`). */
  employeeId: integer("employee_id"),
  status: text("status").notNull().default("ativo"),
  notes: text("notes"),
  createdAt: createdAt(),
});

/** Cartao frota (combustivel). Pode estar ligado a uma viatura e/ou a um funcionario. */
export const fleetCards = sqliteTable("fleet_cards", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  provider: text("provider").notNull(),
  number: text("number").notNull(),
  pin: text("pin"),
  vehicleId: integer("vehicle_id"),
  employeeId: integer("employee_id"),
  monthlyLimit: real("monthly_limit").notNull().default(0),
  startDate: text("start_date"),
  endDate: text("end_date"),
  status: text("status").notNull().default("ativo"),
  notes: text("notes"),
  createdAt: createdAt(),
});

/**
 * Documento anexado a uma viatura ou a um cartao frota.
 * `kind`: livre — livrete, seguro, inspecao, contrato, fatura, outro.
 */
export const fleetDocuments = sqliteTable("fleet_documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  vehicleId: integer("vehicle_id"),
  cardId: integer("card_id"),
  kind: text("kind").notNull().default("outro"),
  name: text("name").notNull(),
  path: text("path").notNull(),
  size: integer("size").notNull().default(0),
  mime: text("mime"),
  expiresOn: text("expires_on"),
  notes: text("notes"),
  createdAt: createdAt(),
});
