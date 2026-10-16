"""Build the per-transcript annotation table used for transcript-structure features.

Usage (from the repo root):
    curl -O https://ftp.ensembl.org/pub/release-91/gtf/homo_sapiens/Homo_sapiens.GRCh38.91.chr_patch_hapl_scaff.gtf.gz
    python scripts/build_annotation.py Homo_sapiens.GRCh38.91.chr_patch_hapl_scaff.gtf.gz

Writes resources/ensembl91_transcripts.csv.gz (committed, so train.py / predict.py
do not need the GTF). The chr_patch_hapl_scaff GTF is needed because ~2% of our
transcripts lie on alternate haplotypes (e.g. the MHC region). Ensembl 91 is the
release whose transcript sequences match the 7-mers in our data (checked in
experiments/09_annotation_check.py).
"""
import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from m6a.annotation import DEFAULT_TABLE, build_transcript_table  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("gtf")
    ap.add_argument("--out", default=str(DEFAULT_TABLE))
    a = ap.parse_args()
    t = time.time()
    tab = build_transcript_table(a.gtf)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    tab.to_csv(a.out, index=False, compression="gzip")
    print(f"{len(tab):,} transcripts -> {a.out}  ({time.time() - t:.0f}s)")


if __name__ == "__main__":
    main()
