# Alternative pipeline: scikit-learn / XGBoost model comparison (Nitish)

A self-contained, independent pipeline written by Nitish (committed 9 Oct 2026). It is **not** the team's
submitted model (that is `scripts/train.py` / `scripts/predict.py`, see the main README), but a second, simpler
approach that is useful as a cross-check. It was moved here from `models/` on 16 Oct so that `models/` holds only
trained model files; the code itself is unchanged.

It does not use `src/m6a/`. It needs Python >= 3.9, numpy, pandas, scipy, scikit-learn >= 1.3, joblib and,
optionally, xgboost.

## Files

| File | What it does |
|---|---|
| `compare_project_models.py` | Loads an m6Anet `data.json(.gz)` + labels, builds per-site features (mean, median, SD, 25th/75th percentiles of the 9 read features, one-hot 7-mer), reserves ~20% of genes as a test set, compares logistic regression, random forest, histogram gradient boosting and XGBoost by gene-grouped CV (PR AUC), then evaluates only the selected model on the reserved genes and refits it on all labelled sites. |
| `evaluate_project_datasets.py` | Applies dataset0-trained models to other datasets. `predict` scores a json file; `compare` trains the four models on dataset0 and evaluates them on dataset1/dataset2. Imports `compare_project_models.py`, so keep both files in the same folder. |

Predictions it produced: [`results/sklearn_comparison/dolly_dataset{0,1,2}.csv`](../../results/sklearn_comparison/)
(which model and settings were used is not recorded; ask Nitish).

## Usage

Run from this folder (the second script imports the first):

```bash
cd alternatives/sklearn_comparison

# compare models on dataset0 (outputs in results/model_comparison/ relative to the current folder)
python compare_project_models.py --data ../../data/data0/dataset0.json.gz \
                                 --labels ../../data/data0/data.info.labelled

# predict with a saved model
python evaluate_project_datasets.py predict --model selected_model.joblib \
       --data ../../data/data1/dataset1.json.gz --output dataset1_predictions.csv

# train on dataset0, evaluate on dataset1 and dataset2
python evaluate_project_datasets.py compare \
       --train-data ../../data/data0/dataset0.json.gz --train-labels ../../data/data0/data.info.labelled \
       --test-data ../../data/data1/dataset1.json.gz ../../data/data2/dataset2.json.gz \
       --test-labels ../../data/data1/data.info ../../data/data2/data.info
```

Default output folders (`results/model_comparison`, `results/external_comparison`) are relative to where you run
the command. Pass `--output` to put them elsewhere. Full option lists: `python <script> --help`.

## How it differs from the main model

| | This pipeline | Main model (`src/m6a/`) |
|---|---|---|
| Features | 5 summary statistics of the 9 read features + 7-mer | Quantiles of 11 read values centred per 5-mer, 7-mer, pooled read-level scores, neighbour-site context, (v2) Ensembl transcript structure |
| Models | LR, RF, HistGB, XGBoost; best by CV PR AUC | Stacked LightGBM (read-level + site-level) |
| Test split | Its own ~20% gene split (`GroupShuffleSplit`) | The frozen split in `results/test_genes_d0.csv` |

Because the test genes differ, its scores are **not directly comparable** with the numbers in
`docs/model_development.md`. To compare fairly, evaluate both on `results/test_genes_d0.csv`.
