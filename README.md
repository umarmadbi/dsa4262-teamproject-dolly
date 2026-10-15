# Predicting m6A RNA modifications from direct RNA-Seq data

DSA4262 Team Project (2026), team **Dolly**.

We build a machine learning model that predicts, for each candidate site in a transcript, the probability that it carries an m6A modification. The input is nanopore direct RNA-Seq signal processed by m6Anet (`data.json`); the labels come from m6ACE-Seq (`data.info`). Performance is measured with **ROC AUC and PR AUC**, and compared against a simple baseline and m6Anet.

- **Task 1:** a training script and a prediction script (output: `transcript_id, transcript_position, score`).
- **Task 2:** predict m6A across all SG-NEx direct RNA-Seq samples, compare cell lines, and build an interactive visualisation.

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
│   └── evaluation.py         <- gene-grouped splits and ROC/PR AUC scoring
├── viz/                      <- TASK 2: interactive visualisation (published to GitHub Pages, see viz/README.md)
├── scripts/
│   ├── parse_to_parquet.py   <- turn a data.json.gz into a site-level table
│   └── build_viz_data.py     <- TASK 2: SG-NEx predictions -> viz/site/data
├── models/                   <- trained models (only the final one is committed)
└── results/                  <- predictions, metrics, figures from experiments
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

Baseline to beat (gene split, data0): **5-mer only: ROC 0.81 / PR 0.15**; site summary features + gradient boosting: **ROC 0.90 / PR 0.41**.

---

## Deliverables and deadlines

| Item | Due |
|---|---|
| Intermediate leaderboard | 7 Oct, 23:59 |
| Final leaderboard, report, code, visualisation | 28 Oct, 23:59 |
| Individual teamwork summary | 29 Oct, 23:59 |

To do before submission:
- [ ] `train.py`: train a model from `data.json` + `data.info`
- [ ] `predict.py`: output `transcript_id,transcript_position,score` for new `data.json`
- [ ] Benchmark vs simple baseline and m6Anet (ROC + PR curves)
- [ ] Task 2: predictions on all SG-NEx samples + comparison across cell lines
- [ ] Interactive visualisation
- [ ] Make the repo **public** and test the README instructions on a fresh Ubuntu machine

## Budget reminder
The team shares one AWS budget, which must also cover the peer evaluation. **Stop the machine in Ronin when you finish a session.** Overspending costs 5% of the project grade.
