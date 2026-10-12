# AI use log

The report must include a table of how AI tools were used, plus **at least two instances** where an AI tool's output was wrong, misleading, or rested on an unverified assumption: how we detected it and what we did. Add entries as you go; it is much harder to reconstruct later.

## Uses

| Date | Who | AI tool | Prompt and output (short) | How the output was used |
|---|---|---|---|---|
| 2026-10-05 | Umar | Claude | Exploratory analysis of data0/1/2; identified pitfalls (imbalance, gene leakage, Simpson's paradox, batch shift) | Basis for `notebooks/01_EDA.ipynb` and `docs/eda_findings.md`; numbers re-checked by running the notebook |
| 2026-10-05 | Umar | Claude | Sizing the AWS machine, repo structure, setup docs | Machine chosen (t3.large, 128 GB), this repo layout |
| 2026-10-05 | Umar | Claude | Model development: features, baselines, gene-grouped CV, read-level and neighbour models, train/predict scripts | `src/m6a/*`, `scripts/train.py`, `scripts/predict.py`, `experiments/`, `docs/model_development.md`; results re-run end-to-end through `predict.py` |
| 2026-10-12 | Hamzah | Claude (Claude Code) | Ran the m6Anet benchmark: Python 3.8 env, input conversion, inference on dataset0/1/2, paired comparison | `experiments/07_m6anet_*`, `08_m6anet_compare.py`, m6Anet section of `docs/model_development.md` |
| 2026-10-12 | Hamzah | Claude (Claude Code) | Proposed and implemented model improvements (Ensembl transcript-structure features, read re-labelling, richer neighbours, seed averaging, two-run training), chose by CV | `src/m6a/annotation.py`, `experiments/09`–`11`, v2 section of `docs/model_development.md`, `models/m6a_model_v2.joblib` |
| | | | | |

## Cases where the AI was wrong or misleading

| Date | Who | What the AI said | How we detected the problem | What we did |
|---|---|---|---|---|
| 2026-10-05 | Umar | Claude expected per-5-mer centring (and per-run "self" centring as batch correction) to be important, based on the EDA's Simpson's paradox | Ablation in `experiments/02_variants.py`: for LightGBM with the 7-mer as input it changed CV PR by <0.01 and did not improve the cross-run test (0.360-0.370) | Kept training-reference centring (it helps the linear model), reported the null result instead of claiming a batch-correction gain |
| 2026-10-05 | Umar | Claude reported the read-level model as an improvement after 5-fold CV (+0.012 PR) | On the frozen dataset0 test set the paired bootstrap CI of the gain was -0.012 to +0.014, i.e. not significant (it did help on dataset1 and dataset2) | Report states the gain is not significant on dataset0; most of the final improvement comes from the neighbour features |
| 2026-10-12 | Hamzah | Claude recommended MIL read re-labelling and richer neighbour context as likely improvements | 5-fold gene-grouped CV (`10_improvements_cv.py`): re-labelling +0.000 PR (2/5 folds better) at twice the training time; richer neighbours +0.009 alone and +0.000 on top of the annotation features | Dropped both; only the annotation features went into v2 |
| 2026-10-12 | Hamzah | Claude's first v2 scored transcripts missing from Ensembl near 0 (NaN annotation read as 0 = "on an exon junction"); its first fix (hide 10% of the annotation in training) did not work | The dataset2 panel of `docs/figures/model_evaluation_v2.png` showed flat scores near 0.03 at every modification fraction; a quick re-test after the first fix was still ~4x too low | Added a fallback model without annotation for unannotated transcripts and re-ran the final evaluation |
| 2026-10-12 | Hamzah | Claude ran a code smoke test that scored on the frozen dataset0 test genes | Noticed by Claude itself in the output | No decision used it; disclosed in `docs/model_development.md` |
| 2026-10-12 | Hamzah | Claude suggested closing the VS Code server under `~/.vscode-server` to free memory, assuming it was a spare session of Hamzah's | Checking the processes showed it was Umar's live session (Claude Code running in `~/umar/...`) | Left it running |
