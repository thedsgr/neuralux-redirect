"""Lightweight validation metrics for PRD benchmark evaluation.

All functions in this module use only the Python standard library and accept
plain lists/dicts so they can be reused in small scripts, notebooks, or CI jobs.
"""

from __future__ import annotations

from collections import defaultdict
from statistics import mean
from typing import Any, Dict, List, Mapping, Sequence


def _as_float(value: Any) -> float | None:
    """Best-effort conversion to float."""
    if value is None:
        return None
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        return float(value)
    try:
        text = str(value).strip().replace(",", ".")
        if not text:
            return None
        return float(text)
    except (TypeError, ValueError):
        return None


def _percentile(values: Sequence[float], percentile: float) -> float | None:
    """Return percentile using linear interpolation."""
    if not values:
        return None
    if percentile <= 0:
        return min(values)
    if percentile >= 100:
        return max(values)

    sorted_values = sorted(values)
    if len(sorted_values) == 1:
        return sorted_values[0]

    position = (len(sorted_values) - 1) * (percentile / 100.0)
    lower = int(position)
    upper = min(lower + 1, len(sorted_values) - 1)
    fraction = position - lower
    return sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * fraction


def _extract_scores(record: Mapping[str, Any], scores_key: str = "runs") -> List[float]:
    """Extract numeric scores from a record."""
    raw_scores = record.get(scores_key, [])
    if raw_scores is None:
        return []
    if isinstance(raw_scores, Mapping):
        raw_scores = list(raw_scores.values())
    if not isinstance(raw_scores, Sequence) or isinstance(raw_scores, (str, bytes)):
        raw_scores = [raw_scores]

    scores: List[float] = []
    for value in raw_scores:
        converted = _as_float(value)
        if converted is not None:
            scores.append(converted)
    return scores


def consistency_by_dimension(
    records: Sequence[Mapping[str, Any]],
    *,
    dimension_key: str = "dimension",
    scores_key: str = "runs",
    threshold: float = 5.0,
) -> Dict[str, Dict[str, Any]]:
    """Measure run-to-run consistency for each dimension.

    The default definition counts a record as consistent when the score range
    across repeated runs stays within ``threshold`` points.
    """
    grouped: Dict[str, List[Mapping[str, Any]]] = defaultdict(list)
    for record in records:
        dimension = str(record.get(dimension_key, "unknown"))
        grouped[dimension].append(record)

    summary: Dict[str, Dict[str, Any]] = {}
    for dimension, items in grouped.items():
        item_ranges: List[float] = []
        consistent_items = 0

        for item in items:
            scores = _extract_scores(item, scores_key=scores_key)
            if len(scores) < 2:
                continue
            score_range = max(scores) - min(scores)
            item_ranges.append(score_range)
            if score_range <= threshold:
                consistent_items += 1

        total = len(item_ranges)
        summary[dimension] = {
            "count": total,
            "consistent": consistent_items,
            "consistency_rate": (consistent_items / total) if total else None,
            "mean_range": mean(item_ranges) if item_ranges else None,
            "max_range": max(item_ranges) if item_ranges else None,
            "threshold": threshold,
        }

    return summary


def run_variance(
    records: Sequence[Mapping[str, Any]],
    *,
    dimension_key: str = "dimension",
    scores_key: str = "runs",
) -> Dict[str, Dict[str, Any]]:
    """Summarize variance across repeated runs for each dimension."""
    grouped: Dict[str, List[Mapping[str, Any]]] = defaultdict(list)
    for record in records:
        dimension = str(record.get(dimension_key, "unknown"))
        grouped[dimension].append(record)

    summary: Dict[str, Dict[str, Any]] = {}
    for dimension, items in grouped.items():
        ranges: List[float] = []
        stddevs: List[float] = []
        mean_absolute_deviations: List[float] = []

        for item in items:
            scores = _extract_scores(item, scores_key=scores_key)
            if len(scores) < 2:
                continue
            item_mean = mean(scores)
            deviations = [abs(score - item_mean) for score in scores]
            variance = sum((score - item_mean) ** 2 for score in scores) / len(scores)
            ranges.append(max(scores) - min(scores))
            stddevs.append(variance**0.5)
            mean_absolute_deviations.append(mean(deviations))

        summary[dimension] = {
            "count": len(mean_absolute_deviations),
            "mean_abs_deviation": mean(mean_absolute_deviations) if mean_absolute_deviations else None,
            "mean_stddev": mean(stddevs) if stddevs else None,
            "mean_range": mean(ranges) if ranges else None,
            "max_range": max(ranges) if ranges else None,
        }

    return summary


def _infer_winner_from_scores(scores: Mapping[str, Any]) -> str | None:
    """Infer the winner from a score mapping."""
    best_name = None
    best_value = None
    tie = False
    for name, value in scores.items():
        numeric = _as_float(value)
        if numeric is None:
            continue
        if best_value is None or numeric > best_value:
            best_name = str(name)
            best_value = numeric
            tie = False
        elif numeric == best_value:
            tie = True
    if best_name is None:
        return None
    return "tie" if tie else best_name


def ab_agreement(
    trials: Sequence[Mapping[str, Any]],
    *,
    ground_truth_key: str = "ground_truth_winner",
    predicted_key: str = "predicted_winner",
    score_map_key: str = "predicted_scores",
) -> Dict[str, Any]:
    """Compute A/B agreement against a ground-truth winner.

    If ``predicted_winner`` is missing, the function falls back to a score map
    and infers the winning side from the highest score.
    """
    total = 0
    agreements = 0
    ties = 0
    confusion: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))

    for trial in trials:
        ground_truth = trial.get(ground_truth_key) or trial.get("winner")
        if ground_truth is None:
            continue
        if predicted_key in trial and trial.get(predicted_key) is not None:
            predicted = trial.get(predicted_key)
        else:
            predicted = _infer_winner_from_scores(trial.get(score_map_key, {}))
        if predicted is None:
            continue

        total += 1
        ground_truth_str = str(ground_truth)
        predicted_str = str(predicted)
        confusion[ground_truth_str][predicted_str] += 1

        if ground_truth_str == predicted_str:
            agreements += 1
        if predicted_str == "tie" or ground_truth_str == "tie":
            ties += 1

    matrix = {
        truth: dict(predictions)
        for truth, predictions in sorted(confusion.items(), key=lambda item: item[0])
    }
    return {
        "total": total,
        "agreements": agreements,
        "disagreements": total - agreements,
        "agreement_rate": (agreements / total) if total else None,
        "tie_rate": (ties / total) if total else None,
        "confusion_matrix": matrix,
    }


def latency_cost_summary(
    rows: Sequence[Mapping[str, Any]],
    *,
    latency_keys: Sequence[str] = ("latency_ms", "elapsed_ms", "duration_ms", "latency_s", "elapsed_s"),
    cost_keys: Sequence[str] = ("cost_usd", "usd_cost", "cost", "estimated_cost_usd"),
    group_key: str = "stage",
) -> Dict[str, Any]:
    """Summarize latency and cost from a tabular log structure."""

    def extract_first_numeric(record: Mapping[str, Any], keys: Sequence[str]) -> float | None:
        for key in keys:
            if key not in record:
                continue
            numeric = _as_float(record.get(key))
            if numeric is None:
                continue
            if key.endswith("_s") and not key.endswith("_ms"):
                return numeric * 1000.0
            return numeric
        return None

    latencies: List[float] = []
    costs: List[float] = []
    groups: Dict[str, Dict[str, List[float]]] = defaultdict(lambda: {"latency": [], "cost": []})

    for row in rows:
        latency = extract_first_numeric(row, latency_keys)
        cost = extract_first_numeric(row, cost_keys)
        if latency is not None:
            latencies.append(latency)
        if cost is not None:
            costs.append(cost)

        group_name = str(row.get(group_key, "ungrouped"))
        if latency is not None:
            groups[group_name]["latency"].append(latency)
        if cost is not None:
            groups[group_name]["cost"].append(cost)

    def summarize(values: Sequence[float]) -> Dict[str, Any]:
        return {
            "count": len(values),
            "sum": sum(values) if values else None,
            "mean": mean(values) if values else None,
            "median": _percentile(values, 50),
            "p95": _percentile(values, 95),
            "min": min(values) if values else None,
            "max": max(values) if values else None,
        }

    grouped_summary: Dict[str, Dict[str, Any]] = {}
    for group_name, payload in groups.items():
        grouped_summary[group_name] = {
            "latency": summarize(payload["latency"]),
            "cost": summarize(payload["cost"]),
        }

    return {
        "overall": {
            "latency": summarize(latencies),
            "cost": summarize(costs),
        },
        "by_group": grouped_summary,
    }
