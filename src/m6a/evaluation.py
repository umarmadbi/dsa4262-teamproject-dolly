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
