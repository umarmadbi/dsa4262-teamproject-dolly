"""Does a read-level (multiple-instance) model add to the site model?

Read model: LightGBM on single reads (11 read values, centred per 5-mer, plus
one-hot 7-mer); every read inherits its site's label (noisy: only some reads
of a modified site are modified). Site scores pool the read probabilities.
Stacked model: site LightGBM on site features + pooled read scores, where the
pooled scores of training sites come from out-of-fold read models.
"""
import time

import numpy as np
import pandas as pd

from common import CACHE, RESULTS, load_d0, load_d1_unseen
from m6a.evaluation import score, stratified_gene_folds
from m6a.features import (POOL_COLS, SEQ_COLS, SIGNAL_COLS, KmerCentering, kmer_onehot,
                          load_reads, pool_read_scores, site_reads)
from m6a.models import make_lightgbm

CAP = 20
d0 = load_d0()
R0, O0 = load_reads(CACHE / "d0_reads.npz")
d1, unseen = load_d1_unseen(d0)
R1, O1 = load_reads(CACHE / "d1_reads.npz")
d0["row"] = np.arange(len(d0)); d1["row"] = np.arange(len(d1))
tr = d0[~d0.is_test].reset_index(drop=True)


def read_design(sites, R, O, ref):
    X, idx = site_reads(R, O, sites["row"].to_numpy(), cap=CAP)
    k5 = sites["k5"].to_numpy()[idx]
    X = X - ref.reindex(k5).fillna(ref.median()).to_numpy()
    seq = kmer_onehot(sites["kmer"]).to_numpy(np.float32)[idx]
    return np.hstack([X, seq]), idx


def fit_read_model(sites, R, O):
    X, idx = site_reads(R, O, sites["row"].to_numpy(), cap=CAP)
    ref = pd.DataFrame(X).groupby(sites["k5"].to_numpy()[idx]).median()
    D, idx = read_design(sites, R, O, ref)
    m = make_lightgbm(n_estimators=300, learning_rate=0.05, num_leaves=63, min_child_samples=200)
    m.fit(D, sites["label"].to_numpy()[idx])
    return m, ref


def pooled(m, ref, sites, R, O):
    D, idx = read_design(sites, R, O, ref)
    return pool_read_scores(m.predict_proba(D)[:, 1], idx, len(sites)).to_numpy()


def site_design(sites, center):
    Z = center.transform(sites)
    return np.hstack([Z[SIGNAL_COLS].to_numpy(np.float32),
                      kmer_onehot(sites["kmer"])[SEQ_COLS].to_numpy(np.float32)])


def fit_stack(sites, R, O):
    """Read model + out-of-fold pooled scores -> site model. Returns predictor."""
    oof = np.zeros((len(sites), len(POOL_COLS)))
    for a, b in stratified_gene_folds(sites, n_splits=3):
        m, ref = fit_read_model(sites.iloc[a], R, O)
        oof[b] = pooled(m, ref, sites.iloc[b], R, O)
    rm, ref = fit_read_model(sites, R, O)
    center = KmerCentering(reference="train").fit(sites)
    sm = make_lightgbm().fit(np.hstack([site_design(sites, center), oof]), sites["label"])

    def predict(new, Rn, On):
        P = pooled(rm, ref, new, Rn, On)
        return sm.predict_proba(np.hstack([site_design(new, center), P]))[:, 1], P[:, 0]
    return predict


rows = []
t = time.time()
for k, (a, b) in enumerate(stratified_gene_folds(tr)):
    pred = fit_stack(tr.iloc[a].reset_index(drop=True), R0, O0)
    va = tr.iloc[b].reset_index(drop=True)
    p_stack, p_read = pred(va, R0, O0)
    rows.append({"fold": k, **{f"stack_{x}": v for x, v in score(va.label, p_stack).items()},
                 **{f"readpool_{x}": v for x, v in score(va.label, p_read).items()}})
    print(k, f"stack PR {rows[-1]['stack_pr_auc']:.3f} ROC {rows[-1]['stack_roc_auc']:.3f} | "
          f"read-mean PR {rows[-1]['readpool_pr_auc']:.3f}  ({time.time()-t:.0f}s)", flush=True)
cv = pd.DataFrame(rows)
print("CV stack: ROC %.3f PR %.3f±%.3f | read-pool only: ROC %.3f PR %.3f" % (
    cv.stack_roc_auc.mean(), cv.stack_pr_auc.mean(), cv.stack_pr_auc.std(),
    cv.readpool_roc_auc.mean(), cv.readpool_pr_auc.mean()))
pred = fit_stack(tr, R0, O0)
p_stack, p_read = pred(d1, R1, O1)
e1, e2 = score(d1.label[unseen], p_stack[unseen]), score(d1.label[unseen], p_read[unseen])
print("d1-unseen stack: ROC %.3f PR %.3f | read-pool only: ROC %.3f PR %.3f" % (
    e1["roc_auc"], e1["pr_auc"], e2["roc_auc"], e2["pr_auc"]))
cv.to_csv(RESULTS / "read_level_cv.csv", index=False)
