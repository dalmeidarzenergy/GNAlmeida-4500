import { z } from "zod";
import { asc, inArray } from "drizzle-orm";
import { requireView } from "../middleware/auth";
import { db } from "../database";
import {
  sales,
  employees,
  iberdrolaImports,
  iberdrolaRows,
  teams,
  teamMemberships,
  saleStatusHistory,
  iberdrolaOverrides,
} from "../database/schema";

/**
 * Filtros da aba Filtragem. Todas as listas sao multi-selecao e combinam-se com E logico
 * (so passam as vendas que satisfacam TODOS os filtros preenchidos). Lista vazia = filtro
 * nao aplicado.
 */
const filterInput = z.object({
  /** Fonte dos dados: vendas dos autos Iberdrola carregados, ou base de vendas do CRM. */
  source: z.enum(["autos", "crm"]).default("autos"),
  /** Mes dos autos (YYYY-MM). So usado quando source = "autos". Vazio = todos os meses. */
  month: z.string().optional(),
  /** A que data se aplica o intervalo De/Ate. "venda" = data da venda (padrao),
   *  "estado" = data em que a venda mudou de estado (so fonte CRM). */
  dateMode: z.enum(["venda", "estado"]).default("venda"),
  /** Intervalo de datas (YYYY-MM-DD). Em falta = sem limite desse lado. */
  from: z.string().optional(),
  to: z.string().optional(),
  /** Varios colaboradores (ids). Vazio = todos. */
  employeeIds: z.array(z.number().int().positive()).default([]),
  /** Estados atuais da venda (ex.: Baixa, Em Fornecimento). Vazio = todos. */
  statuses: z.array(z.string()).default([]),
  /** Varios servicos (LUZ, GAS, DUAL, SOLAR). Vazio = todos. */
  services: z.array(z.string()).default([]),
  /** Varias equipas (ids). Vazio = todas. */
  teamIds: z.array(z.number().int().positive()).default([]),
  /** Pesquisa livre pelo ID de venda, cliente ou colaborador. */
  q: z.string().trim().max(120).optional(),

  /* ---------------- Historico de estados (so fonte CRM) ---------------- */

  /** Vendas que passaram por estes estados em ALGUMA data (mesmo que hoje ja nao estejam). */
  passedStatuses: z.array(z.string()).default([]),
  /** Vendas que ENTRARAM nestes estados dentro do intervalo De/Ate. */
  enteredStatuses: z.array(z.string()).default([]),
  /** Vendas que SAIRAM destes estados dentro do intervalo De/Ate. */
  leftStatuses: z.array(z.string()).default([]),
  /** Estados que a venda tinha exatamente NESSA data (foto do estado no fim do intervalo). */
  statusOnDate: z.array(z.string()).default([]),
  /** Historico de trocas de comercial: "com" = so vendas que mudaram de comercial,
   *  "sem" = so as que nunca mudaram. Vazio = indiferente. */
  swapped: z.enum(["com", "sem"]).optional(),
  /** Vendas que passaram por estes comerciais (quem cedeu numa troca). Vazio = todos. */
  fromEmployeeIds: z.array(z.number().int().positive()).default([]),
  /** Numero minimo de dias em qualquer estado, no intervalo (para achar vendas "presas"). */
  minDaysInStatus: z.number().min(0).optional(),
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

/** Normaliza um nome para casar o texto do Excel com o nome do funcionario no CRM. */
const normName = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Uma data ISO plausivel? Descarta lixo tipo "0009-02-20" que aparece em importacoes. */
const isSaneDate = (iso: string | null | undefined): boolean => {
  if (!iso) return false;
  const day = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const y = Number(day.slice(0, 4));
  return y >= 2000 && y <= 2100;
};

/** Dias inteiros entre duas datas ISO (YYYY-MM-DD). Negativo se a segunda for anterior. */
function daysBetween(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
  return Math.round((tb - ta) / 86400000);
}

/** Soma dias a uma data ISO. */
function addDays(iso: string, n: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t)) return iso;
  return new Date(t + n * 86400000).toISOString().slice(0, 10);
}

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
  /** Percurso completo de estados, no intervalo pedido (so CRM). */
  timeline: { status: string; on: string; days: number | null }[];
  /** Percurso completo, sem recorte ao intervalo (para o filtro "passou por"). */
  allStatuses: string[];
  /** Estado exato no fim do intervalo (so CRM, quando statusOnDate e usado). */
  statusAtDate: string | null;
  /** Dias no estado atual (desde a ultima mudanca). */
  daysInCurrent: number | null;
  /** Comerciais por que a venda passou (troca de venda). */
  fromEmployees: string[];
  swapped: boolean;
};

/**
 * Constroi a linha temporal de cada venda a partir do historico de estados.
 * Deduplica entradas consecutivas repetidas (o mesmo estado gravado varias vezes no
 * mesmo dia) porque de outra forma o tempo em cada estado sairia a zero.
 */
function buildTimelines(
  hist: { saleId: number; energy: string; status: string; changedOn: string; id: number }[],
) {
  const bySale = new Map<number, { status: string; on: string; id: number }[]>();
  for (const h of hist) {
    // Descarta datas corrompidas (ex.: "0009-02-20") — senao estragam as medias de dias.
    if (!isSaneDate(h.changedOn)) continue;
    const arr = bySale.get(h.saleId) ?? [];
    arr.push({ status: h.status, on: h.changedOn.slice(0, 10), id: h.id });
    bySale.set(h.saleId, arr);
  }
  const out = new Map<number, { status: string; on: string; days: number | null }[]>();
  for (const [saleId, arr] of bySale) {
    // Ordem cronologica; empates resolvidos pelo id (ordem em que foram gravados).
    arr.sort((a, b) => (a.on === b.on ? a.id - b.id : a.on < b.on ? -1 : 1));
    // Remove repeticoes consecutivas do mesmo estado (mesmo dia ou gravacoes duplicadas).
    const compact: { status: string; on: string }[] = [];
    for (const h of arr) {
      const last = compact[compact.length - 1];
      if (last && last.status === h.status) continue;
      compact.push({ status: h.status, on: h.on });
    }
    const tl: { status: string; on: string; days: number | null }[] = [];
    for (let i = 0; i < compact.length; i++) {
      const cur = compact[i];
      const next = compact[i + 1];
      // So conta dias quando ha uma mudanca seguinte dentro do historico.
      const days = next ? Math.max(0, daysBetween(cur.on, next.on)) : null;
      tl.push({ status: cur.status, on: cur.on, days });
    }
    out.set(saleId, tl);
  }
  return out;
}

/** Recorta as linhas temporais ao intervalo pedido, mantendo o estado de entrada em `beforeZero`. */
function cropTimelines(
  tls: Map<number, { status: string; on: string; days: number | null }[]>,
  from?: string,
  to?: string,
) {
  const out = new Map<number, { status: string; on: string; days: number | null }[]>();
  for (const [saleId, tl] of tls) {
    const cropped = tl.filter((s) => (!from || s.on >= from) && (!to || s.on <= to));
    out.set(saleId, cropped);
  }
  return out;
}

export const filtragemRoute = {
  /** Opcoes que alimentam os filtros: colaboradores, meses carregados, estados e equipas. */
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

    // Estados que ja existiram no historico (podem ja nao estar em uso).
    const histRows = await db.selectDistinct({ status: saleStatusHistory.status }).from(saleStatusHistory);
    const historyStatuses = histRows.map((r) => r.status).filter(Boolean).sort();

    const teamList = await db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .orderBy(asc(teams.name));

    return { employees: staff, months, autoStatuses, salesStatuses, historyStatuses, teams: teamList };
  }),

  /** Corre os filtros e devolve o total, a lista detalhada e os agrupamentos dos graficos. */
  run: requireView("filtragem")
    .input(filterInput)
    .handler(async ({ input }) => {
      const empty = {
        total: 0,
        rows: [],
        byStatus: [],
        byEmployee: [],
        byMonth: [],
        byService: [],
        byDays: [],
      };

      /** Aplica o intervalo de datas a uma data, conforme o modo escolhido. */
      const inRange = (raw: string | null | undefined) => {
        if (!raw) return true;
        const day = raw.slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return true;
        if (input.from && day < input.from) return false;
        if (input.to && day > input.to) return false;
        return true;
      };

      // Nomes dos colaboradores — usado no filtro "quem cedeu" (a troca guarda o id).
      const crmStaff = await db.select({ id: employees.id, name: employees.name }).from(employees);
      const nameByIdRef = new Map(crmStaff.map((s) => [s.id, s.name]));

      // Colaboradores que pertencem as equipas escolhidas (filtro por equipa).
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
        if (!wanted.length) return empty;
        const rows = await db.select().from(iberdrolaRows).where(inArray(iberdrolaRows.importId, wanted));

        const staff = await db.select({ id: employees.id, name: employees.name }).from(employees);
        const idByName = new Map(staff.map((s) => [normName(s.name), s.id]));

        for (const r of rows) {
          const data = (r.data ?? {}) as Record<string, unknown>;
          const str = (k: string) => {
            const v = data[k];
            return v == null ? null : String(v).trim();
          };
          // A ID do comercial vem em coluna; casa-se com o funcionario pelo nome normalizado.
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
            timeline: [],
            allStatuses: [],
            statusAtDate: null,
            daysInCurrent: null,
            fromEmployees: [],
            swapped: false,
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

        const nameById = nameByIdRef;
        const hist = await db
          .select({
            id: saleStatusHistory.id,
            saleId: saleStatusHistory.saleId,
            energy: saleStatusHistory.energy,
            status: saleStatusHistory.status,
            changedOn: saleStatusHistory.changedOn,
          })
          .from(saleStatusHistory);
        const timelines = buildTimelines(hist);
        // Versao recortada ao intervalo, usada para mostrar o percurso e medir dias.
        const croppedTimelines = cropTimelines(timelines, input.from, input.to);
        // Trocas de comercial: cruza pelo id de venda dos autos (iberdrola_overrides.idVenda).
        const swaps = await db.select().from(iberdrolaOverrides);
        const swapsByIdVenda = new Map<string, typeof swaps>();
        for (const s of swaps) {
          const arr = swapsByIdVenda.get(s.idVenda) ?? [];
          arr.push(s);
          swapsByIdVenda.set(s.idVenda, arr);
        }

        for (const r of rows) {
          const full = timelines.get(r.id) ?? [];
          // Percurso mostrado/medido: so o que caiu dentro do intervalo De/Ate.
          const tl = croppedTimelines.get(r.id) ?? full;
          const saleSwaps = swapsByIdVenda.get(r.number) ?? [];
          const fromEmployees = [
            ...new Set(saleSwaps.map((s) => nameById.get(s.fromEmployeeId) ?? `#${s.fromEmployeeId}`)),
          ];

          // Estado exato a essa data: ultimo estado registado ate ao fim do intervalo,
          // lido da linha temporal COMPLETA (o recorte perderia o estado em que entrou).
          let statusAtDate: string | null = null;
          if (input.statusOnDate.length) {
            if (input.dateMode === "estado" && input.to) {
              const upto = full.filter((s) => s.on <= input.to!);
              statusAtDate = upto.length ? upto[upto.length - 1].status : null;
            } else {
              statusAtDate = r.status;
            }
          }

          // Dias no estado atual: da ultima mudanca ate `to` (ou hoje). Limitado a 730 dias
          // para uma venda antiga sempre em fornecimento nao distorcer a media.
          const last = tl.length ? tl[tl.length - 1] : null;
          const refDay = input.to ?? new Date().toISOString().slice(0, 10);
          const daysInCurrent = last ? Math.min(730, Math.max(0, daysBetween(last.on, refDay))) : null;

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
            timeline: tl,
            allStatuses: [...new Set([...full.map((x) => x.status), r.status])],
            statusAtDate,
            daysInCurrent,
            fromEmployees,
            swapped: saleSwaps.length > 0,
          });
        }
      }

      const needle = input.q ? input.q.toLowerCase() : null;

      // Todos os filtros combinam-se com E logico.
      const out = items.filter((it) => {
        // Intervalo de datas: na data da venda ou na data da mudanca de estado.
        if (input.dateMode === "estado" && input.source === "crm") {
          if ((input.from || input.to) && !it.timeline.length) return false;
        } else if (!inRange(it.date)) {
          return false;
        }
        if (input.statuses.length && !input.statuses.includes(it.status)) return false;
        if (input.services.length && !input.services.includes(it.service)) return false;
        if (input.employeeIds.length && (it.employeeId == null || !input.employeeIds.includes(it.employeeId))) return false;
        if (teamMemberIds && (it.employeeId == null || !teamMemberIds.has(it.employeeId))) return false;
        if (needle) {
          const hay = `${it.idVenda} ${it.clientName ?? ""} ${it.employeeName}`.toLowerCase();
          if (!hay.includes(needle)) return false;
        }

        /* -------------------- Historico de estados -------------------- */

        // Passou por algum destes estados (em qualquer data, mesmo fora do intervalo).
        if (input.passedStatuses.length) {
          const seen = new Set(it.allStatuses);
          if (!input.passedStatuses.some((s) => seen.has(s))) return false;
        }

        // Entrou num destes estados dentro do intervalo.
        if (input.enteredStatuses.length) {
          const hit = it.timeline.some((s) => input.enteredStatuses.includes(s.status));
          if (!hit) return false;
        }

        // Saiu de um destes estados dentro do intervalo: o estado aparece antes de outra mudanca.
        if (input.leftStatuses.length) {
          const hit = it.timeline.some((s, i) => input.leftStatuses.includes(s.status) && i < it.timeline.length - 1);
          if (!hit) return false;
        }

        // Estado exato nessa data.
        if (input.statusOnDate.length) {
          if (it.statusAtDate == null || !input.statusOnDate.includes(it.statusAtDate)) return false;
        }

        // Trocas de comercial.
        if (input.swapped === "com" && !it.swapped) return false;
        if (input.swapped === "sem" && it.swapped) return false;
        if (input.fromEmployeeIds.length) {
          const names = new Set(it.fromEmployees.map(normName));
          const wanted = input.fromEmployeeIds.map((id) => normName(nameByIdRef.get(id) ?? ""));
          if (!wanted.some((w) => w && names.has(w))) return false;
        }

        // Minimo de dias em qualquer estado.
        if (input.minDaysInStatus != null && input.minDaysInStatus > 0) {
          const maxDays = it.timeline.reduce((m, s) => Math.max(m, s.days ?? 0), 0);
          if (maxDays < input.minDaysInStatus) return false;
        }

        return true;
      });

      // Grafico de tempo em cada estado: media e total de dias por estado.
      const daysByStatus = new Map<string, { total: number; n: number }>();
      for (const it of out) {
        for (const s of it.timeline) {
          if (s.days == null) continue;
          const cur = daysByStatus.get(s.status) ?? { total: 0, n: 0 };
          cur.total += s.days;
          cur.n += 1;
          daysByStatus.set(s.status, cur);
        }
      }

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
          timeline: r.timeline,
          allStatuses: r.allStatuses,
          statusAtDate: r.statusAtDate,
          daysInCurrent: r.daysInCurrent,
          fromEmployees: r.fromEmployees,
          swapped: r.swapped,
        })),
        byStatus: tally(out, (x) => x.status),
        byEmployee: tally(out, (x) => x.employeeName),
        byMonth: tally(out, (x) => x.month ?? (x.date ? x.date.slice(0, 7) : null)),
        byService: tally(out, (x) => x.service || null),
        byDays: [...daysByStatus.entries()]
          .map(([name, v]) => ({ name, days: Math.round((v.total / v.n) * 10) / 10, samples: v.n }))
          .sort((a, b) => b.days - a.days),
      };
    }),
};
