"""Transcript-structure features from the Ensembl annotation (label-free).

Why: m6A is enriched near the stop codon and in 3' UTRs, depleted within
~200 nt of exon-exon junctions (exon junction complex), and enriched in long
internal exons and the last exon. The signal and 7-mer cannot see any of this.

`build_transcript_table` turns an Ensembl GTF into one row per transcript with
its length, CDS start/stop and exon boundaries in *transcript* coordinates
(0-based, same as transcript_position). scripts/build_annotation.py saves it to
resources/, which train.py / predict.py load. Transcripts that are not in the
table (e.g. the synthetic dataset2) get NaN features; LightGBM handles those.
"""
from __future__ import annotations

import gzip
import re
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_TABLE = ROOT / "resources" / "ensembl91_transcripts.csv.gz"

ANNOT_COLS = ["ann_known", "ann_coding", "ann_log_tx_len", "ann_rel_pos", "ann_region",
              "ann_region_rel", "ann_dist_start", "ann_dist_stop", "ann_log_utr5", "ann_log_cds",
              "ann_log_utr3", "ann_dist_junction", "ann_in_last_exon", "ann_log_exon_len",
              "ann_exon_rel", "ann_n_exons"]

_ATTR = {k: re.compile(rf'{k} "([^"]+)"') for k in ("gene_id", "transcript_id", "transcript_biotype")}


def build_transcript_table(gtf_path: str | Path) -> pd.DataFrame:
    """One row per transcript: gene_id, biotype, tx_len, cds_start, stop_start, exon_ends.

    cds_start: transcript coordinate of the first base of the start codon.
    stop_start: transcript coordinate of the first base of the stop codon.
    exon_ends: ';'-joined transcript coordinates where each exon (but the last) ends,
    i.e. the exon-exon junctions.
    """
    rows = []
    with gzip.open(gtf_path, "rt") if str(gtf_path).endswith(".gz") else open(gtf_path) as fh:
        for line in fh:
            if line.startswith("#"):
                continue
            f = line.rstrip("\n").split("\t")
            if f[2] not in ("exon", "CDS", "stop_codon"):
                continue
            a = f[8]
            rows.append((_ATTR["transcript_id"].search(a).group(1), _ATTR["gene_id"].search(a).group(1),
                         _ATTR["transcript_biotype"].search(a).group(1), f[2], f[6], int(f[3]), int(f[4])))
    g = pd.DataFrame(rows, columns=["transcript_id", "gene_id", "biotype", "feature", "strand", "start", "end"])

    out = []
    for tx, d in g.groupby("transcript_id", sort=False):
        strand = d["strand"].iat[0]
        ex = d[d.feature == "exon"].sort_values("start", ascending=(strand == "+"))
        s, e = ex["start"].to_numpy(), ex["end"].to_numpy()
        lens = e - s + 1
        before = np.r_[0, np.cumsum(lens)[:-1]]

        def to_tx(gpos):
            """Genomic 1-based position -> 0-based transcript coordinate."""
            i = np.flatnonzero((s <= gpos) & (gpos <= e))[0]
            return int(before[i] + (gpos - s[i] if strand == "+" else e[i] - gpos))

        cds = d[d.feature == "CDS"]
        stop = d[d.feature == "stop_codon"]
        cds_start = stop_start = np.nan
        if len(cds):
            first = cds["start"].min() if strand == "+" else cds["end"].max()
            cds_start = to_tx(first)
            if len(stop):
                stop_start = to_tx(stop["start"].min() if strand == "+" else stop["end"].max())
            else:  # no annotated stop codon: the CDS ends at the last coding base
                stop_start = to_tx(cds["end"].max() if strand == "+" else cds["start"].min()) + 1
        out.append((tx, d["gene_id"].iat[0], d["biotype"].iat[0], int(lens.sum()), cds_start, stop_start,
                    ";".join(map(str, np.cumsum(lens)[:-1]))))
    return pd.DataFrame(out, columns=["transcript_id", "gene_id", "biotype", "tx_len", "cds_start",
                                      "stop_start", "exon_ends"])


_TABLES: dict = {}


def load_transcript_table(path: str | Path = DEFAULT_TABLE) -> pd.DataFrame:
    """Cached, so models in one ensemble share one table object (saved once in the joblib file)."""
    key = str(Path(path).resolve())
    if key not in _TABLES:
        _TABLES[key] = pd.read_csv(path, keep_default_na=True, dtype={"exon_ends": str})
    return _TABLES[key]


def annotation_features(sites: pd.DataFrame, table: pd.DataFrame) -> pd.DataFrame:
    """ANNOT_COLS for each site (NaN where the transcript is not annotated)."""
    t = sites[["transcript_id", "transcript_position"]].merge(table, on="transcript_id", how="left")
    pos = t["transcript_position"].to_numpy(float)
    L = t["tx_len"].to_numpy(float)
    cs, ss = t["cds_start"].to_numpy(float), t["stop_start"].to_numpy(float)
    coding = ~np.isnan(cs)
    region = np.where(~coding, np.nan, np.where(pos < cs, 0, np.where(pos < ss, 1, 2)))  # 5'UTR / CDS / 3'UTR
    utr5, cds_len, utr3 = cs, ss - cs, L - ss
    rel = np.select([region == 0, region == 1, region == 2],
                    [pos / np.maximum(utr5, 1), (pos - cs) / np.maximum(cds_len, 1),
                     (pos - ss) / np.maximum(utr3, 1)], np.nan)

    n = len(t)
    dj = np.full(n, np.nan); last = np.full(n, np.nan); elen = np.full(n, np.nan)
    erel = np.full(n, np.nan); nex = np.full(n, np.nan)
    for i, (p, l, ends) in enumerate(zip(pos, L, t["exon_ends"].to_numpy())):
        if np.isnan(l):
            continue
        b = np.array([int(x) for x in ends.split(";")]) if isinstance(ends, str) and ends else np.array([], int)
        bounds = np.r_[0, b, l]
        k = np.searchsorted(b, p, side="right")         # exon index containing p
        dj[i] = np.min(np.abs(b - p)) if len(b) else 1e5
        last[i] = float(k == len(b))
        elen[i] = bounds[k + 1] - bounds[k]
        erel[i] = (p - bounds[k]) / max(elen[i], 1)
        nex[i] = len(b) + 1

    known = ~np.isnan(L)
    return pd.DataFrame({
        "ann_known": known.astype(np.float32),
        "ann_coding": np.where(known, coding, np.nan),
        "ann_log_tx_len": np.log10(L),
        "ann_rel_pos": pos / L,
        "ann_region": region,
        "ann_region_rel": rel,
        "ann_dist_start": pos - cs,
        "ann_dist_stop": pos - ss,
        "ann_log_utr5": np.log10(utr5 + 1),
        "ann_log_cds": np.log10(cds_len + 1),
        "ann_log_utr3": np.log10(utr3 + 1),
        "ann_dist_junction": dj,
        "ann_in_last_exon": last,
        "ann_log_exon_len": np.log10(elen),
        "ann_exon_rel": erel,
        "ann_n_exons": nex,
    }, index=sites.index).astype(np.float32)
