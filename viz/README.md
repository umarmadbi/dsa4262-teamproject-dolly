# Dolly RNA Modification Explorer

Interactive dashboard for m6A prediction scores, read coverage and shared-site comparisons across SG-NEx direct RNA-seq runs. Plain HTML/JS with no build step; the optional AI guide loads Cloudflare Turnstile only when configured and opened; the deployed site is exactly the contents of `site/`.

## View it

The public [Dolly RNA Explorer](https://umarmadbi.github.io/dsa4262-teamproject-dolly/) currently serves the last published version. Preview this branch's newer visualisation locally. From the repo folder:

```bash
python3 -m http.server 8000 --directory viz/site     # Windows: py -m http.server 8000 --directory viz/site
```

and open http://localhost:8000. Step-by-step instructions for Windows and macOS, downloading the repo without git, and
troubleshooting are in section 7 of the [main README](../README.md#7-the-interactive-visualisation).

## How updates are published

During the student-evaluation freeze, push visualisation work only to your working branch. Do not open a pull request to `main`, merge into `main`, or pull/merge `main` into this branch. The team maintainer will integrate the work for 8 November. Pushing this branch does not update the public website.

This branch combines the `viz/` snapshot from `umar-visualisation` (`08683ef`) with the chatbot connection settings and backend guide from `docs/dolly-guide-and-hosting`. Changes are confined to `viz/`; the two newer data-builder scripts (`scripts/build_viz_insights.py`, `scripts/build_gene_names.py`) and `docs/sgnex_task2_findings.md` remain on Umar's branch. The committed site data is ready to use without rebuilding. Obtain those scripts from that branch before following the rebuild instructions below.

The chatbot Worker is deployed separately through Wrangler. Updating or pushing its knowledge file does not change the live assistant until the Worker is redeployed by its Cloudflare account owner.

## Add or refresh SG-NEx predictions

1. Score a run with `scripts/predict.py`, writing `results/sgnex_v2/<run_id>.csv` (e.g. `SGNex_H9_directRNA_replicate4_run2.csv`).
2. From the repo root, rebuild the site data:

   ```bash
   python scripts/build_viz_data.py --predictions results/sgnex_v2 --sgnex data/sgnex --model models/m6a_model_v2.joblib
   ```

   This keeps sites with at least 20 reads (`--min-reads`), excludes SIRV/ERCC spike-ins, adds Ensembl 91 gene IDs from `resources/ensembl91_transcripts.csv.gz`, writes the cell-line summary `site/data/cell_lines.json`, and rewrites `site/data/manifest.json` with precomputed statistics for every dataset. The model label includes a hash of the model file so scores from different models are never silently mixed.
3. Commit `viz/site/data/`, run the tests below, and push your working branch for the team maintainer to integrate after the freeze.

## Rebuild the insight views (Landscape, calibration, reproducibility, atlas)

After `build_viz_data.py`, from the repo root:

```bash
python scripts/build_viz_insights.py --labels-d0 data/data0/data.info.labelled --labels-d1 data/data1/data.info
```

This reads only the run files in `site/data/` and `resources/ensembl91_transcripts.csv.gz` (about 3 minutes) and writes:

| File | Used by |
|---|---|
| `site/data/insights.json` | Overview (calibration, call-rate panels, shared-site mode), Landscape, Compare (fair comparison, reproducibility, candidate differences) |
| `site/data/atlas.json` | Site explorer › High-confidence atlas |
| `site/data/transcripts.json` | Site explorer transcript map (CDS, UTRs, exon junctions) |
| `site/data/cell_lines.json`, `manifest.json` | Rebuilt cell-line summaries without excluded runs, plus limitation flags per run |
| `site/data/gene_names.json` | Gene symbols (built separately by `scripts/build_gene_names.py`, see below) |

Without the two label files, the calibration block of the existing `insights.json` is kept. The Dolly v2 vs m6Anet panel shows the summary numbers of `experiments/12_sgnex_m6anet_compare.py` and its figure (`site/data/sgnex_m6anet_comparison.png`). Per-site m6Anet scores are on the AWS machine. Every number is explained in `docs/sgnex_task2_findings.md`.

### Gene symbols

`site/data/gene_names.json` maps Ensembl gene IDs to symbols for every gene in the site. The site loads it at startup, shows symbols next to gene IDs and lets users search by symbol. IDs stay the join keys. To rebuild it, download the Ensembl 91 GTF ([Homo_sapiens.GRCh38.91.chr_patch_hapl_scaff.gtf.gz](https://ftp.ensembl.org/pub/release-91/gtf/homo_sapiens/), about 45 MB, git-ignored) into the repo root and run:

```bash
python scripts/build_gene_names.py --gtf Homo_sapiens.GRCh38.91.chr_patch_hapl_scaff.gtf.gz
```

### Known limitation: MCF7 replicate 3 run 1

`SGNex_MCF7_directRNA_replicate3_run1` uses versioned transcript IDs (`ENST….7`). `predict.py` matches the Ensembl 91 annotation by exact ID, so every site in this run was scored by v2's fallback model (equivalent to v1, without transcript-structure features). The team decided not to re-score it and to report it as a dataset limitation. `build_viz_insights.py` therefore flags it (`limitations: ["v1Fallback"]` in `manifest.json`) and leaves it out of every summary (`--exclude-from-summaries`). The site keeps it visible with a hollow, dashed marker and a warning badge. `Hct116 rep 3 run 1` is flagged `trainingOverlap` (it may share reads with the training data).

Run both test files after rebuilding: `node viz/tests/core.test.mjs && node viz/tests/insights.test.mjs`.

## Change the site

Edit files in `site/`, then preview locally:

```bash
python3 -m http.server 8000 --directory viz/site
```

Open http://localhost:8000 (serve over HTTP; ES modules do not load from `file://`). Run the tests with `node viz/tests/core.test.mjs`.

## How data loads

The page fetches only `manifest.json` at startup. The overview (metrics, histograms, per-run bars, cell-line panel) is drawn from statistics precomputed per dataset at minimum-read thresholds of 20, 40, 80 and 160, so it needs no site data. A run's site file is fetched when it is opened in Site explorer or Compare samples and is then kept for the session.

`cell_lines.json` holds every site whose mean score across a cell line's runs reaches 0.5 (`--cell-line-min-score`) in at least one cell line, with the mean score, mean reads and number of runs in every cell line where it was measured. Each cell line appears as a "Cell-line summary" sample, so Site explorer can look up a gene across cell lines and Compare samples can compare cell lines directly. Sites below the threshold everywhere are not in the summary; open individual runs to see them.

## Contents

- `site/` — the published page (`index.html`, `app.js`, `views.js` for the insight charts, `core.js`, `style.css`), `export_coverage.py` helper, and `data/` (manifest with precomputed statistics, one compact JSON file per dataset, and `cell_lines.json`).
- `tests/core.test.mjs` — data, parsing, import and join checks; also checks that every dataset's precomputed statistics equal what the browser computes from its rows.
- `tests/insights.test.mjs` — checks `insights.json`, `atlas.json` and the rebuilt cell-line summaries against the run files, including that the excluded run is absent from every summary.

The development datasets (dataset0-2) are excluded from the current interface. SG-NEx runs carry site-level model scores. Browser imports (Data & imports) are kept in the browser only and are cleared on refresh; to add data permanently, use the build script above.

## Prediction contract

Import transcript_id,transcript_position,score for one existing sample. Scores must be finite numbers in [0,1]. Duplicate and unmatched site IDs are rejected. A model name/version is required. Score comparisons are enabled only when both sample model/version labels match; those labels are user-supplied provenance, not automatic proof of identical models.

Coverage files require transcript_id,transcript_position,n_reads (or read_count). Optional fields: sample_id,sequence,gene_id,gene_name,label,score. One sample per import. Gene annotation import requires transcript_id,gene_id and optional gene_name, with conflicts checked.

## Interpretation

Shared sites are matched by transcript ID and position under the chosen read-coverage filter. Use a common reference. Different transcript isoforms are not automatically merged. Missing measurements are not unmodified calls. Site observations can count the same coordinate in multiple samples; summed coverage is not a unique read count or expression estimate. Sequencing runs must not be treated as independent biological replicates.

Prediction scores are not read modification fractions. Calibration and cutoff selection require independent validation. The platform labels high scores as exploration results, not experimentally confirmed modifications.

## Validation

Run node tests/core.test.mjs and node tests/insights.test.mjs. Tests check real data counts and overlap, CSV round trips and quotes, invalid data rejection and prediction joins. Browser layout QA is unavailable in the managed environment used for this build; test interactive rendering on your target browser.

## Source

https://github.com/GoekeLab/sg-nex-data
https://github.com/GoekeLab/sg-nex-data/blob/master/docs/AWS_data_access_tutorial.md
https://github.com/GoekeLab/sg-nex-data/blob/master/docs/SG-NEx_m6Anet_tutorial.md

## Optional AI research guide

The floating **Ask Dolly** guide explains reviewed methods, results and website use. It is configured to use the deployed Cloudflare Worker and Gemini. It does not inspect live chart data or run predictions. Local edits to `chatbot/knowledge.mjs` affect the live assistant only after a separate Worker deployment. Deployment, secrets, costs and privacy are documented in [chatbot/README.md](chatbot/README.md). Run its mock-only checks with `node --test viz/chatbot/worker.test.mjs`.


## Homepage design previews

Home & guide has a temporary two-option switch: **RNA strand** and **Research pass**. Both share the same introduction and guide below. The dependency-free `site/home-hero.js` and `site/home-hero.css` implement an illustrative canvas RNA strand (drag or arrow keys to rotate; select numbered points or topic buttons) and a perspective badge (drag to swing; click, Enter or Space to flip; left/right arrows to tilt). These are illustrations, not sample measurements. Pause motion stops idle movement and headline typing; reduced-motion preferences start with motion paused. The homepage pauses animation updates when it is offscreen or the browser tab is hidden. No chart selections, predictions or chatbot deployment are changed by these previews.
