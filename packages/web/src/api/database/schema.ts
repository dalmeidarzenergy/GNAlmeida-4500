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
  /** Permissões efetivas por módulo (ver/editar); nulo = usar as do perfil. */
  permissions: text("permissions", { mode: "json" }).$type<Permissions | null>(),
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
  commissionRate: real("commission_rate").notNull().default(0),
  /** Tabela comisional aplicada a este funcionário. */
  commissionTableId: integer("commission_table_id").references(() => commissionTables.id, { onDelete: "set null" }),
  /** Categoria comercial: gestor-comercial | team-leader | coordenador | gestor-parcerias | parceiro | freelancer.
   *  As tabelas atribuídas têm de ser todas do mesmo grupo que esta categoria. */
  category: text("category"),
  /** Escalão de chefe de equipa aplicado a este funcionário (só para chefes). */
  chiefTableId: integer("chief_table_id").references(() => chiefTables.id, { onDelete: "set null" }),
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

/* ============================================================
 * Módulo Terreno D2D (porta a porta)
 * ============================================================ */

/** Turno de trabalho D2D. `end` nulo = turno aberto (em curso). */
export const d2dShifts = sqliteTable("d2d_shifts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").references(() => employees.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  zone: text("zone").notNull(),
  start: integer("start").notNull(),
  end: integer("end"),
  lat: real("lat"),
  lng: real("lng"),
  /** Fechado automaticamente às 23:59 quando o comercial não fechou. */
  autoClosed: integer("auto_closed", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
});

/** Porta registada num turno D2D. O par (userId, t) identifica-a para edições/apagamentos. */
export const d2dDoors = sqliteTable("d2d_doors", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  shiftId: integer("shift_id")
    .notNull()
    .references(() => d2dShifts.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  /** Timestamp (ms) original da porta gerado no telemóvel — identifica a porta para editar/apagar. */
  t: integer("t").notNull(),
  rua: text("rua").notNull(),
  num: text("num").notNull(),
  /** Zona (localidade) onde a porta foi batida — pode diferir da zona inicial do turno. */
  zona: text("zona"),
  res: text("res").notNull(),
  cli: text("cli"),
  tel: text("tel"),
  nota: text("nota"),
  lat: real("lat"),
  lng: real("lng"),
  acc: real("acc"),
  /** true quando o cliente já foi contactado (marcado no Histórico → Interessados). */
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
});

/** Registo de cada evento recebido de /api/d2d (id único evita repetidos). */
export const d2dEvents = sqliteTable("d2d_events", {
  id: text("id").primaryKey(),
  tipo: text("tipo").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  hora: integer("hora").notNull(),
  dados: text("dados", { mode: "json" }).$type<Record<string, unknown> | null>(),
  createdAt: createdAt(),
});

/** Relatório diário gerado ao fechar (ou fechar automaticamente) um turno. */
export const d2dDailyReports = sqliteTable("d2d_daily_reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  shiftId: integer("shift_id")
    .notNull()
    .references(() => d2dShifts.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  data: text("data").notNull(), // YYYY-MM-DD
  zone: text("zone"),
  inicio: integer("inicio"),
  fim: integer("fim"),
  resumo: text("resumo", { mode: "json" }).$type<Record<string, unknown> | null>(),
  relatorio: text("relatorio"),
  portas: text("portas", { mode: "json" }).$type<unknown[] | null>(),
  autoClosed: integer("auto_closed", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
});

/** Meta do dia (portas e vendas) definida pela chefia; aplica-se à sua equipa (cadeia abaixo). */
export const d2dGoals = sqliteTable("d2d_goals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Funcionário que definiu a meta (chefe); null = global (admin/diretor). */
  employeeId: integer("employee_id"),
  data: text("data").notNull(), // YYYY-MM-DD
  portas: integer("portas").notNull(),
  vendas: integer("vendas").notNull(),
  createdAt: createdAt(),
});

/** Documento anexado a uma porta (ou enviado pela chefia). O ficheiro fica em public/uploads/d2d. */
export const d2dDocuments = sqliteTable("d2d_documents", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  /** Id da porta a que pertence (t da porta), ou null quando é um envio da chefia. */
  portaT: integer("porta_t"),
  name: text("name").notNull(),
  type: text("type").notNull(),
  size: integer("size").notNull(),
  path: text("path").notNull(),
  /** Destinatário (null = anexo de porta). "equipa" ou um userId. */
  destinatario: text("destinatario"),
  nota: text("nota"),
  /** Nome do cliente (opcional) numa mensagem enviada. */
  cli: text("cli"),
  /** NIF do cliente (opcional) numa mensagem enviada. */
  nif: text("nif"),
  /** Agrupa vários ficheiros enviados juntos numa só mensagem. */
  messageId: text("message_id"),
  createdAt: createdAt(),
});

/** Item da caixa de documentos: kind "venda" (anexo de porta) ou "enviado" (da chefia). */
export const d2dMailbox = sqliteTable("d2d_mailbox", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  docId: text("doc_id")
    .notNull()
    .references(() => d2dDocuments.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // "venda" | "enviado"
  fromUserId: text("from_user_id").references(() => user.id, { onDelete: "set null" }),
  fromName: text("from_name"),
  read: integer("read", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
});

/** Catálogo do Simulador Iberdrola — armazenamento chave-valor (um único registo com todo o JSON). */
export const simuladorCatalog = sqliteTable("simulador_catalog", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/** Propostas guardadas do Simulador Iberdrola. */
export const simuladorPropostas = sqliteTable("simulador_propostas", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  authorName: text("author_name").notNull(),
  employeeId: integer("employee_id"),
  clientName: text("client_name"),
  clientNif: text("client_nif"),
  segment: text("segment"),
  bestPlan: text("best_plan"),
  saving: real("saving"),
  data: text("data", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
});

/**
 * Tabelas comissionais: aplicam-se por funcionário e definem a remuneração por serviço vendido.
 * Os escalões de clientes (mensais) escalam LUZ, GÁS, DD, FE e PEL; o MEDEM escala por pontos
 * e o Solar pela quantidade de painéis.
 */
export const commissionTables = sqliteTable("commission_tables", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color").notNull().default("#c6f432"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  /** Nº de vendas LUZ/Dual BTN em fornecimento que não são pagas (bloqueio mensal da tabela). */
  blockedSales: real("blocked_sales").notNull().default(0),
  /** Grupo comercial a que a tabela pertence: gestor-comercial | team-leader | coordenador | gestor-parcerias | parceiro | freelancer. */
  group: text("group").notNull().default("gestor-comercial"),
  /** Tipo de tabela: RES+BTN NEG | MEDEM | SOLAR. */
  regime: text("regime").notNull().default("RES+BTN NEG"),
  /** Se esta tabela serve de Tabela Base para chefes de equipa (grupo Parceiro). */
  isBase: integer("is_base", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
});

/**
 * Escalões de uma tabela comisional.
 * kind = "clients" (faixas mensais de nº de clientes → luz/gas/dd/fe/pel),
 *        "medem" (faixas por nº de pontos → commission) ou
 *        "solar" (faixas por nº de painéis → commission).
 */
export const commissionRows = sqliteTable("commission_rows", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tableId: integer("table_id")
    .notNull()
    .references(() => commissionTables.id, { onDelete: "cascade" }),
  /** "clients" | "medem" | "solar". */
  kind: text("kind").notNull().default("clients"),
  /** Limite inferior da faixa (nº de clientes, pontos ou painéis). */
  min: real("min"),
  /** Limite superior da faixa (vazio = sem limite, ex.: ">= 40"). */
  max: real("max"),
  /** Comissão (€) — usada pelo MEDEM e pelo Solar. */
  commission: real("commission"),
  /** Comissões (€) por serviço vendido — usadas pelo escalão de clientes. */
  luz: real("luz"),
  gas: real("gas"),
  dd: real("dd"),
  fe: real("fe"),
  pel: real("pel"),
  /** Ordem de apresentação dentro do escalonamento. */
  position: integer("position").notNull().default(0),
  createdAt: createdAt(),
});

/**
 * Escalão de Chefe de Equipa.
 * Ao contrário da tabela de vendedor (que paga por venda), o chefe recebe por escalão:
 * o escalão é apurado pelo TOTAL de vendas válidas da equipa (as dele incluídas) e paga um valor fixo.
 */
export const chiefTables = sqliteTable("chief_tables", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color").notNull().default("#c6f432"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  /** Nº de vendas da equipa que não são pagas (bloqueio mensal). */
  blockedSales: real("blocked_sales").notNull().default(0),
  createdAt: createdAt(),
});

/**
 * Escalões de uma tabela de chefe.
 * kind = "team"  (vendas da equipa inteira → `commission` fixo)
 *        "own"   (vendas próprias do chefe → LUZ/GÁS/DD/FE/PEL, igual à tabela de vendedor)
 */
export const chiefRows = sqliteTable("chief_rows", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tableId: integer("table_id")
    .notNull()
    .references(() => chiefTables.id, { onDelete: "cascade" }),
  /** "team" | "own". */
  kind: text("kind").notNull().default("team"),
  min: real("min"),
  max: real("max"),
  /** Comissão fixa (€) — usada pelo escalão de equipa. */
  commission: real("commission"),
  /** Comissões (€) por serviço vendido — usadas pelo escalão próprio. */
  luz: real("luz"),
  gas: real("gas"),
  dd: real("dd"),
  fe: real("fe"),
  pel: real("pel"),
  position: integer("position").notNull().default(0),
  createdAt: createdAt(),
});

/**
 * Histórico de tabelas atribuídas a um funcionário, com vigência por datas.
 * `kind = "commission"` (tabela comisional de vendedor) | `"chief"` (escalão de chefe de equipa).
 * `endDate` nulo = em vigor sem fim definido. O cálculo de um mês usa a linha cuja vigência
 * cobre o mês; se não houver nenhuma, recorre-se à tabela atual do funcionário.
 */
/**
 * Autos de pagamento: registo do que foi efetivamente pago a cada funcionario num mes.
 * `kind` = "commission" (vendedor) | "chief" (chefe de equipa) | "solar" | "medem" | "outro".
 * `status` = "pago" | "por_pagar".
 */
export const payments = sqliteTable("payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  employeeId: integer("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  /** Mes de referencia no formato YYYY-MM. */
  month: text("month").notNull(),
  kind: text("kind").notNull().default("commission"),
  /** Valor pago (EUR). */
  amount: real("amount").notNull().default(0),
  /** Numero de vendas a que o pagamento respeita. */
  salesCount: real("sales_count").notNull().default(0),
  /** Data em que foi pago (YYYY-MM-DD), nulo se ainda por pagar. */
  paidOn: text("paid_on"),
  /** "pago" | "por_pagar". */
  status: text("status").notNull().default("por_pagar"),
  /** Extras da formula: PEL PLUS (nº), débito direto (nº) e FE (nº) — total em € em `extrasAmount`. */
  pelQty: real("pel_qty").notNull().default(0),
  ddQty: real("dd_qty").notNull().default(0),
  feQty: real("fe_qty").notNull().default(0),
  /** Total pago em extras (EUR). */
  extrasAmount: real("extras_amount").notNull().default(0),
  /** Base antes de descontos (EUR). */
  grossAmount: real("gross_amount").notNull().default(0),
  /** Penalizacao de timing / contratacao (EUR). Regras a definir — valor manual. */
  penaltyTiming: real("penalty_timing").notNull().default(0),
  /** Penalizacao de campanha (EUR). Regras a definir — valor manual. */
  penaltyCampaign: real("penalty_campaign").notNull().default(0),
  /** Desconto folha de km (EUR, valor positivo a descontar). */
  kmDeduction: real("km_deduction").notNull().default(0),
  /** Chave de armazenamento do PDF do auto de pagamento gerado. */
  pdfKey: text("pdf_key"),
  pdfName: text("pdf_name"),
  notes: text("notes"),
  createdAt: createdAt(),
});

export const employeeTables = sqliteTable("employee_tables", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  employeeId: integer("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().default("commission"),
  commissionTableId: integer("commission_table_id").references(() => commissionTables.id, { onDelete: "cascade" }),
  chiefTableId: integer("chief_table_id").references(() => chiefTables.id, { onDelete: "cascade" }),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  notes: text("notes"),
  createdAt: createdAt(),
});

/**
 * Autos Iberdrola: histórico dos ficheiros Excel exportados da Iberdrola
 * (pagamento dos comerciais). Cada import = um ficheiro carregado, associado
 * a um mês de referência.
 */
/** Regras de pagamento (penalidades, descontos) aplicadas sobre o Auto Iberdrola. */
export const rules = sqliteTable("rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type").notNull().default("manual"), // manual | auto
  description: text("description"),
  /** Coluna do Excel a inspecionar (só para regras auto). Ex: "Timing de contratação" */
  sourceColumn: text("source_column"),
  /** Operador de comparação para regras auto: > | < | >= | <= | == | != */
  operator: text("operator"),
  /** Valor a comparar (texto ou número; guarda-se como texto). */
  compareValue: text("compare_value"),
  /** Tipo do efeito: fixed_eur (€ fixos) | percent (-10% = -0.1) */
  effectType: text("effect_type").notNull().default("fixed_eur"),
  /** Valor do efeito (e.g. -10, -0.10). */
  effectValue: real("effect_value").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: createdAt(),
});

/** Regra manual atribuída a um funcionário num mês específico. */
export const ruleAssignments = sqliteTable("rule_assignments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ruleId: integer("rule_id")
    .notNull()
    .references(() => rules.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  month: text("month").notNull(), // YYYY-MM
  createdAt: createdAt(),
});

export const iberdrolaImports = sqliteTable("iberdrola_imports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  filename: text("filename").notNull(),
  month: text("month").notNull(),
  /** Caminho relativo do ficheiro original guardado em disco (public/uploads/iberdrola/). */
  path: text("path"),
  uploadedBy: text("uploaded_by").notNull(),
  createdAt: createdAt(),
});

/**
 * Linhas de um import Iberdrola (folhas `auto` e `chargback`).
 * `idVenda` = "ID de venda" do Excel;
 * `data` = linha completa, coluna → valor, tal como veio do ficheiro.
 */
export const iberdrolaRows = sqliteTable("iberdrola_rows", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  importId: integer("import_id")
    .notNull()
    .references(() => iberdrolaImports.id, { onDelete: "cascade" }),
  sheet: text("sheet").notNull(),
  rowIndex: integer("row_index").notNull(),
  idVenda: text("id_venda"),
  estado: text("estado"),
  data: text("data", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
});
