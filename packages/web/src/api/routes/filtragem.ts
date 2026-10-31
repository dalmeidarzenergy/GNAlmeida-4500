import { z } from "zod";
import { asc, inArray } from "drizzle-orm";
import { requireView } from "../middleware/auth";
import { db } from "../database";
import { sales, employees, iberdrolaImports, iberdrolaRows, teams, teamMemberships } from "../database/schema";

/** Filtros da aba Filtragem. Todas as listas são multi-seleção e combinam-se com E lógico
 *  (só passam as vendas que satisfaçam TODOS os filtros preenchidos). Lista vazia = filtro
 *  não aplicado. */
const filterInput = z.object({
  /** Fonte dos dados: vendas dos autos Iberdrola carregados, ou base de vendas do CRM. */
  source: z.enum(["autos", "crm"]).default("autos"),
  /** Mês dos autos (YYYY-MM). Só usado quando source = "autos". Vazio = todos os meses. */
  month: z.string().optional(),
  /** Intervalo de datas (YYYY-MM-DD). Em falta = sem limite desse lado. */
  from: z.string().optional(),
  to: z.string().optional(),
  /** Vários colaboradores (ids). Vazio = todos. */
  employeeIds: z.array(z.number().int().positive()).default([]),
  /** Vários estados (ex.: Baixa, Em Fornecimento). Vazio = todos. */
  statuses: z.array(z.string()).default([]),
  /** Vários serviços (LUZ, GÁS, DUAL, SOLAR). Vazio = todos. */
  services: z.array(z.string()).default([]),
  /** Várias equipas (ids). Vazio = todas. */
  teamIds: z.array(z.number().int().positive()).default([]),
  /** Pesquisa livre pelo ID de venda, cliente ou colaborador. */
  q: z.string().trim().max(120).optional(),
});

const normService = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

/** Contagens por chave, do maior para o menor. */
function tally<T>(items: T[], key: (x: T) => string | null | undefined) {
  const map = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    if (!k) continue;
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

/** Normaliza um nome para casar o texto do Excel com o nome do funcionário no CRM. */
const normName = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

type Item = {
  id: string;
  idVenda: string;
  employeeId: number | null;
  employeeName: string;
  clientName: string | null;
  date: string;
  status: string;
  service: string;
  month: string | null;
};

export const filtragemRoute = {
  /** Opções que alimentam os filtros: colaboradores, meses carregados, estados e equipas. */
  options: requireView("filtragem").handler(async () => {
    const staff = await db
      .select({ id: employees.id, name: employees.name })
      .from(employees)
      .orderBy(asc(employees.name));

    const imp = await db.select().from(iberdrolaImports);
    const months = [...new Set(imp.map((i) => i.month))].filter(Boolean).sort();

    // Estados que existem de facto em cada fonte.
    const autoRows = await db.selectDistinct({ estado: iberdrolaRows.estado }).from(iberdrolaRows);
    const autoStatuses = autoRows.map((r) => r.estado).filter((s): s is string => !!s).sort();

    const crmRows = await db.selectDistinct({ status: sales.status }).from(sales);
    const salesStatuses = crmRows.map((r) => r.status).filter(Boolean).sort();

    const teamList = await db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .orderBy(asc(teams.name));

    return { employees: staff, months, autoStatuses, salesStatuses, teams: teamList };
  }),

  /** Corre os filtros e devolve o total, a lista detalhada e os agrupamentos dos gráficos. */
  run: requireView("filtragem")
    .input(filterInput)
    .handler(async ({ input }) => {
      const inRange = (raw: string | null | undefined) => {
        if (!raw) return true;
        const day = raw.slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return true;
        if (input.from && day < input.from) return false;
        if (input.to && day > input.to) return false;
        return true;
      };

      // Colaboradores que pertencem às equipas escolhidas (filtro por equipa).
      let teamMemberIds: Set<number> | null = null;
      if (input.teamIds.length) {
        const members = await db
          .select({ employeeId: teamMemberships.employeeId })
          .from(teamMemberships)
          .where(inArray(teamMemberships.teamId, input.teamIds));
        teamMemberIds = new Set(members.map((m) => m.employeeId));
      }

      const items: Item[] = [];

      if (input.source === "autos") {
        const imp = await db.select().from(iberdrolaImports);
        const impById = new Map(imp.map((i) => [i.id, i]));
        const wanted = input.month ? imp.filter((i) => i.month === input.month).map((i) => i.id) : imp.map((i) => i.id);
        if (!wanted.length) {
          return { total: 0, rows: [], byStatus: [], byEmployee: [], byMonth: [], byService: [] };
        }
        const rows = await db.select().from(iberdrolaRows).where(inArray(iberdrolaRows.importId, wanted));

        const staff = await db.select({ id: employees.id, name: employees.name }).from(employees);
        const idByName = new Map(staff.map((s) => [normName(s.name), s.id]));

        for (const r of rows) {
          const data = (r.data ?? {}) as Record<string, unknown>;
          const str = (k: string) => {
            const v = data[k];
            return v == null ? null : String(v).trim();
          };
          // A ID do comercial vem em coluna; casa-se com o funcionário pelo nome normalizado.
          const rawComercial = str("comercial");
          const employeeId = rawComercial ? (idByName.get(normName(rawComercial)) ?? null) : null;
          const label = r.sheet === "chargeback" ? "Baixa" : null;

          items.push({
            id: `${r.importId}-${r.id}`,
            idVenda: r.idVenda ?? "—",
            employeeId,
            employeeName: rawComercial ?? "—",
            clientName: str("cliente") ?? str("titular") ?? str("nome do cliente"),
            date: str("data") ?? str("data de venda") ?? "",
            status: r.estado ?? label ?? "—",
            service: normService(str("serviço") ?? str("servico") ?? str("tipo")),
            month: impById.get(r.importId)?.month ?? null,
          });
        }
      } else {
        const rows = await db
          .select({
            id: sales.id,
            number: sales.number,
            sellerId: sales.sellerId,
            date: sales.date,
            status: sales.status,
            service: sales.service,
          })
          .from(sales);

        const staff = await db.select({ id: employees.id, name: employees.name }).from(employees);
        const nameById = new Map(staff.map((s) => [s.id, s.name]));

        for (const r of rows) {
          items.push({
            id: String(r.id),
            idVenda: r.number,
            employeeId: r.sellerId ?? null,
            employeeName: r.sellerId ? (nameById.get(r.sellerId) ?? "—") : "—",
            clientName: null,
            date: r.date,
            status: r.status,
            service: normService(r.service),
            month: r.date ? r.date.slice(0, 7) : null,
          });
        }
      }

      const needle = input.q ? input.q.toLowerCase() : null;

      // Todos os filtros combinam-se com E lógico.
      const out = items.filter((it) => {
        if (!inRange(it.date)) return false;
        if (input.statuses.length && !input.statuses.includes(it.status)) return false;
        if (input.services.length && !input.services.includes(it.service)) return false;
        if (input.employeeIds.length && (it.employeeId == null || !input.employeeIds.includes(it.employeeId))) return false;
        if (teamMemberIds && (it.employeeId == null || !teamMemberIds.has(it.employeeId))) return false;
        if (needle) {
          const hay = `${it.idVenda} ${it.clientName ?? ""} ${it.employeeName}`.toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      });

      return {
        total: out.length,
        rows: out.map((r) => ({
          id: r.id,
          idVenda: r.idVenda,
          employeeName: r.employeeName,
          clientName: r.clientName,
          date: r.date,
          status: r.status,
          service: r.service,
          month: r.month,
        })),
        byStatus: tally(out, (x) => x.status),
        byEmployee: tally(out, (x) => x.employeeName),
        byMonth: tally(out, (x) => x.month ?? (x.date ? x.date.slice(0, 7) : null)),
        byService: tally(out, (x) => x.service || null),
      };
    }),
};
