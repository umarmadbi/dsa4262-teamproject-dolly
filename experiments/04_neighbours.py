"""Do neighbouring candidate sites help? Two-stage site model:
stage 1 = site LightGBM (OOF scores on training data), stage 2 adds the
max/mean stage-1 score of other sites within 25/100 nt in the same transcript.
"""
import numpy as np
import pandas as pd
from sklearn.base import clone

from common import load_d0, load_d1_unseen
from m6a.evaluation import score, stratified_gene_folds
from m6a.features import NEIGH_COLS, neighbour_features
from m6a.models import SiteModel, make_lightgbm

d0 = load_d0(); tr = d0[~d0.is_test].reset_index(drop=True)
d1, unseen = load_d1_unseen(d0)
base = SiteModel(make_lightgbm(), centering="train")


def fit_two_stage(s):
    s = s.reset_index(drop=True)
    oof = np.zeros(len(s))
    for a, b in stratified_gene_folds(s, n_splits=3):
        oof[b] = clone(base).fit(s.iloc[a], s.label.iloc[a]).predict_proba(s.iloc[b])[:, 1]
    m1 = clone(base).fit(s, s.label)
    nb = neighbour_features(s, oof)
    m2 = clone(base); m2.fit(s, s.label)  # fit centring
    D = np.hstack([m2._design(s, fitting=False), nb.to_numpy()])
    m2.est_.fit(D, s.label)

    def predict(new):
        new = new.reset_index(drop=True)
        p1 = m1.predict_proba(new)[:, 1]
        D = np.hstack([m2._design(new, fitting=False), neighbour_features(new, p1).to_numpy()])
        return m2.est_.predict_proba(D)[:, 1], p1
    return predict


res = []
for k, (a, b) in enumerate(stratified_gene_folds(tr)):
    pr = fit_two_stage(tr.iloc[a])
    va = tr.iloc[b]
    p2, p1 = pr(va)
    res.append((score(va.label, p1)["pr_auc"], score(va.label, p2)["pr_auc"], score(va.label, p2)["roc_auc"]))
    print(k, "stage1 PR %.3f -> with neighbours PR %.3f (ROC %.3f)" % res[-1], flush=True)
r = np.array(res); print("CV mean: stage1 PR %.3f, neighbours PR %.3f, ROC %.3f" % tuple(r.mean(0)))
pr = fit_two_stage(tr)
p2, p1 = pr(d1)
print("d1-unseen: stage1 PR %.3f -> neighbours PR %.3f ROC %.3f" % (
    score(d1.label[unseen], p1[unseen])["pr_auc"], score(d1.label[unseen], p2[unseen])["pr_auc"],
    score(d1.label[unseen], p2[unseen])["roc_auc"]))
