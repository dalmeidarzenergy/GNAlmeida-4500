# Regras — implementado

Regras de pagamento sobre o Auto Iberdrola.

- `rules` (auto/manual) + `rule_assignments` (funcionário + mês) no schema.
- API `rules` (list/create/update/remove/assignments) em `routes/rules.ts`.
- Página Regras com CRUD completo.
- Botão "Atribuir" no detalhe do comercial (Autos Finais) para regras manuais.
- Separador "Autos" na ficha do funcionário (resumo detalhado por mês + vendas).
- `buildCalc` aplica regras automáticas (condição sobre coluna do Excel) e manuais atribuídas.
