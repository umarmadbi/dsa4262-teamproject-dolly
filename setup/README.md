# setup/

Everything needed to install the software. **Run the setup script from the repo root**; it creates the environment
in `.venv/` at the repo root.

| File | What it does |
|---|---|
| `setup_env.sh` | Linux / macOS / AWS Ubuntu: creates `.venv/`, installs `requirements.txt` and registers the Jupyter kernel "Python (DSA4262)" |
| `setup_env.bat` | The same for Windows |
| `requirements.txt` | Python packages for the main environment (Python 3.10-3.12): numpy, pandas, scikit-learn, LightGBM, XGBoost, joblib, Jupyter, ... |
| `environment_m6anet.yml` | A **separate** conda environment (Python 3.8) for running m6Anet itself. Only needed to repeat the m6Anet benchmark, not to use our model |

## Install (AWS Ubuntu)

```bash
sudo apt update && sudo apt install -y git python3-venv python3-pip   # once per machine
bash setup/setup_env.sh                                              # once, from the repo root (~3-5 min)
source .venv/bin/activate                                            # every new terminal
```

Windows: run `setup\setup_env.bat`, then `.venv\Scripts\activate`.

m6Anet benchmark only: `conda env create -f setup/environment_m6anet.yml && conda activate m6anet`.

Full guide with checks and troubleshooting: [docs/HOW_TO_RUN.md](../docs/HOW_TO_RUN.md).
