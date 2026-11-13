import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

/**
 * Frota — viaturas da empresa, cartoes frota, documentos, registos de km e manutencoes.
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
  /** Quilometragem atual (o registo mais recente manda). */
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
 * Documento anexado a uma viatura, a um cartao frota, a uma manutencao ou a um
 * consumo de cartao. `kind`: livrete | seguro | inspecao | contrato | fatura | outro.
 */
export const fleetDocuments = sqliteTable("fleet_documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  vehicleId: integer("vehicle_id"),
  cardId: integer("card_id"),
  maintenanceId: integer("maintenance_id"),
  /** Consumo de cartao a que o documento pertence (fatura, recibo, talão). */
  entryId: integer("entry_id"),
  kind: text("kind").notNull().default("outro"),
  name: text("name").notNull(),
  path: text("path").notNull(),
  size: integer("size").notNull().default(0),
  mime: text("mime"),
  expiresOn: text("expires_on"),
  notes: text("notes"),
  createdAt: createdAt(),
});

/**
 * Registo de quilometros de uma viatura. Cada leitura tem uma data
 * (`recordedOn`), os km do conta-quilometros e quem os registou.
 * A quilometragem atual da viatura e a do registo mais recente.
 */
export const vehicleReadings = sqliteTable("vehicle_readings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  vehicleId: integer("vehicle_id").notNull(),
  recordedOn: text("recorded_on").notNull(),
  km: integer("km").notNull(),
  /** Quem registou (id de `employees`), opcional. */
  employeeId: integer("employee_id"),
  /** De onde veio a leitura: manual | inspecao | manutencao | importacao. */
  source: text("source").notNull().default("manual"),
  /** Consumo de cartao que gerou esta leitura, quando veio de um abastecimento. */
  entryId: integer("entry_id"),
  notes: text("notes"),
  createdAt: createdAt(),
});

/**
 * Manutencao / intervencao de uma viatura.
 * `kind`: revisao | pneus | inspecao | reparacao | oleo | outro
 * `status`: agendada | em_curso | concluida
 */
export const vehicleMaintenance = sqliteTable("vehicle_maintenance", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  vehicleId: integer("vehicle_id").notNull(),
  kind: text("kind").notNull().default("revisao"),
  status: text("status").notNull().default("agendada"),
  /** Data em que entrou / esta marcada. */
  scheduledOn: text("scheduled_on"),
  /** Data em que ficou pronta. Nulo enquanto nao terminar. */
  doneOn: text("done_on"),
  /** Km da viatura a entrada. */
  km: integer("km"),
  /** Km ate aos quais vale esta intervencao (a proxima e a seguir). */
  nextKm: integer("next_km"),
  /** Data da proxima intervencao, quando e pelo calendario e nao pelos km. */
  nextOn: text("next_on"),
  workshop: text("workshop"),
  cost: real("cost").notNull().default(0),
  /** Quem pagou / a que cartao ou centro de custo. */
  paidBy: text("paid_by"),
  description: text("description"),
  notes: text("notes"),
  createdAt: createdAt(),
});

/**
 * Consumo de um cartao frota: abastecimento, carregamento eletrico, portagem
 * ou outro movimento. O cartao (e por arrasto o veiculo) dizem de onde saiu o
 * dinheiro; `km` e opcional e, quando vem, entra no historico de quilometros.
 * `kind`: combustivel | eletricidade | portagem | outro
 */
export const fuelEntries = sqliteTable("fuel_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Cartao usado (id de `fleet_cards`). */
  cardId: integer("card_id"),
  /** Viatura abastecida. Normalmente vem do cartao, mas pode ser outra. */
  vehicleId: integer("vehicle_id"),
  /** Quem fez o abastecimento (id de `employees`). */
  employeeId: integer("employee_id"),
  spentOn: text("spent_on").notNull(),
  kind: text("kind").notNull().default("combustivel"),
  /** Litros ou kWh. */
  liters: real("liters").notNull().default(0),
  /** Preco unitario (EUR/litro ou EUR/kWh). */
  pricePerL: real("price_per_l").notNull().default(0),
  /** Valor total pago. */
  amount: real("amount").notNull().default(0),
  /** Km no momento do abastecimento (opcional). */
  km: integer("km"),
  station: text("station"),
  notes: text("notes"),
  createdAt: createdAt(),
});
