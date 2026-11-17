import type { QueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

/**
 * Vistas que somam os mesmos dados: vendas, tabelas comissionais, tabelas dos
 * chefes, ficheiros da Iberdrola, pagamentos registados, funcionários e frota.
 *
 * O Centro de Custos e a Previsão de Pagamentos juntam tudo isto numa conta só.
 * Se cada mutação invalidar apenas a sua própria rota, os números ficam velhos
 * no ecrã — foi o que aconteceu ao mudar valores de uma tabela comissional e a
 * previsão do Centro de Custos não mexer. Por isso qualquer escrita bem
 * sucedida invalida também estas rotas (ver `provider.tsx`).
 */
const CHAVES_DERIVADAS = () => [
  orpc.company.key(),
  orpc.payments.key(),
  orpc.commissionTables.key(),
  orpc.chiefTables.key(),
  orpc.iberdrola.key(),
  orpc.hr.key(),
  orpc.fleet.key(),
  orpc.reports.key(),
];

/** Marca como velhas as vistas que dependem de dados de outras rotas. */
export function invalidarContas(qc: QueryClient) {
  for (const queryKey of CHAVES_DERIVADAS()) void qc.invalidateQueries({ queryKey });
}
