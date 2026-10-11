# Model development and evaluation (5 Oct 2026)

Everything here is reproducible with the scripts in `experiments/` (run in order, see the end).
Numbers come from `results/*.csv`.

## Evaluation design (fixed before any modelling)

| Data | Role | How it addresses the pitfalls |
|---|---|---|
| dataset0, 80% of genes (97,480 sites) | Training + 5-fold CV for every design decision | Folds are `StratifiedGroupKFold` by `gene_id`: no gene in two folds (clustered positives, shared isoforms) |
| dataset0, 20% of genes (24,358 sites, 775 genes) | **Frozen test set**, used once at the end | Gene list saved in `results/test_genes_d0.csv`; positive rate 4.48% vs 4.50% in training |
| dataset1, transcripts absent from dataset0 (15,137 sites, 8.1% positive) | **Cross-run test**: different sequencing run, same model | Tests robustness to the batch shift; overlapping transcripts dropped to avoid leakage |
| dataset2 (1,323 synthetic sites, 7 known modification fractions) | Sanity check: does the score rise with the fraction? | Spearman correlation, as PR/ROC need binary labels |

Metrics: PR AUC (primary, random = positive rate) and ROC AUC; never accuracy. Test-set CIs are
**gene-level bootstrap** 95% intervals (1,000 resamples of genes, since sites in a gene are correlated),
including CIs of *paired* differences between models.

## Features (`src/m6a/features.py`)

Per site, from all reads: for each of the 9 read values (dwell time and SD log-transformed) plus two
read-level current differences (centre − upstream, downstream − centre), the mean, SD and 5/25/50/75/95%
quantiles (77 values); and the one-hot 7-mer (28 values).

* Quantiles instead of only means: they capture partial modification and are robust to outlier reads.
* Nothing depends on read count, so features do not drift with sequencing depth.
* Signal features are centred on the median of their 5-mer (fitted on training data only),
  which removes the Simpson's paradox found in the EDA.

## Models compared (5-fold gene-grouped CV, training 80%)

| Model | ROC AUC | PR AUC |
|---|---|---|
| Random | 0.505 ± 0.015 | 0.046 ± 0.003 |
| 5-mer prior (simple baseline: training positive rate of the 5-mer) | 0.806 ± 0.012 | 0.149 ± 0.009 |
| Logistic regression (L2, C=0.1, balanced weights) | 0.914 ± 0.008 | 0.426 ± 0.028 |
| Random forest (300 trees, balanced) | 0.916 ± 0.007 | 0.486 ± 0.036 |
| LightGBM, site features | 0.925 ± 0.007 | 0.502 ± 0.021 |
| + read-level model, pooled per site (`03_read_level.py`) | 0.929 | 0.514 ± 0.028 |
| + neighbour context (`04_neighbours.py`, on the site model) | 0.942 | 0.534 |

Design checks (`02_variants.py`, LightGBM; CV PR / dataset1-unseen PR):

| Variant | CV PR | dataset1 PR |
|---|---|---|
| no k-mer centring | 0.494 | 0.370 |
| centring with training reference | 0.504 | 0.364 |
| centring on each run's own 5-mer medians (label-free batch correction) | 0.502 | 0.360 |
| class weights (`scale_pos_weight` ≈ 21) | 0.500 | 0.363 |
| signal only (no sequence) | 0.437 | 0.333 |
| sequence only | 0.173 | 0.166 |

Take-aways: the tree model with the 7-mer as input handles the k-mer dependence by itself, so centring
and per-run correction barely matter for it (they matter for the linear model); class weights do not
change the ranking, so they were not used; the signal carries most of the information beyond the sequence prior.

## Final model (`ReadStackModel` in `src/m6a/models.py`)

1. **Read-level model** (multiple-instance idea from m6Anet): LightGBM scores single reads (11 read values
   centred per 5-mer + 7-mer); each read inherits its site's label. At most 20 random reads per site, in
   training and prediction alike, so pooled scores do not depend on depth.
2. **Pooling**: per site, mean / median / 75th / 90th percentile / max of read probabilities, share of reads
   > 0.5, depth-normalised noisy-OR.
3. **Neighbour context**: m6A sites cluster, so a site-only LightGBM scores every site and the max / mean score of
   the other candidate sites within 25 and 100 nt of the same transcript become features (no labels used).
4. **Final LightGBM** on site features + 7-mer + pooled read scores + neighbour features.
   Training sites get **out-of-fold** read and neighbour scores (3 inner gene-grouped folds), so the
   final model never learns from scores produced by a model that saw that site's label.

## Final results (trained once on the training 80%, `05_final_eval.py`)

| Model | dataset0 test ROC | dataset0 test PR | dataset1 unseen ROC | dataset1 unseen PR |
|---|---|---|---|---|
| Random | 0.524 | 0.048 | 0.499 | 0.083 |
| 5-mer prior | 0.798 (0.772–0.820) | 0.142 (0.121–0.165) | 0.717 (0.702–0.731) | 0.158 (0.142–0.174) |
| Logistic regression | 0.905 | 0.423 | 0.825 | 0.338 |
| LightGBM, site features | 0.916 (0.892–0.936) | 0.482 (0.424–0.539) | 0.834 (0.818–0.848) | 0.360 (0.328–0.397) |
| Read stack (no neighbours) | 0.919 | 0.483 | 0.841 | 0.375 |
| **Final model** | **0.932 (0.906–0.952)** | **0.520 (0.456–0.581)** | **0.860 (0.844–0.874)** | **0.403 (0.370–0.440)** |

Paired gene-bootstrap differences, final model minus:

* 5-mer baseline: PR +0.379 (0.326–0.428) on dataset0, +0.246 (0.218–0.274) on dataset1.
* LightGBM site model: PR +0.037 (0.020–0.054), ROC +0.016 (0.008–0.023) on dataset0;
  PR +0.042 (0.030–0.055), ROC +0.025 (0.019–0.032) on dataset1.
* Read pooling alone vs LightGBM: +0.001 (−0.012–0.014) on dataset0 (not significant), +0.015 (0.006–0.025) on dataset1.

dataset2 (Spearman between score and known modification fraction): final model 0.41 overall and
0.64 within 5-mers (median), vs 0.35 / 0.45 for the LightGBM site model and 0.27 / 0.40 for logistic
regression. The 5-mer prior scores 0 because every fraction uses the same sequences. Plain LightGBM
barely moves its score with the fraction; the final model's median score climbs from 0.01 (0%) to
~0.45 (75%), then levels off. See `docs/figures/model_evaluation.png`.

**Training on two runs** (dataset0-train + matching dataset1 transcripts): dataset0 test PR 0.510 vs 0.520
for dataset0 alone, a difference within noise, so the submitted model is trained on all of dataset0.

The submitted model (`models/m6a_model.joblib`) is retrained on **all** of dataset0 with `scripts/train.py`.
Run through `scripts/predict.py` on the raw dataset1 file it gives ROC 0.861 / PR 0.405 on the unseen
transcripts (same as above), scoring 90,810 sites in 42 s.

## Limitations / open items

* Cross-run gap: PR drops from ~0.52 to ~0.40 on dataset1. Part of this is the labels themselves
  (the 5-mer prior also falls from ROC 0.80 to 0.72), part is batch shift.
* Neighbour features assume the scored file contains whole transcripts (true for m6Anet output). If only isolated
  sites were scored, those features would be 0 and the model falls back on its other features.
* dataset1 transcripts not in dataset0 have no gene_id; a few could be isoforms of dataset0 genes.
* Still to do: m6Anet benchmark (needs its Python 3.8 env on AWS), read-depth subsampling check, seed stability.

## Reproduce

```bash
python scripts/build_features.py data/data0/dataset0.json.gz cache/d0 --info data/data0/data.info.labelled --max-reads 50 --jobs 2
python scripts/build_features.py data/data1/dataset1.json.gz cache/d1 --info data/data1/data.info --max-reads 50 --jobs 2
python scripts/build_features.py data/data2/dataset2.json.gz cache/d2 --info data/data2/data.info --max-reads 50 --jobs 2
cd experiments
python 01_cv_models.py        # baselines and models, ~15 min
python 02_variants.py         # design checks, ~7 min
python 03_read_level.py       # read-level model, ~12 min
python 04_neighbours.py       # neighbour context, ~6 min
python 05_final_eval.py       # one-shot test evaluation, ~15 min
python 06_figures.py
```
Times are for 2 CPU cores.
