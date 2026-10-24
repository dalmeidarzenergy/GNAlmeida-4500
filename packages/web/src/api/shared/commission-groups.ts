/**
 * Grupos (categorias) comerciais.
 *
 * Cada tabela comisional pertence a um grupo e cada funcionário tem UMA categoria.
 * As tabelas atribuídas a um funcionário têm de ser todas do grupo da sua categoria:
 * um vendedor não pode ter uma tabela RES+BTN NEG de Gestor Comercial e uma Solar de Parceiro.
 */
export const COMMISSION_GROUPS = [
  "gestor-comercial",
  "team-leader",
  "coordenador",
  "gestor-parcerias",
  "parceiro",
  "freelancer",
] as const;

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
