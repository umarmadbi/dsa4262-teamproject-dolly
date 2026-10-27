#!/usr/bin/env bash
# Run pretrained m6Anet (HCT116_RNA002, the default) on dataset0/1/2.
# Needs the Python 3.8 env from setup/environment_m6anet.yml. Set M6ANET to its m6anet binary if it
# is not on PATH, e.g. M6ANET=~/hamzah/tools/micromamba/envs/m6anet/bin/m6anet
# Outputs: cache/m6anet/d{0,1,2}_out/data.site_proba.csv
set -euo pipefail
cd "$(dirname "$0")/.."
M6ANET=${M6ANET:-m6anet}
JOBS=${JOBS:-2}

python3 experiments/07_m6anet_prepare.py "$@"
for d in "${@:-d0 d1 d2}"; do
  for name in $d; do
    echo "== m6anet inference on $name ($(date +%T))"
    "$M6ANET" inference --input_dir "cache/m6anet/$name" --out_dir "cache/m6anet/${name}_out" \
      --n_processes "$JOBS" --num_iterations 1000 --seed 0
  done
done
echo "== done ($(date +%T))"
