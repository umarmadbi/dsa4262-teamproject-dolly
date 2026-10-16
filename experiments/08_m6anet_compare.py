"""Benchmark: pretrained m6Anet vs our final model, on the same held-out sites.

Run 07_m6anet_run.sh first (m6Anet env), then this script (main env).
The final model and 5-mer baseline are retrained on the training 80% of dataset0 genes exactly
as in 05_final_eval.py, so their scores match the frozen test results; m6Anet is used as shipped.
Same test sets and gene-level paired bootstrap as 05_final_eval.py, reference = m6Anet.
Outputs: results/m6anet_test_metrics.csv, results/m6anet_d2_spearman.csv,
         results/preds_m6anet_*.parquet, docs/figures/m6anet_comparison.png
"""
import time

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.base import clone
from sklearn.metrics import precision_recall_curve, roc_curve

from common import CACHE, RESULTS, ROOT, load_d0, load_d1_unseen
from m6a.evaluation import bootstrap_auc
from m6a.features import load_reads
from m6a.io import KEY
from m6a.models import ReadStackModel, candidate_models

d0 = load_d0(); d0["row"] = np.arange(len(d0))
d1, unseen = load_d1_unseen(d0); d1["row"] = np.arange(len(d1))
d2 = pd.read_parquet(CACHE / "d2.parquet"); d2["row"] = np.arange(len(d2))
R0, O0 = load_reads(CACHE / "d0_reads.npz")
R1, O1 = load_reads(CACHE / "d1_reads.npz")
R2, O2 = load_reads(CACHE / "d2_reads.npz")
tr, te = d0[~d0.is_test].reset_index(drop=True), d0[d0.is_test].reset_index(drop=True)
d1u = d1[unseen].reset_index(drop=True)
sets = {"d0_test": te, "d1_unseen": d1u, "d2": d2}


def m6anet_scores(name, sites):
    """m6Anet site probabilities aligned to `sites`; sites m6Anet skipped (<20 reads) get 0."""
    m = pd.read_csv(CACHE / "m6anet" / f"{name}_out" / "data.site_proba.csv")
    s = sites[KEY].merge(m[KEY + ["probability_modified"]], on=KEY, how="left")["probability_modified"]
    print(f"m6Anet {name}: {s.notna().sum():,} / {len(s):,} sites scored", flush=True)
    return s.fillna(0).to_numpy()


preds = {ds: {"m6anet": m6anet_scores(ds[:2], s)} for ds, s in sets.items()}

t = time.time()
kp = clone(candidate_models()["kmer_prior"]).fit(tr, tr.label)
m = ReadStackModel(neighbours=True).fit(tr, R0, O0)
for ds, s, R, O in [("d0_test", te, R0, O0), ("d1_unseen", d1, R1, O1), ("d2", d2, R2, O2)]:
    p_kp, p_fm = kp.predict_proba(s)[:, 1], m.predict_proba(s, R, O)   # d1 scored as a whole run
    if ds == "d1_unseen":
        p_kp, p_fm = p_kp[unseen], p_fm[unseen]
    preds[ds]["kmer_prior"], preds[ds]["final_model"] = p_kp, p_fm
print(f"final model trained and scored ({time.time()-t:.0f}s)", flush=True)

# --- ROC / PR AUC with gene-level bootstrap CIs; differences are vs m6Anet
out = []
for ds in ["d0_test", "d1_unseen"]:
    s = sets[ds]
    r = bootstrap_auc(s.label, preds[ds], s.gene_id, n_boot=1000, reference="m6anet")
    r.insert(0, "dataset", ds)
    out.append(r)
    pd.DataFrame({**{k: s[k] for k in KEY + ["label"]}, **preds[ds]}).to_parquet(
        RESULTS / f"preds_m6anet_{ds}.parquet")
res = pd.concat(out)
res.to_csv(RESULTS / "m6anet_test_metrics.csv", index=False)
pd.set_option("display.width", 200)
print(res[["dataset", "model", "roc_auc", "roc_lo", "roc_hi", "pr_auc", "pr_lo", "pr_hi",
           "droc_vs_m6anet", "droc_lo", "droc_hi", "dpr_vs_m6anet", "dpr_lo", "dpr_hi"]].round(3).to_string(index=False))

# --- dataset2: does the score follow the known modification fraction?
rows = []
for name, p in preds["d2"].items():
    w = pd.DataFrame({"k": d2.k5, "y": d2.label, "p": p}).groupby("k").apply(
        lambda g: spearmanr(g.y, g.p).statistic if g.y.nunique() > 1 and g.p.nunique() > 1 and len(g) > 5 else np.nan)
    rows.append({"model": name, "spearman": spearmanr(d2.label, p).statistic,
                 "within_kmer_spearman_median": np.nanmedian(w)})
d2r = pd.DataFrame(rows); d2r.to_csv(RESULTS / "m6anet_d2_spearman.csv", index=False)
print(d2r.round(3).to_string(index=False))
pd.DataFrame({**{k: d2[k] for k in KEY}, "fraction": d2.label, **preds["d2"]}).to_parquet(
    RESULTS / "preds_m6anet_d2.parquet")

# --- figure: PR curves on both test sets + dataset2 dose-response
MODELS = [("kmer_prior", "5-mer prior (baseline)", "#eb6834"),
          ("m6anet", "m6Anet (pretrained HCT116)", "#1baf7a"),
          ("final_model", "Final model", "#2a78d6")]
fig, ax = plt.subplots(1, 3, figsize=(11, 3.6))
for a, ds, title in [(ax[0], "d0_test", "dataset0 held-out genes"), (ax[1], "d1_unseen", "dataset1 unseen transcripts")]:
    y = sets[ds].label.to_numpy()
    for key, lab, c in MODELS:
        pr, rc, _ = precision_recall_curve(y, preds[ds][key])
        auc = res.query("dataset == @ds and model == @key").pr_auc.item()
        a.plot(rc, pr, color=c, lw=2.2 if key == "final_model" else 1.4, label=f"{lab} ({auc:.2f})")
    a.axhline(y.mean(), color="#898781", ls="--", lw=1, label=f"Random ({y.mean():.3f})")
    a.set(title=f"Precision-recall: {title}", xlabel="Recall", ylabel="Precision", xlim=(0, 1), ylim=(0, 1))
    a.legend(title="PR AUC", fontsize=7.5, title_fontsize=8, frameon=False)
for key, lab, c in MODELS[1:]:
    g = pd.Series(preds["d2"][key]).groupby(d2.label.to_numpy()).median()
    ax[2].plot(g.index, g.values, "o-", color=c, label=lab)
ax[2].set(title="dataset2: median score vs true fraction", xlabel="Modification fraction", ylabel="Median score")
ax[2].legend(fontsize=7.5, frameon=False)
fig.tight_layout()
fig.savefig(ROOT / "docs/figures/m6anet_comparison.png", dpi=150)
print("figure -> docs/figures/m6anet_comparison.png")
