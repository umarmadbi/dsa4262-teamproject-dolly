"""Build the derived data behind the dashboard's Landscape, calibration and limitation views.

Usage (from the repo root, after scripts/build_viz_data.py):
    python scripts/build_viz_insights.py \
        --labels-d0 data/data0/data.info.labelled --labels-d1 data/data1/data.info

Reads only files that are already in the repo: the per-run site files in viz/site/data/ (Dolly v2 scores,
reads and 7-mer for every SG-NEx site with >= 20 reads) and resources/ensembl91_transcripts.csv.gz.
The two label files are optional; without them the calibration block of an existing insights.json is kept.

Writes to viz/site/data/:
  insights.json     summary statistics for the Overview / Landscape / Compare views (small, loaded on demand)
  transcripts.json  transcript structure (length, CDS start, stop codon, exon junctions) for the transcript map
  atlas.json        high-confidence site atlas: robustly called sites and sites called in all seven cell lines
  cell_lines.json   rebuilt from the run files, without runs listed in --exclude-from-summaries,
                    plus the matching cell-line entries of manifest.json

Every number here is described in docs/sgnex_task2_findings.md. Known dataset limitation:
SGNex_MCF7_directRNA_replicate3_run1 uses versioned transcript IDs (ENST...N), so predict.py found no
Ensembl annotation for it and v2 scored all of its sites with its v1-style fallback model (no
transcript-structure features). The run is kept and flagged, but excluded from every cross-run or
cross-cell-line summary (--exclude-from-summaries).
"""
import argparse
import itertools
import json
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from build_viz_data import build_cell_lines, site_stats  # noqa: E402

RUN_ID = re.compile(r"^SGNex_(?P<cell>[^_]+)_directRNA_replicate(?P<rep>\d+)_run(?P<run>\d+)$")
THRESHOLDS = [round(0.1 * i, 1) for i in range(1, 10)]
CALL = 0.5
META_BINS = 60                      # 20 bins each for 5'UTR, CDS, 3'UTR
STOP_EDGES = list(range(-1000, 1501, 50))
JUNCTION_EDGES = [0, 25, 50, 75, 100, 150, 200, 300, 400, 500, 750, 1000, 2000, 10**9]
NRUN_BINS = [(1, 2), (3, 5), (6, 10), (11, 15), (16, 20), (21, 23)]
DRACH = re.compile(r"^[AGT][AG]AC[ACT]$")

LIMITATIONS = {
    "v1Fallback": ("Scored without transcript-structure features. This run's transcript IDs carry version suffixes, "
                   "so no Ensembl 91 annotation was found and Dolly v2 used its fallback model (equivalent to v1). "
                   "Its scores are not comparable with the other runs, so it is excluded from cell-line summaries "
                   "and cross-run statistics. Kept for transparency."),
    "trainingOverlap": ("Possible overlap with the training data. On dataset0-labelled sites this run scores far "
                        "higher than the other Hct116 runs (PR AUC 0.88 vs 0.71), consistent with the training reads "
                        "coming from this run. Treat its scores on training genes as in-sample."),
}

# Dolly v2 vs m6Anet on the 23 SG-NEx runs: experiment 12 (experiments/12_sgnex_m6anet_compare.py,
# docs/sgnex_task2.md). The per-site m6Anet outputs live on the AWS machine, so these are its reported numbers.
M6ANET = {
    "source": "experiments/12_sgnex_m6anet_compare.py (docs/sgnex_task2.md, 16 Oct 2026); 2,973,155 site observations",
    "thresholds": {"dolly": 0.5, "m6anet": 0.9},
    "agreement": {"spearman": 0.637, "jaccard": 0.489, "topK": 0.655, "callRateRange": [1.8, 4.3],
                  "v1RunSpearman": 0.784},
    "regions": [
        {"set": "All sites", "utr5": 2.4, "cds": 51.6, "utr3": 40.5, "nearStop": 21.7},
        {"set": "Dolly v2 calls", "utr5": 2.1, "cds": 38.8, "utr3": 51.9, "nearStop": 44.2},
        {"set": "m6Anet calls", "utr5": 1.5, "cds": 29.0, "utr3": 64.2, "nearStop": 41.9},
        {"set": "Called by both", "utr5": 1.8, "cds": 33.6, "utr3": 58.6, "nearStop": 44.5},
    ],
    "motifs": [{"kmer": "GGACT", "dolly": 6.6, "m6anet": 7.4}],
    "depthR": {"dolly": 0.76, "m6anet": 0.85},
    "reproducibility": {"spearman": {"dolly": [0.936, 0.931], "m6anet": [0.911, 0.907]},
                        "jaccard": {"dolly": [0.674, 0.642], "m6anet": [0.696, 0.647]}},
    "benchmark": [
        {"set": "dataset0 held-out genes", "m6anet": [0.932, 0.485], "dolly": [0.952, 0.561]},
        {"set": "dataset1 unseen genes", "m6anet": [0.839, 0.334], "dolly": [0.881, 0.421]},
    ],
}


def short(run):
    m = RUN_ID.match(run)
    return f"{m['cell']} r{m['rep']}.{m['run']}"


def load_runs(site, manifest):
    frames = []
    for d in manifest["datasets"]:
        if d["group"] != "sgnex":
            continue
        data = json.loads((site / d["dataFile"]).read_text())
        s = np.array([[x[0], x[1], x[2], x[3]] for x in data["sites"]], dtype=np.int64)
        score = np.array([x[5] for x in data["sites"]], dtype=float)
        tg = np.array(data["transcriptGenes"])[s[:, 0]]
        genes = np.array(data["genes"] + [""], dtype=object)
        m = RUN_ID.match(d["id"])
        frames.append(pd.DataFrame({
            "run": d["id"], "cell": m["cell"], "rep": int(m["rep"]), "runno": int(m["run"]),
            "tx_full": np.array(data["transcripts"], dtype=object)[s[:, 0]], "pos": s[:, 1], "n_reads": s[:, 2],
            "kmer7": np.array(data["sequences"], dtype=object)[s[:, 3]], "gene": genes[tg], "score": score}))
    df = pd.concat(frames, ignore_index=True)
    df["tx"] = df.tx_full.str.split(".").str[0]
    df["kmer5"] = df.kmer7.str[1:6]
    return df


def annotate(df, table):
    t = table.rename(columns={"transcript_id": "tx"})
    s = df[["tx", "pos"]].merge(t, on="tx", how="left")
    p, cs, ss, L = (s[c].to_numpy(float) for c in ["pos", "cds_start", "stop_start", "tx_len"])
    coding = ~np.isnan(cs) & ~np.isnan(ss) & (cs > 0) & (ss + 3 < L)
    df["region"] = np.select([np.isnan(L), ~coding, p < cs, p < ss + 3], ["unannotated", "non-coding", "5'UTR", "CDS"], "3'UTR")
    with np.errstate(divide="ignore", invalid="ignore"):
        meta = np.select([p < cs, p < ss + 3], [p / cs, 1 + (p - cs) / (ss + 3 - cs)], 2 + (p - ss - 3) / (L - ss - 3))
    meta[~coding] = np.nan
    df["meta"] = meta
    df["dist_stop"] = np.where(coding, p - ss, np.nan)
    dj, last = np.full(len(s), np.nan), np.zeros(len(s), bool)
    cache = {}
    for i, (e, pos, length) in enumerate(zip(s.exon_ends.to_numpy(), p, L)):
        if isinstance(e, str) and e:
            b = cache.get(e)
            if b is None:
                b = cache[e] = np.array([int(x) for x in e.split(";")])
            dj[i] = np.abs(b - pos).min()
            last[i] = pos >= b[-1]
        elif not np.isnan(length):
            dj[i], last[i] = 1e5, True
    df["dist_junction"], df["last_exon"] = dj, last
    return df


def calls_at(scores):
    """Calls at every threshold: list of 9 ints."""
    return [int((scores >= t).sum()) for t in THRESHOLDS]


def binned(values, scores, edges):
    idx = np.digitize(values, edges) - 1
    ok = (idx >= 0) & (idx < len(edges) - 1) & ~np.isnan(values)
    n = np.bincount(idx[ok], minlength=len(edges) - 1)
    calls = [np.bincount(idx[ok & (scores >= t)], minlength=len(edges) - 1) for t in THRESHOLDS]
    return {"n": n.tolist(), "calls": [c.tolist() for c in calls]}


def by_cell(clean, fn):
    out = {"All": fn(clean)}
    for cell, g in clean.groupby("cell"):
        out[cell] = fn(g)
    return out


def landscape(clean, shared_keys):
    shared = clean.set_index(["tx", "pos"]).index.isin(shared_keys)
    meta_edges = np.linspace(0, 3, META_BINS + 1)
    meta_edges[-1] += 1e-9

    def profile(g):
        sc, out = g.score.to_numpy(), {}
        out["metagene"] = binned(g.meta.to_numpy(float), sc, meta_edges)
        out["stop"] = binned(g.dist_stop.to_numpy(float), sc, np.array(STOP_EDGES, float))
        out["junction"] = binned(g.dist_junction.to_numpy(float), sc, np.array(JUNCTION_EDGES, float))
        out["lastExon"] = {k: {"n": int(len(x)), "calls": calls_at(x.score)} for k, x in
                           (("last", g[g.last_exon]), ("other", g[~g.last_exon]))}
        out["regions"] = {r: {"n": int(len(x)), "calls": calls_at(x.score)} for r, x in g.groupby("region")}
        return out

    return {"all": by_cell(clean, profile), "shared": by_cell(clean[shared], profile)}


def motifs(clean):
    kmers = sorted(clean.kmer5.unique())

    def fn(g):
        out = {"n": [], "calls": [[] for _ in THRESHOLDS]}
        grouped = dict(tuple(g.groupby("kmer5")))
        for k in kmers:
            x = grouped.get(k)
            out["n"].append(0 if x is None else int(len(x)))
            for i, t in enumerate(THRESHOLDS):
                out["calls"][i].append(0 if x is None else int((x.score >= t).sum()))
        return out

    return {"kmers": kmers, "drach": all(DRACH.match(k) for k in kmers), "byCell": by_cell(clean, fn)}


def expression(clean):
    nruns = clean.groupby(["tx", "pos"]).run.transform("nunique").to_numpy()
    rows = []
    for lo, hi in NRUN_BINS:
        m = (nruns >= lo) & (nruns <= hi)
        g = clean[m]
        rows.append({"label": f"{lo}–{hi}" if lo != hi else str(lo), "n": int(m.sum()),
                     "medianReads": float(np.median(g.n_reads)) if len(g) else None, "calls": calls_at(g.score)})
    return {"maxRuns": int(clean.run.nunique()), "bins": rows}


def run_pairs(df, runs, meta):
    by = {r: g.set_index(["tx", "pos"])[["score", "n_reads"]] for r, g in df.groupby("run")}
    out = []
    for a, b in itertools.combinations(runs, 2):
        j = by[a].join(by[b], how="inner", lsuffix="1", rsuffix="2")
        j40 = j[(j.n_reads1 >= 40) & (j.n_reads2 >= 40)]
        ca, cb = meta[a], meta[b]
        rel = "rerun" if ca[:2] == cb[:2] else "replicate" if ca[0] == cb[0] else "cellLine"
        row = {"a": a, "b": b, "rel": rel, "shared": int(len(j))}
        for suffix, x in (("", j), ("40", j40)):
            if len(x) < 500:
                row["spearman" + suffix] = row["jaccard" + suffix] = None
                continue
            c1, c2 = x.score1 >= CALL, x.score2 >= CALL
            row["spearman" + suffix] = round(float(spearmanr(x.score1, x.score2).statistic), 4)
            row["jaccard" + suffix] = round(float((c1 & c2).sum() / max(1, (c1 | c2).sum())), 4)
        out.append(row)
    return out


def variance(clean):
    c = clean[clean.groupby(["tx", "pos", "cell"]).score.transform("size") >= 2]
    c = c[c.groupby(["tx", "pos"]).cell.transform("nunique") >= 2]
    y, gm = c.score, c.score.mean()
    sm = c.groupby(["tx", "pos"]).score.transform("mean")
    cm = c.groupby(["tx", "pos", "cell"]).score.transform("mean")
    ss = [((sm - gm) ** 2).sum(), ((cm - sm) ** 2).sum(), ((y - cm) ** 2).sum()]
    tot = sum(ss)
    return {"sites": int(c[["tx", "pos"]].drop_duplicates().shape[0]), "observations": int(len(c)),
            "site": round(ss[0] / tot, 4), "siteByCell": round(ss[1] / tot, 4), "run": round(ss[2] / tot, 4)}


def differential(clean, permutations, seed=1):
    """Sites whose runs separate two cell lines (every run of A above every run of B), against a null in
    which run labels are shuffled between cell lines (group sizes kept). Cell lines need >= 2 runs; cell lines
    with a single usable run (MCF7 after the exclusion) cannot show run-level separation, so they are dropped
    before shuffling and do not dilute the null."""
    per_line = clean.groupby("cell").run.nunique()
    base = clean[clean.cell.isin(per_line[per_line >= 2].index)][["run", "cell", "tx", "pos", "score"]]
    runs = base.groupby("run").cell.first()
    levels = [("strict", None), ("0.4", 0.4), ("0.3", 0.3), ("0.2", 0.2)]

    def candidates(cmap):
        x = base.assign(cl=base.run.map(cmap))
        g = x.groupby(["tx", "pos", "cl"]).score.agg(["min", "max", "mean", "size"]).reset_index()
        g = g[g["size"] >= 2]
        m = g.merge(g, on=["tx", "pos"], suffixes=("_a", "_b"))
        m = m[(m.cl_a != m.cl_b) & (m.min_a > m.max_b) & (m.mean_a >= CALL)]
        m["delta"] = m.mean_a - m.mean_b
        m["strict"] = (m.min_a >= CALL) & (m.max_b < 0.1)
        return m

    def counts(m):
        out = {}
        for name, d in levels:
            sel = m[m.strict] if d is None else m[m.delta >= d]
            out[name] = int(sel[["tx", "pos"]].drop_duplicates().shape[0])
        return out

    obs = candidates(runs.to_dict())
    rng = np.random.default_rng(seed)
    null = [counts(candidates(dict(zip(runs.index, rng.permutation(runs.values))))) for _ in range(permutations)]
    observed = counts(obs)
    table = []
    for name, d in levels:
        nl = [n[name] for n in null]
        se = float(np.std(nl, ddof=1) / np.sqrt(len(nl))) if len(nl) > 1 else 0.0  # Monte Carlo error of the null mean
        table.append({"level": name, "minDelta": d, "observed": observed[name], "nullMean": round(float(np.mean(nl)), 1),
                      "nullSd": round(float(np.std(nl, ddof=1)), 1) if len(nl) > 1 else 0.0, "nullMax": int(max(nl)),
                      "fdr": round(float(np.mean(nl)) / max(1, observed[name]), 3),
                      "fdrSe": round(se / max(1, observed[name]), 3)})
    keep = obs[obs.delta >= 0.2]
    info = clean.drop_duplicates(["tx", "pos"]).set_index(["tx", "pos"])[["gene", "kmer7", "region"]]
    keep = keep.join(info, on=["tx", "pos"]).sort_values("delta", ascending=False)
    cols = ["tx", "pos", "gene", "kmer7", "region", "cl_a", "mean_a", "min_a", "size_a", "cl_b", "mean_b", "max_b",
            "size_b", "delta", "strict"]
    rows = [[r.tx, int(r.pos), r.gene, r.kmer7, r.region, r.cl_a, round(r.mean_a, 4), round(r["min_a"], 4),
             int(r.size_a), r.cl_b, round(r.mean_b, 4), round(r["max_b"], 4), int(r.size_b), round(r.delta, 4),
             bool(r.strict)] for _, r in keep.iterrows()]
    return {"permutations": permutations, "fdr": table, "columns": cols, "rows": rows,
            "cellLines": sorted(runs.unique().tolist())}


def calibration(df, d0_path, d1_path, ann, excluded):
    from sklearn.metrics import average_precision_score, roc_auc_score
    d0 = pd.read_csv(d0_path)
    d1 = pd.read_csv(d1_path).merge(ann[["transcript_id", "gene_id"]], on="transcript_id", how="left")
    held = d1[~d1.transcript_id.isin(set(d0.transcript_id)) & ~d1.gene_id.isin(set(d0.gene_id))]
    lab = held.rename(columns={"transcript_id": "tx", "transcript_position": "pos"})[["tx", "pos", "label"]]
    j = df.merge(lab, on=["tx", "pos"])
    runs = []
    for (run, cell), g in j.groupby(["run", "cell"]):
        runs.append({"run": run, "cell": cell, "n": int(len(g)), "positives": int(g.label.sum()),
                     "base": round(float(g.label.mean()), 4), "roc": round(float(roc_auc_score(g.label, g.score)), 4),
                     "pr": round(float(average_precision_score(g.label, g.score)), 4), "excluded": run in excluded})
    c = j[~j.run.isin(excluded)]
    edges = [0, .05, .1, .2, .3, .5, .7, .9, 1.0001]
    bins = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        g = c[(c.score >= lo) & (c.score < hi)]
        bins.append({"lo": lo, "hi": min(hi, 1), "n": int(len(g)), "positiveRate": round(float(g.label.mean()), 4),
                     "meanScore": round(float(g.score.mean()), 4)})
    thr = []
    for t in THRESHOLDS:
        m = c.score >= t
        thr.append({"t": t, "callRate": round(float(m.mean()), 4), "precision": round(float(c.label[m].mean()), 4),
                    "recall": round(float(m[c.label == 1].mean()), 4)})
    per_cell = []
    r = pd.DataFrame(runs)
    for cell, g in r[~r.excluded].groupby("cell"):
        per_cell.append({"cell": cell, "runs": int(len(g)), "n": int(g.n.sum()), "roc": round(float(g.roc.median()), 4),
                         "pr": round(float(g.pr.median()), 4), "prOverBase": round(float((g.pr / g.base).median()), 2)})
    return {"source": "dataset1 sites whose transcript and gene are absent from dataset0 (HCT116 m6ACE-seq labels), "
                      "matched to SG-NEx sites by transcript and position",
            "sites": int(len(held)), "genes": int(held.gene_id.nunique()), "observations": int(len(c)),
            "positiveRate": round(float(c.label.mean()), 4), "bins": bins, "thresholds": thr, "runs": runs,
            "cells": per_cell, "medianRoc": round(float(r[~r.excluded].roc.median()), 4),
            "medianPr": round(float(r[~r.excluded].pr.median()), 4)}


def atlas(clean, cells):
    site = clean.groupby(["tx", "pos"]).agg(gene=("gene", "first"), kmer7=("kmer7", "first"), region=("region", "first"),
                                            dist_stop=("dist_stop", "first"), nruns=("run", "nunique"),
                                            ncalls=("score", lambda s: int((s >= CALL).sum())), maxs=("score", "max"))
    means = clean.groupby(["tx", "pos", "cell"]).score.mean().unstack()
    site = site.join(means)
    site["robust"] = (site.ncalls >= 2) & (site.ncalls / site.nruns >= 0.5)
    measured = site[cells].notna().sum(axis=1)
    called = (site[cells] >= CALL).sum(axis=1)
    site["all7"] = (measured == len(cells)) & (called == len(cells))
    keep = site[site.robust | site.all7].sort_values("maxs", ascending=False).reset_index()
    rows = []
    for r in keep.itertuples(index=False):
        d = r._asdict()
        rows.append([d["tx"], int(d["pos"]), d["gene"], d["kmer7"], d["region"],
                     None if np.isnan(d["dist_stop"]) else int(d["dist_stop"]), int(d["nruns"]), int(d["ncalls"]),
                     [None if pd.isna(d[c]) else round(float(d[c]), 4) for c in cells], bool(d["all7"])])
    return {"cellLines": cells, "callThreshold": CALL,
            "definition": {"robust": "called (score >= 0.5) in at least 2 runs and in at least half of the runs that measured it",
                           "all7": "measured in all 7 cell lines and the cell-line mean score is >= 0.5 in every one"},
            "columns": ["tx", "pos", "gene", "kmer7", "region", "distStop", "runs", "calls", "cellMeans", "all7"],
            "rows": rows, "robust": int(keep.robust.sum()), "all7": int(keep.all7.sum()),
            "genes": int(keep[keep.robust].gene.nunique())}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--site", default=str(ROOT / "viz" / "site"))
    ap.add_argument("--annotation", default=str(ROOT / "resources" / "ensembl91_transcripts.csv.gz"))
    ap.add_argument("--labels-d0", help="dataset0 data.info.labelled (gene_id, transcript_id, position, label)")
    ap.add_argument("--labels-d1", help="dataset1 data.info (transcript_id, position, n_reads, label)")
    ap.add_argument("--exclude-from-summaries", nargs="*", default=["SGNex_MCF7_directRNA_replicate3_run1"],
                    help="runs kept in the dashboard but left out of every cross-run summary (flagged v1Fallback)")
    ap.add_argument("--training-overlap", nargs="*", default=["SGNex_Hct116_directRNA_replicate3_run1"])
    ap.add_argument("--permutations", type=int, default=50,
                    help="label shuffles for the differential-site null (50 keeps the FDR estimate stable to ~1%%)")
    ap.add_argument("--cell-line-min-score", type=float, default=0.5)
    a = ap.parse_args()

    site = Path(a.site)
    manifest_path = site / "data" / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    table = pd.read_csv(a.annotation, dtype={"exon_ends": str})
    excluded = set(a.exclude_from_summaries)

    print("loading runs…", flush=True)
    df = annotate(load_runs(site, manifest), table)
    runs = sorted(df.run.unique())
    meta = {r: (RUN_ID.match(r)["cell"], RUN_ID.match(r)["rep"], RUN_ID.match(r)["run"]) for r in runs}
    clean = df[~df.run.isin(excluded)].copy()
    cells = sorted(clean.cell.unique())

    # Cell-line summaries without the excluded runs (rebuilt from the run files, same rules as build_viz_data.py).
    acc, runs_per_line = {}, {}
    for run, g in clean.groupby("run"):
        cell = meta[run][0]
        runs_per_line[cell] = runs_per_line.get(cell, 0) + 1
        for tx, pos, n, seq, gene, score in zip(g.tx_full, g.pos, g.n_reads, g.kmer7, g.gene, g.score):
            s = acc.setdefault((tx, int(pos)), {"seq": seq, "gene": gene, "lines": {}})
            tot = s["lines"].setdefault(cell, [0.0, 0, 0])
            tot[0] += score
            tot[1] += int(n)
            tot[2] += 1
    summary, line_rows = build_cell_lines(acc, runs_per_line, a.cell_line_min_score)
    (site / "data" / "cell_lines.json").write_text(json.dumps(summary, separators=(",", ":")))
    for d in manifest["datasets"]:
        if d["group"] == "sgnex":
            flags = [k for k, ids in (("v1Fallback", excluded), ("trainingOverlap", set(a.training_overlap))) if d["id"] in ids]
            if flags:
                d["limitations"] = flags
            else:
                d.pop("limitations", None)
        if d["group"] != "cellline":
            continue
        c, n = d["cellLine"], runs_per_line[d["cellLine"]]
        dropped = [r for r in excluded if meta.get(r, ("",))[0] == c]
        d.update(name=f"{c} · mean of {n} run{'s' if n > 1 else ''}", runs=n, rows=len(line_rows[c]),
                 stats=site_stats(line_rows[c]))
        d["description"] = (f"Mean Dolly v2 score and mean reads across the {n} {c} run(s) that measured each site, for "
                            f"sites whose mean score reaches {a.cell_line_min_score} in at least one cell line."
                            + (f" Excludes {', '.join(short(r) for r in dropped)} (scored without transcript-structure "
                               "features; see Known limitations)." if dropped else ""))
        if dropped:
            d["excludedRuns"] = dropped
        else:
            d.pop("excludedRuns", None)
    manifest["limitations"] = LIMITATIONS
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"cell_lines.json: {len(summary['sites']):,} sites; excluded {sorted(excluded)}", flush=True)

    # Sites measured (>= 20 reads) in all seven cell lines: the fair basis for cell-line comparisons.
    per_cell = clean.groupby(["tx", "pos"]).cell.nunique()
    shared_keys = per_cell[per_cell == len(cells)].index
    shared_mask_all = df.set_index(["tx", "pos"]).index.isin(shared_keys)
    df["shared"] = shared_mask_all
    # Sites measured in every run used for summaries: an identical site set for every run.
    per_run_n = clean.groupby(["tx", "pos"]).run.nunique()
    common_keys = per_run_n[per_run_n == clean.run.nunique()].index
    df["common"] = df.set_index(["tx", "pos"]).index.isin(common_keys)
    clean = df[~df.run.isin(excluded)]

    per_run = []
    for run, g in df.groupby("run"):
        sh = g[g.shared]
        cm = g[g.common]
        per_run.append({"id": run, "cell": meta[run][0], "sites": int(len(g)), "calls": calls_at(g.score),
                        "sharedSites": int(len(sh)), "sharedCalls": calls_at(sh.score),
                        "commonSites": int(len(cm)), "commonCalls": calls_at(cm.score),
                        "limitations": [k for k, ids in (("v1Fallback", excluded), ("trainingOverlap", set(a.training_overlap)))
                                        if run in ids]})
    sh = clean[clean.shared]
    means = sh.groupby(["tx", "pos", "cell"]).score.mean().unstack()[cells]
    cell_corr = means.corr(method="spearman").round(4).values.tolist()
    shared_rates = {c: {"sites": int(means[c].notna().sum()), "callRate": calls_at(means[c])} for c in cells}

    print("landscape, motifs, expression…", flush=True)
    ins = {
        "generatedBy": "scripts/build_viz_insights.py", "thresholds": THRESHOLDS, "callThreshold": CALL,
        "excludedRuns": sorted(excluded), "trainingOverlapRuns": sorted(a.training_overlap), "cellLines": cells,
        "limitations": LIMITATIONS,
        "totals": {"observations": int(len(df)), "cleanObservations": int(len(clean)),
                   "uniqueSites": int(clean[["tx", "pos"]].drop_duplicates().shape[0]),
                   "sharedSites": int(len(shared_keys)), "commonSites": int(len(common_keys))},
        "perRun": per_run,
        "sharedCellLines": {"sites": int(len(shared_keys)), "callRates": shared_rates,
                            "spearman": cell_corr},
        "bins": {"metagene": META_BINS, "stop": STOP_EDGES, "junction": JUNCTION_EDGES},
        "landscape": landscape(clean, shared_keys),
        "motifs": motifs(clean),
        "expression": expression(clean),
        "variance": variance(clean),
        "m6anet": M6ANET,
    }
    print("run pairs…", flush=True)
    ins["pairs"] = run_pairs(df, runs, meta)
    print("differential sites + permutation null…", flush=True)
    ins["differential"] = differential(clean, a.permutations)

    out = site / "data" / "insights.json"
    if a.labels_d0 and a.labels_d1:
        print("calibration…", flush=True)
        ins["calibration"] = calibration(df, a.labels_d0, a.labels_d1, table, excluded)
    elif out.exists() and "calibration" in json.loads(out.read_text()):
        ins["calibration"] = json.loads(out.read_text())["calibration"]
        print("calibration: kept from the existing insights.json (no label files given)")
    out.write_text(json.dumps(ins, separators=(",", ":")))
    print(f"wrote {out} ({out.stat().st_size / 1e6:.2f} MB)")

    print("atlas, transcripts…", flush=True)
    at = atlas(clean, cells)
    (site / "data" / "atlas.json").write_text(json.dumps(at, separators=(",", ":")))
    txs = sorted(df.tx.unique())
    t = table.set_index("transcript_id")
    t = t[t.index.isin(txs)]
    tx_out = {"columns": ["length", "cdsStart", "stopStart", "exonEnds", "gene", "biotype"],
              "transcripts": {i: [int(r.tx_len), None if pd.isna(r.cds_start) else int(r.cds_start),
                                  None if pd.isna(r.stop_start) else int(r.stop_start),
                                  [int(x) for x in r.exon_ends.split(";")] if isinstance(r.exon_ends, str) and r.exon_ends else [],
                                  r.gene_id, r.biotype] for i, r in t.iterrows()}}
    (site / "data" / "transcripts.json").write_text(json.dumps(tx_out, separators=(",", ":")))
    print(f"atlas: {at['robust']:,} robust sites, {at['all7']:,} called in all 7 lines; "
          f"transcripts.json: {len(tx_out['transcripts']):,} transcripts")


if __name__ == "__main__":
    main()
