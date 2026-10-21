import { sqliteTable, text, integer, real, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

export * from "./auth-schema";

const createdAt = () =>
  integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

/** Perfil de acesso de cada utilizador: admin | rh | chefe | vendedor */
export const userRoles = sqliteTable("user_roles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("vendedor"),
  employeeId: integer("employee_id"),
  createdAt: createdAt(),
});

export const departments = sqliteTable("departments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color").notNull().default("#c6f432"),
  createdAt: createdAt(),
});

export const positions = sqliteTable("positions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  departmentId: integer("department_id").references(() => departments.id, { onDelete: "set null" }),
  level: text("level").notNull().default("Pleno"),
  /** Tipos de vínculo que este cargo aceita; vazio = nenhum (a ficha não mostra o vínculo). */
  bondTypes: text("bond_types", { mode: "json" }).$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
});

export const employees = sqliteTable("employees", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  nif: text("nif"),
  /** Chave da foto no armazenamento (Tigris/S3). */
  photoKey: text("photo_key"),
  departmentId: integer("department_id").references(() => departments.id, { onDelete: "set null" }),
  positionId: integer("position_id").references(() => positions.id, { onDelete: "set null" }),
  /** Responsável direto. Só o topo da hierarquia (um único funcionário) fica sem responsável. */
  managerId: integer("manager_id").references((): AnySQLiteColumn => employees.id, { onDelete: "restrict" }),
  hireDate: text("hire_date").notNull(),
  /** Data de inativação (último dia ativo). Obrigatória quando o estado é "inativo". */
  terminationDate: text("termination_date"),
  salary: real("salary").notNull().default(0),
  status: text("status").notNull().default("ativo"),
  isSeller: integer("is_seller", { mode: "boolean" }).notNull().default(false),
  commissionRate: real("commission_rate").notNull().default(0),
  vacationDays: integer("vacation_days").notNull().default(22),
  /** ETT (empresa de trabalho temporário): Vertente Humana ou Talenter. */
  ett: text("ett"),
  /** Tipo de vínculo (Bolsa de Formação 5h/6h, Contrato 5h/6h); as opções dependem do cargo. */
  bond: text("bond"),
  createdAt: createdAt(),
});

export const absences = sqliteTable("absences", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  employeeId: integer("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("ferias"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  days: integer("days").notNull().default(1),
  status: text("status").notNull().default("pendente"),
  notes: text("notes"),
  createdAt: createdAt(),
});

export const jobOpenings = sqliteTable("job_openings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  departmentId: integer("department_id").references(() => departments.id, { onDelete: "set null" }),
  location: text("location"),
  description: text("description"),
  status: text("status").notNull().default("aberta"),
  createdAt: createdAt(),
});

export const candidates = sqliteTable("candidates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id")
    .notNull()
    .references(() => jobOpenings.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  stage: text("stage").notNull().default("candidatura"),
  rating: integer("rating").notNull().default(3),
  notes: text("notes"),
  createdAt: createdAt(),
});

export const clients = sqliteTable("clients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type").notNull().default("empresa"),
  /** Legado (antes os dados da venda ficavam no cliente). Já não é usado: os dados da venda estão em `sales`. */
  sector: text("sector"),
  operator: text("operator"),
  service: text("service"),
  details: text("details", { mode: "json" }).$type<Record<string, string | boolean | null>>(),
  nif: text("nif"),
  email: text("email"),
  phone: text("phone"),
  city: text("city"),
  ownerId: integer("owner_id").references(() => employees.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const sales = sqliteTable("sales", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  number: text("number").notNull(),
  clientId: integer("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  sellerId: integer("seller_id").references(() => employees.id, { onDelete: "set null" }),
  date: text("date").notNull(),
  status: text("status").notNull().default("Prospeção"),
  /** Fornecedor da venda (só IBERDROLA). */
  supplier: text("supplier").notNull().default("IBERDROLA"),
  /** Serviço a aderir: LUZ, GÁS, DUAL ou SOLAR. */
  service: text("service"),
  /** Dados do formulário da venda (CPE, potência, estado VTV…), sem os dados do cliente. */
  details: text("details", { mode: "json" }).$type<Record<string, string | boolean | null>>(),
  total: real("total").notNull().default(0),
  notes: text("notes"),
  createdAt: createdAt(),
});

export const saleItems = sqliteTable("sale_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  saleId: integer("sale_id")
    .notNull()
    .references(() => sales.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  quantity: real("quantity").notNull().default(1),
  unitPrice: real("unit_price").notNull().default(0),
});

export const salesTargets = sqliteTable("sales_targets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sellerId: integer("seller_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  month: text("month").notNull(),
  target: real("target").notNull().default(0),
});

/** Campanhas comerciais IBERDROLA. As vendas referem a campanha pelo código (`sales.details.campaign`). */
export const campaigns = sqliteTable("campaigns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  name: text("name"),
  /** LUZ, GÁS, DUAL, SOLAR ou null (todos os serviços). */
  service: text("service"),
  /** todos | particular | empresa */
  clientType: text("client_type").notNull().default("todos"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  description: text("description"),
  /** PDF anexado (chave no armazenamento) e o nome original do ficheiro. */
  pdfKey: text("pdf_key"),
  pdfName: text("pdf_name"),
  createdAt: createdAt(),
});

/** Equipas internas: cada equipa tem um chefe de equipa responsável pelos membros. */
export const teams = sqliteTable("teams", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color").notNull().default("#c6f432"),
  leaderId: integer("leader_id").references(() => employees.id, { onDelete: "set null" }),
  /** Coordenador responsável pela equipa (funcionário). Opcional. */
  coordinatorId: integer("coordinator_id").references(() => employees.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

/**
 * Histórico de pertença às equipas. Cada período vai de `startDate` a `endDate` (inclusive; sem fim = atual).
 * Um funcionário só pode estar numa equipa de cada vez; as vendas contam para a equipa onde o vendedor estava na data da venda.
 */
export const teamMemberships = sqliteTable("team_memberships", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: integer("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  createdAt: createdAt(),
});

/**
 * Registo de cada mudança de estado das vendas. `energy` = "luz" para o estado principal da venda
 * (LUZ, GÁS, SOLAR e a luz das DUAL) e "gas" para o estado do gás das DUAL.
 */
export const saleStatusHistory = sqliteTable("sale_status_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  saleId: integer("sale_id")
    .notNull()
    .references(() => sales.id, { onDelete: "cascade" }),
  energy: text("energy").notNull().default("luz"),
  status: text("status").notNull(),
  /** Data da mudança (YYYY-MM-DD, hora de Lisboa). */
  changedOn: text("changed_on").notNull(),
  changedBy: text("changed_by"),
  createdAt: createdAt(),
});

/**
 * Calendário da agenda. Tipo "pessoal" (um por utilizador) ou "equipa" (um por equipa).
 * O pessoal guarda o utilizador dono e a equipa em que está inserido (para a hierarquia de visibilidade).
 */
export const calendars = sqliteTable("calendars", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(), // "pessoal" | "equipa"
  /** Utilizador dono (só nos pessoais). */
  userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
  /** Equipa a que pertence (sempre nos de equipa; nos pessoais = equipa atual do dono). */
  teamId: integer("team_id").references(() => teams.id, { onDelete: "set null" }),
  /** Cor do calendário na vista (herda a da equipa nos pessoais). */
  color: text("color").notNull().default("#c6f432"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: createdAt(),
});

/** Evento da agenda, num calendário. */
export const calendarEvents = sqliteTable("calendar_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  calendarId: integer("calendar_id")
    .notNull()
    .references(() => calendars.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  date: text("date").notNull(), // YYYY-MM-DD
  startTime: text("start_time").notNull(), // HH:MM
  endTime: text("end_time"),
  notes: text("notes"),
  /** Nome do cliente (texto livre, opcional). */
  clientName: text("client_name"),
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

/**
 * Calendários atribuídos a utilizadores Backoffice/RH (e perfis com âmbito "atribuído").
 * Cada linha atribui uma equipa inteira ou um funcionário individual.
 */
export const calendarAssignments = sqliteTable("calendar_assignments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  /** Equipa atribuída (inclui o calendário da equipa e os pessoais dos membros). */
  teamId: integer("team_id").references(() => teams.id, { onDelete: "cascade" }),
  /** Funcionário individual atribuído (o seu calendário pessoal). */
  employeeId: integer("employee_id").references(() => employees.id, { onDelete: "cascade" }),
  assignedBy: text("assigned_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});
