# Team guide (internal)

Notes for team **Dolly** members working on the repo. Visitors and evaluators do not need this page: see the main
[README](../README.md) and [HOW_TO_RUN.md](HOW_TO_RUN.md).

1. [Setup on the team AWS machine](#1-setup-on-the-team-aws-machine)
2. [What is not in git](#2-what-is-not-in-git)
3. [How we work together (Git)](#3-how-we-work-together-git)
4. [Deliverables, deadlines and to-do](#4-deliverables-deadlines-and-to-do)
5. [Evaluation rules for new experiments](#5-evaluation-rules-for-new-experiments)

---

## 1. Setup on the team AWS machine

### 1.1 Log in to the team AWS machine
Follow **[connect_to_server.md](connect_to_server.md)**. It covers the shared `.pem` key on Windows and
macOS, VS Code Remote-SSH, uploading data, and the rules for sharing one machine.

### 1.2 Clone the repo into your own folder on the server
Everyone logs in as the same `ubuntu` user, so each person works in a separate folder:

```bash
mkdir -p ~/<yourname> && cd ~/<yourname>
git clone https://github.com/umarmadbi/dsa4262-teamproject-dolly.git
cd dsa4262-teamproject-dolly

# set your identity for THIS repo only (no --global, the machine is shared)
git config user.name  "Your Name"
git config user.email "you@example.com"
```

### 1.3 Link the shared data
The datasets live once on the server in `~/data/`. Link them into your clone instead of copying:

```bash
for d in data0 data1 data2; do ln -s ~/data/$d data/$d; done
ls data/data0      # should show data.info.labelled and dataset0.json.gz
```

On your own laptop, copy the `data0`, `data1` and `data2` folders into `data/` instead. See
[data/README.md](../data/README.md) for the expected layout and file formats.

### 1.4 Create the Python environment
```bash
sudo apt update && sudo apt install -y python3-venv python3-pip   # once per machine
bash setup/setup_env.sh                                           # once per clone
source .venv/bin/activate                                         # every session
```
In Jupyter / VS Code choose the kernel **"Python (DSA4262)"**. There is no plain `python` on the server; inside the
activated venv `python` works, otherwise call `.venv/bin/python`.

Running m6Anet itself (experiments 07-08 and the SG-NEx comparison) needs Python 3.8 in a separate conda env:
```bash
conda env create -f setup/environment_m6anet.yml && conda activate m6anet
```

### 1.5 Run the EDA (optional)
Open `notebooks/01_EDA.ipynb` and run all cells. The first run parses the json files (~7-10 min) and caches them in
`notebooks/cache/`; later runs take seconds.

---

## 2. What is not in git

`.gitignore` blocks data, `results/*`, `models/*`, `cache/` and `*.json`. So when you
clone you get code, docs, the two trained models and small result tables, but **not**:

| Missing | Where it is | How to get it |
|---|---|---|
| Course datasets `data0-2` | `~/data/` on the server | [Section 1.3](#13-link-the-shared-data) |
| SG-NEx inputs `data/sgnex/` | `~/hamzah/dsa4262-teamproject-dolly/data/sgnex/` on the server | SG-NEx open data on AWS: [tutorial](https://github.com/GoekeLab/sg-nex-data/blob/master/docs/AWS_data_access_tutorial.md) |
| SG-NEx predictions (`results/sgnex_v2/`, 1.2 GB; `results/sgnex_m6anet/`, 9.9 GB) | `~/hamzah/dsa4262-teamproject-dolly/results/` | Re-run (hours) or read them there |
| Feature caches (`cache/`) | per clone | `scripts/build_features.py` |
| Ensembl 91 GTF / fasta | `cache/annotation/` per clone | Ensembl FTP, see `scripts/build_annotation.py` |

To commit a new result table or model on purpose: `git add -f results/<file>` and list it in
[results/README.md](../results/README.md).

---

## 3. How we work together (Git)

1. **Always start with** `git checkout main && git pull`.
2. **Make a branch for your task:** `git checkout -b feature/<short-name>` (e.g. `feature/xgboost`).
3. Commit small, clear steps: `git add <files>` -> `git commit -m "Add per-5-mer normalisation"`.
4. `git push -u origin feature/<short-name>` and open a **Pull Request** on GitHub. Another team member reviews and
   merges it.
5. Never push data, `.pem` keys or tokens. `.gitignore` already blocks the common ones.

**Notebooks:** one notebook per person/experiment (`notebooks/02_<name>_<topic>.ipynb`). Notebooks merge badly, so
once code works, move it into `src/m6a/` so everyone uses the same parser, features and evaluation.

**Shared server:** everyone is the `ubuntu` user, so never use `git config --global` and never leave credentials in
shared files.

---

## 4. Deliverables, deadlines and to-do

| Item | Due |
|---|---|
| Intermediate leaderboard | 7 Oct, 23:59 (done) |
| Final leaderboard (8 files, `dolly_dataset0.csv` ... `dolly_dataset7.csv`) + repo link on Zulip | 28 Oct, 23:59 |
| Report (`dolly_report.pdf`, 5 pages, Arial 11) and interactive visualisation | 8 Nov, 23:59 |
| Individual teamwork summary | 9 Nov, 23:59 |
| Student evaluation of another team's repo | 15 Nov, 23:59 |

- [x] `train.py`: train a model from `data.json` + `data.info`
- [x] `predict.py`: output `transcript_id,transcript_position,score` for new `data.json`
- [x] Benchmark vs random and simple baseline (ROC + PR curves, bootstrap CIs)
- [x] Benchmark vs m6Anet: our model beats pretrained m6Anet on both test sets
- [x] v2 model with transcript-structure features
- [x] Intermediate leaderboard submitted
- [x] Decide the final model: v2 (default of `train.py` / `predict.py`)
- [x] Step-by-step run guide for evaluators ([HOW_TO_RUN.md](HOW_TO_RUN.md))
- [ ] Final leaderboard predictions for dataset0-7
- [ ] Report
- [x] Make the repo public
- [ ] Test [HOW_TO_RUN.md](HOW_TO_RUN.md) on a fresh AWS Ubuntu machine

**Budget:** the team shares one AWS budget, which must also cover the peer evaluation. **Stop the machine in Ronin
when you finish a session.** Overspending costs 5% of the project grade.

---

## 5. Evaluation rules for new experiments

Every experiment follows the evaluation design in [model_development.md](model_development.md#evaluation-design-fixed-before-any-modelling)
(gene-grouped splits, the frozen test genes in `results/test_genes_d0.csv`, PR AUC and ROC AUC with gene-level
bootstrap CIs) and handles the pitfalls in [eda_findings.md](eda_findings.md). Use the shared helpers:

```python
import sys; sys.path.insert(0, "src")
from m6a.evaluation import gene_split, score
train_idx, test_idx = gene_split(df, test_size=0.2, seed=42)
print(score(y_test, p_test))   # {'roc_auc': ..., 'pr_auc': ..., 'pr_baseline': ...}
```
