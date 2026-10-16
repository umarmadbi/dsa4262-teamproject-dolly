"""Final, one-shot evaluation on data never used for any modelling decision.

All models are trained on the training 80% of dataset0 genes, then scored on
  * dataset0 held-out 20% of genes (same run, unseen genes)
  * dataset1 transcripts absent from dataset0 (different run)
  * dataset2 (synthetic, label = modification fraction): Spearman correlation
Gene-level bootstrap 95% CIs, paired differences vs the 5-mer baseline.
Also: the full model trained on dataset0-train + dataset1 (does a second run help?).
Outputs: results/final_*.csv, results/preds_*.parquet
"""
import time

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.base import clone

from common import CACHE, RESULTS, load_d0, load_d1_unseen
from m6a.evaluation import bootstrap_auc
from m6a.features import load_reads
from m6a.models import ReadStackModel, candidate_models

d0 = load_d0(); d0["row"] = np.arange(len(d0))
d1, unseen = load_d1_unseen(d0); d1["row"] = np.arange(len(d1))
d2 = pd.read_parquet(CACHE / "d2.parquet"); d2["row"] = np.arange(len(d2))
R0, O0 = load_reads(CACHE / "d0_reads.npz")
R1, O1 = load_reads(CACHE / "d1_reads.npz")
R2, O2 = load_reads(CACHE / "d2_reads.npz")
tr, te = d0[~d0.is_test].reset_index(drop=True), d0[d0.is_test].reset_index(drop=True)
d1u = d1[unseen].reset_index(drop=True)

preds = {"d0_test": {}, "d1_unseen": {}, "d2": {}}
cm = candidate_models()
for name in ["random", "kmer_prior", "logreg", "lightgbm"]:
    t = time.time()
    m = clone(cm[name]).fit(tr, tr.label)
    preds["d0_test"][name] = m.predict_proba(te)[:, 1]
    preds["d1_unseen"][name] = m.predict_proba(d1)[:, 1][unseen]   # d1 scored as a whole run
    preds["d2"][name] = m.predict_proba(d2)[:, 1]
    print(f"{name} done ({time.time()-t:.0f}s)", flush=True)

for name, kw in [("read_stack", dict(neighbours=False)), ("final_model", dict(neighbours=True))]:
    t = time.time()
    m = ReadStackModel(**kw).fit(tr, R0, O0)
    preds["d0_test"][name] = m.predict_proba(te, R0, O0)
    preds["d1_unseen"][name] = m.predict_proba(d1, R1, O1)[unseen]
    preds["d2"][name] = m.predict_proba(d2, R2, O2)
    print(f"{name} done ({time.time()-t:.0f}s)", flush=True)
    if name == "final_model":
        imp = pd.Series(m.site_model_.booster_.feature_importance("gain"), index=m.feature_names_)
        imp.sort_values(ascending=False).to_csv(RESULTS / "final_feature_importance.csv")

# --- final model trained on two runs: dataset0-train + dataset1 (minus anything near the tests)
t = time.time()
train_tx = set(tr.transcript_id)
d1_tr = d1[d1.transcript_id.isin(train_tx)].copy()          # only transcripts of training genes
d1_tr["gene_id"] = d1_tr.transcript_id.map(tr.drop_duplicates("transcript_id").set_index("transcript_id").gene_id)
d1_tr["row"] = d1_tr["row"] + len(O0) - 1                 # rows into the concatenated read store
R01 = np.concatenate([R0, R1]); O01 = np.concatenate([O0, O1[1:] + O0[-1]])
both = pd.concat([tr, d1_tr], ignore_index=True)
m = ReadStackModel().fit(both, R01, O01)
preds["d0_test"]["final_model_d0+d1"] = m.predict_proba(te, R0, O0)
print(f"final_model_d0+d1 done ({time.time()-t:.0f}s); training sites {len(both):,}", flush=True)

# --- metrics
out = []
for ds, y, g in [("d0_test", te.label, te.gene_id), ("d1_unseen", d1u.label, d1u.gene_id)]:
    r = bootstrap_auc(y, preds[ds], g, n_boot=1000, reference="kmer_prior")
    r.insert(0, "dataset", ds)
    out.append(r)
    pd.DataFrame({**{"transcript_id": (te if ds == "d0_test" else d1u).transcript_id,
                     "transcript_position": (te if ds == "d0_test" else d1u).transcript_position,
                     "label": y}, **preds[ds]}).to_parquet(RESULTS / f"preds_{ds}.parquet")
res = pd.concat(out)
res.to_csv(RESULTS / "final_test_metrics.csv", index=False)
pd.set_option("display.width", 200)
print(res[["dataset", "model", "roc_auc", "roc_lo", "roc_hi", "pr_auc", "pr_lo", "pr_hi",
           "dpr_vs_kmer_prior", "dpr_lo", "dpr_hi"]].round(3).to_string(index=False))

d2rows = []
for name, p in preds["d2"].items():
    rho = spearmanr(d2.label, p).statistic
    # within-5-mer rank correlation (removes the sequence effect)
    w = pd.DataFrame({"k": d2.k5, "y": d2.label, "p": p}).groupby("k").apply(
        lambda g: spearmanr(g.y, g.p).statistic if g.y.nunique() > 1 and len(g) > 5 else np.nan)
    d2rows.append({"model": name, "spearman": rho, "within_kmer_spearman_median": np.nanmedian(w)})
pd.DataFrame({"transcript_id": d2.transcript_id, "transcript_position": d2.transcript_position,
              "fraction": d2.label, **preds["d2"]}).to_parquet(RESULTS / "preds_d2.parquet")
d2r = pd.DataFrame(d2rows); d2r.to_csv(RESULTS / "final_d2_spearman.csv", index=False)
print(d2r.round(3).to_string(index=False))
