# Guide to Hamzah's work: model, m6Anet benchmark, SG-NEx analysis, visualisation

This page explains what lives on two branches, how they fit together, and how to run or reproduce each part.
Last updated 16 Oct 2026.

| Branch | What it holds | Status |
|---|---|---|
| `hamzah-workinprogress` | Task 1 model (v1 and v2), all experiments, the m6Anet benchmark, the SG-NEx comparison | Pushed, not yet merged into `main` |
| `viz-github-pages` | Task 2 interactive dashboard (`viz/`), GitHub Pages workflow, `build_viz_data.py` | One commit ahead of its remote, not merged into `main` |

`viz-github-pages` is checked out as a separate git worktree (`~/hamzah/dolly-viz`) so both branches can be open
at once. Nothing on either branch is on `main` yet, so merging them is the next step (see "Merge order" at the end).

---

## 1. Task 1: the model (`hamzah-workinprogress`)

Full write-up with every table: **[model_development.md](model_development.md)**. Summary:

| Model | Held-out genes (dataset0) ROC / PR | Unseen transcripts (dataset1) ROC / PR |
|---|---|---|
| 5-mer prior (baseline) | 0.80 / 0.14 | 0.72 / 0.16 |
| Pretrained m6Anet | 0.93 / 0.49 | 0.83 / 0.35 |
| v1 (`models/m6a_model.joblib`) | 0.93 / 0.52 | 0.86 / 0.40 |
| **v2 (`models/m6a_model_v2.joblib`)** | **0.95 / 0.56** | **0.88 / 0.43** |

- **v1** = read-level LightGBM pooled per site + neighbour-site context + site-level LightGBM.
- **v2** = v1 + 16 transcript-structure features from Ensembl 91 (distance to stop codon / exon junctions, region,
  exon length, ...), averaged over three seeds. Transcripts missing from Ensembl (e.g. the synthetic dataset2) fall
  back to a v1-style model inside the same file.
- v2 is **not yet the team default**: `scripts/train.py` and `scripts/predict.py` still default to v1.
  Use `--model models/m6a_model_v2.joblib` to predict with v2.

### Where the code is

| Path | Role |
|---|---|
| `src/m6a/features.py`, `models.py`, `annotation.py`, `pipeline.py`, `evaluation.py` | Shared library: features, models, Ensembl features, loading, gene-grouped splits and bootstrap CIs |
| `scripts/train.py`, `scripts/predict.py` | The Task 1 deliverables |
| `scripts/build_features.py`, `scripts/build_annotation.py` | Cache features for experiments; build `resources/ensembl91_transcripts.csv.gz` |
| `experiments/01`-`06` | Model comparison, design checks, final v1 evaluation, figures |
| `experiments/07`-`08` | m6Anet benchmark (needs the separate Python 3.8 conda env) |
| `experiments/09`-`11` | v2: annotation check, candidate improvements by CV, final v2 evaluation |
| `experiments/12_sgnex_m6anet_compare.py` | Task 2 analysis, see [sgnex_task2.md](sgnex_task2.md) |
| `experiments/common.py` | Paths shared by the experiments (`ROOT`, `RESULTS`, ...) |

Run experiments from the repo root with the project venv (`.venv/bin/python`); a bare `python` is not on the PATH
on the shared server.

### Evaluation rules that everything follows

- Splits and CV folds are **by `gene_id`** (positives cluster within genes).
- 20% of dataset0 genes (`results/test_genes_d0.csv`) is a frozen test set used once at the end; all model choices
  came from CV on the other 80%.
- Metrics are PR AUC (primary; random = positive rate, about 0.045) and ROC AUC, with gene-level bootstrap CIs.

---

## 2. Task 2: SG-NEx predictions and cell-line comparison

Full description: **[sgnex_task2.md](sgnex_task2.md)**. In short:

1. Score each of the 23 SG-NEx direct RNA-seq runs with v2:
   `python scripts/predict.py --json data/sgnex/<run>/data.json --model models/m6a_model_v2.joblib --out results/sgnex_v2/<run>.csv`
2. Run pretrained m6Anet on the same runs (output in `results/sgnex_m6anet/<cell>_rep<r>_run<n>/`).
3. `experiments/12_sgnex_m6anet_compare.py` compares the two methods (agreement, region and motif enrichment,
   depth dependence, reproducibility across runs).
4. `scripts/build_viz_data.py` (on `viz-github-pages`) turns the v2 predictions into the dashboard's data files.

---

## 3. The visualisation (`viz-github-pages`)

Plain HTML/JS dashboard, no build step. Its own README: [`viz/README.md`](../viz/README.md) on that branch.

```bash
git checkout viz-github-pages            # or use the worktree at ~/hamzah/dolly-viz
python3 -m http.server 8000 --directory viz/site
```

Open http://localhost:8000 (must be served over HTTP). On the AWS machine, forward the port first:
`ssh -L 8000:localhost:8000 ubuntu@<server>`. Tests: `node viz/tests/core.test.mjs`.

What it shows: per-run score histograms, call rates and read depth; a Site explorer to look up a gene or transcript;
Compare samples for shared sites between two runs or cell lines (cell-line summaries average runs of the same line).
The 23 SG-NEx runs, three development datasets and `cell_lines.json` are loaded on demand from `viz/site/data/`.

**Publishing.** `.github/workflows/pages.yml` runs the tests and deploys `viz/site` to GitHub Pages on every push to
`main` that touches `viz/`; pull requests run the tests only. Pages must be enabled once under Settings -> Pages ->
Source: "GitHub Actions". Until the branch is merged, nothing is published.

**Refreshing the data** after re-scoring runs: see "Add or refresh SG-NEx predictions" in `viz/README.md`.

---

## 4. What is NOT in git (you will not get it by cloning)

`.gitignore` excludes `results/*` (except `.gitkeep`), `models/*`, `cache/` and large data, so:

- `results/sgnex_v2/` (1.2 GB of per-run predictions), `results/sgnex_m6anet/` (9.9 GB) and the
  `results/sgnex_compare_*.csv` tables exist only on the AWS machine under `~/hamzah/`.
- Many of the other `results/*.csv` and `models/*.joblib` files on `hamzah-workinprogress` were added with `git add -f`;
  this is intentional for the final models and result tables.
- `data/sgnex/` (SG-NEx `data.json` etc.) and `data/data0-2` are linked from the server, not committed.

To read the SG-NEx results without re-running, look in `~/hamzah/dsa4262-teamproject-dolly/results/` on the server.
To regenerate them you need the SG-NEx m6Anet `dataprep` output and a few hours of compute.

---

## 5. Open items and caveats

- v2 has not been agreed as the team model yet.
- Per-run call rates track sequencing depth for both methods (r = 0.76 Dolly, 0.85 m6Anet), so comparing cell lines
  by raw call rate is confounded by depth. The dashboard states this.
- SG-NEx has no ground-truth labels: experiment 12 measures agreement and plausibility, not accuracy.
- Sequencing runs are not independent biological replicates.
- Still to do from the README checklist: intermediate/final leaderboard predictions, report, making the repo public,
  and testing the README instructions on a fresh machine.

## 6. Merge order (suggested)

1. Open a PR `hamzah-workinprogress` -> `main` (model, experiments, docs). Review `models/` additions (16 MB v2 file).
2. Then a PR `viz-github-pages` -> `main`. Merging it triggers the Pages deployment.
3. After merging, rebuild the viz data if the default model changes: the manifest labels each dataset with a hash of
   the model file so scores from different models are never silently mixed.
