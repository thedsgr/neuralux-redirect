# PRD - NeuralUX: Confiabilidade, Calibração e Insights Acionáveis

## 1. Resumo executivo
Este PRD consolida a próxima evolução do NeuralUX com foco em sete pilares:

1. Estabilidade da camada de IA textual (Anthropic) com fallback confiável.
2. Calibração dos scores das dimensões com dados reais de negócio.
3. Explicabilidade objetiva por dimensão (evidências verificáveis).
4. Pipeline de vídeo mais eficiente (keyframes adaptativos + custo controlado).
5. Validação contínua em CI com critérios de promoção claros.
6. Contexto cognitivo da análise (top-down modulation por tipo de interface).
7. UX de decisão para A/B (recomendação final + ações práticas).

Objetivo central: transformar o NeuralUX em um sistema previsível, auditável e contextualmente inteligente para decisão de produto e marketing.

## 2. Contexto e problema atual
Sintomas observados no produto:
- Relatórios de IA alternando entre resposta completa e fallback por falha de API/modelo.
- Scores por dimensão nem sempre coerentes com o conteúdo (ex.: faces similares entre criativos distintos).
- Baixa transparência sobre "por que" cada score foi atribuído.
- Custo e latência de vídeo com margem de otimização.
- Ausência de gate automatizado para impedir regressões de qualidade.

## 3. Objetivos do produto
- Aumentar confiança operacional do sistema (menos falhas silenciosas).
- Melhorar correlação de score com KPI real de campanha.
- Fornecer explicações que o time consiga verificar em evidências concretas.
- Reduzir custo/latência de análise por mídia mantendo qualidade.
- Entregar recomendação A/B acionável para tomada de decisão rápida.

## 4. Não objetivos
- Não realizar diagnóstico clínico/neurofisiológico.
- Não substituir experimentação com fMRI/EEG/MEG.
- Não treinar foundation model completo no curto prazo.
- Não suportar streaming de vídeo em tempo real no primeiro ciclo (análise em tempo real de screenshots já é suportada).

## 5. Usuários alvo
- Analista de performance/mídia.
- Time criativo.
- Liderança de marketing/produto.

## 5.1 Matriz de priorização

| Prioridade | Pilar | Justificativa |
|------------|-------|---------------|
| **MUST** | A — Estabilidade da IA textual | Sem isso o produto quebra de forma imprevisível. Base para todos os outros pilares. |
| **MUST** | C — Explicabilidade por dimensão | Diferencial competitivo e requisito de confiança do usuário. |
| **MUST** | F — UX de decisão para A/B | Entrega valor direto ao usuário final. Viabiliza adoção. |
| **SHOULD** | D — Pipeline de vídeo otimizado | Expande o produto para vídeo, mas imagem já cobre o caso principal. |
| **SHOULD** | B — Calibração com dados reais | Alto impacto na qualidade, mas depende de dataset externo. |
| **MUST** | G — Contexto cognitivo | Baixo esforço, alto impacto na qualidade da análise. Diferencia de qualquer concorrente. |
| **COULD** | E — Validação contínua e gates | Importante para escala, mas aceitável operar sem no primeiro ciclo. |

Em caso de corte de escopo, os pilares MUST são inegociáveis. Os SHOULD podem ser adiados para o ciclo seguinte. O COULD é investimento de infraestrutura que pode aguardar a migração do Colab.

## 6. Escopo funcional

### 6.1 Pilar A - Estabilidade da IA textual
#### Requisitos
- Suporte a `ANTHROPIC_MODEL` por variável de ambiente.
- Catálogo interno de modelos permitidos com fallback ordenado.
- Tratamento explícito de erro (status code + body truncado + causa classificada).
- Cache de relatório por hash de entrada (`media_hash + scores_hash + model_id`).
- Fallback deterministic report quando IA falhar (sem bloquear fluxo).

#### Critérios de aceite
- Taxa de sucesso de geração IA >= 98% em ambiente estável.
- Erros 4xx/5xx exibem motivo técnico claro no log e no painel interno.
- Reanálises idênticas reutilizam cache e reduzem custo de token.

### 6.2 Pilar B - Calibração dos scores com dados reais
#### Plano de coleta do dataset
Esta é a dependência mais crítica do pilar. Sem dataset, o pilar inteiro trava.

**Fontes prioritárias (em ordem de viabilidade):**
1. **Dados internos de campanha:** Exportar criativos + métricas (CTR, VTR, watch time) de plataformas de ads já em uso (Meta Ads, Google Ads, TikTok Ads). Meta mínima: 200 pares criativo-métrica.
2. **Benchmark público:** Datasets acadêmicos de saliência visual (MIT/Tuebingen Saliency Benchmark, SALICON) como proxy inicial para validar V1/IPS.
3. **Coleta controlada:** Rodar NeuralUX em batch com 50-100 criativos reais, coletar scores, correlacionar com métricas de performance conhecidas.

**Timeline de coleta:**
- Semana 1-2: Definir formato do dataset (schema) e exportar dados disponíveis.
- Semana 2-3: Rodar NeuralUX em batch e gerar scores para o dataset.
- Semana 3-4: Análise exploratória de correlação antes de treinar calibrador.

Se o dataset mínimo (200 pares) não estiver disponível até a Semana 4, adiar este pilar para o próximo ciclo e priorizar os pilares MUST.

#### Requisitos
- Dataset de calibração com criativo + métricas reais (CTR, VTR, completion, watch time).
- Treinamento de calibrador leve por dimensão (ex.: regressão/gradient boosting leve).
- Versionamento de pesos/modelo de calibração (`calibration_version`).
- Possibilidade de calibradores por vertical/formato (ads feed, stories, institucional).

#### Critérios de aceite
- Ganho de >= 15% em `A/B agreement` vs baseline.
- Redução de inconsistência em dimensões críticas (`faces`, `motion`, `text`).

### 6.3 Pilar C - Explicabilidade por dimensão
#### Requisitos
- Cada dimensão deve retornar:
  - score (0-100)
  - confidence
  - top evidências estruturadas
- Evidências mínimas por tipo:
  - `faces_detected`
  - `text_density`
  - `motion_intensity`
  - `scene_changes`
  - `salience_peaks`
- UI deve exibir resumo curto + detalhes sob demanda.

#### Critérios de aceite
- 100% das dimensões com campo de evidência preenchido (ou motivo explícito de indisponibilidade).
- Time de produto consegue auditar manualmente 10 amostras sem ambiguidade.

### 6.4 Pilar D - Pipeline de vídeo otimizado
#### Estado atual
O backend (notebook Colab) processa apenas imagens estáticas via CLIP ViT-L/14. Não há pipeline de vídeo implementado. Este pilar requer construir o pipeline do zero, o que aumenta o risco da timeline.

#### Abordagem incremental recomendada
1. **Fase D.1 (MVP):** Extrair N frames uniformemente espaçados do vídeo, processar cada um como imagem, agregar scores (média ponderada). Baixo esforço, já entrega valor.
2. **Fase D.2 (Otimização):** Keyframes adaptativos por mudança de cena (scene detection via histogram diff ou PySceneDetect).
3. **Fase D.3 (Eficiência):** Pipeline 2 estágios + cache + perfis de processamento.

Se a Fase 3 do roadmap (semanas 4-6) ficar apertada, entregar apenas D.1 e adiar D.2/D.3.

#### Requisitos
- Extração de keyframes adaptativos por mudança de cena.
- Pipeline em 2 estágios:
  - estágio barato em todos os segmentos
  - estágio caro apenas em segmentos críticos
- Cache de embeddings/features intermediárias por hash de mídia.
- Perfil de processamento: `fast`, `standard`, `high_fidelity`.

#### Critérios de aceite
- **D.1 (MVP):** Vídeo de até 60s retorna scores agregados em <30s.
- **D.2/D.3 (completo):** Redução >= 30% no custo médio por vídeo (modo standard) vs baseline. P95 de latência <= 20s para vídeo de 30s/720p (modo standard).

### 6.5 Pilar E - Validação contínua e gates
#### Pré-requisito de infraestrutura
O projeto atualmente roda no Google Colab, que não suporta pipelines de CI.
Para viabilizar este pilar, é necessário migrar o backend para um ambiente com execução automatizada:
- **Opção 1 (leve):** GitHub Actions com GPU runner self-hosted ou serviço como Modal/Replicate para execução do benchmark.
- **Opção 2 (completa):** Deploy do backend como serviço (Railway, Render, ou VM com GPU) com GitHub Actions disparando os testes.
- **Opção incremental:** Manter Colab para desenvolvimento e rodar benchmark manualmente com script + relatório commitado no repo. Automatizar apenas quando houver infra.

#### Requisitos
- Pipeline de CI executando benchmark em dataset de validação.
- Cálculo automático de:
  - `Consistency@dimension`
  - `Run variance`
  - `A/B agreement`
  - latência/custo por estágio
- Gate de release com bloqueio em regressão.

#### Critérios de aceite
- Release bloqueado automaticamente se qualquer KPI crítico quebrar meta.
- Relatório de benchmark versionado e anexado ao build.

### 6.6 Pilar G - Contexto cognitivo da análise (top-down modulation)

#### Motivação
O cérebro não processa interfaces no vácuo. Antes de abrir um app de banco, o usuário já ativou expectativas de segurança, precisão numérica e tomada de decisão. Esse fenômeno (top-down modulation) significa que a **relevância de cada região cerebral muda conforme o tipo de interface**. Um score baixo de "movimento" (V5) é irrelevante em banking mas preocupante em gaming.

Sem esse contexto, a ferramenta trata todas as interfaces como iguais — gerando diagnósticos genéricos e recomendações que não se aplicam.

#### Funcionamento
O usuário seleciona o contexto antes da análise (dropdown no frontend). O contexto afeta:

1. **Pesos por região no UX Score** — Cada contexto define a importância relativa das 8 regiões. O UX Score final passa de média simples para média ponderada pelo contexto.
2. **Relatório da IA** — O prompt inclui o contexto para que as recomendações sejam relevantes (ex: "para um app financeiro, o score baixo de Broca indica que labels e informações numéricas não estão suficientemente claros").
3. **Benchmarks de referência** — Com o tempo, acumular scores médios por contexto para mostrar "sua tela de banking está acima/abaixo da média do setor".

#### Contextos iniciais e pesos sugeridos

Escala de peso: 0.3 (pouco relevante) a 1.5 (crítico). Peso 1.0 = neutro.

| Contexto | V1 | FFA | PPA | V5 | IPS | Broca | PFC | Semantic | Foco principal |
|----------|-----|-----|-----|-----|-----|-------|-----|----------|----------------|
| **Banking / Fintech** | 1.0 | 0.5 | 1.2 | 0.3 | 1.0 | 1.5 | 1.5 | 1.0 | Clareza textual, decisão, layout |
| **E-commerce** | 1.0 | 0.8 | 1.3 | 0.7 | 1.2 | 1.0 | 1.5 | 1.0 | Decisão de compra, layout, atenção |
| **Gaming / Entretenimento** | 0.8 | 1.2 | 0.7 | 1.5 | 1.0 | 0.5 | 0.7 | 0.8 | Movimento, faces, imersão visual |
| **Content / News** | 1.0 | 0.7 | 1.0 | 0.5 | 1.0 | 1.5 | 0.8 | 1.5 | Leitura, semântica, compreensão |
| **SaaS / Produtividade** | 1.0 | 0.4 | 1.3 | 0.5 | 1.2 | 1.2 | 1.3 | 1.0 | Layout, atenção, decisão, texto |
| **Social Media** | 0.8 | 1.5 | 0.8 | 1.2 | 1.0 | 0.7 | 0.8 | 1.0 | Faces, movimento, engajamento |
| **Saúde / Health** | 1.0 | 0.6 | 1.0 | 0.3 | 1.0 | 1.5 | 1.3 | 1.3 | Clareza, confiança, semântica |
| **Genérico** | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | Sem ponderação (comportamento atual) |

Os pesos são hipóteses iniciais baseadas em literatura de neurociência cognitiva aplicada. Devem ser refinados com o dataset de calibração (Pilar B) quando disponível.

#### Implementação (3 camadas)

**Frontend (baixo esforço):**
- Dropdown/selector antes do botão "Analyze" com os contextos acima.
- Contexto selecionado é enviado junto com o arquivo na chamada da API.
- UX Score exibido já com ponderação.

**Backend — scoring (médio esforço):**
- Tabela de pesos por contexto no notebook/backend.
- `UX Score = Σ(score_i × peso_i) / Σ(peso_i)` em vez de média simples.
- Contexto incluído no hash de cache (mesmo arquivo + contexto diferente = análise diferente).

**Backend — relatório IA (baixo esforço):**
- Incluir contexto no prompt do relatório: "A interface analisada é do tipo {contexto}. Considere que para este tipo de aplicação, as regiões mais críticas são {regiões com peso > 1.0}."
- A IA adapta diagnóstico, pontos de atenção e recomendações ao domínio.

#### Critérios de aceite
- Dropdown funcional com no mínimo 5 contextos + "Genérico".
- UX Score calculado com pesos do contexto selecionado.
- Relatório da IA menciona o contexto e adapta recomendações ao domínio.
- Contexto "Genérico" reproduz o comportamento atual (sem regressão).

### 6.7 Pilar F - UX de decisão para A/B
#### Requisitos
- Card de decisão final com:
  - vencedor sugerido
  - ganho esperado por dimensão
  - risco/confiança da recomendação
- Lista de 3-5 ações concretas de melhoria no criativo perdedor.
- Justificativa sempre ancorada em evidência estruturada.

#### Critérios de aceite
- Usuário consegue decidir A/B sem ler relatório completo em <= 60s.
- Feedback qualitativo positivo de clareza em testes internos.

## 7. Requisitos não funcionais
- Determinismo: variação controlada entre execuções idênticas.
- Observabilidade: logs com `request_id`, versão de modelo, tempo por etapa, custo estimado.
- Segurança: segredos somente via env/secrets manager (sem hardcode em notebook/repo).
- Resiliência: fallback automático sem quebrar resposta JSON do dashboard.
- Portabilidade: execução local e Colab/cloud.

## 8. Arquitetura proposta (incremental)
1. `Ingestion` (upload + hash + metadados + contexto cognitivo)
2. `Frame/Audio preprocessing` (keyframes adaptativos)
3. `Feature extraction` (visual/audio/texto)
4. `Context engine` (pesos por tipo de interface, modulação top-down)
5. `Scoring engine` (base + calibrador + ponderação por contexto)
6. `Explainability engine` (evidências por dimensão)
7. `LLM report service` (com cache + fallback + prompt contextual)
8. `Decision service` (vencedor A/B + ações)
9. `Frontend` (painel + seletor de contexto + comparativo + decision card)

## 9. Métricas e KPIs

### Qualidade analítica
- `Consistency@dimension >= 85%`
- `Run variance (MAD) <= 5 pontos`
- `A/B agreement` +15% vs baseline

### Eficiência
- `P95 latency <= 20s` (30s/720p, standard)
- `Cost/video` -30% vs baseline (ou custo estável com ganho de qualidade comprovado)

### Confiabilidade
- `LLM success rate >= 98%`
- `Fallback integrity = 100%` (sempre retorna JSON válido com relatório mínimo)

### UX de decisão
- Tempo médio para decisão A/B <= 60s
- Taxa de uso do card de decisão >= 70% das sessões A/B

## 10. Roadmap (8 semanas)

### Fase 1 (Semana 1-2) - Confiabilidade IA + segurança [MUST]
- Modelo dinâmico por env (`ANTHROPIC_MODEL`)
- Erro estruturado e telemetria
- Cache de relatório por hash de entrada
- Limpeza de segredos hardcoded
- **Gate:** Relatório gerado com sucesso em 98% dos testes manuais.

### Fase 2 (Semana 2-4) - Explicabilidade + contexto + decisão A/B [MUST]
- Evidências estruturadas completas por dimensão (confidence + top evidências)
- Exibição compacta + detalhes sob demanda no frontend
- Dropdown de contexto cognitivo (Pilar G) no frontend + pesos no backend + prompt contextual
- Card de decisão A/B com vencedor + ganho + ações concretas
- **Gate:** 100% das dimensões com evidência preenchida. Contexto funcional com ≥5 opções. Decisão A/B em <60s.

### Fase 3 (Semana 4-6) - Vídeo MVP + coleta dataset [SHOULD]
- Pipeline de vídeo MVP (N frames uniformes → scores agregados)
- Keyframes adaptativos se timeline permitir
- Paralelamente: coleta e estruturação do dataset de calibração (ver Pilar B)
- **Gate:** Vídeo de 60s retorna scores em <30s. Dataset com ≥100 pares coletados.

### Fase 4 (Semana 6-8) - Calibração + refinamentos [SHOULD]
- Análise exploratória de correlação score vs KPI real
- Treino e validação de calibrador leve (se dataset ≥200 pares disponível)
- Versionamento de calibrador
- Se dataset insuficiente: documentar gaps e adiar para próximo ciclo
- **Gate:** Ganho ≥15% em A/B agreement vs baseline (ou decisão documentada de adiar).

### Backlog (pós-ciclo) [COULD]
- Pilar E: CI gates e benchmark automatizado (requer migração de infra do Colab)
- Pipeline de vídeo D.2/D.3 (2 estágios + cache + perfis)
- Calibradores por vertical/formato

## 11. Plano de experimentação
- Shadow mode: novo motor roda em paralelo ao atual.
- Comparação offline: baseline vs candidato no mesmo conjunto temporal.
- Experimento controlado: parte dos usuários recebe decision card novo.

## 12. Dependências

| Dependência | Pilar | Status | Plano de mitigação |
|-------------|-------|--------|-------------------|
| `ANTHROPIC_API_KEY` com créditos | A, C, F | Disponível | — |
| Dataset de campanha (≥200 pares criativo + KPI) | B | A coletar | Plano de coleta na seção 6.2. Adiar pilar se insuficiente. |
| Definição de verticals prioritárias | B | A definir | Começar com formato genérico, especializar depois. |
| Ambiente de CI com GPU | E | Não disponível | Manter benchmark manual até migrar do Colab. Ver opções na seção 6.5. |
| Token GitHub para publicação de URL | A | Disponível | Gist já configurado. |

## 13. Riscos e mitigação
- Risco: sobreajuste do calibrador.
  - Mitigação: split temporal e validação por slices.
- Risco: custo de IA textual subir.
  - Mitigação: cache + fallback + limite de tokens.
- Risco: evidências incompletas em alguns formatos de mídia.
  - Mitigação: indicador de cobertura + fallback explícito por dimensão.
- Risco: regressão silenciosa em produção.
  - Mitigação: CI gate obrigatório antes de promover versão.

## 14. Critérios de Go/No-Go
Go somente se:
1. Todos os KPIs críticos atingidos (qualidade + eficiência + confiabilidade).
2. Sem regressão de UX nas jornadas Analyze e A/B.
3. Sem segredos hardcoded detectados no repositório.
4. Benchmark e relatório de validação anexados ao release.

## 15. Entregáveis finais
- Camada IA robusta com fallback e cache.
- Score engine calibrado por dados reais.
- Explicabilidade estruturada por dimensão no frontend.
- Pipeline de vídeo otimizado com perfis.
- CI de validação com gates de promoção.
- Módulo de recomendação final A/B com ações práticas.

---
Versão: 1.2
Data: 2026-04-13
Responsável: Produto + Engenharia NeuralUX
Status: Draft revisado — priorização definida, contexto cognitivo adicionado, dependências detalhadas
