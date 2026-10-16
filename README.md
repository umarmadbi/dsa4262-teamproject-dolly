# Predicting m6A RNA modifications from direct RNA-Seq data

DSA4262 Team Project (2026), team **Dolly**.

We build a machine learning model that predicts, for each candidate site in a transcript, the probability that it carries an m6A modification. The input is nanopore direct RNA-Seq signal processed by m6Anet (`data.json`); the labels come from m6ACE-Seq (`data.info`). Performance is measured with **ROC AUC and PR AUC**, and compared against a simple baseline and m6Anet.

- **Task 1:** a training script and a prediction script (output: `transcript_id, transcript_position, score`).
- **Task 2:** predict m6A across all SG-NEx direct RNA-Seq samples, compare cell lines, and build an interactive visualisation.

**New here?** Read [docs/branch_guide.md](docs/branch_guide.md) first: it maps the model, the m6Anet benchmark, the
SG-NEx analysis ([docs/sgnex_task2.md](docs/sgnex_task2.md)) and the visualisation (branch `viz-github-pages`).

---

## Repository layout

```
.
├── README.md                 <- you are here
├── requirements.txt          <- Python packages for the main environment
├── environment_m6anet.yml    <- separate conda env for the m6Anet benchmark (Python 3.8)
├── setup_env.sh              <- creates .venv on Linux / macOS / AWS Ubuntu
├── setup_env.bat             <- same, for Windows
├── data/
│   ├── README.md             <- where to put the datasets (not committed)
│   └── sample/               <- small test set for the README demo (committed)
├── docs/
│   ├── connect_to_server.md  <- how to log in to our AWS machine and work on it
│   ├── eda_findings.md       <- what the EDA found and the pitfalls we must handle
│   ├── ai_use_log.md         <- running log of AI use (required for the report)
│   └── figures/
├── notebooks/
│   └── 01_EDA.ipynb          <- exploratory data analysis
├── src/m6a/                  <- shared code (import this, don't copy-paste it)
│   ├── io.py                 <- streaming json parser + label loading
│   ├── features.py           <- read-distribution features, k-mer centring, neighbour context
│   ├── annotation.py         <- transcript-structure features from Ensembl 91 (v2 model)
│   ├── models.py             <- baselines, candidate models, final ReadStackModel
│   ├── pipeline.py           <- loading helpers shared by train.py / predict.py
│   └── evaluation.py         <- gene-grouped splits, ROC/PR AUC, gene-level bootstrap CIs
├── viz/                      <- TASK 2: interactive visualisation (published to GitHub Pages, see viz/README.md)
├── scripts/
│   ├── train.py              <- TASK 1: train a model from data.json + labels
│   ├── predict.py            <- TASK 1: score a data.json -> transcript_id,transcript_position,score
│   ├── build_features.py     <- cache a dataset's features for experiments
│   ├── build_viz_data.py     <- TASK 2: SG-NEx predictions -> viz/site/data
│   ├── build_annotation.py   <- Ensembl GTF -> resources/ensembl91_transcripts.csv.gz
│   └── parse_to_parquet.py   <- turn a data.json.gz into a simple site-level table (EDA)
├── experiments/              <- 01-06: model comparison and final evaluation; 07-08: m6Anet benchmark;
│                                09-11: v2 improvements (see docs/model_development.md);
│                                12: SG-NEx comparison with m6Anet (see docs/sgnex_task2.md)
├── resources/                <- per-transcript Ensembl 91 annotation used by the v2 model (committed)
├── models/m6a_model.joblib   <- the trained final model, v1 (2.5 MB)
├── models/m6a_model_v2.joblib <- v2: + transcript-structure features (see below)
└── results/                  <- metrics (csv), logs, predictions from experiments
```

---

## Getting started

### 1. Log in to the team AWS machine
Follow **[docs/connect_to_server.md](docs/connect_to_server.md)**. It covers the shared `.pem` key on Windows and macOS, VS Code Remote-SSH, uploading data, and the rules for sharing one machine.

### 2. Clone the repo into your own folder on the server
Everyone logs in as the same `ubuntu` user, so each person works in a separate folder:

```bash
mkdir -p ~/<yourname> && cd ~/<yourname>
git clone https://github.com/umarmadbi/dsa4262-teamproject-dolly.git
cd dsa4262-teamproject-dolly

# set your identity for THIS repo only (no --global, the machine is shared)
git config user.name  "Your Name"
git config user.email "you@example.com"
```

### 3. Link the shared data
The datasets live once on the server in `~/data/`. Link them into your clone instead of copying:

```bash
for d in data0 data1 data2; do ln -s ~/data/$d data/$d; done
ls data/data0      # should show data.info.labelled and dataset0.json.gz
```

On your own laptop, copy the `data0`, `data1` and `data2` folders into `data/` instead. See [data/README.md](data/README.md).

### 4. Create the Python environment
```bash
sudo apt update && sudo apt install -y python3-venv python3-pip   # once per machine
bash setup_env.sh                                                 # once per clone
source .venv/bin/activate                                         # every session
```
In Jupyter / VS Code choose the kernel **"Python (DSA4262)"**.

The m6Anet benchmark needs Python 3.8 and is installed separately with conda:
```bash
conda env create -f environment_m6anet.yml && conda activate m6anet
```

### 5. Run the EDA
Open `notebooks/01_EDA.ipynb` and run all cells. The first run parses the json files (~7–10 min) and caches them in `notebooks/cache/`; later runs take seconds.

---

## Train and predict (Task 1)

```bash
source .venv/bin/activate

# predict with the trained model shipped in models/ (small test set included)
python scripts/predict.py --json data/sample/sample.json.gz --out results/sample_predictions.csv

# retrain from scratch (~10 min on 2 cores, ~2 GB RAM)
python scripts/train.py --data data/data0/dataset0.json.gz data/data0/data.info.labelled \
                        --out models/m6a_model.joblib
```

**v2 model** (Hamzah, 12 Oct; not yet the team default): adds Ensembl transcript-structure features (distance to
the stop codon and exon junctions, region, exon length, ...) and averages three seeds. Held-out PR AUC 0.56 vs 0.52
(dataset0) and 0.43 vs 0.40 (dataset1). Predict with `--model models/m6a_model_v2.joblib`; train it with `train.py --v2 ... --out models/m6a_model_v2.joblib`
(~40 min). Details: [docs/model_development.md](docs/model_development.md).

`predict.py` writes `transcript_id,transcript_position,score` (score = probability of m6A, 0-1) for
every site in the json. Give it one sequencing run per call: neighbouring sites in the same transcript
are used as context. `--jobs N` sets the CPU cores. `train.py` accepts `--data JSON LABELS` several
times to train on more than one run.

### The model in one paragraph
A read-level LightGBM scores individual reads (the multiple-instance idea behind m6Anet); the read scores
are pooled per site (quantiles, max, share of high-scoring reads, using at most 20 reads so depth does not
matter). A final LightGBM combines these with read-distribution summaries of the signal (quantiles of
current, SD and dwell time at -1/0/+1, centred on each 5-mer's typical level), the 7-mer sequence and the
scores of neighbouring candidate sites within 25/100 nt (m6A sites cluster). Details and every comparison:
**[docs/model_development.md](docs/model_development.md)**.

### Results (held-out data, never used for model choices)

| Model | dataset0 held-out genes ROC / PR | dataset1 unseen transcripts ROC / PR |
|---|---|---|
| Random | 0.52 / 0.048 | 0.50 / 0.083 |
| 5-mer prior (simple baseline) | 0.80 / 0.14 | 0.72 / 0.16 |
| LightGBM on site features | 0.92 / 0.48 | 0.83 / 0.36 |
| **Final model** | **0.93 / 0.52** | **0.86 / 0.40** |

![evaluation](docs/figures/model_evaluation.png)

---

## How we work together (Git)

1. **Always start with** `git checkout main && git pull`.
2. **Make a branch for your task:** `git checkout -b feature/<short-name>` (e.g. `feature/xgboost`, `feature/read-quantiles`).
3. Commit small, clear steps: `git add <files>` → `git commit -m "Add per-5-mer normalisation"`.
4. `git push -u origin feature/<short-name>` and open a **Pull Request** on GitHub. Another team member reviews and merges it.
5. Never push data, `.pem` keys, or large model files. `.gitignore` already blocks the common ones.

**Notebooks:** keep one notebook per person/experiment (`notebooks/02_umar_baselines.ipynb`). Notebooks merge badly, so once code works, move it into `src/m6a/` so everyone uses the same parser, features and evaluation.

**Comparability:** all experiments use `m6a.evaluation.gene_split` (split by `gene_id`, fixed seed) and `m6a.evaluation.score` (ROC AUC + PR AUC). Results are only comparable if everyone uses the same split.

```python
import sys; sys.path.insert(0, "../src")
from m6a.evaluation import gene_split, score
train_idx, test_idx = gene_split(df, test_size=0.2, seed=42)
print(score(y_test, p_test))   # {'roc_auc': ..., 'pr_auc': ..., 'pr_baseline': ...}
```

---

## Key findings so far

See **[docs/eda_findings.md](docs/eda_findings.md)**. Short version:

| Pitfall | What we do about it |
|---|---|
| Only 4.5% of sites are positive | Report PR AUC (random ≈ 0.045) + ROC AUC; class weights; never accuracy |
| Positives cluster within genes | Split and cross-validate **by `gene_id`**; a random split inflates PR AUC 0.41 → 0.48 |
| Current depends on the 5-mer (Simpson's paradox) | Normalise per k-mer or give the model the k-mer |
| Batch shift between datasets | Validate across datasets (train data0 → test unseen data1 transcripts) |
| Partial modification blurs averages | Use read-distribution features (quantiles, fraction of low-current reads) |
| Outlier reads | Medians/quantiles or clipping |

Baseline to beat (gene split, data0): **5-mer only: ROC 0.81 / PR 0.15**. The final model reaches **ROC 0.93 / PR 0.52** on held-out genes (see above).

---

## Deliverables and deadlines

| Item | Due |
|---|---|
| Intermediate leaderboard | 7 Oct, 23:59 |
| Final leaderboard, report, code, visualisation | 28 Oct, 23:59 |
| Individual teamwork summary | 29 Oct, 23:59 |

To do before submission:
- [x] `train.py`: train a model from `data.json` + `data.info`
- [x] `predict.py`: output `transcript_id,transcript_position,score` for new `data.json`
- [x] Benchmark vs random and simple baseline (ROC + PR curves, bootstrap CIs)
- [x] Benchmark vs m6Anet (run in the Python 3.8 env on AWS): final model beats pretrained m6Anet on both test sets
- [ ] Intermediate leaderboard: run `predict.py` on the released json (due 7 Oct, 23:59)
- [ ] Task 2: predictions on all SG-NEx samples + comparison across cell lines
- [ ] Interactive visualisation
- [ ] Make the repo **public** and test the README instructions on a fresh Ubuntu machine

## Budget reminder
The team shares one AWS budget, which must also cover the peer evaluation. **Stop the machine in Ronin when you finish a session.** Overspending costs 5% of the project grade.
