# Data

The datasets are **not committed** (they are too large for GitHub and `.gitignore` blocks them). Place them here so the folder looks like this:

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

`sample/sample.json.gz` and `sample/sample.info` are the first 500 sites of data0. They are the small test set for demonstrating the prediction script in the README.
