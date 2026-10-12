"""Which of the proposed improvements actually help? 5-fold gene-grouped CV on the training 80%.

Variants of ReadStackModel (all with neighbour context, like the final model):
  base         the current final model
  annotation   + transcript-structure features (Ensembl 91: region, distance to stop codon / junctions, ...)
  relabel      + one EM-style re-weighting round for the read model
  rich_nb      + richer neighbour context (more windows, neighbours' read scores, nearest-site distance)
  all          all three
  annot_nb     annotation + rich_nb (added once relabel turned out not to help)
The test genes are not touched. Differences are paired by fold (same folds for every variant).
Outputs: results/improvements_cv.csv (one row per fold x variant), printed summary.
"""
import sys
import time
import warnings

import numpy as np
import pandas as pd

from common import CACHE, RESULTS, load_d0
from m6a.evaluation import score, stratified_gene_folds
from m6a.features import load_reads
from m6a.models import ReadStackModel

warnings.filterwarnings("ignore")
VARIANTS = {
    "base": {},
    "annotation": dict(annotation=True),
    "relabel": dict(relabel=True),
    "rich_nb": dict(rich_neighbours=True),
    "all": dict(annotation=True, relabel=True, rich_neighbours=True),
    "annot_nb": dict(annotation=True, rich_neighbours=True),     # added after relabel did not help
}
only = sys.argv[1:] or list(VARIANTS)

d0 = load_d0(); d0["row"] = np.arange(len(d0))
R0, O0 = load_reads(CACHE / "d0_reads.npz")
tr = d0[~d0.is_test].reset_index(drop=True)
out_file = RESULTS / "improvements_cv.csv"
done = pd.read_csv(out_file) if out_file.exists() else pd.DataFrame(columns=["variant", "fold"])

t0 = time.time()
for k, (a, b) in enumerate(stratified_gene_folds(tr)):
    fit_s, val = tr.iloc[a].reset_index(drop=True), tr.iloc[b].reset_index(drop=True)
    for name in only:
        if ((done.variant == name) & (done.fold == k)).any():
            continue
        t = time.time()
        p = ReadStackModel(**VARIANTS[name]).fit(fit_s, R0, O0).predict_proba(val, R0, O0)
        r = {"variant": name, "fold": k, **score(val.label, p), "seconds": round(time.time() - t)}
        done = pd.concat([done, pd.DataFrame([r])], ignore_index=True)
        done.to_csv(out_file, index=False)          # save as we go: the run is long
        print(f"fold {k} {name:<11} PR {r['pr_auc']:.3f} ROC {r['roc_auc']:.3f} "
              f"({r['seconds']}s, total {time.time() - t0:.0f}s)", flush=True)

# --- summary: mean over folds and paired difference vs base
res = done.pivot(index="fold", columns="variant", values="pr_auc")
roc = done.pivot(index="fold", columns="variant", values="roc_auc")
rows = []
for v in res.columns:
    d = res[v] - res["base"]
    rows.append({"variant": v, "cv_pr": res[v].mean(), "cv_pr_sd": res[v].std(), "cv_roc": roc[v].mean(),
                 "dpr_vs_base": d.mean(), "dpr_sd": d.std(), "folds_better": int((d > 0).sum()),
                 "droc_vs_base": (roc[v] - roc["base"]).mean()})
print(pd.DataFrame(rows).round(4).to_string(index=False))
