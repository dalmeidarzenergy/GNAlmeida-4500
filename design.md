# GNAlmeida — Design

**Conceito:** painel de controlo de uma empresa de energia solar. Grafite escuro como uma sala de controlo; o verde-lima elétrico marca o que está "ligado" (ações, progresso, valores positivos) e o âmbar é para avisos e pendentes.

## Cores
- Fundo `--bg` #0c0e0d · Superfície `--surface` #141715 · Superfície 2 `--surface-2` #1b1f1c
- Linha `--line` #262b27 · Texto `--ink` #eef2ea · Texto suave `--ink-2` #9aa39b · Apagado `--ink-3` #636b64
- Primária (lima) `--volt` #c6f432 · Âmbar `--amber` #f5a524 · Céu `--sky` #38bdf8 · Rosa `--rose` #f472b6 · Vermelho `--danger` #f05252

## Tipografia
- Títulos: **Sora** (600/700), com tracking apertado
- Corpo: **Poppins** (400/500), 14px
- Números/valores: **JetBrains Mono** (tabular)

## Layout
- Menu lateral fixo de 248px com grupos (Geral, Recursos Humanos, Vendas, Administração); no telemóvel abre como gaveta
- Conteúdo com largura máxima de 1400px e margem de 32px
- Cabeçalho de página: um rótulo em mono maiúsculas acima do título em Sora
- Cartões: raio de 14px, borda de 1px na cor da linha, sem sombras; o destaque faz-se com borda lima ou com um brilho subtil
- Tabelas densas com cabeçalho em maiúsculas e linhas a 52px

## Movimento
- Entrada em cascata dos KPIs e dos cartões (fade + subida de 8px, 40ms entre cada)
- Modais com fade e escala de 0.98 para 1

## Padrões
- Estados mostrados como pílulas com ponto colorido
- Sempre com estados de carregamento (skeletons) e estados vazios com ação
- Valores em €, no formato pt-PT

## Plano Mensal
- Página de Gestão de Empresa com a tipografia e os cartões do CRM. Fundo cinzento-azulado no modo claro, cabeçalho da tabela azul-petróleo `#1B5F7E` e linha de totais azul-claro `#DCECF5`, com superfícies equivalentes no modo escuro.
- Tabela compacta de largura total no computador; em espaço estreito, cada colaborador e o total passam a cartões de duas colunas. Verde e vermelho distinguem o sinal do lucro.
- O botão «Exportar PDF» descarrega a simulação atual em A4 horizontal, com tabela paginada e resumo mensal. O PDF mantém o fundo branco e as cores dos totais e do lucro, independentemente do tema do CRM.
