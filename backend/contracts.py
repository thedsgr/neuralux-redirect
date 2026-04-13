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

