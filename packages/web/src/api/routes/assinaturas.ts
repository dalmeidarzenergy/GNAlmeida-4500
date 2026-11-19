import { z } from "zod";
import { ORPCError } from "@orpc/server";
import { requireEdit, requireView } from "../middleware/auth";
import { LOGOS_KEY, dadosKey, settingsGet, settingsSet, templateKey } from "../lib/assinaturas-store";
import { writePublic, removePublic } from "../lib/public-files";

/** Ficheiros ate 3 MB (base64). Um logo de assinatura e sempre pequeno; um
 *  limite baixo evita pedidos gigantes e assinaturas que o Outlook corta. */
const MAX_LOGO = 3 * 1024 * 1024;

/** Uma linha da assinatura: tipo + valor. O tipo manda no icone e na cor. */
export const LINHA_TIPOS = ["telefone", "movel", "email", "site", "morada", "extra"] as const;
export type LinhaTipo = (typeof LINHA_TIPOS)[number];

const linha = z.object({
  tipo: z.enum(LINHA_TIPOS),
  valor: z.string().trim().max(160),
  /** Ligacao da linha ("tel:+3519...", "mailto:...", "https://..."). Vazio = sem link. */
  href: z.string().trim().max(300).default(""),
  /** Quando falso, a linha sai sem texto. */
  ativo: z.boolean().default(true),
});

export type AssinaturaLinha = z.infer<typeof linha>;

export const REDES = ["linkedin", "facebook", "instagram", "whatsapp", "youtube"] as const;
export type Rede = (typeof REDES)[number];

const rede = z.object({
  tipo: z.enum(REDES),
  href: z.string().trim().max(300).default(""),
  ativo: z.boolean().default(true),
});
export type AssinaturaRede = z.infer<typeof rede>;

const logo = z.object({
  /** Nome visivel na galeria. */
  nome: z.string().trim().min(1).max(60),
  /** URL publico (/uploads/assinaturas/... ou /logos/...). */
  src: z.string().trim().min(1).max(300),
  /** Se e um logo removivel ou um dos que vem com a app. */
  proprio: z.boolean().default(true),
});
export type AssinaturaLogo = z.infer<typeof logo>;

const template = z.object({
  /** Logo principal, em cima a esquerda. */
  logoPrincipal: z.string().trim().max(300).default(""),
  /** Logo secundario, por baixo do principal. */
  logoSecundario: z.string().trim().max(300).default(""),
  /** Nome da marca a mostrar quando nao ha logo principal. */
  marca: z.string().trim().max(60).default(""),
  /* Cor da linha horizontal e dos links. O valor por omissao e o azul do
   * exemplar da RZ Energy. */
  cor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor invalida.").default("#0da9ff"),
  /** Cor do texto do nome e do cargo. */
  corTexto: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor invalida.").default("#111827"),
  /** Icones a esquerda de cada linha. */
  mostrarIcones: z.boolean().default(true),
  /** Cor dos icones das linhas. */
  corIcones: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor invalida.").default("#00402a"),
  /** Largura da assinatura em pixeis (a que se cola no email).
   *  576 = 145 (logos) + 431 (texto, a medida do exemplar). */
  largura: z.number().int().min(420).max(760).default(576),
});
export type AssinaturaTemplate = z.infer<typeof template>;

const dados = z.object({
  nome: z.string().trim().max(80).default(""),
  cargo: z.string().trim().max(80).default(""),
  nomeEmpresa: z.string().trim().max(80).default(""),
  /** Frase de rodape (ex.: nota legal, campanha). Vazio = sem rodape. */
  nota: z.string().trim().max(300).default(""),
  linhas: z.array(linha).max(8).default([]),
  redes: z.array(rede).max(5).default([]),
});
export type AssinaturaDados = z.infer<typeof dados>;

/** Extensao do ficheiro a partir do tipo MIME ou do nome. */
function ext(mime: string, nome: string) {
  const doNome = nome.includes(".") ? nome.split(".").pop()!.toLowerCase() : "";
  if (doNome && /^[a-z0-9]{1,5}$/.test(doNome)) return doNome;
  const map: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg" };
  return map[mime] ?? "png";
}

function decode(content: string) {
  const m = content.match(/^data:(image\/[a-z0-9.+-]+);base64,/i);
  if (!m) throw new ORPCError("BAD_REQUEST", { message: "Ficheiro invalido. Carregue uma imagem PNG, JPG, WEBP ou SVG." });
  const mime = m[1]!.toLowerCase();
  const buf = Buffer.from(content.slice(m[0].length), "base64");
  if (!buf.byteLength) throw new ORPCError("BAD_REQUEST", { message: "O ficheiro esta vazio." });
  if (buf.byteLength > MAX_LOGO) throw new ORPCError("BAD_REQUEST", { message: "Imagem demasiado grande (maximo 3 MB)." });
  return { mime, buf };
}

/** Logos que ja existem na app, sempre disponiveis na galeria. */
export const LOGOS_BASE: AssinaturaLogo[] = [
  { nome: "RZ Energy", src: "/logos/rzenergy.png", proprio: false },
  { nome: "Iberdrola Colaborador", src: "/logos/iberdrola-colaborador.png", proprio: false },
];

export const assinaturas = {
  /** Galeria de logos (os da app + os carregados pelo utilizador). */
  logos: requireView("assinaturas").handler(async () => {
    const proprios = (await settingsGet<AssinaturaLogo[]>(LOGOS_KEY)) ?? [];
    const validos = proprios.filter((l) => l && typeof l.src === "string" && l.src);
    return [...LOGOS_BASE, ...validos];
  }),

  /** Carrega uma imagem para a biblioteca de logos. */
  logoUpload: requireEdit("assinaturas")
    .input(z.object({ nome: z.string().trim().min(1, "Indique um nome para o logo.").max(60), content: z.string(), mime: z.string().nullable().optional() }))
    .handler(async ({ input }) => {
      const { mime, buf } = decode(input.content);
      const filename = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext(mime, input.nome)}`;
      const src = writePublic("assinaturas", filename, buf);
      const proprios = (await settingsGet<AssinaturaLogo[]>(LOGOS_KEY)) ?? [];
      const novo: AssinaturaLogo = { nome: input.nome, src, proprio: true };
      await settingsSet(LOGOS_KEY, [...proprios, novo]);
      return novo;
    }),

  /** Remove um logo carregado pelo utilizador. */
  logoRemove: requireEdit("assinaturas")
    .input(z.object({ src: z.string() }))
    .handler(async ({ input }) => {
      const proprios = (await settingsGet<AssinaturaLogo[]>(LOGOS_KEY)) ?? [];
      const fica = proprios.filter((l) => l.src !== input.src);
      if (fica.length !== proprios.length) {
        await settingsSet(LOGOS_KEY, fica);
        removePublic(input.src);
      }
      return { ok: true };
    }),

  /** Modelo + dados da assinatura. Sem nada gravado, devolve os valores por omissao. */
  get: requireView("assinaturas").handler(async ({ context }) => {
    const id = context.user.id;
    const t = await settingsGet<Partial<AssinaturaTemplate>>(templateKey(id));
    const d = await settingsGet<Partial<AssinaturaDados>>(dadosKey(id));
    /* `novo` diz a pagina que ainda nao ha nada gravado, para mostrar as linhas
     * de contacto vazias por omissao. Sem isto, um utilizador que apagasse todas
     * as linhas via-as voltar depois de gravar (lista vazia == sem registo). */
    return { template: template.parse(t ?? {}), dados: dados.parse(d ?? {}), novo: d === null };
  }),

  /** Grava o modelo e os dados. */
  save: requireEdit("assinaturas")
    .input(z.object({ template, dados }))
    .handler(async ({ input, context }) => {
      const id = context.user.id;
      await settingsSet(templateKey(id), input.template);
      await settingsSet(dadosKey(id), input.dados);
      return { ok: true };
    }),
};
