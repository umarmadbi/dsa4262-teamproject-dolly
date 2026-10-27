# resources/

Small reference files that the model needs at run time. They are committed so `predict.py` works without downloading
anything.

| File | What it is |
|---|---|
| `ensembl91_transcripts.csv.gz` | One row per Ensembl 91 transcript: `transcript_id, gene_id, biotype, tx_len, cds_start, stop_start, exon_ends` in transcript coordinates. v2 uses it for the transcript-structure features (distance to the stop codon, exon junctions, region). `train.py` also uses it to look up gene IDs when a labels file has none |

It was built from the Ensembl 91 GTF (`Homo_sapiens.GRCh38.91.chr_patch_hapl_scaff.gtf.gz`) with
`scripts/build_annotation.py`. Ensembl 91 is the release whose transcript sequences match the 7-mers in the course
data, checked in `experiments/09_annotation_check.py`.
