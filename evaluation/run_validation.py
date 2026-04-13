"""CLI entry point for the sample validation benchmark."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

from metrics import ab_agreement, consistency_by_dimension, latency_cost_summary, run_variance


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_DATASET = BASE_DIR / "sample_validation_dataset.json"


def _load_dataset(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _flatten_dimension_records(dataset: Dict[str, Any]) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    for dimension_block in dataset.get("dimensions", []):
        dimension = dimension_block.get("dimension", "unknown")
        for record in dimension_block.get("records", []):
            payload = dict(record)
            payload["dimension"] = dimension
            records.append(payload)
    return records


def _print_section(title: str) -> None:
    print()
    print(title)
    print("-" * len(title))


def _fmt_pct(value: Any) -> str:
    if value is None:
        return "n/a"
    return f"{value * 100:.1f}%"


def _fmt_num(value: Any, precision: int = 2) -> str:
    if value is None:
        return "n/a"
    return f"{value:.{precision}f}"


def main() -> int:
    dataset = _load_dataset(DEFAULT_DATASET)
    records = _flatten_dimension_records(dataset)
    ab_trials = dataset.get("ab_trials", [])
    logs = dataset.get("logs", [])

    consistency = consistency_by_dimension(records)
    variance = run_variance(records)
    agreement = ab_agreement(ab_trials)
    cost_latency = latency_cost_summary(logs)

    print("NeuralUX validation benchmark")
    print(f"Dataset: {DEFAULT_DATASET.name}")
    print(f"Dimensions: {len(dataset.get('dimensions', []))}")
    print(f"Validation records: {len(records)}")
    print(f"A/B trials: {len(ab_trials)}")

    _print_section("Consistency by dimension")
    for dimension, values in sorted(consistency.items()):
        print(
            f"{dimension}: "
            f"rate={_fmt_pct(values.get('consistency_rate'))}, "
            f"count={values.get('count', 0)}, "
            f"mean_range={_fmt_num(values.get('mean_range'))}, "
            f"threshold={_fmt_num(values.get('threshold'))}"
        )

    _print_section("Run variance by dimension")
    for dimension, values in sorted(variance.items()):
        print(
            f"{dimension}: "
            f"mean_abs_deviation={_fmt_num(values.get('mean_abs_deviation'))}, "
            f"mean_stddev={_fmt_num(values.get('mean_stddev'))}, "
            f"mean_range={_fmt_num(values.get('mean_range'))}"
        )

    _print_section("A/B agreement")
    print(f"Agreement rate: {_fmt_pct(agreement.get('agreement_rate'))}")
    print(f"Tie rate: {_fmt_pct(agreement.get('tie_rate'))}")
    print(f"Agreements: {agreement.get('agreements', 0)} / {agreement.get('total', 0)}")
    print("Confusion matrix:")
    for truth, predictions in sorted(agreement.get("confusion_matrix", {}).items()):
        predicted_bits = ", ".join(f"{pred}={count}" for pred, count in sorted(predictions.items()))
        print(f"  {truth}: {predicted_bits}")

    _print_section("Latency and cost summary")
    overall = cost_latency.get("overall", {})
    latency = overall.get("latency", {})
    cost = overall.get("cost", {})
    print(
        "Latency (ms): "
        f"mean={_fmt_num(latency.get('mean'))}, "
        f"median={_fmt_num(latency.get('median'))}, "
        f"p95={_fmt_num(latency.get('p95'))}, "
        f"sum={_fmt_num(latency.get('sum'))}"
    )
    print(
        "Cost (USD): "
        f"mean={_fmt_num(cost.get('mean'))}, "
        f"median={_fmt_num(cost.get('median'))}, "
        f"p95={_fmt_num(cost.get('p95'))}, "
        f"sum={_fmt_num(cost.get('sum'))}"
    )

    by_group = cost_latency.get("by_group", {})
    if by_group:
        print("By stage:")
        for stage, values in sorted(by_group.items()):
            stage_latency = values.get("latency", {})
            stage_cost = values.get("cost", {})
            print(
                f"  {stage}: "
                f"latency_mean={_fmt_num(stage_latency.get('mean'))}, "
                f"cost_sum={_fmt_num(stage_cost.get('sum'))}"
            )

    _print_section("Sanity checks")
    for check in dataset.get("sanity_checks", []):
        print(f"- {check.get('name')}: {check.get('description')}")

    _print_section("Quick interpretation")
    accepted_consistency = []
    for values in consistency.values():
        rate = values.get("consistency_rate")
        if rate is not None:
            accepted_consistency.append(rate >= 0.85)
    accepted_variance = []
    for values in variance.values():
        mad = values.get("mean_abs_deviation")
        if mad is not None:
            accepted_variance.append(mad <= 5.0)
    accepted = all(accepted_consistency) and all(accepted_variance)
    print(f"Consistency target met: {all(accepted_consistency)}")
    print(f"Variance target met: {all(accepted_variance)}")
    print(f"Sample benchmark pass: {accepted}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
