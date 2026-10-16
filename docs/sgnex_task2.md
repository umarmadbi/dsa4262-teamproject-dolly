# Task 2: Dolly v2 vs m6Anet on SG-NEx direct RNA-seq (16 Oct 2026)

Script: `experiments/12_sgnex_m6anet_compare.py`. Covers 23 SG-NEx direct RNA-seq runs from 7 cell lines
(A549, H9, HEYA8, Hct116, HepG2, K562, MCF7), 2,973,155 site observations scored by both methods.

**There is no ground truth for SG-NEx**, so this measures how much the two methods agree and whether their calls look
biologically plausible. It does not say which one is more accurate; that comparison is on the labelled data in
[model_development.md](model_development.md).

## Inputs and how to run

| Input | Produced by |
|---|---|
| `results/sgnex_v2/<run>.csv` (`transcript_id,transcript_position,score`) | `scripts/predict.py --model models/m6a_model_v2.joblib` on each run's `data.json` |
| `results/sgnex_m6anet/<cell>_rep<r>_run<n>/data.site_proba.csv` | `m6anet inference` (pretrained `HCT116_RNA002`) in the Python 3.8 env |

```bash
cd experiments
../.venv/bin/python 12_sgnex_m6anet_compare.py            # all runs
../.venv/bin/python 12_sgnex_m6anet_compare.py --partial  # only runs that already have m6Anet results
```

Sites are the ones m6Anet scores (at least 20 reads), so both methods see exactly the same sites. SIRV/ERCC spike-ins
are dropped. A call is Dolly >= 0.5 or m6Anet >= 0.9; these thresholds call a similar share of sites on held-out
Hct116 genes (2.9% vs 3.0%, `results/threshold_recall_v2_vs_m6anet.csv`).

Outputs: `results/sgnex_compare_{runs,regions,motifs,pairs}.csv` and `docs/figures/sgnex_m6anet_comparison.png`.
The CSVs are git-ignored and live on the server.

## Findings

**1. The methods agree moderately, per run.** Median Spearman correlation of scores 0.637; median Jaccard overlap of
calls 0.489; median overlap of the top-K sites (equal K) 0.655. Call rates are 1.8-4.3% for both. MCF7 replicate 3
is the outlier (Spearman 0.784).

**2. Calls sit where m6A should.** Compared with all sites (3'UTR 40%, CDS 52%, near stop codon 22%):

| Set | 5'UTR | CDS | 3'UTR | within 200 nt of stop codon |
|---|---|---|---|---|
| all sites | 2.4% | 51.6% | 40.5% | 21.7% |
| Dolly v2 calls | 2.1% | 38.8% | 51.9% | 44.2% |
| m6Anet calls | 1.5% | 29.0% | 64.2% | 41.9% |
| both | 1.8% | 33.6% | 58.6% | 44.5% |

Both are enriched for the known DRACH motif, mostly GGACT (6.6x for Dolly, 7.4x for m6Anet over its share of all
sites), and depleted for AAACT and AGACA (about 0.3-0.4x). Dolly v2 uses transcript position as an input feature,
so its stop-codon enrichment is partly by construction; the motif enrichment is not.

**3. Call rate depends on read depth.** Across runs, the share of sites called correlates with log10(number of
scored sites): r = 0.76 for Dolly, 0.85 for m6Anet. Comparing cell lines by raw call rate is therefore confounded by
depth; use the same depth filter or compare sites shared between runs.

**4. Dolly's scores are slightly more reproducible between runs.** Median over run pairs:

| Pairs | Spearman Dolly | Spearman m6Anet | Jaccard of calls Dolly | Jaccard of calls m6Anet |
|---|---|---|---|---|
| same cell line | 0.936 | 0.911 | 0.674 | 0.696 |
| different cell lines | 0.931 | 0.907 | 0.642 | 0.647 |

Same-cell-line pairs agree only a little more than different-cell-line pairs, so most of the signal is a property
of the site (sequence, position, coverage), not of the cell line. Cell-line differences are small relative to run
noise, and runs are technical, not independent biological replicates.

## Caveats

- Agreement is not accuracy. Two methods can agree on a shared bias, e.g. both favour sites with more reads.
- m6Anet's pretrained model was trained on SG-NEx HCT116, so Hct116 runs may favour m6Anet.
- Thresholds (0.5 / 0.9) were chosen to give similar call rates on labelled data, not tuned on SG-NEx.

## Feeding the dashboard

The dashboard uses Dolly v2 scores only, not the m6Anet comparison. `scripts/build_viz_data.py` converts
`results/sgnex_v2/*.csv` into `viz/site/data/`. See [viz/README.md](../viz/README.md) and section 7 of the main README.
