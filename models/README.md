# models/

The trained models, saved with `joblib`. They are committed so that `scripts/predict.py` works straight after cloning,
without retraining.

| File | Size | What it is |
|---|---|---|
| `m6a_model_v2.joblib` | 16 MB | **v2, the final model** and the default of `predict.py` and `train.py`. Read-level and site-level LightGBM stack with transcript-structure features from Ensembl 91, averaged over three seeds. Transcripts missing from Ensembl 91 are scored by a fallback model stored in the same file |
| `m6a_model.joblib` | 2.5 MB | **v1, the earlier model**, kept for comparison. Same stack without the transcript-structure features. Use it with `--model models/m6a_model.joblib` |
| `.gitkeep` | | Keeps the folder in git |

Both were trained on all of dataset0 (`python scripts/train.py --data data/data0/dataset0.json.gz data/data0/data.info.labelled`,
plus `--v1` for v1). Their training logs are `results/train_v2.log` and `results/train_final.log`.

Test performance (held-out genes of dataset0 / unseen transcripts of dataset1):

| Model | ROC AUC | PR AUC |
|---|---|---|
| v2 | 0.95 / 0.88 | 0.56 / 0.43 |
| v1 | 0.93 / 0.86 | 0.52 / 0.40 |

`.gitignore` ignores everything else in this folder. To commit a new model on purpose, use `git add -f models/<file>`.
