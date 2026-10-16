"""Report figure: PR / ROC curves on both test sets + dataset2 dose-response."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, precision_recall_curve, roc_auc_score, roc_curve

from common import RESULTS, ROOT

plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 9, "axes.spines.top": False,
                     "axes.spines.right": False, "axes.edgecolor": "#52514e", "axes.labelcolor": "#0b0b0b",
                     "xtick.color": "#52514e", "ytick.color": "#52514e", "axes.grid": True,
                     "grid.color": "#e6e5e1", "grid.linewidth": 0.6})
MODELS = [("kmer_prior", "5-mer prior (baseline)", "#eb6834"),
          ("logreg", "Logistic regression", "#1baf7a"),
          ("lightgbm", "LightGBM, site features", "#4a3aa7"),
          ("final_model", "Final model", "#2a78d6")]
fig, ax = plt.subplots(2, 3, figsize=(11, 7))
for col, (ds, title) in enumerate([("d0_test", "dataset0 held-out genes"),
                                   ("d1_unseen", "dataset1 unseen transcripts")]):
    p = pd.read_parquet(RESULTS / f"preds_{ds}.parquet")
    y = p.label.to_numpy()
    a_pr, a_roc = ax[0, col], ax[1, col]
    for key, lab, c in MODELS:
        pr, rc, _ = precision_recall_curve(y, p[key]); fpr, tpr, _ = roc_curve(y, p[key])
        lw = 2.2 if key == "final_model" else 1.4
        a_pr.plot(rc, pr, color=c, lw=lw, label=f"{lab} ({average_precision_score(y, p[key]):.2f})")
        a_roc.plot(fpr, tpr, color=c, lw=lw, label=f"{lab} ({roc_auc_score(y, p[key]):.2f})")
    a_pr.axhline(y.mean(), color="#898781", ls="--", lw=1, label=f"Random ({y.mean():.3f})")
    a_roc.plot([0, 1], [0, 1], color="#898781", ls="--", lw=1, label="Random (0.50)")
    a_pr.set(title=f"Precision-recall: {title}", xlabel="Recall", ylabel="Precision", xlim=(0, 1), ylim=(0, 1))
    a_roc.set(title=f"ROC: {title}", xlabel="False positive rate", ylabel="True positive rate")
    a_pr.legend(title="PR AUC", fontsize=7.5, title_fontsize=8, frameon=False)
    a_roc.legend(title="ROC AUC", fontsize=7.5, title_fontsize=8, frameon=False, loc="lower right")

d2 = pd.read_parquet(RESULTS / "preds_d2.parquet")
a = ax[0, 2]
for key, lab, c in MODELS[2:]:
    g = d2.groupby("fraction")[key]
    a.errorbar(g.mean().index, g.median(), yerr=[g.median() - g.quantile(0.25), g.quantile(0.75) - g.median()],
               color=c, lw=1.6, marker="o", ms=4, capsize=2, label=lab)
a.set(title="dataset2: score vs known m6A fraction", xlabel="Fraction of molecules modified",
      ylabel="Predicted score (median, IQR)")
a.legend(fontsize=7.5, frameon=False)

imp = pd.read_csv(RESULTS / "final_feature_importance.csv", index_col=0).iloc[:, 0]
top = (imp / imp.sum()).head(12)[::-1]
b = ax[1, 2]
b.barh(top.index, top.values, color="#2a78d6", height=0.6)
b.set(title="Final model: top features (share of gain)", xlabel="Share of total gain")
b.tick_params(axis="y", labelsize=7.5); b.grid(axis="y", visible=False)
fig.tight_layout()
fig.savefig(ROOT / "docs/figures/model_evaluation.png", dpi=200)
print(d2.groupby("fraction").size().to_dict())
