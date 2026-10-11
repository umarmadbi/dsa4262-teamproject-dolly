"""Site-level features built from the reads at each candidate site.

Why these features (see docs/eda_findings.md and "potential pitfalls"):

* Partial modification: only some reads at a site carry m6A, so the read
  distribution matters, not just its mean. We summarise every read feature
  with quantiles (5/25/50/75/95 %), mean and SD.
* Heavy-tailed outliers (centre SD up to 181): dwell time and SD are
  log-transformed, and quantiles are robust to the extreme reads.
* Read depth differs between datasets (median 47 vs 814): no feature uses
  the raw read count or a sum, so features do not scale with depth.
* Simpson's paradox: current only has meaning relative to its own k-mer.
  `KmerCentering` subtracts a per-5-mer reference level from every signal
  feature; the model also gets the one-hot 7-mer so it can learn the
  sequence prior.
* Batch shift between runs: `KmerCentering(reference="self")` estimates the
  per-5-mer reference from the dataset being scored (label-free), which
  removes run-level offsets.
"""
from __future__ import annotations

import warnings

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin

from .io import READ_FEATURES

QUANTILES = (0.05, 0.25, 0.5, 0.75, 0.95)
Q_NAMES = ("q05", "q25", "q50", "q75", "q95")
LOG_COLS = {0, 1, 3, 4, 6, 7}           # dwell time and SD at each position
BASES = "ACGT"


def _transform_reads(a: np.ndarray) -> np.ndarray:
    """Log-transform dwell time and SD; add read-level current differences."""
    a = a.astype(np.float64, copy=True)
    for i in LOG_COLS:
        a[:, i] = np.log(np.clip(a[:, i], 1e-5, None))
    # change in current entering and leaving the site, per read
    d1 = a[:, 5] - a[:, 2]              # mean_0  - mean_m1
    d2 = a[:, 8] - a[:, 5]              # mean_p1 - mean_0
    return np.column_stack([a, d1, d2])


SIGNAL_BASE = ["log_dt_m1", "log_sd_m1", "mean_m1",
               "log_dt_0", "log_sd_0", "mean_0",
               "log_dt_p1", "log_sd_p1", "mean_p1",
               "dmean_in", "dmean_out"]
SIGNAL_COLS = [f"{b}_{s}" for b in SIGNAL_BASE for s in ("mean", "sd") + Q_NAMES]


def read_summary(reads: np.ndarray) -> np.ndarray:
    """Vector of SIGNAL_COLS for one site (reads: n_reads x 9)."""
    t = _transform_reads(reads)
    q = np.quantile(t, QUANTILES, axis=0)            # 5 x 11
    out = np.vstack([t.mean(0), t.std(0), q])         # 7 x 11
    return out.T.ravel()                               # base-major order


def kmer_onehot(kmers: pd.Series) -> pd.DataFrame:
    """One-hot encode the 7-mer (7 positions x 4 bases = 28 columns)."""
    arr = np.array([list(k) for k in kmers])
    cols = {}
    for p in range(7):
        for b in BASES:
            cols[f"seq{p - 3:+d}_{b}"] = (arr[:, p] == b).astype(np.int8)
    return pd.DataFrame(cols, index=kmers.index)


SEQ_COLS = [f"seq{p - 3:+d}_{b}" for p in range(7) for b in BASES]


class KmerCentering(BaseEstimator, TransformerMixin):
    """Subtract a per-5-mer reference level from each signal feature.

    reference="train": reference medians are learned in `fit` (training data
    only) and reused on any new data.
    reference="self":  each call to `transform` estimates per-5-mer medians
    from the data it is given (label-free), falling back to the training
    reference plus a global offset for rare 5-mers. This acts as a per-run
    batch correction, so call it on one whole dataset at a time.
    """

    def __init__(self, cols=None, reference: str = "train", min_count: int = 30):
        self.cols = cols
        self.reference = reference
        self.min_count = min_count

    def fit(self, X: pd.DataFrame, y=None):
        cols = self.cols or SIGNAL_COLS
        self.cols_ = list(cols)
        self.ref_ = X.groupby("k5")[self.cols_].median()
        self.global_ = X[self.cols_].median()
        return self

    def _reference(self, X):
        ref = self.ref_.reindex(X["k5"].unique())
        ref = ref.fillna(self.global_)
        if self.reference == "self":
            g = X.groupby("k5")
            own = g[self.cols_].median()
            cnt = g.size()
            offset = X[self.cols_].median() - self.global_      # global run shift
            fallback = ref.loc[own.index] + offset
            ok = (cnt >= self.min_count).reindex(own.index)
            ref = own.where(ok, fallback, axis=0)
        return ref

    def transform(self, X: pd.DataFrame):
        ref = self._reference(X)
        X = X.copy()
        X[self.cols_] = X[self.cols_].to_numpy() - ref.loc[X["k5"], self.cols_].to_numpy()
        return X


# ---------------------------------------------------------------------------
# Building the site table from a data.json(.gz) file
# ---------------------------------------------------------------------------
def _parse_line(line: str, max_reads: int, rng_seed: int):
    """Parse one json line -> list of (tx, pos, kmer, n_reads, feats, read_sample)."""
    try:
        import orjson as _json
    except ImportError:                       # pragma: no cover
        import json as _json
    out = []
    for tx, positions in _json.loads(line).items():
        for pos, kmers in positions.items():
            for kmer, reads in kmers.items():
                a = np.asarray(reads, dtype=np.float32)
                feats = read_summary(a).astype(np.float32)
                samp = None
                if max_reads:
                    rng = np.random.default_rng(rng_seed + int(pos))
                    idx = rng.choice(len(a), min(max_reads, len(a)), replace=False)
                    samp = a[idx]
                out.append((tx, int(pos), kmer, len(a), feats, samp))
    return out


def _parse_chunk(args):
    lines, max_reads, seed = args
    res = []
    for ln in lines:
        res.extend(_parse_line(ln, max_reads, seed))
    return res


def build_site_table(json_path, n_jobs: int = 1, max_reads: int = 0,
                     chunk: int = 2000, seed: int = 42):
    """Parse a data.json(.gz) into a site-level feature DataFrame.

    Returns (df, reads) where `reads` is a list of per-site read arrays
    (random sample of at most `max_reads` reads; None if max_reads == 0).
    """
    from .io import _open
    from multiprocessing import Pool

    def chunks():
        buf = []
        with _open(json_path) as fh:
            for ln in fh:
                buf.append(ln)
                if len(buf) == chunk:
                    yield (buf, max_reads, seed)
                    buf = []
        if buf:
            yield (buf, max_reads, seed)

    rows = []
    if n_jobs > 1:
        with Pool(n_jobs) as pool:
            for r in pool.imap(_parse_chunk, chunks()):
                rows.extend(r)
    else:
        for c in chunks():
            rows.extend(_parse_chunk(c))

    df = pd.DataFrame(np.vstack([r[4] for r in rows]), columns=SIGNAL_COLS)
    df.insert(0, "transcript_id", [r[0] for r in rows])
    df.insert(1, "transcript_position", np.array([r[1] for r in rows], dtype=np.int64))
    df.insert(2, "kmer", [r[2] for r in rows])
    df.insert(3, "n_reads", np.array([r[3] for r in rows], dtype=np.int32))
    df.insert(4, "k5", df["kmer"].str[1:6])
    reads = [r[5] for r in rows] if max_reads else None
    return df, reads


# ---------------------------------------------------------------------------
# Read-level representation (for the multiple-instance / read-level model)
# ---------------------------------------------------------------------------
READ_COLS = SIGNAL_BASE  # 11 per-read values: 9 transformed features + 2 current changes


def load_reads(npz_path):
    """Load the per-site read sample written by build_features.py."""
    z = np.load(npz_path)
    return z["reads"], z["offsets"]


def site_reads(reads, offsets, rows, cap=None, seed=0):
    """Stack reads for the given site rows -> (X_reads, site_index_of_each_read)."""
    rng = np.random.default_rng(seed)
    xs, ids = [], []
    for i, r in enumerate(rows):
        a = reads[offsets[r]:offsets[r + 1]]
        if cap and len(a) > cap:
            a = a[rng.choice(len(a), cap, replace=False)]
        xs.append(a)
        ids.append(np.full(len(a), i, np.int32))
    return _transform_reads(np.concatenate(xs)).astype(np.float32), np.concatenate(ids)


def pool_read_scores(p, site_idx, n_sites):
    """Per-site summaries of read-level probabilities (MIL pooling)."""
    df = pd.DataFrame({"s": site_idx, "p": p})
    g = df.groupby("s")["p"]
    out = pd.DataFrame({
        "rp_mean": g.mean(),
        "rp_q50": g.median(),
        "rp_q75": g.quantile(0.75),
        "rp_q90": g.quantile(0.9),
        "rp_max": g.max(),
        "rp_frac50": (df["p"] > 0.5).groupby(df["s"]).mean(),
        # noisy-OR on log scale, normalised by depth so it does not grow with read count
        "rp_lognor_mean": df.assign(l=np.log1p(-np.clip(p, 0, 0.999))).groupby("s")["l"].mean(),
    })
    return out.reindex(range(n_sites))


POOL_COLS = ["rp_mean", "rp_q50", "rp_q75", "rp_q90", "rp_max", "rp_frac50", "rp_lognor_mean"]


# ---------------------------------------------------------------------------
# Neighbourhood context: m6A sites cluster along transcripts (EDA finding 6)
# ---------------------------------------------------------------------------
NEIGH_WINDOWS = (25, 100)
NEIGH_COLS = [f"nb{w}_{s}" for w in NEIGH_WINDOWS for s in ("max", "mean", "n")]


def neighbour_features(sites: pd.DataFrame, score: np.ndarray) -> pd.DataFrame:
    """For each site, summarise first-stage scores of *other* candidate sites
    in the same transcript within +-w nt. Uses no labels, only model scores,
    so it is available at prediction time."""
    out = np.full((len(sites), len(NEIGH_COLS)), np.nan, np.float32)
    df = pd.DataFrame({"tx": sites["transcript_id"].to_numpy(),
                       "pos": sites["transcript_position"].to_numpy(), "s": score})
    for _, g in df.groupby("tx", sort=False):
        idx = g.index.to_numpy()
        p = g["pos"].to_numpy()
        s = g["s"].to_numpy()
        dist = np.abs(p[:, None] - p[None, :])
        np.fill_diagonal(dist, 10 ** 9)
        col = 0
        for w in NEIGH_WINDOWS:
            m = dist <= w
            n = m.sum(1)
            sm = np.where(m, s[None, :], np.nan)
            with np.errstate(all="ignore"), warnings.catch_warnings():
                warnings.simplefilter("ignore", RuntimeWarning)
                out[idx, col] = np.where(n > 0, np.nanmax(np.where(m, s[None, :], -1), 1), 0)
                out[idx, col + 1] = np.where(n > 0, np.nanmean(sm, 1), 0)
            out[idx, col + 2] = n
            col += 3
    return pd.DataFrame(out, columns=NEIGH_COLS, index=sites.index)
