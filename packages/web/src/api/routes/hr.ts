import { z } from "zod";
import { ORPCError } from "@orpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { authed, requireView, requireEdit } from "../middleware/auth";
import { db } from "../database";
import { absences, calendars, chiefTables, commissionTables, departments, employeeTables, employees, positions, teamMemberships, teams, userRoles } from "../database/schema";
import { localWithPhotos } from "../lib/s3";
import { ensureTeamCalendar, syncPersonalCalendarTeam } from "./agenda";
import { canManage } from "../shared/hierarchy";
import { BONDS, ETTS } from "../shared/bonds";
import { COMMISSION_GROUPS } from "../shared/commission-groups";
import { writePublic } from "../lib/public-files";

const departmentInput = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  color: z.string().default("#c6f432"),
});

/** O vínculo tem de ser uma das opções configuradas no cargo (vazio = sem vínculo). */
async function validateBond(positionId: number | null, bond: string | null | undefined) {
  if (!bond) return;
  if (!positionId) throw new ORPCError("BAD_REQUEST", { message: "Escolha o cargo antes do tipo de vínculo." });
  const [pos] = await db.select({ bondTypes: positions.bondTypes, title: positions.title }).from(positions).where(eq(positions.id, positionId));
  const allowed = (pos?.bondTypes ?? []) as string[];
  if (!allowed.includes(bond)) throw new ORPCError("BAD_REQUEST", { message: `O cargo ${pos?.title ?? "—"} não aceita o vínculo ${bond}. Opções: ${allowed.join(", ") || "nenhuma"}.` });
  if (!BONDS.includes(bond)) throw new ORPCError("BAD_REQUEST", { message: "Tipo de vínculo inválido." });
}

const positionInput = z.object({
  title: z.string().min(1),
  departmentId: z.number().nullable(),
  level: z.string().default("Pleno"),
  bondTypes: z.array(z.string()).default([]),
});

const employeeInput = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().nullable().optional(),
  nif: z.string().nullable().optional(),
  photoKey: z.string().nullable().optional(),
  departmentId: z.number().nullable(),
  positionId: z.number().nullable(),
  managerId: z.number().nullable(),
  hireDate: z.string(),
  terminationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  salary: z.number().min(0),
  status: z.enum(["ativo", "pendente", "suspenso", "blacklist", "inativo"]).default("ativo"),
  commissionRate: z.number().min(0).max(100).default(0),
  commissionTableId: z.number().nullable().optional(),
  chiefTableId: z.number().nullable().optional(),
  /** Categoria comercial; define de que grupo podem ser as tabelas atribuídas. */
  category: z.enum(COMMISSION_GROUPS).nullable().optional(),
  /** ETT (empresa de trabalho temporário) e tipo de vínculo; as opções de vínculo vêm do cargo. */
  ett: z.enum(ETTS as [string, ...string[]]).nullable().optional(),
  bond: z.enum(BONDS as [string, ...string[]]).nullable().optional(),
});

const absenceInput = z.object({
  employeeId: z.number(),
  type: z.enum(["ferias", "baixa", "falta", "formacao", "outro"]),
  startDate: z.string(),
  endDate: z.string(),
  notes: z.string().nullable().optional(),
});

function businessDays(start: string, end: string) {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  let n = 0;
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return Math.max(n, 1);
}

const idInput = z.object({ id: z.number() });

const teamInput = z.object({
  name: z.string().trim().min(1, "Indique o nome da equipa."),
  description: z.string().nullable().optional(),
  color: z.string().default("#c6f432"),
  leaderId: z.number({ message: "Escolha o chefe de equipa." }),
  /** Coordenador responsável pela equipa (opcional). */
  coordinatorId: z.number().nullable().optional(),
  memberIds: z.array(z.number()).default([]),
  /** Data a partir da qual as entradas e saídas de membros contam (por defeito, hoje). */
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** Valida o chefe de equipa e os membros; devolve os membros sem o próprio chefe e sem repetidos. */
async function validateTeam(input: z.infer<typeof teamInput>) {
  const [leader] = await db
    .select({ name: employees.name, status: employees.status, positionTitle: positions.title })
    .from(employees)
    .leftJoin(positions, eq(positions.id, employees.positionId))
    .where(eq(employees.id, input.leaderId));
  if (!leader) throw new ORPCError("BAD_REQUEST", { message: "Chefe de equipa não encontrado." });
  if (leader.status === "inativo") throw new ORPCError("BAD_REQUEST", { message: `${leader.name} está inativo e não pode ser chefe de equipa.` });
  if (!canManage(leader.positionTitle)) {
    throw new ORPCError("BAD_REQUEST", { message: `O cargo ${leader.positionTitle} não pode ser chefe de equipa.` });
  }
  const memberIds = [...new Set(input.memberIds)].filter((id) => id !== input.leaderId);
  if (memberIds.length) {
    const found = await db.select({ id: employees.id }).from(employees).where(inArray(employees.id, memberIds));
    if (found.length !== memberIds.length) throw new ORPCError("BAD_REQUEST", { message: "Há membros que não existem." });
  }
  return memberIds;
}

const todayLisbon = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" });
const dayBefore = (d: string) => new Date(new Date(`${d}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
const dateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.");

/** Termina, no dia anterior a `date`, as pertenças em aberto do funcionário (só da equipa indicada, se houver). As que começam nessa data ou depois são apagadas. */
async function closeMemberships(employeeId: number, date: string, teamId?: number) {
  const scope = and(eq(teamMemberships.employeeId, employeeId), teamId == null ? undefined : eq(teamMemberships.teamId, teamId));
  await db.delete(teamMemberships).where(and(scope, sql`${teamMemberships.startDate} >= ${date}`));
  await db
    .update(teamMemberships)
    .set({ endDate: dayBefore(date) })
    .where(and(scope, sql`(${teamMemberships.endDate} is null or ${teamMemberships.endDate} >= ${date})`));
}

/** A partir de `date`, o funcionário passa a pertencer à equipa (ou a nenhuma, com null). */
async function moveMember(employeeId: number, teamId: number | null, date: string) {
  await closeMemberships(employeeId, date);
  if (teamId != null) await db.insert(teamMemberships).values({ teamId, employeeId, startDate: date });
}

/** Ids que um chefe de equipa pode ver/gerir: ele próprio e os membros das equipas que chefia. */
async function teamScopeIds(context: { employeeId?: number | null }) {
  if (!context.employeeId) return [];
  const led = await db.select({ id: teams.id }).from(teams).where(eq(teams.leaderId, context.employeeId));
  if (!led.length) return [context.employeeId];
  const today = todayLisbon();
  const out = new Set<number>([context.employeeId]);
  for (const t of led) {
    const mem = await db
      .select({ id: teamMemberships.employeeId })
      .from(teamMemberships)
      .where(and(eq(teamMemberships.teamId, t.id), sql`${teamMemberships.startDate} <= ${today}`, sql`(${teamMemberships.endDate} is null or ${teamMemberships.endDate} >= ${today})`));
    for (const m of mem) out.add(m.id);
  }
  return [...out];
}

/** Membros atuais (pertença sem fim ou com fim a partir de hoje). */
async function currentMemberIds(teamId: number) {
  const today = todayLisbon();
  const rows = await db
    .select({ id: teamMemberships.employeeId })
    .from(teamMemberships)
    .where(and(eq(teamMemberships.teamId, teamId), sql`${teamMemberships.startDate} <= ${today}`, sql`(${teamMemberships.endDate} is null or ${teamMemberships.endDate} >= ${today})`));
  return new Set(rows.map((r) => r.id));
}

/**
 * Define os membros da equipa a partir de `date`, sem apagar o histórico:
 * quem sai fica com a data de saída no dia anterior; quem entra (vindo ou não de outra equipa) começa nessa data.
 */
async function setTeamMembers(teamId: number, memberIds: number[], date = todayLisbon()) {
  const current = await currentMemberIds(teamId);
  for (const id of current) if (!memberIds.includes(id)) await closeMemberships(id, date, teamId);
  for (const id of memberIds) if (!current.has(id)) await moveMember(id, teamId, date);
  // Os calendários pessoais seguem a equipa: membros atuais passam a estar ligados a ela; quem saiu fica sem equipa.
  for (const id of memberIds) await syncPersonalCalendarTeam(id, teamId);
  for (const id of current) if (!memberIds.includes(id)) await syncPersonalCalendarTeam(id, null);
}

/**
 * Regras da hierarquia:
 * - todos têm responsável, exceto um único funcionário no topo;
 * - ninguém pode ser responsável de si próprio nem criar ciclos;
 * - quem tem cargo de Gestor Comercial não pode ser responsável de ninguém.
 */
async function validateManager(id: number | null, managerId: number | null, positionId: number | null = null) {
  const all = await db
    .select({ id: employees.id, name: employees.name, managerId: employees.managerId, positionTitle: positions.title })
    .from(employees)
    .leftJoin(positions, eq(positions.id, employees.positionId));
  const others = all.filter((e) => e.id !== id);
  if (id != null && positionId != null) {
    const [pos] = await db.select({ title: positions.title }).from(positions).where(eq(positions.id, positionId));
    const reports = all.filter((e) => e.managerId === id);
    if (pos && !canManage(pos.title) && reports.length) {
      throw new ORPCError("BAD_REQUEST", {
        message: `O cargo ${pos.title} não pode ser responsável de outros funcionários, e este funcionário é responsável de ${reports.length} (${reports.slice(0, 3).map((r) => r.name).join(", ")}${reports.length > 3 ? "…" : ""}). Atribua-lhes outro responsável primeiro.`,
      });
    }
  }
  if (managerId == null) {
    const top = others.find((e) => e.managerId == null);
    if (top) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Indique o responsável. ${top.name} já está no topo da hierarquia — só pode existir um funcionário sem responsável.`,
      });
    }
    return;
  }
  if (managerId === id) throw new ORPCError("BAD_REQUEST", { message: "Um funcionário não pode ser responsável de si próprio." });
  const byId = new Map(all.map((e) => [e.id, e]));
  const mgr = byId.get(managerId);
  if (!mgr) throw new ORPCError("BAD_REQUEST", { message: "Responsável inválido." });
  if (!canManage(mgr.positionTitle)) {
    throw new ORPCError("BAD_REQUEST", { message: `${mgr.name} tem o cargo ${mgr.positionTitle} e não pode ser responsável de outros funcionários.` });
  }
  if (id != null) {
    let cur: number | null | undefined = managerId;
    const seen = new Set<number>();
    while (cur != null && !seen.has(cur)) {
      if (cur === id) throw new ORPCError("BAD_REQUEST", { message: "Esse responsável é subordinado deste funcionário — criaria um ciclo na hierarquia." });
      seen.add(cur);
      cur = byId.get(cur)?.managerId;
    }
  }
}

/** Inativo exige data de inativação (≥ admissão); os outros estados limpam a data. */
function normalizeTermination<T extends { status: string; hireDate: string; terminationDate?: string | null }>(input: T): T {
  if (input.status !== "inativo") return { ...input, terminationDate: null };
  if (!input.terminationDate) throw new ORPCError("BAD_REQUEST", { message: "Indique a data de inativação do funcionário." });
  if (input.terminationDate < input.hireDate) {
    throw new ORPCError("BAD_REQUEST", { message: "A data de inativação não pode ser anterior à data de admissão." });
  }
  return input;
}

export const hr = {
  departments: {
    list: requireView("departamentos").handler(async () => {
      const rows = await db
        .select({
          id: departments.id,
          name: departments.name,
          description: departments.description,
          color: departments.color,
          headcount: sql<number>`(select count(*) from employees e where e.department_id = "departments"."id" and e.status != 'inativo')`,
          payroll: sql<number>`(select coalesce(sum(e.salary),0) from employees e where e.department_id = "departments"."id" and e.status != 'inativo')`,
        })
        .from(departments)
        .orderBy(departments.name);
      return rows;
    }),
    create: requireEdit("departamentos").input(departmentInput).handler(async ({ input }) => {
      const [row] = await db.insert(departments).values(input).returning();
      return row;
    }),
    update: requireEdit("departamentos").input(departmentInput.extend({ id: z.number() })).handler(async ({ input }) => {
      const { id, ...data } = input;
      await db.update(departments).set(data).where(eq(departments.id, id));
      return { ok: true };
    }),
    remove: requireEdit("departamentos").input(idInput).handler(async ({ input }) => {
      await db.delete(departments).where(eq(departments.id, input.id));
      return { ok: true };
    }),
  },
  positions: {
    list: requireView("departamentos").handler(async () => {
      return db
        .select({
          id: positions.id,
          title: positions.title,
          level: positions.level,
          bondTypes: positions.bondTypes,
          departmentId: positions.departmentId,
          departmentName: departments.name,
          headcount: sql<number>`(select count(*) from employees e where e.position_id = ${positions.id} and e.status != 'inativo')`,
        })
        .from(positions)
        .leftJoin(departments, eq(departments.id, positions.departmentId))
        .orderBy(positions.title);
    }),
    create: requireEdit("departamentos").input(positionInput).handler(async ({ input }) => {
      const [row] = await db.insert(positions).values(input).returning();
      return row;
    }),
    update: requireEdit("departamentos").input(positionInput.extend({ id: z.number() })).handler(async ({ input }) => {
      const { id, ...data } = input;
      if (!canManage(data.title)) {
        const [{ n }] = await db
          .select({ n: sql<number>`count(*)` })
          .from(employees)
          .where(sql`${employees.positionId} = ${id} and exists (select 1 from employees r where r.manager_id = "employees"."id")`);
        if (Number(n) > 0) {
          throw new ORPCError("BAD_REQUEST", { message: `Há funcionários com este cargo que são responsáveis de outros. O cargo ${data.title} não pode ter subordinados.` });
        }
      }
      await db.update(positions).set(data).where(eq(positions.id, id));
      return { ok: true };
    }),
    remove: requireEdit("departamentos").input(idInput).handler(async ({ input }) => {
      await db.delete(positions).where(eq(positions.id, input.id));
      return { ok: true };
    }),
  },
  employees: {
    list: requireView("funcionarios").handler(async ({ context }) => {
      const scope = context.role === "chefe" ? await teamScopeIds(context) : null;
      const rows = await db
        .select({
          id: employees.id,
          name: employees.name,
          email: employees.email,
          phone: employees.phone,
          nif: employees.nif,
          photoKey: employees.photoKey,
          departmentId: employees.departmentId,
          positionId: employees.positionId,
          managerId: employees.managerId,
          managerName: sql<string | null>`(select m.name from employees m where m.id = ${employees.managerId})`,
          reportsCount: sql<number>`(select count(*) from employees r where r.manager_id = ${employees.id})`,
          hireDate: employees.hireDate,
          terminationDate: employees.terminationDate,
          salary: employees.salary,
          status: employees.status,
          commissionRate: employees.commissionRate,
          commissionTableId: employees.commissionTableId,
          commissionTableName: sql<string | null>`(select ct.name from commission_tables ct where ct.id = ${employees.commissionTableId})`,
          category: employees.category,
          chiefTableId: employees.chiefTableId,
          chiefTableName: sql<string | null>`(select ch.name from chief_tables ch where ch.id = ${employees.chiefTableId})`,
          ett: employees.ett,
          bond: employees.bond,
          bondTypes: sql<string | null>`(select p.bond_types from positions p where p.id = ${employees.positionId})`,
          departmentName: departments.name,
          departmentColor: departments.color,
          positionTitle: positions.title,
        })
        .from(employees)
        .leftJoin(departments, eq(departments.id, employees.departmentId))
        .leftJoin(positions, eq(positions.id, employees.positionId))
        .where(scope ? inArray(employees.id, scope.length ? scope : [-1]) : undefined)
        .orderBy(employees.name);
      return localWithPhotos(rows);
    }),
    /** Envia foto do funcionário — guarda localmente em public/uploads/employees/. */
    photoUpload: requireEdit("funcionarios")
      .input(z.object({ content: z.string() }))
      .handler(async ({ input }) => {
        const match = input.content.match(/^data:image\/(jpeg|png|webp);base64,/);
        if (!match) throw new ORPCError("BAD_REQUEST", { message: "Formato de imagem inválido." });
        const ext = match[1] === "jpeg" ? "jpeg" : match[1];
        const filename = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
        const base64 = input.content.slice(match[0].length);
        writePublic("employees", filename, Buffer.from(base64, "base64"));
        return { key: `employees/${filename}` };
      }),
    /** Lista leve (id, nome) para seletores — chefe: só a sua equipa; gestor comercial: só ele próprio. */
    options: authed.handler(async ({ context }) => {
      const scope = context.role === "chefe" ? await teamScopeIds(context) : context.role === "vendedor" ? [context.employeeId ?? -1] : null;
      return db
        .select({ id: employees.id, name: employees.name, status: employees.status, hireDate: employees.hireDate, terminationDate: employees.terminationDate })
        .from(employees)
        .where(scope ? inArray(employees.id, scope.length ? scope : [-1]) : undefined)
        .orderBy(employees.name);
    }),
    create: requireEdit("funcionarios").input(employeeInput).handler(async ({ input: raw }) => {
      await validateBond(raw.positionId, raw.bond);
      const input = normalizeTermination(raw);
      await validateBond(input.positionId, input.bond);
      await validateManager(null, input.managerId, input.positionId);
      if (input.commissionTableId != null) {
        const [table] = await db.select({ group: commissionTables.group }).from(commissionTables).where(eq(commissionTables.id, input.commissionTableId));
        if (table && input.category !== table.group) input.category = table.group;
      }
      const [row] = await db.insert(employees).values(input).returning();
      return row;
    }),
    update: requireEdit("funcionarios").input(employeeInput.extend({ id: z.number() })).handler(async ({ input }) => {
      const { id, ...data } = normalizeTermination(input);
      await validateBond(data.positionId, data.bond);
      await validateManager(id, data.managerId, data.positionId);
      // Se a tabela comisional pertence a outro grupo, ajusta a categoria automaticamente.
      if (data.commissionTableId != null) {
        const [table] = await db.select({ group: commissionTables.group }).from(commissionTables).where(eq(commissionTables.id, data.commissionTableId));
        if (table && data.category !== table.group) data.category = table.group;
      }
      await db.update(employees).set(data).where(eq(employees.id, id));
      // Ao desativar, o calendário pessoal fica inativo (os eventos mantêm-se); ao reativar, volta a ficar ativo.
      const linked = await db.select({ userId: userRoles.userId }).from(userRoles).where(eq(userRoles.employeeId, id));
      for (const l of linked) await db.update(calendars).set({ active: data.status !== "inativo" }).where(and(eq(calendars.userId, l.userId), eq(calendars.type, "pessoal")));
      return { ok: true };
    }),
    remove: requireEdit("funcionarios").input(idInput).handler(async ({ input }) => {
      const reports = await db.select({ name: employees.name }).from(employees).where(eq(employees.managerId, input.id));
      if (reports.length) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Não é possível eliminar: é responsável de ${reports.length} funcionário(s) (${reports.slice(0, 3).map((r) => r.name).join(", ")}${reports.length > 3 ? "…" : ""}). Atribua-lhes outro responsável primeiro.`,
        });
      }
      await db.delete(employees).where(eq(employees.id, input.id));
      return { ok: true };
    }),
  },
  /**
   * Histórico de tabelas (comisional / escalão de chefe) atribuídas a um funcionário, com vigência.
   * Permite saber que tabela estava em vigor numa dada data.
   */
  employeeTables: {
    list: requireView("funcionarios")
      .input(z.object({ employeeId: z.number() }))
      .handler(async ({ input }) => {
        const rows = await db.select().from(employeeTables).where(eq(employeeTables.employeeId, input.employeeId)).orderBy(desc(employeeTables.startDate), desc(employeeTables.id));
        const com = await db.select({ id: commissionTables.id, name: commissionTables.name }).from(commissionTables);
        const chief = await db.select({ id: chiefTables.id, name: chiefTables.name }).from(chiefTables);
        return rows.map((r) => ({
          ...r,
          tableName: r.kind === "chief" ? (chief.find((c) => c.id === r.chiefTableId)?.name ?? null) : (com.find((c) => c.id === r.commissionTableId)?.name ?? null),
        }));
      }),
    /** Todas as atribuições (para o cálculo mensal resolver a tabela em vigor por mês). */
    all: requireView("tabelas-comissionais").handler(async () => {
      return db.select().from(employeeTables).orderBy(employeeTables.employeeId, employeeTables.startDate);
    }),
    save: requireEdit("funcionarios")
      .input(
        z.object({
          id: z.number().optional(),
          employeeId: z.number(),
          kind: z.enum(["commission", "chief"]).default("commission"),
          tableId: z.number(),
          startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Indique a data de início."),
          endDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .nullable()
            .optional(),
          notes: z.string().nullable().optional(),
        }),
      )
      .handler(async ({ input }) => {
        if (input.endDate && input.endDate < input.startDate) throw new ORPCError("BAD_REQUEST", { message: "A data de fim não pode ser anterior à data de início." });

        if (input.kind === "commission") {
          const [emp] = await db.select({ category: employees.category }).from(employees).where(eq(employees.id, input.employeeId));
          const dbCat = emp?.category ?? null;
          const [table] = await db.select({ group: commissionTables.group, name: commissionTables.name }).from(commissionTables).where(eq(commissionTables.id, input.tableId));
          if (!table) throw new ORPCError("BAD_REQUEST", { message: "Tabela não encontrada." });
          // Se o funcionário ainda não tem categoria, assume a da tabela automaticamente.
          if (!dbCat) {
            await db.update(employees).set({ category: table.group }).where(eq(employees.id, input.employeeId));
          } else if (table.group !== dbCat) {
            // O funcionário mudou de categoria profissional: atualiza a categoria.
            await db.update(employees).set({ category: table.group }).where(eq(employees.id, input.employeeId));
          }
        }

        const values = {
          employeeId: input.employeeId,
          kind: input.kind,
          commissionTableId: input.kind === "commission" ? input.tableId : null,
          chiefTableId: input.kind === "chief" ? input.tableId : null,
          startDate: input.startDate,
          endDate: input.endDate ?? null,
          notes: input.notes ?? null,
        };
        if (input.id) {
          await db.update(employeeTables).set(values).where(eq(employeeTables.id, input.id));
        } else {
          await db.insert(employeeTables).values(values);
        }
        return { ok: true };
      }),
    remove: requireEdit("funcionarios")
      .input(z.object({ id: z.number() }))
      .handler(async ({ input }) => {
        await db.delete(employeeTables).where(eq(employeeTables.id, input.id));
        return { ok: true };
      }),
  },
  teams: {
    list: authed.handler(async ({ context }) => {
      const rows = await db
        .select({
          id: teams.id,
          name: teams.name,
          description: teams.description,
          color: teams.color,
          leaderId: teams.leaderId,
          leaderName: employees.name,
          leaderPhotoKey: employees.photoKey,
          leaderStatus: employees.status,
          coordinatorId: teams.coordinatorId,
        })
        .from(teams)
        .leftJoin(employees, eq(employees.id, teams.leaderId))
        .orderBy(teams.name)
        .then((list) => (context.role === "chefe" ? list.filter((t) => t.leaderId === context.employeeId) : context.role === "vendedor" ? [] : list));
      const today = todayLisbon();
      const all = await db
        .select({
          membershipId: teamMemberships.id,
          teamId: teamMemberships.teamId,
          startDate: teamMemberships.startDate,
          endDate: teamMemberships.endDate,
          id: employees.id,
          name: employees.name,
          status: employees.status,
          photoKey: employees.photoKey,
          positionTitle: positions.title,
        })
        .from(teamMemberships)
        .innerJoin(employees, eq(employees.id, teamMemberships.employeeId))
        .leftJoin(positions, eq(positions.id, employees.positionId))
        .orderBy(employees.name);
      const members = all.filter((m) => m.startDate <= today && (m.endDate == null || m.endDate >= today));
      const history = all
        .map(({ photoKey: _p, ...m }) => m)
        .sort((a, b) => b.startDate.localeCompare(a.startDate) || a.name.localeCompare(b.name));
      const withUrls = await localWithPhotos(members);
      const leaders = localWithPhotos(rows.map((r) => ({ ...r, photoKey: r.leaderPhotoKey })));
      return leaders.map(({ photoUrl, leaderPhotoKey: _k, photoKey: _p, ...t }) => ({
        ...t,
        leaderPhotoUrl: photoUrl,
        members: withUrls.filter((m) => m.teamId === t.id),
        history: history.filter((m) => m.teamId === t.id),
      }));
    }),
    create: requireEdit("equipas").input(teamInput).handler(async ({ input }) => {
      const memberIds = await validateTeam(input);
      const { memberIds: _m, effectiveDate, ...data } = input;
      const [row] = await db.insert(teams).values({ ...data, coordinatorId: data.coordinatorId ?? null }).returning();
      await setTeamMembers(row.id, memberIds, effectiveDate);
      // Nasce o calendário da equipa; os calendários pessoais dos membros passam para esta equipa.
      await ensureTeamCalendar(row.id);
      for (const m of memberIds) await syncPersonalCalendarTeam(m, row.id);
      return row;
    }),
    update: requireEdit("equipas").input(teamInput.extend({ id: z.number() })).handler(async ({ input }) => {
      const memberIds = await validateTeam(input);
      const { id, memberIds: _m, effectiveDate, ...data } = input;
      await db.update(teams).set(data).where(eq(teams.id, id));
      await setTeamMembers(id, memberIds, effectiveDate);
      return { ok: true };
    }),
    /** Muda um comercial de equipa a partir de uma data (a pertença anterior termina no dia antes). */
    moveMember: requireEdit("equipas")
      .input(z.object({ employeeId: z.number(), teamId: z.number().nullable(), date: dateInput }))
      .handler(async ({ input }) => {
        const [e] = await db.select({ id: employees.id }).from(employees).where(eq(employees.id, input.employeeId));
        if (!e) throw new ORPCError("BAD_REQUEST", { message: "Funcionário não encontrado." });
        if (input.teamId != null) {
          const [t] = await db.select({ leaderId: teams.leaderId }).from(teams).where(eq(teams.id, input.teamId));
          if (!t) throw new ORPCError("BAD_REQUEST", { message: "Equipa não encontrada." });
          if (t.leaderId === input.employeeId) throw new ORPCError("BAD_REQUEST", { message: "O chefe já conta sempre na sua equipa." });
        }
        await moveMember(input.employeeId, input.teamId, input.date);
        await syncPersonalCalendarTeam(input.employeeId, input.teamId);
        return { ok: true };
      }),
    /** Corrige as datas de uma pertença, sem sobrepor outras do mesmo funcionário. */
    editMembership: requireEdit("equipas")
      .input(z.object({ id: z.number(), startDate: dateInput, endDate: dateInput.nullable() }))
      .handler(async ({ input }) => {
        if (input.endDate && input.endDate < input.startDate) throw new ORPCError("BAD_REQUEST", { message: "A data de saída não pode ser anterior à de entrada." });
        const [m] = await db.select().from(teamMemberships).where(eq(teamMemberships.id, input.id));
        if (!m) throw new ORPCError("NOT_FOUND", { message: "Registo não encontrado." });
        const others = await db.select().from(teamMemberships).where(eq(teamMemberships.employeeId, m.employeeId));
        const end = input.endDate ?? "9999-12-31";
        const clash = others.find((o) => o.id !== m.id && o.startDate <= end && (o.endDate ?? "9999-12-31") >= input.startDate);
        if (clash) throw new ORPCError("BAD_REQUEST", { message: "As datas sobrepõem-se a outra equipa deste funcionário. Ajuste primeiro esse registo." });
        await db.update(teamMemberships).set({ startDate: input.startDate, endDate: input.endDate }).where(eq(teamMemberships.id, input.id));
        return { ok: true };
      }),
    removeMembership: requireEdit("equipas").input(idInput).handler(async ({ input }) => {
      await db.delete(teamMemberships).where(eq(teamMemberships.id, input.id));
      return { ok: true };
    }),
    remove: requireEdit("equipas").input(idInput).handler(async ({ input }) => {
      // O calendário da equipa e os seus eventos são eliminados; os pessoais dos membros ficam sem equipa.
      await db.delete(calendars).where(and(eq(calendars.teamId, input.id), eq(calendars.type, "equipa")));
      await db.delete(teams).where(eq(teams.id, input.id));
      return { ok: true };
    }),
  },
  absences: {
    list: requireView("ausencias").handler(async ({ context }) => {
      const q = db
        .select({
          id: absences.id,
          employeeId: absences.employeeId,
          employeeName: employees.name,
          type: absences.type,
          startDate: absences.startDate,
          endDate: absences.endDate,
          days: absences.days,
          status: absences.status,
          notes: absences.notes,
        })
        .from(absences)
        .innerJoin(employees, eq(employees.id, absences.employeeId))
        .orderBy(desc(absences.startDate));
      if (context.role === "vendedor") {
        if (!context.employeeId) return [];
        return q.where(eq(absences.employeeId, context.employeeId));
      }
      if (context.role === "chefe") {
        const ids = await teamScopeIds(context);
        return ids.length ? q.where(inArray(absences.employeeId, ids)) : [];
      }
      return q;
    }),
    create: authed.input(absenceInput).handler(async ({ input, context }) => {
      let employeeId = input.employeeId;
      if (context.role === "vendedor") employeeId = context.employeeId ?? 0;
      if (context.role === "chefe") {
        const ids = await teamScopeIds(context);
        if (!employeeId) employeeId = context.employeeId ?? 0;
        if (!ids.includes(employeeId)) throw new ORPCError("FORBIDDEN", { message: "Só pode pedir ausências para si ou para a sua equipa." });
      }
      if (!employeeId) throw new Error("Conta sem funcionário associado");
      const [row] = await db
        .insert(absences)
        .values({ ...input, employeeId, days: businessDays(input.startDate, input.endDate), status: "pendente" })
        .returning();
      return row;
    }),
    setStatus: requireEdit("ausencias")
      .input(z.object({ id: z.number(), status: z.enum(["pendente", "aprovado", "rejeitado"]) }))
      .handler(async ({ input }) => {
        await db.update(absences).set({ status: input.status }).where(eq(absences.id, input.id));
        return { ok: true };
      }),
    remove: authed.input(idInput).handler(async ({ input, context }) => {
      if (context.role === "vendedor") {
        await db
          .delete(absences)
          .where(and(eq(absences.id, input.id), eq(absences.employeeId, context.employeeId ?? -1), eq(absences.status, "pendente")));
      } else if (context.role === "chefe") {
        const ids = await teamScopeIds(context);
        await db
          .delete(absences)
          .where(and(eq(absences.id, input.id), inArray(absences.employeeId, ids.length ? ids : [-1]), eq(absences.status, "pendente")));
      } else {
        await db.delete(absences).where(eq(absences.id, input.id));
      }
      return { ok: true };
    }),
  },
};
