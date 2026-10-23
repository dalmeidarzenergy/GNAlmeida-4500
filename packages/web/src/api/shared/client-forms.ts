/**
 * Formulários das vendas (fornecedor único: IBERDROLA), por serviço.
 * Módulo puro (sem dependências de servidor) — usado pela API (validação) e pela web (formulário).
 */
import { ALL_CONCELHOS, CONCELHOS } from "./concelhos";

export type FieldDef =
  | { key: string; label: string; kind: "text" | "textarea" | "date" | "tel"; required?: boolean; pattern?: string; patternHint?: string; placeholder?: string; suggestions?: string[]; full?: boolean }
  | { key: string; label: string; kind: "select"; options: string[]; required?: boolean; full?: boolean; default?: string; optionsFrom?: "district" }
  | { key: string; label: string; kind: "yesno"; required?: boolean; full?: boolean };

/** Campos do formulário da venda que pertencem ao cliente (colunas de `clients`); os restantes ficam na venda. */
export const CORE_MAP = { name: "name", nif: "nif", contact: "phone" } as const;

export const SUPPLIER = "IBERDROLA";
export const SERVICES = [
  { label: "LUZ", hint: "Eletricidade" },
  { label: "GÁS", hint: "Gás natural" },
  { label: "DUAL", hint: "Luz + gás" },
  { label: "SOLAR", hint: "Painéis solares" },
  { label: "MEDEM", hint: "Medição + energia" },
] as const;
export const SERVICE_LABELS: string[] = SERVICES.map((s) => s.label);

/** Particular se o NIF começar por 1, 2 ou 3; caso contrário, empresa. */
export const clientTypeFromNif = (nif?: string | null): "empresa" | "particular" => (/^[123]/.test(nif ?? "") ? "particular" : "empresa");

/** Distritos do continente (as regiões autónomas não entram nas vendas nem nos filtros). */
export const DISTRICTS = [
  "Aveiro", "Beja", "Braga", "Bragança", "Castelo Branco", "Coimbra", "Évora", "Faro", "Guarda", "Leiria", "Lisboa",
  "Portalegre", "Porto", "Santarém", "Setúbal", "Viana do Castelo", "Vila Real", "Viseu",
];

export const POWERS_KVA = ["1,15", "2,3", "3,45", "4,6", "5,75", "6,9", "10,35", "13,8", "17,25", "20,7", "27,6", "34,5", "41,4"];

export const VTV_STATUS = [
  "OK",
  "KO-A - Venda Fraudulenta",
  "KO-B - Desconhecimento do processo de mudança de comercializador",
  "KO-C - Número não atribuído",
  "KO-D - Desistência",
  "KO-E - Cliente com dúvidas",
  "KO-F - Reagendamento sem sucesso",
  "KO-G - Alteração de dados / campanha errada",
  "KO-H - Não Atende",
  "Pendente",
];

export const SALE_STATUS = [
  "Em Fornecimento",
  "Pedido de Fornecimento",
  "Control",
  "Backoffice",
  "Prospeção",
  "Pré-Venda",
  "Anulado",
  "Pedido de Baixa",
  "Baixa",
];

/** Estados que contam como venda efetiva (faturação, metas e comissões). */
export const SALE_COUNTED = ["Em Fornecimento"];
export const DEFAULT_SALE_STATUS = "Prospeção";

/** Comercializadores de eletricidade (mercado livre/regulado) para o campo "Antigo Comercializador". */
const OLD_SUPPLIERS = [
  "Entrada Direta",
  "EDP Comercial",
  "SU Eletricidade",
  "Yes Energy",
  "Endesa",
  "Galp",
  "Goldenergy",
  "Iberdrola",
  "Repsol",
  "Plenitude",
  "Naturgy",
  "MEO Energia",
  "Luzboa",
  "Coopérnico",
  "G9 Energy",
  "Ylce",
  "Muon",
  "Acciona Energía",
  "Audax Renovables",
  "Axpo Iberia",
  "Elergone",
  "Ezuenergia",
  "Alfa Energia",
  "Ibelectra",
];

export const SALE_FORMS: Record<string, FieldDef[]> = {
  LUZ: [
    { key: "contractNumber", label: "Número de Contrato", kind: "text" },
  { key: "proposalNumber", label: "Número da Proposta", kind: "text" },
    { key: "oldSupplier", label: "Antigo Comercializador", kind: "select", options: OLD_SUPPLIERS },
    { key: "name", label: "Nome do Cliente", kind: "text", required: true, full: true },
    { key: "nif", label: "NIF", kind: "text", required: true, pattern: "\\d{9}", patternHint: "9 dígitos" },
    { key: "contact", label: "Contacto", kind: "tel", required: true },
    { key: "signatureDate", label: "Data de Assinatura", kind: "date" },
    { key: "address", label: "Morada Completa", kind: "text", full: true },
    { key: "city", label: "Localidade", kind: "text" },
    { key: "district", label: "Distrito", kind: "select", options: DISTRICTS },
    { key: "municipality", label: "Concelho", kind: "select", options: [], optionsFrom: "district" },
    { key: "cpe", label: "CPE", kind: "text", required: true, pattern: "PT\\d{16}[A-Z]{2}", patternHint: "PT + 16 dígitos + 2 letras", placeholder: "PT0002000000000000XX" },
    { key: "voltageLevel", label: "Nível de Tensão", kind: "select", options: ["BTN", "BTE", "MT"], default: "BTN" },
    { key: "power", label: "Potência (kVA)", kind: "select", options: POWERS_KVA },
    { key: "campaign", label: "Campanha", kind: "text" },
    { key: "ddc", label: "DDC", kind: "yesno" },
    { key: "fe", label: "FE", kind: "yesno" },
    { key: "pel", label: "PEL", kind: "yesno" },
    { key: "consent", label: "Consentimento", kind: "yesno" },
    { key: "vtvStatus", label: "Estado VTV", kind: "select", options: VTV_STATUS, default: "Pendente" },
    { key: "saleStatus", label: "Estado da Venda", kind: "select", options: SALE_STATUS, default: "Prospeção" },
    { key: "notes", label: "Observações", kind: "textarea", full: true },
  ],
};

/** Comercializadores de gás natural para os campos "Antigo Comercializador" (GÁS/DUAL). */
const OLD_GAS_SUPPLIERS = [
  "Entrada Direta",
  "Galp",
  "EDP Comercial",
  "Goldenergy",
  "Endesa",
  "Repsol",
  "Plenitude",
  "Naturgy",
  "Iberdrola",
  "Ylce",
  "Dourogás",
  "Comercializador de Último Recurso",
];

export const GAS_PRESSURE = ["BP"];
export const GAS_TIERS = ["Escalão 1", "Escalão 2", "Escalão 3", "Escalão 4"];
export const GAS_DISTRIBUTORS = [
  "Lisboagás", "Lusitaniagás", "REN Portgás", "Setgás", "Beiragás", "Tagusgás", "Duriensegás", "Medigás", "Paxgás", "Dianagás", "Sonorgás",
];

/** Campos técnicos do gás (usados no GÁS e no DUAL). */
const GAS_FIELDS: FieldDef[] = [
  { key: "gasPressure", label: "Nível de Pressão", kind: "select", options: GAS_PRESSURE, default: "BP" },
  { key: "cui", label: "CUI", kind: "text", required: true, pattern: "PT\\d{16}[A-Z]{2}", patternHint: "PT + 16 dígitos + 2 letras", placeholder: "PT1600000000000000XX" },
  { key: "gasTier", label: "Escalão", kind: "select", options: GAS_TIERS },
  { key: "gasDistributor", label: "Distribuidor", kind: "select", options: GAS_DISTRIBUTORS },
];

/** GÁS: campos da LUZ, com CPE / Nível de Tensão / Potência substituídos pelos campos do gás. */
SALE_FORMS["GÁS"] = SALE_FORMS.LUZ.flatMap((f): FieldDef[] => {
  if (f.key === "cpe") return GAS_FIELDS;
  if (f.key === "voltageLevel" || f.key === "power") return [];
  if (f.key === "pel") return [{ key: "mgi", label: "MGI", kind: "yesno" }];
  if (f.key === "oldSupplier") return [{ key: f.key, label: f.label, kind: "select", options: OLD_GAS_SUPPLIERS }];
  return [f];
});

/** No DUAL, cada energia tem o seu Estado VTV e Estado da Venda (a data de cada mudança de estado fica no histórico). O estado da luz é o estado principal da venda. */
const DUAL_STATUS_FIELDS: FieldDef[] = [
  { key: "vtvStatus", label: "Estado VTV Luz", kind: "select", options: VTV_STATUS, default: "Pendente" },
  { key: "saleStatus", label: "Estado da Venda Luz", kind: "select", options: SALE_STATUS, default: "Prospeção" },
  { key: "vtvStatusGas", label: "Estado VTV Gás", kind: "select", options: VTV_STATUS, default: "Pendente" },
  { key: "saleStatusGas", label: "Estado da Venda Gás", kind: "select", options: SALE_STATUS, default: "Prospeção" },
];

/** DUAL (luz + gás): campos da LUZ + campos do gás e uma campanha para cada energia. */
SALE_FORMS.DUAL = SALE_FORMS.LUZ.flatMap((f): FieldDef[] => {
  if (f.key === "power") return [f, ...GAS_FIELDS];
  if (f.key === "pel") return [f, { key: "mgi", label: "MGI", kind: "yesno" }];
  if (f.key === "vtvStatus") return [];
  if (f.key === "saleStatus") return DUAL_STATUS_FIELDS;
  if (f.key === "campaign") return [{ ...f, label: "Campanha Eletricidade" }, { key: "campaignGas", label: "Campanha Gás", kind: "text" }];
  if (f.key === "oldSupplier") {
    return [
      { ...f, label: "Antigo Comercializador Luz" },
      { key: "oldSupplierGas", label: "Antigo Comercializador Gás", kind: "select", options: OLD_GAS_SUPPLIERS },
    ];
  }
  return [f];
});

/** Campos que guardam um código de campanha e os serviços de campanha que cada um aceita. */
export const CAMPAIGN_FIELDS: Record<string, (service: string) => string[]> = {
  campaign: (service) => (service === "DUAL" ? ["LUZ", "DUAL"] : [service]),
  campaignGas: () => ["GÁS", "DUAL"],
};

/** MEDEM: medição + energia. Estado da venda = LUZ + opção "-" no topo. */
export const MEDEM_TIPOS = [
  "Preço fixo",
  "Contrato Solução Preço Fixo Energia Verde",
  "Indexado pass-through Verde",
] as const;

export const MEDEM_PROPOSAL_STATUS = [
  "Adjudicada",
  "Pendente de Validação",
  "Pronta",
  "Enviada",
  "Anulada",
] as const;

const MEDEM_SALE_STATUS = [...SALE_STATUS];

SALE_FORMS.MEDEM = [
  { key: "contractNumber", label: "Número de Contrato", kind: "text" },
  { key: "proposalNumber", label: "Número da Proposta", kind: "text" },
  { key: "tipo", label: "Tipo", kind: "select", options: [...MEDEM_TIPOS] },
  { key: "oldSupplier", label: "Antigo Comercializador", kind: "select", options: OLD_SUPPLIERS },
  { key: "name", label: "Nome do Cliente", kind: "text", required: true, full: true },
  { key: "nif", label: "NIF", kind: "text", required: true, pattern: "\d{9}", patternHint: "9 dígitos" },
  { key: "contact", label: "Contacto", kind: "tel", required: true },
  { key: "signatureDate", label: "Data de Assinatura", kind: "date" },
  { key: "address", label: "Morada Completa", kind: "text", full: true },
  { key: "city", label: "Localidade", kind: "text" },
  { key: "district", label: "Distrito", kind: "select", options: DISTRICTS },
  { key: "municipality", label: "Concelho", kind: "select", options: [], optionsFrom: "district" },
  { key: "cpe", label: "CPE", kind: "text", required: true, pattern: "PT\d{16}[A-Z]{2}", patternHint: "PT + 16 dígitos + 2 letras", placeholder: "PT0002000000000000XX" },
  { key: "power", label: "Potência (kVA)", kind: "select", options: POWERS_KVA },
  { key: "voltageLevel", label: "Nível de Tensão", kind: "select", options: ["BTN", "BTE", "MT"], default: "BTN" },
  { key: "proposalStatus", label: "Estado da Proposta", kind: "select", options: [...MEDEM_PROPOSAL_STATUS], default: "Enviada" },
  { key: "contractDuration", label: "Duração do Contrato", kind: "text" },
  { key: "credit", label: "Crédito", kind: "text" },
  { key: "points", label: "Número de Pontos", kind: "text" },
  { key: "ddc", label: "DDC", kind: "yesno" },
  { key: "fe", label: "FE", kind: "yesno" },
  { key: "consent", label: "Consentimentos", kind: "yesno" },
  { key: "saleStatus", label: "Estado da Venda", kind: "select", options: MEDEM_SALE_STATUS, default: "Prospeção" },
  { key: "notes", label: "Observações", kind: "textarea", full: true },
];


/** Formulário base para os serviços que ainda não têm campos próprios (SOLAR). */
export const BASE_SALE_FORM: FieldDef[] = [
  { key: "name", label: "Nome do Cliente", kind: "text", required: true, full: true },
  { key: "nif", label: "NIF", kind: "text", required: true, pattern: "\\d{9}", patternHint: "9 dígitos" },
  { key: "contact", label: "Contacto", kind: "tel", required: true },
  { key: "signatureDate", label: "Data de Assinatura", kind: "date" },
  { key: "campaign", label: "Campanha", kind: "text" },
  { key: "saleStatus", label: "Estado da Venda", kind: "select", options: SALE_STATUS, default: "Prospeção" },
  { key: "notes", label: "Observações", kind: "textarea", full: true },
];

export const getSaleForm = (service?: string | null) => (service && SERVICE_LABELS.includes(service) ? (SALE_FORMS[service] ?? BASE_SALE_FORM) : null);

export type Details = Record<string, string | boolean | null>;

/** Opções de um select. No Concelho (optionsFrom "district"), são as do distrito escolhido; sem distrito, todas. */
export function fieldOptions(f: FieldDef, values: Details): string[] {
  if (f.kind !== "select") return [];
  if (f.optionsFrom === "district") return CONCELHOS[String(values.district ?? "")] ?? ALL_CONCELHOS;
  return f.options;
}

/** Valida os valores de um formulário específico. Devolve a mensagem de erro ou null. */
export function validateDetails(fields: FieldDef[], values: Details): string | null {
  for (const f of fields) {
    const v = values[f.key];
    const empty = v == null || v === "";
    if (f.required && empty) return `Preencha o campo "${f.label}".`;
    if (empty) continue;
    if (f.kind === "select" && !fieldOptions(f, values).includes(String(v))) return `Valor inválido em "${f.label}".`;
    if (f.kind === "yesno" && typeof v !== "boolean") return `Indique Sim ou Não em "${f.label}".`;
    if ("pattern" in f && f.pattern && !new RegExp(`^${f.pattern}$`).test(String(v))) return `"${f.label}" inválido (${f.patternHint}).`;
  }
  return null;
}
