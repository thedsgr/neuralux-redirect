"""Shared contracts for the lightweight NeuroScore v2 backend."""

from __future__ import annotations

from copy import deepcopy

API_VERSION = "neuroscore-v2-lite"

REGIONS = (
    "v1",
    "ffa",
    "ppa",
    "v5",
    "ips",
    "broca",
    "pfc",
    "semantic",
)

REGION_LABELS = {
    "v1": "Visual primario",
    "ffa": "Faces / avatares",
    "ppa": "Layouts / cenas",
    "v5": "Movimento / animacao",
    "ips": "Atencao visual",
    "broca": "Texto / labels",
    "pfc": "Decisao / memoria",
    "semantic": "Semantica / contexto",
}

REGION_TAGS = {
    "v1": "V1",
    "ffa": "FFA",
    "ppa": "PPA",
    "v5": "V5",
    "ips": "IPS",
    "broca": "Broca",
    "pfc": "PFC",
    "semantic": "SEM",
}

REGION_DESCRIPTIONS = {
    "v1": "Primary visual cortex - processes basic visual features",
    "ffa": "Fusiform face area - facial recognition and processing",
    "ppa": "Parahippocampal place area - spatial layout perception",
    "v5": "Visual motion area - movement and dynamic elements",
    "ips": "Intraparietal sulcus - visual attention and focus",
    "broca": "Broca area - language and text processing",
    "pfc": "Prefrontal cortex - decision making and working memory",
    "semantic": "Semantic processing - meaning and context understanding",
}

DEFAULT_CONTEXT = "generic"

CONTEXT_LABELS = {
    "banking": "Banking / Fintech",
    "ecommerce": "E-commerce",
    "gaming": "Gaming / Entretenimento",
    "content": "Content / News",
    "saas": "SaaS / Produtividade",
    "social": "Social Media",
    "health": "Saúde / Health",
    "generic": "Genérico",
}

CONTEXT_WEIGHTS = {
    "banking":   {"v1": 1.0, "ffa": 0.5, "ppa": 1.2, "v5": 0.3, "ips": 1.0, "broca": 1.5, "pfc": 1.5, "semantic": 1.0},
    "ecommerce": {"v1": 1.0, "ffa": 0.8, "ppa": 1.3, "v5": 0.7, "ips": 1.2, "broca": 1.0, "pfc": 1.5, "semantic": 1.0},
    "gaming":    {"v1": 0.8, "ffa": 1.2, "ppa": 0.7, "v5": 1.5, "ips": 1.0, "broca": 0.5, "pfc": 0.7, "semantic": 0.8},
    "content":   {"v1": 1.0, "ffa": 0.7, "ppa": 1.0, "v5": 0.5, "ips": 1.0, "broca": 1.5, "pfc": 0.8, "semantic": 1.5},
    "saas":      {"v1": 1.0, "ffa": 0.4, "ppa": 1.3, "v5": 0.5, "ips": 1.2, "broca": 1.2, "pfc": 1.3, "semantic": 1.0},
    "social":    {"v1": 0.8, "ffa": 1.5, "ppa": 0.8, "v5": 1.2, "ips": 1.0, "broca": 0.7, "pfc": 0.8, "semantic": 1.0},
    "health":    {"v1": 1.0, "ffa": 0.6, "ppa": 1.0, "v5": 0.3, "ips": 1.0, "broca": 1.5, "pfc": 1.3, "semantic": 1.3},
    "generic":   {region: 1.0 for region in REGIONS},
}


def normalize_context_key(raw: Any) -> str:
    key = str(raw or "").strip().lower()
    return key if key in CONTEXT_WEIGHTS else DEFAULT_CONTEXT


def get_context_weights(raw: Any) -> dict:
    return dict(CONTEXT_WEIGHTS[normalize_context_key(raw)])


def context_label(raw: Any) -> str:
    return CONTEXT_LABELS[normalize_context_key(raw)]


def context_block(raw: Any) -> dict:
    key = normalize_context_key(raw)
    return {
        "key": key,
        "label": CONTEXT_LABELS[key],
        "weights": dict(CONTEXT_WEIGHTS[key]),
    }


DEFAULT_REGION_SCORE = 0
DEFAULT_CONFIDENCE = 0.0
DEFAULT_EVIDENCE = {
    "summary": "",
    "primary_signals": [],
    "supporting_signals": [],
}


def blank_region_scores(default: int = DEFAULT_REGION_SCORE) -> dict:
    return {region: int(default) for region in REGIONS}


def blank_confidence_map(default: float = DEFAULT_CONFIDENCE) -> dict:
    return {region: float(default) for region in REGIONS}


def blank_evidence_map() -> dict:
    return {region: deepcopy(DEFAULT_EVIDENCE) for region in REGIONS}


def output_template() -> dict:
    """Return the canonical output shape consumed by the frontend."""

    return {
        "schema_version": "2.0",
        "analysis_version": API_VERSION,
        "media_path": "",
        "scores": blank_region_scores(),
        "confidence_by_region": blank_confidence_map(),
        "evidence_by_region": blank_evidence_map(),
        "ux_score": 0,
        "base_ux_score": 0,
        "context": context_block(DEFAULT_CONTEXT),
        "elapsed": 0.0,
        "relatorio": "",
        "features": {},
    }


def feature_template() -> dict:
    return {
        "media_path": "",
        "media_type": "unknown",
        "mime_type": "",
        "extension": "",
        "file_size_bytes": 0,
        "file_size_mb": 0.0,
        "sha256_prefix": "",
        "visual": {},
        "audio": {},
        "text": {},
    }

