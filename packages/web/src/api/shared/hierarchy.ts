/** Cargos que não podem ser responsáveis (chefia direta) de outros funcionários. */
export const NON_MANAGER_POSITIONS = ["Gestor Comercial"];

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

export function canManage(positionTitle: string | null | undefined) {
  if (!positionTitle) return true;
  return !NON_MANAGER_POSITIONS.some((p) => norm(p) === norm(positionTitle));
}

/**
 * Ativo durante o mês `YYYY-MM`: admitido até ao fim do mês e não inativado antes do início do mês.
 * Um inativo sem data de inativação é tratado como inativo em todos os meses.
 */
export function activeInMonth(e: { status: string; hireDate: string; terminationDate: string | null }, month: string) {
  if (e.hireDate > `${month}-31`) return false;
  if (e.status !== "inativo") return true;
  return !!e.terminationDate && e.terminationDate >= `${month}-01`;
}
