# viz/tests/

| File | What it checks |
|---|---|
| `insights.test.mjs` | Checks `insights.json`, `atlas.json` and the rebuilt cell-line summaries against the run files, including that the excluded run (MCF7 rep 3) is absent from every summary |
| `core.test.mjs` | Tests for `viz/site/core.js` using the real data files: CSV parsing and round trips, decoding of the data files, rejection of invalid imports, prediction joins, sample comparison, and that each dataset's precomputed statistics in `manifest.json` equal what the browser computes from its rows |

Run from the repo root (needs Node.js 18 or newer):

```bash
node viz/tests/core.test.mjs
node viz/tests/insights.test.mjs
```

GitHub Actions (`.github/workflows/pages.yml`) runs both on every push and pull request that touches `viz/`, and only
publishes the website if it passes. The chatbot's own tests are in `viz/chatbot/worker.test.mjs`.
