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
for dataset0 alone, a difference within noise, so the shipped model is trained on all of dataset0.

The shipped model (`models/m6a_model.joblib`) is retrained on **all** of dataset0 with `scripts/train.py`.
Run through `scripts/predict.py` on the raw dataset1 file it gives ROC 0.861 / PR 0.405 on the unseen
transcripts (same as above), scoring 90,810 sites in 42 s.

## m6Anet benchmark (12 Oct 2026, `07_m6anet_*`, `08_m6anet_compare.py`)

Pretrained m6Anet 2.1.0 (default model `HCT116_RNA002`, Python 3.8 env from `environment_m6anet.yml`) scored on
the same sites. Our json files already are m6Anet `dataprep` output; `07_m6anet_prepare.py` only decompresses them and
writes the byte-offset index (`data.info`) that `m6anet inference` needs. Every test site was scored.

| Test set | m6Anet ROC / PR | Final model ROC / PR | Final − m6Anet PR (95% CI) |
|---|---|---|---|
| dataset0 held-out genes | 0.932 / 0.485 | 0.932 / 0.520 | +0.034 (0.006 to 0.061) |
| dataset1 unseen transcripts | 0.834 / 0.348 | 0.860 / 0.403 | +0.055 (0.039 to 0.070) |

m6Anet's pretrained model was trained on SG-NEx HCT116 with m6ACE-seq labels, possibly overlapping dataset0, which
would favour m6Anet on dataset0; dataset1 is the cleaner comparison. On dataset2 m6Anet tracks the modification
fraction better within a 5-mer (median Spearman 0.69 vs 0.64) and keeps rising up to 100%, while our model separates
unmodified sites better (median score 0.01 vs 0.15 at 0%). See `docs/figures/m6anet_comparison.png`.

## v2: transcript-structure features (12 Oct 2026, `09`–`11`)

**Idea.** m6A sits preferentially near the stop codon and in 3' UTRs, in the last exon and long internal exons,
and is depleted within ~200 nt of exon–exon junctions (exon junction complex). The signal and the 7-mer cannot see
this, so v1 could not use it.

**Annotation** (`src/m6a/annotation.py`, `scripts/build_annotation.py`). Ensembl 91 GTF including haplotypes and
patches (~2% of our transcripts lie on alternate haplotypes, e.g. the MHC region) turned into one row per transcript
(`resources/ensembl91_transcripts.csv.gz`, 4.9 MB, committed). Release check (`09_annotation_check.py`): the 7-mer
of 20,000 sampled sites per run matches the Ensembl 91 cDNA/ncRNA sequence at `transcript_position` with offset 0
in **100%** of cases, and every transcript is annotated. 16 features per site: region (5' UTR / CDS / 3' UTR) and
relative position within it, signed distance to start and stop codon, distance to the nearest exon junction,
last-exon flag, exon length and relative position, transcript / UTR / CDS lengths, number of exons. They are
label-free, so they are available at prediction time and cannot leak.

Positive rate in the training genes: 0.5% within 50 nt of a junction vs 12% at 100–500 nt; 7.5% in the last exon
vs 1.4% elsewhere; 11.6% in the first 200 nt after the stop codon (overall 4.5%).

**Candidate improvements, 5-fold gene-grouped CV on the training 80%** (`10_improvements_cv.py`, same folds for
every variant):

| Variant | CV PR | Δ PR vs v1 (SD over folds) | folds better | CV ROC |
|---|---|---|---|---|
| v1 (final model above) | 0.535 | – | – | 0.944 |
| **+ annotation features** | **0.590** | **+0.055 (0.015)** | **5/5** | **0.956** |
| + read re-labelling (one EM-style MIL round) | 0.536 | +0.000 (0.011) | 2/5 | 0.945 |
| + richer neighbours (10/25/50/100 nt, neighbours' read scores, nearest-site distance) | 0.544 | +0.009 (0.010) | 3/5 | 0.945 |
| annotation + richer neighbours | 0.590 | +0.055 (0.015) | 5/5 | 0.955 |
| all three | 0.589 | +0.054 (0.013) | 5/5 | 0.956 |

Only the annotation features help. Re-labelling (weight the reads of positive sites by their round-1 probability
and refit) gives nothing and doubles training time; the richer neighbour context's small gain disappears once the
annotation is there. **v2 = v1 + annotation features, averaged over three seeds** (`SeedEnsemble`, `V2_CONFIG`).

Transcripts missing from Ensembl (e.g. the synthetic dataset2) get NaN annotation features. Every training
transcript is annotated, so LightGBM had never seen NaN and read it as 0 ("on an exon junction"): on dataset2 the
first v2 scored every site near 0 (ranking intact, levels collapsed). Hiding the annotation of 10% of training
transcripts did not fix this, so v2 also fits one model without annotation (= v1) and uses it for unannotated
transcripts. All dataset0/dataset1 sites are annotated, so their scores come from the annotated ensemble only.

**Final test results** (`11_final_eval_v2.py`, trained once on the training 80%; differences are paired gene-bootstrap
vs v1). `d1 strict` drops the 2,339 "unseen" dataset1 sites (15%) whose transcript is an isoform of a *training gene*
(gene ids now come from Ensembl, dataset1 has none of its own), so it is the cleaner cross-run test.

| Model | d0 test ROC / PR | d1 unseen ROC / PR | d1 strict ROC / PR |
|---|---|---|---|
| 5-mer prior | 0.798 / 0.142 | 0.717 / 0.158 | 0.715 / 0.147 |
| m6Anet (pretrained) | 0.932 / 0.485 | 0.834 / 0.348 | 0.839 / 0.334 |
| v1 (final model) | 0.932 / 0.520 | 0.860 / 0.403 | 0.865 / 0.392 |
| v2, single seed | 0.951 / 0.554 | 0.876 / 0.431 | 0.880 / 0.420 |
| **v2** | **0.952 / 0.561** | **0.877 / 0.434** | **0.881 / 0.421** |
| v2 trained on two runs | 0.948 / 0.552 | – | 0.882 / 0.435 |

* v2 − v1, PR: **+0.042 (0.013 to 0.071)** on dataset0, +0.032 (0.015 to 0.049) on d1 unseen,
  +0.028 (0.013 to 0.045) on d1 strict; ROC +0.020 / +0.017 / +0.016, all CIs above 0.
* Seed averaging adds a little over a single seed (+0.007 PR on dataset0, ~+0.002 on dataset1).
* dataset2: its synthetic transcripts are not in Ensembl, so v2 scores them with the fallback (= v1): Spearman 0.41,
  within-5-mer 0.64, the same as v1. The transcript-structure gain only applies to annotated transcripts.
* Most important new features (gain): exon length, distance to the nearest junction, distance to the stop codon,
  right after the pooled read scores and the neighbour context.

**Two runs.** Training on dataset0-train + the dataset1 sites of training genes (159,983 sites) gives d1 strict PR
0.435 vs 0.421 for v2, and dataset0 PR 0.552 vs 0.561. It only helps on the run it was partly trained on, and the
model learns that run's batch effects, so the dataset1 gain overstates what a new, unseen run would get. With only
two labelled runs this cannot be tested cleanly, so the shipped v2 is trained on dataset0 only, as v1 was.

**Model file.** `models/m6a_model_v2.joblib` (`python scripts/train.py --v2 --data data/data0/dataset0.json.gz
data/data0/data.info.labelled --out models/m6a_model_v2.joblib`). `models/m6a_model.joblib` (v1) and the default
of `train.py` are unchanged until the team agrees to switch.
Run through `scripts/predict.py` on the raw dataset1 file it gives ROC 0.878 / PR 0.434 on the unseen transcripts
(same as above), scoring 90,810 sites in 168 s. The file is 16 MB (three seed models + fallback + annotation table).

**Caveat.** A small smoke test of the code during development was scored on the dataset0 test genes (a model
trained on 800 training genes, used only to check the code ran). No choice was based on it; all choices above come
from cross-validation.

## Limitations / open items

* Cross-run gap: PR drops from ~0.56 to ~0.43 on dataset1 (v1: ~0.52 to ~0.40). Part of this is the labels
  themselves (the 5-mer prior also falls from ROC 0.80 to 0.72), part is batch shift.
* Neighbour features assume the scored file contains whole transcripts (true for m6Anet output). If only isolated
  sites were scored, those features would be 0 and the model falls back on its other features.
* v2 needs Ensembl 91 transcript ids (as in the course data and SG-NEx); other transcripts are scored by the
  v1-style fallback model, without the transcript-structure gain.
* The v1 results above count 2,339 dataset1 "unseen" sites that are isoforms of training genes (see d1 strict).
* Still to do: read-depth subsampling check.

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
# m6Anet benchmark (needs the m6anet env; M6ANET = path to its m6anet binary if not on PATH)
M6ANET=m6anet ./07_m6anet_run.sh   # ~15 min
python 08_m6anet_compare.py   # ~6 min
# v2 (Ensembl 91 GTF + cDNA/ncRNA fasta in cache/annotation/, see scripts/build_annotation.py)
python 09_annotation_check.py # release check + positive rate by region, ~2 min
python 10_improvements_cv.py  # candidate improvements, ~2.5 h
python 11_final_eval_v2.py    # one-shot test evaluation of v2, ~1 h
```
Times are for 2 CPU cores.
