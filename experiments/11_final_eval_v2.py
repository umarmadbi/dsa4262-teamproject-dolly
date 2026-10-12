"""One-shot test evaluation of the improved model (v2) against the current final model.

v2 = ReadStackModel with the components that helped in 10_improvements_cv.py (CHOSEN),
averaged over three seeds. Trained on the training 80% of dataset0 genes, scored on:
  * d0_test           dataset0 held-out 20% of genes (same as 05_final_eval.py)
  * d1_unseen         dataset1 transcripts absent from dataset0 (same as 05_final_eval.py)
  * d1_strict         d1_unseen minus every site whose *gene* (from Ensembl) is a training gene,
                      i.e. no isoforms of training genes. The two-run model is only judged here,
                      because it trains on dataset1 transcripts of training genes.
  * d2                Spearman with the known modification fraction
Also v2 trained on two runs: dataset0-train + dataset1 sites of training genes.
Gene-level bootstrap CIs; paired differences vs the current final model.
Outputs: results/final_v2_metrics.csv, results/final_v2_d2_spearman.csv, results/preds_v2_*.parquet,
         docs/figures/model_evaluation_v2.png
"""
import time
import warnings

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.base import clone
from sklearn.metrics import precision_recall_curve

from common import CACHE, RESULTS, ROOT, load_d0, load_d1_unseen
from m6a.annotation import load_transcript_table
from m6a.evaluation import bootstrap_auc
from m6a.features import load_reads
from m6a.io import KEY
from m6a.models import V2_CONFIG, ReadStackModel, SeedEnsemble, candidate_models

warnings.filterwarnings("ignore")
CHOSEN = V2_CONFIG   # chosen in 10_improvements_cv.py
SEEDS = (42, 43, 44)

d0 = load_d0(); d0["row"] = np.arange(len(d0))
d1, unseen = load_d1_unseen(d0); d1["row"] = np.arange(len(d1))
d2 = pd.read_parquet(CACHE / "d2.parquet"); d2["row"] = np.arange(len(d2))
R0, O0 = load_reads(CACHE / "d0_reads.npz")
R1, O1 = load_reads(CACHE / "d1_reads.npz")
R2, O2 = load_reads(CACHE / "d2_reads.npz")
tr, te = d0[~d0.is_test].reset_index(drop=True), d0[d0.is_test].reset_index(drop=True)

# real gene ids for dataset1 from Ensembl (d1 has none of its own)
ens_gene = load_transcript_table().set_index("transcript_id")["gene_id"]
d1["ens_gene"] = d1.transcript_id.map(ens_gene).fillna(d1.transcript_id)
train_genes = set(tr.gene_id)
strict = unseen & ~d1.ens_gene.isin(train_genes).to_numpy()
d1u, d1s = d1[unseen].reset_index(drop=True), d1[strict].reset_index(drop=True)
print(f"d1_unseen {unseen.sum():,} sites; d1_strict {strict.sum():,} sites "
      f"({(unseen & ~strict).sum():,} unseen-transcript sites are isoforms of training genes)", flush=True)

sets = {"d0_test": te, "d1_unseen": d1u, "d1_strict": d1s}
preds = {k: {} for k in [*sets, "d2"]}


def add(name, p0, p1, p2):
    preds["d0_test"][name], preds["d1_unseen"][name], preds["d1_strict"][name] = p0, p1[unseen], p1[strict]
    preds["d2"][name] = p2


kp = clone(candidate_models()["kmer_prior"]).fit(tr, tr.label)
add("kmer_prior", *(kp.predict_proba(s)[:, 1] for s in (te, d1, d2)))
m6a = {n: pd.read_csv(CACHE / "m6anet" / f"{n}_out" / "data.site_proba.csv") for n in ("d0", "d1", "d2")}
add("m6anet", *(s[KEY].merge(m6a[n], on=KEY, how="left").probability_modified.fillna(0).to_numpy()
                for s, n in ((te, "d0"), (d1, "d1"), (d2, "d2"))))

for name, model, train in [("final_model", ReadStackModel(), tr),
                           ("v2_single", ReadStackModel(**CHOSEN), tr),
                           ("v2", SeedEnsemble(SEEDS, **CHOSEN), tr)]:
    t = time.time()
    m = model.fit(train, R0, O0)
    add(name, m.predict_proba(te, R0, O0), m.predict_proba(d1, R1, O1), m.predict_proba(d2, R2, O2))
    print(f"{name} done ({time.time() - t:.0f}s)", flush=True)
    if name == "v2_single":
        imp = pd.Series(m.site_model_.booster_.feature_importance("gain"), index=m.feature_names_)
        imp.sort_values(ascending=False).to_csv(RESULTS / "final_v2_feature_importance.csv")

# --- v2 on two runs: dataset0-train + dataset1 sites whose gene is a training gene
t = time.time()
d1_tr = d1[d1.ens_gene.isin(train_genes)].copy()
d1_tr["gene_id"] = d1_tr["ens_gene"]
d1_tr["row"] = d1_tr["row"] + len(O0) - 1
R01 = np.concatenate([R0, R1]); O01 = np.concatenate([O0, O1[1:] + O0[-1]])
both = pd.concat([tr, d1_tr], ignore_index=True)
m = SeedEnsemble(SEEDS, **CHOSEN).fit(both, R01, O01)
preds["d0_test"]["v2_two_runs"] = m.predict_proba(te, R0, O0)
preds["d1_strict"]["v2_two_runs"] = m.predict_proba(d1, R1, O1)[strict]
print(f"v2_two_runs done ({time.time() - t:.0f}s); training sites {len(both):,}", flush=True)

# --- metrics
out = []
for ds, s in sets.items():
    g = s.gene_id if ds == "d0_test" else s.ens_gene
    r = bootstrap_auc(s.label, preds[ds], g, n_boot=1000, reference="final_model")
    r.insert(0, "dataset", ds)
    out.append(r)
    pd.DataFrame({**{k: s[k] for k in KEY + ["label"]}, **preds[ds]}).to_parquet(RESULTS / f"preds_v2_{ds}.parquet")
res = pd.concat(out)
res.to_csv(RESULTS / "final_v2_metrics.csv", index=False)
pd.set_option("display.width", 220)
print(res[["dataset", "model", "roc_auc", "roc_lo", "roc_hi", "pr_auc", "pr_lo", "pr_hi",
           "droc_vs_final_model", "droc_lo", "droc_hi", "dpr_vs_final_model", "dpr_lo", "dpr_hi"]]
      .round(3).to_string(index=False))

rows = []
for name, p in preds["d2"].items():
    w = pd.DataFrame({"k": d2.k5, "y": d2.label, "p": p}).groupby("k").apply(
        lambda g: spearmanr(g.y, g.p).statistic if g.y.nunique() > 1 and g.p.nunique() > 1 and len(g) > 5 else np.nan)
    rows.append({"model": name, "spearman": spearmanr(d2.label, p).statistic,
                 "within_kmer_spearman_median": np.nanmedian(w)})
d2r = pd.DataFrame(rows); d2r.to_csv(RESULTS / "final_v2_d2_spearman.csv", index=False)
print(d2r.round(3).to_string(index=False))

# --- figure
MODELS = [("kmer_prior", "5-mer prior (baseline)", "#eb6834"), ("m6anet", "m6Anet (pretrained)", "#1baf7a"),
          ("final_model", "Final model (v1)", "#898781"), ("v2", "Improved model (v2)", "#2a78d6")]
fig, ax = plt.subplots(1, 3, figsize=(11, 3.6))
for a, ds, title in [(ax[0], "d0_test", "dataset0 held-out genes"), (ax[1], "d1_strict", "dataset1 unseen genes")]:
    y = sets[ds].label.to_numpy()
    for key, lab, c in MODELS:
        pr, rc, _ = precision_recall_curve(y, preds[ds][key])
        auc = res.query("dataset == @ds and model == @key").pr_auc.item()
        a.plot(rc, pr, color=c, lw=2.2 if key == "v2" else 1.3, label=f"{lab} ({auc:.2f})")
    a.axhline(y.mean(), color="#c3c2bd", ls="--", lw=1, label=f"Random ({y.mean():.3f})")
    a.set(title=f"Precision-recall: {title}", xlabel="Recall", ylabel="Precision", xlim=(0, 1), ylim=(0, 1))
    a.legend(title="PR AUC", fontsize=7.5, title_fontsize=8, frameon=False)
for key, lab, c in MODELS[1:]:
    g = pd.Series(preds["d2"][key]).groupby(d2.label.to_numpy()).median()
    ax[2].plot(g.index, g.values, "o-", color=c, label=lab)
ax[2].set(title="dataset2: median score by fraction", xlabel="Modification fraction", ylabel="Median score")
ax[2].legend(fontsize=7.5, frameon=False)
fig.tight_layout()
fig.savefig(ROOT / "docs/figures/model_evaluation_v2.png", dpi=150)
print("figure -> docs/figures/model_evaluation_v2.png")
