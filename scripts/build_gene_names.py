"""Write viz/site/data/gene_names.json: Ensembl gene ID -> gene symbol, for the genes shown in the dashboard.

Usage (from the repo root):
    python scripts/build_gene_names.py --gtf Homo_sapiens.GRCh38.91.chr_patch_hapl_scaff.gtf.gz

The GTF is Ensembl release 91 (the release the model's annotation uses), downloaded from
https://ftp.ensembl.org/pub/release-91/gtf/homo_sapiens/ . It is ~45 MB and git-ignored; only the small JSON is
committed. The dashboard loads gene_names.json at startup, shows symbols next to gene IDs and lets users search by
symbol. Gene IDs stay the join key; symbols are display labels only.
"""
import argparse
import gzip
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GENE_ID = re.compile(r'gene_id "([^"]+)"')
GENE_NAME = re.compile(r'gene_name "([^"]+)"')
BIOTYPE = re.compile(r'gene_biotype "([^"]+)"')


def site_genes(site):
    """Gene IDs referenced by any dataset file in viz/site/data."""
    genes = set()
    for f in (site / "data").glob("*.json"):
        if f.name in {"manifest.json", "insights.json", "transcripts.json", "gene_names.json"}:
            continue
        data = json.loads(f.read_text())
        if isinstance(data.get("genes"), list):  # run, dataset and cell-line files
            genes.update(data["genes"])
        if "rows" in data and data.get("columns", [None, None, "gene"])[2] == "gene":  # atlas.json
            genes.update(r[2] for r in data["rows"] if r[2])
    return {g for g in genes if g}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--gtf", required=True, help="Ensembl 91 GTF (.gtf or .gtf.gz)")
    ap.add_argument("--site", default=str(ROOT / "viz" / "site"))
    a = ap.parse_args()

    names, biotypes = {}, {}
    opener = gzip.open if a.gtf.endswith(".gz") else open
    with opener(a.gtf, "rt") as fh:
        for line in fh:
            if line.startswith("#"):
                continue
            f = line.split("\t", 8)
            if len(f) < 9 or f[2] != "gene":
                continue
            gid, name = GENE_ID.search(f[8]), GENE_NAME.search(f[8])
            if gid and name:
                names[gid.group(1)] = name.group(1)
                bt = BIOTYPE.search(f[8])
                if bt:
                    biotypes[gid.group(1)] = bt.group(1)
    site = Path(a.site)
    wanted = site_genes(site)
    out = {g: names[g] for g in sorted(wanted) if g in names}
    missing = sorted(wanted - out.keys())
    path = site / "data" / "gene_names.json"
    path.write_text(json.dumps({"source": "Ensembl release 91 GTF (gene_name attribute)", "genes": out},
                               separators=(",", ":")))
    print(f"{len(names):,} genes in the GTF; {len(out):,} of {len(wanted):,} dashboard genes named; "
          f"{len(missing)} without a symbol{': ' + ', '.join(missing[:5]) if missing else ''}")
    print(f"wrote {path} ({path.stat().st_size / 1e3:.0f} kB)")


if __name__ == "__main__":
    main()
