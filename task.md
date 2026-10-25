# Previsão de Pagamentos — vendas do CRM com as regras do Auto Iberdrola

## Objetivo
Na aba **Previsão de Pagamentos** (`/pagamentos`), calcular a previsão a partir das **vendas inseridas no CRM** (não dos ficheiros Excel da Iberdrola), aplicando **as mesmas regras do Auto Iberdrola**. Acrescentar um **quadro de desbloqueio de comissões** com quantas vendas faltam.

## Decisões confirmadas com o utilizador
1. Quadro de desbloqueio: **ambos**, com seletor (por comercial / por equipa).
2. "Faltam X vendas": mostrar **as duas contagens separadas** — vendas em fornecimento e vendas registadas (todas).
3. Critério do desbloqueio: **mínimo do 1.º escalão da tabela comisional**.
4. Período: **mês selecionado** apenas.
5. Regras: **exatamente as mesmas** do Auto Iberdrola (automáticas + manuais + VNC + desbloqueio % + Folha de Km).

## Levantamento feito
- `buildBreakdown(m)` em `packages/web/src/api/routes/payments.ts` já calcula, a partir do **CRM** (sales + sale_status_history):
  vendas que vêm a pagamento ("Em Fornecimento" com entrada no mês), chargebacks (baixas dentro de 3 meses), escalão, unit, gross, penalidades, km, CE, equipas.
- `buildCalc(m)` em `packages/web/src/api/routes/iberdrola.ts`: aplica as **regras** (automáticas por condição sobre coluna, manuais atribuídas, VNC, desbloqueio %, Folha de Km).
  - Importante: as regras do Auto avaliam a condição sobre a **linha do Excel**. No CRM não há essa linha → a condição tem de ser avaliada sobre os **campos da venda** (`sales.details` + campos da venda).

## Plano de implementação

### 1. API — novo `previsao` em `payments.ts`
- Reutilizar `buildBreakdown(m)` como motor (vendas do CRM).
- Regras: **só as manuais** atribuídas ao comercial no mês (+ VNC + Folha de Km).
  - **As automáticas NÃO são aplicadas** (condição sobre coluna do Excel não existe no CRM).
  - Não é preciso refactor nem mexer em `iberdrola.ts`: copiar a lógica das manuais para a previsão, deixando o Auto intacto.
- Desbloqueio igual para todos: **contagem real face ao 1.º escalão**, ignorando o `forceCommissionsPct`.
  - `unlock: { bandMin, fornecimentoContam, faltamFornecimento, registadasContam, faltamRegistadas, bloqueadas, desbloqueado }`
- Contagens:
  - "em fornecimento" = vendas **BTN (Luz/Dual)** com entrada em fornecimento no mês (o que apura o escalão)
  - "registadas" = **todas as vendas do mês menos Baixa e Anuladas** (inclui em transição)
- Agregado por **equipa** (soma dos membros + chefe) para o seletor do quadro.

### 2. Frontend — `payments.tsx`
- Novo quadro **"Desbloqueio de comissões"** no topo:
  - seletor `Por comercial | Por equipa`
  - por linha: nome, escalão mínimo, vendas em fornecimento (contam / faltam), vendas registadas (contam / faltam), barra de progresso, estado (bloqueado/desbloqueado)
- Manter a tabela atual de previsão (valores que já vêm do `breakdown` do CRM).

### 3. Verificação
- `bunx --bun tsc --noEmit -p packages/web`
- `bun run --cwd packages/web build`
- Servidor local em tmux + Playwright: abrir `/pagamentos`, confirmar que o quadro aparece e que os números batem com o mês.

## Estado
- [x] Levantamento
- [ ] 1. Extrator de regras partilhado (lib/rules-engine.ts)
- [ ] 2. `previsao` na API de pagamentos + agregado por equipa
- [ ] 3. Quadro no frontend
- [ ] 4. Verificação (tsc + build + Playwright)
- [ ] 5. Commit + push

## Notas
- NÃO mexer no Auto Iberdrola (utilizador: "está feito, não é para mexer mais"). Refactor só se mantiver o resultado idêntico.
- `buildBreakdown` é o motor do CRM; a previsão é um recorte sobre ele.
