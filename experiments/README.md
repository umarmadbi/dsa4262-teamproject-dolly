# experiments/

Numbered scripts that produced every number in [docs/model_development.md](../docs/model_development.md) and
[docs/sgnex_task2.md](../docs/sgnex_task2.md). They are run once, in order, to make modelling decisions; the
deliverable scripts are in `scripts/`.

**Run them from this folder** (they import `common.py` from here):

```bash
source ../.venv/bin/activate      # or call ../.venv/bin/python directly
cd experiments
python 01_cv_models.py
```

Most of them read cached feature tables from `cache/` (`cache/d0.parquet` etc.). Build those first, from the repo root:

```bash
python scripts/build_features.py data/data0/dataset0.json.gz cache/d0 --info data/data0/data.info.labelled --max-reads 50 --jobs 2
python scripts/build_features.py data/data1/dataset1.json.gz cache/d1 --info data/data1/data.info --max-reads 50 --jobs 2
python scripts/build_features.py data/data2/dataset2.json.gz cache/d2 --info data/data2/data.info --max-reads 50 --jobs 2
```

All outputs go to `results/` (indexed in [results/README.md](../results/README.md)) or `docs/figures/`.
Times are for 2 CPU cores on the team AWS machine.

| # | Script | Question it answers | Main output | Time |
|---|---|---|---|---|
| | `common.py` | Shared helpers: paths, loading cached tables, the **frozen test split** (`results/test_genes_d0.csv`) | | |
| 01 | `01_cv_models.py` | Which model family? Baselines vs logistic regression, random forest, LightGBM (5-fold gene-grouped CV) | `cv_results.csv` | ~15 min |
| 02 | `02_variants.py` | Do k-mer centring, per-run correction, class weights matter? Signal vs sequence | `variants.csv` | ~7 min |
| 03 | `03_read_level.py` | Does a read-level (multiple-instance) model pooled per site help? | `read_level_cv.csv` | ~12 min |
| 04 | `04_neighbours.py` | Do scores of neighbouring candidate sites help? | `neighbours.log` | ~6 min |
| 05 | `05_final_eval.py` | **One-shot test of v1** on held-out genes, dataset1 and dataset2 | `final_test_metrics.csv` | ~15 min |
| 06 | `06_figures.py` | Report figure for v1 | `docs/figures/model_evaluation.png` | <1 min |
| 07 | `07_m6anet_prepare.py`, `07_m6anet_run.sh` | Run pretrained m6Anet on dataset0/1/2 (needs the **m6anet conda env**, see main README) | `cache/m6anet/d*_out/` | ~15 min |
| 08 | `08_m6anet_compare.py` | Our model vs m6Anet on the same test sites | `m6anet_test_metrics.csv`, `docs/figures/m6anet_comparison.png` | ~6 min |
| 09 | `09_annotation_check.py` | Is Ensembl 91 the right annotation, and does transcript position carry signal? | `annotation_check.csv` | ~2 min |
| 10 | `10_improvements_cv.py` | Which v2 candidates help (annotation, re-labelling, richer neighbours)? | `improvements_cv.csv` | ~2.5 h |
| 11 | `11_final_eval_v2.py` | **One-shot test of v2** vs v1 and m6Anet | `final_v2_metrics.csv`, `docs/figures/model_evaluation_v2.png` | ~1 h |
| 12 | `12_sgnex_m6anet_compare.py` | Task 2: how do v2 and m6Anet agree on 23 unlabelled SG-NEx runs? | `sgnex_compare_*.csv`, `docs/figures/sgnex_m6anet_comparison.png` | a few min |

Notes:

- 07 needs `M6ANET=<path to the m6anet binary>` if it is not on your PATH.
- 09-11 need the Ensembl 91 GTF and cDNA/ncRNA fasta in `cache/annotation/` (see `scripts/build_annotation.py`).
- 12 needs the SG-NEx predictions of v2 and m6Anet in `results/sgnex_v2/` and `results/sgnex_m6anet/`, which are
  not in git (see [docs/sgnex_task2.md](../docs/sgnex_task2.md)). `--partial` runs on whichever runs are ready.
- The test sets (frozen gene split, dataset1 unseen transcripts) are used only in 05, 08, 11. All design decisions
  come from CV in 01-04 and 10. Keep it that way: don't tune on the test results.
