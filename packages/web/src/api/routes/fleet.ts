import { z } from "zod";
import { ORPCError } from "@orpc/server";
import { desc, eq, inArray } from "drizzle-orm";
import { authed, requireEdit, requireView } from "../middleware/auth";
import { db } from "../database";
import {
  employees, fleetCards, fleetDocuments, fuelEntries, vehicleMaintenance, vehicleReadings, vehicles,
} from "../database/schema";
import { writePublic } from "../lib/public-files";

const idInput = z.object({ id: z.number() });

const VEHICLE_STATUS = ["ativo", "manutencao", "inativo"] as const;
const CARD_STATUS = ["ativo", "inativo"] as const;
const DOC_KINDS = ["livrete", "seguro", "inspecao", "contrato", "fatura", "outro"] as const;
const MAINT_KINDS = ["revisao", "pneus", "inspecao", "reparacao", "oleo", "outro"] as const;
const MAINT_STATUS = ["agendada", "em_curso", "concluida"] as const;
const READ_SOURCES = ["manual", "inspecao", "manutencao", "abastecimento", "importacao"] as const;
/** Consumos de cartao: combustivel, carregamento eletrico, portagem ou outro. */
const FUEL_KINDS = ["combustivel", "eletricidade", "portagem", "outro"] as const;

const vehicleInput = z.object({
  plate: z.string().min(1),
  brand: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  year: z.number().int().nullable().optional(),
  fuel: z.string().nullable().optional(),
  km: z.number().int().min(0).default(0),
  employeeId: z.number().nullable().optional(),
  status: z.enum(VEHICLE_STATUS).default("ativo"),
  notes: z.string().nullable().optional(),
});

const cardInput = z.object({
  provider: z.string().min(1),
  number: z.string().min(1),
  pin: z.string().nullable().optional(),
  vehicleId: z.number().nullable().optional(),
  employeeId: z.number().nullable().optional(),
  monthlyLimit: z.number().min(0).default(0),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  status: z.enum(CARD_STATUS).default("ativo"),
  notes: z.string().nullable().optional(),
});

/** Ficheiros ate 12 MB (base64). Acima disto o corpo do pedido fica enorme. */
const MAX_UPLOAD = 12 * 1024 * 1024;

function decodeUpload(content: string, fallbackMime: string) {
  const m = content.match(/^data:([^;]+);base64,/);
  if (!m) throw new ORPCError("BAD_REQUEST", { message: "Ficheiro inválido." });
  const mime = m[1] || fallbackMime;
  const buf = Buffer.from(content.slice(m[0].length), "base64");
  if (buf.byteLength > MAX_UPLOAD) {
    throw new ORPCError("BAD_REQUEST", { message: "Ficheiro demasiado grande (máximo 12 MB)." });
  }
  return { mime, buf };
}

function safeExt(mime: string, name: string) {
  const fromName = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (fromName && /^[a-z0-9]{1,6}$/.test(fromName)) return fromName;
  const map: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
  };
  return map[mime] ?? "bin";
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateField = z.string().regex(DATE_RE, "Data inválida (use AAAA-MM-DD).");

/** Km lidos de uma viatura, do mais recente para o mais antigo. */
function readingsOf(vehicleId: number) {
  return db
    .select({
      id: vehicleReadings.id,
      vehicleId: vehicleReadings.vehicleId,
      recordedOn: vehicleReadings.recordedOn,
      km: vehicleReadings.km,
      employeeId: vehicleReadings.employeeId,
      employeeName: employees.name,
      source: vehicleReadings.source,
      entryId: vehicleReadings.entryId,
      notes: vehicleReadings.notes,
      createdAt: vehicleReadings.createdAt,
    })
    .from(vehicleReadings)
    .leftJoin(employees, eq(employees.id, vehicleReadings.employeeId))
    .where(eq(vehicleReadings.vehicleId, vehicleId))
    .orderBy(desc(vehicleReadings.recordedOn), desc(vehicleReadings.id));
}

/**
 * Sincroniza `vehicles.km` com a leitura mais recente.
 * A quilometragem da viatura nunca anda para tras: se uma leitura antiga
 * chegar depois da atual (importação fora de ordem), nao a estraga.
 */
async function syncVehicleKm(vehicleId: number) {
  const rows = await readingsOf(vehicleId);
  const latest = rows[0];
  if (!latest) return;
  const [v] = await db.select({ km: vehicles.km }).from(vehicles).where(eq(vehicles.id, vehicleId));
  if (!v) return;
  // Leitura mais recente com km maior, ou a viatura nunca teve km registados.
  const best = rows.reduce((a, b) => (b.km > a.km ? b : a), latest);
  if (latest.km >= v.km) await db.update(vehicles).set({ km: latest.km }).where(eq(vehicles.id, vehicleId));
  else if (best.km > v.km) await db.update(vehicles).set({ km: best.km }).where(eq(vehicles.id, vehicleId));
}

/**
 * Alinha a leitura gerada por um consumo de cartao com o que esta gravado:
 * cria se tem km, atualiza se mudou, apaga se o km foi limpo. Um consumo sem
 * viatura nao deixa leitura nenhuma para tras.
 */
async function readFromEntry(entryId: number) {
  const [e] = await db.select().from(fuelEntries).where(eq(fuelEntries.id, entryId));
  const [read] = await db.select().from(vehicleReadings).where(eq(vehicleReadings.entryId, entryId));
  if (!e) return;
  const temKm = e.km != null && e.vehicleId != null;
  if (!temKm) {
    if (read) await db.delete(vehicleReadings).where(eq(vehicleReadings.entryId, entryId));
    return;
  }
  const vals = {
    vehicleId: e.vehicleId!,
    recordedOn: e.spentOn,
    km: e.km!,
    employeeId: e.employeeId ?? null,
    source: "abastecimento" as const,
    entryId,
    notes: "Km do abastecimento",
  };
  if (read) {
    const antigo = read.vehicleId;
    await db.update(vehicleReadings).set(vals).where(eq(vehicleReadings.entryId, entryId));
    if (antigo !== vals.vehicleId) await syncVehicleKm(antigo);
  } else {
    await db.insert(vehicleReadings).values(vals);
  }
  await syncVehicleKm(vals.vehicleId);
}

/** Lista de viaturas com condutor, documentos e resumo de manutencao. */
function vehiclesWithPhotos() {
  return db
    .select({
      id: vehicles.id,
      plate: vehicles.plate,
      brand: vehicles.brand,
      model: vehicles.model,
      year: vehicles.year,
      fuel: vehicles.fuel,
      km: vehicles.km,
      employeeId: vehicles.employeeId,
      driverName: employees.name,
      status: vehicles.status,
      notes: vehicles.notes,
      createdAt: vehicles.createdAt,
    })
    .from(vehicles)
    .leftJoin(employees, eq(employees.id, vehicles.employeeId))
    .orderBy(vehicles.plate);
}

export const fleet = {
  vehicles: {
    list: requireView("frota").handler(async () => {
      const rows = await vehiclesWithPhotos();
      const docs = await db.select().from(fleetDocuments);
      const maint = await db
        .select({
          id: vehicleMaintenance.id,
          vehicleId: vehicleMaintenance.vehicleId,
          kind: vehicleMaintenance.kind,
          status: vehicleMaintenance.status,
          scheduledOn: vehicleMaintenance.scheduledOn,
          doneOn: vehicleMaintenance.doneOn,
          km: vehicleMaintenance.km,
          nextKm: vehicleMaintenance.nextKm,
          nextOn: vehicleMaintenance.nextOn,
          workshop: vehicleMaintenance.workshop,
          cost: vehicleMaintenance.cost,
          paidBy: vehicleMaintenance.paidBy,
          description: vehicleMaintenance.description,
          notes: vehicleMaintenance.notes,
          createdAt: vehicleMaintenance.createdAt,
        })
        .from(vehicleMaintenance)
        .orderBy(desc(vehicleMaintenance.scheduledOn));
      const readings = await db.select().from(vehicleReadings).orderBy(desc(vehicleReadings.recordedOn));
      return rows.map((v) => ({
        ...v,
        documents: docs.filter((d) => d.vehicleId === v.id),
        maintenance: maint.filter((m) => m.vehicleId === v.id),
        readings: readings.filter((r) => r.vehicleId === v.id),
      }));
    }),
    create: requireEdit("frota").input(vehicleInput).handler(async ({ input }) => {
      const [row] = await db.insert(vehicles).values({ ...input, plate: input.plate.trim().toUpperCase() }).returning();
      return row;
    }),
    update: requireEdit("frota").input(vehicleInput.extend({ id: z.number() })).handler(async ({ input }) => {
      const { id, ...data } = input;
      await db.update(vehicles).set({ ...data, plate: data.plate.trim().toUpperCase() }).where(eq(vehicles.id, id));
      // Se o km da ficha foi corrigido, fica registado como leitura do dia.
      const [cur] = await db.select({ km: vehicles.km }).from(vehicles).where(eq(vehicles.id, id));
      if (cur) {
        const latest = await readingsOf(id);
        if (!latest.length || latest[0]!.km !== cur.km) {
          await db.insert(vehicleReadings).values({
            vehicleId: id,
            recordedOn: new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" }),
            km: cur.km,
            employeeId: data.employeeId ?? null,
            source: "manual",
            notes: "Km corrigidos na ficha da viatura",
          });
        }
      }
      return { ok: true };
    }),
    remove: requireEdit("frota").input(idInput).handler(async ({ input }) => {
      await db.delete(fleetDocuments).where(eq(fleetDocuments.vehicleId, input.id));
      await db.delete(vehicleMaintenance).where(eq(vehicleMaintenance.vehicleId, input.id));
      await db.delete(vehicleReadings).where(eq(vehicleReadings.vehicleId, input.id));
      await db.delete(fuelEntries).where(eq(fuelEntries.vehicleId, input.id));
      await db.update(fleetCards).set({ vehicleId: null }).where(eq(fleetCards.vehicleId, input.id));
      await db.delete(vehicles).where(eq(vehicles.id, input.id));
      return { ok: true };
    }),
  },

  /** Registos de quilómetros por viatura. */
  readings: {
    list: requireView("frota")
      .input(z.object({ vehicleId: z.number() }))
      .handler(async ({ input }) => readingsOf(input.vehicleId)),
    create: requireEdit("frota")
      .input(
        z.object({
          vehicleId: z.number(),
          recordedOn: dateField,
          km: z.number().int().min(0),
          employeeId: z.number().nullable().optional(),
          source: z.enum(READ_SOURCES).default("manual"),
          notes: z.string().nullable().optional(),
        }),
      )
      .handler(async ({ input }) => {
        const [v] = await db.select({ km: vehicles.km }).from(vehicles).where(eq(vehicles.id, input.vehicleId));
        if (!v) throw new ORPCError("NOT_FOUND", { message: "Viatura não encontrada." });
        const [row] = await db.insert(vehicleReadings).values(input).returning();
        await syncVehicleKm(input.vehicleId);
        return row;
      }),
    update: requireEdit("frota")
      .input(
        z.object({
          id: z.number(),
          recordedOn: dateField,
          km: z.number().int().min(0),
          employeeId: z.number().nullable().optional(),
          source: z.enum(READ_SOURCES).default("manual"),
          notes: z.string().nullable().optional(),
        }),
      )
      .handler(async ({ input }) => {
        const { id, ...data } = input;
        const [prev] = await db.select({ vehicleId: vehicleReadings.vehicleId }).from(vehicleReadings).where(eq(vehicleReadings.id, id));
        if (!prev) throw new ORPCError("NOT_FOUND", { message: "Registo não encontrado." });
        await db.update(vehicleReadings).set(data).where(eq(vehicleReadings.id, id));
        await syncVehicleKm(prev.vehicleId);
        return { ok: true };
      }),
    remove: requireEdit("frota").input(idInput).handler(async ({ input }) => {
      const [prev] = await db.select({ vehicleId: vehicleReadings.vehicleId }).from(vehicleReadings).where(eq(vehicleReadings.id, input.id));
      await db.delete(vehicleReadings).where(eq(vehicleReadings.id, input.id));
      if (prev) await syncVehicleKm(prev.vehicleId);
      return { ok: true };
    }),
  },

  /** Manutenções e intervenções. */
  maintenance: {
    list: requireView("frota")
      .input(z.object({ vehicleId: z.number().optional() }).optional())
      .handler(async ({ input }) => {
        const rows = await db
          .select()
          .from(vehicleMaintenance)
          .orderBy(desc(vehicleMaintenance.scheduledOn), desc(vehicleMaintenance.id));
        return input?.vehicleId == null ? rows : rows.filter((m) => m.vehicleId === input.vehicleId);
      }),
    create: requireEdit("frota")
      .input(
        z.object({
          vehicleId: z.number(),
          kind: z.enum(MAINT_KINDS).default("revisao"),
          status: z.enum(MAINT_STATUS).default("agendada"),
          scheduledOn: dateField.nullable().optional(),
          doneOn: dateField.nullable().optional(),
          km: z.number().int().min(0).nullable().optional(),
          nextKm: z.number().int().min(0).nullable().optional(),
          nextOn: dateField.nullable().optional(),
          workshop: z.string().nullable().optional(),
          cost: z.number().min(0).default(0),
          paidBy: z.string().nullable().optional(),
          description: z.string().nullable().optional(),
          notes: z.string().nullable().optional(),
        }),
      )
      .handler(async ({ input }) => {
        const [v] = await db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, input.vehicleId));
        if (!v) throw new ORPCError("NOT_FOUND", { message: "Viatura não encontrada." });
        const [row] = await db.insert(vehicleMaintenance).values(input).returning();
        return row;
      }),
    update: requireEdit("frota")
      .input(
        z.object({
          id: z.number(),
          kind: z.enum(MAINT_KINDS).default("revisao"),
          status: z.enum(MAINT_STATUS).default("agendada"),
          scheduledOn: dateField.nullable().optional(),
          doneOn: dateField.nullable().optional(),
          km: z.number().int().min(0).nullable().optional(),
          nextKm: z.number().int().min(0).nullable().optional(),
          nextOn: dateField.nullable().optional(),
          workshop: z.string().nullable().optional(),
          cost: z.number().min(0).default(0),
          paidBy: z.string().nullable().optional(),
          description: z.string().nullable().optional(),
          notes: z.string().nullable().optional(),
        }),
      )
      .handler(async ({ input }) => {
        const { id, ...data } = input;
        const [prevM] = await db.select({ vehicleId: vehicleMaintenance.vehicleId }).from(vehicleMaintenance).where(eq(vehicleMaintenance.id, id));
        await db.update(vehicleMaintenance).set(data).where(eq(vehicleMaintenance.id, id));
        // Um serviço concluído deixa o km da viatura alinhado com o da intervenção.
        if (prevM && data.status === "concluida" && data.km != null) {
          await db.update(vehicles).set({ km: data.km }).where(eq(vehicles.id, prevM.vehicleId));
        }
        if (prevM) await syncVehicleKm(prevM.vehicleId);
        return { ok: true };
      }),
    remove: requireEdit("frota").input(idInput).handler(async ({ input }) => {
      await db.delete(fleetDocuments).where(eq(fleetDocuments.maintenanceId, input.id));
      await db.delete(vehicleMaintenance).where(eq(vehicleMaintenance.id, input.id));
      return { ok: true };
    }),
  },

  /**
   * Consumos dos cartoes frota: abastecimentos, carregamentos, portagens.
   * Um consumo com km regista tambem uma leitura na viatura (origem
   * "abastecimento"), para a quilometragem andar sozinha.
   */
  fuel: {
    list: requireView("frota")
      .input(z.object({ cardId: z.number().optional(), vehicleId: z.number().optional() }).optional())
      .handler(async ({ input }) => {
        let rows = await db
          .select({
            id: fuelEntries.id,
            cardId: fuelEntries.cardId,
            vehicleId: fuelEntries.vehicleId,
            employeeId: fuelEntries.employeeId,
            spentOn: fuelEntries.spentOn,
            kind: fuelEntries.kind,
            liters: fuelEntries.liters,
            pricePerL: fuelEntries.pricePerL,
            amount: fuelEntries.amount,
            km: fuelEntries.km,
            station: fuelEntries.station,
            notes: fuelEntries.notes,
            createdAt: fuelEntries.createdAt,
            cardProvider: fleetCards.provider,
            cardNumber: fleetCards.number,
            plate: vehicles.plate,
            employeeName: employees.name,
          })
          .from(fuelEntries)
          .leftJoin(fleetCards, eq(fleetCards.id, fuelEntries.cardId))
          .leftJoin(vehicles, eq(vehicles.id, fuelEntries.vehicleId))
          .leftJoin(employees, eq(employees.id, fuelEntries.employeeId))
          .orderBy(desc(fuelEntries.spentOn), desc(fuelEntries.id));
        if (input?.cardId != null) rows = rows.filter((r) => r.cardId === input.cardId);
        if (input?.vehicleId != null) rows = rows.filter((r) => r.vehicleId === input.vehicleId);
        return rows;
      }),
    create: requireEdit("frota")
      .input(
        z.object({
          cardId: z.number().nullable().optional(),
          vehicleId: z.number().nullable().optional(),
          employeeId: z.number().nullable().optional(),
          spentOn: dateField,
          kind: z.enum(FUEL_KINDS).default("combustivel"),
          liters: z.number().min(0).default(0),
          pricePerL: z.number().min(0).default(0),
          amount: z.number().min(0).default(0),
          km: z.number().int().min(0).nullable().optional(),
          station: z.string().nullable().optional(),
          notes: z.string().nullable().optional(),
        }),
      )
      .handler(async ({ input }) => {
        if (input.cardId == null && input.vehicleId == null) {
          throw new ORPCError("BAD_REQUEST", { message: "Escolha o cartão ou a viatura do consumo." });
        }
        const [row] = await db.insert(fuelEntries).values(input).returning();
        await readFromEntry(row!.id);
        return row;
      }),
    update: requireEdit("frota")
      .input(
        z.object({
          id: z.number(),
          cardId: z.number().nullable().optional(),
          vehicleId: z.number().nullable().optional(),
          employeeId: z.number().nullable().optional(),
          spentOn: dateField,
          kind: z.enum(FUEL_KINDS).default("combustivel"),
          liters: z.number().min(0).default(0),
          pricePerL: z.number().min(0).default(0),
          amount: z.number().min(0).default(0),
          km: z.number().int().min(0).nullable().optional(),
          station: z.string().nullable().optional(),
          notes: z.string().nullable().optional(),
        }),
      )
      .handler(async ({ input }) => {
        const { id, ...data } = input;
        const [prev] = await db.select({ vehicleId: fuelEntries.vehicleId }).from(fuelEntries).where(eq(fuelEntries.id, id));
        await db.update(fuelEntries).set(data).where(eq(fuelEntries.id, id));
        await readFromEntry(id);
        if (prev?.vehicleId != null) await syncVehicleKm(prev.vehicleId);
        if (data.vehicleId != null && data.vehicleId !== prev?.vehicleId) await syncVehicleKm(data.vehicleId);
        return { ok: true };
      }),
    remove: requireEdit("frota").input(idInput).handler(async ({ input }) => {
      const [prev] = await db.select({ vehicleId: fuelEntries.vehicleId }).from(fuelEntries).where(eq(fuelEntries.id, input.id));
      await db.delete(fleetDocuments).where(eq(fleetDocuments.entryId, input.id));
      await db.delete(vehicleReadings).where(eq(vehicleReadings.entryId, input.id));
      await db.delete(fuelEntries).where(eq(fuelEntries.id, input.id));
      if (prev?.vehicleId != null) await syncVehicleKm(prev.vehicleId);
      return { ok: true };
    }),
  },

  cards: {
    list: requireView("frota").handler(async () => {
      const rows = await db
        .select({
          id: fleetCards.id,
          provider: fleetCards.provider,
          number: fleetCards.number,
          pin: fleetCards.pin,
          vehicleId: fleetCards.vehicleId,
          employeeId: fleetCards.employeeId,
          monthlyLimit: fleetCards.monthlyLimit,
          startDate: fleetCards.startDate,
          endDate: fleetCards.endDate,
          status: fleetCards.status,
          notes: fleetCards.notes,
          createdAt: fleetCards.createdAt,
          plate: vehicles.plate,
          holderName: employees.name,
        })
        .from(fleetCards)
        .leftJoin(vehicles, eq(vehicles.id, fleetCards.vehicleId))
        .leftJoin(employees, eq(employees.id, fleetCards.employeeId))
        .orderBy(fleetCards.provider, fleetCards.number);
      const docs = await db.select().from(fleetDocuments);
      return rows.map((c) => ({ ...c, documents: docs.filter((d) => d.cardId === c.id) }));
    }),
    create: requireEdit("frota").input(cardInput).handler(async ({ input }) => {
      const [row] = await db.insert(fleetCards).values(input).returning();
      return row;
    }),
    update: requireEdit("frota").input(cardInput.extend({ id: z.number() })).handler(async ({ input }) => {
      const { id, ...data } = input;
      await db.update(fleetCards).set(data).where(eq(fleetCards.id, id));
      return { ok: true };
    }),
    remove: requireEdit("frota").input(idInput).handler(async ({ input }) => {
      await db.delete(fleetDocuments).where(eq(fleetDocuments.cardId, input.id));
      await db.delete(fuelEntries).where(eq(fuelEntries.cardId, input.id));
      await db.delete(fleetCards).where(eq(fleetCards.id, input.id));
      return { ok: true };
    }),
  },

  documents: {
    list: requireView("frota")
      .input(
        z
          .object({
            vehicleId: z.number().optional(),
            cardId: z.number().optional(),
            maintenanceId: z.number().optional(),
            entryId: z.number().optional(),
          })
          .optional(),
      )
      .handler(async ({ input }) => {
        const vid = input?.vehicleId;
        const cid = input?.cardId;
        const mid = input?.maintenanceId;
        const eid = input?.entryId;
        const rows = await db.select().from(fleetDocuments);
        if (vid == null && cid == null && mid == null && eid == null) return rows;
        return rows.filter(
          (d) =>
            (vid != null && d.vehicleId === vid) ||
            (cid != null && d.cardId === cid) ||
            (mid != null && d.maintenanceId === mid) ||
            (eid != null && d.entryId === eid),
        );
      }),
    /** Carrega o ficheiro para public/uploads/fleet e regista o anexo. */
    upload: requireEdit("frota")
      .input(
        z.object({
          vehicleId: z.number().nullable().optional(),
          cardId: z.number().nullable().optional(),
          maintenanceId: z.number().nullable().optional(),
          entryId: z.number().nullable().optional(),
          kind: z.enum(DOC_KINDS).default("outro"),
          name: z.string().min(1),
          content: z.string(),
          mime: z.string().nullable().optional(),
          expiresOn: z.string().nullable().optional(),
          notes: z.string().nullable().optional(),
        }),
      )
      .handler(async ({ input }) => {
        if (input.vehicleId == null && input.cardId == null && input.maintenanceId == null && input.entryId == null) {
          throw new ORPCError("BAD_REQUEST", { message: "Escolha a viatura, o cartão, a manutenção ou o consumo a que pertence o documento." });
        }
        const { mime, buf } = decodeUpload(input.content, input.mime ?? "application/octet-stream");
        const filename = `${Date.now()}-${crypto.randomUUID()}.${safeExt(mime, input.name)}`;
        const path = writePublic("fleet", filename, buf);
        const [row] = await db
          .insert(fleetDocuments)
          .values({
            vehicleId: input.vehicleId ?? null,
            cardId: input.cardId ?? null,
            maintenanceId: input.maintenanceId ?? null,
            entryId: input.entryId ?? null,
            kind: input.kind,
            name: input.name,
            path,
            size: buf.byteLength,
            mime,
            expiresOn: input.expiresOn ?? null,
            notes: input.notes ?? null,
          })
          .returning();
        return row;
      }),
    remove: requireEdit("frota").input(idInput).handler(async ({ input }) => {
      await db.delete(fleetDocuments).where(eq(fleetDocuments.id, input.id));
      return { ok: true };
    }),
  },

  /** Funcionários disponíveis para conduzir / ter cartão. */
  drivers: authed.handler(async () => {
    return db
      .select({ id: employees.id, name: employees.name })
      .from(employees)
      .where(inArray(employees.status, ["ativo", "suspenso"]))
      .orderBy(employees.name);
  }),
};
