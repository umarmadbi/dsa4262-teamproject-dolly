"""Glue used by scripts/train.py and scripts/predict.py."""
from __future__ import annotations

import numpy as np
import pandas as pd

from .features import build_site_table
from .io import KEY, load_labels


def load_sites(json_path, info_path=None, cap: int = 20, n_jobs: int = 1, seed: int = 42):
    """Parse one data.json(.gz) -> (sites, reads, offsets).

    sites has one row per site (features, 'kmer', 'k5', optional labels) and a
    'row' column pointing into offsets; reads holds at most `cap` reads per site.
    With info_path, only sites present in the labels file are kept.
    """
    df, reads = build_site_table(json_path, n_jobs=n_jobs, max_reads=cap, seed=seed)
    df["_src"] = np.arange(len(df))
    if info_path is not None:
        lab = load_labels(info_path)
        keep = [c for c in ["gene_id", "transcript_id", "transcript_position", "label"] if c in lab]
        df = df.merge(lab[keep], on=KEY, how="inner")
    arrays = [reads[i] for i in df["_src"]]
    lens = np.array([len(x) for x in arrays])
    df = df.drop(columns="_src").reset_index(drop=True)
    df["row"] = np.arange(len(df))
    return df, np.concatenate(arrays), np.r_[0, np.cumsum(lens)]


def combine(parts):
    """Stack several (sites, reads, offsets) into one, re-pointing 'row'."""
    sites, reads, offsets, n_rows, n_reads = [], [], [np.array([0])], 0, 0
    for s, r, o in parts:
        s = s.copy()
        s["row"] = s["row"] + n_rows
        sites.append(s)
        reads.append(r)
        offsets.append(o[1:] + n_reads)
        n_rows += len(o) - 1
        n_reads += len(r)
    return pd.concat(sites, ignore_index=True), np.concatenate(reads), np.concatenate(offsets)


def fill_gene_ids(sites: pd.DataFrame) -> pd.DataFrame:
    """Use gene_id where known (also borrowed across inputs via transcript_id);
    otherwise the transcript is its own group."""
    if "gene_id" not in sites:
        sites["gene_id"] = np.nan
    known = sites.dropna(subset=["gene_id"]).drop_duplicates("transcript_id")
    tx2gene = known.set_index("transcript_id")["gene_id"]
    sites["gene_id"] = (sites["gene_id"].fillna(sites["transcript_id"].map(tx2gene))
                        .fillna(sites["transcript_id"]))
    return sites
