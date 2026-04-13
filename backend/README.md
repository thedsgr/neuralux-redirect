# Backend - NeuroScore v2 Lite

Pipeline leve em Python para a Fase 1 do PRD. O foco aqui e consolidar features multimodais deterministicas sem depender de ML pesado.

## O que este backend entrega

- `extract_visual_features(media_path)`
- `extract_audio_features(media_path)`
- `extract_text_features(text)`
- `compute_dimension_scores(features)`
- `build_evidence(features, scores)`
- `analyze_media(media_path, transcript=None)`

O output final preserva compatibilidade com o frontend atual:

- `scores`
- `relatorio`
- `elapsed`

E adiciona os campos novos pedidos para a evolucao do motor:

- `ux_score`
- `confidence_by_region`
- `evidence_by_region`
- `features`

## Como rodar localmente

Use o modulo diretamente:

```bash
python3 backend/neuroscore_v2.py /caminho/para/media.mp4 --transcript "optional transcript" --pretty
```

Ou importe em Python:

```python
from backend.neuroscore_v2 import analyze_media

result = analyze_media("/caminho/para/media.png", transcript=None)
```

## Dependencias opcionais

O pipeline funciona sem dependencias externas, mas melhora quando estas estao disponiveis:

- `Pillow` para estatisticas visuais por pixel
- `ffprobe` e `ffmpeg` para metadados e amostragem de video/audio
- `cv2` para detecao leve de faces e diferenca entre frames

Se essas ferramentas nao existirem, o backend cai para heuristicas de metadata, entropia e estrutura do arquivo.

## Formato do JSON

Exemplo resumido:

```json
{
  "schema_version": "2.0",
  "analysis_version": "neuroscore-v2-lite",
  "media_path": "/path/input.mp4",
  "scores": {
    "v1": 72,
    "ffa": 41,
    "ppa": 66,
    "v5": 84,
    "ips": 73,
    "broca": 28,
    "pfc": 58,
    "semantic": 35
  },
  "confidence_by_region": {
    "v1": 0.77,
    "ffa": 0.52
  },
  "evidence_by_region": {
    "v1": {
      "summary": "Primary visual cortex...",
      "primary_signals": [
        {"name": "contrast", "value": 0.62, "weight": 0.28, "direction": "positive"}
      ],
      "supporting_signals": []
    }
  },
  "ux_score": 63,
  "elapsed": 0.1842,
  "relatorio": "NeuroScore v2 ..."
}
```

## Observacoes de compatibilidade

- `scores` e os aliases top-level por regiao existem para facilitar integracao com o frontend atual.
- As evidencias sao estruturadas por regiao para permitir renderizacao futura de tooltips, paines de debug e comparativos A/B.
- O resultado e deterministico para a mesma entrada, salvo pequenas variacoes de dependencias opcionais instaladas no ambiente.

