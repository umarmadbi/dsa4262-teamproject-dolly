# Task 2 findings: Dolly v2 on the SG-NEx direct RNA-seq data, compared with m6Anet

*Team Dolly · findings report to guide the interactive visualisation · 21 Oct 2026*

**Who this is for.** Team members designing the visualisation, and indirectly the researchers who will use it. It
gathers what the SG-NEx predictions show, how much of it can be trusted, and what each finding means for the
dashboard. Section 13 turns the findings into concrete visualisation specs.

**Where the numbers come from**

| Source | What it covers | Status |
|---|---|---|
| `experiments/12_sgnex_m6anet_compare.py` → `docs/sgnex_task2.md` (16 Oct) | Dolly v2 vs m6Anet: agreement, regions, motifs, depth, reproducibility | Taken as reported. m6Anet per-site outputs (9.9 GB) live only on the AWS machine, so they were **not re-run** here |
| `experiments/05`, `08`, `11` → `docs/model_development.md` | Labelled benchmark (dataset0/1/2) of v1, v2, m6Anet and baselines | Taken as reported (context only) |
| **New analyses for this report** | Re-analysis of the Dolly v2 scores of all 23 SG-NEx runs (`viz/site/data/SGNex_*.json`, every site with ≥ 20 reads), the Ensembl 91 transcript table, and the dataset0/dataset1 labels | Scripts and output tables come with this report (section 14) |

No model was re-trained or re-run. The v2 scores in the dashboard files are the same `scripts/predict.py` output
that experiment 12 used: 2,973,240 site observations here vs 2,973,155 m6Anet-scored sites there. The 85 extra
sites come from the two pipelines' read-count filters disagreeing at the 20-read boundary.

---

## 1. Key findings at a glance

1. **A data-integrity bug affects one run.** `MCF7 replicate 3 run 1` uses versioned transcript IDs
   (`ENST….7`), while the Ensembl 91 annotation table and every other run use unversioned IDs. `predict.py` matches
   transcripts by exact ID, so **none of this run's 109,315 sites got annotation features**. All of them were scored
   by v2's fallback model, which is effectively v1. The run is also split from MCF7 rep 4 in the dashboard's
   cell-line summary. This explains why "MCF7 rep 3" was the outlier in experiment 12. *(Section 3)*
2. **Dolly v2 holds up on independent labels across all 7 cell lines.** On dataset1 sites whose genes the model
   never saw in training, SG-NEx scores reach a median ROC AUC of 0.86 and PR AUC of 0.39, about 5.3× the
   positive rate. That is in line with the dataset1 test result (0.88 / 0.42). Hct116, the training cell line,
   does not clearly come out ahead. *(Section 4)*
3. **Scores are calibrated up to about 0.5 and flat above it.** Sites scored 0.2–0.3 are labelled positive 28% of
   the time and sites scored 0.3–0.5 39%. Above 0.5, precision levels off at about 0.5, so 0.9 does not mean
   90%. *(Section 4.3)*
4. **v2 and m6Anet agree moderately, and the disagreement is mostly about transcript structure.** Median per-run
   Spearman is 0.64 and median Jaccard of calls 0.49. The MCF7 rep 3 run was accidentally scored without
   annotation features, and there v1 and m6Anet correlate at **0.78**. Much of the v2/m6Anet gap therefore comes
   from v2's transcript-position features. *(Section 5)*
5. **The predicted m6A landscape matches the known biology, even without annotation features.** Calls are 2×
   enriched within 200 nt of the stop codon (44% vs 22% of sites) and 1.7× in the last exon (87% vs 51%). They are
   almost absent within 50 nt of an exon junction (0.9% of calls vs 37% of sites). The v1 fallback run, which
   cannot see annotation, shows the same three patterns. *(Section 6)*
6. **GGACT dominates.** It makes up 34% of calls but 5% of sites (6.6×), and the motif hierarchy is almost
   identical in every cell line (Spearman ρ ≥ 0.98 between cell lines). *(Section 7)*
7. **The "depth effect" is really an expression effect.** Within a run, call rate is flat across read depth
   (3.0–3.2% from 20 to 320 reads). Across runs, call rate tracks run size (r = 0.76) because deeper runs reach
   lowly expressed transcripts, which carry more predicted m6A: 3.6–4.0% for sites seen in ≤ 5 runs vs 2.1% for
   sites seen in all runs. *(Section 8)*
8. **Most of the m6A pattern is shared between cell lines.** On 181,875 sites measured in ≥ 2 runs of ≥ 2 cell
   lines, **94%** of score variance is between sites, 2.2% is site × cell line and 3.8% is run-to-run noise.
   Cell-line mean scores correlate at ρ = 0.94–0.98. *(Section 9)*
9. **Few cell-line-specific sites survive a permutation test.** Only 4 sites are clearly on in one cell line and
   off in another (null: 0.8). A looser screen finds 523 candidates at an estimated FDR of about 40%, and they
   are dominated by "high in Hct116". That is more likely a training-domain calibration effect than biology.
   *(Section 9.4)*
10. **Calls near the threshold are unstable.** About a third of binary calls differ between two runs of the same
    cell line (median Jaccard 0.67), even though score correlations are high (ρ ≈ 0.94). Re-sequencing the same
    library is no more consistent than a new replicate. *(Section 10)*
11. **Gene level:** 11,349 sites in 3,121 genes (34% of measured genes) are robustly called. Isoforms make
    gene-level counts double-count the same genomic site. *(Section 11)*

---

## 2. What was scored

* **23 SG-NEx direct RNA-seq runs, 7 cell lines** (A549, H9, HEYA8, Hct116, HepG2, K562, MCF7). Each `data.json`
  was scored by `predict.py` with `models/m6a_model_v2.joblib`. Sites with < 20 reads and SIRV/ERCC spike-ins were
  dropped. Only 4–16% of predicted sites reach 20 reads, for example 66,382 of 1,008,933 in A549 rep 5.
* **All candidate sites are DRACH**: every centre 5-mer matches `[AGT][AG]AC[ACT]`. A score is the probability that
  a DRACH site is modified, not a transcriptome-wide m6A rate.
* **A "call" is score ≥ 0.5.** On held-out Hct116 genes this calls a similar share of sites as m6Anet ≥ 0.9.
* **Unit of analysis.** A site is a `(transcript_id, transcript_position)` pair. "Observations" counts every run
  in which a site was measured.

| Cell line | Runs (clean) | Site observations | Unique sites | Genes |
|---|---|---|---|---|
| A549 | 2 | 253,403 | 187,164 | 4,999 |
| H9 | 6 | 476,544 | 150,859 | 4,185 |
| HEYA8 | 5 | 687,972 | 215,987 | 5,001 |
| Hct116 | 3 | 530,276 | 243,174 | 5,970 |
| HepG2 | 2 | 506,716 | 287,689 | 6,432 |
| K562 | 3 | 265,966 | 120,227 | 4,330 |
| MCF7 | 1 (+1 affected by the ID bug) | 143,048 | 143,048 | 4,409 |
| **All (clean)** | **22** | **2,863,925** | **442,435** | **9,153** |

"Clean" excludes MCF7 rep 3 (section 3). Per-run numbers are in Appendix A. The design is unbalanced, from 1 run
(MCF7) to 6 (H9), and run size varies 7.6-fold (34k to 260k sites). Any cell-line summary has to account for this.

**Score distribution.** 90.4% of observations score < 0.1, 3.08% score ≥ 0.5 and only 0.06% score ≥ 0.9. The
distribution is very skewed. A linear histogram shows nothing useful, so the dashboard should use a log y-axis or
plot the 0.1–1 range separately.

---

## 3. Data-integrity finding: MCF7 replicate 3 was scored without its annotation features

**Evidence**

* `SGNex_MCF7_directRNA_replicate3_run1` is the only run whose transcript IDs carry a version suffix (100% of its
  sites; 0% in the other 22 runs). The Ensembl 91 table has no versions.
* Exact-ID lookup finds an annotation for 0% of this run's sites; after stripping the version, 100%.
* The coordinates are the same as MCF7 rep 4: at 88,680 shared sites the 7-mer matches in 100% of cases. Only the
  ID string differs.
* `SeedEnsemble.predict_proba` sends unannotated transcripts to the fallback model, which is v1 (no annotation
  features). The whole run was therefore scored by v1.

**Consequences**

| Where | Effect |
|---|---|
| Experiment 12 | MCF7 rep 3 was "the outlier" (Spearman with m6Anet 0.784 vs median 0.637). The cause is the model swap, not the cell line. Its run pairs share < 1,000 sites under exact-ID joins, so they were dropped from the reproducibility analysis |
| Score agreement with other runs | With versions stripped, MCF7 rep 3 vs rep 4: ρ = 0.76 and Jaccard 0.51, compared with ρ ≈ 0.93 and Jaccard ≈ 0.67 for other same-cell-line pairs |
| Dashboard `cell_lines.json` | 2,908 MCF7 rep 3 sites sit on 1,403 versioned transcript IDs that are never merged with rep 4. The panel labelled "MCF7 · mean of 2 runs" never averages two runs. Gene and transcript searches for MCF7 return duplicate rows, and cross-cell-line lookups miss rep 3 |
| Label check (section 4) | MCF7 rep 3 recall at 0.5 is 0.23 vs 0.37 for rep 4 |

**Decision (24 Oct 2026): not re-scored; reported as a dataset limitation.** The run is kept but flagged
(`limitations: ["v1Fallback"]` in `viz/site/data/manifest.json`). `scripts/build_viz_insights.py` leaves it out of
every cell-line summary, mean, shared-site set, reproducibility statistic, Landscape view and the atlas. The
dashboard shows it with a hollow, dashed marker, a warning badge and a "Known limitations" note. The fix, if it is
ever needed, would be to strip version suffixes before the annotation merge in `predict.py`, re-score the run, and
re-run experiment 12.

Every analysis below that compares cell lines therefore **excludes MCF7 rep 3**. MCF7 therefore has one run, so
its cell-line values are noisier than the others. The run still has a use: it accidentally shows what the model
does **without** transcript-structure features (sections 5.3 and 6.3).

---

## 4. Does the model work on SG-NEx? Checking against independent labels

SG-NEx has no ground truth, but the course labels (m6ACE-seq in HCT116) can be placed on the SG-NEx sites that
share a transcript and position.

### 4.1 Held-out labels: dataset1 genes never seen in training

The shipped v2 was trained on **all** of dataset0, including the genes that were held out during development.
Clean labels therefore have to come from dataset1, restricted to transcripts **and genes** absent from dataset0:
12,279 sites, 634 genes, 7.6% positive. These sites match 57,461 SG-NEx observations across the 22 clean runs.

| Cell line | Runs | Labelled observations | Median ROC AUC | Median PR AUC | PR AUC ÷ positive rate |
|---|---|---|---|---|---|
| A549 | 2 | 5,317 | 0.804 | 0.359 | 4.8 |
| H9 | 6 | 9,552 | 0.838 | 0.344 | 5.5 |
| HEYA8 | 5 | 13,388 | 0.852 | 0.405 | 5.0 |
| Hct116 | 3 | 7,417 | 0.892 | 0.378 | 5.1 |
| HepG2 | 2 | 12,159 | 0.892 | 0.399 | 5.7 |
| K562 | 3 | 5,992 | 0.872 | 0.457 | 5.6 |
| MCF7 (rep 4) | 1 | 3,636 | 0.903 | 0.442 | 5.9 |
| **All 22 runs** | | 57,461 | **0.858** (0.75–0.91) | **0.394** (0.26–0.53) | **5.3** |

* Results agree with the labelled benchmark: dataset1 d1-strict v2 scored 0.881 / 0.421, and SG-NEx runs give
  0.86 / 0.39.
* **Most of the spread between runs is sample size, not cell line.** The weakest ROCs come from the smallest runs,
  such as A549 rep 5 with 766 labelled sites (0.75) and the H9 run 2 libraries with about 550 (0.81).
* **No clear Hct116 advantage.** On the 330 labelled sites measured in all 7 cell lines (20 positives), PR AUC is
  0.35–0.43 in every cell line. With gene-bootstrap CIs, Hct116 minus the mean of the other lines is −0.016
  (−0.094 to +0.023).
* **Interpretation.** These labels are HCT116 m6ACE-seq, so a drop in another cell line could mean model shift
  *or* real biological difference. The ranking is equally good everywhere, so (a) the model transfers across
  cell lines and (b) most HCT116-labelled sites behave the same in the other six lines. This fits finding 8.

### 4.2 A caution on dataset0 labels: training data shows up in SG-NEx

On dataset0-labelled sites the SG-NEx runs reach ROC 0.97–0.98 and PR around 0.70. That is far above anything
held out, because the shipped model was trained on these labels. These numbers are **in-sample and must not be
reported as performance**.

One run stands out: **Hct116 rep 3 run 1 gives PR 0.88 vs 0.71–0.73 for the other two Hct116 runs on exactly the
same 121,838 sites**. The most likely explanation is that the dataset0 reads come from (or overlap) this run, so
the model has effectively seen its reads. This could not be confirmed, because `data.info.labelled` has no read
counts to match. dataset1 is **not** any of the 23 runs: exact read-count matches are only 1–2%.

*For the visualisation:* flag Hct116 rep 3 run 1 as "possibly overlaps the training data". Never show dataset0
labels on SG-NEx sites as validation.

### 4.3 Calibration: what a score means

All 22 clean runs pooled, on the held-out dataset1 labels:

| Score bin | Observations | Labelled positive | Mean score |
|---|---|---|---|
| 0–0.05 | 46,320 | 2.2% | 0.007 |
| 0.05–0.1 | 2,863 | 9.2% | 0.072 |
| 0.1–0.2 | 2,279 | 18.6% | 0.144 |
| 0.2–0.3 | 1,280 | 28.2% | 0.246 |
| 0.3–0.5 | 1,765 | 38.8% | 0.395 |
| 0.5–0.7 | 1,634 | 51.9% | 0.598 |
| 0.7–0.9 | 1,268 | 48.7% | 0.785 |
| 0.9–1.0 | 52 | 42.3% | 0.920 |

| Threshold | % of sites called | Precision | Recall |
|---|---|---|---|
| 0.1 | 14.4 | 0.36 | 0.70 |
| 0.2 | 10.4 | 0.42 | 0.60 |
| 0.3 | 8.2 | 0.46 | 0.51 |
| **0.5 (default)** | **5.1** | **0.50** | **0.35** |
| 0.7 | 2.3 | 0.48 | 0.15 |
| 0.9 | 0.09 | 0.42 | 0.005 |

* Below 0.5 the score is close to a calibrated probability. Above 0.5, precision stays at about 0.5 whatever the
  score. Part of that ceiling comes from the labels: m6ACE-seq misses true sites, so "false positives" include
  unlabelled real sites.
* **Raising the threshold above 0.5 buys no precision and loses most of the recall.** A threshold slider should
  show this trade-off and not imply that 0.9 means "confident".
* The rate in these labelled transcripts (5.1% called at 0.5) is higher than the overall SG-NEx rate (3.1%)
  because labelled transcripts are enriched for m6A-bearing genes.

---

## 5. Dolly v2 vs m6Anet on SG-NEx

*All m6Anet numbers in this section come from experiment 12 (`docs/sgnex_task2.md`). Thresholds: Dolly ≥ 0.5,
m6Anet ≥ 0.9; these call similar shares of held-out Hct116 sites (2.9% vs 3.0%).*

### 5.1 Context: the labelled benchmark

| Test set | m6Anet ROC / PR | Dolly v2 ROC / PR | v2 − m6Anet PR (95% CI) |
|---|---|---|---|
| dataset0 held-out genes | 0.932 / 0.485 | 0.952 / 0.561 | +0.076 (v1 alone was +0.034, 0.006–0.061) |
| dataset1 strict (unseen genes) | 0.839 / 0.334 | 0.881 / 0.421 | about +0.087 (v1 vs m6Anet +0.058, 0.041–0.076; v2 vs v1 +0.028, 0.013–0.045) |
| dataset2 (known modification fractions) | Spearman 0.28, within 5-mer 0.69 | 0.41 / 0.64 | m6Anet tracks stoichiometry better within a 5-mer |

The v2 − m6Anet differences are chained from the paired CIs in `final_v2_metrics.csv`. The direct paired v2-vs-m6Anet CI
has not been computed. m6Anet's pretrained model was trained on SG-NEx HCT116, possibly including the same reads,
which would favour it on Hct116.

### 5.2 Agreement on SG-NEx

| Metric (median over runs) | Value |
|---|---|
| Spearman of scores | 0.637 |
| Jaccard of calls | 0.489 |
| Overlap of the top-K sites (K = number of m6Anet calls) | 0.655 |
| Call rate, both methods | 1.8–4.3% of sites per run |

The joint distribution is **asymmetric** (hexbin, `docs/figures/sgnex_m6anet_comparison.png`, panel a). Sites that
Dolly scores high almost always have a high m6Anet probability. m6Anet, however, gives high probabilities (> 0.6)
to a large set of sites Dolly scores near 0. m6Anet is therefore more permissive, and Dolly ranks by more than the
current signal.

### 5.3 Why they disagree: a natural experiment

MCF7 rep 3 was scored by v1, which has no transcript-structure features (section 3). In experiment 12, that run's
Dolly–m6Anet Spearman was **0.784**, the highest of all 23 runs and well above the median of 0.637 for v2 runs.
v1 and m6Anet both score sites from the current signal and the k-mer, while v2 also weighs **where in the
transcript the site sits**: exon length, distance to the junction and distance to the stop codon are its top
non-signal features by gain. Many of the "m6Anet high, Dolly low" sites are therefore DRACH sites with a
convincing signal in positions v2 has learned are rarely modified, such as near junctions or deep in the CDS.

*Caveat:* this is a single run, and it also differs from the others in cell line and run. Running v1 on a few
other SG-NEx runs would turn this into a proper comparison of v1 vs v2 against m6Anet. That needs only
`predict.py --model models/m6a_model.joblib` and experiment 12.

### 5.4 Positional and motif patterns (both methods)

| Set | 5′UTR | CDS | 3′UTR | ≤ 200 nt from stop codon |
|---|---|---|---|---|
| All sites | 2.4% | 51.6% | 40.5% | 21.7% |
| Dolly v2 calls | 2.1% | 38.8% | 51.9% | 44.2% |
| m6Anet calls | 1.5% | 29.0% | 64.2% | 41.9% |
| Called by both | 1.8% | 33.6% | 58.6% | 44.5% |

* m6Anet leans harder towards the 3′UTR (64% vs 52%). Dolly keeps more CDS calls, which are mostly in the last
  exon just upstream of the stop codon (section 6).
* Motif enrichment over all sites: GGACT 6.6× (Dolly) vs 7.4× (m6Anet). AAACT and AGACA are depleted 0.3–0.4×
  for both.

### 5.5 Depth and reproducibility

* Call rate vs log10(run size): r = 0.76 (Dolly) and 0.85 (m6Anet). m6Anet is *more* tied to run size (section 8).
* Run-to-run Spearman, median: Dolly 0.936 within a cell line and 0.931 between cell lines; m6Anet 0.911 and
  0.907. **Dolly's scores are more reproducible.**
* Run-to-run Jaccard of calls: Dolly 0.674 / 0.642; m6Anet 0.696 / 0.647. Binary calls are equally stable.

**In one line:** both methods find the same canonical m6A landscape. Dolly is more selective and more reproducible
in ranking, it uses transcript context that m6Anet ignores, and on independent labels it is more accurate.

---

## 6. Where Dolly v2 places m6A on transcripts (22 clean runs)

### 6.1 Distance to the stop codon

| Distance to stop codon (nt; negative = upstream) | Observations | Call rate |
|---|---|---|
| < −1000 | 384,738 | 1.75% |
| −1000 to −200 | 839,553 | 1.90% |
| −200 to −50 | 245,580 | 3.38% |
| −50 to 0 | 82,648 | 6.66% |
| 0 to +50 | 89,502 | 8.18% |
| **+50 to +200** | 198,689 | **8.99%** |
| +200 to +500 | 262,148 | 4.63% |
| +500 to +1000 | 260,420 | 1.87% |
| > +1000 | 346,767 | 0.92% |

The call rate peaks in the first 200 nt of the 3′UTR at about 9%, 5× the CDS body. It falls off again in distal
3′UTRs, which matches the well-known stop-codon peak in m6A-seq metagenes (metagene plot: experiment 12, panel b).

### 6.2 Exon architecture

| Feature | Share of calls | Share of all sites | Call rate |
|---|---|---|---|
| Within 50 nt of an exon–exon junction | 0.9% | 37.1% | 0.06–0.09% |
| 50–100 nt | | | 1.1% |
| 100–200 nt | | | 7.9% |
| 200–500 nt | | | 9.4% |
| > 500 nt (or single-exon) | | | 3.9% |
| In the last exon | 87.3% | 51.1% | 5.3% (vs 0.8% elsewhere) |

By region: 3′UTR 3.9%, non-coding transcripts 4.1%, 5′UTR 2.7%, CDS 2.3%.

The junction depletion fits m6A biology: the exon junction complex blocks methylation within about 200 nt of
junctions, which is why m6A gathers in long internal exons and last exons. However, v2's near-total silence within
50 nt of a junction (0.06%, about 30 calls per 50,000 sites) is extreme. Visualisations should state that this
partly reflects a model feature.

### 6.3 Are these patterns just v2's annotation features?

**Mostly not.** The v1 fallback run (MCF7 rep 3, no annotation features) compared with v2 on MCF7 rep 4, on the
same 88,680 sites:

| | All shared sites | v1 calls (rep 3) | v2 calls (rep 4) |
|---|---|---|---|
| 3′UTR | 48.5% | 72.2% | 60.3% |
| ≤ 200 nt from stop | 26.9% | 45.4% | 48.7% |
| ≤ 50 nt from junction | 30.9% | 0.7% | 0.8% |
| Last exon | 62.6% | 96.7% | 94.3% |

v1 sees only signal, sequence and neighbouring-site context, yet shows the same stop-codon enrichment and the same
junction depletion. m6Anet, which also has no position input, shows them too. The patterns are therefore in the
nanopore signal, so the biology claim does not depend on v2's features. What v2 adds is a sharper version, and it
pulls some calls back from the far 3′UTR into the CDS near the stop codon.

### 6.4 Consistency across cell lines

| Cell line | Calls in 3′UTR | Calls in CDS | Calls ≤ 200 nt from stop | All sites ≤ 200 nt from stop |
|---|---|---|---|---|
| A549 | 53.5% | 37.3% | 45.2% | 22.7% |
| H9 | 54.1% | 38.7% | 45.9% | 22.9% |
| HEYA8 | 49.1% | 41.9% | 43.5% | 20.3% |
| Hct116 | 51.2% | 39.5% | 43.5% | 21.7% |
| HepG2 | 47.4% | 43.5% | 42.6% | 18.9% |
| K562 | 55.2% | 30.3% | 47.4% | 25.9% |
| MCF7 | 53.8% | 37.0% | 44.6% | 22.6% |

The stop-codon enrichment is about 2× in every cell line. The differences, such as K562's lower CDS share, follow
each line's own site composition: K562 sites lean towards the 3′UTR and stop codon to begin with. They do not
suggest a different metagene.

---

## 7. Sequence motifs

Every candidate is DRACH, so the comparison is *within* DRACH:

| 5-mer | Share of sites | Share of calls | Enrichment | Call rate |
|---|---|---|---|---|
| **GGACT** | 5.2% | **34.4%** | **6.6×** | **20.3%** |
| GGACA | 6.4% | 15.6% | 2.5× | 7.5% |
| GAACT | 5.7% | 13.4% | 2.4× | 7.3% |
| AGACT | 5.3% | 11.8% | 2.2× | 6.9% |
| GGACC | 5.9% | 9.6% | 1.6× | 5.0% |
| TGACT | 5.6% | 7.6% | 1.4× | 4.2% |
| AAACT | 7.1% | 2.5% | 0.35× | 1.1% |
| AGACA | 6.1% | 2.2% | 0.35× | 1.1% |
| … | | | | |
| AAACA, AAACC, TAACA, TAACC | 20% together | ≈ 0% | ≈ 0 | ≤ 0.002% |

* The six top motifs account for 92% of calls. Four motifs (A/T-A-AC-A/C) are never called. That is plausible,
  since they are the weakest METTL3–METTL14 substrates, but they cover 20% of candidate sites. A user filtering
  by motif should know the model has effectively ruled them out.
* **The motif hierarchy is the same in every cell line.** Spearman of the 18 per-motif call rates between any two
  cell lines is 0.982–0.998 (median 0.992). Hct116 has the highest call rate for each of the 10 most-called motifs (GGACT 23.4% vs
  18.5–22.5%), which is the same uniform offset seen in section 9.3.

---

## 8. Read depth vs expression: what drives call rates

Experiment 12 found that call rate rises with run depth. The new analysis separates two possible causes.

**(a) Per-site read depth has almost no effect**, as designed: the read model samples 20 reads per site.

| Reads at the site | Observations | Call rate |
|---|---|---|
| 20–30 | 1,052,575 | 3.07% |
| 31–40 | 482,686 | 3.19% |
| 41–60 | 491,443 | 3.19% |
| 61–80 | 241,268 | 3.10% |
| 81–160 | 340,903 | 2.98% |
| 161–320 | 143,839 | 2.96% |
| > 320 | 111,211 | 2.69% |

Restricting each run to sites with 20–39 reads leaves the run-size correlation unchanged (r = 0.75 vs 0.76). Read
noise is therefore not what drives it.

**(b) Which transcripts a run reaches is what matters.** The number of runs a site appears in is used as a proxy
for expression:

| Site measured in … runs | Observations | Median reads | Call rate |
|---|---|---|---|
| 1–2 | 247,315 | 25 | 3.63% |
| 3–5 | 363,875 | 27 | 3.96% |
| 6–10 | 576,773 | 31 | 3.51% |
| 11–15 | 579,296 | 36 | 3.14% |
| 16–20 | 608,061 | 49 | 2.66% |
| 21–22 (all runs) | 488,605 | 119 | 2.09% |

Highly expressed transcripts seen everywhere, typically housekeeping and ribosomal-protein genes, carry about half
the predicted m6A density of lowly expressed ones. This fits m6A's known role in promoting mRNA decay. A deeper run
reaches more lowly expressed, m6A-rich transcripts, so its overall call rate rises.

On the 14,992 sites measured in all 22 runs, the run-size correlation drops from 0.76 to 0.57. **About half of the
effect is composition and the rest is a smaller technical effect.**

**Implication:** comparing call rates between cell lines is only meaningful on a **shared site set**. The
dashboard's per-run call-rate bars should come with a "shared sites only" toggle.

---

## 9. Comparing the cell lines

### 9.1 Variance decomposition

Sites measured in ≥ 2 runs in each of ≥ 2 cell lines (MCF7 excluded, one run): 181,875 sites, 2.0 million
observations. The sums of squares of the v2 score split as follows:

| Component | Share of variance |
|---|---|
| Between sites (sequence, position, gene) | **94.0%** |
| Site × cell line | 2.2% |
| Run within cell line (technical) | 3.8% |

On a logit scale the shares are 95.1 / 1.5 / 3.4%. The site × cell line mean square is 1.5× the run mean square
(1.16× on logit). A cell-line component exists, but it is smaller than run-to-run noise. **Whether a site is
predicted as modified is almost entirely a property of the site.**

### 9.2 Cell-line correlation

58,004 sites were measured in all 7 cell lines (cell-line mean over runs).

| Spearman ρ | A549 | H9 | HEYA8 | Hct116 | HepG2 | K562 | MCF7 |
|---|---|---|---|---|---|---|---|
| A549 | 1 | .963 | .967 | .968 | .961 | .958 | .942 |
| H9 | | 1 | .974 | .973 | .966 | .964 | .950 |
| HEYA8 | | | 1 | .976 | .971 | .967 | .952 |
| Hct116 | | | | 1 | .970 | .967 | .951 |
| HepG2 | | | | | 1 | .959 | .943 |
| K562 | | | | | | 1 | .946 |
| MCF7 | | | | | | | 1 |

The structure mostly reflects **how many runs were averaged**. MCF7 (1 run) and A549 (2) have the lowest
correlations, while HEYA8 (5) and H9 (6) have the highest. No biological clustering stands out, for example
the two haematopoietic/hepatic lines (K562, HepG2) do not group together. A clustered heatmap would mostly show
replicate count, so a **run-level** heatmap (22 × 22) coloured by cell line is more honest.

### 9.3 Call rates on the shared site set

| | A549 | H9 | HEYA8 | **Hct116** | HepG2 | K562 | MCF7 |
|---|---|---|---|---|---|---|---|
| Raw call rate (all sites) | 3.09% | 2.78% | 2.76% | **3.82%** | 3.02% | 3.01% | 3.20% |
| Read-depth standardised | 3.09% | 2.76% | 2.76% | **3.82%** | 3.02% | 3.01% | 3.20% |
| On the 58,004 shared sites (cell-line mean ≥ 0.5) | 2.54% | 2.59% | 2.53% | **3.10%** | 2.47% | 2.60% | 2.52% |
| Mean score, shared sites | 0.041 | 0.040 | 0.040 | **0.047** | 0.040 | 0.040 | 0.037 |

Six lines sit at 2.5–2.6% on shared sites. **Hct116 is about 20% higher in all three of its runs**, and the offset
is spread across every motif (section 7). Two explanations:

* **Training-domain calibration (more likely).** The model was trained only on Hct116, so Hct116's signal
  distribution, and possibly its exact reads (section 4.2), sits where the model is most confident. The
  held-out labels show no Hct116 accuracy advantage, which points to a level shift rather than better detection.
* **Biology.** Higher METTL3 activity in HCT116 cannot be ruled out with these data.

The dashboard should not present "Hct116 has more m6A" as a finding.

### 9.4 Shared and cell-line-specific sites

Of the 58,004 shared sites, 2,143 are called (cell-line mean ≥ 0.5) in at least one line:

| Called in … of 7 lines | 1 | 2 | 3 | 4 | 5 | 6 | **7** |
|---|---|---|---|---|---|---|---|
| Sites | 313 | 176 | 151 | 137 | 159 | 258 | **949** |

* **949 sites (412 genes) are called in all 7 cell lines.** They are the most canonical m6A sites: 64% in the
  3′UTR, 56% within 200 nt of the stop codon, and 45% GGACT. The strongest average ≥ 0.90 across the 7 lines.
* **The 313 "single-line" sites are mostly borderline.** Their median maximum score is 0.54, against a median of
  0.37 in the other lines. Hct116 contributes 103 of them, a third.

**Permutation test for real differences.** Run labels were shuffled between the six cell lines with at least two
usable runs (21 runs; MCF7 has one usable run and is left out before shuffling), group sizes kept, 50 permutations
(seed 1, `scripts/build_viz_insights.py`). These are the numbers shown on the dashboard. The ± is the Monte Carlo
standard error of the FDR estimate. The null varies a lot between shuffles (see the SD), so a handful of shuffles is
not enough. An earlier 10-shuffle run gave 35–59%.

| Criterion (≥ 2 runs in each line) | Observed sites | Null mean (SD, max) | Estimated FDR |
|---|---|---|---|
| Every run ≥ 0.5 in line A **and** every run < 0.1 in line B | **4** | 0.8 (1.1, 5) | 21% ± 4 |
| Mean difference ≥ 0.4, runs fully separated, A mean ≥ 0.5 | 127 | 36.5 (17.2, 106) | 29% ± 2 |
| Mean difference ≥ 0.3 | 523 | 210.8 (66.3, 471) | 40% ± 2 |
| Mean difference ≥ 0.2 | 1,421 | 754.8 (174.4, 1,340) | 53% ± 2 |

Among the 523 candidates, **Hct116 is the "high" line in 410 cell-line pairs** and HepG2 is the "low" line in 344.
That is the calibration shift from section 9.3 again, not 523 independent biological events. The 4 strict sites
are listed in `tables/diff_sites_d03.csv` together with the looser set. The strongest is ENST00000476993:2055 (high in
H9, low in HepG2); a neighbouring site 9 nt away on the same transcript (position 2046) shows the same pattern
in the looser set. They are **candidates for experimental
follow-up, not findings.**

**Bottom line for Task 2 (2):** with technical runs only (no independent biological replicates) and a model
trained on one cell line, the data support a **conserved m6A landscape across 7 cell lines**. They do not support a
catalogue of cell-line-specific sites. That is still a useful, honest result for the report, and the dashboard
should let researchers see the uncertainty for themselves instead of hiding it.

---

## 10. Reproducibility: re-runs, replicates and cell lines

253 run pairs, version-stripped joins, 22 clean runs:

| Pair type | Pairs | Median shared sites | Spearman (all) | Jaccard (all) | Spearman (both ≥ 40 reads) | Jaccard (≥ 40 reads) |
|---|---|---|---|---|---|---|
| Same library re-run (e.g. H9 rep 2 run 1 vs run 2) | 6 | 48,047 | 0.935 | 0.665 | 0.951 | 0.703 |
| Same cell line, different replicate | 27 | 66,239 | 0.936 | 0.674 | 0.952 | 0.708 |
| Different cell line | 198 | 64,274 | 0.931 | 0.642 | 0.945 | 0.682 |
| Pairs involving MCF7 rep 3 (v1) | 22 | | 0.73 / 0.76 (medians: different / same line) | 0.47 / 0.51 | | |

* **Re-running a library adds nothing over a new replicate.** The SG-NEx "replicates" behave like technical
  repeats, as `sgnex_task2.md` warned. They cannot measure biological variability.
* **A stricter depth filter helps a little** (Jaccard 0.67 → 0.71). A depth slider in the dashboard is
  well-motivated.
* **About a third of binary calls flip between two runs of the same cell line**, even with ρ ≈ 0.94. Flips come
  from sites scoring near 0.5. The median absolute score difference between runs is only 0.013–0.014. Showing
  **scores with run-to-run spread** is more informative than showing call/no-call.

---

## 11. Gene-level view

A site is called "robust" when it is called in ≥ 2 runs and in ≥ 50% of the runs that measured it.

* **11,349 robust sites** on 3,953 transcripts in **3,121 genes**, which is **34% of the 9,153 measured genes**.
* Sites per gene: median 2, IQR 1–5, maximum 47.
* Genes with the most robust sites: *UBC* (ENSG00000150991), 47 sites across 3 transcripts; *SLC16A3* (ENSG00000141526), 41 across 6;
  *HNRNPF* (ENSG00000169813), 33 across 5; and *CLDN4* (ENSG00000189143), *NTSR1* (ENSG00000101188) and *PRAME* (ENSG00000185686), 31 each. Symbols come from the
  Ensembl 91 GTF.
* **Isoforms inflate gene counts.** 588 of 3,121 genes have robust sites on more than one transcript. Sites are
  in transcript coordinates, so the same genomic adenosine on two isoforms counts twice. The top genes above are
  multi-isoform genes. Gene-level counts need a genomic-coordinate collapse first; the Ensembl GTF exon
  coordinates are available to `build_annotation.py`. Otherwise the dashboard should report "sites per
  transcript".
* **Gene symbols** come from the Ensembl 91 GTF (`gene_name`) via `scripts/build_gene_names.py`. All 9,339 genes
  in the dashboard have one, and users can search by symbol. Gene and transcript IDs remain the join keys.

---

## 12. Caveats and limitations

| Caveat | Consequence | How to show it |
|---|---|---|
| No ground truth on SG-NEx; held-out labels cover only about 57k observations in HCT116-labelled genes | Accuracy on SG-NEx is estimated, not measured; other cell lines are judged against HCT116 labels | State the label source next to any accuracy number |
| Model trained on Hct116 only; dataset0 reads may come from Hct116 rep 3 run 1 | Hct116 scores are shifted up (~20%); Hct116 r3.1 is partly in-sample | Badge on Hct116 runs; no "Hct116 has more m6A" claims |
| MCF7 rep 3 scored by the v1 fallback (ID bug) | Not comparable with other runs until re-scored | Exclude or label until fixed |
| Runs are technical, not biological replicates | No real biological-variance estimate; per-site cell-line tests are weak | Avoid p-values for cell-line differences; show run spread |
| Unbalanced design (1–6 runs per line, 7.6× size range) | Cell-line means differ in precision; raw call rates confounded by expression | Shared-site toggle; show n runs |
| v2 uses transcript position | Positional enrichment is partly by construction (though v1 and m6Anet reproduce it) | Note in the metagene panel |
| Scores ≠ stoichiometry; precision plateaus at about 0.5 above score 0.5 | Score is a ranking, not a modification fraction | Calibration panel; avoid "% modified" wording |
| Transcript coordinates, isoforms not merged | Gene-level double-counting | Collapse to genomic coordinates or label "per transcript" |
| m6Anet per-site results only on AWS | m6Anet-side numbers here are from experiment 12, not re-derived | To show m6Anet in the dashboard, export a joined per-site file (section 14) |

---

## 13. What this means for the visualisations

The audience is researchers. The visualisations should answer *"Is my gene/site modified, how sure are we, and
does it differ between cell lines?"* They should do it with the uncertainty shown, not with summary numbers alone.
Views are listed in priority order.

### 13.1 Fixes to the existing dashboard (before new views)

1. Flag MCF7 rep 3 as "scored without annotation (v1 fallback)" (section 3). *Done: the run is flagged and kept out
   of summaries, by decision rather than re-scored.*
2. Rebuild `cell_lines.json` so MCF7 does not appear as two unmerged runs. *Done: rebuilt without the flagged run
   (MCF7 = 1 run).*
3. Add gene symbols (section 11). *Done: `site/data/gene_names.json`.*
4. *Done:* Badge Hct116 rep 3 run 1 as "may overlap training data". Badge Hct116 in general as "training cell line,
   scores shifted up".
5. Add a log-scale or "> 0.1 only" option to the score histogram, since 90% of scores are < 0.1.

### 13.2 New views

| # | View | Data (from this report's tables) | Interaction | What the researcher learns |
|---|---|---|---|---|
| 1 | **Site / gene browser with uncertainty**: lollipop track along the transcript (5′UTR / CDS / 3′UTR, exon junctions, stop codon), one row per cell line, dot = mean score, whisker = min–max over runs | per-run JSON + annotation table | Search by gene symbol / ID; pick isoform; hover shows 7-mer, reads, per-run scores; threshold slider | Where a gene's sites are, how reproducible each is, whether lines disagree |
| 2 | **Metagene panel**: called-site density vs all sites along 5′UTR–CDS–3′UTR, plus a distance-to-stop and distance-to-junction profile; one line per cell line (Dolly), with m6Anet overlay once exported | sections 6.1–6.2 | Toggle cell line, method, threshold; "shared sites only" | The canonical stop-codon / last-exon landscape and that it is conserved |
| 3 | **Motif view**: bar or dot plot of call rate per DRACH 5-mer × cell line (18 × 7) | `motif_by_cell.csv` | Sort; hover enrichment | GGACT dominance; four motifs never called; same hierarchy everywhere |
| 4 | **Cell-line comparison scatter**: cell line A mean vs B mean on shared sites, points coloured by run agreement, candidate differential sites highlighted with an FDR note | `sites_in_all7_celllines.csv`, `diff_sites_d03.csv` | Choose A/B; brush to list sites; download | Most sites on the diagonal; few robust differences; Hct116 offset visible |
| 5 | **Reproducibility heatmap**: 22 × 22 run Spearman / Jaccard, ordered by cell line → replicate → run | `pairs.csv` | Toggle metric and depth filter (≥ 20 / ≥ 40 reads) | Run noise ≈ replicate noise ≈ almost cell-line noise; the depth filter helps |
| 6 | **Depth vs expression panel**: run call rate vs run size (all sites vs shared sites) and call rate vs "number of runs measuring the site" | `per_run.csv`, section 8 | Toggle site set | Why raw call rates mislead; m6A density falls in highly expressed transcripts |
| 7 | **"How good is a score?" panel**: reliability curve and precision/recall vs threshold on held-out dataset1 labels, per cell line | `label_transfer_d1strict_runs.csv`, section 4.3 | Threshold slider linked to views 1 and 4 | Score ≤ 0.5 ≈ probability; > 0.5 plateaus; the cost of strict thresholds |
| 8 | **Dolly vs m6Anet** (needs export, section 14): per-site 2-D density with quadrant counts and per-run agreement bars | experiment 12 joined table | Click a quadrant to list sites, then open in view 1 | Where the methods agree, and that the disagreement is positional |
| 9 | **Conserved m6A atlas**: table of the 949 all-line sites and the 11,349 robust sites, with gene, region, motif, scores per line | `sites_in_all7_celllines.csv`, `robust_called_sites.csv` | Filter, sort, CSV download | A ready-to-use high-confidence site list |

**Design principles that follow from the findings**

* **Default to continuous scores, not binary calls** (section 10). Use a sequential colour scale anchored at 0–0.5
  where calibration holds, and treat everything above 0.5 as one "likely" band (section 4.3).
* **Every cross-cell-line comparison defaults to shared sites** (sections 8 and 9.3).
* **Show n runs and run spread wherever a cell-line mean appears** (sections 9.2 and 10).
* **Label sources and caveats in context**, e.g. "labels: HCT116 m6ACE-seq", "v2 uses transcript position", or
  "Hct116 = training line".

---

## 14. Reproducing this report and producing the visualisation data

**Inputs used:** `viz/site/data/SGNex_*.json` (v2 scores, reads and 7-mer for every site with ≥ 20 reads),
`viz/site/data/cell_lines.json`, `resources/ensembl91_transcripts.csv.gz`, `data0/data.info.labelled`,
`data1/data.info` and `results/test_genes_d0.csv`.

**Scripts** (`scripts/` in the bundle, run in order from one folder): `load.py` (parse runs) → `a2.py` (annotate
region, stop or junction distance, last exon) → `a3.py` (per-run, depth) → `a4.py` (shared sites, cell-line
correlation) → `a6.py` / `a7.py` (label transfer, in-sample and held-out) → `a8.py` (run pairs) → `a9.py`
(variance decomposition) → `a10.py` / `a11.py` (differential sites + permutation null) → `a12.py` (regions,
motifs) → `a13.py` (MCF7 v1-vs-v2 natural experiment) → `a14.py` (conserved and robust sites, genes) → `a15.py`
(calibration). They need pandas, numpy, scipy, scikit-learn and pyarrow. Runtime is a few minutes. If they go into
the repo, consolidate them as `experiments/13_sgnex_v2_deep_dive.py`.

**Output tables** (`tables/` in the bundle):

| File | Contents |
|---|---|
| `per_run.csv` | Per-run sites, transcripts, genes, reads, call rates, score summary |
| `pairs.csv` | All 253 run pairs: relation, shared sites, Spearman, Jaccard (all and ≥ 40 reads) |
| `label_transfer_d1strict_runs.csv`, `…_common.csv` | Held-out (dataset1, unseen genes) ROC/PR per run and per cell line |
| `label_transfer_d0labels_insample_runs.csv` | dataset0-label metrics per run. **In-sample, do not report as performance**; kept to document the Hct116 r3.1 signal |
| `motifs.csv`, `motif_by_cell.csv` | 5-mer shares, enrichment, call rates (overall and by cell line) |
| `sites_in_all7_celllines.csv` | 58,004 shared sites: mean score per cell line, gene, region, distances, n lines called |
| `robust_called_sites.csv` | 11,349 robust sites with gene, region, motif, run counts |
| `diff_sites_d03.csv` | Candidate cell-line differences (mean diff ≥ 0.3, runs separated), estimated FDR about 40% |

**Still needed from the AWS machine for the m6Anet views:**

1. Re-score MCF7 rep 3 (section 3) and re-run experiment 12.
2. Write the per-site joined table from experiment 12's `all_sites` frame (transcript, position, run, cell, reads,
   kmer, `dolly`, `m6anet`, region, `meta`) to `results/sgnex_compare_sites.parquet`.
3. Optionally, score 2–3 runs with v1 to confirm section 5.3.
4. Commit the small summary CSVs (`sgnex_compare_{runs,regions,motifs,pairs}.csv`) with `git add -f` so the
   dashboard can use them.

---

## Appendix A. Per-run summary (Dolly v2, sites with ≥ 20 reads, spike-ins removed)

| Run | Cell line | Sites | Transcripts | Genes | Median reads | % called (≥ 0.5) | Calls |
|---|---|---|---|---|---|---|---|
| A549 r5.1 | A549 | 66,382 | 3,252 | 2,439 | 36 | 2.58 | 1,712 |
| A549 r6.1 | A549 | 187,021 | 7,273 | 4,998 | 39 | 3.27 | 6,121 |
| H9 r2.1 | H9 | 103,263 | 4,109 | 3,131 | 35 | 2.97 | 3,069 |
| H9 r2.2 | H9 | 51,382 | 2,137 | 1,698 | 34 | 2.37 | 1,220 |
| H9 r3.1 | H9 | 96,507 | 3,962 | 3,014 | 35 | 2.69 | 2,592 |
| H9 r3.2 | H9 | 45,528 | 1,962 | 1,563 | 34 | 2.32 | 1,055 |
| H9 r4.1 | H9 | 145,730 | 5,428 | 4,082 | 37 | 3.22 | 4,687 |
| H9 r4.2 | H9 | 34,134 | 1,489 | 1,183 | 33 | 1.84 | 628 |
| HEYA8 r1.1 | HEYA8 | 172,190 | 5,849 | 4,297 | 38 | 3.10 | 5,336 |
| HEYA8 r1.2 | HEYA8 | 39,523 | 1,695 | 1,337 | 35 | 2.04 | 807 |
| HEYA8 r2.1 | HEYA8 | 157,389 | 5,485 | 4,034 | 37 | 2.74 | 4,311 |
| HEYA8 r2.2 | HEYA8 | 117,973 | 4,050 | 3,141 | 35 | 2.57 | 3,028 |
| HEYA8 r3.1 | HEYA8 | 200,897 | 6,646 | 4,779 | 40 | 2.74 | 5,511 |
| Hct116 r3.1 ⚠ training overlap? | Hct116 | 155,658 | 6,010 | 4,347 | 38 | 3.42 | 5,324 |
| Hct116 r3.4 | Hct116 | 135,870 | 6,202 | 4,221 | 38 | 3.49 | 4,743 |
| Hct116 r4.3 | Hct116 | 238,748 | 8,908 | 5,919 | 40 | 4.26 | 10,164 |
| HepG2 r5.2 | HepG2 | 259,535 | 9,213 | 6,197 | 41 | 2.81 | 7,293 |
| HepG2 r6.1 | HepG2 | 247,181 | 8,252 | 5,761 | 40 | 3.25 | 8,023 |
| K562 r4.1 | K562 | 86,510 | 4,875 | 3,289 | 37 | 2.90 | 2,505 |
| K562 r5.1 | K562 | 79,077 | 4,511 | 3,060 | 37 | 2.89 | 2,283 |
| K562 r6.1 | K562 | 100,379 | 6,050 | 3,717 | 38 | 3.20 | 3,212 |
| MCF7 r3.1 ⚠ v1 fallback | MCF7 | 109,315 | 7,513 | 4,749 | 37 | 2.66 | 2,908 |
| MCF7 r4.1 | MCF7 | 143,048 | 6,307 | 4,409 | 37 | 3.20 | 4,582 |

*r5.1 = replicate 5, run 1.*
