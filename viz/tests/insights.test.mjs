// Checks the derived data written by scripts/build_viz_insights.py against the run files it was built from.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decodeDataset, decodeCellLines } from '../site/core.js';
import { thresholdIndex } from '../site/views.js';

const load = f => JSON.parse(fs.readFileSync(new URL(`../site/${f}`, import.meta.url)));
const manifest = load('data/manifest.json'), ins = load('data/insights.json'), atlas = load('data/atlas.json');
const runs = manifest.datasets.filter(d => d.group === 'sgnex');
const excluded = new Set(ins.excludedRuns);

// Limitation flags: the excluded run is flagged in the manifest and absent from every summary.
assert.ok(excluded.has('SGNex_MCF7_directRNA_replicate3_run1'), 'MCF7 rep 3 is excluded from summaries');
for (const id of excluded) assert.ok(runs.find(d => d.id === id)?.limitations?.includes('v1Fallback'), `${id} flagged v1Fallback`);
for (const id of ins.trainingOverlapRuns) assert.ok(runs.find(d => d.id === id)?.limitations?.includes('trainingOverlap'), `${id} flagged trainingOverlap`);
assert.ok(manifest.limitations?.v1Fallback && manifest.limitations?.trainingOverlap, 'limitation texts in manifest');

// Cell-line summaries are rebuilt without the excluded run: run counts and no versioned transcript IDs.
const lines = load('data/cell_lines.json');
assert.ok(lines.transcripts.every(t => !t.includes('.')), 'cell_lines.json has no versioned transcript IDs');
for (const d of manifest.datasets.filter(d => d.group === 'cellline')) {
  const usable = runs.filter(r => r.cellLine === d.cellLine && !excluded.has(r.id)).length;
  assert.equal(d.runs, usable, `${d.id} counts only usable runs`);
}
const byLine = decodeCellLines(lines);
assert.ok([...byLine.get('MCF7')].every(r => r.runs === 1), 'MCF7 summary uses one run');

// Per-run counts equal the run files.
let observations = 0;
for (const d of runs) {
  const rows = decodeDataset(load(d.dataFile), d.id), r = ins.perRun.find(q => q.id === d.id);
  assert.ok(r, `${d.id} in insights.perRun`);
  assert.equal(r.sites, rows.length, `${d.id} site count`);
  for (const [i, t] of ins.thresholds.entries()) assert.equal(r.calls[i], rows.filter(x => x.score >= t).length, `${d.id} calls at ${t}`);
  assert.ok(r.commonSites <= r.sharedSites && r.sharedSites <= r.sites, `${d.id} site-set sizes`);
  observations += rows.length;
}
assert.equal(ins.totals.observations, observations, 'total observations');
assert.equal(ins.totals.cleanObservations, observations - runs.filter(d => excluded.has(d.id)).reduce((n, d) => n + d.rows, 0), 'clean observations');
for (const r of ins.perRun.filter(r => !excluded.has(r.id))) assert.equal(r.commonSites, ins.totals.commonSites, `${r.id} measures every common site`);

// Landscape counts are internally consistent: pooled = sum of cell lines, calls <= sites, thresholds monotone.
const ti = thresholdIndex(.5);
for (const set of ['all', 'shared']) {
  const L = ins.landscape[set];
  for (const key of ['metagene', 'stop', 'junction']) {
    const pooled = L.All[key].n, sum = ins.cellLines.reduce((acc, c) => acc.map((v, i) => v + L[c][key].n[i]), pooled.map(() => 0));
    assert.deepEqual(pooled, sum, `${set} ${key}: pooled equals sum over cell lines`);
    assert.ok(L.All[key].calls[ti].every((c, i) => c <= pooled[i]), `${set} ${key}: calls within sites`);
    assert.ok(L.All[key].calls.every((row, i) => i === 0 || row.every((c, j) => c <= L.All[key].calls[i - 1][j])), `${set} ${key}: calls fall as the cutoff rises`);
  }
}
const motifTotal = ins.motifs.byCell.All.n.reduce((a, b) => a + b, 0);
assert.equal(motifTotal, ins.totals.cleanObservations, 'motif counts cover every clean observation');
assert.ok(ins.motifs.drach && ins.motifs.kmers.length === 18, 'all 18 DRACH 5-mers');

// Variance shares, run pairs, permutation table, calibration.
const v = ins.variance;
assert.ok(Math.abs(v.site + v.siteByCell + v.run - 1) < 1e-3, 'variance shares sum to 1');
assert.equal(ins.pairs.length, runs.length * (runs.length - 1) / 2, 'every run pair');
assert.ok(ins.differential.fdr.every(f => f.fdr >= 0 && f.observed >= 0), 'FDR table');
assert.ok(ins.differential.rows.every(r => r[13] >= 0.2), 'candidate differences have delta >= 0.2');
if (ins.calibration) {
  const c = ins.calibration;
  assert.equal(c.bins.reduce((n, b) => n + b.n, 0), c.observations, 'calibration bins cover every labelled observation');
  assert.ok(c.thresholds.every((t, i) => i === 0 || t.recall <= c.thresholds[i - 1].recall), 'recall falls as the cutoff rises');
}

// Atlas: robust and all-seven-line sites, no excluded run, consistent definitions.
assert.equal(atlas.rows.filter(r => r[9]).length, atlas.all7, 'atlas all-7 count');
assert.ok(atlas.rows.every(r => r[7] <= r[6] && r[6] <= runs.length - excluded.size), 'atlas run counts');
assert.ok(atlas.rows.filter(r => r[9]).every(r => r[8].every(m => m !== null && m >= 0.5)), 'all-7 sites have mean >= 0.5 in every line');
const tx = load('data/transcripts.json');
assert.ok(atlas.rows.every(r => tx.transcripts[r[0].split('.')[0]]), 'every atlas transcript has structure for the transcript map');
// Gene symbols: every gene shown in the atlas has a symbol, and keys are Ensembl gene IDs.
const names = load('data/gene_names.json').genes;
assert.ok(Object.keys(names).every(g => /^ENSG\d{11}$/.test(g)) && Object.values(names).every(n => typeof n === 'string' && n), 'gene_names.json maps ENSG IDs to symbols');
assert.ok(atlas.rows.every(r => !r[2] || names[r[2]]), 'every atlas gene has a symbol');
console.log(`PASS: insights (${ins.perRun.length} runs, ${excluded.size} excluded from summaries), cell-line summaries, landscape, motifs, pairs, calibration and atlas (${atlas.rows.length.toLocaleString()} sites) are consistent with the run files.`);
