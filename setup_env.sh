#!/usr/bin/env bash
# Creates the project virtual environment (.venv) on Linux / macOS / AWS Ubuntu.
# Run from the repo root:  bash setup_env.sh
# On a fresh Ubuntu machine first run:  sudo apt update && sudo apt install -y python3-venv python3-pip
set -e
cd "$(dirname "$0")"
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
python -m ipykernel install --user --name dsa4262 --display-name "Python (DSA4262)"
echo "Done. Activate later with: source .venv/bin/activate"
