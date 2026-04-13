# NeuralUX — UX Brain Analyzer

Dashboard interativo que simula a ativação cerebral em resposta a interfaces de usuário. Faça upload de screenshots ou vídeos de telas e visualize quais regiões do cérebro são mais estimuladas pelo design.

## Funcionalidades

- **Brain Mapping 3D** — Visualização interativa de um cérebro em Three.js com hotspots clicáveis para 8 regiões cerebrais (V1, FFA, PPA, V5, IPS, Broca, PFC, Semântica)
- **Análise de tela** — Upload de screenshots (.png, .jpg, .webp) ou vídeos (.mp4, .mov) para análise via backend Gradio
- **UX Score** — Pontuação consolidada de 0 a 100 baseada na ativação média das regiões
- **A/B Test** — Comparação lado a lado de duas versões de interface, com relatório de diferenças por região
- **AI Insights** — Relatório gerado por IA com recomendações de melhoria de UX

## Stack

- HTML / CSS / JavaScript (vanilla)
- [Three.js](https://threejs.org/) — Visualização 3D do cérebro com OrbitControls
- [Gradio](https://gradio.app/) — Backend de inferência (hospedado via Google Colab)
- GitHub Gist — Descoberta dinâmica da URL do servidor Gradio

## Como usar

1. Inicie o notebook Colab que sobe o servidor Gradio
2. Abra o dashboard (`index.html`) — ele detecta o servidor automaticamente via Gist
3. Faça upload de um screenshot e clique em **Analyze**
4. Explore o mapa cerebral 3D e os scores por região
5. Use a aba **A/B Test** para comparar duas versões de tela

## Estrutura

```
index.html   — Layout do dashboard (análise + A/B test)
app.js       — Lógica principal, Three.js, integração com API Gradio
style.css    — Design system e estilos responsivos
backend/     — NeuroScore v2 Lite (pipeline leve determinístico)
evaluation/  — Métricas de benchmark e script de validação
docs/        — PRD e plano de validação
```

## Evolução PRD (Fase 0/1)

A base da evolução para um motor "neuro-inspired" leve já foi adicionada:

- [PRD_Evolucao_NeuroScore_Leve.md](docs/PRD_Evolucao_NeuroScore_Leve.md)
- [VALIDATION_PLAN.md](docs/VALIDATION_PLAN.md)
- [backend/README.md](backend/README.md)

### Rodar benchmark local

```bash
python3 evaluation/run_validation.py
```
