"""Shared setup for experiment scripts: load cached tables and the frozen split."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from m6a.evaluation import frozen_test_split  # noqa: E402

CACHE = ROOT / "cache"
RESULTS = ROOT / "results"
SPLIT_FILE = RESULTS / "test_genes_d0.csv"


def load_d0():
    """dataset0 with an `is_test` column (frozen 20% of genes, saved to disk)."""
    d0 = pd.read_parquet(CACHE / "d0.parquet")
    if SPLIT_FILE.exists():
        test_genes = set(pd.read_csv(SPLIT_FILE)["gene_id"])
    else:
        mask = frozen_test_split(d0)
        test_genes = set(d0.loc[mask, "gene_id"])
        RESULTS.mkdir(exist_ok=True)
        pd.Series(sorted(test_genes), name="gene_id").to_csv(SPLIT_FILE, index=False)
    d0["is_test"] = d0["gene_id"].isin(test_genes)
    return d0


def load_d1_unseen(d0):
    """dataset1 sites whose transcript (and known gene) does not occur in dataset0."""
    d1 = pd.read_parquet(CACHE / "d1.parquet")
    tx2gene = d0.drop_duplicates("transcript_id").set_index("transcript_id")["gene_id"]
    d1["gene_id"] = d1["transcript_id"].map(tx2gene)
    unseen = ~d1["transcript_id"].isin(set(d0["transcript_id"]))
    d1["gene_id"] = d1["gene_id"].fillna(d1["transcript_id"])  # unknown gene: group by transcript
    return d1, unseen.to_numpy()
