/**
 * Modelo de permissões por utilizador.
 *
 * Cada módulo (item de menu / página) tem dois interruptores independentes:
 *  - `view`: o utilizador vê a página e pode ler os dados
 *  - `edit`: o utilizador pode criar/alterar/eliminar nessa área
 *
 * Os perfis (roles) continuam a existir como ponto de partida: escolher um perfil
 * preenche as permissões por defeito, e o administrador ajusta cada interruptor.
 * As permissões efetivas ficam gravadas por utilizador em `user_roles.permissions`
 * (JSON); quando nulas, usam-se as do perfil.
 */

export type Role = "admin" | "diretor" | "rh" | "backoffice" | "coordenador" | "chefe" | "vendedor";

export const ROLE_KEYS: Role[] = ["admin", "diretor", "rh", "backoffice", "coordenador", "chefe", "vendedor"];

export const MODULES = [
  { key: "painel", label: "Painel", group: "Geral" },
  { key: "funcionarios", label: "Funcionários", group: "Recursos Humanos" },
  { key: "departamentos", label: "Departamentos e cargos", group: "Recursos Humanos" },
  { key: "equipas", label: "Equipas", group: "Recursos Humanos" },
  { key: "ausencias", label: "Férias e ausências", group: "Recursos Humanos" },
  { key: "recrutamento", label: "Recrutamento", group: "Recursos Humanos" },
  { key: "tabelas-comissionais", label: "Tabelas Comissionais", group: "Recursos Humanos" },
  { key: "chefes-equipa", label: "Escalões de Chefe de Equipa", group: "Recursos Humanos" },
  { key: "pagamentos", label: "Pagamentos", group: "Recursos Humanos" },
  { key: "auto-iberdrola", label: "Auto Iberdrola", group: "Pagamentos" },
  { key: "regras", label: "Regras", group: "Pagamentos" },
  { key: "incentivos", label: "Incentivos", group: "Pagamentos" },
  { key: "clientes", label: "Clientes", group: "Vendas" },
  { key: "vendas", label: "Vendas", group: "Vendas" },
  { key: "vendas-criticas", label: "Vendas Críticas", group: "Vendas" },
  { key: "estado-vtv", label: "Estado VTV", group: "Vendas" },
  { key: "campanhas", label: "Campanhas", group: "Vendas" },
  { key: "agenda", label: "Agenda", group: "Vendas" },
  { key: "metas", label: "Metas", group: "Vendas" },
  { key: "terreno-d2d", label: "Terreno D2D", group: "Vendas" },
  { key: "simulador-iberdrola", label: "Simulador Iberdrola", group: "Vendas" },
  { key: "completar-iban", label: "Completar IBAN", group: "Vendas" },
  { key: "relatorios", label: "Relatórios", group: "Análise" },
  { key: "evolucao", label: "Evolução", group: "Análise" },
  { key: "comparativo", label: "Comparativo", group: "Análise" },
  { key: "medem", label: "Análise MEDEM", group: "Análise" },
  { key: "utilizadores", label: "Utilizadores", group: "Análise" },
] as const;

export type ModuleKey = (typeof MODULES)[number]["key"];
export type Permission = { view: boolean; edit: boolean };
export type Permissions = Record<ModuleKey, Permission>;

/** Que perfis veem / editam cada módulo por defeito. */
type ModuleAccess = { view: Role[]; edit: Role[] };

const ALL: Role[] = [...ROLE_KEYS];

const ACCESS: Record<ModuleKey, ModuleAccess> = {
  painel: { view: ALL, edit: ["admin", "diretor"] },
  funcionarios: { view: ["admin", "diretor", "rh"], edit: ["admin", "diretor", "rh"] },
  departamentos: { view: ["admin", "diretor", "rh"], edit: ["admin", "diretor", "rh"] },
  equipas: { view: ["admin", "diretor", "rh", "chefe"], edit: ["admin", "diretor", "rh"] },
  ausencias: { view: ["admin", "diretor", "rh", "chefe", "vendedor"], edit: ["admin", "diretor", "rh"] },
  recrutamento: { view: ["admin", "diretor", "rh"], edit: ["admin", "diretor", "rh"] },
  "tabelas-comissionais": { view: ["admin", "diretor", "rh"], edit: ["admin", "diretor", "rh"] },
  "chefes-equipa": { view: ["admin", "diretor", "rh"], edit: ["admin", "diretor", "rh"] },
  "pagamentos": { view: ["admin", "diretor", "rh", "chefe"], edit: ["admin", "diretor", "rh"] },
  "auto-iberdrola": { view: ["admin", "diretor", "rh", "chefe"], edit: ["admin", "diretor", "rh"] },
  regras: { view: ["admin", "diretor", "rh", "chefe"], edit: ["admin", "diretor", "rh"] },
  incentivos: { view: ["admin", "diretor", "rh", "chefe"], edit: ["admin", "diretor", "rh"] },
  clientes: { view: ["admin", "diretor", "rh", "chefe", "vendedor"], edit: ["admin", "diretor", "rh"] },
  vendas: { view: ["admin", "diretor", "rh", "chefe", "vendedor"], edit: ["admin", "diretor", "rh"] },
  "vendas-criticas": { view: ["admin", "diretor", "rh", "backoffice", "coordenador", "chefe", "vendedor"], edit: ["admin", "diretor", "rh"] },
  "estado-vtv": { view: ["admin", "diretor", "rh", "backoffice", "coordenador", "chefe", "vendedor"], edit: ["admin", "diretor", "rh"] },
  campanhas: { view: ["admin", "diretor", "rh", "chefe", "vendedor"], edit: ["admin", "diretor", "rh"] },
  agenda: { view: ALL, edit: ALL },
  metas: { view: ["admin", "diretor", "rh", "chefe", "vendedor"], edit: ["admin", "diretor"] },
  "terreno-d2d": { view: ALL, edit: ["admin", "diretor", "rh", "backoffice", "coordenador", "chefe"] },
  "simulador-iberdrola": { view: ALL, edit: ["admin", "diretor", "rh"] },
  "completar-iban": { view: ALL, edit: ALL },
  relatorios: { view: ["admin", "diretor", "rh", "chefe"], edit: ["admin", "diretor"] },
  evolucao: { view: ["admin", "diretor", "rh", "chefe", "vendedor"], edit: ["admin", "diretor"] },
  comparativo: { view: ["admin", "diretor", "rh", "chefe"], edit: ["admin", "diretor"] },
  medem: { view: ["admin", "diretor", "rh", "chefe"], edit: ["admin", "diretor"] },
  utilizadores: { view: ["admin", "diretor", "backoffice"], edit: ["admin", "diretor"] },
};

function buildDefaults(): Record<Role, Permissions> {
  const map = {} as Record<Role, Permissions>;
  for (const role of ROLE_KEYS) {
    const perms = {} as Permissions;
    for (const m of MODULES) {
      const a = ACCESS[m.key];
      perms[m.key] = { view: a.view.includes(role), edit: a.edit.includes(role) };
    }
    map[role] = perms;
  }
  return map;
}

/** Permissões por defeito de cada perfil (ponto de partida, não um limite). */
export const ROLE_DEFAULTS: Record<Role, Permissions> = buildDefaults();

/** Clone profundo das permissões por defeito de um perfil. */
export function defaultsForRole(role: Role): Permissions {
  const src = ROLE_DEFAULTS[role];
  const out = {} as Permissions;
  for (const m of MODULES) out[m.key] = { ...src[m.key] };
  return out;
}

/** Permissões efetivas: sobrepõe o JSON gravado por utilizador às do perfil. */
export function effectivePermissions(role: Role, override: Permissions | null | undefined): Permissions {
  const base = ROLE_DEFAULTS[role];
  const out = {} as Permissions;
  for (const m of MODULES) {
    const o = override?.[m.key];
    out[m.key] = { view: o ? !!o.view : base[m.key].view, edit: o ? !!o.edit : base[m.key].edit };
  }
  return out;
}