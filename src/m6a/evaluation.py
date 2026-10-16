"""Shared evaluation so every team member's results are comparable.

Rules from the EDA (docs/eda_findings.md):
  * split by gene_id, never randomly (random splits leak and inflate PR AUC);
  * report ROC AUC and PR AUC, plus the PR AUC of a random classifier
    (= the positive rate), never accuracy.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.model_selection import GroupKFold, GroupShuffleSplit

SEED = 42  # use the same seed everywhere


def gene_split(df: pd.DataFrame, test_size: float = 0.2, seed: int = SEED,
               group_col: str = "gene_id"):
    """Train/test row indices with no gene shared between the two sets."""
    gss = GroupShuffleSplit(n_splits=1, test_size=test_size, random_state=seed)
    train_idx, test_idx = next(gss.split(df, groups=df[group_col]))
    return train_idx, test_idx


def gene_kfold(df: pd.DataFrame, n_splits: int = 5, group_col: str = "gene_id"):
    """K-fold cross-validation folds grouped by gene (for tuning)."""
    return list(GroupKFold(n_splits=n_splits).split(df, groups=df[group_col]))


def score(y_true, y_score) -> dict:
    """ROC AUC, PR AUC (average precision) and the PR AUC of random guessing."""
    y_true = np.asarray(y_true)
    return {
        "roc_auc": float(roc_auc_score(y_true, y_score)),
        "pr_auc": float(average_precision_score(y_true, y_score)),
        "pr_baseline": float(y_true.mean()),
        "n": int(len(y_true)),
        "n_pos": int(y_true.sum()),
    }


# ---------------------------------------------------------------------------
# Added for model development
# ---------------------------------------------------------------------------
from sklearn.model_selection import StratifiedGroupKFold  # noqa: E402


def frozen_test_split(df: pd.DataFrame, test_frac: float = 0.2, seed: int = SEED,
                      group_col: str = "gene_id", label_col: str = "label"):
    """Hold out ~test_frac of genes, keeping the positive rate similar.

    Uses one fold of a StratifiedGroupKFold so every gene is entirely in
    train or test. Returns boolean mask `is_test` aligned with df.
    """
    k = int(round(1 / test_frac))
    sgkf = StratifiedGroupKFold(n_splits=k, shuffle=True, random_state=seed)
    _, test_idx = next(sgkf.split(df, df[label_col], groups=df[group_col]))
    mask = np.zeros(len(df), bool)
    mask[test_idx] = True
    return mask


def stratified_gene_folds(df: pd.DataFrame, n_splits: int = 5, seed: int = SEED,
                          group_col: str = "gene_id", label_col: str = "label"):
    """CV folds grouped by gene and stratified by label (for model selection)."""
    sgkf = StratifiedGroupKFold(n_splits=n_splits, shuffle=True, random_state=seed)
    return list(sgkf.split(df, df[label_col], groups=df[group_col]))


def bootstrap_auc(y_true, scores: dict, groups, n_boot: int = 1000, seed: int = SEED,
                  reference: str | None = None) -> pd.DataFrame:
    """Gene-level (cluster) bootstrap 95% CIs for ROC AUC and PR AUC.

    Genes, not sites, are resampled because sites in a gene are correlated.
    scores: {model_name: score_array}. If `reference` is given, also returns
    the CI of the paired difference (model - reference) in each metric.
    """
    y = np.asarray(y_true)
    groups = np.asarray(groups)
    uniq, inv = np.unique(groups, return_inverse=True)
    members = [np.flatnonzero(inv == g) for g in range(len(uniq))]
    rng = np.random.default_rng(seed)
    boot = {m: {"roc": [], "pr": []} for m in scores}
    for _ in range(n_boot):
        pick = rng.integers(0, len(uniq), len(uniq))
        idx = np.concatenate([members[g] for g in pick])
        yb = y[idx]
        if yb.min() == yb.max():
            continue
        for m, s in scores.items():
            sb = np.asarray(s)[idx]
            boot[m]["roc"].append(roc_auc_score(yb, sb))
            boot[m]["pr"].append(average_precision_score(yb, sb))
    rows = []
    for m, s in scores.items():
        r = {"model": m, **score(y, s)}
        for k in ("roc", "pr"):
            a = np.array(boot[m][k])
            r[f"{k}_lo"], r[f"{k}_hi"] = np.percentile(a, [2.5, 97.5])
            if reference and m != reference:
                d = a - np.array(boot[reference][k])
                r[f"d{k}_vs_{reference}"] = float(np.mean(d))
                r[f"d{k}_lo"], r[f"d{k}_hi"] = np.percentile(d, [2.5, 97.5])
        rows.append(r)
    return pd.DataFrame(rows)
