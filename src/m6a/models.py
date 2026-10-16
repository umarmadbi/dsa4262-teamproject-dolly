"""Models: baselines and candidate classifiers behind one interface.

Every model takes the site table from `features.build_site_table` and returns
a probability per site. Everything that learns from data (k-mer reference
levels, scalers, the classifier itself) is fitted inside `fit`, so it only
ever sees training data. That keeps cross-validation honest.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, ClassifierMixin, clone
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from .features import SEQ_COLS, SIGNAL_COLS, KmerCentering, kmer_onehot


# ---------------------------------------------------------------- baselines
class RandomBaseline(BaseEstimator, ClassifierMixin):
    """Random scores: ROC AUC ~0.5, PR AUC ~ positive rate."""

    def __init__(self, seed: int = 0):
        self.seed = seed

    def fit(self, X, y):
        self.classes_ = np.array([0, 1])
        return self

    def predict_proba(self, X):
        p = np.random.default_rng(self.seed).random(len(X))
        return np.column_stack([1 - p, p])


class KmerPriorBaseline(BaseEstimator, ClassifierMixin):
    """Simple baseline: the training positive rate of the site's 5-mer.

    Uses the sequence only, no signal. Rates are smoothed towards the overall
    rate (`alpha` pseudo-sites) so rare 5-mers are not over-trusted.
    """

    def __init__(self, alpha: float = 20.0):
        self.alpha = alpha

    def fit(self, X, y):
        y = pd.Series(np.asarray(y), index=X.index)
        self.classes_ = np.array([0, 1])
        self.global_ = y.mean()
        g = y.groupby(X["k5"])
        self.rate_ = (g.sum() + self.alpha * self.global_) / (g.size() + self.alpha)
        return self

    def predict_proba(self, X):
        p = X["k5"].map(self.rate_).fillna(self.global_).to_numpy()
        return np.column_stack([1 - p, p])


# --------------------------------------------------------- full-feature models
class SiteModel(BaseEstimator, ClassifierMixin):
    """k-mer centring -> [signal features + one-hot 7-mer] -> classifier.

    centering: "train" (reference fitted on training data), "self" (each
               scored dataset is centred on its own 5-mer medians: label-free
               per-run batch correction) or "none" (raw signal).
    use_signal / use_seq: switches for the ablation study.
    """

    def __init__(self, estimator=None, centering: str = "self",
                 use_signal: bool = True, use_seq: bool = True, extra_cols: tuple = ()):
        self.estimator = estimator
        self.centering = centering
        self.use_signal = use_signal
        self.use_seq = use_seq
        self.extra_cols = extra_cols   # further columns of X used as-is (e.g. annotation features)

    def _design(self, X: pd.DataFrame, fitting: bool) -> np.ndarray:
        parts = []
        if self.use_signal:
            Z = X
            if self.centering != "none":
                Z = self.center_.transform(X) if not fitting else self.center_.fit_transform(X)
            parts.append(Z[SIGNAL_COLS].to_numpy(np.float32))
        if self.use_seq:
            parts.append(kmer_onehot(X["kmer"])[SEQ_COLS].to_numpy(np.float32))
        extra = list(getattr(self, "extra_cols", ()))
        if extra:
            parts.append(X[extra].to_numpy(np.float32))
        return np.hstack(parts)

    def fit(self, X, y, **fit_kw):
        self.classes_ = np.array([0, 1])
        ref = "self" if self.centering == "self" else "train"
        self.center_ = KmerCentering(reference=ref)
        D = self._design(X, fitting=True)
        self.est_ = clone(self.estimator)
        self.est_.fit(D, np.asarray(y), **fit_kw)
        return self

    def predict_proba(self, X):
        return self.est_.predict_proba(self._design(X, fitting=False))

    @property
    def feature_names_(self):
        names = []
        if self.use_signal:
            names += SIGNAL_COLS
        if self.use_seq:
            names += SEQ_COLS
        return names + list(getattr(self, "extra_cols", ()))


def _scale_pos_weight(y):
    y = np.asarray(y)
    return float((y == 0).sum() / max((y == 1).sum(), 1))


def make_lightgbm(n_estimators: int = 600, learning_rate: float = 0.03,
                  num_leaves: int = 31, min_child_samples: int = 50,
                  subsample: float = 0.8, colsample_bytree: float = 0.6,
                  reg_lambda: float = 1.0, scale_pos_weight: float = 1.0,
                  seed: int = 42, n_jobs: int = 2):
    from lightgbm import LGBMClassifier
    return LGBMClassifier(n_estimators=n_estimators, learning_rate=learning_rate,
                          num_leaves=num_leaves, min_child_samples=min_child_samples,
                          subsample=subsample, subsample_freq=1,
                          colsample_bytree=colsample_bytree, reg_lambda=reg_lambda,
                          scale_pos_weight=scale_pos_weight, random_state=seed,
                          n_jobs=n_jobs, verbose=-1)


def candidate_models(seed: int = 42, n_jobs: int = 2) -> dict:
    """The models compared in cross-validation (name -> unfitted estimator)."""
    lr = make_pipeline(StandardScaler(),
                       LogisticRegression(C=0.1, class_weight="balanced", max_iter=2000))
    rf = RandomForestClassifier(n_estimators=300, min_samples_leaf=10, max_features="sqrt",
                                class_weight="balanced_subsample", n_jobs=n_jobs,
                                random_state=seed)
    return {
        "random": RandomBaseline(seed),
        "kmer_prior": KmerPriorBaseline(),
        "logreg": SiteModel(lr),
        "random_forest": SiteModel(rf),
        "lightgbm": SiteModel(make_lightgbm(seed=seed, n_jobs=n_jobs)),
    }


# ------------------------------------------------- read-level stacked model
class ReadStackModel:
    """Final model: read-level classifier pooled per site, stacked with site features.

    1. Read model (multiple-instance idea from m6Anet): LightGBM scores single
       reads (11 read values centred per 5-mer + one-hot 7-mer). Each read
       inherits its site's label, which is noisy for partially modified sites.
       relabel=True adds one EM-style round: reads of positive sites are
       re-weighted by their round-1 probability (relative to the site's most
       confident read) and the read model is refitted, so it learns from the
       reads that look modified instead of from every read of a positive site.
    2. Read probabilities are pooled per site (mean, quantiles, max, share
       > 0.5, depth-normalised noisy-OR). At most `cap` reads per site are
       used, in training and prediction alike, so pooled scores do not drift
       with sequencing depth.
    3. Neighbour context (m6A sites cluster): a quick site-only LightGBM
       scores every site; for each site the max/mean score of the other
       candidate sites within 25 and 100 nt of the same transcript become
       features. No labels are used, so this works at prediction time.
       rich_neighbours=True uses 10/25/50/100 nt windows, also summarises the
       neighbours' pooled read scores, and adds the distance to the nearest
       candidate site and the number of candidate sites in the transcript.
    4. Final site model: LightGBM on k-mer-centred site features + one-hot
       7-mer + pooled read scores + neighbour features. Training sites get
       *out-of-fold* read and neighbour scores (gene-grouped inner folds), so
       the final model never sees scores from a model trained on that site.
       annotation=True adds transcript-structure features (m6a.annotation:
       region, distance to stop codon / exon junctions, ...) to the
       first-stage and final site models. The annotation table is stored in
       the fitted model, so predict.py needs no extra files. Transcripts
       missing from Ensembl get NaN features, which LightGBM (never having
       seen NaN in training) reads as 0, e.g. "on an exon junction", so it
       scores them all near 0: use SeedEnsemble(fallback=True), which scores
       such transcripts with a model without annotation. `ann_dropout` (hide
       the annotation of a random share of training transcripts) was tried
       for this and was not enough; it is off by default.
    """

    def __init__(self, cap: int = 20, inner_folds: int = 3, seed: int = 42, n_jobs: int = 2,
                 read_params: dict | None = None, site_params: dict | None = None,
                 neighbours: bool = True, annotation: bool = False, relabel: bool = False,
                 rich_neighbours: bool = False, ann_dropout: float = 0.0):
        self.neighbours = neighbours
        self.ann_dropout = ann_dropout
        self.annotation = annotation
        self.relabel = relabel
        self.rich_neighbours = rich_neighbours
        self.cap = cap
        self.inner_folds = inner_folds
        self.seed = seed
        self.n_jobs = n_jobs
        self.read_params = read_params or dict(n_estimators=300, learning_rate=0.05,
                                               num_leaves=63, min_child_samples=200)
        self.site_params = site_params or {}

    # -- helpers ---------------------------------------------------------
    def _read_matrix(self, sites, reads, offsets, ref=None):
        from .features import site_reads
        X, idx = site_reads(reads, offsets, sites["row"].to_numpy(), cap=self.cap, seed=self.seed)
        k5 = sites["k5"].to_numpy()[idx]
        if ref is None:
            ref = pd.DataFrame(X).groupby(k5).median()
        X = X - ref.reindex(k5).fillna(ref.median()).to_numpy()
        seq = kmer_onehot(sites["kmer"]).to_numpy(np.float32)[idx]
        return np.hstack([X, seq]), idx, ref

    def _fit_read(self, sites, reads, offsets):
        D, idx, ref = self._read_matrix(sites, reads, offsets)
        y = sites["label"].to_numpy()[idx]
        m = make_lightgbm(seed=self.seed, n_jobs=self.n_jobs, **self.read_params)
        m.fit(D, y)
        if getattr(self, "relabel", False):
            p = m.predict_proba(D)[:, 1]
            site_max = pd.Series(p).groupby(idx).transform("max").to_numpy()
            w = np.where(y == 1, p / np.maximum(site_max, 1e-6), 1.0)
            m = make_lightgbm(seed=self.seed, n_jobs=self.n_jobs, **self.read_params)
            m.fit(D, y, sample_weight=w)
        return m, ref

    def _pool(self, m, ref, sites, reads, offsets):
        from .features import pool_read_scores
        D, idx, _ = self._read_matrix(sites, reads, offsets, ref)
        return pool_read_scores(m.predict_proba(D)[:, 1], idx, len(sites)).to_numpy()

    def _annotate(self, sites):
        if not getattr(self, "annotation", False):
            return sites
        from .annotation import ANNOT_COLS, annotation_features
        return pd.concat([sites.drop(columns=ANNOT_COLS, errors="ignore"),
                          annotation_features(sites, self.tx_table_)], axis=1)

    def _neighbours(self, sites, s1, pooled):
        from .features import POOL_COLS, neighbour_features, rich_neighbour_features
        if getattr(self, "rich_neighbours", False):
            return rich_neighbour_features(sites, {"s1": s1, "rp": pooled[:, POOL_COLS.index("rp_q90")]})
        return neighbour_features(sites, s1)

    def _site_matrix(self, sites, pooled, nb=None):
        Z = self.center_.transform(sites)
        parts = [Z[SIGNAL_COLS].to_numpy(np.float32),
                 kmer_onehot(sites["kmer"])[SEQ_COLS].to_numpy(np.float32), pooled]
        if nb is not None:
            parts.append(nb.to_numpy(np.float32))
        if getattr(self, "annotation", False):
            from .annotation import ANNOT_COLS
            parts.append(sites[ANNOT_COLS].to_numpy(np.float32))
        return np.hstack(parts)

    def _stage1(self):
        extra = ()
        if getattr(self, "annotation", False):
            from .annotation import ANNOT_COLS
            extra = tuple(ANNOT_COLS)
        return SiteModel(make_lightgbm(n_estimators=400, learning_rate=0.05, seed=self.seed,
                                       n_jobs=self.n_jobs), centering="train", extra_cols=extra)

    # -- API -------------------------------------------------------------
    def fit(self, sites: pd.DataFrame, reads, offsets, group_col: str = "gene_id"):
        """sites: site table with 'label', group_col and 'row' (index into offsets)."""
        from .evaluation import stratified_gene_folds
        from .features import POOL_COLS
        if self.annotation:
            from .annotation import ANNOT_COLS, load_transcript_table
            self.tx_table_ = load_transcript_table()
        sites = self._annotate(sites.reset_index(drop=True))
        if self.annotation and getattr(self, "ann_dropout", 0) > 0:
            tx = sites["transcript_id"].unique()
            hide = tx[np.random.default_rng(self.seed).random(len(tx)) < self.ann_dropout]
            m = sites["transcript_id"].isin(hide).to_numpy()
            sites.loc[m, ANNOT_COLS] = np.nan
            sites.loc[m, "ann_known"] = 0.0
        y = sites["label"].to_numpy()
        oof = np.zeros((len(sites), len(POOL_COLS)))
        s1 = np.zeros(len(sites))
        for a, b in stratified_gene_folds(sites, n_splits=self.inner_folds, seed=self.seed,
                                          group_col=group_col):
            m, ref = self._fit_read(sites.iloc[a], reads, offsets)
            oof[b] = self._pool(m, ref, sites.iloc[b], reads, offsets)
            if self.neighbours:
                s1[b] = self._stage1().fit(sites.iloc[a], y[a]).predict_proba(sites.iloc[b])[:, 1]
        self.read_model_, self.read_ref_ = self._fit_read(sites, reads, offsets)
        nb = None
        if self.neighbours:
            self.stage1_ = self._stage1().fit(sites, y)
            nb = self._neighbours(sites, s1, oof)
        self.center_ = KmerCentering(reference="train").fit(sites)
        self.site_model_ = make_lightgbm(seed=self.seed, n_jobs=self.n_jobs, **self.site_params)
        self.site_model_.fit(self._site_matrix(sites, oof, nb), y)
        self.feature_names_ = (SIGNAL_COLS + SEQ_COLS + POOL_COLS + (list(nb.columns) if nb is not None else [])
                               + (ANNOT_COLS if self.annotation else []))
        return self

    def predict_proba(self, sites: pd.DataFrame, reads, offsets) -> np.ndarray:
        """Probability of m6A for each site (1-D array)."""
        sites = self._annotate(sites.reset_index(drop=True))
        pooled = self._pool(self.read_model_, self.read_ref_, sites, reads, offsets)
        nb = None
        if self.neighbours:
            nb = self._neighbours(sites, self.stage1_.predict_proba(sites)[:, 1], pooled)
        return self.site_model_.predict_proba(self._site_matrix(sites, pooled, nb))[:, 1]


# Components of the v2 model, chosen by 5-fold gene-grouped CV (experiments/10_improvements_cv.py)
V2_CONFIG = dict(annotation=True)


class SeedEnsemble:
    """Average of ReadStackModels that differ only in their random seed
    (read sampling, inner folds, LightGBM bagging). Same interface as ReadStackModel.

    fallback=True (with annotation=True): also fits one model without annotation
    features and uses it for sites whose transcript is not in the Ensembl table.
    Annotated sites are scored by the ensemble alone.
    """

    def __init__(self, seeds=(42, 43, 44), fallback: bool = True, **kw):
        self.seeds = tuple(seeds)
        self.fallback = fallback
        self.kw = kw
        self.seed = self.seeds[0]

    @property
    def cap(self):
        return self.kw.get("cap", 20)

    @property
    def n_jobs(self):
        return self.kw.get("n_jobs", 2)

    @n_jobs.setter
    def n_jobs(self, v):
        self.kw["n_jobs"] = v
        for m in getattr(self, "models_", []) + [getattr(self, "fallback_", None)]:
            if m is not None:
                m.n_jobs = v

    def fit(self, sites, reads, offsets, group_col: str = "gene_id"):
        self.models_ = [ReadStackModel(seed=s, **self.kw).fit(sites, reads, offsets, group_col)
                        for s in self.seeds]
        self.fallback_ = None
        if self.fallback and self.kw.get("annotation", False):
            kw = {**self.kw, "annotation": False}
            self.fallback_ = ReadStackModel(seed=self.seeds[0], **kw).fit(sites, reads, offsets, group_col)
        return self

    def predict_proba(self, sites, reads, offsets) -> np.ndarray:
        p = np.mean([m.predict_proba(sites, reads, offsets) for m in self.models_], axis=0)
        if getattr(self, "fallback_", None) is not None:
            known = sites["transcript_id"].isin(self.models_[0].tx_table_["transcript_id"]).to_numpy()
            if not known.all():
                p = np.where(known, p, self.fallback_.predict_proba(sites, reads, offsets))
        return p
