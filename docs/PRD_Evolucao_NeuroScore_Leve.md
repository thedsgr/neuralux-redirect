# PRD - Evolução NeuroScore Leve (aproximação TRIBE v2)

## 1. Resumo executivo
Este PRD define a evolução da ferramenta NeuralUX para aumentar coerência dos scores, capacidade preditiva e confiabilidade operacional, aproximando conceitos de modelos neuroinspirados (como TRIBE v2), porém com arquitetura mais leve e viável para produção.

A proposta não busca replicação neurocientífica completa (fMRI cortical vertex-level), e sim um sistema multimodal eficiente para análise de criativos com evidências interpretáveis por dimensão.

## 2. Contexto e problema
Hoje a ferramenta já entrega análise visual e comparativo A/B, mas ainda há dúvidas de coerência (ex.: dimensões com scores parecidos em criativos muito diferentes), além de risco de dependência excessiva de inferência textual/genérica.

Problemas observados:
- Scores por dimensão com baixa separação em alguns cenários.
- Explicabilidade limitada (por que uma dimensão recebeu aquele valor).
- Variabilidade e confiança por execução não padronizadas.
- Ausência de benchmark contínuo com métricas de negócio (CTR, VTR, retenção etc.).

## 3. Objetivo do produto
Construir um pipeline multimodal leve que:
- Gere scores de atenção por dimensão com maior coerência semântica.
- Explique cada score com evidências objetivas (frames, detecções, intensidade).
- Mantenha custo e latência baixos para uso recorrente em marketing.

## 4. Metas e KPIs

### 4.1 Metas principais (MVP)
- Melhorar coerência de classificação em dimensões-chave (`faces/avatares`, `movimento`, `texto/labels`).
- Reduzir variação run-to-run de score por dimensão.
- Melhorar correlação com performance real de campanha.

### 4.2 KPIs (alvos iniciais)
- `Consistency@dimension`: >= 85% em dataset de validação interna.
- `Run variance` por dimensão: desvio absoluto médio <= 5 pontos.
- `A/B agreement` com métrica real (CTR/VTR/Watch time): +15% vs baseline atual.
- `Latency` por vídeo de 30s (720p): <= 20s em modo padrão.
- `Cost` por vídeo: redução de >= 30% vs pipeline atual (ou manutenção com qualidade superior comprovada).

## 5. Não objetivos (neste ciclo)
- Não produzir inferência clínica/diagnóstica sobre cérebro humano.
- Não substituir experimentos com fMRI/EEG/MEG.
- Não implementar treinamento full-scale de foundation model multimodal.
- Não suportar todos os formatos de mídia em tempo real ao vivo (streaming) no MVP.

## 6. Usuários e casos de uso

### 6.1 Perfis
- Analista de mídia/performance.
- Time criativo.
- Liderança de marketing/produto.

### 6.2 Casos principais
- Comparar Criativo A vs B antes de campanha.
- Diagnosticar por dimensão onde um criativo perde atenção.
- Gerar recomendações táticas de melhoria (cenas, texto, rostos, ritmo).

## 7. Escopo funcional

### 7.1 Ingestão
- Upload de imagem e vídeo.
- Extração de keyframes (adaptativa por mudança de cena).
- Extração de trilha de áudio e transcrição opcional.

### 7.2 Extração de sinais (motor multimodal leve)
- Visual:
  - Detecção de faces/pessoas/avatares.
  - Saliência visual e contraste local.
  - Movimento/fluxo óptico.
  - Densidade de texto em tela.
  - Mudança de layout/cena.
- Áudio:
  - Energia, ritmo, mudanças abruptas, presença de voz.
- Texto/transcrição:
  - Carga semântica, clareza de CTA, complexidade.

### 7.3 Scoring por dimensão
Dimensões alvo (0-100):
- Visual primário
- Faces/avatares
- Layouts/cenas
- Movimento/animação
- Atenção visual
- Texto/labels
- Decisão/memória
- Semântica/contexto

Cada score deve retornar:
- Valor
- Intervalo de confiança
- Evidências (top frames e sinais contribuintes)

### 7.4 Comparativo A/B
- Score lado a lado por dimensão.
- Delta absoluto e relativo.
- Veredito por dimensão e veredito geral.
- Justificativas com evidências (não só texto genérico).

### 7.5 Relato textual (LLM)
- LLM usado apenas para síntese e recomendação.
- Regra: nunca inventar sinais; texto deve ser ancorado nas evidências estruturadas.

## 8. Requisitos não funcionais
- Determinismo parcial: mesma mídia deve manter estabilidade alta de score.
- Observabilidade: logs de features, versão do modelo, tempo por etapa.
- Segurança: chaves em variável de ambiente, sem hardcode em frontend/repo.
- Escalabilidade: processamento assíncrono por job.
- Portabilidade: execução local e cloud.

## 9. Arquitetura proposta

### 9.1 Pipeline
1. `Ingest Service` (upload + validação)
2. `Frame/Audio Extractor`
3. `Feature Extractors` (visual/audio/texto)
4. `Score Engine` (modelo leve calibrado)
5. `Explainability Layer` (evidências por dimensão)
6. `LLM Report Composer` (opcional)
7. `Frontend Renderer` (painel e A/B)

### 9.2 Estratégia de modelagem (leve)
- Abordagem híbrida:
  - Heurísticas robustas + modelo supervisionado leve por dimensão.
- Fase posterior:
  - Distillation: teacher mais pesado offline -> student leve online.
- Evitar inferência contínua pesada em todos os frames:
  - análise barata em todos os frames;
  - análise cara só em keyframes/segmentos críticos.

## 10. Dados e validação

### 10.1 Dataset interno
- Banco de criativos com:
  - rótulos por dimensão (amostra auditada).
  - métricas reais de campanha (CTR, VTR, completion, CPA quando possível).

### 10.2 Protocolo de avaliação
- Split temporal (evitar leakage).
- Avaliação por setor/formato (feed, stories, UGC, institucional).
- Testes de robustez:
  - sem rosto vs com rosto;
  - alto movimento vs estático;
  - alto texto vs baixo texto.

## 11. Roadmap

### Fase 0 (1 semana) - Baseline e instrumentação
- Congelar baseline atual.
- Registrar métricas e outputs de referência.

### Fase 1 (2 semanas) - Motor de features
- Consolidar extração visual/audio/texto.
- Persistir features para auditoria.

### Fase 2 (2 semanas) - Novo score engine
- Treinar/calibrar modelo leve por dimensão.
- Introduzir intervalo de confiança e evidências.

### Fase 3 (1 semana) - UX e interpretabilidade
- Ajustes de interface para mostrar evidências por score.
- Melhorias no comparativo A/B.

### Fase 4 (1 semana) - Validação em produção controlada
- Shadow mode em tráfego real.
- Relatório final com ganho em KPI e decisão de rollout.

## 12. Critérios de aceite
- KPIs mínimos da seção 4 atingidos no dataset de validação.
- Nenhuma dimensão com comportamento sistematicamente incoerente em testes de sanidade.
- Painel A/B exibe evidências rastreáveis por dimensão.
- P95 de latência dentro da meta definida.
- Documentação de modelo/versão publicada.

## 13. Riscos e mitigação
- Risco: overfitting em poucos criativos.
  - Mitigação: validação por janela temporal e por indústria.
- Risco: LLM gerar explicações não suportadas.
  - Mitigação: geração condicionada a JSON de evidências e validação de saída.
- Risco: custo subir com multimodal.
  - Mitigação: keyframeing, cache de embeddings, batch, quantização.
- Risco: interpretação de "neuro" como medição real.
  - Mitigação: comunicação clara de que é predição de atenção, não exame cerebral.

## 14. Governança e compliance
- Gestão de segredos via `.env`/secret manager.
- Política de retenção de mídia e anonimização quando aplicável.
- Mensagens no produto evitando claims clínicos ou determinísticos sobre cérebro.

## 15. Dependências
- Backend de processamento (Python/serviço atual).
- Módulo de análise multimodal e fila de jobs.
- Frontend para exibição de evidências e confiança.
- Ambiente de monitoramento e tracking de métricas.

## 16. Decisões em aberto
- Quais dimensões entram no score geral com maior peso?
- Quais métricas de negócio terão prioridade por vertical?
- Janela máxima de vídeo no plano padrão?
- Política de fallback quando áudio/transcrição falhar?

## 17. Entregáveis
- `NeuroScore v2` (motor de score leve).
- Painel com evidências por dimensão.
- Benchmark A/B com baseline antigo vs novo.
- Guia de interpretação dos scores para time de negócio.

---
Versão: 1.0  
Data: 2026-04-12  
Responsável: Produto + Engenharia NeuralUX
