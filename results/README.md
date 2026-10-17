# results/

Metrics, logs and predictions written by the scripts in `experiments/` and `scripts/`. Every file lists the script
that writes it, so you can regenerate it. The write-up that interprets these numbers is
[docs/model_development.md](../docs/model_development.md) (Task 1) and [docs/sgnex_task2.md](../docs/sgnex_task2.md) (Task 2).

`.gitignore` ignores `results/*`, so only the small files below are committed (added with `git add -f`). Large outputs
(SG-NEx predictions, parquet files) live only on the AWS machine; see "Not committed" at the end.

Naming: **d0** = dataset0 (labelled HCT116 training data), **d1** = dataset1 (second labelled run),
**d2** = dataset2 (synthetic, known modification fractions). **v1** = `models/m6a_model.joblib`,
**v2** = `models/m6a_model_v2.joblib`. CSV metric columns: `roc_auc`, `pr_auc`, `pr_baseline` (= positive rate,
the PR AUC of a random model), `n`, `n_pos`; `*_lo` / `*_hi` are gene-bootstrap 95% CIs; `d*_vs_<model>` are
paired differences against that model.

## Shared

| File | Written by | Contents |
|---|---|---|
| `test_genes_d0.csv` | `experiments/common.py` (first run) | The frozen 20% of dataset0 genes (775) held out as the test set. **Do not edit**: every result depends on it. |
| `sample_predictions.csv` | `scripts/predict.py` (default v2 model) on `data/sample/` | Example output of the prediction script (500 sites), as shown in the main README and [HOW_TO_RUN.md](../HOW_TO_RUN.md). |

## Task 1, v1 model (experiments 01-06)

| File | Written by | Contents |
|---|---|---|
| `cv_results.csv` | `01_cv_models.py` | 5-fold gene-grouped CV, one row per model x fold: random, 5-mer prior, logistic regression, random forest, LightGBM |
| `rf_cv.log` | random-forest part of `01_cv_models.py` | Console log of the random-forest CV run |
| `variants.csv` | `02_variants.py` | Design checks (k-mer centring, class weights, signal-only, sequence-only): CV and d1 ROC/PR |
| `read_level_cv.csv`, `read_level.log` | `03_read_level.py` | CV of the read-level model pooled per site ("stack") vs simple read-mean pooling |
| `neighbours.log` | `04_neighbours.py` | CV log for neighbour-site context features |
| `final_test_metrics.csv` | `05_final_eval.py` | **One-shot test results for v1** and baselines on d0 test genes and d1 unseen transcripts, with CIs |
| `final_d2_spearman.csv` | `05_final_eval.py` | d2: Spearman correlation of score with the known modification fraction (overall and within 5-mer) |
| `final_feature_importance.csv` | `05_final_eval.py` | LightGBM gain per feature for the final v1 model |
| `final_eval.log` | `05_final_eval.py` | Console log of the above |
| `train_final.log` | `scripts/train.py` | Training log for `models/m6a_model.joblib` (all of dataset0, ~10 min) |

## m6Anet benchmark (experiments 07-08)

| File | Written by | Contents |
|---|---|---|
| `m6anet_test_metrics.csv` | `08_m6anet_compare.py` | Pretrained m6Anet on the same test sets, with paired differences vs our model |
| `m6anet_d2_spearman.csv` | `08_m6anet_compare.py` | d2 Spearman for m6Anet |

## Task 1, v2 model (experiments 09-11)

| File | Written by | Contents |
|---|---|---|
| `annotation_check.csv` | `09_annotation_check.py` | Checks that the Ensembl 91 annotation matches the data (7-mer match by offset; 100% at offset 0) |
| `improvements_cv.csv`, `improvements_cv.log` | `10_improvements_cv.py` | CV of candidate v2 improvements (annotation, read re-labelling, richer neighbours), one row per variant x fold |
| `final_v2_metrics.csv` | `11_final_eval_v2.py` | **One-shot test results for v2** vs v1, m6Anet and baselines on d0 test, d1 unseen, d1 strict |
| `final_v2_d2_spearman.csv` | `11_final_eval_v2.py` | d2 Spearman for v2 |
| `final_v2_feature_importance.csv` | `11_final_eval_v2.py` | LightGBM gain per feature for v2 |
| `final_v2_eval.log` | `11_final_eval_v2.py` | Console log of the above |
| `train_v2.log` | `scripts/train.py --v2` | Training log for `models/m6a_model_v2.joblib` (~25 min) |

## Alternative pipeline (Nitish)

| File | Written by | Contents |
|---|---|---|
| `sklearn_comparison/dolly_dataset0.csv`, `dolly_dataset1.csv`, `dolly_dataset2.csv` | Committed by Nitish on 9 Oct (see [alternatives/sklearn_comparison](../alternatives/sklearn_comparison/)) | Predictions (`transcript_id,transcript_position,score`) for every site of dataset0/1/2, believed to be from Nitish's first XGBoost model (not recorded in the repo; confirm with Nitish). Moved here from `results/` on 16 Oct. |

## Not committed (on the AWS machine only)

These are under `~/hamzah/dsa4262-teamproject-dolly/results/` on the server.

| Path | Written by | Contents |
|---|---|---|
| `preds_*.parquet`, `preds_v2_*.parquet`, `preds_m6anet_*.parquet` | `05`, `08`, `11` | Per-site test-set predictions used for figures and bootstrap CIs |
| `threshold_recall_v2_vs_m6anet.csv` | not recorded (no script in the repo) | Precision/recall/call rate of v2 and m6Anet at several thresholds on d0 test; motivates the 0.5 / 0.9 cut-offs in experiment 12 |
| `d2_depth/` | not recorded (no script in the repo) | Predictions on dataset2 at different read depths (`pred_k20.csv`, `pred_k200.csv`, `depth_ablation.csv`) |
| `sgnex_v2/<run>.csv` (1.2 GB) | `scripts/predict.py --model models/m6a_model_v2.joblib` | v2 predictions for each of the 23 SG-NEx runs (input to the visualisation) |
| `sgnex_m6anet/<cell>_rep<r>_run<n>/` (9.9 GB) | `m6anet inference` | m6Anet predictions for the same runs |
| `sgnex_compare_{runs,regions,motifs,pairs}.csv` | `12_sgnex_m6anet_compare.py` | Task 2 comparison tables, summarised in [docs/sgnex_task2.md](../docs/sgnex_task2.md) |
