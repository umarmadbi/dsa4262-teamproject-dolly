"""Is the Ensembl 91 annotation the right one for our data, and does it carry signal?

1. Release check: the 7-mer of each site must equal the Ensembl 91 transcript
   sequence around transcript_position (cDNA + ncRNA fasta in cache/annotation/).
   A wrong release would silently shift every coordinate-based feature.
2. Signal check (training genes only): positive rate by region and by distance
   to the stop codon / nearest exon junction.
Outputs: results/annotation_check.csv
"""
import gzip

import numpy as np
import pandas as pd

from common import CACHE, RESULTS, load_d0
from m6a.annotation import ANNOT_COLS, annotation_features, load_transcript_table


def read_fasta(paths):
    seqs, name, buf = {}, None, []
    for path in paths:
        with gzip.open(path, "rt") as fh:
            for line in fh:
                if line.startswith(">"):
                    if name:
                        seqs[name] = "".join(buf)
                    name, buf = line[1:].split()[0].split(".")[0], []
                else:
                    buf.append(line.strip())
    if name:
        seqs[name] = "".join(buf)
    return seqs


d0 = load_d0()
d1 = pd.read_parquet(CACHE / "d1.parquet")
fasta = sorted((CACHE / "annotation").glob("*.fa.gz"))
seqs = read_fasta(fasta)
rows = []
for name, d in [("d0", d0), ("d1", d1)]:
    s = d.sample(min(len(d), 20000), random_state=0)
    for o in range(-4, 5):
        ok = [tx in seqs and seqs[tx][p + o - 3:p + o + 4] == k
              for tx, p, k in zip(s.transcript_id, s.transcript_position, s.kmer)]
        rows.append({"check": f"kmer_match_{name}", "offset": o, "value": float(np.mean(ok))})
    has = s.transcript_id.isin(seqs.keys()).mean()
    rows.append({"check": f"tx_in_fasta_{name}", "offset": np.nan, "value": float(has)})
chk = pd.DataFrame(rows)
print(f"fasta files: {[p.name for p in fasta]}")
print(chk[chk.value > 0.01].to_string(index=False))

# --- signal check on training genes only (the test genes stay untouched)
tr = d0[~d0.is_test].reset_index(drop=True)
A = annotation_features(tr, load_transcript_table())
print(f"\nannotated training sites: {A.ann_known.mean():.1%}")
print("positive rate by region (0=5'UTR, 1=CDS, 2=3'UTR, NaN=non-coding/unknown):")
print(tr.label.groupby(A.ann_region.fillna(-1)).agg(["mean", "size"]).round(3).to_string())
bins = [-1e6, -1000, -200, 0, 200, 1000, 1e6]
print("\npositive rate by distance to the stop codon (nt):")
print(tr.label.groupby(pd.cut(A.ann_dist_stop, bins)).agg(["mean", "size"]).round(3).to_string())
print("\npositive rate by distance to the nearest exon junction (nt):")
print(tr.label.groupby(pd.cut(A.ann_dist_junction, [-1, 50, 100, 200, 500, 1e6])).agg(["mean", "size"]).round(3).to_string())
print("\npositive rate by last exon:")
print(tr.label.groupby(A.ann_in_last_exon).agg(["mean", "size"]).round(3).to_string())
chk.to_csv(RESULTS / "annotation_check.csv", index=False)
