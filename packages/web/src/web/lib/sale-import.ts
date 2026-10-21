/**
 * Importação de vendas a partir de Excel: leitura do ficheiro, correspondência das colunas e conversão dos valores
 * para os campos do formulário da venda. Cada linha do Excel = uma venda, com os dados do cliente na mesma linha.
 */
import { ALL_CONCELHOS } from "../../api/shared/concelhos";
import { SALE_FORMS, SERVICE_LABELS, fieldOptions, getSaleForm, validateDetails, type Details, type FieldDef } from "../../api/shared/client-forms";

/** Campos especiais da importação (não fazem parte do formulário). */
export const SPECIAL = {
  service: "Serviço",
  seller: "Vendedor",
  statusDate: "Data do Estado",
} as const;
export type SpecialKey = keyof typeof SPECIAL;

/** Todos os campos dos formulários (o DUAL contém os campos da LUZ e do GÁS). */
const ALL_FIELDS: FieldDef[] = SALE_FORMS.DUAL;

/** Nome da coluna no modelo Excel para cada campo. */
const TEMPLATE_LABEL: Record<string, string> = {
  oldSupplier: "Antigo Comercializador",
  oldSupplierGas: "Antigo Comercializador Gás",
  campaign: "Campanha",
  campaignGas: "Campanha Gás",
  vtvStatus: "Estado VTV",
  saleStatus: "Estado da Venda",
  vtvStatusGas: "Estado VTV Gás",
  saleStatusGas: "Estado da Venda Gás",
};

export type Target = { key: string; label: string };

/** Ordem das colunas do modelo e das opções de correspondência. */
export const TARGETS: Target[] = [
  { key: "service", label: SPECIAL.service },
  { key: "seller", label: SPECIAL.seller },
  ...ALL_FIELDS.flatMap((f) => {
    const t = { key: f.key, label: TEMPLATE_LABEL[f.key] ?? f.label };
    return f.key === "saleStatusGas" ? [t, { key: "statusDate", label: SPECIAL.statusDate }] : [t];
  }),
];
const targetLabel = new Map(TARGETS.map((t) => [t.key, t.label]));

/** Normaliza texto para comparação: minúsculas, sem acentos nem pontuação. */
export const norm = (v: unknown) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(de|da|do|dos|das|o|a)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Outros nomes de coluna habituais para cada campo. */
const ALIASES: Record<string, string[]> = {
  service: ["servico", "servico aderir", "produto", "energia", "tipo servico"],
  seller: ["vendedor", "comercial", "gestor", "angariador", "consultor", "vendedor comercial"],
  statusDate: ["data estado", "data estado venda", "data fornecimento", "data mudanca estado", "data ultimo estado"],
  name: ["nome", "cliente", "nome cliente", "titular", "nome titular"],
  nif: ["nif", "contribuinte", "nipc", "nif nipc", "n contribuinte"],
  contact: ["contacto", "contato", "telefone", "telemovel", "tlm", "tel", "phone"],
  signatureDate: ["data", "data assinatura", "data venda", "data registo", "data adesao"],
  contractNumber: ["contrato", "n contrato", "numero contrato", "no contrato", "n de contrato"],
  oldSupplier: ["comercializador", "antigo comercializador", "comercializador atual", "antigo comercializador luz", "comercializador anterior"],
  oldSupplierGas: ["antigo comercializador gas", "comercializador gas"],
  address: ["morada", "morada completa", "endereco"],
  city: ["localidade", "cidade"],
  municipality: ["concelho", "municipio"],
  district: ["distrito"],
  cpe: ["cpe", "cpe luz"],
  voltageLevel: ["tensao", "nivel tensao"],
  power: ["potencia", "kva", "potencia kva", "potencia contratada"],
  cui: ["cui", "cui gas"],
  gasPressure: ["pressao", "nivel pressao"],
  gasTier: ["escalao", "escalao gas"],
  gasDistributor: ["distribuidor", "ord", "distribuidor gas"],
  campaign: ["campanha", "campanha luz", "campanha eletricidade", "campanha electricidade"],
  campaignGas: ["campanha gas"],
  ddc: ["ddc", "debito direto"],
  fe: ["fe", "fatura eletronica", "factura electronica"],
  pel: ["pel"],
  mgi: ["mgi"],
  consent: ["consentimento"],
  vtvStatus: ["estado vtv", "vtv", "estado vtv luz", "vtv luz"],
  saleStatus: ["estado", "estado venda", "estado venda luz", "estado luz"],
  vtvStatusGas: ["estado vtv gas", "vtv gas"],
  saleStatusGas: ["estado venda gas", "estado gas"],
  notes: ["observacoes", "obs", "notas", "comentarios"],
};
const aliasIndex = new Map<string, string>();
for (const t of TARGETS) aliasIndex.set(norm(t.label), t.key);
for (const f of ALL_FIELDS) if (!aliasIndex.has(norm(f.label))) aliasIndex.set(norm(f.label), f.key);
for (const [k, list] of Object.entries(ALIASES)) for (const a of list) if (!aliasIndex.has(norm(a))) aliasIndex.set(norm(a), k);

/** Sugere o campo de cada coluna do Excel (cada campo só é usado uma vez). */
export function autoMap(headers: string[]): (string | null)[] {
  const used = new Set<string>();
  return headers.map((h) => {
    const key = aliasIndex.get(norm(h));
    if (!key || used.has(key)) return null;
    used.add(key);
    return key;
  });
}

export const labelOf = (key: string) => targetLabel.get(key) ?? key;

// ---------- Leitura do ficheiro ----------

export type Sheet = { name: string; headers: string[]; rows: unknown[][]; lines: number[] };

/** CSV em UTF-8 ou, se tiver caracteres inválidos, no formato do Excel português (Windows-1252). */
async function csvText(file: File) {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buf);
  return utf8.includes(String.fromCharCode(0xfffd)) ? new TextDecoder("windows-1252").decode(buf) : utf8;
}

/** Lê todas as folhas do ficheiro. O cabeçalho é a primeira linha com pelo menos 2 células preenchidas. */
export async function readWorkbook(file: File): Promise<Sheet[]> {
  const XLSX = await import("xlsx");
  const isText = /\.(csv|txt)$/i.test(file.name);
  const wb = isText
    ? XLSX.read(await csvText(file), { type: "string", raw: true })
    : XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  const filled = (r: unknown[]) => r.filter((c) => c != null && String(c).trim() !== "").length;
  return wb.SheetNames.map((name): Sheet => {
    const ws = wb.Sheets[name];
    const first = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]).s.r + 1 : 1;
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });
    const hi = aoa.findIndex((r) => filled(r) >= 2);
    if (hi < 0) return { name, headers: [], rows: [], lines: [] };
    const width = Math.max(...aoa.slice(hi).map((r) => r.length));
    const headers = Array.from({ length: width }, (_, i) => String(aoa[hi][i] ?? "").trim() || `Coluna ${i + 1}`);
    const rows: unknown[][] = [];
    const lines: number[] = [];
    aoa.slice(hi + 1).forEach((r, i) => {
      if (!filled(r)) return;
      rows.push(r);
      lines.push(first + hi + 1 + i);
    });
    return { name, headers, rows, lines };
  }).filter((s) => s.headers.length);
}

// ---------- Conversão dos valores ----------

const pad = (n: number) => String(n).padStart(2, "0");

/** Converte datas do Excel (número de série, dd/mm/aaaa, aaaa-mm-dd…) para AAAA-MM-DD. */
export function toIsoDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && v > 59 && v < 80000) {
    // Série do Excel (dias desde 30/12/1899).
    const d = new Date(Math.round((v - 25569) * 86400000));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) return valid(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  return "inválida";
}
function valid(y: number, mo: number, d: number) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? `${y}-${pad(mo)}-${pad(d)}` : "inválida";
}

const YES = new Set(["sim", "s", "yes", "y", "x", "1", "true", "verdadeiro", "ok"]);
const NO = new Set(["nao", "n", "no", "0", "false", "falso"]);

const cellText = (v: unknown) => {
  if (v == null) return "";
  if (typeof v === "number") return String(v);
  return String(v).trim();
};

/** Procura a opção de uma lista que corresponde ao valor do Excel. */
function matchOption(options: string[], raw: unknown): string | null {
  const s = cellText(raw);
  if (!s) return null;
  const n = norm(s);
  const exact = options.find((o) => norm(o) === n);
  if (exact) return exact;
  // Números (potência "3.45" ou 3,45; escalão "1").
  const num = Number(s.replace(",", "."));
  if (!Number.isNaN(num)) {
    const byNum = options.find((o) => Number(o.replace(",", ".")) === num || norm(o).endsWith(` ${num}`));
    if (byNum) return byNum;
  }
  // Início igual ("KO-A" → "KO-A - Venda Fraudulenta") ou contido ("Açores" → "Região Autónoma dos Açores").
  const starts = options.filter((o) => norm(o).startsWith(`${n} `));
  if (starts.length === 1) return starts[0];
  if (n.length >= 4) {
    const inc = options.filter((o) => norm(o).includes(n));
    if (inc.length === 1) return inc[0];
  }
  return s;
}

/** Converte o valor de uma célula para o tipo do campo. */
export function convertValue(def: FieldDef, raw: unknown): string | boolean | null {
  if (def.kind === "yesno") {
    const n = norm(raw);
    if (!n) return null;
    if (YES.has(n)) return true;
    if (NO.has(n)) return false;
    return cellText(raw);
  }
  if (def.kind === "select") return matchOption(def.options, raw);
  if (def.kind === "date") return toIsoDate(raw);
  let s = cellText(raw);
  if (!s) return null;
  if (def.key === "nif") s = s.replace(/\D/g, "");
  if (def.key === "cpe" || def.key === "cui") s = s.replace(/\s+/g, "").toUpperCase();
  if (def.key === "contact") s = s.replace(/^\+?351\s*/, "").replace(/\s+/g, "");
  return s;
}

/** Deteta o serviço pelo texto do Excel. */
function serviceFrom(raw: unknown): string | null {
  const n = norm(raw);
  if (!n) return null;
  if (n.includes("dual") || (n.includes("luz") && n.includes("gas"))) return "DUAL";
  if (n.includes("solar") || n.includes("painel") || n.includes("paineis")) return "SOLAR";
  if (n.includes("gas")) return "GÁS";
  if (n.includes("luz") || n.includes("eletric") || n.includes("electric")) return "LUZ";
  return SERVICE_LABELS.find((s) => norm(s) === n) ?? null;
}

export type Employee = { id: number; name: string; status: string };

/** Encontra o vendedor pelo nome (completo, ou primeiro e último nome, ou parte única do nome). */
export function sellerFrom(employees: Employee[], raw: unknown): Employee | null {
  const n = norm(raw);
  if (!n) return null;
  const exact = employees.filter((e) => norm(e.name) === n);
  if (exact.length) return exact.find((e) => e.status !== "inativo") ?? exact[0];
  const words = n.split(" ");
  const fl = employees.filter((e) => {
    const w = norm(e.name).split(" ");
    return words.length > 1 && w[0] === words[0] && w.at(-1) === words.at(-1);
  });
  if (fl.length === 1) return fl[0];
  const part = employees.filter((e) => ` ${norm(e.name)} `.includes(` ${n} `));
  return part.length === 1 ? part[0] : null;
}

export type Prepared = {
  row: number;
  service: string | null;
  seller: Employee | null;
  sellerRaw: string;
  details: Details;
  statusDate: string | null;
  error: string | null;
  warning: string | null;
  /** Serviço detetado pelo CPE/CUI, vendedor por defeito e campos com valor por defeito (não vieram do Excel). */
  serviceAuto: boolean;
  sellerDefault: boolean;
  defaulted: string[];
};

export type Options = { defaultService: string; defaultSellerId: number | null; employees: Employee[]; today: string };

/** Converte uma linha do Excel em venda e valida-a com as mesmas regras do formulário. */
export function prepareRow(cells: unknown[], mapping: (string | null)[], rowNumber: number, opts: Options): Prepared {
  const raw: Record<string, unknown> = {};
  mapping.forEach((k, i) => {
    if (k && (raw[k] == null || raw[k] === "")) raw[k] = cells[i];
  });
  const has = (k: string) => cellText(raw[k]) !== "";
  let service = has("service") ? serviceFrom(raw.service) : null;
  let error: string | null = null;
  const warnings: string[] = [];
  if (has("service") && !service) error = `Serviço "${cellText(raw.service)}" desconhecido (use LUZ, GÁS, DUAL ou SOLAR).`;
  let serviceAuto = false;
  if (!service && !error) {
    if (opts.defaultService !== "auto") service = opts.defaultService;
    else {
      service = has("cpe") && has("cui") ? "DUAL" : has("cui") ? "GÁS" : "LUZ";
      serviceAuto = true;
    }
  }

  const sellerRaw = cellText(raw.seller);
  let seller = sellerRaw ? sellerFrom(opts.employees, sellerRaw) : null;
  if (!sellerRaw) seller = opts.employees.find((e) => e.id === opts.defaultSellerId) ?? null;
  if (!error && sellerRaw && !seller) error = `Vendedor "${sellerRaw}" não encontrado nos funcionários.`;
  if (!error && !seller) error = "Sem vendedor (escolha o vendedor por defeito).";

  const form = service ? (getSaleForm(service) ?? []) : [];
  const details: Details = {};
  const defaulted: string[] = [];
  // O distrito é convertido primeiro: as opções do concelho dependem dele.
  const districtDef = form.find((f) => f.key === "district");
  if (districtDef && has("district")) {
    const dv = convertValue(districtDef, raw.district);
    if (dv != null) details.district = dv;
  }
  for (const f of form) {
    const def = f.kind === "select" && f.optionsFrom ? { ...f, options: fieldOptions(f, details) } : f;
    let v = has(f.key) ? convertValue(def, raw[f.key]) : null;
    if (v == null && f.kind === "select" && "default" in f && f.default) {
      v = f.default;
      defaulted.push(f.key);
    }
    if (v != null) details[f.key] = v;
  }
  // DUAL sem estados do gás no Excel: usa os mesmos da luz.
  if (service === "DUAL") {
    if (!has("saleStatusGas") && details.saleStatus) {
      details.saleStatusGas = details.saleStatus;
      defaulted.push("saleStatusGas");
    }
    if (!has("vtvStatusGas") && details.vtvStatus) {
      details.vtvStatusGas = details.vtvStatus;
      defaulted.push("vtvStatusGas");
    }
  }
  for (const f of form) if (f.kind === "date" && details[f.key] === "inválida") error ??= `Data inválida em "${f.label}".`;
  if (!error) error = validateDetails(form, details);
  const statusDate = has("statusDate") ? toIsoDate(raw.statusDate) : null;
  if (!error && statusDate === "inválida") error = 'Data inválida em "Data do Estado".';
  if (!error && statusDate && statusDate > opts.today) error = "A data do estado não pode ser no futuro.";
  if (seller?.status === "inativo") warnings.push(`${seller.name} está inativo.`);
  return { row: rowNumber, service, seller, sellerRaw, details, statusDate, error, warning: warnings.join(" ") || null, serviceAuto, sellerDefault: !sellerRaw, defaulted };
}

// ---------- Modelo ----------

/** Descarrega o modelo Excel com as colunas, um exemplo e os valores aceites. */
export async function downloadTemplate() {
  const XLSX = await import("xlsx");
  const example: Record<string, string> = {
    service: "LUZ",
    seller: "Nome do vendedor",
    contractNumber: "",
    oldSupplier: "EDP Comercial",
    name: "Maria Silva",
    nif: "123456789",
    contact: "912345678",
    signatureDate: "15/10/2026",
    address: "Rua das Flores, 10, 1000-100 Lisboa",
    city: "Lisboa",
    municipality: "Lisboa",
    district: "Lisboa",
    cpe: "PT0002000000000000XX",
    voltageLevel: "BTN",
    power: "6,9",
    campaign: "",
    ddc: "Sim",
    fe: "Sim",
    pel: "Não",
    consent: "Sim",
    vtvStatus: "Pendente",
    saleStatus: "Prospeção",
    statusDate: "",
    notes: "",
  };
  const header = TARGETS.map((t) => t.label);
  const ws = XLSX.utils.aoa_to_sheet([header, TARGETS.map((t) => example[t.key] ?? "")]);
  ws["!cols"] = header.map((h) => ({ wch: Math.max(14, h.length + 2) }));

  const lists: [string, string[]][] = [
    ["Serviço", SERVICE_LABELS],
    ...ALL_FIELDS.filter((f) => f.kind === "select").map((f): [string, string[]] => [
      f.kind === "select" && f.optionsFrom ? "Concelho (da lista, conforme o distrito)" : (TEMPLATE_LABEL[f.key] ?? f.label),
      f.kind === "select" && f.optionsFrom ? ALL_CONCELHOS : f.kind === "select" ? f.options : [],
    ]),
    ["Sim / Não (DDC, FE, PEL, MGI, Consentimento)", ["Sim", "Não"]],
  ];
  const max = Math.max(...lists.map(([, o]) => o.length));
  const values = XLSX.utils.aoa_to_sheet([lists.map(([h]) => h), ...Array.from({ length: max }, (_, i) => lists.map(([, o]) => o[i] ?? ""))]);
  values["!cols"] = lists.map(([h]) => ({ wch: Math.max(18, h.length + 2) }));

  const help = XLSX.utils.aoa_to_sheet([
    ["Como preencher"],
    ["Cada linha é uma venda. Os dados do cliente (nome, NIF, contacto) vão na mesma linha."],
    ["Obrigatórios: Nome do Cliente, NIF (9 dígitos), Contacto e CPE (LUZ/DUAL) ou CUI (GÁS/DUAL)."],
    ["Serviço: LUZ, GÁS, DUAL ou SOLAR. Se ficar vazio, a app deteta pelo CPE/CUI."],
    ["Vendedor: nome do funcionário como está na app. Se ficar vazio, usa-se o vendedor escolhido na importação."],
    ["Datas: dd/mm/aaaa. A Data de Assinatura é a data da venda."],
    ["Data do Estado: dia em que a venda passou para o Estado da Venda atual (opcional; sem ela usa-se a data da venda)."],
    ["DUAL: Estado da Venda e Estado VTV são os da luz; as colunas \"Gás\" são as do gás (vazias = iguais às da luz)."],
    ["Se já existir uma venda com o mesmo CPE ou CUI, essa venda é atualizada com os dados do Excel (as células vazias não apagam nada)."],
    ["Exceção: se o Número de Contrato for diferente do da venda existente, é criada uma venda nova."],
    ["Se o NIF já existir na app, a venda é juntada a esse cliente (os dados do cliente não são alterados)."],
    ["Pode apagar as colunas de que não precisa. Os valores aceites estão na folha \"Valores\"."],
  ]);
  help["!cols"] = [{ wch: 110 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Vendas");
  XLSX.utils.book_append_sheet(wb, values, "Valores");
  XLSX.utils.book_append_sheet(wb, help, "Instruções");
  XLSX.writeFile(wb, "modelo-importacao-vendas.xlsx");
}

