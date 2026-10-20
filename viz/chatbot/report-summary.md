# Reviewed report notes for Dolly's assistant

Source: user-supplied *Dolly Group Project report(1).pdf*, labelled first draft, sections 3–6. This is a selected summary, not the full report. Personal details, AI-use entries and unfinished placeholders are excluded. Results are reported findings, not independently rerun here.

- The report calls v1 the intermediate model and v2 the final model. A draft figure still uses older labels. Final leaderboard results are not supplied.
- The reported gene-grouped cross-validation PR AUC progresses from 0.502 for site-only LightGBM to 0.535 for v1 and 0.590 for v2. These are cross-validation scores, not the independent test results.
- Independent dataset0 held-out-gene ROC/PR AUC for v2: 0.952/0.561. Dataset1 unseen-transcript results: 0.877/0.434. Dataset1 unseen-gene results: 0.881/0.421. The report gives dataset0 gene-bootstrap 95% intervals of 0.941–0.962 (ROC) and 0.505–0.619 (PR).
- On synthetic dataset2, the reported median Dolly score is about 0.01 at 0% modification, rises to about 0.45 at 75% and then plateaus. A score is not a calibrated modification fraction. The synthetic transcripts use the fallback without annotation features.
- Limitations include cross-run batch effects, noisy labels, training on Hct116 only, annotation dependence, and dependence of neighbour features on having the surrounding candidate sites available. Feeding arbitrary fragments may change those features.
- Future work includes labelled data from more runs and cell lines, testing on genuinely unseen runs, estimating modification fractions, and coverage-matched comparisons.

## Interpretation boundaries

The report's claims about depth causing call-rate changes and biological similarity across cell lines should be treated as interpretations, not established causes or validated differential-modification results. High score correlation can reflect shared sequence/annotation features. Biological versus technical replication requires sample metadata; do not call every SG-NEx run a technical replicate. Agreement with m6Anet and expected positional enrichment do not establish accuracy on unlabelled SG-NEx data.

The current website guide takes precedence for navigation and filters. Do not invent missing leaderboard results, hosting links, or report placeholders.
