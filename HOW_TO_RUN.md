# How to run: install, predict, train and visualise

Step-by-step instructions for running team **Dolly**'s m6A prediction method from a clean machine. They are written
for the peer evaluation (a fresh **AWS Ubuntu** instance), but work the same on any Linux or macOS machine; Windows
notes are at the end of each step where they differ.

| Part | What you do | Time | Needed for the evaluation? |
|---|---|---|---|
| [1. Install](#1-install) | Clone the repo, create the Python environment | ~5 min | **Yes** |
| [2. Predict on the test data](#2-predict-m6a-on-the-included-test-data) | Run `scripts/predict.py` on the small test set in the repo | < 1 min | **Yes** |
| [3. Check the output](#3-check-the-output-format) | Confirm the CSV has the required format | 1 min | **Yes** |
| [4. Predict on a full SG-NEx run](#4-optional-predict-on-a-full-sg-nex-run) | Download one SG-NEx run from AWS S3 and score it | 10-30 min | Optional |
| [5. Train a model](#5-optional-train-a-model) | Run `scripts/train.py` | 10 s (test data) to 40 min | Optional (not evaluated) |
| [6. Reproduce the evaluation results](#6-optional-reproduce-the-evaluation-results) | Re-run the experiments behind the report | hours | Optional |
| [7. Open the interactive visualisation](#7-open-the-interactive-visualisation) | Serve `viz/site` and open it in a browser | 2 min | For the report / Task 2 |
| [8. Troubleshooting](#8-troubleshooting) | Common errors and fixes | | |

**The model.** The method is called **Dolly**; the final model is **v2** (`models/m6a_model_v2.joblib`, 16 MB,
included in the repo), and both scripts use it by default. It scores each candidate DRACH site in an m6Anet
`dataprep` `data.json` with the probability that it carries m6A. How it works and how it was evaluated:
[README.md](README.md#5-task-1-train-and-predict) and [docs/model_development.md](docs/model_development.md).

---

## 0. What you need

- **A machine:** an AWS Ubuntu instance (Ubuntu 22.04 or 24.04). 2 vCPUs and 4 GB RAM are enough for the test
  data; for a full SG-NEx run we recommend at least 8 GB RAM. About 3 GB of free disk for the code and Python
  packages, plus the size of any SG-NEx `data.json` you download.
- **Python 3.10, 3.11 or 3.12** (Ubuntu 22.04 ships 3.10, Ubuntu 24.04 ships 3.12). No GPU, no conda.
- **Internet access** to GitHub and PyPI (and to AWS S3 for step 4).

All commands below are typed in a terminal on that machine. Lines starting with `#` are comments.

---

## 1. Install

### 1.1 Install system packages (once per machine)

```bash
sudo apt update
sudo apt install -y git python3-venv python3-pip
```

Check Python: `python3 --version` should print 3.10, 3.11 or 3.12.

### 1.2 Get the code

```bash
cd ~
git clone https://github.com/umarmadbi/dsa4262-teamproject-dolly.git
cd dsa4262-teamproject-dolly
```

You are now in the **repo root**. Run every command in this guide from here. The download is ~100 MB (it includes
the trained models, the test data and the visualisation data).

### 1.3 Create the Python environment

```bash
bash setup_env.sh
```

This creates a virtual environment in `.venv/` and installs the packages in `requirements.txt` (numpy, pandas,
scikit-learn, LightGBM, XGBoost, joblib, ... plus Jupyter for the notebooks). It takes about 3-5 minutes and ends
with `Done. Activate later with: source .venv/bin/activate`.

### 1.4 Activate the environment

```bash
source .venv/bin/activate
```

Your prompt now starts with `(.venv)`. **Do this again every time you open a new terminal.** Check that it works:

```bash
python -c "import lightgbm, sklearn, pandas; print('environment OK')"
```

> **Windows (for running on a laptop instead of AWS):** install Python 3.10-3.12 from python.org (tick "Add
> python.exe to PATH"), then in the repo folder run `setup_env.bat` and activate with `.venv\Scripts\activate`.
> In the commands below use `python` and write paths with either `/` or `\`.

---

## 2. Predict m6A on the included test data

The repo contains a small test set, `data/sample/sample.json.gz`: 500 candidate sites (the first 500 sites of the
course training data, in the same m6Anet `data.json` format, gzip-compressed). Score it:

```bash
python scripts/predict.py --json data/sample/sample.json.gz --out results/my_sample_predictions.csv
```

Expected console output (the time varies):

```
500 sites scored in 4s -> results/my_sample_predictions.csv
```

### All options of `predict.py`

| Option | Required | Meaning |
|---|---|---|
| `--json PATH` | yes | Input `data.json` from m6Anet `dataprep`. Plain `.json` or gzip-compressed `.json.gz` both work. |
| `--out PATH` | yes | Output CSV. Its folder is created if needed. |
| `--model PATH` | no | Trained model. Default `models/m6a_model_v2.joblib` (v2, final). The earlier v1 is `models/m6a_model.joblib`. |
| `--jobs N` | no | CPU cores to use (default 2). Use `--jobs 1` on a machine with little memory. |

Notes:

- Give the script **one sequencing run per call**: neighbouring sites in the same transcript are used as context.
- `python scripts/predict.py --help` prints the same information.

---

## 3. Check the output format

The output must be a comma-separated file with the header `transcript_id,transcript_position,score`, one row per
site in the input, and a score between 0 and 1:

```bash
head -5 results/my_sample_predictions.csv
wc -l results/my_sample_predictions.csv      # 501 = header + 500 sites
```

Expected:

```
transcript_id,transcript_position,score
ENST00000000233,244,0.0006933723387158056
ENST00000000233,261,0.0007799455941661969
ENST00000000233,316,0.0006298070233304436
ENST00000000233,332,0.0015385573865302458
```

(The last digits can differ slightly with other package versions.) The same file is committed as
`results/sample_predictions.csv`, so you can compare: `diff results/sample_predictions.csv results/my_sample_predictions.csv`.

A full automatic check (columns, row count, score range, duplicates, sites match the input):

```bash
python - <<'EOF'
import gzip, json
import pandas as pd
pred = pd.read_csv("results/my_sample_predictions.csv")
assert list(pred.columns) == ["transcript_id", "transcript_position", "score"], pred.columns
sites = set()
with gzip.open("data/sample/sample.json.gz", "rt") as f:
    for line in f:
        for tx, positions in json.loads(line).items():
            sites.update((tx, int(pos)) for pos in positions)
got = set(zip(pred.transcript_id, pred.transcript_position))
assert got == sites, "sites differ from the input"
assert pred.score.between(0, 1).all(), "score outside [0, 1]"
assert not pred.duplicated(["transcript_id", "transcript_position"]).any(), "duplicate sites"
print(f"OK: {len(pred)} sites, scores {pred.score.min():.4f}-{pred.score.max():.4f}, "
      f"{(pred.score >= 0.5).sum()} with score >= 0.5")
EOF
```

Expected: `OK: 500 sites, scores 0.0001-0.9019, 25 with score >= 0.5` (approximately).

The test sites come from the training data, so these scores show that the script runs and writes the right format;
they are **not** a measure of accuracy. Accuracy on held-out data is in [README.md](README.md#2-results-at-a-glance).

---

## 4. (Optional) Predict on a full SG-NEx run

The SG-NEx direct RNA-Seq runs, already processed by m6Anet `dataprep`, are public on AWS S3 (no AWS account
needed). The list of runs is in
[samples_with_RNAmod_data.tsv](https://github.com/GoekeLab/sg-nex-data/blob/master/docs/samples_with_RNAmod_data.tsv)
and the access tutorial is
[SG-NEx_m6Anet_tutorial.md](https://github.com/GoekeLab/sg-nex-data/blob/master/docs/SG-NEx_m6Anet_tutorial.md).

### 4.1 Download one run

Only `data.json` is needed. With `wget` (already on Ubuntu):

```bash
RUN=SGNex_H9_directRNA_replicate4_run2          # one of the smaller runs; any run name from the list works
mkdir -p data/sgnex/$RUN
wget -O data/sgnex/$RUN/data.json \
  https://sg-nex-data.s3.ap-southeast-1.amazonaws.com/data/processed_data/m6Anet/$RUN/data.json
```

Or with the AWS CLI, if installed (`sudo snap install aws-cli --classic`):

```bash
aws s3 cp --no-sign-request \
  s3://sg-nex-data/data/processed_data/m6Anet/$RUN/data.json data/sgnex/$RUN/data.json
```

The SG-NEx tutorial's example run is `SGNex_A549_directRNA_replicate6_run1` (larger). The 23 runs we analysed for
Task 2 are listed in [docs/sgnex_task2.md](docs/sgnex_task2.md).

### 4.2 Score it

```bash
python scripts/predict.py --json data/sgnex/$RUN/data.json --out results/sgnex_v2/$RUN.csv --jobs 2
```

This takes a few minutes to ~30 minutes depending on the run's size and the number of cores (for reference, a
90,810-site run takes ~3 minutes on 2 cores). If the process is killed for lack of memory, use `--jobs 1` or a
machine with more RAM. Check the output with step 3 (change the file names; for a plain `.json` input replace
`gzip.open(...)` with `open(...)`).

To score all runs (as we did for Task 2), loop over the folders:

```bash
for d in data/sgnex/SGNex_*; do
  python scripts/predict.py --json $d/data.json --out results/sgnex_v2/$(basename $d).csv --jobs 2
done
```

---

## 5. (Optional) Train a model

The peer evaluation does not test training, but the script is documented here so the full method is reproducible.

### 5.1 Quick test on the included data (10 seconds)

`data/sample/sample.info` holds the labels for the 500 test sites, so you can check that training runs end to end.
Write the model to a separate file so the shipped one is not overwritten:

```bash
python scripts/train.py --data data/sample/sample.json.gz data/sample/sample.info --out results/test_model.joblib
python scripts/predict.py --json data/sample/sample.json.gz --model results/test_model.joblib --out results/test_model_predictions.csv
```

Expected: `trained on 500 sites in ...s -> results/test_model.joblib`. (500 sites are far too few for a useful model;
this is only a check that the code runs.)

### 5.2 Retrain the final model on the course training data

The course training data (Hct116, `dataset0.json.gz` and `data.info.labelled`) is **not** in the repo because of
its size. Put it in `data/data0/` (layout in [data/README.md](data/README.md)), then:

```bash
python scripts/train.py --data data/data0/dataset0.json.gz data/data0/data.info.labelled
```

This trains v2 (~25-40 min on 2 cores) and writes `models/m6a_model_v2.joblib`, **replacing the shipped model**.
Add `--out <path>` to save it elsewhere.

### All options of `train.py`

| Option | Meaning |
|---|---|
| `--data JSON LABELS` | A `data.json(.gz)` and its labels file (`gene_id,transcript_id,transcript_position,label`). Repeat to train on several runs. `gene_id` keeps the internal cross-validation folds gene-disjoint; if it is missing, genes are looked up in the Ensembl annotation in `resources/`. |
| `--out PATH` | Where to save the model. Default `models/m6a_model_v2.joblib` (or `models/m6a_model.joblib` with `--v1`). |
| `--jobs N` | CPU cores (default 2). |
| `--seed N` | Random seed (default 42). |
| `--v1` | Train the earlier v1 model instead of v2 (~10 min). |

---

## 6. (Optional) Reproduce the evaluation results

The numbers in the report (ROC AUC and PR AUC against a random classifier, a simple baseline, LightGBM and m6Anet,
with gene-level bootstrap confidence intervals) come from the numbered scripts in `experiments/`. They need the course
datasets `data0`-`data2` in `data/` and take hours in total. Order, run times and outputs:
[experiments/README.md](experiments/README.md); full commands: the "Reproduce" section of
[docs/model_development.md](docs/model_development.md#reproduce). The resulting tables are already committed in
`results/` ([results/README.md](results/README.md) says which script wrote each file), so you can read the results
without re-running anything.

Running m6Anet itself (the benchmark) needs Python 3.8 in a separate conda environment:
`conda env create -f environment_m6anet.yml && conda activate m6anet`.

---

## 7. Open the interactive visualisation

The **Dolly RNA Explorer** (`viz/site/`) lets researchers explore our v2 predictions on the 23 SG-NEx runs from 7
cell lines (A549, H9, HEYA8, Hct116, HepG2, K562, MCF7). It is a folder of static HTML/JavaScript files with all data
included; it needs only Python (to serve the files) and a web browser, and works offline.

### 7.1 Start it

On your own laptop (macOS / Linux / Windows), from the repo root:

```bash
python3 -m http.server 8000 --directory viz/site      # Windows: py -m http.server 8000 --directory viz/site
```

Leave the terminal open, then open **http://localhost:8000** in your browser. Stop it with `Ctrl+C`.

On an AWS machine (no browser), start the same command there, then forward the port from your laptop and open
http://localhost:8000 on the laptop:

```bash
ssh -i <your-key.pem> -L 8000:localhost:8000 ubuntu@<aws-machine-address>
```

Do not open `viz/site/index.html` by double-clicking it: browsers block the data files when a page is opened from
disk, so the page stays empty. Always go through `http://localhost:8000`.

### 7.2 Use it

The left menu has five pages:

| Page | What it shows | Try this |
|---|---|---|
| **Overview** | Number of sites and read coverage per run, the distribution of prediction scores, and the share of sites scoring at or above a cutoff for every run, grouped by cell line (one dot per run, bar = cell-line mean) | Change *Exploration cutoff* (e.g. 0.5 to 0.8) and *Minimum coverage* and watch the cell-line panel |
| **Site explorer** | A searchable table of sites: run or cell line, transcript, position, gene, 7-mer sequence, reads and score. Click a row's arrow for the site's details | Type a gene ID (e.g. `ENSG00000156508`) or a transcript ID; set *Minimum score* to 0.5 to list likely m6A sites; *Export filtered CSV* downloads the table |
| **Compare samples** | Two runs or two cell lines side by side at the same transcript positions: shared and unique sites and a scatter plot of read coverage or prediction score | Choose a cell-line summary for *Sample A* and *Sample B*, switch *Measure* to *Prediction score* |
| **Data & imports** | The catalogue of the 23 SG-NEx runs and the development datasets; import your own coverage or prediction CSV (kept in your browser only) | Import a CSV from step 2 or 4 as *Model prediction CSV* to attach it to a matching sample |
| **Methods & guide** | What a candidate site, a score and a comparison mean, and the data's limits | Read before interpreting differences between cell lines |

Points to keep in mind when reading it: scores are predictions from a model trained on Hct116, not experimentally
confirmed modifications; a score of 0.8 does not mean 80% of reads are modified; a site missing from a run was not
measured with enough reads, which does not mean it is unmodified; and deeper runs get more high-scoring sites, so
compare cell lines at shared sites. Our analysis of these results is in [docs/sgnex_task2.md](docs/sgnex_task2.md).

To rebuild the dashboard data from new predictions, see [viz/README.md](viz/README.md).

---

## 8. Troubleshooting

| Problem | Cause and fix |
|---|---|
| `The virtual environment was not created successfully because ensurepip is not available` | `python3-venv` is missing: run step 1.1 (on Ubuntu 24.04 also try `sudo apt install -y python3.12-venv`), delete the half-made `.venv` with `rm -rf .venv` and run `bash setup_env.sh` again |
| `python: command not found` or `ModuleNotFoundError: No module named 'lightgbm'` | The environment is not active: `source .venv/bin/activate` (step 1.4) |
| `ModuleNotFoundError: No module named 'm6a'` or `can't open file 'scripts/predict.py'` | You are not in the repo root: `cd ~/dsa4262-teamproject-dolly` |
| `Permission denied` running `setup_env.sh` | Run it with `bash setup_env.sh`, not `./setup_env.sh` |
| `git clone` asks for a username/password | The repository must be public for the evaluation; if it is still private, ask the team for access |
| The prediction process is `Killed` | Not enough memory for a large run: use `--jobs 1`, or a machine with more RAM |
| `wget` returns `403 Forbidden` / `404 Not Found` for SG-NEx | Check the run name against the list in step 4; it must match the S3 folder name exactly |
| Dashboard page is blank or says it failed to load | Open it through `http://localhost:8000` (step 7.1), not as a file; if port 8000 is busy use 8001 |
| Dashboard shows old data after `git pull` | Hard-refresh the browser: `Ctrl+Shift+R` (`Cmd+Shift+R` on macOS) |

Last checked on 17 Oct 2026 on a fresh clone with the latest package versions (pandas 3.0, scikit-learn 1.9,
LightGBM 4.7): `setup_env.sh`, prediction on the test data with v2 and v1, the format check, training on the test
data, and the dashboard. Before submission, run steps 1-3 once more on a new AWS Ubuntu instance.
