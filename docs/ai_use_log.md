# AI use log

The report must include a table of how AI tools were used, plus **at least two instances** where an AI tool's output was wrong, misleading, or rested on an unverified assumption: how we detected it and what we did. Add entries as you go; it is much harder to reconstruct later.

## Uses

| Date | Who | AI tool | Prompt and output (short) | How the output was used |
|---|---|---|---|---|
| 2026-10-05 | Umar | Claude | Exploratory analysis of data0/1/2; identified pitfalls (imbalance, gene leakage, Simpson's paradox, batch shift) | Basis for `notebooks/01_EDA.ipynb` and `docs/eda_findings.md`; numbers re-checked by running the notebook |
| 2026-10-05 | Umar | Claude | Sizing the AWS machine, repo structure, setup docs | Machine chosen (t3.large, 128 GB), this repo layout |
| 2026-10-05 | Umar | Claude | Model development: features, baselines, gene-grouped CV, read-level and neighbour models, train/predict scripts | `src/m6a/*`, `scripts/train.py`, `scripts/predict.py`, `experiments/`, `docs/model_development.md`; results re-run end-to-end through `predict.py` |
| | | | | |

## Cases where the AI was wrong or misleading

| Date | Who | What the AI said | How we detected the problem | What we did |
|---|---|---|---|---|
| 2026-10-05 | Umar | Claude expected per-5-mer centring (and per-run "self" centring as batch correction) to be important, based on the EDA's Simpson's paradox | Ablation in `experiments/02_variants.py`: for LightGBM with the 7-mer as input it changed CV PR by <0.01 and did not improve the cross-run test (0.360-0.370) | Kept training-reference centring (it helps the linear model), reported the null result instead of claiming a batch-correction gain |
| 2026-10-05 | Umar | Claude reported the read-level model as an improvement after 5-fold CV (+0.012 PR) | On the frozen dataset0 test set the paired bootstrap CI of the gain was -0.012 to +0.014, i.e. not significant (it did help on dataset1 and dataset2) | Report states the gain is not significant on dataset0; most of the final improvement comes from the neighbour features |
