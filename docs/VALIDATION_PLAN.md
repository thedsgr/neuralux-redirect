# Validation Plan

## Purpose
This document defines the benchmark protocol for validating the PRD evolution of NeuralUX. The goal is to measure whether the lightweight multimodal pipeline improves score coherence, run stability, A/B decision quality, and operational efficiency without introducing leakage or unreliable behavior.

## Evaluation scope
The benchmark covers four result classes:

1. Dimension-level score consistency across repeated runs.
2. Run-to-run variance for the same creative and dimension.
3. A/B winner agreement against ground-truth campaign outcomes.
4. Latency and cost from tabular execution logs.

## Dataset requirements
Use an internal validation set with the following properties:

1. Creative-level labels per target dimension.
2. Ground-truth A/B winner labels tied to a business metric such as CTR, VTR, watch time, or completion rate.
3. Metadata for sector, format, and capture date.
4. Execution logs with stage, latency, and cost columns.

The sample file at `evaluation/sample_validation_dataset.json` is only a smoke-test fixture. It is not a benchmark reference set.

## Split strategy

### Primary split
Use a temporal split to prevent leakage from future creatives into past validation:

1. Train: oldest 60% of creatives by capture date.
2. Validation: next 20%.
3. Test: newest 20%.

If the dataset is small, keep the same ordering rule but use k-fold backtesting by time window instead of a single holdout.

### Secondary slices
Report results separately for:

1. Format: feed, stories, UGC, institutional, and other internal buckets.
2. Motion profile: static, moderate motion, high motion.
3. Text density: low text, medium text, high text.
4. Face presence: no face, one face, multiple faces.

These slices are required because the PRD explicitly calls out robustness checks for face presence, motion, and text density.

## Sanity checks
Run these checks before trusting aggregate scores:

1. No-face creatives should not systematically receive high faces/avatars scores.
2. High-motion creatives should score above static creatives on motion/animation.
3. Text-heavy creatives should score above sparse creatives on text/labels.
4. Repeated runs on the same creative should stay within the configured variance band.
5. A/B predictions should not collapse to a single winner class across all trials.

If any sanity check fails, block the benchmark from being promoted.

## Metric definitions

### Consistency by dimension
Definition: fraction of creatives whose repeated scores remain within the tolerated range for a given dimension.

Acceptance target from the PRD:

- `Consistency@dimension >= 85%`

### Run variance
Definition: average absolute deviation across repeated runs for the same creative and dimension.

Acceptance target from the PRD:

- Mean absolute deviation `<= 5 points`

### A/B agreement
Definition: agreement between the model-selected winner and the ground-truth winner derived from campaign outcomes.

Acceptance target from the PRD:

- Improvement of at least `+15%` vs the frozen baseline on the same validation slice.

### Latency and cost
Definition: stage-wise and end-to-end latency/cost from tabular logs.

Acceptance targets from the PRD:

- P95 latency for a 30s 720p video `<= 20s` in standard mode.
- Cost per video reduced by at least `30%` vs the current pipeline, or kept flat with a measurable quality gain.

## Validation protocol

### Step 1: Freeze baseline
Lock the baseline model, prompt, and post-processing rules. Record a version tag for every run.

### Step 2: Run smoke test
Execute `python evaluation/run_validation.py` on the sample dataset to confirm metric wiring, report formatting, and import stability.

### Step 3: Run held-out benchmark
Run the candidate pipeline on the temporal test split. Record:

1. Raw per-dimension scores.
2. Repeated run outputs.
3. A/B predictions.
4. Stage logs with latency and cost.

### Step 4: Compare against baseline
Compare candidate vs baseline on the same test split. Report:

1. Consistency by dimension.
2. Run variance.
3. A/B agreement.
4. Latency and cost.
5. Slice-level breakdowns.

### Step 5: Gate on acceptance criteria
Promote the candidate only if all of the following are true:

1. All target dimensions meet the consistency threshold.
2. All target dimensions meet the variance threshold.
3. A/B agreement improves by at least 15% over baseline.
4. P95 latency stays within the standard-mode budget.
5. Cost reduction meets or exceeds the PRD target.
6. All sanity checks pass.

## Reporting format
Every benchmark run must store:

1. Dataset version and split policy.
2. Model or prompt version.
3. Metric outputs per dimension and per slice.
4. Latency and cost summaries.
5. Sanity-check results.
6. A short pass/fail decision with the reason.

## Escalation rules
Do not expand the benchmark with new metrics unless they map back to a PRD KPI or a documented failure mode. Any new dimension or slice must be added to the validation plan before it is considered part of the official benchmark.
