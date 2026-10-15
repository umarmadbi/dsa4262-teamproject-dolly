# Dolly RNA Modification Explorer

Interactive dashboard for m6A prediction scores, read coverage and shared-site comparisons across SG-NEx direct RNA-seq runs. Plain HTML/JS with no build step and no external frontend dependencies; the deployed site is exactly the contents of `site/`.

## How updates are published

Every push to `main` that touches `viz/` runs the tests and publishes `viz/site` to GitHub Pages (`.github/workflows/pages.yml`). Pull requests run the tests only. Nobody deploys by hand.

## Add or refresh SG-NEx predictions

1. Score a run with `scripts/predict.py`, writing `results/sgnex_v2/<run_id>.csv` (e.g. `SGNex_H9_directRNA_replicate4_run2.csv`).
2. From the repo root, rebuild the site data:

   ```bash
   python scripts/build_viz_data.py --predictions results/sgnex_v2 --sgnex data/sgnex --model models/m6a_model_v2.joblib
   ```

   This keeps sites with at least 20 reads (`--min-reads`), excludes SIRV/ERCC spike-ins, adds Ensembl 91 gene IDs from `resources/ensembl91_transcripts.csv.gz`, and rewrites `site/data/manifest.json`. The model label includes a hash of the model file so scores from different models are never silently mixed.
3. Commit `viz/site/data/` and open a pull request to `main`.

## Change the site

Edit files in `site/`, then preview locally:

```bash
python3 -m http.server 8000 --directory viz/site
```

Open http://localhost:8000 (serve over HTTP; ES modules do not load from `file://`). Run the tests with `node viz/tests/core.test.mjs`.

## Contents

- `site/` — the published page (`index.html`, `app.js`, `core.js`, `style.css`), `export_coverage.py` helper, and `data/` (manifest plus one compact JSON file per dataset).
- `tests/core.test.mjs` — data, parsing, import and join checks, including every SG-NEx run listed in the manifest.

The development datasets (dataset0-2) carry coverage only. SG-NEx runs carry site-level model scores. Browser imports (Data & imports) are kept in the browser only and are cleared on refresh; to add data permanently, use the build script above.

## Prediction contract

Import transcript_id,transcript_position,score for one existing sample. Scores must be finite numbers in [0,1]. Duplicate and unmatched site IDs are rejected. A model name/version is required. Score comparisons are enabled only when both sample model/version labels match; those labels are user-supplied provenance, not automatic proof of identical models.

Coverage files require transcript_id,transcript_position,n_reads (or read_count). Optional fields: sample_id,sequence,gene_id,gene_name,label,score. One sample per import. Gene annotation import requires transcript_id,gene_id and optional gene_name, with conflicts checked.

## Interpretation

Shared sites are matched by transcript ID and position under the chosen read-coverage filter. Use a common reference. Different transcript isoforms are not automatically merged. Missing measurements are not unmodified calls. Site observations can count the same coordinate in multiple samples; summed coverage is not a unique read count or expression estimate. Sequencing runs must not be treated as independent biological replicates.

Prediction scores are not read modification fractions. Calibration and cutoff selection require independent validation. The platform labels high scores as exploration results, not experimentally confirmed modifications.

## Validation

Run node tests/core.test.mjs. Tests check real data counts and overlap, CSV round trips and quotes, invalid data rejection and prediction joins. Browser layout QA is unavailable in the managed environment used for this build; test interactive rendering on your target browser.

## Source

https://github.com/GoekeLab/sg-nex-data
https://github.com/GoekeLab/sg-nex-data/blob/master/docs/AWS_data_access_tutorial.md
https://github.com/GoekeLab/sg-nex-data/blob/master/docs/SG-NEx_m6Anet_tutorial.md
