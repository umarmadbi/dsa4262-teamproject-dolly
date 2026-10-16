"""Predict m6A probabilities for every site in a data.json(.gz).

Usage (from the repo root):
    python scripts/predict.py --json data/sample/sample.json.gz \
                              --model models/m6a_model.joblib \
                              --out results/sample_predictions.csv [--jobs 2]

Output: CSV with columns transcript_id,transcript_position,score where score
is the probability (0-1) that the site carries m6A. Pass one sequencing run
per call: neighbouring sites in the same transcript are used as context.
"""
import argparse
import sys
import time
from pathlib import Path

import joblib
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from m6a.pipeline import load_sites  # noqa: E402,F401  (also needed to unpickle the model)

DEFAULT_MODEL = Path(__file__).resolve().parents[1] / "models" / "m6a_model.joblib"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json", required=True, help="data.json or data.json.gz")
    ap.add_argument("--model", default=str(DEFAULT_MODEL))
    ap.add_argument("--out", required=True, help="output CSV")
    ap.add_argument("--jobs", type=int, default=2)
    a = ap.parse_args()

    t = time.time()
    model = joblib.load(a.model)
    model.n_jobs = a.jobs
    sites, reads, offsets = load_sites(a.json, cap=model.cap, n_jobs=a.jobs, seed=model.seed)
    score = np.clip(model.predict_proba(sites, reads, offsets), 0.0, 1.0)
    out = sites[["transcript_id", "transcript_position"]].assign(score=score)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(a.out, index=False)
    print(f"{len(out):,} sites scored in {time.time() - t:.0f}s -> {a.out}")


if __name__ == "__main__":
    main()
