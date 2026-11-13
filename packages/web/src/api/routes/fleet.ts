import { z } from "zod";
import { ORPCError } from "@orpc/server";
import { eq, inArray } from "drizzle-orm";
import { authed, requireEdit, requireView } from "../middleware/auth";
import { db } from "../database";
import { employees, fleetCards, fleetDocuments, vehicles } from "../database/schema";
import { writePublic } from "../lib/public-files";

const idInput = z.object({ id: z.number() });

const VEHICLE_STATUS = ["ativo", "manutencao", "inativo"] as const;
const CARD_STATUS = ["ativo", "inativo"] as const;
const DOC_KINDS = ["livrete", "seguro", "inspecao", "contrato", "fatura", "outro"] as const;

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

/** Lista de viaturas com condutor e documentos anexados. */
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
      return rows.map((v) => ({
        ...v,
        documents: docs.filter((d) => d.vehicleId === v.id),
      }));
    }),
    create: requireEdit("frota").input(vehicleInput).handler(async ({ input }) => {
      const [row] = await db.insert(vehicles).values({ ...input, plate: input.plate.trim().toUpperCase() }).returning();
      return row;
    }),
    update: requireEdit("frota").input(vehicleInput.extend({ id: z.number() })).handler(async ({ input }) => {
      const { id, ...data } = input;
      await db.update(vehicles).set({ ...data, plate: data.plate.trim().toUpperCase() }).where(eq(vehicles.id, id));
      return { ok: true };
    }),
    remove: requireEdit("frota").input(idInput).handler(async ({ input }) => {
      await db.delete(fleetDocuments).where(eq(fleetDocuments.vehicleId, input.id));
      await db.update(fleetCards).set({ vehicleId: null }).where(eq(fleetCards.vehicleId, input.id));
      await db.delete(vehicles).where(eq(vehicles.id, input.id));
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
      await db.delete(fleetCards).where(eq(fleetCards.id, input.id));
      return { ok: true };
    }),
  },

  documents: {
    list: requireView("frota")
      .input(
        z
          .object({ vehicleId: z.number().optional(), cardId: z.number().optional() })
          .optional(),
      )
      .handler(async ({ input }) => {
        const vid = input?.vehicleId;
        const cid = input?.cardId;
        const rows = await db.select().from(fleetDocuments);
        if (vid == null && cid == null) return rows;
        return rows.filter((d) => (vid != null && d.vehicleId === vid) || (cid != null && d.cardId === cid));
      }),
    /** Carrega o ficheiro para public/uploads/fleet e regista o anexo. */
    upload: requireEdit("frota")
      .input(
        z.object({
          vehicleId: z.number().nullable().optional(),
          cardId: z.number().nullable().optional(),
          kind: z.enum(DOC_KINDS).default("outro"),
          name: z.string().min(1),
          content: z.string(),
          mime: z.string().nullable().optional(),
          expiresOn: z.string().nullable().optional(),
          notes: z.string().nullable().optional(),
        }),
      )
      .handler(async ({ input }) => {
        if (input.vehicleId == null && input.cardId == null) {
          throw new ORPCError("BAD_REQUEST", { message: "Escolha a viatura ou o cartão a que pertence o documento." });
        }
        const { mime, buf } = decodeUpload(input.content, input.mime ?? "application/octet-stream");
        const filename = `${Date.now()}-${crypto.randomUUID()}.${safeExt(mime, input.name)}`;
        const path = writePublic("fleet", filename, buf);
        const [row] = await db
          .insert(fleetDocuments)
          .values({
            vehicleId: input.vehicleId ?? null,
            cardId: input.cardId ?? null,
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
