# notebooks/

| File | What it does |
|---|---|
| `01_EDA.ipynb` | Exploratory data analysis of dataset0-2: class balance, reads per site, clustering of positives within genes, the 5-mer effect on the signal (Simpson's paradox), outliers, batch effects between datasets, dataset2 dose-response, baselines and the cost of data leakage. Ends with the list of pitfalls the model has to handle and makes `docs/figures/EDA_pitfalls.png` |

To run it, select the kernel **"Python (DSA4262)"** (created by `setup/setup_env.sh`) and run all cells. It needs
the course datasets in `data/` (see [data/README.md](../data/README.md)). The first run parses the json files
(~7-10 min) and caches them in `notebooks/cache/`; later runs take seconds.

The findings are written up in [docs/eda_findings.md](../docs/eda_findings.md).
