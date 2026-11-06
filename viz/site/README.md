# viz/site/

The **Dolly RNA Explorer** website (Task 2). Plain HTML, CSS and JavaScript with no build step: the files here are
exactly what GitHub Pages publishes at <https://umarmadbi.github.io/dsa4262-teamproject-dolly/>.

| File | What it does |
|---|---|
| `index.html` | Page layout: the Home landing screen, Overview, Landscape, Site explorer, Compare samples, Data & imports and the guide pages |
| `app.js` | Page logic: loads the data, draws the charts and tables, handles filters, imports and exports |
| `views.js` | Renders the insight views (Landscape, calibration, reproducibility, high-confidence atlas, transcript map) from `insights.json`, `atlas.json` and `transcripts.json` |
| `core.js` | Pure data functions (CSV parsing, decoding the data files, filtering, sample comparison, summary statistics). Kept separate so `viz/tests/` can test them without a browser |
| `style.css` | Styling for the whole page |
| `home-hero.js`, `home-hero.css` | The Home landing screen: the rotating textured RNA illustration (artistic, not real data), its navigation links and the background particles |
| `home-molecule.js` | The alternative "Molecular model" illustration for the Home screen |
| `tour.js`, `tour.css` | The optional guided tour ("Take a tour" button) |
| `chat.js`, `chat.css` | The "Ask Dolly" chat button and panel |
| `chat-config.js` | Public settings for the chat: the Cloudflare Worker URL and the Turnstile site key. Never put secrets here |
| `export_coverage.py` | Standalone helper: turns an m6Anet `data.json` into a coverage CSV that can be imported on the Data & imports page (standard library only) |
| `data/` | The data the page loads (below) |

## data/

Built by `scripts/build_viz_data.py`, then `scripts/build_viz_insights.py` and `scripts/build_gene_names.py` (see [viz/README.md](../README.md)); do not edit by hand.

| File | What it is |
|---|---|
| `manifest.json` | List of all datasets with precomputed summary statistics. The only file loaded at start-up |
| `SGNex_<cell line>_directRNA_replicate<r>_run<n>.json` | v2 scores, read counts and 7-mers for one SG-NEx run (23 files, 7 cell lines). Loaded when the run is opened |
| `cell_lines.json` | Per-cell-line summary of sites scoring at least 0.5 in some cell line (MCF7 rep 3 excluded, see the known limitation in [viz/README.md](../README.md)) |
| `insights.json` | Summary statistics for the Overview, Landscape and Compare views (calibration, call rates, motifs, run pairs) |
| `atlas.json` | High-confidence site atlas: robustly called sites and sites called in all seven cell lines |
| `transcripts.json` | Transcript structure (CDS, UTRs, exon junctions) for the transcript map |
| `gene_names.json` | Ensembl gene ID to gene symbol, for display and symbol search |
| `sgnex_m6anet_comparison.png` | Dolly v2 vs m6Anet summary figure from experiment 12, shown in the comparison panel |
| `dataset0.json`, `dataset1.json`, `dataset2.json` | The course datasets, used by the tests |

## Run it locally

From the repo root: `python3 -m http.server 8000 --directory viz/site` (Windows: `py -m ...`), then open
http://localhost:8000. Opening `index.html` by double-clicking does not work, because the browser blocks the data files.
