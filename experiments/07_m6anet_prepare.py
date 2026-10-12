"""Turn our dataset*.json.gz files into m6Anet inference inputs.

Our json files are already m6Anet `dataprep` output (one site per line,
{tx: {pos: {7-mer: [[9 floats per read], ...]}}}). `m6anet inference` also
needs, in the same directory:
  * data.json uncompressed (it seeks to byte offsets)
  * data.info: transcript_id, transcript_position, start, end, n_reads
    where start/end are the byte offsets of that site's line in data.json.

Standard library only, so it runs in either environment.
Outputs: cache/m6anet/d{0,1,2}/data.json + data.info
"""
import csv
import gzip
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATASETS = {"d0": ROOT / "data/data0/dataset0.json.gz",
            "d1": ROOT / "data/data1/dataset1.json.gz",
            "d2": ROOT / "data/data2/dataset2.json.gz"}


def prepare(src: Path, out_dir: Path) -> int:
    out_dir.mkdir(parents=True, exist_ok=True)
    n = 0
    with gzip.open(src, "rb") as fin, open(out_dir / "data.json", "wb") as fj, \
            open(out_dir / "data.info", "w", newline="") as fi:
        w = csv.writer(fi)
        w.writerow(["transcript_id", "transcript_position", "start", "end", "n_reads"])
        for line in fin:
            line = line.rstrip(b"\n")
            start = fj.tell()
            fj.write(line)
            end = fj.tell()
            fj.write(b"\n")
            site = json.loads(line)
            (tx, positions), = site.items()
            (pos, kmers), = positions.items()
            (_, reads), = kmers.items()
            w.writerow([tx, pos, start, end, len(reads)])
            n += 1
    return n


if __name__ == "__main__":
    for name in sys.argv[1:] or DATASETS:
        n = prepare(DATASETS[name], ROOT / "cache/m6anet" / name)
        print(f"{name}: {n:,} sites -> cache/m6anet/{name}", flush=True)
