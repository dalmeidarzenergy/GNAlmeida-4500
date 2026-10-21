export const ROLE_LABEL: Record<string, string> = {
  admin: "Administrador",
  diretor: "Diretor",
  rh: "Recursos Humanos",
  backoffice: "Backoffice",
  coordenador: "Coordenador",
  chefe: "Chefe de Equipa",
  vendedor: "Gestor Comercial",
};

export const EMP_STATUS: Record<string, { label: string; color: string }> = {
  ativo: { label: "Ativo", color: "var(--volt)" },
  pendente: { label: "Pendente de validação", color: "var(--amber)" },
  suspenso: { label: "Suspenso", color: "var(--amber)" },
  blacklist: { label: "Blacklist", color: "var(--danger)" },
  inativo: { label: "Inativo", color: "var(--ink-3)" },
};

export const ABSENCE_TYPE: Record<string, { label: string; color: string }> = {
  ferias: { label: "Férias", color: "var(--volt)" },
  baixa: { label: "Baixa médica", color: "var(--danger)" },
  falta: { label: "Falta", color: "var(--amber)" },
  formacao: { label: "Formação", color: "var(--sky)" },
  outro: { label: "Outro", color: "var(--ink-2)" },
};

export const APPROVAL: Record<string, { label: string; color: string }> = {
  pendente: { label: "Pendente", color: "var(--amber)" },
  aprovado: { label: "Aprovado", color: "var(--volt)" },
  rejeitado: { label: "Rejeitado", color: "var(--danger)" },
};

export const JOB_STATUS: Record<string, { label: string; color: string }> = {
  aberta: { label: "Aberta", color: "var(--volt)" },
  pausada: { label: "Pausada", color: "var(--amber)" },
  fechada: { label: "Fechada", color: "var(--ink-3)" },
};

export const STAGES = [
  { key: "candidatura", label: "Candidatura", color: "var(--ink-2)" },
  { key: "triagem", label: "Triagem", color: "var(--sky)" },
  { key: "entrevista", label: "Entrevista", color: "var(--rose)" },
  { key: "proposta", label: "Proposta", color: "var(--amber)" },
  { key: "contratado", label: "Contratado", color: "var(--volt)" },
  { key: "rejeitado", label: "Rejeitado", color: "var(--danger)" },
] as const;

export const SALE_STATUS: Record<string, { label: string; color: string }> = {
  "Em Fornecimento": { label: "Em Fornecimento", color: "var(--volt)" },
  "Pedido de Fornecimento": { label: "Pedido de Fornecimento", color: "var(--sky)" },
  Control: { label: "Control", color: "#a78bfa" },
  Backoffice: { label: "Backoffice", color: "var(--rose)" },
  "Prospeção": { label: "Prospeção", color: "var(--ink-2)" },
  "Pré-Venda": { label: "Pré-Venda", color: "var(--amber)" },
  Anulado: { label: "Anulado", color: "var(--danger)" },
  "Pedido de Baixa": { label: "Pedido de Baixa", color: "var(--amber)" },
  Baixa: { label: "Baixa", color: "var(--danger)" },
};
