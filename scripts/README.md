# scripts/

Command-line tools. **Run them from the repo root** with the environment activated (`source .venv/bin/activate`).
Every script prints its options with `--help`.

| File | What it does | Who needs it |
|---|---|---|
| `predict.py` | **Task 1 prediction script.** Scores every site in an m6Anet `data.json(.gz)` and writes `transcript_id,transcript_position,score`. Uses the final model (`models/m6a_model_v2.joblib`) by default | Everyone, including evaluators |
| `train.py` | **Task 1 training script.** Trains a model from a `data.json(.gz)` and its labels (`--data JSON LABELS`, repeatable). Trains v2 by default; `--v1` trains the earlier model | Anyone retraining the model |
| `build_annotation.py` | Converts the Ensembl 91 GTF into `resources/ensembl91_transcripts.csv.gz` (already committed, so only needed to rebuild it) | Developers |
| `build_features.py` | Parses a dataset once and caches its feature table in `cache/`, for the scripts in `experiments/` | Developers |
| `parse_to_parquet.py` | Converts a `data.json(.gz)` into a simple one-row-per-site table, used for the EDA | Developers |

## Quick example

```bash
python scripts/predict.py --json data/sample/sample.json.gz --out results/my_sample_predictions.csv
```

| `predict.py` option | Meaning |
|---|---|
| `--json PATH` | Input `data.json` or `data.json.gz` (required) |
| `--out PATH` | Output CSV (required) |
| `--model PATH` | Model file; default `models/m6a_model_v2.joblib` |
| `--jobs N` | CPU cores to use; default 2 |

Give `predict.py` one sequencing run per call, because neighbouring sites in the same transcript are used as
context. Full step-by-step guide: [docs/HOW_TO_RUN.md](../docs/HOW_TO_RUN.md).
