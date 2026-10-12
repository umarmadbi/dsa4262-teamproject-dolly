"""Train the m6A model.

Usage (from the repo root):
    python scripts/train.py --data data/data0/dataset0.json.gz data/data0/data.info.labelled \
                            --out models/m6a_model.joblib [--jobs 2]

--data takes a json file and its labels file; repeat it to train on several
runs. The labels file needs transcript_id, transcript_position and label
(0/1); gene_id is used to keep the inner cross-validation folds gene-disjoint
(if missing, genes are borrowed from the other inputs, then from the Ensembl
annotation in resources/, else the transcript is its own group).

--v2 trains the v2 model (docs/model_development.md): ReadStackModel with
transcript-structure features, averaged over three seeds, plus a fallback model
for transcripts missing from Ensembl (~4x the v1 training time). Without it,
the original v1 model is trained.
"""
import argparse
import sys
import time
from pathlib import Path

import joblib

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from m6a.models import V2_CONFIG, ReadStackModel, SeedEnsemble  # noqa: E402
from m6a.pipeline import combine, fill_gene_ids, load_sites  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", nargs=2, action="append", required=True, metavar=("JSON", "LABELS"))
    ap.add_argument("--out", default="models/m6a_model.joblib")
    ap.add_argument("--jobs", type=int, default=2, help="CPU cores to use")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--v2", action="store_true", help="train the v2 model (transcript-structure features)")
    a = ap.parse_args()

    if a.v2:
        model = SeedEnsemble(seeds=(a.seed, a.seed + 1, a.seed + 2), n_jobs=a.jobs, **V2_CONFIG)
    else:
        model = ReadStackModel(seed=a.seed, n_jobs=a.jobs)
    parts = []
    for json_path, info_path in a.data:
        t = time.time()
        s, r, o = load_sites(json_path, info_path, cap=model.cap, n_jobs=a.jobs, seed=a.seed)
        print(f"{json_path}: {len(s):,} labelled sites, {s.label.mean():.2%} positive "
              f"({time.time() - t:.0f}s)", flush=True)
        parts.append((s, r, o))
    sites, reads, offsets = combine(parts)
    sites = fill_gene_ids(sites)
    sites["label"] = sites["label"].astype(int)

    t = time.time()
    model.fit(sites, reads, offsets)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, a.out, compress=3)
    print(f"trained on {len(sites):,} sites in {time.time() - t:.0f}s -> {a.out}")


if __name__ == "__main__":
    main()
