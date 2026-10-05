"""Reading the m6Anet-processed direct RNA-Seq data and the labels.

The json files are large (dataset0 is ~650 MB uncompressed), so they are read
line by line instead of all at once. This keeps memory low on the shared
8 GB server and on whichever machine the graders use.
"""
from __future__ import annotations

import gzip
import json
from pathlib import Path
from typing import Iterator, Tuple

import numpy as np
import pandas as pd

# The 9 features recorded for every read: dwell time (dt), signal standard
# deviation (sd) and mean current (mean) at the -1 flanking position (m1),
# the candidate site (0) and the +1 flanking position (p1).
READ_FEATURES = ["dt_m1", "sd_m1", "mean_m1",
                 "dt_0", "sd_0", "mean_0",
                 "dt_p1", "sd_p1", "mean_p1"]
KEY = ["transcript_id", "transcript_position"]


def _open(path: str | Path):
    path = Path(path)
    return gzip.open(path, "rt") if path.suffix == ".gz" else open(path, "rt")


def iter_sites(json_path: str | Path) -> Iterator[Tuple[str, int, str, np.ndarray]]:
    """Yield (transcript_id, position, 7-mer, reads) for every site.

    `reads` is a float32 array of shape (n_reads, 9), columns as READ_FEATURES.
    Works with both .json and .json.gz files.
    """
    with _open(json_path) as fh:
        for line in fh:
            for tx, positions in json.loads(line).items():
                for pos, kmers in positions.items():
                    for kmer, reads in kmers.items():
                        yield tx, int(pos), kmer, np.asarray(reads, dtype=np.float32)


def site_summary(json_path: str | Path) -> pd.DataFrame:
    """One row per site with mean / SD / median of each read feature.

    This is the simple representation used in the EDA baselines. Richer
    features (quantiles, per-k-mer normalisation) should go in a separate
    m6a/features.py module so everyone shares them.
    """
    rows = []
    for tx, pos, kmer, a in iter_sites(json_path):
        r = {"transcript_id": tx, "transcript_position": pos, "kmer": kmer, "n_reads": len(a)}
        for i, f in enumerate(READ_FEATURES):
            col = a[:, i]
            r[f + "_mean"] = float(col.mean())
            r[f + "_std"] = float(col.std())
            r[f + "_med"] = float(np.median(col))
        rows.append(r)
    df = pd.DataFrame(rows)
    df["k5"] = df["kmer"].str[1:6]  # central 5-mer = the DRACH motif
    return df


def load_labels(info_path: str | Path) -> pd.DataFrame:
    """Read data.info / data.info.labelled (CSV with transcript_id, transcript_position, label[, gene_id])."""
    return pd.read_csv(info_path)


def load_labelled_sites(json_path: str | Path, info_path: str | Path) -> pd.DataFrame:
    """Site summaries joined with their labels on transcript_id + transcript_position."""
    return site_summary(json_path).merge(load_labels(info_path), on=KEY, how="inner")
