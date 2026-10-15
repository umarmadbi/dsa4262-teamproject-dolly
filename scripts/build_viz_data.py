"""Build the interactive visualisation's data files from SG-NEx predictions.

Usage (from the repo root):
    python scripts/build_viz_data.py --predictions results/sgnex_v2 \
                                     --sgnex data/sgnex \
                                     --model models/m6a_model_v2.joblib

For every predictions CSV named <run_id>.csv (output of scripts/predict.py,
e.g. SGNex_H9_directRNA_replicate4_run2.csv) this joins the scores with the
run's read counts (data.readcount) and 7-mer context (data.json), keeps sites
with at least --min-reads reads, and writes viz/site/data/<run_id>.json.
viz/site/data/manifest.json is then rewritten: development datasets are kept
as they are, SG-NEx entries are regenerated from the files built here.

Commit the changed files under viz/site/data and push to main; the GitHub
Actions workflow publishes the site.
"""
import argparse
import csv
import gzip
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUN_ID = re.compile(r"^SGNex_(?P<cell>[^_]+)_directRNA_replicate(?P<rep>\d+)_run(?P<run>\d+)$")
JSON_KEY = re.compile(r'^\{"([^"]+)":\{"(\d+)":\{"([ACGTN]+)"')


def read_counts(run_dir):
    with open(run_dir / "data.readcount") as f:
        return {(r["transcript_id"], int(r["transcript_position"])): int(r["n_reads"]) for r in csv.DictReader(f)}


def sequences(run_dir):
    """7-mer context per site, read from the start of each data.json line."""
    seqs = {}
    with open(run_dir / "data.json") as f:
        for line in f:
            m = JSON_KEY.match(line)
            if m:
                seqs[(m[1], int(m[2]))] = m[3]
    return seqs


def gene_map(path):
    if not path or not Path(path).exists():
        print(f"warning: annotation {path} not found; gene IDs will be blank")
        return {}
    with gzip.open(path, "rt") as f:
        return {r["transcript_id"]: r["gene_id"] for r in csv.DictReader(f)}


def build_run(pred_csv, run_dir, genes_by_tx, min_reads):
    reads, seqs = read_counts(run_dir), sequences(run_dir)
    tx_idx, gene_idx, seq_idx = {}, {}, {}
    data = {"transcripts": [], "genes": [], "transcriptGenes": [], "sequences": [], "sites": []}
    stats = {"predicted": 0, "spikeInExcluded": 0, "belowMinReads": 0}
    with open(pred_csv) as f:
        for r in csv.DictReader(f):
            tx, pos, score = r["transcript_id"], int(r["transcript_position"]), float(r["score"])
            stats["predicted"] += 1
            if not tx.startswith("ENST"):  # SIRV / ERCC spike-ins
                stats["spikeInExcluded"] += 1
                continue
            n = reads.get((tx, pos), 0)
            if n < min_reads:
                stats["belowMinReads"] += 1
                continue
            if not 0 <= score <= 1:
                raise ValueError(f"{pred_csv}: score {score} outside [0, 1] at {tx}:{pos}")
            if tx not in tx_idx:
                tx_idx[tx] = len(data["transcripts"])
                data["transcripts"].append(tx)
                g = genes_by_tx.get(tx.split(".")[0])
                if g and g not in gene_idx:
                    gene_idx[g] = len(data["genes"])
                    data["genes"].append(g)
                data["transcriptGenes"].append(gene_idx[g] if g else -1)
            s = seqs.get((tx, pos), "")
            if s not in seq_idx:
                seq_idx[s] = len(data["sequences"])
                data["sequences"].append(s)
            data["sites"].append([tx_idx[tx], pos, n, seq_idx[s], None, round(score, 5)])
    if not data["sites"]:
        raise ValueError(f"{pred_csv}: no sites with at least {min_reads} reads")
    n_reads = sorted(s[2] for s in data["sites"])
    stats.update(rows=len(n_reads), transcripts=len(data["transcripts"]), genes=len(data["genes"]),
                 medianReads=n_reads[len(n_reads) // 2], minReads=n_reads[0], maxReads=n_reads[-1])
    return data, stats


def model_label(name, model_path):
    if model_path and Path(model_path).exists():
        digest = hashlib.sha256(Path(model_path).read_bytes()).hexdigest()[:12]
        return f"{name} ({Path(model_path).name}, sha256 {digest})"
    return name


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--predictions", default=str(ROOT / "results" / "sgnex_v2"), help="folder of <run_id>.csv predictions")
    ap.add_argument("--sgnex", default=str(ROOT / "data" / "sgnex"), help="folder of SG-NEx run folders (data.json, data.readcount)")
    ap.add_argument("--annotation", default=str(ROOT / "resources" / "ensembl91_transcripts.csv.gz"))
    ap.add_argument("--model", default=str(ROOT / "models" / "m6a_model_v2.joblib"), help="model file, hashed into the label")
    ap.add_argument("--model-name", default="Dolly v2")
    ap.add_argument("--min-reads", type=int, default=20)
    ap.add_argument("--site", default=str(ROOT / "viz" / "site"))
    a = ap.parse_args()

    data_dir = Path(a.site) / "data"
    manifest_path = data_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    label = model_label(a.model_name, a.model)
    genes_by_tx = gene_map(a.annotation)

    runs = []
    for pred_csv in sorted(Path(a.predictions).glob("SGNex_*.csv")):
        run_id = pred_csv.stem
        m, run_dir = RUN_ID.match(run_id), Path(a.sgnex) / run_id
        if not m or not run_dir.is_dir():
            print(f"skip {pred_csv.name}: {'unrecognised run id' if not m else f'no folder {run_dir}'}")
            continue
        data, stats = build_run(pred_csv, run_dir, genes_by_tx, a.min_reads)
        (data_dir / f"{run_id}.json").write_text(json.dumps(data, separators=(",", ":")))
        runs.append({
            "id": run_id, "name": f"{m['cell']} · rep {m['rep']} · run {m['run']}", "cellLine": m["cell"],
            "replicate": m["rep"], "run": m["run"], "group": "sgnex",
            **{k: stats[k] for k in ("rows", "transcripts", "genes", "medianReads", "minReads", "maxReads")},
            "source": f"SG-NEx m6Anet-processed data.json ({run_id})", "dataFile": f"data/{run_id}.json", "model": label,
            "description": (f"SG-NEx direct RNA-seq run with {a.model_name} site-level scores. Sites with fewer than "
                            f"{a.min_reads} reads ({stats['belowMinReads']:,} of {stats['predicted']:,} predicted) "
                            "and SIRV/ERCC spike-ins are excluded."),
            "annotationNote": ("Gene IDs from Ensembl 91 transcript annotation; gene names are not available. "
                               "Model trained on Hct116 only, so scores in other cell lines may be affected by cell-line shift."),
        })
        print(f"{run_id}: {stats['rows']:,} sites kept of {stats['predicted']:,}")

    built = {r["id"] for r in runs}
    manifest["datasets"] = [d for d in manifest["datasets"] if d.get("group") != "sgnex"] + runs
    catalog_ids = {c["id"] for c in manifest["catalog"]}
    for r in runs:
        if r["id"] not in catalog_ids:
            manifest["catalog"].append({"id": r["id"], "cellLine": r["cellLine"], "replicate": r["replicate"], "run": r["run"]})
    for c in manifest["catalog"]:
        c["loaded"] = c["id"] in built
    manifest["dataMode"] = "coverage_with_predictions" if runs else "coverage_only"
    manifest["notes"] = f"Development datasets are not SG-NEx runs. {len(runs)} SG-NEx run(s) carry {a.model_name} predictions."
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"wrote {manifest_path} ({len(runs)} SG-NEx runs)")


if __name__ == "__main__":
    main()
