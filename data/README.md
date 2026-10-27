# data/

Input data. Only the small test set in `sample/` is committed. The course datasets are too large for GitHub, and
`.gitignore` blocks them.

| Path | Committed? | What it is |
|---|---|---|
| `sample/sample.json.gz` | yes | **Test data for the prediction script**: the first 500 candidate sites of dataset0 in m6Anet `data.json` format (gzip-compressed) |
| `sample/sample.info` | yes | Labels for those 500 sites (`gene_id,transcript_id,transcript_position,label`), for a quick training test |
| `data0/` | no | Course training data (Hct116): `dataset0.json.gz` + `data.info.labelled` |
| `data1/`, `data2/` | no | Second labelled run, and the synthetic dataset with known modification fractions |
| `sgnex/` | no | Optional: a full SG-NEx run to test `predict.py` on (see [docs/HOW_TO_RUN.md](../docs/HOW_TO_RUN.md#4-optional-predict-on-a-full-sg-nex-run)) |

To use the full datasets, place them here so the folder looks like this:

```
data/
├── data0/
│   ├── data.info.labelled
│   └── dataset0.json.gz
├── data1/
│   ├── data.info
│   └── dataset1.json.gz
├── data2/
│   ├── data.info
│   └── dataset2.json.gz
└── sample/            <- committed: small test set
```

**On the AWS machine:** the data is stored once in `~/data/`. Link it into your clone:

```bash
for d in data0 data1 data2; do ln -s ~/data/$d data/$d; done
```

**On your laptop:** copy the three folders from the course "Team Project" folder into `data/`.

Keep the `.json.gz` files compressed; the code reads them directly with `gzip`.

## Formats

- `dataset*.json.gz`: one json object per line: `{transcript_id: {position: {7-mer: [[9 floats per read], ...]}}}`. The 9 floats are dwell time, SD and mean current at positions −1, 0, +1.
- `data.info*`: CSV with `gene_id, transcript_id, transcript_position, label` (data1 and data2 have no `gene_id`).

## sample/

`sample/sample.json.gz` and `sample/sample.info` are the first 500 sites of data0. They are the small test set for the prediction script: see [docs/HOW_TO_RUN.md](../docs/HOW_TO_RUN.md#2-predict-m6a-on-the-included-test-data).
