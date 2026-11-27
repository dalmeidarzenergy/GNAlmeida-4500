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
- O botão «Exportar PDF» descarrega a simulação atual em A4 horizontal, com tabela paginada e resumo mensal. Os logótipos RZ Energy e Iberdrola (Colaborador Oficial) aparecem no cabeçalho de todas as páginas. O PDF mantém o fundo branco e as cores dos totais e do lucro, independentemente do tema do CRM.

## Gestão de Territórios
- A página está no menu «Gestão Territorial», junto a «Terreno D2D» e «Histórico GPS», sem alterar o endereço ou as permissões.
- Uma linha por concelho, com distrito, sem campos Freguesia ou Aldeia na tabela, formulário ou modelo Excel. A migração usa a data de varrimento mais recente de cada concelho e mantém a tabela antiga intacta como histórico. O botão «Histórico» mostra as datas dos registos anteriores em modo de consulta.
- «KM» mostra os quilómetros de ida, de carro, desde a Rua do Mato, 1, 2000-531 Póvoa de Santarém, até à sede do concelho. O catálogo CAOP/OpenStreetMap é local e distingue concelho não reconhecido de ausência de rota exclusivamente por estrada.
- «Nº contratos» soma todo o histórico de Vendas no estado «Em Fornecimento» por concelho, sem depender da freguesia ou localidade da venda. O total só está disponível com acesso global a Vendas.
- O Excel anterior continua a ser aceite: as colunas antigas são ignoradas e, para novos concelhos repetidos no mesmo ficheiro, fica a data mais recente. A importação não altera os concelhos já registados.
- A ação Eliminar pede confirmação e afeta só a linha ativa, sem alterar Vendas nem o arquivo histórico.
- Pesquisa, distrito e concelho ficam acima da tabela. Os filtros avançados, num painel recolhível com os mesmos controlos do CRM, combinam varrimento, descanso, contratos (só com acesso global a Vendas) e distância. A lista aplica os filtros antes de paginar, com 20 registos por página.
- O nome do concelho abre um detalhe só para perfis com acesso global a Vendas. A interface separa o total em fornecimento do total de todos os estados e agrupa os registos por funcionário e mês/ano da venda, com referências e estado atual, sem dados de clientes.
