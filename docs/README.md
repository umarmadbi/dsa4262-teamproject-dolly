# docs/

Guides, write-ups and figures. Start with the main [README](../README.md); the documents here go into detail.

| Document | What it covers | Read it when |
|---|---|---|
| [HOW_TO_RUN.md](HOW_TO_RUN.md) | Step-by-step: install on AWS Ubuntu, predict on the test data, check the output, score an SG-NEx run, train, troubleshooting | You want to run the code (this is the guide for evaluators) |
| [eda_findings.md](eda_findings.md) | The three datasets, what the EDA found, the pitfalls every model must handle | Before building or reviewing any model |
| [model_development.md](model_development.md) | Task 1 in full: evaluation design, features, every model compared, v1 and v2 final results, m6Anet benchmark, limitations, how to reproduce | You want to know why the model is built the way it is, or need numbers for the report |
| [connect_to_server.md](connect_to_server.md) | Logging in to the team AWS machine (key, VS Code Remote-SSH, uploading data, sharing rules) | First day, or a new laptop |
| [team_guide.md](team_guide.md) | Internal team notes: shared AWS server, Git workflow, what is not in git, deadlines and budget | You are a team member working on the repo |

## figures/

| Figure | Made by | Shows |
|---|---|---|
| `EDA_pitfalls.png` | `notebooks/01_EDA.ipynb` | Six EDA panels: m6A rate by 5-mer, current shift by 5-mer, read depth, dose-response on dataset2, split leakage, label changes between datasets |
| `model_evaluation.png` | `experiments/06_figures.py` | v1: precision-recall and ROC curves on both test sets, dataset2 dose-response |
| `m6anet_comparison.png` | `experiments/08_m6anet_compare.py` | v1 vs pretrained m6Anet on the same test sites |
| `model_evaluation_v2.png` | `experiments/11_final_eval_v2.py` | v2: precision-recall curves on dataset0 held-out genes and dataset1 unseen genes, dataset2 median score by modification fraction |
