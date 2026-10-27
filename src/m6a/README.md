# src/m6a/

The shared Python library behind the model. `scripts/train.py`, `scripts/predict.py` and every script in
`experiments/` import from here, so data loading, features and evaluation are identical everywhere.

You do not run these files directly. The scripts add `src/` to the Python path and then `import m6a`.

| File | What it does |
|---|---|
| `__init__.py` | Marks the folder as the `m6a` package |
| `io.py` | Reads m6Anet `data.json(.gz)` line by line (keeps memory low) and loads the label files (`data.info`) |
| `features.py` | Turns the reads at each site into model features: quantiles, mean and SD of the signal, centring per 5-mer (`KmerCentering`), one-hot 7-mer, pooled read-level scores and neighbouring-site context |
| `annotation.py` | Transcript-structure features from Ensembl 91 (distance to the stop codon and exon junctions, region, exon length), read from `resources/ensembl91_transcripts.csv.gz`. Used by v2 only |
| `models.py` | The baselines (random, 5-mer prior), the candidate models compared during development, and the final model: `ReadStackModel` (read-level LightGBM stacked into a site-level LightGBM) and `SeedEnsemble` (v2 averages three seeds) |
| `pipeline.py` | Loading glue shared by `train.py` and `predict.py` (read a run, combine several runs, fill in missing gene IDs) |
| `evaluation.py` | Gene-grouped train/test split and cross-validation folds, ROC AUC / PR AUC scoring, gene-level bootstrap confidence intervals |

Why the features and models look the way they do: [docs/model_development.md](../../docs/model_development.md).
