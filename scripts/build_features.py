"""Parse a data.json(.gz) into a cached site-level feature table (parquet).

Usage:
    python scripts/build_features.py data/data0/dataset0.json.gz cache/d0 \
        [--info data/data0/data.info.labelled] [--max-reads 50] [--jobs 2]

Writes <out>.parquet and, with --max-reads, <out>_reads.npz (a random
sample of reads per site, used by the read-level model).
"""
import argparse
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from m6a.features import build_site_table  # noqa: E402
from m6a.io import KEY, load_labels  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("json")
    ap.add_argument("out", help="output prefix, e.g. cache/d0")
    ap.add_argument("--info", help="optional labels file to join")
    ap.add_argument("--max-reads", type=int, default=0)
    ap.add_argument("--jobs", type=int, default=1)
    a = ap.parse_args()

    t = time.time()
    df, reads = build_site_table(a.json, n_jobs=a.jobs, max_reads=a.max_reads)
    if a.info:
        lab = load_labels(a.info)
        keep = [c for c in ["gene_id", "transcript_id", "transcript_position", "label"] if c in lab]
        df = df.merge(lab[keep], on=KEY, how="left")
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(f"{out}.parquet", index=False)
    if reads is not None:
        lens = np.array([len(r) for r in reads])
        np.savez(f"{out}_reads.npz", reads=np.concatenate(reads), offsets=np.r_[0, np.cumsum(lens)])
    print(f"{len(df):,} sites -> {out}.parquet  ({time.time() - t:.0f}s)")


if __name__ == "__main__":
    main()
