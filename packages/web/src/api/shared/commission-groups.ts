/**
 * Grupos (categorias) comerciais.
 *
 * Cada tabela comisional pertence a um grupo e cada funcionário tem UMA categoria.
 * As tabelas atribuídas a um funcionário têm de ser todas do grupo da sua categoria:
 * um vendedor não pode ter uma tabela RES+BTN NEG de Gestor Comercial e uma Solar de Parceiro.
 *
 * "empresa" é um grupo especial e não é categoria de ninguém: guarda as tabelas com
 * que a empresa se paga a si própria (faturação interna de todas as vendas). Não aparece
 * na categoria comercial de um funcionário nem nas tabelas que lhe podem ser atribuídas.
 */
export const COMMISSION_GROUPS = [
  "gestor-comercial",
  "team-leader",
  "coordenador",
  "gestor-parcerias",
  "parceiro",
  "freelancer",
] as const;

/** Todos os grupos de tabelas: os comerciais (categorias) mais o grupo da empresa. */
export const TABLE_GROUPS = [...COMMISSION_GROUPS, "empresa"] as const;

export type TableGroup = (typeof TABLE_GROUPS)[number];

export type CommissionGroup = (typeof COMMISSION_GROUPS)[number];

/** Etiquetas legíveis dos grupos. */
export const COMMISSION_GROUP_LABEL: Record<CommissionGroup, string> = {
  "gestor-comercial": "Gestor Comercial",
  "team-leader": "Team Leader",
  "coordenador": "Coordenador",
  "gestor-parcerias": "Gestor de Parcerias",
  parceiro: "Parceiro",
  freelancer: "Free Lancer",
};

/** Lista pronta para menus, com chave e etiqueta. */
export const COMMISSION_GROUP_OPTIONS = COMMISSION_GROUPS.map((key) => ({ key, label: COMMISSION_GROUP_LABEL[key] }));

/** Etiquetas dos grupos de tabelas (inclui o grupo da empresa). */
export const TABLE_GROUP_LABEL: Record<TableGroup, string> = {
  ...COMMISSION_GROUP_LABEL,
  empresa: "Tabela Empresa",
};

/** Lista de grupos de tabelas para os separadores da página Tabelas. */
export const TABLE_GROUP_OPTIONS = TABLE_GROUPS.map((key) => ({ key, label: TABLE_GROUP_LABEL[key] }));
