import { parseCSV, validateCoverage, attachPredictions, decodeDataset, decodeCellLines, filterRows,
  compareSamples, toCSV, sampleStats, combineStats, aboveCutoff, readThresholds } from './core.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => Number(n).toLocaleString('en-US');
const state = { samples: [], catalog: [], rows: [], page: 'overview', tablePage: 0,
  sort: 'n_reads', descending: true, filtered: [], comparison: null, cutoff: .5,
  selectedSamples: null, annotations: new Map(), tokens: { explorer: 0, compare: 0, genes: 0 } };
const loads = new Map();
let toastTimer, searchTimer;

let exploredSampleTimer;
function highlightExploredSample(){
  const selector=$('site-sample');
  clearTimeout(exploredSampleTimer);
  selector.classList.add('sample-selection-highlight');
  selector.focus({preventScroll:true});
  notify('Now viewing: '+shortName(selector.value)+'. The sample selector has been updated.');
  exploredSampleTimer=setTimeout(()=>selector.classList.remove('sample-selection-highlight'),5500);
}
function notify(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 5500); }
function download(text, filename, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement('a');
  a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 3000);
}
function sample(id) { return state.samples.find(s => s.id === id); }
function shortName(id) { const s = sample(id); return s?.name ?? id; }
function sampleRows(id) { return sample(id)?.data ?? []; }
function cellLineIds() { return state.samples.filter(s => s.group === 'cellline').map(s => s.id); }
function scoreCount() { return state.samples.filter(s => s.group !== 'cellline').reduce((n, s) => n + s.scoredTotal, 0); }
function sourceTag(s) { return { development: 'Development data', sgnex: 'SG-NEx run', cellline: 'Cell-line summary' }[s.group] ?? 'Imported sample'; }
function setStats(s) { s.stats = sampleStats(s.data); s.rows = s.data.length; s.scoredTotal = s.data.reduce((n, r) => n + (r.score !== null), 0); }

// Site rows are fetched only when a view needs them, then kept. All cell-line summaries share one file.
function annotate(rows) {
  if (!state.annotations.size) return rows;
  return rows.map(r => { const a = state.annotations.get(r.transcript_id); return a ? { ...r, gene_id: a[0], gene_name: a[1] || r.gene_name } : r; });
}
function loadOne(s) {
  if (!loads.has(s.dataFile)) loads.set(s.dataFile, fetch(s.dataFile).then(res => {
    if (!res.ok) throw new Error(`Could not load ${s.name}.`);
    return res.json();
  }).then(json => {
    if (s.group === 'cellline') {
      const byLine = decodeCellLines(json);
      for (const c of state.samples.filter(x => x.group === 'cellline')) c.data = annotate(byLine.get(c.cellLine) ?? []);
    } else s.data = annotate(decodeDataset(json, s.id));
  }).catch(error => { loads.delete(s.dataFile); throw error; }));
  return loads.get(s.dataFile);
}
async function ensureLoaded(ids) {
  const need = ids.map(sample).filter(s => s && !s.data);
  if (need.length) await Promise.all(need.map(loadOne));
}
function metric(label, value, foot, pending = false) {
  return `<div class="metric${pending ? ' pending' : ''}"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div><div class="metric-foot">${esc(foot)}</div></div>`;
}

const groupNames = [['cellline', 'Cell-line summaries'], ['sgnex', 'SG-NEx runs'], ['development', 'Development data'], ['imported', 'Imported samples']];
function sampleOptions(groups) {
  return groupNames.filter(([g]) => groups.includes(g)).map(([g, label]) => {
    const items = state.samples.filter(s => s.group === g);
    return items.length ? `<optgroup label="${esc(label)}">${items.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</optgroup>` : '';
  }).join('');
}
function refreshOptions() {
  const all = ['cellline', 'sgnex', 'development', 'imported'], noSummaries = all.slice(1);
  const lists = { 'site-sample': [cellLineIds().length ? '<option value="cellline_all">All cell lines · summary</option>' : '', all],
    'compare-a': ['', all], 'compare-b': ['', all], 'prediction-sample': ['', noSummaries] };
  for (const [id, [extra, groups]] of Object.entries(lists)) {
    const el = $(id), old = el.value;
    el.innerHTML = extra + sampleOptions(groups);
    if ([...el.options].some(o => o.value === old)) el.value = old;
  }
  renderSamplePicker();
  const lines = cellLineIds();
  if (lines.length > 1 && !state.compareChosen) { $('compare-a').value = lines[0]; $('compare-b').value = lines[1]; }
  if ($('compare-a').value === $('compare-b').value && state.samples.length > 1) $('compare-b').value = [...$('compare-b').options].find(o => o.value !== $('compare-a').value)?.value;
  const cells = [...new Set(state.catalog.map(s => s.cellLine))].sort();
  $('catalog-cell').innerHTML = '<option value="all">All cell lines</option>' + cells.map(c => `<option>${esc(c)}</option>`).join('');
  $('sample-id-suggestions').innerHTML = state.catalog.map(s => `<option value="${esc(s.id)}">`).join('');
  const scored = scoreCount();
  $('model-state').textContent = scored ? `Coverage + ${fmt(scored)} prediction scores` : 'Coverage only · model pending';
  $('model-state').classList.toggle('ready', Boolean(scored));
  $('sidebar-status').textContent = scored ? 'Prediction scores loaded' : 'Coverage workspace';
}

// Stable cell-line colours; run shades distinguish samples within each family.
const cellHues = { A549: 240, H9: 213, HEYA8: 274, Hct116: 25, HepG2: 338, K562: 185, MCF7: 46 };
function cellColour(cell, lightness = 38) {
  return `hsl(${cellHues[cell] ?? 160} 52% ${lightness}%)`;
}

function overviewSamples() {
  return state.samples.filter(s => s.group !== 'cellline' &&
    (state.selectedSamples === null || state.selectedSamples.has(s.id)));
}
function renderSamplePicker() {
  const groups = new Map();
  for (const s of state.samples.filter(s => s.group !== 'cellline')) {
    const key = s.group === 'development' ? 'Development datasets' : (s.cellLine || 'Other samples');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  $('sample-checkboxes').innerHTML = [...groups].map(([name, samples]) =>
    `<fieldset class="sample-choice-group"><legend>${esc(name)}</legend>${samples.map(s =>
      `<label class="sample-choice"><input type="checkbox" data-sample-id="${esc(s.id)}"><span>${esc(s.name)}</span></label>`).join('')}</fieldset>`).join('');
  syncSamplePicker();
}
function syncSamplePicker() {
  const available = state.samples.filter(s => s.group !== 'cellline'), selected = overviewSamples();
  $('sample-picker-label').textContent = selected.length === available.length && available.length
    ? 'All runs and datasets' : selected.length === 1 ? selected[0].name : `${selected.length} samples selected`;
  $('sample-selection-count').textContent = `${selected.length} of ${available.length} selected`;
  $('sample-checkboxes').querySelectorAll('[data-sample-id]').forEach(input => {
    input.checked = state.selectedSamples === null || state.selectedSamples.has(input.dataset.sampleId);
  });
}

function hBars(entries) {
  const max = Math.max(1, ...entries.map(e => e.value));
  if (!entries.length) return '<div class="empty-chart">No sites match these filters.</div>';
  return '<div class="hbars">' + entries.map(e => `<div class="bar-row" tabindex="0" aria-label="${esc(e.name)}: ${fmt(e.value)} candidate sites"><span class="bar-name" title="${esc(e.name)}">${esc(e.name)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(0, e.value / max * 100)}%;--sample-colour:${e.group === 'development' ? '#21957e' : cellColour(e.cellLine)}"></div></div><span class="bar-count">${fmt(e.value)}</span></div>`).join('') + '</div>';
}

function histogram(counts, labels, scored = false) {
  const max = Math.max(1, ...counts);
  return `<div class="histogram${scored ? ' scored' : ''}" role="group" aria-label="${scored ? 'Prediction score distribution' : 'Read coverage distribution'}">` + counts.map((n,i) => `<div class="hist-bin" tabindex="0" role="img" aria-label="${esc(labels[i])}: ${fmt(n)} site observations"><div class="hist-fill" style="height:${n / max * 86}%"><span class="hist-count">${fmt(n)}</span></div><span class="hist-label">${esc(labels[i])}</span></div>`).join('') + '</div>';
}

function pearson(xs, ys) {
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

// One row per cell line; each dot is a run's share of scored sites at or above the cutoff.
function renderCellLines(threshold, selectedSamples) {
  hideDotTooltip();
  const runs = selectedSamples.filter(s => s.group === 'sgnex').map(s => {
    const st = s.stats.byMinReads[threshold];
    return { s, sites: st.sites, pct: st.scored ? aboveCutoff(st.scoreHist, state.cutoff) / st.scored * 100 : 0 };
  }).filter(q => q.s.stats.byMinReads[threshold].scored > 0);
  $('cellline-panel').hidden = !runs.length;
  if (!runs.length) {
    $('cellline-chart').innerHTML = '';
    $('cellline-controls').innerHTML = '';
    $('cellline-note').textContent = '';
    return;
  }
  const totalScored = runs.reduce((n, q) => n + q.s.stats.byMinReads[threshold].scored, 0);
  const totalAbove = runs.reduce((n, q) => n + aboveCutoff(q.s.stats.byMinReads[threshold].scoreHist, state.cutoff), 0);
  const options = Array.from({ length: 9 }, (_, i) => (i + 1) / 10).map(v => `<option value="${v}"${v === state.cutoff ? ' selected' : ''}>${v.toFixed(1)}</option>`).join('');
  $('cellline-controls').innerHTML = `<div class="score-controls"><label for="score-cutoff">Exploration cutoff</label><select id="score-cutoff" aria-describedby="cellline-control-note">${options}</select><strong aria-live="polite">${fmt(totalAbove)} / ${fmt(totalScored)} scored observations at or above ${state.cutoff}</strong></div><p id="cellline-control-note" class="fine-print">Across the selected SG-NEx runs at the selected minimum coverage. This cutoff updates the dot chart; it does not filter the score-distribution histogram.</p>`;
  $('score-cutoff').addEventListener('change', e => {
    state.cutoff = Number(e.target.value);
    renderOverview();
    $('score-cutoff').focus();
  });
  const lines = [...new Set(runs.map(r => r.s.cellLine))].sort();
  const max = Math.max(0.5, ...runs.map(r => r.pct)) * 1.1;
  const w = 600, l = 78, r = 70, rowH = 30, t = 10, h = t + lines.length * rowH + 30, x = v => l + v / max * (w - l - r);
  const ticks = Array.from({ length: 5 }, (_, i) => max / 1.1 * i / 4);
  let svg = ticks.map(v => `<line x1="${x(v)}" y1="${t}" x2="${x(v)}" y2="${h - 26}" stroke="#edf1e8"/><text x="${x(v)}" y="${h - 10}" text-anchor="middle">${v.toFixed(1)}%</text>`).join('');
  lines.forEach((c, i) => {
    const y = t + i * rowH + rowH / 2, mine = runs.filter(q => q.s.cellLine === c), mean = mine.reduce((a, q) => a + q.pct, 0) / mine.length;
    svg += `<text x="${l - 10}" y="${y + 4}" text-anchor="end" class="axis-label" style="fill:${cellColour(c)}">${esc(c)}</text><line x1="${l}" y1="${y}" x2="${w - r}" y2="${y}" stroke="#f3f5ef"/>`;
    svg += `<line x1="${x(mean)}" y1="${y - 9}" x2="${x(mean)}" y2="${y + 9}" stroke="${cellColour(c, 30)}" stroke-width="2"/>`;
    svg += mine.sort((a, b) => a.s.id.localeCompare(b.s.id)).map((q, runIndex) => `<circle class="run-dot" tabindex="0" aria-label="${esc(q.s.name)}: ${q.pct.toFixed(2)}%" cx="${x(q.pct).toFixed(1)}" cy="${y}" data-run-id="${esc(q.s.id)}" r="5" fill="${cellColour(c, 34 + state.samples.filter(s => s.group === 'sgnex' && s.cellLine === c).sort((a,b) => a.id.localeCompare(b.id)).findIndex(s => s.id === q.s.id) * 6)}" stroke="white" stroke-width=".7"></circle>`).join('');
    svg += `<text x="${w - r + 8}" y="${y + 4}" style="fill:${cellColour(c)};font-weight:600">${mean.toFixed(2)}%</text>`;
  });
  $('cellline-chart').innerHTML = `<svg class="scatter-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="group" aria-label="Share of sites scoring at least ${state.cutoff} per run, grouped by cell line">${svg}</svg>`;
  const rho = runs.length > 2 ? pearson(runs.map(q => Math.log10(q.sites)), runs.map(q => q.pct)) : null;
  $('cellline-note').textContent = `Each colour family represents a cell line, with different shades for its runs. Each dot represents one SG-NEx run; the vertical mark and right-hand percentage show the unweighted mean across the selected runs for that cell line. Only selected SG-NEx runs with scores are shown, using the selected minimum coverage. ${rho === null || !Number.isFinite(rho) ? '' : `Across runs, log candidate-site count and the percentage scoring at least ${state.cutoff} have Pearson r = ${rho.toFixed(2)}. `}Site count is an imperfect proxy for sequencing depth; this association does not establish a cause. Compare shared sites and check replicate consistency before interpreting cell-line differences. Cell-line summaries include only sites averaging at least 0.5 in one or more cell lines.`;
}

function renderOverview() {
  const threshold = Number($('global-reads').value) || readThresholds[0];
  const samples = overviewSamples();
  syncSamplePicker();
  if (!samples.length) {
    $('overview-metrics').innerHTML = metric('Site observations', '0', 'No samples selected')
      + metric('Median read coverage', '—', 'Select at least one sample')
      + geneMetric()
      + metric('Observations with predictions', '0', 'No samples selected');
    $('filter-caption').textContent = '0 observations · 0 samples';
    updateUniqueGenes([], threshold);
    const empty = '<div class="empty-chart">Choose samples from the checkbox list above.</div>';
    $('sample-bars').innerHTML = $('coverage-histogram').innerHTML = empty;
    $('score-distribution').hidden = true;
    $('score-distribution').innerHTML = '';
    $('prediction-heading').textContent = 'No samples selected';
    $('prediction-copy').textContent = 'Select samples above to view their prediction-score distribution.';
    $('sample-cards').innerHTML = empty;
    renderCellLines(threshold, []);
    return;
  }
  const s = combineStats(samples.map(a => a.stats), threshold), above = aboveCutoff(s.scoreHist, state.cutoff), one = samples.length === 1;
  $('overview-metrics').innerHTML = metric('Site observations', fmt(s.sites), one ? `${fmt(s.transcripts)} transcripts` : `Across ${samples.length} samples; shared sites count once per sample`)
    + metric('Median read coverage', s.medianReads === null ? '—' : fmt(s.medianReads), one ? 'Reads at a candidate site' : 'Median of per-sample medians')
    + geneMetric()
    + metric('Observations with predictions', s.scored ? fmt(s.scored) : 'Awaiting model', s.scored ? `${fmt(above)} at or above ${state.cutoff} · not experimental calls` : 'Coverage exploration is available', !s.scored);
  updateUniqueGenes(samples, threshold);
  $('filter-caption').textContent = `${fmt(s.sites)} observations · ${samples.length} ${one ? 'sample' : 'samples'}`;
  $('sample-bars').innerHTML = hBars(samples.map(a => ({ name: a.name, value: a.stats.byMinReads[threshold].sites, cellLine: a.cellLine, group: a.group })));
  $('coverage-histogram').innerHTML = histogram(s.coverageHist, ['<20','20–39','40–79','80–159','160–319','320–639','640–1279','1280+']);
  $('prediction-heading').textContent = s.scored ? 'Distribution of predicted m6A scores' : 'Ready for your predictions';
  $('prediction-copy').textContent = s.scored ? 'Each bar counts site observations in a score range. Higher scores indicate stronger model evidence for m6A, not the fraction of modified reads. The full distribution is shown; use the cutoff in the cell-line panel below to explore high-scoring predictions.' : 'Attach a CSV with transcript ID, position and score. Coverage and predictions will be joined by site, with unmatched IDs checked.';
  $('overview-predictions').textContent = s.scored ? 'Add more scores' : 'Add predictions';
  $('score-distribution').hidden = !s.scored;
  if (s.scored) {
    $('score-distribution').innerHTML = histogram(s.scoreHist, Array.from({length:10},(_,i)=>`${(i/10).toFixed(1)}–${((i+1)/10).toFixed(1)}`),true);
  }
  renderCellLines(threshold, samples);
  renderSampleGroups(samples, threshold);
}


const cellDescriptions = {
  A549: ['Lung cancer cells (adenocarcinoma).', 'CVCL_0023'],
  H9: ['Human embryonic stem cells (WA09); not a cancer-derived cell line.', 'CVCL_9773'],
  HEYA8: ['Ovarian cancer cells.', 'CVCL_8878'],
  Hct116: ['Colon cancer cells.', 'CVCL_0291'],
  HepG2: ['Liver cancer cells derived from hepatoblastoma.', 'CVCL_0027'],
  K562: ['Blood cancer cells derived from chronic myeloid leukaemia.', 'CVCL_0004'],
  MCF7: ['Breast cancer cells.', 'CVCL_0031']
};
function renderSampleGroups(samples, threshold) {
  const groups = new Map();
  for (const s of samples) {
    const key = s.group === 'development' ? 'Development datasets' : (s.cellLine || 'Other samples');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  $('sample-cards').innerHTML = [...groups].map(([name, members]) => {
    const development = name === 'Development datasets';
    const description = development
      ? 'Training and development datasets supplied for the project.'
      : (cellDescriptions[name]?.[0] ?? 'User-supplied samples.');
    const source = !development && cellDescriptions[name]?.[1];
    const colour = development ? '#21957e' : cellColour(name);
    return `<section class="sample-group" style="--group-colour:${colour}" aria-label="${esc(name)} samples">
      <div class="sample-group-heading"><div><h3>${esc(name)}</h3><p>${esc(description)}${source ? ` <a href="https://www.cellosaurus.org/${source}" target="_blank" rel="noopener" aria-label="Cellosaurus information about ${esc(name)}">About this cell line ↗</a>` : ''}</p></div><span class="sample-group-count">${members.length} ${development ? 'datasets' : 'samples'}</span></div>
      <div class="sample-group-grid">${members.map(a => {
    const st = a.stats.byMinReads[threshold];
    return `<article class="sample-card"><div class="tag">${esc(sourceTag(a))}</div><h3>${esc(a.name)}</h3><p>${esc(a.cellLine)} · ${fmt(st.sites)} candidate sites</p><div class="card-bottom"><span>Median ${st.medianReads === null ? '—' : fmt(st.medianReads)} reads</span><span class="pill ${st.scored ? 'ready' : 'pending'}">${st.scored ? 'Scores loaded' : 'Scores pending'}</span></div></article>`;

      }).join('')}</div></section>`;
  }).join('');
}


/* Compact source files are read sequentially; retain only two, plus small derived indexes. */
const compactFiles = new Map(), compactRequests = new Map();
const geneCoverage = new Map(), transcriptRunRows = new Map();
async function compactSource(s) {
  if (compactFiles.has(s.dataFile)) {
    const data = compactFiles.get(s.dataFile);
    compactFiles.delete(s.dataFile); compactFiles.set(s.dataFile, data); return data;
  }
  if (!compactRequests.has(s.dataFile)) {
    compactRequests.set(s.dataFile, fetch(s.dataFile).then(r => {
      if (!r.ok) throw new Error('Could not read ' + s.name);
      return r.json();
    }).then(data => {
      compactFiles.set(s.dataFile, data);
      while (compactFiles.size > 2) compactFiles.delete(compactFiles.keys().next().value);
      return data;
    }).finally(() => compactRequests.delete(s.dataFile)));
  }
  return compactRequests.get(s.dataFile);
}
async function geneCoverageFor(s) {
  if (geneCoverage.has(s.id)) return geneCoverage.get(s.id);
  const genes = new Map();
  const add = (gene, reads) => { if (gene) genes.set(gene, Math.max(reads, genes.get(gene) || 0)); };
  if (s.data) {
    for (const r of s.data) add(state.annotations.get(r.transcript_id)?.[0] || r.gene_id, r.n_reads);
  } else {
    const data = await compactSource(s);
    for (const [tx, , reads] of data.sites) {
      const gene = state.annotations.get(data.transcripts[tx])?.[0] || data.genes[data.transcriptGenes[tx]];
      add(gene, reads);
    }
  }
  geneCoverage.set(s.id, genes); return genes;
}
function geneMetric() {
  return '<div class="metric"><div class="metric-label">Unique genes represented</div><div class="metric-value" id="unique-gene-value">…</div><div class="metric-foot" id="unique-gene-note">Counting distinct mapped gene IDs…</div></div>';
}
async function updateUniqueGenes(samples, threshold) {
  const token = ++state.tokens.genes, genes = new Set();
  if (!samples.length) {
    $('unique-gene-value').textContent = '0'; $('unique-gene-note').textContent = 'No samples selected'; return;
  }
  try {
    for (let i = 0; i < samples.length; i++) {
      if (token !== state.tokens.genes) return;
      const coverage = await geneCoverageFor(samples[i]);
      if (token !== state.tokens.genes) return;
      for (const [gene, maxReads] of coverage) if (maxReads >= threshold) genes.add(gene);
      $('unique-gene-note').textContent = `Counting genes · ${i + 1}/${samples.length} samples checked`;
    }
    $('unique-gene-value').textContent = fmt(genes.size);
    $('unique-gene-note').textContent = 'Distinct mapped IDs at this coverage; shared genes counted once';
  } catch (error) {
    if (token !== state.tokens.genes) return;
    $('unique-gene-value').textContent = 'Unavailable';
    $('unique-gene-note').textContent = 'A sample could not load. Retry by changing a filter or refreshing.';
  }
}

const transcriptView = { tx: '', position: null, ids: [], rows: [], runPoints: [], runToken: 0 };
function scoreColour(score) {
  return score === null ? '#e9eeea' : `hsl(160 48% ${96 - score * 65}%)`;
}
function clearTranscriptView(message) {
  transcriptView.runToken++;
  transcriptView.rows = []; transcriptView.ids = []; transcriptView.runPoints = [];
  $('transcript-visuals').hidden = true;
  $('transcript-empty').hidden = false; $('transcript-empty').textContent = message;
}
function prepareTranscriptView(ids, allRows) {
  const f = explorerFilter();
  // Score filters apply only to the table: retain low scores for visual comparisons.
  const candidates = filterRows(allRows, { minReads: f.minReads, search: f.search });
  const txs = [...new Set(candidates.map(r => r.transcript_id))].sort();
  const query = f.search.trim();
  const exact = txs.find(tx => tx.toLowerCase() === query.toLowerCase());
  if (!txs.includes(transcriptView.tx)) transcriptView.tx = exact || (query && txs.length === 1 ? txs[0] : '');
  const shown = txs.slice(0, 200);
  if (transcriptView.tx && !shown.includes(transcriptView.tx)) shown.unshift(transcriptView.tx);
  $('transcript-choice').innerHTML = '<option value="">Choose a transcript…</option>' +
    shown.map(tx => `<option value="${esc(tx)}">${esc(tx)}</option>`).join('');
  $('transcript-choice').value = transcriptView.tx;
  $('transcript-choice-note').textContent = txs.length > 200
    ? `${fmt(txs.length)} matches; showing the first 200. Refine your search to find another transcript.`
    : `${fmt(txs.length)} matching transcripts. Versioned and versionless IDs are kept separate.`;
  if (!transcriptView.tx) {
    clearTranscriptView(txs.length ? 'Search for a transcript above, or choose one here to compare its sites.' : 'No transcripts match this search and coverage filter.');
    return;
  }
  transcriptView.ids = ids;
  transcriptView.rows = allRows.filter(r => r.transcript_id === transcriptView.tx && r.n_reads >= f.minReads);
  const positions = [...new Set(transcriptView.rows.map(r => r.transcript_position))].sort((a,b) => a-b);
  if (!positions.length) { clearTranscriptView('No sites at this coverage for the selected transcript.'); return; }
  if (!positions.includes(transcriptView.position)) transcriptView.position = positions[0];
  $('transcript-empty').hidden = true; $('transcript-visuals').hidden = false;
  const summaries = ids.every(id => sample(id)?.group === 'cellline');
  const annotations = transcriptView.rows.map(r => state.annotations.get(r.transcript_id) || [r.gene_id, r.gene_name]);
  const geneIds = [...new Set(annotations.map(a=>a[0]).filter(Boolean))];
  $('transcript-meta').textContent = `Transcript: ${transcriptView.tx} · Gene ID: ${geneIds.join(' / ') || 'not supplied'} · ${positions.length} measured positions · ${summaries ? 'cell-line mean scores' : 'sample scores'}`;
  const sequenceAt = p => [...new Set(transcriptView.rows.filter(r=>r.transcript_position===p).map(r=>r.sequence).filter(Boolean))].join(' / ') || 'not supplied';
  $('transcript-scope-note').textContent = summaries
    ? 'Summary subset: sites qualify only if the mean score is ≥0.5 in at least one cell line. Reads are rounded mean coverage. Visuals use the coverage filter; minimum-score and scored-only filters affect the table only.'
    : 'Visuals use the selected sample and coverage filter; minimum-score and scored-only filters affect the table only. Scores are predictions, not modification fractions.';
  $('transcript-position').innerHTML = positions.map(p => `<option value="${p}">Position ${fmt(p)} · ${esc(sequenceAt(p))}</option>`).join('');
  $('transcript-position').value = transcriptView.position;
  const cells = new Map(transcriptView.rows.map(r => [r.sample_id + ':' + r.transcript_position, r]));
  $('transcript-heatmap').innerHTML = `<table class="heatmap-table"><caption class="sr-only">Prediction scores by sample and transcript position</caption><thead><tr><th>Cell line / sample</th>${positions.map(p=>`<th scope="col" class="${p === transcriptView.position ? 'selected-position-header' : ''}"><span>Position ${fmt(p)}</span><small class="position-sequence">7-mer: ${esc(sequenceAt(p))}</small></th>`).join('')}</tr></thead><tbody>${ids.map(id => {
    const s = sample(id), name = s.group === 'cellline' ? s.cellLine : s.name;
    return `<tr><th scope="row" style="color:${cellColour(s.cellLine)}">${esc(name)}</th>${positions.map(p => {
      const row = cells.get(id + ':' + p), score = row?.score ?? null;
      const label = row ? (score === null ? 'No prediction' : 'Score ' + score.toFixed(3)) : 'No summary or measurement under this coverage filter';
      return `<td><span class="heatmap-cell${p === transcriptView.position ? ' selected' : ''}" aria-label="${esc(name)}, position ${p}: ${label}${row ? ', coverage ' + row.n_reads : ''}" style="background:${scoreColour(score)};color:${score !== null && score >= .65 ? '#fff' : '#143b34'}">${score === null ? '—' : score.toFixed(2)}</span></td>`;
    }).join('')}</tr>`;
  }).join('')}</tbody></table>`;
  const selectedRows = transcriptView.rows.filter(r => r.transcript_position === transcriptView.position);
  const sequences = [...new Set(selectedRows.map(r => r.sequence).filter(Boolean))];
  $('transcript-site-context').textContent = `Position ${fmt(transcriptView.position)} · 7-mer sequence: ${sequences.join(' / ') || 'not supplied'} · ${selectedRows.length} summary/sample measurements`;
  renderTranscriptRuns();
}
async function rowsForTranscript(s, tx) {
  if (s.data) return s.data.filter(r => r.transcript_id === tx);
  const key = s.id + ':' + tx;
  if (transcriptRunRows.has(key)) return transcriptRunRows.get(key);
  const data = await compactSource(s), index = data.transcripts.indexOf(tx);
  const rows = index < 0 ? [] : data.sites.filter(r=>r[0]===index).map(([,pos,reads,seq,label,score]) => ({
    transcript_id:tx, transcript_position:pos, n_reads:reads, sequence:data.sequences[seq], score:score??null, sample_id:s.id
  }));
  transcriptRunRows.set(key, rows);
  // Small per-transcript extracts, not whole decoded sample datasets.
  while (transcriptRunRows.size > 250) transcriptRunRows.delete(transcriptRunRows.keys().next().value);
  return rows;
}
async function renderTranscriptRuns() {
  const token = ++transcriptView.runToken, tx = transcriptView.tx, pos = transcriptView.position;
  const minReads = explorerFilter().minReads;
  const choices = transcriptView.ids.map(sample);
  const runs = state.samples.filter(s => s.group !== 'cellline' && choices.some(c =>
    c.group === 'cellline' ? s.group === 'sgnex' && s.cellLine === c.cellLine : s.id === c.id));
  $('transcript-run-heading').textContent = `Within-cell-line variation at transcript position ${fmt(pos)}`;
  $('transcript-run-chart').innerHTML = '';
  $('transcript-run-values').innerHTML = '';
  transcriptView.runPoints = [];
  $('transcript-run-status').textContent = 'Loading individual-run measurements…';
  const result = [];
  for (const s of runs) {
    if (token !== transcriptView.runToken) return;
    try {
      const rows = await rowsForTranscript(s, tx);
      if (token !== transcriptView.runToken) return;
      const row = rows.find(r => r.transcript_position === pos && r.n_reads >= minReads);
      result.push({ s, row: row ?? null, error: false });
    } catch {
      if (token !== transcriptView.runToken) return;
      result.push({ s, row:null, error:true });
    }
    $('transcript-run-status').textContent = `Checking runs · ${result.length}/${runs.length}`;
  }
  if (token !== transcriptView.runToken) return;
  transcriptView.runPoints = result;
  renderTranscriptRunPlot(result);
}
function renderTranscriptRunPlot(result) {
  const groups = [...new Set(result.map(q => q.s.cellLine))].sort();
  const scored = result.filter(q => q.row?.score !== null && q.row?.score !== undefined);
  const errors = result.filter(q=>q.error).length;
  $('transcript-run-status').textContent = `${scored.length}/${result.length} runs have a score at this exact transcript ID and position with ≥${explorerFilter().minReads} reads.${errors ? ' ' + errors + ' run files could not load; these are not missing measurements.' : ''} Dots show runs; vertical marks show unweighted means. A missing score does not mean unmodified.`;
  $('transcript-run-values').innerHTML = `<table><thead><tr><th>Cell line</th><th>Sample / run</th><th>Score</th><th>Read coverage</th></tr></thead><tbody>${result.map(q=>`<tr><td style="color:${cellColour(q.s.cellLine)}">${esc(q.s.cellLine)}</td><td>${esc(q.s.name)}</td><td>${q.error?'Could not load':q.row?.score==null?'No score at this coverage':q.row.score.toFixed(3)}</td><td>${q.row?fmt(q.row.n_reads):'—'}</td></tr>`).join('')}</tbody></table>`;
  const w=760,l=100,r=130,t=22,rowH=44,h=t+groups.length*rowH+44,x=v=>l+v*(w-l-r);
  let svg = [0,.25,.5,.75,1].map(v=>`<line x1="${x(v)}" y1="${t-8}" x2="${x(v)}" y2="${h-36}" stroke="#e5ece5"/><text x="${x(v)}" y="${h-14}" text-anchor="middle">${v.toFixed(2)}</text>`).join('');
  groups.forEach((cell,i)=>{
    const mine=result.filter(q=>q.s.cellLine===cell), measured=mine.filter(q=>q.row?.score!==null && q.row?.score!==undefined);
    const y=t+i*rowH+20, colour=cellColour(cell);
    svg += `<text x="${l-14}" y="${y+4}" text-anchor="end" style="fill:${colour};font-weight:600">${esc(cell)}</text>`;
    measured.forEach((q,j)=>{
      const ri=result.indexOf(q), offset=(j-(measured.length-1)/2)*3;
      svg += `<circle class="site-run-dot" role="img" tabindex="0" data-site-run="${ri}" aria-label="${esc(q.s.name)}: score ${q.row.score.toFixed(3)}, ${q.row.n_reads} reads" cx="${x(q.row.score)}" cy="${y+offset}" r="5" fill="${colour}" stroke="white" stroke-width="1"/>`;
    });
    if (measured.length) {
      const mean=measured.reduce((n,q)=>n+q.row.score,0)/measured.length;
      svg += `<line x1="${x(mean)}" x2="${x(mean)}" y1="${y-12}" y2="${y+12}" stroke="${colour}" stroke-width="2"/><text x="${w-r+12}" y="${y+4}" style="fill:${colour}">${mean.toFixed(3)} · ${measured.length}/${mine.length} runs</text>`;
    } else svg += `<text x="${w-r+12}" y="${y+4}">No scored runs</text>`;
  });
  $('transcript-run-chart').innerHTML = groups.length
    ? `<svg class="site-run-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="group" aria-label="Prediction scores from zero to one for individual runs">${svg}</svg>`
    : '<div class="empty-chart">No individual runs are available for this selection.</div>';
}
function selectTranscriptPosition(position) {
  transcriptView.position = Number(position);
  // Reuses opened summary rows; the small run extracts are cached.
  const ids = transcriptView.ids.slice();
  prepareTranscriptView(ids, ids.flatMap(sampleRows));
}
function showSiteRunTooltip(dot) {
  const q = transcriptView.runPoints[Number(dot.dataset.siteRun)];
  if (!q?.row) return;
  clearTimeout(dotTooltipTimer);
  if (activeDot) activeDot.removeAttribute('aria-describedby');
  activeDot=dot;
  const tip=$('run-tooltip');
  tip.innerHTML=`<div class="run-tooltip-kicker">${esc(q.s.cellLine)} · Individual run</div><strong class="run-tooltip-name">${esc(q.s.name)}</strong><div class="run-tooltip-value">${q.row.score.toFixed(3)}<span>prediction score</span></div><p>${fmt(q.row.n_reads)} reads · position ${fmt(transcriptView.position)}</p><div class="run-tooltip-foot">${esc(transcriptView.tx)}<br>Not the fraction of modified reads</div>`;
  tip.style.setProperty('--tooltip-colour',cellColour(q.s.cellLine,60));tip.hidden=false;
  dot.setAttribute('aria-describedby','run-tooltip');
  const rect=dot.getBoundingClientRect(),width=tip.offsetWidth,height=tip.offsetHeight;
  tip.style.left=`${Math.max(12,Math.min(rect.left+rect.width/2-width/2,window.innerWidth-width-12))}px`;
  tip.style.top=`${Math.max(12,Math.min(rect.top>height+20?rect.top-height-12:rect.bottom+12,window.innerHeight-height-12))}px`;
}
function bindTranscriptView() {
  $('transcript-choice').addEventListener('change', e => {
    transcriptView.tx=e.target.value;transcriptView.position=null;
    // Keep the gene/search context so sibling transcripts remain selectable.
    renderExplorer();
  });
  $('transcript-position').addEventListener('change',e=>selectTranscriptPosition(e.target.value));
  const chart=$('transcript-run-chart');
  chart.addEventListener('pointerover',e=>{const dot=e.target.closest('.site-run-dot');if(dot)showSiteRunTooltip(dot);});
  chart.addEventListener('pointerout',e=>{if(e.target.closest('.site-run-dot'))scheduleHideDotTooltip();});
  chart.addEventListener('focusin',e=>{const dot=e.target.closest('.site-run-dot');if(dot)showSiteRunTooltip(dot);});
  chart.addEventListener('focusout',scheduleHideDotTooltip);
  chart.addEventListener('click',e=>{const dot=e.target.closest('.site-run-dot');if(dot)showSiteRunTooltip(dot);});
}

function explorerFilter() {
  return { sample: $('site-sample').value, minReads: Math.max(1,Number($('site-reads').value)||1), search: $('site-search').value,
    scoredOnly: $('scored-only').checked, minScore: $('site-score').disabled || $('site-score').value === '' ? null : Number($('site-score').value) };
}
async function renderExplorer(resetPage = true) {
  if (resetPage) state.tablePage = 0;
  transcriptView.runToken++; hideDotTooltip();
  const choice = $('site-sample').value, ids = choice === 'cellline_all' ? cellLineIds() : [choice], token = ++state.tokens.explorer;
  const scored = ids.some(id => sample(id)?.scoredTotal);
  $('site-score').disabled = $('scored-only').disabled = !scored;
  $('score-filter-note').textContent = scored ? 'Scores are model predictions, not experimental calls.' : 'Import predictions to enable score filters.';
  if (ids.some(id => !sample(id)?.data)) { $('site-result-count').textContent = 'Loading sites…'; $('site-table-body').innerHTML = '<tr><td class="empty-cell" colspan="8">Loading sites for this sample…</td></tr>'; }
  if (ids.some(id => !sample(id)?.data)) clearTranscriptView('Loading transcript measurements…');
  try { await ensureLoaded(ids); } catch (error) {
    if (token === state.tokens.explorer) { $('site-result-count').textContent = error.message; clearTranscriptView('Could not load this sample. Try another selection or refresh.'); }
    return;
  }
  if (token !== state.tokens.explorer) return;
  const allRows = ids.flatMap(sampleRows);
  prepareTranscriptView(ids, allRows);
  const summary = ids.every(id => sample(id)?.group === 'cellline');
  document.querySelector('[data-sort="n_reads"]').textContent = summary ? 'Mean reads ↕' : 'Reads ↕';
  document.querySelector('[data-sort="score"]').textContent = summary ? 'Mean score ↕' : 'Score ↕';
  const tableRows = transcriptView.tx ? allRows.filter(r=>r.transcript_id===transcriptView.tx) : allRows;
  $('exact-scope').textContent = transcriptView.tx ? 'Measurements for '+transcriptView.tx+'. Coverage and score filters apply; all positions in this transcript are included.' : 'Measurements matching the search and filters. Choose a transcript above to narrow this table.';
  const rows = filterRows(tableRows, { ...explorerFilter(), sample: 'all' }), key = state.sort, direction = state.descending ? -1 : 1;
  rows.sort((a,b) => {
    if (a[key] === null && b[key] !== null) return 1;
    if (b[key] === null && a[key] !== null) return -1;
    const cmp = typeof a[key] === 'string' ? a[key].localeCompare(b[key]) : (a[key]??0)-(b[key]??0);
    return cmp*direction || a.transcript_id.localeCompare(b.transcript_id) || a.transcript_position-b.transcript_position;
  });
  state.filtered = rows;
  const start = state.tablePage*40, page = rows.slice(start,start+40);
  $('site-result-count').textContent = `${fmt(rows.length)} candidate observations`;
  $('site-table-body').innerHTML = page.length ? page.map((r,i) => `<tr><td>${esc(shortName(r.sample_id))}</td><td class="transcript">${esc(r.transcript_id)}</td><td class="position">${fmt(r.transcript_position)}</td><td>${r.gene_id ? `<span class="gene-name">${esc(r.gene_name || 'Gene ID')}</span><span class="gene-id">${esc(r.gene_id)}</span>` : '<span class="score-empty">Unmapped</span>'}</td><td class="sequence">${esc(r.sequence || '—')}</td><td class="reads">${fmt(r.n_reads)}</td><td>${r.score === null ? '<span class="score-empty">—</span>' : `<span class="score-pill">${r.score.toFixed(3)}</span>`}</td><td><button class="row-details" data-detail="${start+i}" aria-label="Inspect ${esc(r.transcript_id)} position ${r.transcript_position}">↗</button></td></tr>`).join('') : '<tr><td class="empty-cell" colspan="8">No sites match these filters. Try a lower coverage threshold or a different search.</td></tr>';
  $('page-info').textContent = rows.length ? `${fmt(start+1)}–${fmt(Math.min(start+40,rows.length))} of ${fmt(rows.length)}` : '0 results';
  $('page-prev').disabled = !state.tablePage; $('page-next').disabled = start+40 >= rows.length;
}

function showDetail(row) {
  const s = sample(row.sample_id), pos = row.transcript_position;
  $('site-dialog-title').textContent = `${row.transcript_id} : ${fmt(pos)}`;
  const sequence = row.sequence ? `<div class="detail-sequence">${[...row.sequence].map((b,i)=>`<span${row.sequence.length===7&&i===3?' class="candidate-base"':''}>${esc(b)}</span>`).join('')}</div>` : '';
  const runsNote = row.runs ? `<dt>Runs measuring this site</dt><dd>${fmt(row.runs)} of ${fmt(s.runs)}</dd>` : '';
  const labelNote = row.label === null ? 'Not supplied' : `${row.label}${row.label !== 0 && row.label !== 1 ? ' · intermediate value; meaning unconfirmed' : ' · provided site annotation'}`;
  const transcriptLink = /^ENST\d+/.test(row.transcript_id) ? `<a href="https://www.ensembl.org/Homo_sapiens/Transcript/Summary?t=${encodeURIComponent(row.transcript_id)}" target="_blank" rel="noopener">${esc(row.transcript_id)} ↗</a>` : esc(row.transcript_id);
  $('site-details').innerHTML = sequence + `<div class="detail-grid"><div class="detail-box"><span>${row.runs ? 'Mean read coverage' : 'Read coverage'}</span><strong>${fmt(row.n_reads)}</strong></div><div class="detail-box"><span>${row.runs ? 'Mean prediction score' : 'Prediction score'}</span><strong>${row.score===null?'Pending':row.score.toFixed(4)}</strong></div></div><dl class="detail-list"><dt>Sample</dt><dd>${esc(s.name)}</dd><dt>Cell line</dt><dd>${esc(s.cellLine)}</dd>${s.group === 'cellline' ? runsNote : `<dt>Replicate / run</dt><dd>${esc(s.replicate ?? 'Not supplied')} / ${esc(s.run ?? 'Not supplied')}</dd>`}<dt>Transcript</dt><dd>${transcriptLink}</dd><dt>Gene</dt><dd>${esc(row.gene_name || row.gene_id || 'Unmapped')}</dd><dt>Provided label</dt><dd>${esc(labelNote)}</dd><dt>Model / version</dt><dd>${esc(s.model || 'No predictions imported')}</dd></dl><p class="fine-print">${esc(s.annotationNote || 'Annotations and model labels are supplied at import.')} Position is a transcript coordinate. A model score is not the fraction of modified reads.</p>`;
  $('site-dialog').showModal();
}

function scatter(pairs, log, leftName, rightName, selectedKey = null) {
  if (!pairs.length) return '<div class="empty-chart">No paired measurements match this comparison.</div>';
  const w=600,h=335,l=60,r=20,t=18,b=55;
  const transform = v => log ? Math.log10(Math.max(1,v)) : v;
  let maxValue = 10; for (const p of pairs) maxValue = Math.max(maxValue,p.x,p.y);
  const max = log ? Math.ceil(Math.log10(maxValue)) : 1;
  const min = 0, scaleX=v=>l+(transform(v)-min)/(max-min)*(w-l-r), scaleY=v=>h-b-(transform(v)-min)/(max-min)*(h-t-b);
  const ticks = log ? Array.from({length:max+1},(_,i)=>10**i) : [0,.25,.5,.75,1];
  const step=Math.max(1,Math.ceil(pairs.length/1600)), dots=pairs.filter((_,i)=>i%step===0);
  let content = '';
  for (const tick of ticks) {
    const x=scaleX(tick),y=scaleY(tick),label=log?fmt(tick):tick.toFixed(2);
    content+=`<line x1="${l}" y1="${y}" x2="${w-r}" y2="${y}" stroke="#edf1e8"/><line x1="${x}" y1="${t}" x2="${x}" y2="${h-b}" stroke="#edf1e8"/><text x="${l-11}" y="${y+3}" text-anchor="end">${label}</text><text x="${x}" y="${h-b+19}" text-anchor="middle">${label}</text>`;
  }
  content+=`<line x1="${l}" y1="${h-b}" x2="${w-r}" y2="${t}" stroke="#b7cabc" stroke-dasharray="4 5"/>`;
  content+=dots.map(p=>`<circle cx="${scaleX(p.x).toFixed(2)}" cy="${scaleY(p.y).toFixed(2)}" r="2.4" fill="#178c70" opacity=".25"><title>${esc(p.key)} · A ${p.x} · B ${p.y}</title></circle>`).join('');
  const selected = pairs.find(p=>p.key===selectedKey);
  if(selected) content += `<circle cx="${scaleX(selected.x)}" cy="${scaleY(selected.y)}" r="7" fill="#e7ad43" stroke="#143b34" stroke-width="2"><title>${esc(selected.key)} · A ${selected.x} · B ${selected.y}</title></circle>`;
  content+=`<text class="axis-label" x="${(l+w-r)/2}" y="${h-9}" text-anchor="middle">${esc(leftName)}${log?' · reads (log scale)':' · score'}</text><text class="axis-label" transform="translate(15 ${(t+h-b)/2}) rotate(-90)" text-anchor="middle">${esc(rightName)}${log?' · reads (log scale)':' · score'}</text>`;
  return `<svg class="scatter-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(log?'Read coverage':'Prediction score')} at ${fmt(pairs.length)} shared sites">${content}</svg>`;
}

async function renderComparison() {
  $('pair-agreement').hidden=true;
  $('rank-panel').hidden=true;
  rankView.selected=null;
  $('rank-selection').textContent='';
  const a=$('compare-a').value,b=$('compare-b').value, minReads=Math.max(1,Number($('compare-reads').value)||1), token=++state.tokens.compare;
  if (!sample(a)?.data || !sample(b)?.data) $('compare-metrics').innerHTML=metric('Loading','…','Fetching site data for both samples');
  try { await ensureLoaded([a,b]); } catch (error) { if (token===state.tokens.compare) notify(error.message); return; }
  if (token!==state.tokens.compare) return;
  let left=sampleRows(a).filter(r=>r.n_reads>=minReads),right=sampleRows(b).filter(r=>r.n_reads>=minReads);
  if(state.crossPairScope){left=left.filter(r=>state.crossPairScope.has(crossKey(r)));right=right.filter(r=>state.crossPairScope.has(crossKey(r)));}
  $('matrix-pair-scope').hidden=!state.crossPairScope;
  $('matrix-pair-scope-text').textContent=state.crossPairScope?'Inspecting '+shortName(a)+' vs '+shortName(b)+' using the '+fmt(state.crossPairScope.size)+' shared sites from the selected heatmap box. Both selections contain this same site set, so sites found only in A or only in B are zero.':'';
  const sa=sample(a),sb=sample(b), sameModel=Boolean(sa?.model && sa.model===sb?.model);
  const canScore = sameModel && left.some(r=>r.score!==null) && right.some(r=>r.score!==null);
  $('compare-score-option').disabled=!canScore;
  $('compare-metric').value=canScore?(state.compareMeasurePreference||'score'):'n_reads';
  const measure=$('compare-metric').value;
  const result=compareSamples(left,right,measure); state.comparison={...result,a,b,measure};
  $('compare-metrics').innerHTML=metric('Shared candidate sites',fmt(result.shared),'Matched transcript + position')+metric('Sites in sample A but not in sample B',fmt(result.onlyLeft),'Measured under current filters')+metric('Sites in sample B but not in sample A',fmt(result.onlyRight),'Measured under current filters');
  $('scatter-title').textContent=measure==='score'?'Prediction scores at shared sites':'Coverage at shared sites';
  $('scatter-plot').innerHTML=scatter(result.pairs,measure==='n_reads',shortName(a),shortName(b));
  $('scatter-note').textContent=result.pairs.length ? `${fmt(result.pairs.length)} paired measurements; the plot shows up to 1,600 evenly spaced points for readability. The dashed line marks equal values.` : 'No sites with both measurements are available.';
  let note=a===b?'You are comparing a sample with itself. Select two different samples to inspect overlap.': sa?.group==='development'||sb?.group==='development'?'Development datasets can share training-site IDs. Treat this as descriptive exploration, not independent model validation.': sa?.group==='cellline'||sb?.group==='cellline'?'Cell-line summaries hold only sites whose mean score reaches the summary threshold in at least one cell line; values are means over each cell line’s runs. Only-in-one-sample sites were not measured with enough reads in the other cell line, which does not make them unmodified.':'Replicate numbers and runs are taken from imported metadata. Check replicate consistency before interpreting cell-line differences.';
  if (sa?.model && sb?.model && !sameModel) note+=' Prediction score comparison is disabled because the model/version labels differ.';
  $('comparison-notice').innerHTML=`<span class="notice-icon">i</span><div>${esc(note)}</div>`;
  const total=result.shared+result.onlyLeft+result.onlyRight;
  const fractions=total?[result.shared,result.onlyLeft,result.onlyRight].map(n=>n/total):[0,0,0];
  const colors=['#138770','#83b395','#d4dfbc'],circ=2*Math.PI*80;let offset=0;
  const arcs=fractions.map((f,i)=>{const out=`<circle cx="100" cy="100" r="80" fill="none" stroke="${colors[i]}" stroke-width="29" stroke-dasharray="${f*circ} ${circ}" stroke-dashoffset="${-offset*circ}" transform="rotate(-90 100 100)"/>`;offset+=f;return out;}).join('');
  $('overlap-chart').innerHTML=`<div class="overlap-ring"><svg viewBox="0 0 200 200" aria-hidden="true">${arcs}</svg><div class="overlap-center"><strong>${total?(fractions[0]*100).toFixed(1)+'%':'—'}</strong><span>of the site union is shared</span></div></div>`;
  $('overlap-legend').innerHTML=[['Shared',result.shared],['Sites in sample A but not in sample B',result.onlyLeft],['Sites in sample B but not in sample A',result.onlyRight]].map(([name,n],i)=>`<div class="legend-row"><span class="legend-swatch" style="background:${colors[i]}"></span>${name}<strong>${fmt(n)}</strong></div>`).join('');
  $('export-comparison').disabled=!result.pairs.length;
  const rightMap = new Map(right.map(r=>[r.transcript_id+':'+r.transcript_position,r]));
  rankView.rows = canScore ? left.flatMap(r=>{
    const other=rightMap.get(r.transcript_id+':'+r.transcript_position);
    return other && r.score!=null && other.score!=null ? [{key:r.transcript_id+':'+r.transcript_position,a:r,b:other}] : [];
  }) : [];
  rankView.limit=25;
  renderRankedSites();
}


const rankView = {rows:[],selected:null,limit:25};
function rankSites(rows,mode) {
  const value = r => {
    const a=r.a.score,b=r.b.score;
    if(mode==='difference') return Math.abs(b-a);
    if(mode==='similar') return -Math.abs(b-a);
    if(mode==='mean') return (a+b)/2;
    return Math.min(a,b);
  };
  return [...rows].sort((a,b)=>value(b)-value(a)||a.key.localeCompare(b.key));
}
function renderRankedSites(){
  $('rank-panel').hidden=false;
  const rows=rankView.rows, mode=$('rank-mode').value;
  const explanations={
    both:'Ranked by min(score A, score B), highest first. This favours sites with high predictions in both; it is a ranking, not a modification call.',
    difference:'Ranked by |score B − score A|, largest first. These are prediction differences, not confirmed biological changes.',
    similar:'Ranked by |score B − score A|, smallest first. Both low–low and high–high pairs can be similar.',
    mean:'Ranked by (score A + score B) / 2, highest first. A high mean can still hide disagreement.'
  };
  $('rank-help').textContent=explanations[mode]+' Only shared sites with scores from the same model and passing the coverage filter are ranked. Cell-line summaries retain their preselected subset.';
  const mae=rows.length?rows.reduce((n,r)=>n+Math.abs(r.b.score-r.a.score),0)/rows.length:null;
  $('pair-agreement').hidden=mae===null;
  $('pair-agreement').innerHTML=mae===null?'':'<div><span class="eyebrow">PREDICTION SCORE AGREEMENT</span><h2>Mean absolute score difference</h2><p>'+fmt(rows.length)+' shared scored sites · 0 means identical scores</p></div><strong>'+mae.toFixed(3)+'</strong>';
  $('rank-agreement').textContent=mae===null?'No paired prediction scores available for this selection.':'Mean absolute score difference: '+mae.toFixed(3)+' across '+fmt(rows.length)+' shared scored sites (0 means identical scores).';
  const shown=rankSites(rows,mode).slice(0,rankView.limit);
  $('rank-count').textContent='Showing '+fmt(shown.length)+' of '+fmt(rows.length)+' ranked sites.';
  $('rank-more').hidden=shown.length>=rows.length;
  $('rank-table-body').innerHTML=shown.length?shown.map((r,i)=>{
    const delta=r.b.score-r.a.score;
    const gene=[...new Set([r.a.gene_id,r.b.gene_id].filter(Boolean))].join(' / ')||'—';
    const seq=[...new Set([r.a.sequence,r.b.sequence].filter(Boolean))].join(' / ')||'—';
    return '<tr class="'+(r.key===rankView.selected?'rank-selected':'')+'"><td>'+(i+1)+'</td><td>'+esc(gene)+'</td><td>'+esc(r.a.transcript_id)+'</td><td>'+fmt(r.a.transcript_position)+'</td><td class="sequence">'+esc(seq)+'</td><td>'+r.a.score.toFixed(3)+'</td><td>'+r.b.score.toFixed(3)+'</td><td>'+(delta>0?'+':'')+delta.toFixed(3)+'</td><td>'+fmt(r.a.n_reads)+' / '+fmt(r.b.n_reads)+'</td><td><button class="text-button" data-rank-highlight="'+esc(r.key)+'">Highlight dot</button><button class="text-button" data-rank-open="'+esc(r.key)+'">Inspect site / runs →</button></td></tr>';
  }).join(''):'<tr><td colspan="10">Choose two datasets with prediction scores from the same model.</td></tr>';
}
function bindRankedSites(){
  const picker=$('rank-picker');
  picker.addEventListener('change',e=>{
    if(e.target.name!=='site-ranking')return;
    $('rank-mode').value=e.target.value;
    $('rank-picker-title').textContent=e.target.closest('label').querySelector('strong').textContent;
    picker.open=false;
    rankView.limit=25;renderRankedSites();
    picker.querySelector('summary').focus();
  });
  picker.addEventListener('keydown',e=>{if(e.key==='Escape'){picker.open=false;picker.querySelector('summary').focus();}});
  document.addEventListener('click',e=>{if(!picker.contains(e.target))picker.open=false;});
  $('rank-mode').addEventListener('change',()=>{rankView.limit=25;renderRankedSites();});
  $('rank-more').addEventListener('click',()=>{rankView.limit+=25;renderRankedSites();});
  $('rank-table-body').addEventListener('click',e=>{
    const highlight=e.target.closest('[data-rank-highlight]'),open=e.target.closest('[data-rank-open]');
    const key=highlight?.dataset.rankHighlight||open?.dataset.rankOpen;
    if(!key)return;
    const row=rankView.rows.find(r=>r.key===key);if(!row)return;
    if(highlight){
      rankView.selected=key;renderRankedSites();
      const c=state.comparison;
      $('scatter-plot').innerHTML=scatter(c.pairs,c.measure==='n_reads',shortName(c.a),shortName(c.b),key);
      $('rank-selection').textContent='Highlighted '+row.a.transcript_id+' · position '+fmt(row.a.transcript_position)+' · score A '+row.a.score.toFixed(3)+' · score B '+row.b.score.toFixed(3)+'. Gold marks the selected site, including when it was omitted from the background display subset.';
      $('scatter-plot').scrollIntoView({behavior:'smooth',block:'center'});
    }else{
      const c=state.comparison;
      $('site-sample').value=sample(c.a)?.group==='cellline'&&sample(c.b)?.group==='cellline'?'cellline_all':c.a;
      $('site-search').value=row.a.transcript_id;
      $('site-reads').value=$('compare-reads').value;
      $('site-score').value='';$('scored-only').checked=false;
      transcriptView.tx=row.a.transcript_id;transcriptView.position=row.a.transcript_position;
      setExplorerTab('inspect',false);go('explorer');
      notify($('site-sample').value==='cellline_all'?'Showing this site across cell lines; inspect individual runs below the heatmap.':'Showing this site in sample A; use the sample selector to inspect sample B.');
    }
  });
}


const crossViews={matrix:{selected:null,token:0},atlas:{selected:null,token:0,limit:25}};
const crossKey=r=>r.transcript_id+':'+r.transcript_position;
function sharedSiteMaps(groups,minReads){
  const maps=groups.map(rows=>new Map(rows.filter(r=>r.n_reads>=minReads&&Number.isFinite(r.score)).map(r=>[crossKey(r),r])));
  const keys=maps.length?[...maps[0].keys()].filter(k=>maps.every(m=>m.has(k))):[];
  return {maps,keys};
}
function pairDistance(a,b,keys){
  const valid=keys||[...a.keys()].filter(k=>b.has(k));
  return {n:valid.length,value:valid.length?valid.reduce((sum,k)=>sum+Math.abs(a.get(k).score-b.get(k).score),0)/valid.length:null};
}
function crossOptions(kind){
  const v=crossViews[kind],ids=cellLineIds();
  if(v.selected===null)v.selected=new Set(ids);
  $(kind+'-cells').innerHTML=ids.map(id=>'<label class="cross-cell"><input type="checkbox" value="'+esc(id)+'" '+(v.selected.has(id)?'checked':'')+'><span style="color:'+cellColour(sample(id).cellLine)+'">'+esc(sample(id).cellLine)+'</span></label>').join('');
  return ids.filter(id=>v.selected.has(id));
}
async function renderCross(kind){
  const v=crossViews[kind],token=++v.token,ids=crossOptions(kind);
  const minReads=Math.max(1,Number($(kind+'-reads').value)||20);
  $(kind+'-output').innerHTML='';
  $(kind+'-status').textContent='Loading cell-line summaries…';
  v.data=null;
  if(ids.length<2){$(kind+'-status').textContent='Select at least two cell lines.';return;}
  const models=new Set(ids.map(id=>sample(id).model));
  if(models.size!==1||!sample(ids[0]).model){$(kind+'-status').textContent='Select summaries from the same prediction model.';return;}
  try{await ensureLoaded(ids);}catch(e){if(token===v.token)$(kind+'-status').textContent='Could not load summaries. Change a filter to retry.';return;}
  if(token!==v.token)return;
  const {maps,keys}=sharedSiteMaps(ids.map(sampleRows),minReads);
  v.data={ids,maps,keys,minReads};
  if(kind==='matrix')renderMatrix();else renderAtlas();
}
function renderMatrix(){
  const d=crossViews.matrix.data;if(!d)return;
  const pairwise=$('matrix-mode').value==='pairwise',names=d.ids.map(id=>sample(id).cellLine);
  $('matrix-status').textContent=pairwise
    ? 'Pair-specific shared sites: each box may use a different site set. Counts are shown; closest/furthest pair rankings are disabled in this mode.'
    : fmt(d.keys.length)+' identical shared sites across all '+d.ids.length+' selected cell lines, with mean coverage ≥'+d.minReads+' in every cell line.';
  if(!pairwise&&!d.keys.length){$('matrix-output').innerHTML='<p class="empty-chart">No sites meet these criteria in every selected cell line. Lower coverage, select fewer cell lines, or choose pair-specific shared sites.</p>';return;}
  const pairs=[];
  const grid=d.ids.map((id,i)=>d.ids.map((other,j)=>{
    const p=pairDistance(d.maps[i],d.maps[j],pairwise?null:d.keys);
    if(j>i&&p.n)pairs.push({...p,i,j});
    return p;
  }));
  pairs.sort((a,b)=>a.value-b.value||a.i-b.i||a.j-b.j);
  let cards='';
  if(!pairwise&&pairs.length){
    const card=(label,target,tone)=>{
      const tied=pairs.filter(p=>Math.abs(p.value-target.value)<1e-12);
      return '<div class="cross-stat '+tone+'"><small>'+label+(tied.length>1?' (tie)':'')+'</small><strong class="cross-stat-value">'+target.value.toFixed(3)+'</strong><span class="cross-stat-pair">'+tied.map(p=>esc(names[p.i])+' / '+esc(names[p.j])).join(', ')+'</span><span>Mean absolute score difference</span></div>';
    };
    cards='<div class="cross-stats">'+card('Closest predicted score patterns',pairs[0],'closest')+card('Most different predicted score patterns',pairs.at(-1),'furthest')+'</div>';
  }
  const emphasise=$('matrix-scale').checked&&pairs.length>0;
  const scaleMin=emphasise?pairs[0].value:0,scaleMax=emphasise?pairs.at(-1).value:1;
  const scaleLabel=emphasise?'Visible off-diagonal range; colours emphasise relative differences, including small ones.':'Full 0–1 scale; colours show absolute differences.';
  $('matrix-output').innerHTML=cards+'<p class="fine-print"><strong>Each box shows the mean absolute score difference.</strong> Lower values mean more similar predictions at the compared sites.</p><div class="matrix-key"><span>'+scaleMin.toFixed(3)+' · closer agreement</span><i></i><span>'+scaleMax.toFixed(3)+' · larger difference</span></div><p class="matrix-scale-note">'+scaleLabel+'</p><div class="table-scroll"><table class="similarity-table"><caption class="sr-only">Mean absolute prediction score differences between cell lines</caption><thead><tr><th>Cell line</th>'+names.map(n=>'<th scope="col" style="color:'+cellColour(n)+'">'+esc(n)+'</th>').join('')+'</tr></thead><tbody>'+grid.map((row,i)=>'<tr><th style="color:'+cellColour(names[i])+'">'+esc(names[i])+'</th>'+row.map((p,j)=>{
    const intensity=p.value===null?0:scaleMax===scaleMin ? 0.5 :Math.max(0,Math.min(1,(p.value-scaleMin)/(scaleMax-scaleMin)));
    const bg=i===j?'#f0f2f3':p.value===null?'#edf0eb':'hsl(160 40% '+(96-intensity*65)+'%)',fg=i!==j&&p.value!==null&&intensity>.6?'white':'#143b34';
    const description=names[i]+' and '+names[j]+': '+(p.n?'mean absolute score difference '+p.value.toFixed(4)+' across '+fmt(p.n)+' shared sites':'no shared scores');
    return '<td><button type="button" class="matrix-cell" '+(i===j||!p.n?'disabled':'')+' title="'+esc(description)+'" data-matrix-pair="'+i+','+j+'" style="background:'+bg+';color:'+fg+'" aria-label="'+esc(names[i]+' and '+names[j])+': '+(p.n?'mean absolute difference '+p.value.toFixed(4)+' across '+p.n+' sites':'no shared scores')+'"><strong>'+(p.n?p.value.toFixed(3):'—')+'</strong>'+(i===j?'<small>Same cell line</small>':pairwise?'<small>'+fmt(p.n)+' sites</small>':'')+'</button></td>';
  }).join('')+'</tr>').join('')+'</tbody></table></div><p class="fine-print">Click a non-diagonal box to open that pair in Compare a pair. The pair view will use exactly the sites used by the selected box. Values are descriptive prediction differences, not biological distance or statistical significance.</p>';
}
function atlasRanking(d,mode){
  return d.keys.map(key=>{
    const rows=d.maps.map(m=>m.get(key)),scores=rows.map(r=>r.score);
    const min=Math.min(...scores),max=Math.max(...scores);
    return {key,rows,min,max,range:max-min};
  }).sort((a,b)=>(mode==='range'?b.range-a.range:b.min-a.min)||a.key.localeCompare(b.key));
}
function renderAtlas(){
  const v=crossViews.atlas,d=v.data;if(!d)return;
  const range=$('atlas-rank').value==='range',ranked=atlasRanking(d,range?'range':'high');
  v.ranked=ranked;
  $('atlas-status').textContent=fmt(d.keys.length)+' sites have scores and mean coverage ≥'+d.minReads+' in every one of the '+d.ids.length+' selected cell lines. '+(range?'Ranked by maximum − minimum score, largest first.':'Ranked by minimum score across selected cell lines, highest first.');
  const shown=ranked.slice(0,v.limit);
  $('atlas-output').innerHTML='<div class="table-scroll"><table><thead><tr><th>Rank</th><th>Gene ID</th><th>Transcript / position</th><th>7-mer</th><th>Lowest score · cell line(s)</th><th>Highest score · cell line(s)</th><th>Range</th><th>Explore</th></tr></thead><tbody>'+shown.map((r,i)=>{
    const extreme=value=>r.rows.flatMap((row,j)=>Math.abs(row.score-value)<1e-12?[sample(d.ids[j]).cellLine]:[]).join(', ');
    const first=r.rows[0],genes=[...new Set(r.rows.map(x=>x.gene_id).filter(Boolean))].join(' / '),seq=[...new Set(r.rows.map(x=>x.sequence).filter(Boolean))].join(' / ');
    return '<tr><td>'+(i+1)+'</td><td>'+esc(genes||'—')+'</td><td>'+esc(first.transcript_id)+'<br>Position '+fmt(first.transcript_position)+'</td><td class="sequence">'+esc(seq||'—')+'</td><td>'+r.min.toFixed(3)+'<small>'+esc(extreme(r.min))+'</small></td><td>'+r.max.toFixed(3)+'<small>'+esc(extreme(r.max))+'</small></td><td>'+r.range.toFixed(3)+'</td><td><button class="text-button" data-atlas-open="'+i+'">Inspect site / runs →</button></td></tr>';
  }).join('')+(shown.length?'':'<tr><td colspan="8">No sites qualify in every selected cell line. Try fewer cell lines or lower coverage.</td></tr>')+'</tbody></table></div><div class="rank-footer"><span>Showing '+shown.length+' of '+fmt(ranked.length)+'</span><button class="button small" data-atlas-more '+(shown.length>=ranked.length?'hidden':'')+'>Show 25 more</button></div>';
}
function bindCrossViews(){
  const siteSetPicker=$('matrix-picker');
  siteSetPicker.addEventListener('change',e=>{
    if(e.target.name!=='matrix-site-set')return;
    $('matrix-mode').value=e.target.value;
    $('matrix-picker-title').textContent=e.target.closest('label').querySelector('strong').textContent;
    renderMatrix();siteSetPicker.open=false;siteSetPicker.querySelector('summary').focus();
  });
  siteSetPicker.addEventListener('keydown',e=>{if(e.key==='Escape'){siteSetPicker.open=false;siteSetPicker.querySelector('summary').focus();}});
  document.addEventListener('click',e=>{if(!siteSetPicker.contains(e.target))siteSetPicker.open=false;});

  const discovery=$('atlas-picker');
  discovery.addEventListener('change',e=>{
    if(e.target.name!=='atlas-ranking')return;
    $('atlas-rank').value=e.target.value;
    $('atlas-picker-title').textContent=e.target.closest('label').querySelector('strong').textContent;
    crossViews.atlas.limit=25;renderAtlas();discovery.open=false;discovery.querySelector('summary').focus();
  });
  discovery.addEventListener('keydown',e=>{if(e.key==='Escape'){discovery.open=false;discovery.querySelector('summary').focus();}});
  document.addEventListener('click',e=>{if(!discovery.contains(e.target))discovery.open=false;});
  for(const kind of ['matrix','atlas']){
    $(kind+'-cells').addEventListener('change',e=>{
      if(e.target.type!=='checkbox')return;
      const v=crossViews[kind];e.target.checked?v.selected.add(e.target.value):v.selected.delete(e.target.value);v.limit=25;renderCross(kind);
    });
    $(kind+'-reads').addEventListener('change',()=>{crossViews[kind].limit=25;renderCross(kind);});
  }
  $('matrix-mode').addEventListener('change',renderMatrix);
  $('matrix-scale').addEventListener('change',renderMatrix);
  $('atlas-rank').addEventListener('change',()=>{crossViews.atlas.limit=25;renderAtlas();});
  $('matrix-output').addEventListener('click',e=>{
    const button=e.target.closest('[data-matrix-pair]');if(!button)return;
    const d=crossViews.matrix.data;if(!d)return;
    const [i,j]=button.dataset.matrixPair.split(',').map(Number);
    const keys=$('matrix-mode').value==='pairwise'?[...d.maps[i].keys()].filter(k=>d.maps[j].has(k)):d.keys;
    state.crossPairScope=new Set(keys);
    $('compare-a').value=d.ids[i];$('compare-b').value=d.ids[j];$('compare-reads').value=d.minReads;$('compare-metric').value='score';state.compareMeasurePreference='score';state.compareChosen=true;
    setComparisonTab('pair');$('compare-tab-pair').focus();$('compare-tab-pair').scrollIntoView({behavior:'smooth',block:'start'});
  });
  $('clear-matrix-scope').addEventListener('click',()=>{state.crossPairScope=null;renderComparison();});
  $('atlas-output').addEventListener('click',e=>{
    if(e.target.closest('[data-atlas-more]')){crossViews.atlas.limit+=25;renderAtlas();return;}
    const button=e.target.closest('[data-atlas-open]');if(!button)return;
    const r=crossViews.atlas.ranked[Number(button.dataset.atlasOpen)]?.rows[0];if(!r)return;
    $('site-sample').value='cellline_all';$('site-search').value=r.transcript_id;$('site-reads').value=crossViews.atlas.data.minReads;$('site-score').value='';$('scored-only').checked=false;
    transcriptView.tx=r.transcript_id;transcriptView.position=r.transcript_position;
    setExplorerTab('inspect',false);renderExplorer();$('transcript-panel-title').scrollIntoView({behavior:'smooth',block:'start'});
    notify('Inspecting this site across all loaded cell lines; the ranking uses your selected cell lines.');
  });
}

function renderData() {
  const listed = state.samples.filter(s => s.group !== 'cellline');
  $('loaded-count').textContent=`${listed.length} samples · ${fmt(listed.reduce((n,s)=>n+s.rows,0))} observations`;
  $('loaded-table').innerHTML='<div class="table-scroll"><table><thead><tr><th>Sample</th><th>Cell line</th><th>Sites</th><th>Coverage / scores</th><th>Model label</th><th></th></tr></thead><tbody>'+state.samples.map(s=>{
    return `<tr><td><strong>${esc(s.name)}</strong><div class="muted">${esc(sourceTag(s))}</div></td><td>${esc(s.cellLine)}</td><td>${fmt(s.rows)}</td><td><span class="pill">${s.data?'Loaded':'Loads when opened'}</span> <span class="pill ${s.scoredTotal?'ready':'pending'}">${s.scoredTotal?fmt(s.scoredTotal)+' scores':'Scores pending'}</span></td><td class="model-label" title="${esc(s.model||'')}">${esc(s.model||'—')}</td><td><button class="text-button" data-explore-sample="${esc(s.id)}">Explore →</button></td></tr>`;
  }).join('')+'</tbody></table></div>';
  const cell=$('catalog-cell').value;
  $('catalog-table').innerHTML=state.catalog.filter(s=>cell==='all'||s.cellLine===cell).map(s=>{
    const loaded=Boolean(sample(s.id));
    return `<tr><td class="transcript">${esc(s.id)}</td><td>${esc(s.cellLine)}</td><td>${esc(s.replicate)}</td><td>${esc(s.run)}</td><td><span class="pill ${loaded?'ready':'pending'}">${loaded?'Available':'Not loaded'}</span></td><td><button class="text-button" data-catalog-import="${esc(s.id)}">${loaded?'Add scores':'Import coverage'} →</button></td></tr>`;
  }).join('');
}


function setExplorerTab(tab,render=true){
  state.explorerTab=tab==='discover'?'discover':'inspect';
  for(const name of ['inspect','discover']){
    const selected=name===state.explorerTab;
    $('explorer-'+name).hidden=!selected;
    $('explorer-tab-'+name).setAttribute('aria-selected',String(selected));
    $('explorer-tab-'+name).tabIndex=selected?0:-1;
  }
  $('export-sites').hidden=state.explorerTab!=='inspect';
  if(render){if(state.explorerTab==='inspect')renderExplorer();else renderCross('atlas');}
}
function bindExplorerTabs(){
  for(const name of ['inspect','discover']){
    const button=$('explorer-tab-'+name);
    button.addEventListener('click',()=>setExplorerTab(name));
    button.addEventListener('keydown',e=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
      e.preventDefault();
      const next=e.key==='Home'?'inspect':e.key==='End'?'discover':name==='inspect'?'discover':'inspect';
      setExplorerTab(next);$('explorer-tab-'+next).focus();
    });
  }
}

function setComparisonTab(tab,render=true){
  state.comparisonTab=tab==='pair'?'pair':'across';
  for(const name of ['across','pair']){
    const selected=name===state.comparisonTab;
    $('compare-panel-'+name).hidden=!selected;
    $('compare-tab-'+name).setAttribute('aria-selected',String(selected));
    $('compare-tab-'+name).tabIndex=selected?0:-1;
  }
  $('export-comparison').hidden=state.comparisonTab!=='pair';
  if(render){if(state.comparisonTab==='pair')renderComparison();else renderCross('matrix');}
}
function bindComparisonTabs(){
  for(const name of ['across','pair']){
    const button=$('compare-tab-'+name);
    button.addEventListener('click',()=>setComparisonTab(name));
    button.addEventListener('keydown',e=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
      e.preventDefault();
      const next=e.key==='Home'?'across':e.key==='End'?'pair':name==='across'?'pair':'across';
      setComparisonTab(next);$('compare-tab-'+next).focus();
    });
  }
  $('back-to-matrix').addEventListener('click',()=>{
    setComparisonTab('across');$('compare-tab-across').focus();
    $('compare-tab-across').scrollIntoView({behavior:'smooth',block:'start'});
  });
}

function go(page) {
  if (!['overview','explorer','compare','data','methods'].includes(page)) page='overview';
  state.page=page;
  document.querySelectorAll('.page').forEach(el=>el.classList.toggle('active',el.id===`page-${page}`));
  document.querySelectorAll('[data-nav]').forEach(el=>{el.classList.toggle('active',el.dataset.nav===page);if(el.dataset.nav===page)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
  $('breadcrumb').textContent={overview:'Overview',explorer:'Site explorer',compare:'Compare samples',data:'Data & imports',methods:'Methods & guide'}[page];
  if(page==='overview')renderOverview();if(page==='explorer'){setExplorerTab(state.explorerTab||'inspect');}if(page==='compare'){setComparisonTab(state.comparisonTab||'across');}if(page==='data')renderData();
  history.replaceState(null,'',`#${page}`);window.scrollTo({top:0,behavior:'auto'});
}

function refresh() { refreshOptions();renderOverview();renderExplorer();renderComparison();renderData(); }
function importTypeChanged() {
  const type=$('import-type').value;
  $('coverage-fields').hidden=type!=='coverage';$('prediction-fields').hidden=type!=='predictions';$('model-fields').hidden=type==='annotations';
  $('import-help').textContent={coverage:'Required: transcript_id, transcript_position, n_reads. Optional: sequence, gene_id, gene_name, score, label. One sample per file.',predictions:'Required: transcript_id, transcript_position, score. The model name/version is required. Scores must match the selected sample.',annotations:'Required: transcript_id and gene_id; gene_name is optional. Use the reference annotation matching these reads.'}[type];
}
function openImport(type='coverage', id='') {
  $('import-form').reset();$('import-error').hidden=true;$('import-type').value=type;importTypeChanged();
  if(id){if(type==='predictions')$('prediction-sample').value=id;else{$('import-id').value=id;guessMetadata();}}
  $('import-dialog').showModal();
}
function guessMetadata() {
  const match=$('import-id').value.match(/^SGNex_(.+)_directRNA_replicate(\d+)_run(\d+)$/);
  if(match){$('import-cell').value=match[1];$('import-replicate').value=match[2];$('import-run').value=match[3];}
}

async function doImport(event) {
  event.preventDefault();$('import-error').hidden=true;
  const file=$('import-file').files[0]; if(!file)return;
  const button=$('import-submit');button.disabled=true;button.textContent='Reading data…';
  try {
    if(file.size>150*1024*1024)throw new Error('Use a coverage or prediction CSV smaller than 150 MB. Do not upload raw signal JSON here.');
    await new Promise(resolve=>setTimeout(resolve,40));
    const text=await file.text(),records=parseCSV(text,file.name.endsWith('.tsv')||text.slice(0,text.indexOf('\n')).includes('\t')?'\t':',');
    const type=$('import-type').value,model=$('import-model').value.trim();
    if(type==='coverage'){
      const id=$('import-id').value.trim();if(sample(id))throw new Error('This sample already exists. Use prediction import to add scores; choose a new identifier for a different coverage file.');
      const rows=validateCoverage(records,id),hasScores=rows.some(r=>r.score!==null);
      if(hasScores&&!model)throw new Error('Provide a model name/version for this file’s scores.');
      const known=state.catalog.find(s=>s.id===id);
      const added={id,name:id,cellLine:$('import-cell').value.trim()||known?.cellLine||'Unspecified',replicate:$('import-replicate').value.trim()||known?.replicate||null,run:$('import-run').value.trim()||known?.run||null,group:'imported',source:file.name,model:hasScores?model:null,data:annotate(rows),annotationNote:'Annotations supplied in the imported CSV.'};
      setStats(added);state.samples.push(added);
      notify(`Imported ${fmt(rows.length)} candidate sites for ${id}.`);
    }else if(type==='predictions'){
      if(!model)throw new Error('Provide the model name/version so scores can be compared consistently.');
      const target=sample($('prediction-sample').value);if(!target)throw new Error('Choose a loaded sample.');
      await ensureLoaded([target.id]);
      if(target.model&&target.model!==model)throw new Error('This sample already has scores from another model/version. Use a fresh sample import to keep model outputs separate.');
      if(records.some(r=>r.sample_id&&r.sample_id!==target.id))throw new Error('The prediction file contains another sample_id. Choose the matching sample.');
      const attached=attachPredictions(target.data,records);target.data=attached.rows;target.model=model;setStats(target);
      notify(`Attached ${fmt(attached.matched)} prediction scores to ${target.name}.`);
    }else{
      const map=new Map();
      for(const r of records){if(!r.transcript_id||!r.gene_id)throw new Error('Every annotation needs transcript_id and gene_id.');const value=[r.gene_id,r.gene_name||''];if(map.has(r.transcript_id)&&JSON.stringify(map.get(r.transcript_id))!==JSON.stringify(value))throw new Error(`Conflicting annotation for ${r.transcript_id}.`);map.set(r.transcript_id,value);}
      let matched=0;const loaded=state.samples.filter(s=>s.data);
      for(const r of loaded.flatMap(s=>s.data)){const annotation=map.get(r.transcript_id);if(annotation){if(r.gene_id&&r.gene_id!==annotation[0])throw new Error(`Existing gene mapping conflicts for ${r.transcript_id}. Check the reference version.`);matched++;}}
      for(const [k,v] of map)state.annotations.set(k,v);
      for(const s of loaded)s.data=annotate(s.data);
      notify(`Updated annotations for ${fmt(matched)} opened site observations; samples opened later are annotated as they load.`);
    }
    geneCoverage.clear(); transcriptRunRows.clear();
    refresh();$('import-dialog').close();go(type==='coverage'?'data':'explorer');
  }catch(error){$('import-error').textContent=error.message;$('import-error').hidden=false;}
  finally{button.disabled=false;button.textContent='Import data';}
}


let dotTooltipTimer, activeDot = null;
function hideDotTooltip() {
  clearTimeout(dotTooltipTimer);
  if (activeDot) activeDot.removeAttribute('aria-describedby');
  activeDot = null;
  $('run-tooltip').hidden = true;
}
function scheduleHideDotTooltip() {
  clearTimeout(dotTooltipTimer);
  dotTooltipTimer = setTimeout(hideDotTooltip, 160);
}
function showDotTooltip(dot) {
  clearTimeout(dotTooltipTimer);
  if (activeDot && activeDot !== dot) activeDot.removeAttribute('aria-describedby');
  activeDot = dot;
  const s = sample(dot.dataset.runId);
  const threshold = Number($('global-reads').value) || readThresholds[0];
  const st = s.stats.byMinReads[threshold], high = aboveCutoff(st.scoreHist, state.cutoff);
  const tip = $('run-tooltip');
  tip.innerHTML = `<div class="run-tooltip-kicker">${esc(s.cellLine)} · SG-NEx run</div><strong class="run-tooltip-name">${esc(s.name)}</strong><div class="run-tooltip-value">${(high / st.scored * 100).toFixed(2)}%<span>score ≥ ${state.cutoff}</span></div><p>${fmt(high)} of ${fmt(st.scored)} scored observations</p><div class="run-tooltip-foot">Minimum coverage: ${threshold} reads · Model predictions</div>`;
  tip.style.setProperty('--tooltip-colour', cellColour(s.cellLine, 60));
  tip.hidden = false;
  dot.setAttribute('aria-describedby', 'run-tooltip');
  const rect = dot.getBoundingClientRect();
  const width = tip.offsetWidth, height = tip.offsetHeight;
  tip.style.left = `${Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12))}px`;
  const top = rect.top > height + 20 ? rect.top - height - 12 : rect.bottom + 12;
  tip.style.top = `${Math.max(12, Math.min(top, window.innerHeight - height - 12))}px`;
}
function bindOverviewControls() {
  $('global-reads').addEventListener('change', renderOverview);
  $('sample-checkboxes').addEventListener('change', e => {
    const input = e.target.closest('[data-sample-id]');
    if (!input) return;
    if (state.selectedSamples === null) state.selectedSamples = new Set(overviewSamples().map(s => s.id));
    if (input.checked) state.selectedSamples.add(input.dataset.sampleId);
    else state.selectedSamples.delete(input.dataset.sampleId);
    renderOverview();
  });
  $('samples-all').addEventListener('click', () => { state.selectedSamples = null; renderOverview(); });
  $('samples-clear').addEventListener('click', () => { state.selectedSamples = new Set(); renderOverview(); });
  $('samples-done').addEventListener('click', () => {
    $('sample-picker').open = false; $('sample-picker-summary').focus();
  });
  document.addEventListener('click', e => {
    if (!$('sample-picker').contains(e.target)) $('sample-picker').open = false;
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      hideDotTooltip();
      if ($('sample-picker').open) {
        $('sample-picker').open = false; $('sample-picker-summary').focus();
      }
    }
  });
  const chart = $('cellline-chart'), tip = $('run-tooltip');
  chart.addEventListener('pointerover', e => { const dot = e.target.closest('.run-dot'); if (dot) showDotTooltip(dot); });
  chart.addEventListener('pointerout', e => { if (e.target.closest('.run-dot')) scheduleHideDotTooltip(); });
  chart.addEventListener('focusin', e => { const dot = e.target.closest('.run-dot'); if (dot) showDotTooltip(dot); });
  chart.addEventListener('focusout', scheduleHideDotTooltip);
  chart.addEventListener('click', e => { const dot = e.target.closest('.run-dot'); if (dot) showDotTooltip(dot); });
  tip.addEventListener('pointerenter', () => clearTimeout(dotTooltipTimer));
  tip.addEventListener('pointerleave', scheduleHideDotTooltip);
  window.addEventListener('scroll', hideDotTooltip, true);
  window.addEventListener('resize', hideDotTooltip);
}

function bind() {
  bindExplorerTabs();
  bindComparisonTabs();
  bindCrossViews();
  bindRankedSites();
  document.querySelectorAll('[data-nav]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.nav)));
  document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.go)));
  document.querySelectorAll('.close-dialog').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
  for(const id of ['top-import','data-import'])$(id).addEventListener('click',()=>openImport());
  for(const id of ['overview-predictions','data-predictions'])$(id).addEventListener('click',()=>openImport('predictions'));
  $('data-annotations').addEventListener('click',()=>openImport('annotations'));
  $('show-helper').addEventListener('click',()=>$('helper-dialog').showModal());
  $('import-type').addEventListener('change',importTypeChanged);$('import-id').addEventListener('change',guessMetadata);$('import-form').addEventListener('submit',doImport);
  bindOverviewControls();
  bindTranscriptView();
  $('reset-filters').addEventListener('click',()=>{state.selectedSamples=null;$('global-reads').value='20';renderOverview();});
  $('site-search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>renderExplorer(),180);});
  for(const id of ['site-sample','site-reads','site-score','scored-only'])$(id).addEventListener('change',()=>renderExplorer());
  document.querySelectorAll('[data-sort]').forEach(b=>b.addEventListener('click',()=>{if(state.sort===b.dataset.sort)state.descending=!state.descending;else{state.sort=b.dataset.sort;state.descending=b.dataset.sort!=='transcript_id';}renderExplorer();}));
  $('page-prev').addEventListener('click',()=>{state.tablePage=Math.max(0,state.tablePage-1);renderExplorer(false);});
  $('page-next').addEventListener('click',()=>{state.tablePage++;renderExplorer(false);});
  $('site-table-body').addEventListener('click',e=>{const b=e.target.closest('[data-detail]');if(b)showDetail(state.filtered[Number(b.dataset.detail)]);});
  $('export-sites').addEventListener('click',()=>{download(toCSV(state.filtered,['sample_id','transcript_id','transcript_position','gene_id','gene_name','sequence','n_reads','score']),'dolly_filtered_sites.csv');notify(`Exported ${fmt(state.filtered.length)} filtered observations.`);});
  for(const id of ['compare-a','compare-b'])$(id).addEventListener('change',()=>{state.compareChosen=true;});
  for(const id of ['compare-a','compare-b','compare-metric','compare-reads'])$(id).addEventListener('change',()=>{if(id==='compare-metric')state.compareMeasurePreference=$('compare-metric').value;else state.crossPairScope=null;renderComparison();});
  $('export-comparison').addEventListener('click',()=>{const c=state.comparison;download(toCSV(c.pairs.map(p=>({sample_a:c.a,sample_b:c.b,site:p.key,measure:c.measure,value_a:p.x,value_b:p.y})),['sample_a','sample_b','site','measure','value_a','value_b']),'dolly_shared_sites.csv');});
  $('catalog-cell').addEventListener('change',renderData);
  $('catalog-table').addEventListener('click',e=>{const b=e.target.closest('[data-catalog-import]');if(b){const id=b.dataset.catalogImport;openImport(sample(id)?'predictions':'coverage',id);}});
  $('loaded-table').addEventListener('click',e=>{const b=e.target.closest('[data-explore-sample]');if(b){$('site-sample').value=b.dataset.exploreSample;setExplorerTab('inspect',false);go('explorer');highlightExploredSample();}});
  $('annotation-template').addEventListener('click',()=>{const map=new Map();state.samples.filter(s=>s.data).flatMap(s=>s.data).forEach(r=>{if(r.gene_id&&!map.has(r.transcript_id))map.set(r.transcript_id,{transcript_id:r.transcript_id,gene_id:r.gene_id,gene_name:r.gene_name});});download(toCSV([...map.values()],['transcript_id','gene_id','gene_name']),'dolly_transcript_gene_map.csv');});
  window.addEventListener('hashchange',()=>go(location.hash.slice(1)));
}

async function start() {
  try {
    const response=await fetch('data/manifest.json');if(!response.ok)throw new Error('Could not load the dataset manifest.');
    const manifest=await response.json();state.catalog=manifest.catalog;
    state.samples=manifest.datasets.map(s=>({...s,data:null,scoredTotal:s.stats.byMinReads[readThresholds[0]].scored}));
    bind();refreshOptions();go(location.hash.slice(1)||'overview');$('loading').hidden=true;
  }catch(error){$('loading').innerHTML=`<div class="error-page"><h2>The workspace couldn’t load</h2><p>${esc(error.message)}</p><p>Refresh to try again. For a local copy, serve the folder over HTTP rather than opening index.html directly.</p></div>`;}
}
start();

