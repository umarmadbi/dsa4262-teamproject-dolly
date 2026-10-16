import { parseCSV, validateCoverage, attachPredictions, decodeDataset, decodeCellLines, filterRows,
  compareSamples, toCSV, sampleStats, combineStats, aboveCutoff, readThresholds } from './core.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => Number(n).toLocaleString('en-US');
const state = { samples: [], catalog: [], rows: [], page: 'overview', tablePage: 0,
  sort: 'n_reads', descending: true, filtered: [], comparison: null, cutoff: .5,
  annotations: new Map(), tokens: { explorer: 0, compare: 0 } };
const loads = new Map();
let toastTimer, searchTimer;

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
  const lists = { 'global-sample': ['<option value="all">All runs and datasets</option>', noSummaries],
    'site-sample': [cellLineIds().length ? '<option value="cellline_all">All cell lines · summary</option>' : '', all],
    'compare-a': ['', all], 'compare-b': ['', all], 'prediction-sample': ['', noSummaries] };
  for (const [id, [extra, groups]] of Object.entries(lists)) {
    const el = $(id), old = el.value;
    el.innerHTML = extra + sampleOptions(groups);
    if ([...el.options].some(o => o.value === old)) el.value = old;
  }
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
function renderCellLines(threshold) {
  const runs = state.samples.filter(s => s.group === 'sgnex').map(s => {
    const st = s.stats.byMinReads[threshold];
    return { s, sites: st.sites, pct: st.scored ? aboveCutoff(st.scoreHist, state.cutoff) / st.scored * 100 : 0 };
  }).filter(q => q.s.stats.byMinReads[threshold].scored > 0);
  $('cellline-panel').hidden = !runs.length;
  if (!runs.length) return;
  const totalScored = runs.reduce((n, q) => n + q.s.stats.byMinReads[threshold].scored, 0);
  const totalAbove = runs.reduce((n, q) => n + aboveCutoff(q.s.stats.byMinReads[threshold].scoreHist, state.cutoff), 0);
  const options = Array.from({ length: 9 }, (_, i) => (i + 1) / 10).map(v => `<option value="${v}"${v === state.cutoff ? ' selected' : ''}>${v.toFixed(1)}</option>`).join('');
  $('cellline-controls').innerHTML = `<div class="score-controls"><label for="score-cutoff">Exploration cutoff</label><select id="score-cutoff" aria-describedby="cellline-control-note">${options}</select><strong aria-live="polite">${fmt(totalAbove)} / ${fmt(totalScored)} scored observations at or above ${state.cutoff}</strong></div><p id="cellline-control-note" class="fine-print">Across all SG-NEx runs at the selected minimum coverage. This cutoff updates the dot chart; it does not filter the score-distribution histogram.</p>`;
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
    svg += mine.sort((a, b) => a.s.id.localeCompare(b.s.id)).map((q, runIndex) => `<circle class="run-dot" tabindex="0" aria-label="${esc(q.s.name)}: ${q.pct.toFixed(2)}%" cx="${x(q.pct).toFixed(1)}" cy="${y}" r="5" fill="${cellColour(c, 34 + runIndex * 6)}" stroke="white" stroke-width=".7"><title>${esc(q.s.name)} · ${q.pct.toFixed(2)}% of ${fmt(q.sites)} sites</title></circle>`).join('');
    svg += `<text x="${w - r + 8}" y="${y + 4}">${mean.toFixed(2)}%</text>`;
  });
  $('cellline-chart').innerHTML = `<svg class="scatter-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Share of sites scoring at least ${state.cutoff} per run, grouped by cell line">${svg}</svg>`;
  const rho = runs.length > 2 ? pearson(runs.map(q => Math.log10(q.sites)), runs.map(q => q.pct)) : null;
  $('cellline-note').textContent = `Each colour family represents a cell line, with different shades for its runs. Each dot represents one SG-NEx run; the vertical mark and right-hand percentage show the unweighted mean across runs for that cell line. All SG-NEx runs with scores are shown, using the selected minimum coverage. ${rho === null || !Number.isFinite(rho) ? '' : `Across runs, log candidate-site count and the percentage scoring at least ${state.cutoff} have Pearson r = ${rho.toFixed(2)}. `}Site count is an imperfect proxy for sequencing depth; this association does not establish a cause. Compare shared sites and check replicate consistency before interpreting cell-line differences. Cell-line summaries include only sites averaging at least 0.5 in one or more cell lines.`;
}

function renderOverview() {
  const threshold = Number($('global-reads').value) || readThresholds[0], scope = $('global-sample').value;
  const samples = state.samples.filter(a => a.group !== 'cellline' && (scope === 'all' || a.id === scope));
  if (!samples.length) return;
  const s = combineStats(samples.map(a => a.stats), threshold), above = aboveCutoff(s.scoreHist, state.cutoff), one = samples.length === 1;
  $('overview-metrics').innerHTML = metric('Site observations', fmt(s.sites), one ? `${fmt(s.transcripts)} transcripts` : `Across ${samples.length} samples; shared sites count once per sample`)
    + metric('Median read coverage', s.medianReads === null ? '—' : fmt(s.medianReads), one ? 'Reads at a candidate site' : 'Median of per-sample medians')
    + metric('Mapped gene IDs', one ? fmt(s.genes) : '—', one ? 'Gene names can be imported' : 'Select one sample to count genes')
    + metric('Observations with predictions', s.scored ? fmt(s.scored) : 'Awaiting model', s.scored ? `${fmt(above)} at or above ${state.cutoff} · not experimental calls` : 'Coverage exploration is available', !s.scored);
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
  renderCellLines(threshold);
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

function explorerFilter() {
  return { sample: $('site-sample').value, minReads: Math.max(1,Number($('site-reads').value)||1), search: $('site-search').value,
    scoredOnly: $('scored-only').checked, minScore: $('site-score').disabled || $('site-score').value === '' ? null : Number($('site-score').value) };
}
async function renderExplorer(resetPage = true) {
  if (resetPage) state.tablePage = 0;
  const choice = $('site-sample').value, ids = choice === 'cellline_all' ? cellLineIds() : [choice], token = ++state.tokens.explorer;
  const scored = ids.some(id => sample(id)?.scoredTotal);
  $('site-score').disabled = $('scored-only').disabled = !scored;
  $('score-filter-note').textContent = scored ? 'Scores are model predictions, not experimental calls.' : 'Import predictions to enable score filters.';
  if (ids.some(id => !sample(id)?.data)) { $('site-result-count').textContent = 'Loading sites…'; $('site-table-body').innerHTML = '<tr><td class="empty-cell" colspan="8">Loading sites for this sample…</td></tr>'; }
  try { await ensureLoaded(ids); } catch (error) { if (token === state.tokens.explorer) $('site-result-count').textContent = error.message; return; }
  if (token !== state.tokens.explorer) return;
  const rows = filterRows(ids.flatMap(sampleRows), { ...explorerFilter(), sample: 'all' }), key = state.sort, direction = state.descending ? -1 : 1;
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

function scatter(pairs, log, leftName, rightName) {
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
  content+=`<text class="axis-label" x="${(l+w-r)/2}" y="${h-9}" text-anchor="middle">${esc(leftName)}${log?' · reads (log scale)':' · score'}</text><text class="axis-label" transform="translate(15 ${(t+h-b)/2}) rotate(-90)" text-anchor="middle">${esc(rightName)}${log?' · reads (log scale)':' · score'}</text>`;
  return `<svg class="scatter-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(log?'Read coverage':'Prediction score')} at ${fmt(pairs.length)} shared sites">${content}</svg>`;
}

async function renderComparison() {
  const a=$('compare-a').value,b=$('compare-b').value, minReads=Math.max(1,Number($('compare-reads').value)||1), token=++state.tokens.compare;
  if (!sample(a)?.data || !sample(b)?.data) $('compare-metrics').innerHTML=metric('Loading','…','Fetching site data for both samples');
  try { await ensureLoaded([a,b]); } catch (error) { if (token===state.tokens.compare) notify(error.message); return; }
  if (token!==state.tokens.compare) return;
  const left=sampleRows(a).filter(r=>r.n_reads>=minReads),right=sampleRows(b).filter(r=>r.n_reads>=minReads);
  const sa=sample(a),sb=sample(b), sameModel=Boolean(sa?.model && sa.model===sb?.model);
  const canScore = sameModel && left.some(r=>r.score!==null) && right.some(r=>r.score!==null);
  $('compare-score-option').disabled=!canScore;
  if ($('compare-metric').value==='score'&&!canScore) $('compare-metric').value='n_reads';
  const measure=$('compare-metric').value;
  const result=compareSamples(left,right,measure); state.comparison={...result,a,b,measure};
  $('compare-metrics').innerHTML=metric('Shared candidate sites',fmt(result.shared),'Matched transcript + position')+metric('Only in sample A',fmt(result.onlyLeft),'Measured under current filters')+metric('Only in sample B',fmt(result.onlyRight),'Measured under current filters');
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
  $('overlap-legend').innerHTML=[['Shared',result.shared],['Only sample A',result.onlyLeft],['Only sample B',result.onlyRight]].map(([name,n],i)=>`<div class="legend-row"><span class="legend-swatch" style="background:${colors[i]}"></span>${name}<strong>${fmt(n)}</strong></div>`).join('');
  $('export-comparison').disabled=!result.pairs.length;
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

function go(page) {
  if (!['overview','explorer','compare','data','methods'].includes(page)) page='overview';
  state.page=page;
  document.querySelectorAll('.page').forEach(el=>el.classList.toggle('active',el.id===`page-${page}`));
  document.querySelectorAll('[data-nav]').forEach(el=>{el.classList.toggle('active',el.dataset.nav===page);if(el.dataset.nav===page)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
  $('breadcrumb').textContent={overview:'Overview',explorer:'Site explorer',compare:'Compare samples',data:'Data & imports',methods:'Methods & guide'}[page];
  if(page==='overview')renderOverview();if(page==='explorer')renderExplorer();if(page==='compare')renderComparison();if(page==='data')renderData();
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
    refresh();$('import-dialog').close();go(type==='coverage'?'data':'explorer');
  }catch(error){$('import-error').textContent=error.message;$('import-error').hidden=false;}
  finally{button.disabled=false;button.textContent='Import data';}
}

function bind() {
  document.querySelectorAll('[data-nav]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.nav)));
  document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.go)));
  document.querySelectorAll('.close-dialog').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
  for(const id of ['top-import','data-import'])$(id).addEventListener('click',()=>openImport());
  for(const id of ['overview-predictions','data-predictions'])$(id).addEventListener('click',()=>openImport('predictions'));
  $('data-annotations').addEventListener('click',()=>openImport('annotations'));
  $('show-helper').addEventListener('click',()=>$('helper-dialog').showModal());
  $('import-type').addEventListener('change',importTypeChanged);$('import-id').addEventListener('change',guessMetadata);$('import-form').addEventListener('submit',doImport);
  for(const id of ['global-sample','global-reads'])$(id).addEventListener('change',renderOverview);
  $('reset-filters').addEventListener('click',()=>{$('global-sample').value='all';$('global-reads').value='20';renderOverview();});
  $('site-search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>renderExplorer(),180);});
  for(const id of ['site-sample','site-reads','site-score','scored-only'])$(id).addEventListener('change',()=>renderExplorer());
  document.querySelectorAll('[data-sort]').forEach(b=>b.addEventListener('click',()=>{if(state.sort===b.dataset.sort)state.descending=!state.descending;else{state.sort=b.dataset.sort;state.descending=b.dataset.sort!=='transcript_id';}renderExplorer();}));
  $('page-prev').addEventListener('click',()=>{state.tablePage=Math.max(0,state.tablePage-1);renderExplorer(false);});
  $('page-next').addEventListener('click',()=>{state.tablePage++;renderExplorer(false);});
  $('site-table-body').addEventListener('click',e=>{const b=e.target.closest('[data-detail]');if(b)showDetail(state.filtered[Number(b.dataset.detail)]);});
  $('export-sites').addEventListener('click',()=>{download(toCSV(state.filtered,['sample_id','transcript_id','transcript_position','gene_id','gene_name','sequence','n_reads','score']),'dolly_filtered_sites.csv');notify(`Exported ${fmt(state.filtered.length)} filtered observations.`);});
  for(const id of ['compare-a','compare-b'])$(id).addEventListener('change',()=>{state.compareChosen=true;});
  for(const id of ['compare-a','compare-b','compare-metric','compare-reads'])$(id).addEventListener('change',renderComparison);
  $('export-comparison').addEventListener('click',()=>{const c=state.comparison;download(toCSV(c.pairs.map(p=>({sample_a:c.a,sample_b:c.b,site:p.key,measure:c.measure,value_a:p.x,value_b:p.y})),['sample_a','sample_b','site','measure','value_a','value_b']),'dolly_shared_sites.csv');});
  $('catalog-cell').addEventListener('change',renderData);
  $('catalog-table').addEventListener('click',e=>{const b=e.target.closest('[data-catalog-import]');if(b){const id=b.dataset.catalogImport;openImport(sample(id)?'predictions':'coverage',id);}});
  $('loaded-table').addEventListener('click',e=>{const b=e.target.closest('[data-explore-sample]');if(b){$('site-sample').value=b.dataset.exploreSample;go('explorer');}});
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
