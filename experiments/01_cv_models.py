"""Gene-grouped 5-fold CV on the training 80% of dataset0: baselines vs models.

Output: results/cv_results.csv (per-fold ROC/PR AUC) and a printed summary.
"""
import sys
import time

import numpy as np
import pandas as pd
from sklearn.base import clone

from common import RESULTS, load_d0
from m6a.evaluation import score, stratified_gene_folds
from m6a.models import candidate_models

only = sys.argv[1:]  # optional: model names to run
d0 = load_d0()
tr = d0[~d0["is_test"]].reset_index(drop=True)
print(f"train sites {len(tr):,} ({tr.label.mean():.3%} pos), test sites {d0.is_test.sum():,} "
      f"({d0[d0.is_test].label.mean():.3%} pos), genes test {d0[d0.is_test].gene_id.nunique()}")
folds = stratified_gene_folds(tr)
rows = []
models = candidate_models()
for name, model in models.items():
    if only and name not in only:
        continue
    t = time.time()
    for k, (a, b) in enumerate(folds):
        m = clone(model).fit(tr.iloc[a], tr.label.iloc[a])
        p = m.predict_proba(tr.iloc[b])[:, 1]
        rows.append({"model": name, "fold": k, **score(tr.label.iloc[b], p)})
    r = pd.DataFrame([x for x in rows if x["model"] == name])
    print(f"{name:15s} ROC {r.roc_auc.mean():.3f}±{r.roc_auc.std():.3f}  "
          f"PR {r.pr_auc.mean():.3f}±{r.pr_auc.std():.3f}  ({time.time()-t:.0f}s)", flush=True)
out = RESULTS / "cv_results.csv"
old = pd.read_csv(out) if out.exists() else pd.DataFrame()
new = pd.DataFrame(rows)
if len(old):
    old = old[~old.model.isin(new.model.unique())]
pd.concat([old, new]).to_csv(out, index=False)
