# Dolly RNA Modification Explorer

Interactive dashboard for m6A prediction scores, read coverage and shared-site comparisons across SG-NEx direct RNA-seq runs (Task 2). Plain HTML/JS with no build step; the optional AI guide loads Cloudflare Turnstile only when configured and opened; the deployed site is exactly the contents of `site/`.

| Folder / file | What it is |
|---|---|
| [`site/`](site/README.md) | The website itself (HTML, JavaScript, CSS) and its data files in `site/data/` |
| [`tests/`](tests/README.md) | Node tests for the website's data functions, run by GitHub Actions before each deployment |
| [`chatbot/`](chatbot/README.md) | Backend for the "Ask Dolly" research guide: a Cloudflare Worker that calls Google Gemini, its reviewed knowledge base and its tests |

The GitHub Actions workflow that tests and publishes `site/` is `.github/workflows/pages.yml` at the repo root.

## View it

Open the public [Dolly RNA Explorer](https://umarmadbi.github.io/dsa4262-teamproject-dolly/). No local installation is needed. For local development, run this from the repo folder:

```bash
python3 -m http.server 8000 --directory viz/site     # Windows: py -m http.server 8000 --directory viz/site
```

and open http://localhost:8000. Step-by-step instructions, including viewing it from an AWS machine and
troubleshooting, are in section 7 of [docs/HOW_TO_RUN.md](../docs/HOW_TO_RUN.md#7-open-the-interactive-visualisation).

## How updates are published

Pushes to `main` that touch `viz/` or `.github/workflows/pages.yml` run the dashboard tests and publish `viz/site` to GitHub Pages after they pass. Pull requests run tests only. The Visualisation workflow also supports manual runs. The chatbot Worker is deployed separately through Wrangler; a Pages deployment does not update its code or knowledge.

## Add or refresh SG-NEx predictions

1. Score a run with `scripts/predict.py`, writing `results/sgnex_v2/<run_id>.csv` (e.g. `SGNex_H9_directRNA_replicate4_run2.csv`).
2. From the repo root, rebuild the site data:

   ```bash
   python scripts/build_viz_data.py --predictions results/sgnex_v2 --sgnex data/sgnex --model models/m6a_model_v2.joblib
   ```

   This keeps sites with at least 20 reads (`--min-reads`), excludes SIRV/ERCC spike-ins, adds Ensembl 91 gene IDs from `resources/ensembl91_transcripts.csv.gz`, writes the cell-line summary `site/data/cell_lines.json`, and rewrites `site/data/manifest.json` with precomputed statistics for every dataset. The model label includes a hash of the model file so scores from different models are never silently mixed.
3. Commit `viz/site/data/` and open a pull request to `main`.

## Change the site

Edit files in `site/`, then preview locally:

```bash
python3 -m http.server 8000 --directory viz/site
```

Open http://localhost:8000 (serve over HTTP; ES modules do not load from `file://`). Run the tests with `node viz/tests/core.test.mjs`.

## How data loads

The page fetches only `manifest.json` at startup. The overview (metrics, histograms, per-run bars, cell-line panel) is drawn from statistics precomputed per dataset at minimum-read thresholds of 20, 40, 80 and 160, so it needs no site data. A run's site file is fetched when it is opened in Site explorer or Compare samples and is then kept for the session.

`cell_lines.json` holds every site whose mean score across a cell line's runs reaches 0.5 (`--cell-line-min-score`) in at least one cell line, with the mean score, mean reads and number of runs in every cell line where it was measured. Each cell line appears as a "Cell-line summary" sample, so Site explorer can look up a gene across cell lines and Compare samples can compare cell lines directly. Sites below the threshold everywhere are not in the summary; open individual runs to see them.

## Notes on the data

The development datasets (dataset0-2) are excluded from the current interface. SG-NEx runs carry site-level model scores. Browser imports (Data & imports) are kept in the browser only and are cleared on refresh; to add data permanently, use the build script above.

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

## Ask Dolly: the AI research guide

The dashboard includes **Dolly**, a chatbot that helps researchers understand the project's methods, documented findings and website features.

Open the **[Dolly RNA Explorer](https://umarmadbi.github.io/dsa4262-teamproject-dolly/)** and click the sheep button in the bottom-right corner.

Example questions:

- "What does an m6A prediction score mean?"
- "How does the v2 model work?"
- "How should I compare cell lines?"

Dolly answers using reviewed project documentation and includes source references. It currently **cannot read live charts, access selected samples or filters, run analyses, or generate new m6A predictions**. Answers may contain mistakes and should be checked against the cited sources.

The website is hosted on **GitHub Pages**, while a **Cloudflare Worker** connects the chatbot to **Google Gemini**. API credentials are stored as Cloudflare secrets and are not included in the website code.

Questions and recent conversation history are sent to Cloudflare and Google Gemini. Chat history is kept in the browser tab and cleared on refresh or when the user selects **Clear chat**. Users should not enter credentials or private data.

For backend setup, configuration, testing and maintenance, see **[the chatbot guide](chatbot/README.md)**.

Run the chatbot's mock-only checks with `node --test viz/chatbot/worker.test.mjs`.
