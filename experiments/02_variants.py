"""Design choices for the LightGBM site model, each judged two ways:
  * gene-grouped 5-fold CV inside the training 80% of dataset0
  * trained on that 80%, tested on dataset1 transcripts never seen in dataset0
    (different sequencing run -> checks robustness to batch shift).
Output: results/variants.csv
"""
import time

import numpy as np
import pandas as pd
from sklearn.base import clone

from common import RESULTS, load_d0, load_d1_unseen
from m6a.evaluation import score, stratified_gene_folds
from m6a.models import SiteModel, make_lightgbm, _scale_pos_weight, KmerPriorBaseline

d0 = load_d0()
tr = d0[~d0.is_test].reset_index(drop=True)
d1, unseen = load_d1_unseen(d0)
print(f"d1 unseen sites {unseen.sum():,} ({d1.label[unseen].mean():.3%} pos)")
folds = stratified_gene_folds(tr)
spw = _scale_pos_weight(tr.label)

variants = {
    "kmer_prior": KmerPriorBaseline(),
    "lgbm_center_none": SiteModel(make_lightgbm(), centering="none"),
    "lgbm_center_train": SiteModel(make_lightgbm(), centering="train"),
    "lgbm_center_self": SiteModel(make_lightgbm(), centering="self"),
    "lgbm_self_weighted": SiteModel(make_lightgbm(scale_pos_weight=spw), centering="self"),
    "lgbm_signal_only": SiteModel(make_lightgbm(), centering="self", use_seq=False),
    "lgbm_seq_only": SiteModel(make_lightgbm(), use_signal=False),
}
rows = []
for name, model in variants.items():
    t = time.time()
    cv = []
    for k, (a, b) in enumerate(folds):
        m = clone(model).fit(tr.iloc[a], tr.label.iloc[a])
        cv.append(score(tr.label.iloc[b], m.predict_proba(tr.iloc[b])[:, 1]))
    cv = pd.DataFrame(cv)
    m = clone(model).fit(tr, tr.label)
    # score dataset1 as a whole run (so "self" centring sees the full run), then keep unseen sites
    p1 = m.predict_proba(d1)[:, 1][unseen]
    ext = score(d1.label[unseen], p1)
    rows.append({"variant": name, "cv_roc": cv.roc_auc.mean(), "cv_roc_sd": cv.roc_auc.std(),
                 "cv_pr": cv.pr_auc.mean(), "cv_pr_sd": cv.pr_auc.std(),
                 "d1_roc": ext["roc_auc"], "d1_pr": ext["pr_auc"]})
    r = rows[-1]
    print(f"{name:20s} CV ROC {r['cv_roc']:.3f} PR {r['cv_pr']:.3f}±{r['cv_pr_sd']:.3f} | "
          f"d1-unseen ROC {r['d1_roc']:.3f} PR {r['d1_pr']:.3f}  ({time.time()-t:.0f}s)", flush=True)
pd.DataFrame(rows).to_csv(RESULTS / "variants.csv", index=False)
