"""Turn a data.json(.gz) file into a site-level table (one row per site).

Usage (from the repo root):
    python scripts/parse_to_parquet.py data/data0/dataset0.json.gz results/d0_sites.parquet \
        --info data/data0/data.info.labelled

Parsing dataset0 takes several minutes; save the result and reuse it.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from m6a.io import load_labels, site_summary, KEY  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("json", help="path to dataset*.json or .json.gz")
    ap.add_argument("out", help="output .parquet (or .csv) file")
    ap.add_argument("--info", help="optional data.info file to join labels")
    args = ap.parse_args()

    df = site_summary(args.json)
    if args.info:
        df = df.merge(load_labels(args.info), on=KEY, how="left")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out, index=False) if out.suffix == ".csv" else df.to_parquet(out, index=False)
    print(f"{len(df):,} sites -> {out}")


if __name__ == "__main__":
    main()
