"""SG-NEx: Dolly v2 vs pretrained m6Anet on all direct RNA-seq runs (no labels).

Run after scripts/predict.py (results/sgnex_v2/<run>.csv) and m6Anet inference
(results/sgnex_m6anet/<cell>_rep<r>_run<n>/data.site_proba.csv) on every run.
There is no ground truth here, so this measures agreement and plausibility:
  1. per run: score correlation and call overlap at Dolly >= 0.5 and m6Anet >= 0.9
     (on held-out Hct116 genes these call a similar share of sites, 2.9% vs 3.0%,
     see results/threshold_recall_v2_vs_m6anet.csv), plus top-K overlap at equal K
  2. calls by transcript region (metagene) and by DRACH motif, as enrichment over all sites
  3. depth dependence of each method's call rate across runs
  4. reproducibility: agreement of calls (and score correlation) between runs of the same vs
     different cell lines
Sites are those m6Anet scores (>= 20 reads), so both methods see the same sites.
Outputs: results/sgnex_compare_runs.csv, results/sgnex_compare_regions.csv,
         results/sgnex_compare_motifs.csv, results/sgnex_compare_pairs.csv,
         docs/figures/sgnex_m6anet_comparison.png
"""
import argparse
import itertools
import re

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy.stats import pearsonr, spearmanr

from common import RESULTS, ROOT
from m6a.io import KEY

THR = {"dolly": 0.5, "m6anet": 0.9}
NAMES = {"dolly": "Dolly v2 (>= 0.5)", "m6anet": "m6Anet (>= 0.9)"}
RUN = re.compile(r"^SGNex_(?P<cell>[^_]+)_directRNA_replicate(?P<rep>\d+)_run(?P<run>\d+)$")
NEAR_STOP = 200  # nt either side of the stop codon


def short(run):
    m = RUN.match(run)
    return f"{m['cell']}_rep{m['rep']}_run{m['run']}"


def load_run(run):
    dolly = pd.read_csv(RESULTS / "sgnex_v2" / f"{run}.csv")
    m6a = pd.read_csv(RESULTS / "sgnex_m6anet" / short(run) / "data.site_proba.csv",
                      usecols=KEY + ["n_reads", "probability_modified", "kmer"])
    j = m6a.merge(dolly, on=KEY, how="left").rename(columns={"score": "dolly", "probability_modified": "m6anet"})
    if j["dolly"].isna().any():
        raise ValueError(f"{run}: {j['dolly'].isna().sum()} m6Anet sites have no Dolly score")
    j = j[j.transcript_id.str.startswith("ENST")].reset_index(drop=True)  # drop SIRV/ERCC spike-ins
    return j.assign(run=run, cell=RUN.match(run)["cell"])


def regions(sites):
    """Transcript region and metagene coordinate (0-1 5'UTR, 1-2 CDS, 2-3 3'UTR) per site."""
    t = pd.read_csv(ROOT / "resources" / "ensembl91_transcripts.csv.gz",
                    usecols=["transcript_id", "tx_len", "cds_start", "stop_start"])
    s = sites[["transcript_id", "transcript_position"]].assign(transcript_id=sites.transcript_id.str.split(".").str[0])
    s = s.merge(t, on="transcript_id", how="left")
    p, cs, ss, L = (s[c].to_numpy(float) for c in ["transcript_position", "cds_start", "stop_start", "tx_len"])
    coding = ~np.isnan(cs) & ~np.isnan(ss) & (cs > 0) & (ss + 3 < L)
    region = np.select([np.isnan(L), ~coding, p < cs, p < ss + 3], ["unannotated", "non-coding", "5'UTR", "CDS"], "3'UTR")
    with np.errstate(divide="ignore", invalid="ignore"):
        meta = np.select([p < cs, p < ss + 3], [p / cs, 1 + (p - cs) / (ss + 3 - cs)], 2 + (p - ss - 3) / (L - ss - 3))
    meta[~coding] = np.nan
    near = coding & (np.abs(p - ss) <= NEAR_STOP)
    return region, meta, near


ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument("--partial", action="store_true", help="use only runs that already have m6Anet results")
args = ap.parse_args()
runs = sorted(p.stem for p in (RESULTS / "sgnex_v2").glob("SGNex_*.csv"))
missing = [r for r in runs if not (RESULTS / "sgnex_m6anet" / short(r) / "data.site_proba.csv").exists()]
if missing and not args.partial:
    raise SystemExit(f"m6Anet results missing for: {', '.join(missing)}")
runs = [r for r in runs if r not in missing]
all_sites = pd.concat([load_run(r) for r in runs], ignore_index=True)
for m, t in THR.items():
    all_sites[f"call_{m}"] = all_sites[m] >= t
print(f"{len(runs)} runs, {len(all_sites):,} site observations scored by both methods", flush=True)

# --- 1. per-run agreement
rows = []
for run, d in all_sites.groupby("run", sort=False):
    a, b = d.call_dolly, d.call_m6anet
    k = int(b.sum())
    top = lambda col: set(d.nlargest(k, col).index) if k else set()  # noqa: E731
    rows.append({"run": run, "cell": d.cell.iat[0], "sites": len(d),
                 "spearman": spearmanr(d.dolly, d.m6anet).statistic, "pearson": pearsonr(d.dolly, d.m6anet).statistic,
                 "called_dolly": int(a.sum()), "called_m6anet": k, "called_both": int((a & b).sum()),
                 "pct_dolly": 100 * a.mean(), "pct_m6anet": 100 * b.mean(),
                 "jaccard": (a & b).sum() / max(1, (a | b).sum()),
                 "topk_overlap": len(top("dolly") & top("m6anet")) / max(1, k)})
per_run = pd.DataFrame(rows)
per_run.to_csv(RESULTS / "sgnex_compare_runs.csv", index=False)
depth_r = {m: pearsonr(np.log10(per_run.sites), per_run[f"pct_{m}"]).statistic for m in THR}

# --- 2. regions and motifs: share of calls vs share of all sites
region, meta, near = regions(all_sites)
all_sites["region"], all_sites["meta"], all_sites["near_stop"] = region, meta, near
reg_rows = []
for name, mask in [("all sites", np.ones(len(all_sites), bool)), (NAMES["dolly"], all_sites.call_dolly),
                   (NAMES["m6anet"], all_sites.call_m6anet), ("both", all_sites.call_dolly & all_sites.call_m6anet)]:
    d = all_sites[mask]
    shares = d.region.value_counts(normalize=True)
    reg_rows.append({"set": name, "n": len(d), **{r: shares.get(r, 0.0) for r in ["5'UTR", "CDS", "3'UTR", "non-coding", "unannotated"]},
                     "near_stop": d.near_stop.mean()})
reg = pd.DataFrame(reg_rows)
reg.to_csv(RESULTS / "sgnex_compare_regions.csv", index=False)

motif = pd.DataFrame({"all_sites": all_sites.kmer.value_counts(normalize=True),
                      **{f"calls_{m}": all_sites[all_sites[f"call_{m}"]].kmer.value_counts(normalize=True) for m in THR}}).fillna(0)
for m in THR:
    motif[f"enrichment_{m}"] = motif[f"calls_{m}"] / motif["all_sites"]
motif = motif.sort_values("calls_m6anet", ascending=False)
motif.rename_axis("kmer").to_csv(RESULTS / "sgnex_compare_motifs.csv")

# --- 4. reproducibility between runs
pair_rows = []
by_run = {r: d.set_index(KEY)[["dolly", "m6anet", "call_dolly", "call_m6anet"]] for r, d in all_sites.groupby("run")}
for r1, r2 in itertools.combinations(runs, 2):
    j = by_run[r1].join(by_run[r2], how="inner", lsuffix="_1", rsuffix="_2")
    if len(j) < 1000:
        continue
    row = {"run_1": r1, "run_2": r2, "same_cell": RUN.match(r1)["cell"] == RUN.match(r2)["cell"], "shared_sites": len(j)}
    for m in THR:
        a, b = j[f"call_{m}_1"], j[f"call_{m}_2"]
        row[f"spearman_{m}"] = spearmanr(j[f"{m}_1"], j[f"{m}_2"]).statistic
        row[f"jaccard_{m}"] = (a & b).sum() / max(1, (a | b).sum())
    pair_rows.append(row)
pairs = pd.DataFrame(pair_rows)
pairs.to_csv(RESULTS / "sgnex_compare_pairs.csv", index=False)

# --- summary
print("\nPer run (sites scored by both):")
print(per_run[["run", "sites", "spearman", "pct_dolly", "pct_m6anet", "jaccard", "topk_overlap"]].round(3).to_string(index=False))
print(f"\nmedian Spearman {per_run.spearman.median():.3f}; median Jaccard of calls {per_run.jaccard.median():.3f}; "
      f"median top-K overlap {per_run.topk_overlap.median():.3f}")
print(f"call rate vs log10(sites) across runs: r = {depth_r['dolly']:.2f} (Dolly), {depth_r['m6anet']:.2f} (m6Anet)")
print("\nRegions (share of each set):")
print(reg.round(3).to_string(index=False))
print("\nTop motifs among m6Anet calls (share; enrichment over all sites):")
print(motif.head(8).round(3).to_string())
print("\nRun-pair reproducibility (median):")
print(pairs.groupby("same_cell")[[f"{s}_{m}" for s in ("spearman", "jaccard") for m in THR]].median().round(3).to_string())

# --- figure
fig, ax = plt.subplots(2, 2, figsize=(12, 9.5))
a = ax[0, 0]
hb = a.hexbin(all_sites.m6anet, all_sites.dolly, gridsize=60, bins="log", cmap="viridis", mincnt=1)
a.axvline(THR["m6anet"], color="w", ls="--", lw=1); a.axhline(THR["dolly"], color="w", ls="--", lw=1)
a.set(xlabel="m6Anet probability_modified", ylabel="Dolly v2 score",
      title=f"(a) Site scores, all runs (median per-run Spearman {per_run.spearman.median():.2f})")
fig.colorbar(hb, ax=a, label="sites (log)")

a = ax[0, 1]
bins = np.linspace(0, 3, 61)
for name, mask, style in [("all sites", np.ones(len(all_sites), bool), dict(color="0.5", lw=2)),
                          (NAMES["dolly"], all_sites.call_dolly, dict(color="#178c70")),
                          (NAMES["m6anet"], all_sites.call_m6anet, dict(color="#c0632b"))]:
    v = all_sites.meta[mask].dropna()
    h, _ = np.histogram(v, bins=bins, density=True)
    a.plot((bins[1:] + bins[:-1]) / 2, h, label=f"{name} (n={len(v):,})", **style)
for x in (1, 2):
    a.axvline(x, color="0.7", ls=":")
a.set_xticks([0.5, 1.5, 2.5], ["5'UTR", "CDS", "3'UTR"])
a.set(ylabel="density", title="(b) Metagene: called sites vs all sites (coding transcripts)"); a.legend(fontsize=8)

a = ax[1, 0]
for m, c in [("dolly", "#178c70"), ("m6anet", "#c0632b")]:
    a.scatter(per_run.sites, per_run[f"pct_{m}"], color=c, label=f"{NAMES[m]}  r = {depth_r[m]:.2f}")
a.set_xscale("log")
a.set(xlabel="sites with >= 20 reads in the run (depth proxy)", ylabel="% of sites called",
      title="(c) Call rate vs sequencing depth, one point per run"); a.legend(fontsize=8)

a = ax[1, 1]
data, labels = [], []
for m in THR:
    for same in (True, False):
        data.append(pairs.loc[pairs.same_cell == same, f"jaccard_{m}"])
        labels.append(f"{'Dolly' if m == 'dolly' else 'm6Anet'}\n{'same' if same else 'different'} cell line")
a.boxplot(data, tick_labels=labels)
a.set(ylabel="Jaccard of calls at shared sites", title="(d) Run-to-run reproducibility of calls")
fig.tight_layout()
out = ROOT / "docs" / "figures" / "sgnex_m6anet_comparison.png"
fig.savefig(out, dpi=150)
print(f"\nwrote {out}")
