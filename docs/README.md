# docs/

Write-ups and figures. Start with the main [README](../README.md); to install and run the code step by step, see
[HOW_TO_RUN.md](../HOW_TO_RUN.md). These go into detail.

| Document | What it covers | Read it when |
|---|---|---|
| [eda_findings.md](eda_findings.md) | The three datasets, what the EDA found, the pitfalls every model must handle | Before building or reviewing any model |
| [model_development.md](model_development.md) | Task 1 in full: evaluation design, features, every model compared, v1 and v2 final results, m6Anet benchmark, limitations, how to reproduce | You want to know why the model is built the way it is, or need numbers for the report |
| [sgnex_task2.md](sgnex_task2.md) | Task 2: v2 vs m6Anet on 23 SG-NEx runs, region / motif enrichment, depth dependence, reproducibility across runs and cell lines | Writing the Task 2 part of the report |
| [connect_to_server.md](connect_to_server.md) | Logging in to the team AWS machine (key, VS Code Remote-SSH, uploading data, sharing rules) | First day, or a new laptop |
| [ai_use_log.md](ai_use_log.md) | Running log of AI tool use, required for the report | Every time you use an AI tool: add a row |

## figures/

| Figure | Made by | Shows |
|---|---|---|
| `EDA_pitfalls.png` | `notebooks/01_EDA.ipynb` | Six EDA panels: m6A rate by 5-mer, current shift by 5-mer, read depth, dose-response on dataset2, split leakage, label changes between datasets |
| `model_evaluation.png` | `experiments/06_figures.py` | v1: precision-recall and ROC curves on both test sets, dataset2 dose-response |
| `m6anet_comparison.png` | `experiments/08_m6anet_compare.py` | v1 vs pretrained m6Anet on the same test sites |
| `model_evaluation_v2.png` | `experiments/11_final_eval_v2.py` | v2: precision-recall curves on dataset0 held-out genes and dataset1 unseen genes, dataset2 median score by modification fraction |
| `sgnex_m6anet_comparison.png` | `experiments/12_sgnex_m6anet_compare.py` | Task 2 summary figure for the SG-NEx comparison (described in [sgnex_task2.md](sgnex_task2.md)) |
