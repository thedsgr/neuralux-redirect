# Plano de Fine Tuning de UI

## Objetivo
Corrigir a interface com foco em três frentes: espaçamento, sistema de cores/contraste e comparativo A/B. O plano prioriza ajustes que aumentam legibilidade, consistência visual e clareza do valor entregue sem alterar a arquitetura do produto.

## Escopo prático
Este plano cobre apenas ajustes visuais e de apresentação:

1. Harmonização de spacing e alinhamentos.
2. Padronização de cor, contraste e estados visuais.
3. Reforço da leitura do comparativo A/B e do delta entre as opções.
4. Validação objetiva em desktop e mobile.

## Prioridades

### P0 - Bloqueadores de leitura e confiança
Itens que impedem a interface de ser entendida com segurança.

1. Ajustar espaçamentos quebrados entre blocos principais.
2. Corrigir contraste insuficiente em textos, rótulos e elementos secundários.
3. Deixar o comparativo A/B com hierarquia visual clara e delta imediatamente identificável.
4. Eliminar qualquer ambiguidade entre estados ativo, inativo e selecionado.

### P1 - Consistência e polimento funcional
Itens que não bloqueiam o uso, mas reduzem qualidade percebida.

1. Uniformizar padding, gap e margens entre cartões, tabelas e seções.
2. Consolidar tokens de cor para evitar variação entre componentes equivalentes.
3. Padronizar peso tipográfico e uso de superfície/contorno em blocos repetidos.
4. Revisar responsividade do comparativo em larguras menores.

### P2 - Acabamento e refinamento
Itens de ajuste fino depois dos blocos críticos.

1. Reduzir ruído visual em elementos de suporte.
2. Ajustar microvariações de densidade entre componentes similares.
3. Melhorar a leitura de estados hover, foco e disabled.
4. Revisar pequenas quebras de alinhamento em bordas, ícones e badges.

## Checklist por área

### 1) Spacing
Checklist objetivo:

1. Definir uma escala única de spacing para a tela e mapear os usos reais.
2. Remover valores ad hoc que não correspondem à escala.
3. Garantir consistência de padding interno entre cards equivalentes.
4. Garantir consistência de gap entre título, subtítulo, métrica e ação.
5. Revisar alinhamento vertical de linhas, badges e botões em blocos de comparação.
6. Confirmar que o espaçamento em mobile não cria quebras ou compressão excessiva.

### 2) Color system
Checklist objetivo:

1. Consolidar cores de texto, fundo, borda, destaque e feedback em tokens nomeados.
2. Reduzir a quantidade de tons parecidos que competem no mesmo nível hierárquico.
3. Garantir que o estado primário do comparativo tenha uma cor de destaque única e consistente.
4. Garantir que alertas, sucesso e neutral não reutilizem a mesma saturação sem intenção.
5. Verificar contraste entre texto e superfície em todos os estados principais.
6. Validar que cores de suporte não roubam atenção do dado principal.

### 3) Comparativo A/B
Checklist objetivo:

1. Expor o vencedor com hierarquia visual inequívoca.
2. Mostrar o delta com sinal, unidade e direção claramente visíveis.
3. Garantir que A e B usem rótulos estáveis e fáceis de comparar.
4. Afastar ruído visual das métricas principais do comparativo.
5. Usar alinhamento e agrupamento para que comparação horizontal seja imediata.
6. Evitar qualquer layout que force leitura linha a linha para entender o vencedor.
7. Revisar se a versão mobile preserva a leitura do delta sem overflow.

### 4) Validação
Checklist objetivo:

1. Validar contraste com ferramenta objetiva, não por percepção subjetiva.
2. Testar a tela com conteúdo curto, médio e longo para verificar estabilidade.
3. Validar desktop e mobile em larguras representativas.
4. Revisar estados default, hover, focus, selected e disabled.
5. Checar se a diferença entre A e B continua clara após compressão de layout.
6. Registrar antes/depois com captura comparativa da mesma visão.

## Critérios de aceite

### Contraste e acessibilidade
1. Texto normal deve atender contraste mínimo AA de 4.5:1.
2. Texto grande deve atender contraste mínimo AA de 3:1.
3. Elementos de interação devem ser distinguíveis sem depender só de cor.
4. Estados focus devem ser visíveis em fundo claro e escuro, se aplicável.

### Spacing e consistência
1. Componentes equivalentes devem usar o mesmo token de spacing para padding e gap.
2. Variações fora da escala oficial devem ser zero nos blocos tocados.
3. Alinhamentos horizontais e verticais devem permanecer estáveis entre desktop e mobile.
4. Não deve haver sobreposição, corte ou salto visual em títulos, métricas e ações.

### Comparativo A/B
1. O vencedor deve ser identificado em até uma leitura visual rápida do bloco.
2. O delta deve estar explícito em formato legível e consistente.
3. A diferença entre A e B deve ser perceptível sem depender do texto auxiliar.
4. O bloco deve permanecer compreensível em uma tela compactada de mobile.

### Qualidade de entrega
1. Nenhum bloco crítico pode ficar com contraste abaixo do mínimo.
2. Nenhum componente tocado pode manter padding inconsistente em relação ao padrão definido.
3. A leitura do comparativo não pode piorar depois da adaptação responsiva.
4. Toda alteração precisa ter evidência visual antes/depois para aprovação.

## Sequência de implementação

### Sprint 1 - Correções P0
1. Mapear os blocos com maior quebra de leitura.
2. Corrigir spacing quebrado nos containers principais.
3. Ajustar contraste dos textos e dos elementos mais frágeis.
4. Redesenhar a hierarquia do comparativo A/B para deixar o delta explícito.
5. Fazer uma checagem rápida em desktop e mobile.

### Sprint 2 - Consistência P1
1. Substituir valores soltos por tokens de spacing e cor.
2. Equalizar paddings, gaps e alinhamentos entre componentes repetidos.
3. Refinar estados visuais e pesos tipográficos.
4. Testar variação de conteúdo curto e longo no comparativo.

### Sprint 3 - Polimento P2 e validação final
1. Corrigir pequenos desalinhamentos e ruídos visuais.
2. Revisar estados hover, focus e disabled.
3. Produzir comparação visual antes/depois.
4. Validar critérios de aceite e fechar pendências.

## Saída esperada
Ao final do plano, a interface deve apresentar:

1. Espaçamento previsível e consistente.
2. Sistema de cor mais controlado e com contraste validado.
3. Comparativo A/B mais rápido de ler e com delta inequívoco.
4. Base objetiva para aprovar ou rejeitar mudanças visuais futuras.

## Regra de execução
Não avançar para refinamento visual enquanto os itens P0 não estiverem resolvidos e verificados. Primeiro clareza, depois consistência, depois acabamento.
